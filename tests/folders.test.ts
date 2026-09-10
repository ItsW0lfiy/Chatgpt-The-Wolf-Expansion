import assert from "node:assert/strict";
import test from "node:test";
import { FavoritesRepository } from "../src/features/favorites/FavoritesRepository";
import {
  FoldersRepository,
  wouldCreateFolderCycle,
} from "../src/features/folders/FoldersRepository";
import { normalizeFolders } from "../src/storage/migrations";
import { STORAGE_KEYS } from "../src/storage/schemas";
import { FolderDisplayOverridesRepository } from "../src/features/folders/FolderDisplayOverridesRepository";
import { MemoryStorage } from "./helpers/MemoryStorage";

function createRepository(storage = new MemoryStorage()): FoldersRepository {
  let nextId = 1;
  return new FoldersRepository(storage, undefined, () => `folder-${nextId++}`);
}

function conversation(conversationId: string, title = conversationId) {
  return {
    conversationId,
    route: "c" as const,
    title,
    url: `https://chatgpt.com/c/${conversationId}`,
  };
}

test("creates root and nested folders with stable IDs", async () => {
  const repository = createRepository();
  const root = await repository.createFolder("Development");
  const child = await repository.createFolder("Wolf Expansion", root.id);

  assert.equal(root.id, "folder-1");
  assert.equal(child.id, "folder-2");
  assert.equal(child.parentId, root.id);
  assert.equal((await repository.getTree())[0]?.children[0]?.folder.id, child.id);
});

test("renames a folder while preserving its identity", async () => {
  const repository = createRepository();
  const folder = await repository.createFolder("Old");
  await repository.renameFolder(folder.id, "New");
  assert.deepEqual((await repository.listFolders()).map(({ id, name }) => ({ id, name })), [
    { id: folder.id, name: "New" },
  ]);
});

test("deleting a folder unfiles direct conversations and reparents direct subfolders", async () => {
  const repository = createRepository();
  const parent = await repository.createFolder("Parent");
  const deleted = await repository.createFolder("Delete me", parent.id);
  const child = await repository.createFolder("Preserved child", deleted.id);
  await repository.assignConversation(deleted.id, conversation("chat-a"));

  await repository.deleteFolder(deleted.id);

  const folders = await repository.listFolders();
  assert.equal(folders.some((folder) => folder.id === deleted.id), false);
  assert.equal(folders.find((folder) => folder.id === child.id)?.parentId, parent.id);
  assert.equal(await repository.getMembership("chat-a"), null);
});

test("deleting a folder removes only its orphaned chat-name display override", async () => {
  const storage = new MemoryStorage();
  const repository = createRepository(storage);
  const overrides = new FolderDisplayOverridesRepository(storage);
  const deleted = await repository.createFolder("Delete");
  const retained = await repository.createFolder("Retain");
  await overrides.set(deleted.id, "full");
  await overrides.set(retained.id, "compact");

  await repository.deleteFolder(deleted.id);

  assert.deepEqual(await overrides.get(), {
    [retained.id]: "compact",
  });
});

test("moves folders and rejects self-parent and descendant cycles", async () => {
  const repository = createRepository();
  const root = await repository.createFolder("Root");
  const child = await repository.createFolder("Child", root.id);
  const other = await repository.createFolder("Other");

  await repository.moveFolder(child.id, other.id);
  assert.equal((await repository.listFolders()).find((folder) => folder.id === child.id)?.parentId, other.id);

  await assert.rejects(repository.moveFolder(root.id, root.id), /itself or one of its descendants/);
  await repository.moveFolder(child.id, root.id);
  await assert.rejects(repository.moveFolder(root.id, child.id), /itself or one of its descendants/);
  assert.equal(wouldCreateFolderCycle(await repository.listFolders(), root.id, child.id), true);
});

test("moves deep and large subtrees to root without losing children or memberships", async () => {
  const repository = createRepository();
  const rootA = await repository.createFolder("A");
  const rootD = await repository.createFolder("D");
  const childB = await repository.createFolder("B", rootA.id);
  const childC = await repository.createFolder("C", childB.id);
  const leaves = await Promise.all(
    Array.from({ length: 30 }, (_, index) => repository.createFolder(`Leaf ${index}`, childC.id)),
  );
  await repository.assignConversation(childC.id, conversation("deep-chat"));

  await repository.moveFolder(childB.id, null, 1);
  let folders = await repository.listFolders();
  assert.equal(folders.find((folder) => folder.id === childB.id)?.parentId, null);
  assert.equal(folders.find((folder) => folder.id === childC.id)?.parentId, childB.id);
  assert.equal(leaves.every((leaf) =>
    folders.find((folder) => folder.id === leaf.id)?.parentId === childC.id), true);
  assert.equal((await repository.getMembership("deep-chat"))?.folderId, childC.id);

  await repository.moveFolder(childC.id, null, 0);
  await repository.moveFolder(childB.id, rootD.id);
  await repository.moveFolder(childB.id, rootD.id, 0);
  for (let index = 0; index < 10; index += 1) {
    await repository.moveFolder(childB.id, null, 1);
    await repository.moveFolder(childB.id, rootD.id, 0);
  }
  folders = await repository.listFolders();
  assert.equal(new Set(folders.map((folder) => folder.id)).size, folders.length);
  assert.equal(folders.find((folder) => folder.id === childC.id)?.parentId, null);
});

