import assert from "node:assert/strict";
import test from "node:test";
import { FavoritesRepository } from "../src/features/favorites/FavoritesRepository";
import { FoldersRepository } from "../src/features/folders/FoldersRepository";
import { FolderDisplayOverridesRepository } from "../src/features/folders/FolderDisplayOverridesRepository";
import {
  AccountScopedStorage,
  getAccountScopedStorageKey,
} from "../src/storage/AccountScopedStorage";
import { LegacyAccountRecoveryService } from "../src/storage/LegacyAccountRecoveryService";
import { migrateStorage } from "../src/storage/migrations";
import {
  STORAGE_KEYS,
  type FavoriteConversation,
  type LegacyAccountData,
} from "../src/storage/schemas";
import { MemoryStorage } from "./helpers/MemoryStorage";

const ACCOUNT_A = "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ACCOUNT_B = "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OLD_AVATAR_SCOPE = "sha256-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const UNRELATED_SCOPE = "sha256-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

function createLegacyData(): LegacyAccountData {
  const favorites: FavoriteConversation[] = Array.from({ length: 6 }, (_, index) => ({
    conversationId: `legacy-conversation-${index + 1}`,
    route: "c",
    title: `Legacy conversation ${index + 1}`,
    url: `https://chatgpt.com/c/legacy-conversation-${index + 1}`,
    addedAt: index + 1,
    sortIndex: index,
  }));
  return {
    preservedAt: 100,
    sourceSchemaVersion: 6,
    claimedToScopeId: null,
    claimedAt: null,
    claimedIdentityVersion: null,
    stableScopeMigration: null,
    favorites,
    uiState: { collapsed: true },
    folders: [{
      id: "legacy-folder",
      name: "Legacy folder",
      parentId: null,
      sortIndex: 0,
      createdAt: 1,
      collapsed: true,
    }],
    folderMembership: [{
      conversationId: favorites[0]!.conversationId,
      route: "c",
      folderId: "legacy-folder",
      title: favorites[0]!.title,
      url: favorites[0]!.url,
      assignedAt: 1,
      sortIndex: 0,
    }],
    foldersUiState: { collapsed: true },
    quickAccessUiState: { collapsed: true },
    folderChatNameDisplayOverrides: { "legacy-folder": "full" },
  };
}

test("schema 7 claimed data is marked as an old profile-identity scope", async () => {
  const base = new MemoryStorage();
  const {
    claimedIdentityVersion: _missingClaimIdentityVersion,
    stableScopeMigration: _missingStableScopeMigration,
    ...schema7Legacy
  } = {
    ...createLegacyData(),
    claimedToScopeId: OLD_AVATAR_SCOPE,
    claimedAt: 200,
  };
  await base.setMany({
    [STORAGE_KEYS.schemaVersion]: 7,
    [STORAGE_KEYS.legacyAccountData]: schema7Legacy,
  });

  await migrateStorage(base);

  const migrated = await base.get<LegacyAccountData | null>(STORAGE_KEYS.legacyAccountData, null);
  assert.equal(migrated?.claimedIdentityVersion, "legacy-profile");
  assert.equal(migrated?.stableScopeMigration, null);
});

