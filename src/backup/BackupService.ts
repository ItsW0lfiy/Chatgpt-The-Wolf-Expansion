import {
  ACCOUNT_OWNED_STORAGE_KEYS,
  getAccountScopedStorageKey,
  parseAccountScopedStorageKey,
} from "../storage/AccountScopedStorage";
import {
  normalizeFavorites,
  normalizeFolderChatNameDisplayOverrides,
  normalizeFolderMembership,
  normalizeFolders,
  normalizeFoldersUiState,
  normalizeLegacyAccountData,
  normalizeQuickAccessUiState,
  normalizeSettings,
  normalizeUiState,
} from "../storage/migrations";
import {
  STORAGE_KEYS,
  STORAGE_SCHEMA_VERSION,
  type FavoriteConversation,
  type FavoritesUiState,
  type FolderConversationMembership,
  type FolderRecord,
  type FoldersUiState,
  type ItemNameDisplayMode,
  type LegacyAccountData,
  type QuickAccessUiState,
  type WolfExpansionSettings,
} from "../storage/schemas";
import type { StorageSnapshotService } from "../storage/StorageService";

export const BACKUP_FORMAT = "chatgpt-the-wolf-expansion-backup";
export const BACKUP_FORMAT_VERSION = 1;

export interface AccountBackupData {
  favorites: FavoriteConversation[];
  uiState: FavoritesUiState;
  folders: FolderRecord[];
  folderMembership: FolderConversationMembership[];
  foldersUiState: FoldersUiState;
  quickAccessUiState: QuickAccessUiState;
  folderChatNameDisplayOverrides: Record<string, ItemNameDisplayMode>;
}

export interface WolfBackupEnvelope {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  createdAt: string;
  wolfExpansionVersion: string;
  schemaVersion: number;
  data: {
    settings: WolfExpansionSettings;
    legacyAccountData: LegacyAccountData | null;
    legacyUnscoped: AccountBackupData;
    lastBackupAt: number;
    accounts: Array<{ scopeId: string; values: AccountBackupData }>;
  };
  integrity: {
    algorithm: "SHA-256";
    value: string;
  };
}

export interface StorageHealthSummary {
  schemaVersion: number;
  knownAccountScopes: number;
  activeScopeAvailable: boolean;
  activeFavorites: number;
  activeFolders: number;
  activeMemberships: number;
  lastBackupAt: number | null;
}

export class BackupValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BackupValidationError";
  }
}

export class BackupService {
  public constructor(
    private readonly storage: StorageSnapshotService,
    private readonly wolfExpansionVersion: string,
  ) {}

  public async createBackup(): Promise<{ envelope: WolfBackupEnvelope; json: string }> {
    const createdAt = Date.now();
    const values = await this.storage.getAll();
    const data = readBackupData(values, createdAt);
    const unsigned = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: new Date(createdAt).toISOString(),
      wolfExpansionVersion: this.wolfExpansionVersion,
      schemaVersion: STORAGE_SCHEMA_VERSION,
      data,
    } as const;
    const envelope: WolfBackupEnvelope = {
      ...unsigned,
      integrity: {
        algorithm: "SHA-256",
        value: await sha256(canonicalStringify(unsigned)),
      },
    };
    await this.storage.set(STORAGE_KEYS.lastBackupAt, createdAt);
    return { envelope, json: `${canonicalStringify(envelope)}\n` };
  }

  public async restoreBackup(json: string): Promise<WolfBackupEnvelope> {
    const envelope = await parseAndValidateBackup(json);
    const importedValues = backupToStorageValues(envelope);
    const previousAllWolfValues = filterWolfStorage(await this.storage.getAll(), true);
    const previousValues = filterWolfStorage(previousAllWolfValues);
    const safetySnapshot = {
      createdAt: Date.now(),
      values: previousValues,
    };
    const importedKeys = new Set(Object.keys(importedValues));
    const staleKeys = Object.keys(previousValues).filter(
      (key) => key !== STORAGE_KEYS.preRestoreSafetySnapshot && !importedKeys.has(key),
    );
    try {
      await this.storage.set(STORAGE_KEYS.preRestoreSafetySnapshot, safetySnapshot);
      await this.storage.setMany(importedValues);
      await this.storage.removeMany(staleKeys);
    } catch (error) {
      const current = filterWolfStorage(await this.storage.getAll(), true);
      const rollbackRemovals = Object.keys(current).filter(
        (key) => !Object.hasOwn(previousAllWolfValues, key),
      );
      await this.storage.setMany(previousAllWolfValues);
      await this.storage.removeMany(rollbackRemovals);
      throw error;
    }
    return envelope;
  }

  public async getStorageHealth(activeScopeId: string | null): Promise<StorageHealthSummary> {
    const values = await this.storage.getAll();
    const scopeIds = new Set<string>();
    for (const key of Object.keys(values)) {
      const parsed = parseAccountScopedStorageKey(key);
      if (parsed) {
        scopeIds.add(parsed.scopeId);
      }
    }
    const active = activeScopeId ? readAccountData(values, activeScopeId) : null;
    const lastBackupAt = values[STORAGE_KEYS.lastBackupAt];
    return {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      knownAccountScopes: scopeIds.size,
      activeScopeAvailable: activeScopeId !== null,
      activeFavorites: active?.favorites.length ?? 0,
      activeFolders: active?.folders.length ?? 0,
      activeMemberships: active?.folderMembership.length ?? 0,
      lastBackupAt: typeof lastBackupAt === "number" && Number.isFinite(lastBackupAt)
        ? lastBackupAt
        : null,
    };
  }
}

