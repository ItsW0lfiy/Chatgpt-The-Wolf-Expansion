import {
  ACCOUNT_OWNED_STORAGE_KEYS,
  AccountScopedStorage,
  getAccountScopedStorageKey,
} from "./AccountScopedStorage";
import {
  hasLegacyOrganizationData,
  normalizeFavorites,
  normalizeFolderChatNameDisplayOverrides,
  normalizeFolderMembership,
  normalizeFolders,
  normalizeFoldersUiState,
  normalizeLegacyAccountData,
  normalizeQuickAccessUiState,
  normalizeUiState,
} from "./migrations";
import {
  STORAGE_KEYS,
  type FavoriteConversation,
  type FavoritesUiState,
  type FolderConversationMembership,
  type FolderRecord,
  type FoldersUiState,
  type ItemNameDisplayMode,
  type LegacyAccountData,
  type QuickAccessUiState,
} from "./schemas";
import type { KeyValueStorage } from "./StorageService";

export type LegacyAccountRecoveryStatus =
  | { state: "account-unresolved" }
  | { state: "no-legacy-data" }
  | { state: "source-unavailable" }
  | { state: "already-claimed"; claimedToCurrentScope: boolean }
  | { state: "destination-not-empty" }
  | {
      state: "available";
      scopeId: string;
      favoriteCount: number;
      folderCount: number;
      membershipCount: number;
    }
  | {
      state: "stable-rebind-available";
      scopeId: string;
      sourceScopeId: string;
      favoriteCount: number;
      folderCount: number;
      membershipCount: number;
    };

export type LegacyAccountRecoveryResult =
  | Exclude<LegacyAccountRecoveryStatus,
    { state: "available" } | { state: "stable-rebind-available" }>
  | {
      state: "restored";
      favoriteCount: number;
      folderCount: number;
      membershipCount: number;
    };

interface AccountOwnedSnapshot {
  favorites: FavoriteConversation[];
  uiState: FavoritesUiState;
  folders: FolderRecord[];
  folderMembership: FolderConversationMembership[];
  foldersUiState: FoldersUiState;
  quickAccessUiState: QuickAccessUiState;
  folderChatNameDisplayOverrides: Record<string, ItemNameDisplayMode>;
  hasStoredValues: boolean;
}