test("explicit restore claims complete legacy organization for the identified empty account", async () => {
  const base = new MemoryStorage();
  const legacy = createLegacyData();
  const {
    claimedToScopeId: _missingClaimScopeInExistingSchema7,
    claimedAt: _missingClaimTimeInExistingSchema7,
    claimedIdentityVersion: _missingClaimIdentityVersionInExistingSchema7,
    stableScopeMigration: _missingStableScopeMigrationInExistingSchema7,
    ...existingSchema7Legacy
  } = legacy;
  await base.set(STORAGE_KEYS.legacyAccountData, existingSchema7Legacy);
  const scoped = new AccountScopedStorage(base);
  scoped.setScope(ACCOUNT_A);
  const favorites = new FavoritesRepository(scoped);
  const folders = new FoldersRepository(scoped);
  const overrides = new FolderDisplayOverridesRepository(scoped);
  const recovery = new LegacyAccountRecoveryService(base, scoped);
  let storageNotifications = 0;
  const unsubscribe = favorites.subscribe(() => {
    storageNotifications += 1;
  });

  assert.deepEqual(await favorites.list(), []);
  assert.deepEqual(await folders.listFolders(), []);
  assert.deepEqual(await recovery.getStatus(), {
    state: "available",
    scopeId: ACCOUNT_A,
    favoriteCount: 6,
    folderCount: 1,
    membershipCount: 1,
  });

  assert.deepEqual(await recovery.restore(ACCOUNT_A), {
    state: "restored",
    favoriteCount: 6,
    folderCount: 1,
    membershipCount: 1,
  });
  assert.equal((await favorites.list()).length, 6);
  assert.equal((await folders.listFolders()).length, 1);
  assert.equal((await folders.listMembership()).length, 1);
  assert.deepEqual(await overrides.get(), { "legacy-folder": "full" });
  assert.deepEqual(await scoped.get(STORAGE_KEYS.uiState, null), { collapsed: true });
  assert.deepEqual(await scoped.get(STORAGE_KEYS.foldersUiState, null), { collapsed: true });
  assert.deepEqual(await scoped.get(STORAGE_KEYS.quickAccessUiState, null), { collapsed: true });
  assert.ok(storageNotifications > 0);

  const retainedBackup = await base.get<LegacyAccountData | null>(
    STORAGE_KEYS.legacyAccountData,
    null,
  );
  assert.equal(retainedBackup?.favorites.length, 6);
  assert.equal(retainedBackup?.claimedToScopeId, ACCOUNT_A);
  assert.equal(typeof retainedBackup?.claimedAt, "number");

  assert.deepEqual(await recovery.restore(ACCOUNT_A), {
    state: "already-claimed",
    claimedToCurrentScope: true,
  });
  assert.equal((await favorites.list()).length, 6);

  const reloadedScope = new AccountScopedStorage(base);
  reloadedScope.setScope(ACCOUNT_A);
  assert.equal((await new FavoritesRepository(reloadedScope).list()).length, 6);
  assert.equal((await new FoldersRepository(reloadedScope).listMembership()).length, 1);

  scoped.setScope(ACCOUNT_B);
  assert.deepEqual(await recovery.restore(ACCOUNT_B), {
    state: "already-claimed",
    claimedToCurrentScope: false,
  });
  assert.deepEqual(await favorites.list(), []);
  unsubscribe();
});

