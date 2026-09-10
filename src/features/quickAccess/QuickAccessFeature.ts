import type {
  ChatGPTAdapter,
  ConversationReference,
} from "../../adapters/chatgpt/ChatGPTAdapter";
import {
  collectDetectedConversationMetadata,
  normalizeConversationIdentity,
  type DetectedConversationMetadata,
} from "../../adapters/chatgpt/conversationIdentity";
import type { Logger } from "../../core/logger";
import type { WolfSidebarRoot } from "../../core/WolfSidebarRoot";
import { debounce } from "../../shared/events";
import type { Feature, Unsubscribe } from "../../shared/types";
import type { WolfExpansionSettings } from "../../storage/schemas";
import { FavoritesRepository } from "../favorites/FavoritesRepository";
import { FoldersRepository } from "../folders/FoldersRepository";
import { FolderDisplayOverridesRepository } from "../folders/FolderDisplayOverridesRepository";
import { QuickAccessMenuIntegration } from "./QuickAccessMenuIntegration";
import { QuickAccessMembershipService } from "./QuickAccessMembershipService";
import { buildQuickAccessProjection } from "./quickAccessProjection";
import { QuickAccessSidebar } from "./QuickAccessSidebar";
import { QuickAccessUiStateRepository } from "./QuickAccessUiStateRepository";
import {
  QuickAccessRefreshCoordinator,
  type QuickAccessRefreshReason,
  type QuickAccessRefreshWork,
} from "./refreshGeneration";

export class QuickAccessFeature implements Feature {
  public readonly id = "quick-access";

  private enabled = false;
  private collapsed = false;
  private settings: WolfExpansionSettings | null = null;
  private readonly unsubscribers: Unsubscribe[] = [];
  private readonly transientFolderCollapse = new Map<string, boolean>();
  private readonly sidebar: QuickAccessSidebar;
  private readonly menuIntegration: QuickAccessMenuIntegration;
  private readonly scheduleRepositoryRefresh: () => void;
  private readonly scheduleSidebarRefresh: () => void;
  private readonly membershipService: QuickAccessMembershipService;
  private readonly refreshCoordinator = new QuickAccessRefreshCoordinator();
  private refreshInFlight: Promise<void> | null = null;