export class LegacyAccountRecoveryService {
  private operationQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly storage: KeyValueStorage,
    private readonly accountStorage: AccountScopedStorage,
  ) {}

  public async getStatus(): Promise<LegacyAccountRecoveryStatus> {
    const scopeId = this.accountStorage.activeScopeId;
    return scopeId ? this.inspectForScope(scopeId) : { state: "account-unresolved" };
  }

  public async restore(expectedScopeId: string): Promise<LegacyAccountRecoveryResult> {
    let result: LegacyAccountRecoveryResult = { state: "account-unresolved" };
    const operation = async (): Promise<void> => {
      const scopeId = this.accountStorage.activeScopeId;
      if (!scopeId || scopeId !== expectedScopeId) {
        result = { state: "account-unresolved" };
        return;
      }
      const status = await this.inspectForScope(scopeId);
      if (status.state !== "available" && status.state !== "stable-rebind-available") {
        result = status;
        return;
      }
      if (this.accountStorage.activeScopeId !== scopeId) {
        result = { state: "account-unresolved" };
        return;
      }

      const legacy = await this.readLegacy();
      if (!legacy || !hasLegacyOrganizationData(legacy)) {
        result = { state: "no-legacy-data" };
        return;
      }
      if (legacy.stableScopeMigration) {
        result = {
          state: "already-claimed",
          claimedToCurrentScope: legacy.stableScopeMigration.destinationScopeId === scopeId,
        };
        return;
      }
      if (await this.destinationHasData(scopeId)) {
        result = { state: "destination-not-empty" };
        return;
      }

      const sourceScopeId = status.state === "stable-rebind-available"
        ? status.sourceScopeId
        : null;
      let snapshot: AccountOwnedSnapshot;
      if (sourceScopeId) {
        if (!isOpaqueAccountScopeId(sourceScopeId)) {
          result = { state: "source-unavailable" };
          return;
        }
        if (sourceScopeId === scopeId) {
          result = { state: "already-claimed", claimedToCurrentScope: true };
          return;
        }
        if (legacy.claimedToScopeId !== sourceScopeId) {
          result = { state: "source-unavailable" };
          return;
        }
        snapshot = await this.readAccountSnapshot(sourceScopeId, snapshotFromLegacy(legacy));
        if (!snapshot.hasStoredValues || !hasSnapshotOrganizationData(snapshot)) {
          result = { state: "source-unavailable" };
          return;
        }
      } else {
        if (legacy.claimedToScopeId) {
          result = {
            state: "already-claimed",
            claimedToCurrentScope: legacy.claimedToScopeId === scopeId,
          };
          return;
        }
        snapshot = snapshotFromLegacy(legacy);
      }

      if (this.accountStorage.activeScopeId !== scopeId) {
        result = { state: "account-unresolved" };
        return;
      }
      if (await this.destinationHasData(scopeId)) {
        result = { state: "destination-not-empty" };
        return;
      }
      if (this.accountStorage.activeScopeId !== scopeId) {
        result = { state: "account-unresolved" };
        return;
      }

      const claimedAt = Date.now();
      const claimedLegacy: LegacyAccountData = {
        preservedAt: legacy.preservedAt,
        sourceSchemaVersion: legacy.sourceSchemaVersion,
        claimedToScopeId: legacy.claimedToScopeId ?? scopeId,
        claimedAt: legacy.claimedAt ?? claimedAt,
        claimedIdentityVersion: sourceScopeId ? "legacy-profile" : "stable-user-id",
        stableScopeMigration: sourceScopeId
          ? { sourceScopeId, destinationScopeId: scopeId, migratedAt: claimedAt }
          : null,
        favorites: legacy.favorites,
        uiState: legacy.uiState,
        folders: legacy.folders,
        folderMembership: legacy.folderMembership,
        foldersUiState: legacy.foldersUiState,
        quickAccessUiState: legacy.quickAccessUiState,
        folderChatNameDisplayOverrides: legacy.folderChatNameDisplayOverrides,
      };
      await this.storage.setMany({
        ...snapshotToScopedValues(scopeId, snapshot),
        [STORAGE_KEYS.legacyAccountData]: claimedLegacy,
      });
      result = {
        state: "restored",
        favoriteCount: snapshot.favorites.length,
        folderCount: snapshot.folders.length,
        membershipCount: snapshot.folderMembership.length,
      };
    };
    const nextOperation = this.operationQueue.then(operation, operation);
    this.operationQueue = nextOperation.catch(() => undefined);
    await nextOperation;
    return result;
  }

  private async inspectForScope(scopeId: string): Promise<LegacyAccountRecoveryStatus> {
    if (this.accountStorage.activeScopeId !== scopeId) {
      return { state: "account-unresolved" };
    }
    const legacy = await this.readLegacy();
    if (!legacy || !hasLegacyOrganizationData(legacy)) {
      return { state: "no-legacy-data" };
    }
    if (legacy.stableScopeMigration) {
      return {
        state: "already-claimed",
        claimedToCurrentScope: legacy.stableScopeMigration.destinationScopeId === scopeId,
      };
    }
    if (legacy.claimedToScopeId === scopeId) {
      return { state: "already-claimed", claimedToCurrentScope: true };
    }
    if (legacy.claimedToScopeId && legacy.claimedIdentityVersion === "stable-user-id") {
      return { state: "already-claimed", claimedToCurrentScope: false };
    }
    if (await this.destinationHasData(scopeId)) {
      return { state: "destination-not-empty" };
    }
    if (this.accountStorage.activeScopeId !== scopeId) {
      return { state: "account-unresolved" };
    }

    if (legacy.claimedToScopeId) {
      if (!isOpaqueAccountScopeId(legacy.claimedToScopeId)) {
        return { state: "source-unavailable" };
      }
      const source = await this.readAccountSnapshot(
        legacy.claimedToScopeId,
        snapshotFromLegacy(legacy),
      );
      if (!source.hasStoredValues || !hasSnapshotOrganizationData(source)) {
        return { state: "source-unavailable" };
      }
      if (this.accountStorage.activeScopeId !== scopeId) {
        return { state: "account-unresolved" };
      }
      return {
        state: "stable-rebind-available",
        scopeId,
        sourceScopeId: legacy.claimedToScopeId,
        favoriteCount: source.favorites.length,
        folderCount: source.folders.length,
        membershipCount: source.folderMembership.length,
      };
    }

    return {
      state: "available",
      scopeId,
      favoriteCount: legacy.favorites.length,
      folderCount: legacy.folders.length,
      membershipCount: legacy.folderMembership.length,
    };
  }

  private async readLegacy(): Promise<LegacyAccountData | null> {
    return normalizeLegacyAccountData(
      await this.storage.get<unknown>(STORAGE_KEYS.legacyAccountData, undefined),
    );
  }

  private async readAccountSnapshot(
    scopeId: string,
    fallback?: AccountOwnedSnapshot,
  ): Promise<AccountOwnedSnapshot> {
    const values = await Promise.all(
      ACCOUNT_OWNED_STORAGE_KEYS.map((key) =>
        this.storage.get<unknown>(getAccountScopedStorageKey(scopeId, key), undefined)
      ),
    );
    const favorites = normalizeFavorites(values[0] === undefined ? fallback?.favorites : values[0]);
    const uiState = normalizeUiState(values[1] === undefined ? fallback?.uiState : values[1]);
    const folders = normalizeFolders(values[2] === undefined ? fallback?.folders : values[2]);
    const folderIds = new Set(folders.map((folder) => folder.id));
    return {
      favorites,
      uiState,
      folders,
      folderMembership: normalizeFolderMembership(
        values[3] === undefined ? fallback?.folderMembership : values[3],
        folderIds,
      ),
      foldersUiState: normalizeFoldersUiState(
        values[4] === undefined ? fallback?.foldersUiState : values[4],
      ),
      quickAccessUiState: normalizeQuickAccessUiState(
        values[5] === undefined ? fallback?.quickAccessUiState : values[5],
      ),
      folderChatNameDisplayOverrides: Object.fromEntries(
        Object.entries(normalizeFolderChatNameDisplayOverrides(
          values[6] === undefined ? fallback?.folderChatNameDisplayOverrides : values[6],
        ))
          .filter(([folderId]) => folderIds.has(folderId)),
      ),
      hasStoredValues: values.some((value) => value !== undefined) || fallback !== undefined,
    };
  }

  private async destinationHasData(scopeId: string): Promise<boolean> {
    const values = await Promise.all(
      ACCOUNT_OWNED_STORAGE_KEYS.map((key) =>
        this.storage.get<unknown>(getAccountScopedStorageKey(scopeId, key), undefined)
      ),
    );
    return values.some((value) => value !== undefined);
  }
}