test("explicit stable-identity rebind copies all seven old-scope values and retains the source", async () => {
  const base = new MemoryStorage();
  const legacy = createLegacyData();
  const oldScopeValues = {
    [STORAGE_KEYS.favorites]: legacy.favorites,
    [STORAGE_KEYS.uiState]: legacy.uiState,
    [STORAGE_KEYS.folders]: legacy.folders,
    [STORAGE_KEYS.folderMembership]: legacy.folderMembership,
    [STORAGE_KEYS.foldersUiState]: legacy.foldersUiState,
    [STORAGE_KEYS.quickAccessUiState]: legacy.quickAccessUiState,
    [STORAGE_KEYS.folderChatNameDisplayOverrides]: legacy.folderChatNameDisplayOverrides,
  };
  await base.setMany({
    ...Object.fromEntries(Object.entries(oldScopeValues).map(([key, value]) => [
      getAccountScopedStorageKey(OLD_AVATAR_SCOPE, key),
      value,
    ])),
    [STORAGE_KEYS.legacyAccountData]: {
      ...legacy,
      claimedToScopeId: OLD_AVATAR_SCOPE,
      claimedAt: 200,
    },
  });
  const scoped = new AccountScopedStorage(base);
  scoped.setScope(ACCOUNT_A);
  const recovery = new LegacyAccountRecoveryService(base, scoped);

  assert.equal((await new FavoritesRepository(scoped).list()).length, 0);
  assert.deepEqual(await recovery.getStatus(), {
    state: "stable-rebind-available",
    scopeId: ACCOUNT_A,
    sourceScopeId: OLD_AVATAR_SCOPE,
    favoriteCount: 6,
    folderCount: 1,
    membershipCount: 1,
  });
  assert.equal((await new FavoritesRepository(scoped).list()).length, 0);

  assert.deepEqual(await recovery.restore(ACCOUNT_A), {
    state: "restored",
    favoriteCount: 6,
    folderCount: 1,
    membershipCount: 1,
  });
  for (const [key, value] of Object.entries(oldScopeValues)) {
    assert.deepEqual(
      await base.get(getAccountScopedStorageKey(ACCOUNT_A, key), undefined),
      value,
    );
    assert.deepEqual(
      await base.get(getAccountScopedStorageKey(OLD_AVATAR_SCOPE, key), undefined),
      value,
    );
  }
  const retained = await base.get<LegacyAccountData | null>(STORAGE_KEYS.legacyAccountData, null);
  assert.deepEqual(retained?.stableScopeMigration, {
    sourceScopeId: OLD_AVATAR_SCOPE,
    destinationScopeId: ACCOUNT_A,
    migratedAt: retained?.stableScopeMigration?.migratedAt,
  });
  assert.equal(typeof retained?.stableScopeMigration?.migratedAt, "number");

  assert.deepEqual(await recovery.restore(ACCOUNT_A), {
    state: "already-claimed",
    claimedToCurrentScope: true,
  });
  assert.equal((await new FavoritesRepository(scoped).list()).length, 6);

  const reloaded = new AccountScopedStorage(base);
  reloaded.setScope(ACCOUNT_A);
  assert.equal((await new FavoritesRepository(reloaded).list()).length, 6);
  assert.equal((await new FoldersRepository(reloaded).listMembership()).length, 1);

  scoped.setScope(ACCOUNT_B);
  assert.deepEqual(await recovery.getStatus(), {
    state: "already-claimed",
    claimedToCurrentScope: false,
  });
  assert.deepEqual(await new FavoritesRepository(scoped).list(), []);
});

test("stable-identity rebind refuses a nonempty destination without modifying either scope", async () => {
  const base = new MemoryStorage();
  const legacy = createLegacyData();
  await base.setMany({
    [getAccountScopedStorageKey(OLD_AVATAR_SCOPE, STORAGE_KEYS.favorites)]: legacy.favorites,
    [STORAGE_KEYS.legacyAccountData]: {
      ...legacy,
      claimedToScopeId: OLD_AVATAR_SCOPE,
      claimedAt: 200,
    },
    [getAccountScopedStorageKey(ACCOUNT_A, STORAGE_KEYS.favorites)]: [{
      conversationId: "stable-existing",
      title: "Stable existing",
      url: "https://chatgpt.com/c/stable-existing",
      addedAt: 1,
      sortIndex: 0,
    }],
  });
  const scoped = new AccountScopedStorage(base);
  scoped.setScope(ACCOUNT_A);
  const recovery = new LegacyAccountRecoveryService(base, scoped);

  assert.deepEqual(await recovery.getStatus(), { state: "destination-not-empty" });
  assert.deepEqual(await recovery.restore(ACCOUNT_A), { state: "destination-not-empty" });
  assert.equal((await new FavoritesRepository(scoped).list())[0]?.conversationId, "stable-existing");
  assert.equal(
    (await base.get<FavoriteConversation[]>(
      getAccountScopedStorageKey(OLD_AVATAR_SCOPE, STORAGE_KEYS.favorites),
      [],
    )).length,
    6,
  );
  assert.equal(
    (await base.get<LegacyAccountData | null>(STORAGE_KEYS.legacyAccountData, null))
      ?.stableScopeMigration,
    null,
  );
});

