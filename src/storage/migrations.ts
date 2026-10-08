import { DEFAULT_SETTINGS } from "../settings/defaults";
import { parseConversationUrl } from "../adapters/chatgpt/conversationUrl";
import { pruneFolderChatNameDisplayOverrides } from "../settings/folderDisplayMode";
import {
  STORAGE_KEYS,
  STORAGE_SCHEMA_VERSION,
  type FavoriteConversation,
  type FavoritesUiState,
  type FolderConversationMembership,
  type FolderRecord,
  type FoldersUiState,
  type QuickAccessUiState,
  type LegacyAccountData,
  type WolfExpansionSettings,
} from "./schemas";
import type { KeyValueStorage } from "./StorageService";

const DEFAULT_UI_STATE: FavoritesUiState = { collapsed: false };
const DEFAULT_FOLDERS_UI_STATE: FoldersUiState = { collapsed: false };
const DEFAULT_QUICK_ACCESS_UI_STATE: QuickAccessUiState = { collapsed: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeFolderChatNameDisplayOverrides(
  value: unknown,
): Record<string, "compact" | "full"> {
  if (!isRecord(value)) {
    return {};
  }
  const normalized: Record<string, "compact" | "full"> = {};
  for (const [folderId, mode] of Object.entries(value)) {
    const normalizedFolderId = folderId.trim();
    if (normalizedFolderId && (mode === "compact" || mode === "full")) {
      normalized[normalizedFolderId] = mode;
    }
  }
  return normalized;
}

export async function migrateStorage(storage: KeyValueStorage): Promise<void> {
  const rawSchemaVersion = await storage.get<unknown>(STORAGE_KEYS.schemaVersion, undefined);
  const rawSettings = await storage.get<unknown>(STORAGE_KEYS.settings, undefined);
  let settings = normalizeSettings(rawSettings);
  const rawFavorites = await storage.get<unknown>(STORAGE_KEYS.favorites, []);
  const favorites = normalizeFavorites(rawFavorites);
  const rawUiState = await storage.get<unknown>(STORAGE_KEYS.uiState, DEFAULT_UI_STATE);
  const uiState = normalizeUiState(rawUiState);
  const rawFolders = await storage.get<unknown>(STORAGE_KEYS.folders, []);
  const folders = normalizeFolders(rawFolders);
  settings = {
    ...settings,
    folders: {
      ...settings.folders,
      chatNameDisplayOverrides: pruneFolderChatNameDisplayOverrides(
        settings.folders.chatNameDisplayOverrides,
        new Set(folders.map((folder) => folder.id)),
      ),
    },
  };
  const rawFolderMembership = await storage.get<unknown>(STORAGE_KEYS.folderMembership, []);
  const folderMembership = normalizeFolderMembership(
    rawFolderMembership,
    new Set(folders.map((folder) => folder.id)),
  );
  const rawFoldersUiState = await storage.get<unknown>(
    STORAGE_KEYS.foldersUiState,
    DEFAULT_FOLDERS_UI_STATE,
  );
  const foldersUiState = normalizeFoldersUiState(rawFoldersUiState);
  const rawQuickAccessUiState = await storage.get<unknown>(
    STORAGE_KEYS.quickAccessUiState,
    undefined,
  );
  const quickAccessUiState = rawQuickAccessUiState === undefined
    ? {
        collapsed: settings.favorites.enabled
          ? uiState.collapsed
          : foldersUiState.collapsed,
      }
    : normalizeQuickAccessUiState(rawQuickAccessUiState);

  const rawLegacyAccountData = await storage.get<unknown>(
    STORAGE_KEYS.legacyAccountData,
    undefined,
  );
  const normalizedExistingLegacyAccountData = normalizeLegacyAccountData(rawLegacyAccountData);
  const legacyFolderChatNameDisplayOverrides = {
    ...settings.folders.chatNameDisplayOverrides,
  };
  const shouldPreserveLegacyAccountData =
    rawLegacyAccountData === undefined &&
    (favorites.length > 0 || folders.length > 0 || folderMembership.length > 0 ||
      Object.keys(legacyFolderChatNameDisplayOverrides).length > 0 ||
      uiState.collapsed || foldersUiState.collapsed || quickAccessUiState.collapsed);
  const legacyAccountData: LegacyAccountData | undefined =
    shouldPreserveLegacyAccountData
      ? {
          preservedAt: Date.now(),
          sourceSchemaVersion: typeof rawSchemaVersion === "number" ? rawSchemaVersion : null,
          claimedToScopeId: null,
          claimedAt: null,
          claimedIdentityVersion: null,
          stableScopeMigration: null,
          favorites,
          uiState,
          folders,
          folderMembership,
          foldersUiState,
          quickAccessUiState,
          folderChatNameDisplayOverrides: legacyFolderChatNameDisplayOverrides,
        }
      : normalizedExistingLegacyAccountData ?? undefined;
  if (Object.keys(legacyFolderChatNameDisplayOverrides).length > 0) {
    settings = {
      ...settings,
      folders: { ...settings.folders, chatNameDisplayOverrides: {} },
    };
  }

  const changes: Record<string, unknown> = {};
  if (rawSchemaVersion !== STORAGE_SCHEMA_VERSION) {
    changes[STORAGE_KEYS.schemaVersion] = STORAGE_SCHEMA_VERSION;
  }
  if (JSON.stringify(rawSettings) !== JSON.stringify(settings)) {
    changes[STORAGE_KEYS.settings] = settings;
  }
  if (JSON.stringify(rawFavorites) !== JSON.stringify(favorites)) {
    changes[STORAGE_KEYS.favorites] = favorites;
  }
  if (JSON.stringify(rawUiState) !== JSON.stringify(uiState)) {
    changes[STORAGE_KEYS.uiState] = uiState;
  }
  if (JSON.stringify(rawFolders) !== JSON.stringify(folders)) {
    changes[STORAGE_KEYS.folders] = folders;
  }
  if (JSON.stringify(rawFolderMembership) !== JSON.stringify(folderMembership)) {
    changes[STORAGE_KEYS.folderMembership] = folderMembership;
  }
  if (JSON.stringify(rawFoldersUiState) !== JSON.stringify(foldersUiState)) {
    changes[STORAGE_KEYS.foldersUiState] = foldersUiState;
  }
  if (JSON.stringify(rawQuickAccessUiState) !== JSON.stringify(quickAccessUiState)) {
    changes[STORAGE_KEYS.quickAccessUiState] = quickAccessUiState;
  }
  if (
    legacyAccountData &&
    JSON.stringify(rawLegacyAccountData) !== JSON.stringify(legacyAccountData)
  ) {
    changes[STORAGE_KEYS.legacyAccountData] = legacyAccountData;
  }

  if (Object.keys(changes).length > 0) {
    await storage.setMany(changes);
  }

  if ("getAll" in storage && typeof storage.getAll === "function") {
    const allValues = await (storage as KeyValueStorage & {
      getAll(): Promise<Record<string, unknown>>;
    }).getAll();
    const scopedChanges: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(allValues)) {
      if (/^wolfExpansion\.accounts\.sha256-[0-9a-f]{64}\.favorites$/u.test(key)) {
        const normalized = normalizeFavorites(value);
        if (JSON.stringify(value) !== JSON.stringify(normalized)) {
          scopedChanges[key] = normalized;
        }
      } else if (/^wolfExpansion\.accounts\.sha256-[0-9a-f]{64}\.folderMembership$/u.test(key)) {
        const prefix = key.slice(0, -"folderMembership".length);
        const folders = normalizeFolders(allValues[`${prefix}folders`]);
        const normalized = normalizeFolderMembership(
          value,
          new Set(folders.map((folder) => folder.id)),
        );
        if (JSON.stringify(value) !== JSON.stringify(normalized)) {
          scopedChanges[key] = normalized;
        }
      }
    }
    if (Object.keys(scopedChanges).length > 0) {
      await storage.setMany(scopedChanges);
    }
  }
}

