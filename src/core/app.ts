import { DefaultChatGPTAdapter } from "../adapters/chatgpt/ChatGPTAdapter";
import { FavoritesRepository } from "../features/favorites/FavoritesRepository";
import { FoldersRepository } from "../features/folders/FoldersRepository";
import { FolderDisplayOverridesRepository } from "../features/folders/FolderDisplayOverridesRepository";
import { QuickAccessFeature } from "../features/quickAccess/QuickAccessFeature";
import { QuickAccessUiStateRepository } from "../features/quickAccess/QuickAccessUiStateRepository";
import { InChatSettingsFeature } from "../features/settings/InChatSettingsFeature";
import { SettingsService } from "../settings/settings";
import { migrateStorage } from "../storage/migrations";
import { AccountScopedStorage } from "../storage/AccountScopedStorage";
import {
  LegacyAccountRecoveryService,
  type LegacyAccountRecoveryResult,
} from "../storage/LegacyAccountRecoveryService";
import { StorageService } from "../storage/StorageService";
import {
  createOpaqueAccountScopeId,
  getChatGPTAccountEvidenceSignature,
  type ChatGPTAccountEvidence,
} from "../accounts/accountIdentity";
import { AccountScopeTransition } from "../accounts/accountScopeTransition";
import type { Unsubscribe } from "../shared/types";
import { FeatureLifecycle } from "./lifecycle";
import { ConsoleLogger } from "./logger";
import { WolfSidebarRoot } from "./WolfSidebarRoot";

export class WolfExpansionApp {
  private readonly logger = new ConsoleLogger(false);
  private readonly storage = new StorageService(this.logger);
  private readonly accountStorage = new AccountScopedStorage(this.storage);
  private readonly legacyAccountRecoveryService = new LegacyAccountRecoveryService(
    this.storage,
    this.accountStorage,
  );
  private readonly settingsService = new SettingsService(this.storage);
  private readonly lifecycle = new FeatureLifecycle();
  private readonly adapter = new DefaultChatGPTAdapter(this.logger);
  private readonly sidebarRoot = new WolfSidebarRoot(this.adapter, this.logger);
  private readonly favoritesRepository = new FavoritesRepository(this.accountStorage, this.logger);
  private readonly foldersRepository = new FoldersRepository(this.accountStorage, this.logger);
  private readonly folderDisplayOverridesRepository = new FolderDisplayOverridesRepository(
    this.accountStorage,
  );
  private readonly quickAccessUiStateRepository = new QuickAccessUiStateRepository(
    this.accountStorage,
  );
  private readonly settingsFeature = new InChatSettingsFeature(
    this.adapter,
    this.settingsService,
    this.foldersRepository,
    this.folderDisplayOverridesRepository,
    this.legacyAccountRecoveryService,
    (expectedScopeId) => this.restoreLegacyAccountData(expectedScopeId),
    this.sidebarRoot,
    this.logger,
  );
  private readonly quickAccessFeature = new QuickAccessFeature(
    this.adapter,
    this.favoritesRepository,
    this.foldersRepository,
    this.folderDisplayOverridesRepository,
    this.quickAccessUiStateRepository,
    this.sidebarRoot,
    this.logger,
  );
  private settingsUnsubscribe: Unsubscribe | null = null;
  private accountEvidenceUnsubscribe: Unsubscribe | null = null;
  private applyingSettings: Promise<void> = Promise.resolve();
  private applyingAccountEvidence: Promise<void> = Promise.resolve();
  private readonly accountTransition = new AccountScopeTransition();
  private appliedEvidenceSignature: string | null = null;

  public async start(): Promise<void> {
    await migrateStorage(this.storage);
    this.settingsUnsubscribe = this.settingsService.subscribe(() => {
      this.applyingSettings = this.applyingSettings.then(
        () => this.applySettings(),
        () => this.applySettings(),
      );
    });
    this.accountEvidenceUnsubscribe = this.adapter.watchAccountEvidence((evidence) => {
      this.queueAccountEvidence(evidence);
    });
    const initialGeneration = this.accountTransition.begin();
    await this.applyAccountEvidence(this.adapter.getAccountEvidence(), initialGeneration);
    this.logger.debug("Extension initialized.");
  }

  public async destroy(): Promise<void> {
    this.settingsUnsubscribe?.();
    this.settingsUnsubscribe = null;
    this.accountEvidenceUnsubscribe?.();
    this.accountEvidenceUnsubscribe = null;
    await this.lifecycle.destroy([
      this.quickAccessFeature,
      this.settingsFeature,
    ]);
    this.sidebarRoot.destroy();
  }