export async function parseAndValidateBackup(json: string): Promise<WolfBackupEnvelope> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new BackupValidationError("The selected file is not valid JSON.");
  }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) {
    throw new BackupValidationError("This is not a Wolf Expansion backup file.");
  }
  if (raw.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupValidationError(
      typeof raw.formatVersion === "number" && raw.formatVersion > BACKUP_FORMAT_VERSION
        ? "This backup was created by a newer unsupported backup format."
        : "This backup format version is unsupported.",
    );
  }
  if (
    typeof raw.createdAt !== "string" || Number.isNaN(Date.parse(raw.createdAt)) ||
    typeof raw.wolfExpansionVersion !== "string" || !raw.wolfExpansionVersion.trim() ||
    typeof raw.schemaVersion !== "number" || !Number.isInteger(raw.schemaVersion) ||
    raw.schemaVersion < 1 || raw.schemaVersion > STORAGE_SCHEMA_VERSION ||
    !isRecord(raw.data) || !isRecord(raw.integrity) ||
    raw.integrity.algorithm !== "SHA-256" || typeof raw.integrity.value !== "string"
  ) {
    throw new BackupValidationError("The backup header is malformed or incompatible.");
  }
  const unsigned = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: raw.createdAt,
    wolfExpansionVersion: raw.wolfExpansionVersion,
    schemaVersion: raw.schemaVersion,
    data: raw.data,
  } as const;
  const expectedHash = await sha256(canonicalStringify(unsigned));
  if (raw.integrity.value !== expectedHash) {
    throw new BackupValidationError("Backup integrity verification failed.");
  }
  const data = validateBackupData(raw.data, raw.schemaVersion);
  return {
    ...unsigned,
    data,
    integrity: { algorithm: "SHA-256", value: expectedHash },
  };
}

function readBackupData(values: Record<string, unknown>, lastBackupAt: number): WolfBackupEnvelope["data"] {
  const scopeIds = new Set<string>();
  for (const key of Object.keys(values)) {
    const parsed = parseAccountScopedStorageKey(key);
    if (parsed) {
      scopeIds.add(parsed.scopeId);
    }
  }
  return {
    settings: normalizeSettings(values[STORAGE_KEYS.settings]),
    legacyAccountData: normalizeLegacyAccountData(values[STORAGE_KEYS.legacyAccountData]),
    legacyUnscoped: readAccountDataFromKeys(values, (logicalKey) => logicalKey),
    lastBackupAt,
    accounts: [...scopeIds]
      .sort()
      .map((scopeId) => ({ scopeId, values: readAccountData(values, scopeId) })),
  };
}

function readAccountData(values: Record<string, unknown>, scopeId: string): AccountBackupData {
  return readAccountDataFromKeys(
    values,
    (logicalKey) => getAccountScopedStorageKey(scopeId, logicalKey),
  );
}