export function normalizeLegacyAccountData(value: unknown): LegacyAccountData | null {
  if (!isRecord(value)) {
    return null;
  }
  const folders = normalizeFolders(value.folders);
  const claimedToScopeId = typeof value.claimedToScopeId === "string" &&
      value.claimedToScopeId.trim()
    ? value.claimedToScopeId.trim()
    : null;
  const stableScopeMigrationValue = isRecord(value.stableScopeMigration)
    ? value.stableScopeMigration
    : null;
  const sourceScopeId = typeof stableScopeMigrationValue?.sourceScopeId === "string"
    ? stableScopeMigrationValue.sourceScopeId.trim()
    : "";
  const destinationScopeId = typeof stableScopeMigrationValue?.destinationScopeId === "string"
    ? stableScopeMigrationValue.destinationScopeId.trim()
    : "";
  const stableScopeMigration = sourceScopeId && destinationScopeId &&
      typeof stableScopeMigrationValue?.migratedAt === "number"
    ? {
        sourceScopeId,
        destinationScopeId,
        migratedAt: stableScopeMigrationValue.migratedAt,
      }
    : null;
  const claimedIdentityVersion = value.claimedIdentityVersion === "stable-user-id"
    ? "stable-user-id"
    : value.claimedIdentityVersion === "legacy-profile" || claimedToScopeId
      ? "legacy-profile"
      : null;
  return {
    preservedAt: typeof value.preservedAt === "number" ? value.preservedAt : 0,
    sourceSchemaVersion: typeof value.sourceSchemaVersion === "number"
      ? value.sourceSchemaVersion
      : null,
    claimedToScopeId,
    claimedAt: claimedToScopeId && typeof value.claimedAt === "number"
      ? value.claimedAt
      : null,
    claimedIdentityVersion,
    stableScopeMigration,
    favorites: normalizeFavorites(value.favorites),
    uiState: normalizeUiState(value.uiState),
    folders,
    folderMembership: normalizeFolderMembership(
      value.folderMembership,
      new Set(folders.map((folder) => folder.id)),
    ),
    foldersUiState: normalizeFoldersUiState(value.foldersUiState),
    quickAccessUiState: normalizeQuickAccessUiState(value.quickAccessUiState),
    folderChatNameDisplayOverrides: pruneFolderChatNameDisplayOverrides(
      normalizeFolderChatNameDisplayOverrides(value.folderChatNameDisplayOverrides),
      new Set(folders.map((folder) => folder.id)),
    ),
  };
}