  private async applySettings(expectedAccountGeneration?: number): Promise<void> {
    const settings = await this.settingsService.get();
    if (expectedAccountGeneration !== undefined &&
      !this.accountTransition.isCurrent(expectedAccountGeneration)) {
      return;
    }
    this.logger.setDebugEnabled(settings.debug.enabled);

    if (!settings.enabled) {
      await this.lifecycle.setEnabled(this.quickAccessFeature, false);
      await this.lifecycle.setEnabled(this.settingsFeature, false);
      this.settingsFeature.setSettings(settings);
      await this.quickAccessFeature.setSettings(settings);
      return;
    }

    if (!settings.favorites.enabled) {
      await this.lifecycle.setEnabled(this.quickAccessFeature, false);
    }
    this.settingsFeature.setSettings(settings);
    await this.quickAccessFeature.setSettings(settings);
    await this.lifecycle.setEnabled(this.settingsFeature, true);
    await this.lifecycle.setEnabled(
      this.quickAccessFeature,
      !this.accountTransition.isPending &&
        this.accountStorage.activeScopeId !== null &&
        (settings.favorites.enabled || settings.folders.enabled),
    );
  }

  private async restoreLegacyAccountData(
    expectedScopeId: string,
  ): Promise<LegacyAccountRecoveryResult> {
    await this.lifecycle.setEnabled(this.quickAccessFeature, false);
    await Promise.all([
      this.quickAccessFeature.whenIdle(),
      this.favoritesRepository.whenIdle(),
      this.foldersRepository.whenIdle(),
      this.folderDisplayOverridesRepository.whenIdle(),
    ]);
    try {
      const result = await this.legacyAccountRecoveryService.restore(expectedScopeId);
      if (result.state === "restored") {
        this.logger.debug("Previous Quick Access data restored to current account scope.", {
          favoriteCount: result.favoriteCount,
          folderCount: result.folderCount,
          membershipCount: result.membershipCount,
        });
      }
      return result;
    } finally {
      await this.applySettings();
    }
  }

  private queueAccountEvidence(evidence: ChatGPTAccountEvidence): void {
    const signature = getChatGPTAccountEvidenceSignature(evidence);
    if (signature === this.appliedEvidenceSignature) {
      return;
    }
    const generation = this.accountTransition.begin();
    this.settingsFeature.resetAccountContext();
    const immediateDisable = this.lifecycle.setEnabled(this.quickAccessFeature, false);
    this.applyingAccountEvidence = this.applyingAccountEvidence.then(
      async () => {
        await immediateDisable;
        await this.applyAccountEvidence(evidence, generation);
      },
      async () => {
        await immediateDisable;
        await this.applyAccountEvidence(evidence, generation);
      },
    );
  }

  private async applyAccountEvidence(
    evidence: ChatGPTAccountEvidence,
    generation: number,
  ): Promise<void> {
    const signature = getChatGPTAccountEvidenceSignature(evidence);
    if (!this.accountTransition.isCurrent(generation)) {
      return;
    }
    if (signature === this.appliedEvidenceSignature) {
      return;
    }

    this.settingsFeature.resetAccountContext();
    await this.lifecycle.setEnabled(this.quickAccessFeature, false);
    await Promise.all([
      this.quickAccessFeature.whenIdle(),
      this.favoritesRepository.whenIdle(),
      this.foldersRepository.whenIdle(),
      this.folderDisplayOverridesRepository.whenIdle(),
    ]);
    this.accountStorage.setScope(null);
    if (!this.accountTransition.isCurrent(generation)) {
      return;
    }

    if (evidence.state === "identified") {
      const scopeId = await createOpaqueAccountScopeId(evidence.identity);
      if (!this.accountTransition.isCurrent(generation)) {
        return;
      }
      this.accountStorage.setScope(scopeId);
      this.logger.debug("ChatGPT account scope resolved.", { source: evidence.source });
    } else {
      this.logger.debug(
        evidence.state === "logged-out"
          ? "ChatGPT logged out; account-owned Wolf data hidden."
          : "ChatGPT account unresolved; account-owned Wolf data hidden.",
      );
    }
    if (!this.accountTransition.isCurrent(generation)) {
      this.accountStorage.setScope(null);
      return;
    }
    this.appliedEvidenceSignature = signature;
    this.accountTransition.complete(generation);
    await this.applySettings(generation);
    if (!this.accountTransition.isCurrent(generation)) {
      await this.lifecycle.setEnabled(this.quickAccessFeature, false);
      this.accountStorage.setScope(null);
    }
  }
}