function readAccountDataFromKeys(
  values: Record<string, unknown>,
  getKey: (logicalKey: (typeof ACCOUNT_OWNED_STORAGE_KEYS)[number]) => string,
): AccountBackupData {
  const folders = normalizeFolders(
    values[getKey(STORAGE_KEYS.folders)],
  );
  const folderIds = new Set(folders.map((folder) => folder.id));
  return {
    favorites: normalizeFavorites(
      values[getKey(STORAGE_KEYS.favorites)],
    ),
    uiState: normalizeUiState(
      values[getKey(STORAGE_KEYS.uiState)],
    ),
    folders,
    folderMembership: normalizeFolderMembership(
      values[getKey(STORAGE_KEYS.folderMembership)],
      folderIds,
    ),
    foldersUiState: normalizeFoldersUiState(
      values[getKey(STORAGE_KEYS.foldersUiState)],
    ),
    quickAccessUiState: normalizeQuickAccessUiState(
      values[getKey(STORAGE_KEYS.quickAccessUiState)],
    ),
    folderChatNameDisplayOverrides: Object.fromEntries(
      Object.entries(normalizeFolderChatNameDisplayOverrides(
        values[getKey(STORAGE_KEYS.folderChatNameDisplayOverrides)],
      )).filter(([folderId]) => folderIds.has(folderId)),
    ),
  };
}

function validateBackupData(value: Record<string, unknown>, schemaVersion: number): WolfBackupEnvelope["data"] {
  if (
    !isValidSettings(value.settings) ||
    !Array.isArray(value.accounts) || !isRecord(value.legacyUnscoped) ||
    typeof value.lastBackupAt !== "number" || !Number.isFinite(value.lastBackupAt)
  ) {
    throw new BackupValidationError("The backup data structure is incomplete.");
  }
  const legacyAccountData = value.legacyAccountData === null
    ? null
    : normalizeLegacyAccountData(value.legacyAccountData);
  if (value.legacyAccountData !== null && !legacyAccountData) {
    throw new BackupValidationError("Legacy recovery metadata is malformed.");
  }
  const seenScopes = new Set<string>();
  const accounts = value.accounts.map((entry) => {
    if (!isRecord(entry) || !isOpaqueScopeId(entry.scopeId) || !isRecord(entry.values)) {
      throw new BackupValidationError("An account namespace is malformed.");
    }
    if (seenScopes.has(entry.scopeId)) {
      throw new BackupValidationError("The backup contains a duplicate account namespace.");
    }
    seenScopes.add(entry.scopeId);
    return { scopeId: entry.scopeId, values: validateAccountData(entry.values, schemaVersion) };
  });
  return {
    settings: normalizeSettings(value.settings),
    legacyAccountData,
    legacyUnscoped: validateAccountData(value.legacyUnscoped, schemaVersion),
    lastBackupAt: value.lastBackupAt,
    accounts,
  };
}

function validateAccountData(value: Record<string, unknown>, schemaVersion: number): AccountBackupData {
  for (const key of [
    "favorites",
    "uiState",
    "folders",
    "folderMembership",
    "foldersUiState",
    "quickAccessUiState",
    "folderChatNameDisplayOverrides",
  ]) {
    if (!Object.hasOwn(value, key)) {
      throw new BackupValidationError(`Account data is missing ${key}.`);
    }
  }
  if (!Array.isArray(value.favorites) || !Array.isArray(value.folders) ||
    !Array.isArray(value.folderMembership) || !isRecord(value.uiState) ||
    !isRecord(value.foldersUiState) || !isRecord(value.quickAccessUiState) ||
    !isRecord(value.folderChatNameDisplayOverrides)) {
    throw new BackupValidationError("An account data record has invalid field types.");
  }
  if (
    typeof value.uiState.collapsed !== "boolean" ||
    typeof value.foldersUiState.collapsed !== "boolean" ||
    typeof value.quickAccessUiState.collapsed !== "boolean" ||
    Object.values(value.folderChatNameDisplayOverrides).some(
      (mode) => mode !== "compact" && mode !== "full",
    )
  ) {
    throw new BackupValidationError("An account data record has invalid UI state.");
  }
  const favorites = normalizeFavorites(value.favorites);
  const folders = normalizeFolders(value.folders);
  const memberships = normalizeFolderMembership(
    value.folderMembership,
    new Set(folders.map((folder) => folder.id)),
  );
  if (
    favorites.length !== value.favorites.length ||
    folders.length !== value.folders.length ||
    memberships.length !== value.folderMembership.length
  ) {
    throw new BackupValidationError("The backup contains malformed organization records.");
  }
  if (schemaVersion >= 9) {
    const routeMissing = [...value.favorites, ...value.folderMembership].some(
      (item) => !isRecord(item) || (item.route !== "c" && item.route !== "g"),
    );
    if (routeMissing) {
      throw new BackupValidationError("The backup contains invalid conversation route metadata.");
    }
  }
  return {
    favorites,
    uiState: normalizeUiState(value.uiState),
    folders,
    folderMembership: memberships,
    foldersUiState: normalizeFoldersUiState(value.foldersUiState),
    quickAccessUiState: normalizeQuickAccessUiState(value.quickAccessUiState),
    folderChatNameDisplayOverrides: normalizeFolderChatNameDisplayOverrides(
      value.folderChatNameDisplayOverrides,
    ),
  };
}