export function hasLegacyOrganizationData(legacy: LegacyAccountData): boolean {
  return legacy.favorites.length > 0 ||
    legacy.folders.length > 0 ||
    legacy.folderMembership.length > 0 ||
    Object.keys(legacy.folderChatNameDisplayOverrides).length > 0 ||
    legacy.uiState.collapsed ||
    legacy.foldersUiState.collapsed ||
    legacy.quickAccessUiState.collapsed;
}

export function normalizeSettings(value: unknown): WolfExpansionSettings {
  const root = isRecord(value) ? value : {};
  const debug = isRecord(root.debug) ? root.debug : {};
  const favorites = isRecord(root.favorites) ? root.favorites : {};
  const folders = isRecord(root.folders) ? root.folders : {};

  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    enabled: readBoolean(root.enabled, DEFAULT_SETTINGS.enabled),
    debug: {
      enabled: readBoolean(
        debug.enabled,
        readBoolean(root.debugLogging, DEFAULT_SETTINGS.debug.enabled),
      ),
    },
    favorites: {
      enabled: readBoolean(favorites.enabled, DEFAULT_SETTINGS.favorites.enabled),
      showIcon: readBoolean(favorites.showIcon, DEFAULT_SETTINGS.favorites.showIcon),
      rememberCollapsed: readBoolean(
        favorites.rememberCollapsed,
        DEFAULT_SETTINGS.favorites.rememberCollapsed,
      ),
      itemNameDisplay: favorites.itemNameDisplay === "full" ? "full" : "compact",
    },
    folders: {
      enabled: readBoolean(folders.enabled, DEFAULT_SETTINGS.folders.enabled),
      rememberCollapsed: readBoolean(
        folders.rememberCollapsed,
        DEFAULT_SETTINGS.folders.rememberCollapsed,
      ),
      showIcons: readBoolean(folders.showIcons, DEFAULT_SETTINGS.folders.showIcons),
      chatNameDisplayOverrides: normalizeFolderChatNameDisplayOverrides(
        folders.chatNameDisplayOverrides,
      ),
    },
  };
}

export function normalizeFavorites(value: unknown): FavoriteConversation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set<string>();
  const favorites: FavoriteConversation[] = [];

  for (const item of value) {
    if (!isRecord(item) || typeof item.conversationId !== "string") {
      continue;
    }

    const conversationId = item.conversationId.trim();
    if (!conversationId || seenIds.has(conversationId)) {
      continue;
    }

    const identity = normalizeStoredConversationLocation(item, conversationId);
    if (!identity) {
      continue;
    }

    const title = typeof item.title === "string" && item.title.trim()
      ? item.title.trim()
      : "Untitled conversation";
    seenIds.add(conversationId);
    favorites.push({
      conversationId,
      route: identity.route,
      title,
      url: identity.url,
      addedAt: typeof item.addedAt === "number" ? item.addedAt : Date.now(),
      sortIndex: typeof item.sortIndex === "number" ? item.sortIndex : favorites.length,
    });
  }

  return favorites
    .sort((left, right) => left.sortIndex - right.sortIndex || left.addedAt - right.addedAt)
    .map((favorite, sortIndex) => ({ ...favorite, sortIndex }));
}