  public constructor(
    private readonly adapter: ChatGPTAdapter,
    private readonly favoritesRepository: FavoritesRepository,
    private readonly foldersRepository: FoldersRepository,
    private readonly folderDisplayOverridesRepository: FolderDisplayOverridesRepository,
    private readonly uiStateRepository: QuickAccessUiStateRepository,
    sidebarRoot: WolfSidebarRoot,
    private readonly logger: Logger,
  ) {
    this.scheduleSidebarRefresh = debounce(() => void this.refresh("sidebar"), 160);
    this.scheduleRepositoryRefresh = debounce(() => void this.refresh("repository"), 40);
    this.membershipService = new QuickAccessMembershipService(
      favoritesRepository,
      foldersRepository,
      logger,
    );
    this.sidebar = new QuickAccessSidebar(
      adapter,
      {
        onSectionCollapseChange: async (collapsed) => {
          this.collapsed = collapsed;
          if (this.settings?.favorites.rememberCollapsed) {
            await this.uiStateRepository.save({ collapsed });
          }
          await this.refresh("explicit");
        },
        onToggleQuickAccess: async (conversation) => {
          return this.membershipService.toggle(conversation);
        },
        onRemoveQuickAccess: (conversationId) =>
          this.membershipService.removeFromQuickAccess(conversationId),
        onReorderRootChats: (conversationIds) =>
          this.favoritesRepository.reorder(conversationIds),
        onFolderCollapseChange: async (folderId, collapsed) => {
          if (this.settings?.folders.rememberCollapsed) {
            await this.foldersRepository.setFolderCollapsed(folderId, collapsed);
          } else {
            this.transientFolderCollapse.set(folderId, collapsed);
            await this.refresh("explicit");
          }
        },
        onCreateFolder: (name, parentId) =>
          this.foldersRepository.createFolder(name, parentId).then(() => undefined),
        onRenameFolder: (folderId, name) =>
          this.foldersRepository.renameFolder(folderId, name),
        onMoveFolder: (folderId, parentId, targetIndex) =>
          this.foldersRepository.moveFolder(folderId, parentId, targetIndex),
        onMoveFolderByOne: (folderId, direction) =>
          this.foldersRepository.reorderFolder(folderId, direction),
        onDeleteFolder: (folderId) => this.foldersRepository.deleteFolder(folderId),
        onSetFolderChatNameDisplay: async (folderId, mode) => {
          await this.folderDisplayOverridesRepository.set(folderId, mode);
        },
        onAssignConversation: async (folderId, conversation, source) => {
          await this.membershipService.assignToFolder(folderId, conversation);
          if (source === "quick-access-chat") {
            this.logger.debug("Quick Access chat assigned to folder.", {
              conversationId: conversation.conversationId,
              folderId,
            });
          } else if (source === "folder-chat") {
            this.logger.debug("Folder chat moved.", {
              conversationId: conversation.conversationId,
              folderId,
            });
          }
        },
        onRemoveConversationFromFolder: (conversationId) =>
          this.membershipService.moveToRoot(conversationId),
        onReorderFolderChats: async (folderId, conversationIds) => {
          await this.foldersRepository.reorderConversations(folderId, conversationIds);
          this.logger.debug("Chat reordered.", { folderId });
        },
        onDebugToggleCurrentConversation: async () => {
          const current = this.adapter.getCurrentConversationIdentity();
          if (!current) {
            this.logger.debug("Debug Quick Access action aborted: no current conversation.");
            return;
          }
          await this.membershipService.toggle(current);
        },
        onOpenConversationMenu: (conversation, anchor) => {
          this.menuIntegration.openLocalMenu(conversation, anchor);
        },
      },
      sidebarRoot,
      logger,
    );
    this.menuIntegration = new QuickAccessMenuIntegration(
      adapter,
      favoritesRepository,
      foldersRepository,
      this.membershipService,
      {
        onNativeRenameDraft: (conversationId, draft) => {
          this.sidebar.setConversationTitlePreview(conversationId, draft);
        },
        onNativeRenameFinished: async (conversationId) => {
          await new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => resolve());
          });
          await this.refresh("sidebar");
          this.sidebar.clearConversationTitlePreview(conversationId);
        },
      },
      logger,
    );
  }

  public async setSettings(settings: WolfExpansionSettings): Promise<void> {
    const previouslyRemembered = this.settings?.favorites.rememberCollapsed;
    const previouslyRememberedFolders = this.settings?.folders.rememberCollapsed;
    this.settings = settings;
    this.menuIntegration.setSettings(settings);
    if (!settings.favorites.rememberCollapsed && previouslyRemembered !== false) {
      this.collapsed = false;
    }
    if (!settings.folders.rememberCollapsed && previouslyRememberedFolders !== false) {
      this.transientFolderCollapse.clear();
    }
    if (this.enabled) {
      await this.refresh("explicit");
    }
  }

  public async enable(): Promise<void> {
    if (this.enabled) {
      return;
    }
    this.enabled = true;
    const uiState = await this.uiStateRepository.get();
    this.collapsed = this.settings?.favorites.rememberCollapsed ? uiState.collapsed : false;
    this.unsubscribers.push(
      this.adapter.watchSidebar(this.scheduleSidebarRefresh),
      this.adapter.watchNavigation(this.scheduleSidebarRefresh),
      this.favoritesRepository.subscribe(this.scheduleRepositoryRefresh),
      this.foldersRepository.subscribe(this.scheduleRepositoryRefresh),
      this.folderDisplayOverridesRepository.subscribe(this.scheduleRepositoryRefresh),
    );
    this.menuIntegration.enable();
    await this.refresh("explicit");
    this.logger.debug("Quick Access enabled.");
  }

  public disable(): void {
    if (!this.enabled) {
      return;
    }
    this.enabled = false;
    this.refreshCoordinator.reset();
    while (this.unsubscribers.length > 0) {
      this.unsubscribers.pop()?.();
    }
    this.menuIntegration.disable();
    this.sidebar.remove();
    this.logger.debug("Quick Access disabled.");
  }

  public destroy(): void {
    this.disable();
  }

  public async whenIdle(): Promise<void> {
    await this.refreshInFlight;
  }

  private async refresh(reason: QuickAccessRefreshReason): Promise<void> {
    this.refreshCoordinator.request(reason);
    if (this.refreshInFlight) {
      await this.refreshInFlight;
      return;
    }

    const refreshOperation = this.runRefreshLoop();
    this.refreshInFlight = refreshOperation;
    try {
      await refreshOperation;
    } finally {
      if (this.refreshInFlight === refreshOperation) {
        this.refreshInFlight = null;
      }
    }
  }

  private async runRefreshLoop(): Promise<void> {
    let work = this.refreshCoordinator.takeNext();
    while (this.enabled && work) {
      await this.refreshOnce(work);
      work = this.refreshCoordinator.takeNext();
    }
  }

  private async refreshOnce(work: QuickAccessRefreshWork): Promise<void> {
    const settings = this.settings;
    if (!this.enabled || !settings) {
      return;
    }
    if (!settings.favorites.enabled && !settings.folders.enabled) {
      this.sidebar.remove();
      return;
    }
    try {
      const references = this.adapter.findConversationLinks()
        .map((link) => this.adapter.getConversationReference(link))
        .filter((reference): reference is ConversationReference => reference !== null);
      const cachedMetadata = new Map<string, { title: string; url: string }>();
      if (work.ingestDetectedTitles) {
        const [cachedFavorites, cachedMemberships] = await Promise.all([
          this.favoritesRepository.list(),
          settings.folders.enabled
            ? this.foldersRepository.listMembership()
            : Promise.resolve([]),
        ]);
        cachedFavorites.forEach((favorite) => {
          cachedMetadata.set(favorite.conversationId, {
            title: favorite.title,
            url: favorite.url,
          });
        });
        cachedMemberships.forEach((membership) => {
          if (!cachedMetadata.has(membership.conversationId)) {
            cachedMetadata.set(membership.conversationId, {
              title: membership.title,
              url: membership.url,
            });
          }
        });
      }
      const detected = work.ingestDetectedTitles
        ? collectDetectedConversationMetadata(references, cachedMetadata)
        : new Map<string, DetectedConversationMetadata>();
      if (work.ingestDetectedTitles) {
        const current = this.adapter.getCurrentConversationIdentity();
        if (
          current &&
          !detected.has(current.conversationId) &&
          !references.some((reference) =>
            reference.conversationId === current.conversationId) &&
          current.title !== "Current conversation"
        ) {
          detected.set(current.conversationId, {
            title: current.title,
            route: current.route,
            url: current.url,
          });
        }
      }
      const diagnosticConversationIds = work.ingestDetectedTitles
        ? await this.logDetectedTitleDiagnostics(references, detected, settings)
        : new Set<string>();
      if (work.ingestDetectedTitles) {
        await Promise.all([
          this.favoritesRepository.updateDetectedTitles(detected),
          settings.folders.enabled
            ? this.foldersRepository.updateDetectedTitles(detected)
            : Promise.resolve(false),
        ]);
      }
      const [favorites, folders, memberships, folderChatNameDisplayOverrides] = await Promise.all([
        this.favoritesRepository.list(),
        settings.folders.enabled ? this.foldersRepository.listFolders() : Promise.resolve([]),
        settings.folders.enabled ? this.foldersRepository.listMembership() : Promise.resolve([]),
        settings.folders.enabled
          ? this.folderDisplayOverridesRepository.get()
          : Promise.resolve({}),
      ]);
      const displaySettings: WolfExpansionSettings = {
        ...settings,
        folders: { ...settings.folders, chatNameDisplayOverrides: folderChatNameDisplayOverrides },
      };
      const displayFolders = settings.folders.rememberCollapsed
        ? folders
        : folders.map((folder) => ({
            ...folder,
            collapsed: this.transientFolderCollapse.get(folder.id) ?? false,
          }));
      const projection = buildQuickAccessProjection(favorites, displayFolders, memberships, {
        quickAccessEnabled: settings.favorites.enabled,
        foldersEnabled: settings.folders.enabled,
        globalItemNameDisplay: settings.favorites.itemNameDisplay,
        folderChatNameDisplayOverrides,
      });
      const currentId = this.adapter.getCurrentConversationId();
      if (!this.enabled || !this.refreshCoordinator.isLatest(work.generation)) {
        this.logger.debug("Quick Access render deferred for a newer refresh generation.", {
          generation: work.generation,
        });
        return;
      }
      this.sidebar.render(projection, displaySettings, this.collapsed, currentId);
      this.sidebar.syncNativeRows(
        references,
        new Set(favorites.map((favorite) => favorite.conversationId)),
        settings.favorites.showIcon,
        settings.folders.enabled,
      );
      this.logProjectedTitleDiagnostics(
        diagnosticConversationIds,
        favorites,
        memberships,
        projection,
      );
    } catch (error) {
      this.logger.warn("Quick Access could not refresh; stored organization was untouched.", error);
    }
  }

  private async logDetectedTitleDiagnostics(
    references: readonly ConversationReference[],
    detected: ReadonlyMap<string, DetectedConversationMetadata>,
    settings: WolfExpansionSettings,
  ): Promise<Set<string>> {
    if (!settings.debug.enabled) {
      return new Set();
    }
    const [favorites, memberships] = await Promise.all([
      this.favoritesRepository.list(),
      settings.folders.enabled
        ? this.foldersRepository.listMembership()
        : Promise.resolve([]),
    ]);
    const favoriteTitles = new Map(
      favorites.map((favorite) => [favorite.conversationId, favorite.title]),
    );
    const membershipTitles = new Map(
      memberships.map((membership) => [membership.conversationId, membership.title]),
    );
    const changedIds = new Set<string>();
    for (const reference of references) {
      const favoriteTitle = favoriteTitles.get(reference.conversationId);
      const membershipTitle = membershipTitles.get(reference.conversationId);
      if (
        (favoriteTitle === undefined && membershipTitle === undefined) ||
        (reference.title === favoriteTitle &&
          (membershipTitle === undefined || reference.title === membershipTitle))
      ) {
        continue;
      }
      changedIds.add(reference.conversationId);
      this.logger.debug("Live title extraction candidate.", {
        conversationId: reference.conversationId,
        visibleText: reference.titleDiagnostics.visibleText,
        textContentFallback: reference.titleDiagnostics.textContentFallback,
        ariaLabel: reference.titleDiagnostics.ariaLabel,
        titleAttribute: reference.titleDiagnostics.titleAttribute,
        normalizedTitle: reference.titleDiagnostics.normalizedTitle,
        selectedSource: reference.titleDiagnostics.selectedSource,
        detectedTitle: detected.get(reference.conversationId)?.title ?? null,
        storedFavoriteTitle: favoriteTitle ?? null,
        storedFolderMembershipTitle: membershipTitle ?? null,
      });
    }
    return changedIds;
  }

  private logProjectedTitleDiagnostics(
    conversationIds: ReadonlySet<string>,
    favorites: readonly { conversationId: string; title: string }[],
    memberships: readonly { conversationId: string; title: string }[],
    projection: ReturnType<typeof buildQuickAccessProjection>,
  ): void {
    if (conversationIds.size === 0) {
      return;
    }
    const favoriteTitles = new Map(
      favorites.map((favorite) => [favorite.conversationId, favorite.title]),
    );
    const membershipTitles = new Map(
      memberships.map((membership) => [membership.conversationId, membership.title]),
    );
    const projectedTitles = collectProjectedTitles(projection);
    for (const conversationId of conversationIds) {
      this.logger.debug("Live title reconciliation completed.", {
        conversationId,
        storedFavoriteTitle: favoriteTitles.get(conversationId) ?? null,
        storedFolderMembershipTitle: membershipTitles.get(conversationId) ?? null,
        finalProjectionTitle: projectedTitles.get(conversationId) ?? null,
      });
    }
  }
}

function collectProjectedTitles(
  projection: ReturnType<typeof buildQuickAccessProjection>,
): Map<string, string> {
  const titles = new Map(
    projection.looseChats.map((chat) => [chat.conversationId, chat.title]),
  );
  const visit = (folders: typeof projection.folders): void => {
    for (const folder of folders) {
      for (const chat of folder.chats) {
        titles.set(chat.conversationId, chat.title);
      }
      visit(folder.folders);
    }
  };
  visit(projection.folders);
  return titles;
}
