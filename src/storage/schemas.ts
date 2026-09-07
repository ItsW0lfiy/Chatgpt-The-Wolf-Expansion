export const STORAGE_SCHEMA_VERSION = 8;

export type ItemNameDisplayMode = "compact" | "full";

export const STORAGE_KEYS = {
  schemaVersion: "wolfExpansion.schemaVersion",
  settings: "wolfExpansion.settings",
  favorites: "wolfExpansion.favorites",
  uiState: "wolfExpansion.uiState",
  folders: "wolfExpansion.folders",
  folderMembership: "wolfExpansion.folderMembership",
  foldersUiState: "wolfExpansion.foldersUiState",
  quickAccessUiState: "wolfExpansion.quickAccessUiState",
  folderChatNameDisplayOverrides: "wolfExpansion.folderChatNameDisplayOverrides",
  legacyAccountData: "wolfExpansion.legacyAccountData",
} as const;

export interface FavoriteConversation {
  conversationId: string;
  title: string;
  url: string;
  addedAt: number;
  sortIndex: number;
}

export interface FavoritesUiState {
  collapsed: boolean;
}

export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  sortIndex: number;
  createdAt: number;
  collapsed: boolean;
}

export interface FolderConversationMembership {
  conversationId: string;
  folderId: string;
  title: string;
  url: string;
  assignedAt: number;
  sortIndex: number;
}

export interface FoldersUiState {
  collapsed: boolean;
}

export interface QuickAccessUiState {
  collapsed: boolean;
}

export interface LegacyAccountData {
  preservedAt: number;
  sourceSchemaVersion: number | null;
  claimedToScopeId: string | null;
  claimedAt: number | null;
  claimedIdentityVersion: "legacy-profile" | "stable-user-id" | null;
  stableScopeMigration: {
    sourceScopeId: string;
    destinationScopeId: string;
    migratedAt: number;
  } | null;
  favorites: FavoriteConversation[];
  uiState: FavoritesUiState;
  folders: FolderRecord[];
  folderMembership: FolderConversationMembership[];
  foldersUiState: FoldersUiState;
  quickAccessUiState: QuickAccessUiState;
  folderChatNameDisplayOverrides: Record<string, ItemNameDisplayMode>;
}

export interface WolfExpansionSettings {
  schemaVersion: number;
  enabled: boolean;
  debug: {
    enabled: boolean;
  };
  favorites: {
    enabled: boolean;
    showIcon: boolean;
    rememberCollapsed: boolean;
    itemNameDisplay: ItemNameDisplayMode;
  };
  folders: {
    enabled: boolean;
    rememberCollapsed: boolean;
    showIcons: boolean;
    chatNameDisplayOverrides: Record<string, ItemNameDisplayMode>;
  };
}