export function normalizeUiState(value: unknown): FavoritesUiState {
  const state = isRecord(value) ? value : {};
  return { collapsed: readBoolean(state.collapsed, DEFAULT_UI_STATE.collapsed) };
}

export function normalizeFolders(value: unknown): FolderRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const folders: FolderRecord[] = [];
  const seenIds = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") {
      continue;
    }
    const id = item.id.trim();
    const name = item.name.trim();
    if (!id || !name || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    folders.push({
      id,
      name: name.slice(0, 100),
      parentId: typeof item.parentId === "string" && item.parentId.trim()
        ? item.parentId.trim()
        : null,
      sortIndex: typeof item.sortIndex === "number" ? item.sortIndex : folders.length,
      createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
      collapsed: readBoolean(item.collapsed, false),
    });
  }

  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  for (const folder of folders) {
    if (folder.parentId === folder.id || (folder.parentId && !byId.has(folder.parentId))) {
      folder.parentId = null;
    }
  }
  for (const folder of folders) {
    const visited = new Set([folder.id]);
    let parentId = folder.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        folder.parentId = null;
        break;
      }
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }

  return normalizeFolderSiblingIndexes(folders);
}

export function normalizeFolderMembership(
  value: unknown,
  validFolderIds?: ReadonlySet<string>,
): FolderConversationMembership[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const memberships: FolderConversationMembership[] = [];
  const seenConversationIds = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.conversationId !== "string" ||
      typeof item.folderId !== "string"
    ) {
      continue;
    }
    const conversationId = item.conversationId.trim();
    const folderId = item.folderId.trim();
    if (
      !conversationId ||
      !folderId ||
      seenConversationIds.has(conversationId) ||
      (validFolderIds && !validFolderIds.has(folderId))
    ) {
      continue;
    }
    const identity = normalizeStoredConversationLocation(item, conversationId);
    if (!identity) {
      continue;
    }
    const title = typeof item.title === "string" && item.title.trim()
      ? item.title.trim()
      : "Untitled conversation";
    seenConversationIds.add(conversationId);
    memberships.push({
      conversationId,
      route: identity.route,
      folderId,
      title,
      url: identity.url,
      assignedAt: typeof item.assignedAt === "number" ? item.assignedAt : Date.now(),
      sortIndex: typeof item.sortIndex === "number" ? item.sortIndex : memberships.length,
    });
  }

  return normalizeMembershipIndexes(memberships);
}

function normalizeStoredConversationLocation(
  item: Record<string, unknown>,
  conversationId: string,
): { route: "c" | "g"; url: string } | null {
  if (typeof item.url !== "string") {
    return null;
  }
  const parsed = parseConversationUrl(item.url);
  if (!parsed || parsed.conversationId !== conversationId) {
    return null;
  }
  if (item.route !== undefined && item.route !== parsed.route) {
    return null;
  }
  return {
    route: parsed.route,
    url: parsed.canonicalUrl,
  };
}

export function normalizeFoldersUiState(value: unknown): FoldersUiState {
  const state = isRecord(value) ? value : {};
  return { collapsed: readBoolean(state.collapsed, DEFAULT_FOLDERS_UI_STATE.collapsed) };
}

export function normalizeQuickAccessUiState(value: unknown): QuickAccessUiState {
  const state = isRecord(value) ? value : {};
  return { collapsed: readBoolean(state.collapsed, DEFAULT_QUICK_ACCESS_UI_STATE.collapsed) };
}

function normalizeFolderSiblingIndexes(folders: FolderRecord[]): FolderRecord[] {
  const groups = new Map<string | null, FolderRecord[]>();
  for (const folder of folders) {
    const siblings = groups.get(folder.parentId) ?? [];
    siblings.push(folder);
    groups.set(folder.parentId, siblings);
  }
  for (const siblings of groups.values()) {
    siblings
      .sort((left, right) => left.sortIndex - right.sortIndex || left.createdAt - right.createdAt)
      .forEach((folder, sortIndex) => {
        folder.sortIndex = sortIndex;
      });
  }
  return folders;
}

function normalizeMembershipIndexes(
  memberships: FolderConversationMembership[],
): FolderConversationMembership[] {
  const groups = new Map<string, FolderConversationMembership[]>();
  for (const membership of memberships) {
    const contents = groups.get(membership.folderId) ?? [];
    contents.push(membership);
    groups.set(membership.folderId, contents);
  }
  for (const contents of groups.values()) {
    contents
      .sort((left, right) => left.sortIndex - right.sortIndex || left.assignedAt - right.assignedAt)
      .forEach((membership, sortIndex) => {
        membership.sortIndex = sortIndex;
      });
  }
  return memberships;
}