function backupToStorageValues(envelope: WolfBackupEnvelope): Record<string, unknown> {
  const values: Record<string, unknown> = {
    [STORAGE_KEYS.schemaVersion]: STORAGE_SCHEMA_VERSION,
    [STORAGE_KEYS.settings]: envelope.data.settings,
    [STORAGE_KEYS.lastBackupAt]: envelope.data.lastBackupAt,
  };
  if (envelope.data.legacyAccountData) {
    values[STORAGE_KEYS.legacyAccountData] = envelope.data.legacyAccountData;
  }
  const legacyUnscopedValues: Record<(typeof ACCOUNT_OWNED_STORAGE_KEYS)[number], unknown> = {
    [STORAGE_KEYS.favorites]: envelope.data.legacyUnscoped.favorites,
    [STORAGE_KEYS.uiState]: envelope.data.legacyUnscoped.uiState,
    [STORAGE_KEYS.folders]: envelope.data.legacyUnscoped.folders,
    [STORAGE_KEYS.folderMembership]: envelope.data.legacyUnscoped.folderMembership,
    [STORAGE_KEYS.foldersUiState]: envelope.data.legacyUnscoped.foldersUiState,
    [STORAGE_KEYS.quickAccessUiState]: envelope.data.legacyUnscoped.quickAccessUiState,
    [STORAGE_KEYS.folderChatNameDisplayOverrides]:
      envelope.data.legacyUnscoped.folderChatNameDisplayOverrides,
  };
  for (const logicalKey of ACCOUNT_OWNED_STORAGE_KEYS) {
    values[logicalKey] = legacyUnscopedValues[logicalKey];
  }
  for (const account of envelope.data.accounts) {
    const accountValues: Record<(typeof ACCOUNT_OWNED_STORAGE_KEYS)[number], unknown> = {
      [STORAGE_KEYS.favorites]: account.values.favorites,
      [STORAGE_KEYS.uiState]: account.values.uiState,
      [STORAGE_KEYS.folders]: account.values.folders,
      [STORAGE_KEYS.folderMembership]: account.values.folderMembership,
      [STORAGE_KEYS.foldersUiState]: account.values.foldersUiState,
      [STORAGE_KEYS.quickAccessUiState]: account.values.quickAccessUiState,
      [STORAGE_KEYS.folderChatNameDisplayOverrides]: account.values.folderChatNameDisplayOverrides,
    };
    for (const logicalKey of ACCOUNT_OWNED_STORAGE_KEYS) {
      values[getAccountScopedStorageKey(account.scopeId, logicalKey)] = accountValues[logicalKey];
    }
  }
  return values;
}

function filterWolfStorage(
  values: Record<string, unknown>,
  includeSafetySnapshot = false,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) =>
      key.startsWith("wolfExpansion.") &&
      (includeSafetySnapshot || key !== STORAGE_KEYS.preRestoreSafetySnapshot)),
  );
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isOpaqueScopeId(value: unknown): value is string {
  return typeof value === "string" && /^sha256-[0-9a-f]{64}$/u.test(value);
}

function isValidSettings(value: unknown): value is WolfExpansionSettings {
  if (!isRecord(value) || !isRecord(value.debug) || !isRecord(value.favorites) ||
    !isRecord(value.folders)) {
    return false;
  }
  return Number.isInteger(value.schemaVersion) &&
    typeof value.enabled === "boolean" &&
    typeof value.debug.enabled === "boolean" &&
    (value.compatibility === undefined ||
      (isRecord(value.compatibility) &&
        typeof value.compatibility.navigationFixes === "boolean")) &&
    typeof value.favorites.enabled === "boolean" &&
    typeof value.favorites.showIcon === "boolean" &&
    typeof value.favorites.rememberCollapsed === "boolean" &&
    (value.favorites.itemNameDisplay === "compact" ||
      value.favorites.itemNameDisplay === "full") &&
    typeof value.folders.enabled === "boolean" &&
    typeof value.folders.rememberCollapsed === "boolean" &&
    typeof value.folders.showIcons === "boolean" &&
    isRecord(value.folders.chatNameDisplayOverrides) &&
    Object.values(value.folders.chatNameDisplayOverrides).every(
      (mode) => mode === "compact" || mode === "full",
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
