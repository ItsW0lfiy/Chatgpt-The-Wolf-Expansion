import assert from "node:assert/strict";
import test from "node:test";
import { createOpaqueAccountScopeId } from "../src/accounts/accountIdentity";
import { FavoritesRepository } from "../src/features/favorites/FavoritesRepository";
import { FoldersRepository } from "../src/features/folders/FoldersRepository";
import { FolderDisplayOverridesRepository } from "../src/features/folders/FolderDisplayOverridesRepository";
import { SettingsService } from "../src/settings/settings";
import {
  AccountScopeUnavailableError,
  AccountScopedStorage,
  getAccountScopedStorageKey,
} from "../src/storage/AccountScopedStorage";
import { migrateStorage } from "../src/storage/migrations";
import { STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from "../src/storage/schemas";
import { MemoryStorage } from "./helpers/MemoryStorage";

const chat = (conversationId: string, title: string) => ({
  conversationId,
  route: "c" as const,
  title,
  url: `https://chatgpt.com/c/${conversationId}`,
});

test("account A, logout, account B, and return to A remain isolated across reload", async () => {
  const base = new MemoryStorage();
  const scoped = new AccountScopedStorage(base);
  const favorites = new FavoritesRepository(scoped);
  const folders = new FoldersRepository(scoped, undefined, () => "folder-a");
  const overrides = new FolderDisplayOverridesRepository(scoped);

  scoped.setScope("account-a");
  await favorites.add(chat("conversation-a", "A conversation"));
  const folderA = await folders.createFolder("A folder");
  await folders.assignConversation(folderA.id, chat("conversation-a", "A conversation"));
  await overrides.set(folderA.id, "full");

  scoped.setScope(null);
  assert.deepEqual(await favorites.list(), []);
  assert.deepEqual(await folders.listFolders(), []);
  assert.deepEqual(await folders.listMembership(), []);
  assert.deepEqual(await overrides.get(), {});

  scoped.setScope("account-b");
  assert.deepEqual(await favorites.list(), []);
  await favorites.add(chat("conversation-b", "B conversation"));
  assert.deepEqual((await favorites.list()).map((item) => item.conversationId), ["conversation-b"]);

  scoped.setScope("account-a");
  assert.deepEqual((await favorites.list()).map((item) => item.conversationId), ["conversation-a"]);
  assert.deepEqual((await folders.listFolders()).map((item) => item.name), ["A folder"]);
  assert.equal((await folders.listMembership())[0]?.conversationId, "conversation-a");
  assert.deepEqual(await overrides.get(), { [folderA.id]: "full" });

  const afterReload = new AccountScopedStorage(base);
  const reloadedFavorites = new FavoritesRepository(afterReload);
  afterReload.setScope("account-b");
  assert.deepEqual((await reloadedFavorites.list()).map((item) => item.conversationId), ["conversation-b"]);
  afterReload.setScope(null);
  assert.deepEqual(await reloadedFavorites.list(), []);
  afterReload.setScope("account-a");
  assert.deepEqual((await reloadedFavorites.list()).map((item) => item.conversationId), ["conversation-a"]);
});

test("unresolved and logged-out gates return empty account data and reject writes", async () => {
  const base = new MemoryStorage();
  const scoped = new AccountScopedStorage(base);
  await base.set(getAccountScopedStorageKey("account-a", STORAGE_KEYS.favorites), [
    { ...chat("conversation-a", "Private A title"), addedAt: 1, sortIndex: 0 },
  ]);

  assert.deepEqual(await new FavoritesRepository(scoped).list(), []);
  await assert.rejects(
    () => new FavoritesRepository(scoped).add(chat("conversation-x", "Unscoped")),
    AccountScopeUnavailableError,
  );
});

test("global settings remain available while account-owned data is gated", async () => {
  const base = new MemoryStorage();
  const scoped = new AccountScopedStorage(base);
  const settings = new SettingsService(scoped);
  await settings.update({ debug: { enabled: true } });
  assert.equal((await settings.get()).debug.enabled, true);
  assert.equal(await base.get(STORAGE_KEYS.settings, null) !== null, true);
  assert.deepEqual(await new FavoritesRepository(scoped).list(), []);
});

test("account scope identifiers are deterministic opaque hashes", async () => {
  const identity = "chatgpt-user-id:user-EXAMPLEACCOUNT123";
  const first = await createOpaqueAccountScopeId(identity);
  const second = await createOpaqueAccountScopeId(identity);
  assert.equal(first, second);
  assert.match(first, /^sha256-[0-9a-f]{64}$/u);
  assert.doesNotMatch(first, /user|example/iu);
});

test("schema 9 conservatively preserves legacy unscoped organization without assigning it", async () => {
  const base = new MemoryStorage();
  await base.setMany({
    [STORAGE_KEYS.schemaVersion]: 6,
    [STORAGE_KEYS.settings]: {
      folders: { chatNameDisplayOverrides: { "legacy-folder": "full" } },
    },
    [STORAGE_KEYS.favorites]: [
      { ...chat("legacy-conversation", "Legacy"), addedAt: 1, sortIndex: 0 },
    ],
    [STORAGE_KEYS.folders]: [{
      id: "legacy-folder",
      name: "Legacy folder",
      parentId: null,
      sortIndex: 0,
      createdAt: 1,
      collapsed: false,
    }],
  });
  await migrateStorage(base);

  const legacy = await base.get<Record<string, unknown> | null>(
    STORAGE_KEYS.legacyAccountData,
    null,
  );
  assert.ok(legacy);
  assert.deepEqual(legacy.folderChatNameDisplayOverrides, { "legacy-folder": "full" });
  assert.equal(legacy.claimedIdentityVersion, null);
  assert.equal(legacy.stableScopeMigration, null);
  assert.equal(await base.get(STORAGE_KEYS.schemaVersion, 0), STORAGE_SCHEMA_VERSION);
  const scoped = new AccountScopedStorage(base);
  scoped.setScope("new-account");
  assert.deepEqual(await new FavoritesRepository(scoped).list(), []);
  assert.equal((await base.get<unknown[]>(STORAGE_KEYS.favorites, [])).length, 1);
  assert.deepEqual(
    (await new SettingsService(base).get()).folders.chatNameDisplayOverrides,
    {},
  );
});

test("schema 9 migrates route-less account-scoped /c/ records and rejects malformed locations", async () => {
  const base = new MemoryStorage();
  const scope = "sha256-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  await base.setMany({
    [STORAGE_KEYS.schemaVersion]: 8,
    [getAccountScopedStorageKey(scope, STORAGE_KEYS.favorites)]: [
      {
        conversationId: "legacy-c",
        title: "Legacy C",
        url: "https://chatgpt.com/c/legacy-c",
        addedAt: 1,
        sortIndex: 0,
      },
      {
        conversationId: "malformed",
        title: "Malformed",
        url: "https://example.com/c/malformed",
        addedAt: 2,
        sortIndex: 1,
      },
    ],
  });
  await migrateStorage(base);
  assert.deepEqual(
    await base.get(getAccountScopedStorageKey(scope, STORAGE_KEYS.favorites), []),
    [{
      conversationId: "legacy-c",
      route: "c",
      title: "Legacy C",
      url: "https://chatgpt.com/c/legacy-c",
      addedAt: 1,
      sortIndex: 0,
    }],
  );
});

test("switching scope rewires subscriptions without exposing the previous account", async () => {
  const base = new MemoryStorage();
  const scoped = new AccountScopedStorage(base);
  const observed: string[][] = [];
  scoped.setScope("account-a");
  const repository = new FavoritesRepository(scoped);
  const unsubscribe = repository.subscribe(() => {
    void repository.list().then((items) => observed.push(items.map((item) => item.conversationId)));
  });
  await repository.add(chat("conversation-a", "A"));
  scoped.setScope(null);
  await Promise.resolve();
  scoped.setScope("account-b");
  await repository.add(chat("conversation-b", "B"));
  await Promise.resolve();
  unsubscribe();
  assert.ok(observed.some((ids) => ids.length === 0));
  assert.deepEqual(observed.at(-1), ["conversation-b"]);
});