test("reorders folders only among their siblings", async () => {
  const repository = createRepository();
  const first = await repository.createFolder("First");
  const second = await repository.createFolder("Second");
  const third = await repository.createFolder("Third");
  await repository.reorderFolder(third.id, -1);

  assert.deepEqual(
    (await repository.getTree()).map((node) => node.folder.id),
    [first.id, third.id, second.id],
  );
});

test("assigns, moves, and removes an unseen conversation", async () => {
  const repository = createRepository();
  const first = await repository.createFolder("First");
  const second = await repository.createFolder("Second");
  await repository.assignConversation(first.id, conversation("chat-unseen", "Unseen chat"));
  assert.equal((await repository.getMembership("chat-unseen"))?.folderId, first.id);

  await repository.assignConversation(second.id, conversation("chat-unseen", "Updated title"));
  const moved = await repository.getMembership("chat-unseen");
  assert.equal(moved?.folderId, second.id);
  assert.equal(moved?.title, "Updated title");

  await repository.removeConversation("chat-unseen");
  assert.equal(await repository.getMembership("chat-unseen"), null);
});

test("Favorites and folder membership remain independent", async () => {
  const storage = new MemoryStorage();
  const folders = createRepository(storage);
  const favorites = new FavoritesRepository(storage);
  const folder = await folders.createFolder("Development");
  await folders.assignConversation(folder.id, conversation("chat-shared"));
  await favorites.add(conversation("chat-shared"));

  await favorites.remove("chat-shared");
  assert.equal((await folders.getMembership("chat-shared"))?.folderId, folder.id);

  await favorites.add(conversation("chat-shared"));
  await folders.removeConversation("chat-shared");
  assert.equal(await favorites.isFavorite("chat-shared"), true);

  await folders.assignConversation(folder.id, conversation("chat-shared"));
  await folders.deleteFolder(folder.id);
  assert.equal(await favorites.isFavorite("chat-shared"), true);
});

test("persists explicit structured-clone-safe membership fields", async () => {
  const storage = new MemoryStorage();
  const repository = createRepository(storage);
  const folder = await repository.createFolder("Safe");
  const domFacingReference = {
    ...conversation("chat-safe", "Safe chat"),
    element: () => "simulated non-cloneable DOM-facing extra",
  };
  await repository.assignConversation(folder.id, domFacingReference);

  const stored = await storage.get<unknown[]>(STORAGE_KEYS.folderMembership, []);
  const storedFolders = await storage.get<unknown[]>(STORAGE_KEYS.folders, []);
  assert.deepEqual(Object.keys(storedFolders[0] as object).sort(), [
    "collapsed",
    "createdAt",
    "id",
    "name",
    "parentId",
    "sortIndex",
  ]);
  assert.deepEqual(Object.keys(stored[0] as object).sort(), [
    "assignedAt",
    "conversationId",
    "folderId",
    "route",
    "sortIndex",
    "title",
    "url",
  ]);
  assert.doesNotThrow(() => structuredClone({ storedFolders, stored }));
});

test("rejects empty names and malformed conversation identity", async () => {
  const repository = createRepository();
  const folder = await repository.createFolder("Valid");
  await assert.rejects(repository.createFolder("   "), /cannot be empty/);
  await assert.rejects(
    repository.assignConversation(folder.id, {
      conversationId: "chat-a",
      title: "Mismatch",
      url: "https://chatgpt.com/c/chat-b",
    }),
    /Cannot assign conversation/,
  );
});

test("normalization safely breaks malformed stored hierarchy cycles", () => {
  const normalized = normalizeFolders([
    { id: "a", name: "A", parentId: "b", sortIndex: 0, createdAt: 1, collapsed: false },
    { id: "b", name: "B", parentId: "a", sortIndex: 0, createdAt: 2, collapsed: false },
    { id: "orphan", name: "Orphan", parentId: "missing", sortIndex: 0, createdAt: 3, collapsed: false },
  ]);
  const byId = new Map(normalized.map((folder) => [folder.id, folder]));

  assert.equal(byId.get("a")?.parentId, null);
  assert.equal(byId.get("b")?.parentId, "a");
  assert.equal(byId.get("orphan")?.parentId, null);
});