function snapshotFromLegacy(legacy: LegacyAccountData): AccountOwnedSnapshot {
  return {
    favorites: legacy.favorites,
    uiState: legacy.uiState,
    folders: legacy.folders,
    folderMembership: legacy.folderMembership,
    foldersUiState: legacy.foldersUiState,
    quickAccessUiState: legacy.quickAccessUiState,
    folderChatNameDisplayOverrides: legacy.folderChatNameDisplayOverrides,
    hasStoredValues: true,
  };
}

function hasSnapshotOrganizationData(snapshot: AccountOwnedSnapshot): boolean {
  return snapshot.favorites.length > 0 ||
    snapshot.folders.length > 0 ||
    snapshot.folderMembership.length > 0 ||
    Object.keys(snapshot.folderChatNameDisplayOverrides).length > 0 ||
    snapshot.uiState.collapsed ||
    snapshot.foldersUiState.collapsed ||
    snapshot.quickAccessUiState.collapsed;
}

function snapshotToScopedValues(
  scopeId: string,
  snapshot: AccountOwnedSnapshot,
): Record<string, unknown> {
  return {
    [getAccountScopedStorageKey(scopeId, STORAGE_KEYS.favorites)]: snapshot.favorites,
    [getAccountScopedStorageKey(scopeId, STORAGE_KEYS.uiState)]: snapshot.uiState,
    [getAccountScopedStorageKey(scopeId, STORAGE_KEYS.folders)]: snapshot.folders,
    [getAccountScopedStorageKey(
      scopeId,
      STORAGE_KEYS.folderMembership,
    )]: snapshot.folderMembership,
    [getAccountScopedStorageKey(scopeId, STORAGE_KEYS.foldersUiState)]: snapshot.foldersUiState,
    [getAccountScopedStorageKey(
      scopeId,
      STORAGE_KEYS.quickAccessUiState,
    )]: snapshot.quickAccessUiState,
    [getAccountScopedStorageKey(
      scopeId,
      STORAGE_KEYS.folderChatNameDisplayOverrides,
    )]: snapshot.folderChatNameDisplayOverrides,
  };
}

function isOpaqueAccountScopeId(scopeId: string): boolean {
  return /^sha256-[0-9a-f]{64}$/u.test(scopeId);
}