test("stable rebind uses only the explicitly recorded old scope", async () => {
  const base = new MemoryStorage();
  const legacy = createLegacyData();
  const unrelatedFavorite: FavoriteConversation = {
    conversationId: "unrelated-conversation",
    route: "c",
    title: "Unrelated",
    url: "https://chatgpt.com/c/unrelated-conversation",
    addedAt: 1,
    sortIndex: 0,
  };
  await base.setMany({
    [getAccountScopedStorageKey(OLD_AVATAR_SCOPE, STORAGE_KEYS.favorites)]: legacy.favorites,
    [getAccountScopedStorageKey(UNRELATED_SCOPE, STORAGE_KEYS.favorites)]: [unrelatedFavorite],
    [STORAGE_KEYS.legacyAccountData]: {
      ...legacy,
      claimedToScopeId: OLD_AVATAR_SCOPE,
      claimedAt: 200,
    },
  });
  const scoped = new AccountScopedStorage(base);
  scoped.setScope(ACCOUNT_A);
  const recovery = new LegacyAccountRecoveryService(base, scoped);
  await recovery.restore(ACCOUNT_A);

  const restoredIds = (await new FavoritesRepository(scoped).list())
    .map((favorite) => favorite.conversationId);
  assert.equal(restoredIds.length, 6);
  assert.equal(restoredIds.includes("unrelated-conversation"), false);
  assert.deepEqual(
    await base.get(getAccountScopedStorageKey(UNRELATED_SCOPE, STORAGE_KEYS.favorites), []),
    [unrelatedFavorite],
  );
});

test("restore refuses to overwrite any existing destination organization data", async () => {
  const base = new MemoryStorage();
  await base.set(STORAGE_KEYS.legacyAccountData, createLegacyData());
  const scoped = new AccountScopedStorage(base);
  scoped.setScope(ACCOUNT_A);
  const favorites = new FavoritesRepository(scoped);
  await favorites.add({
    conversationId: "existing-conversation",
    title: "Existing",
    url: "https://chatgpt.com/c/existing-conversation",
  });
  const recovery = new LegacyAccountRecoveryService(base, scoped);

  assert.deepEqual(await recovery.getStatus(), { state: "destination-not-empty" });
  assert.deepEqual(await recovery.restore(ACCOUNT_A), { state: "destination-not-empty" });
  assert.deepEqual(
    (await favorites.list()).map((favorite) => favorite.conversationId),
    ["existing-conversation"],
  );
  const legacy = await base.get<LegacyAccountData | null>(STORAGE_KEYS.legacyAccountData, null);
  assert.equal(legacy?.claimedToScopeId, null);
  assert.equal(legacy?.favorites.length, 6);
});

test("unresolved and logged-out account gates cannot restore legacy data", async () => {
  const base = new MemoryStorage();
  await base.set(STORAGE_KEYS.legacyAccountData, createLegacyData());
  const scoped = new AccountScopedStorage(base);
  const recovery = new LegacyAccountRecoveryService(base, scoped);

  assert.deepEqual(await recovery.getStatus(), { state: "account-unresolved" });
  assert.deepEqual(await recovery.restore(ACCOUNT_A), { state: "account-unresolved" });
  scoped.setScope(ACCOUNT_A);
  scoped.setScope(null);
  assert.deepEqual(await recovery.restore(ACCOUNT_A), { state: "account-unresolved" });
  const legacy = await base.get<LegacyAccountData | null>(STORAGE_KEYS.legacyAccountData, null);
  assert.equal(legacy?.claimedToScopeId, null);
});

test("restore confirmation is bound to the account scope that exposed it", async () => {
  const base = new MemoryStorage();
  await base.set(STORAGE_KEYS.legacyAccountData, createLegacyData());
  const scoped = new AccountScopedStorage(base);
  scoped.setScope(ACCOUNT_A);
  const recovery = new LegacyAccountRecoveryService(base, scoped);
  const status = await recovery.getStatus();
  assert.equal(status.state, "available");

  scoped.setScope(ACCOUNT_B);
  assert.deepEqual(await recovery.restore(ACCOUNT_A), { state: "account-unresolved" });
  assert.deepEqual(await new FavoritesRepository(scoped).list(), []);
  const legacy = await base.get<LegacyAccountData | null>(STORAGE_KEYS.legacyAccountData, null);
  assert.equal(legacy?.claimedToScopeId, null);
});
