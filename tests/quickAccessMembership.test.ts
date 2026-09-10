import assert from "node:assert/strict";
import test from "node:test";
import { FavoritesRepository } from "../src/features/favorites/FavoritesRepository";
import { FoldersRepository } from "../src/features/folders/FoldersRepository";
import { QuickAccessMembershipService } from "../src/features/quickAccess/QuickAccessMembershipService";
import { MemoryStorage } from "./helpers/MemoryStorage";

function conversation(conversationId: string) {
  return {
    conversationId,
    route: "c" as const,
    title: `Conversation ${conversationId}`,
    url: `https://chatgpt.com/c/${conversationId}`,
  };
}

function setup() {
  const storage = new MemoryStorage();
  let nextFolderId = 1;
  const favorites = new FavoritesRepository(storage);
  const folders = new FoldersRepository(
    storage,
    undefined,
    () => `folder-${nextFolderId++}`,
  );
  return {
    storage,
    favorites,
    folders,
    membership: new QuickAccessMembershipService(favorites, folders),
  };
}

test("starring a native conversation adds it to Quick Access root", async () => {
  const { favorites, folders, membership } = setup();
  await membership.addToQuickAccess(conversation("native"));
  assert.equal(await favorites.isFavorite("native"), true);
  assert.equal(await folders.getMembership("native"), null);
});

test("assigning a native conversation to a folder automatically enters Quick Access", async () => {
  const { favorites, folders, membership } = setup();
  const folder = await folders.createFolder("Folder");
  const identity = conversation("native");
  const untouched = structuredClone(identity);
  await membership.assignToFolder(folder.id, identity);
  assert.equal(await favorites.isFavorite("native"), true);
  assert.equal((await folders.getMembership("native"))?.folderId, folder.id);
  assert.deepEqual(identity, untouched);
});

test("moving a Quick Access chat into and between folders retains Quick Access", async () => {
  const { favorites, folders, membership } = setup();
  const first = await folders.createFolder("First");
  const second = await folders.createFolder("Second");
  await membership.addToQuickAccess(conversation("chat"));
  await membership.assignToFolder(first.id, conversation("chat"));
  assert.equal(await favorites.isFavorite("chat"), true);
  await membership.assignToFolder(second.id, conversation("chat"));
  assert.equal(await favorites.isFavorite("chat"), true);
  assert.equal((await folders.getMembership("chat"))?.folderId, second.id);
});

test("moving a foldered conversation to root removes membership only", async () => {
  const { favorites, folders, membership } = setup();
  const folder = await folders.createFolder("Folder");
  await membership.assignToFolder(folder.id, conversation("chat"));
  await membership.moveToRoot("chat");
  assert.equal(await favorites.isFavorite("chat"), true);
  assert.equal(await folders.getMembership("chat"), null);
});

test("unstarring root and foldered conversations removes complete Quick Access membership", async () => {
  const { favorites, folders, membership } = setup();
  const folder = await folders.createFolder("Folder");
  await membership.addToQuickAccess(conversation("root"));
  await membership.assignToFolder(folder.id, conversation("foldered"));
  await membership.removeFromQuickAccess("root");
  await membership.removeFromQuickAccess("foldered");
  assert.equal(await favorites.isFavorite("root"), false);
  assert.equal(await favorites.isFavorite("foldered"), false);
  assert.equal(await folders.getMembership("foldered"), null);
});

test("normal coordinated operations never create folder-only membership", async () => {
  const { favorites, folders, membership } = setup();
  const folder = await folders.createFolder("Folder");
  await membership.assignToFolder(folder.id, conversation("chat"));
  for (const item of await folders.listMembership()) {
    assert.equal(await favorites.isFavorite(item.conversationId), true);
  }
});
