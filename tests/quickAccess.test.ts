import assert from "node:assert/strict";
import test from "node:test";
import {
  collectDetectedConversationMetadata,
  normalizeConversationIdentity,
  selectConversationTitleWithSource,
} from "../src/adapters/chatgpt/conversationIdentity";
import { getFavoriteActionLabel } from "../src/features/favorites/favoriteActionState";
import { FavoritesRepository } from "../src/features/favorites/FavoritesRepository";
import { FoldersRepository } from "../src/features/folders/FoldersRepository";
import {
  buildQuickAccessProjection,
  getValidFolderDestinations,
} from "../src/features/quickAccess/quickAccessProjection";
import { getItemNameSemantics } from "../src/features/quickAccess/itemNameDisplay";
import { migrateStorage } from "../src/storage/migrations";
import { STORAGE_KEYS } from "../src/storage/schemas";
import { MemoryStorage } from "./helpers/MemoryStorage";

function conversation(conversationId: string, title = conversationId) {
  return { conversationId, route: "c" as const, title, url: `https://chatgpt.com/c/${conversationId}` };
}

function repositories() {
  const storage = new MemoryStorage();
  let nextId = 1;
  return {
    storage,
    favorites: new FavoritesRepository(storage),
    folders: new FoldersRepository(storage, undefined, () => `folder-${nextId++}`),
  };
}

test("user-facing Favorites terminology maps to Quick Access without renaming storage", () => {
  assert.equal(getFavoriteActionLabel(false, "menu"), "Add to Quick Access");
  assert.equal(getFavoriteActionLabel(true, "menu"), "Remove from Quick Access");
  assert.equal(STORAGE_KEYS.favorites, "wolfExpansion.favorites");
});

test("literal Pinned wording survives storage projection and accessibility semantics", () => {
  const favorite = {
    conversationId: "wolf-images",
    route: "c" as const,
    title: "Pinned: Test Chat",
    url: "https://chatgpt.com/c/wolf-images",
    addedAt: 1,
    sortIndex: 0,
  };
  const projection = buildQuickAccessProjection(
    [favorite],
    [],
    [],
    { quickAccessEnabled: true, foldersEnabled: true },
  );
  const projected = projection.looseChats[0];
  const semantics = getItemNameSemantics(projected?.title ?? "");
  assert.equal(projected?.title, "Pinned: Test Chat");
  assert.equal(semantics.visibleText, "Pinned: Test Chat");
  assert.equal(semantics.tooltip, "Pinned: Test Chat");
  assert.equal(semantics.accessibleName, "Pinned: Test Chat");
  assert.equal(projected?.conversationId, favorite.conversationId);
  assert.equal(projected?.isQuickAccess, true);
});

test("existing metadata refresh updates root and foldered chats without changing identity or order", async () => {
  const { favorites, folders } = repositories();
  const folder = await folders.createFolder("Development");
  await favorites.add(conversation("root-chat", "Root old"));
  await favorites.add(conversation("folder-chat", "Folder old"));
  await folders.assignConversation(folder.id, conversation("folder-chat", "Folder old"));
  const originalFavoriteOrder = (await favorites.list()).map((item) => item.conversationId);
  const originalMembership = await folders.getMembership("folder-chat");

  for (const suffix of ["new", "newer"]) {
    const detected = new Map([
      ["root-chat", { title: `Root ${suffix}`, url: "https://chatgpt.com/c/root-chat" }],
      ["folder-chat", { title: `Folder ${suffix}`, url: "https://chatgpt.com/c/folder-chat" }],
    ]);
    await Promise.all([
      favorites.updateDetectedTitles(detected),
      folders.updateDetectedTitles(detected),
    ]);
  }

  const storedFavorites = await favorites.list();
  const storedMembership = await folders.getMembership("folder-chat");
  const projection = buildQuickAccessProjection(
    storedFavorites,
    await folders.listFolders(),
    await folders.listMembership(),
    { quickAccessEnabled: true, foldersEnabled: true },
  );
  assert.equal(projection.looseChats[0]?.title, "Root newer");
  assert.equal(projection.folders[0]?.chats[0]?.title, "Folder newer");
  assert.deepEqual(storedFavorites.map((item) => item.conversationId), originalFavoriteOrder);
  assert.equal(storedMembership?.conversationId, originalMembership?.conversationId);
  assert.equal(storedMembership?.folderId, originalMembership?.folderId);
  assert.equal(storedMembership?.sortIndex, originalMembership?.sortIndex);
});

test("route metadata reconciliation preserves organization while moving a chat from /c/ to /g/", async () => {
  const { favorites, folders } = repositories();
  const folder = await folders.createFolder("Project-independent Wolf folder");
  await favorites.add(conversation("moved-chat", "Before project move"));
  await folders.assignConversation(folder.id, conversation("moved-chat", "Before project move"));
  const favoriteOrder = (await favorites.list()).map((item) => item.conversationId);
  const membershipOrder = (await folders.listMembership()).map((item) => item.conversationId);
  const detected = new Map([[
    "moved-chat",
    {
      title: "After ChatGPT-side move",
      route: "g" as const,
      url: "https://chatgpt.com/g/moved-chat",
    },
  ]]);
  await Promise.all([
    favorites.updateDetectedTitles(detected),
    folders.updateDetectedTitles(detected),
  ]);
  const storedFavorite = (await favorites.list())[0];
  const storedMembership = await folders.getMembership("moved-chat");
  assert.equal(storedFavorite?.route, "g");
  assert.equal(storedFavorite?.url, "https://chatgpt.com/g/moved-chat");
  assert.equal(storedMembership?.route, "g");
  assert.equal(storedMembership?.folderId, folder.id);
  assert.deepEqual((await favorites.list()).map((item) => item.conversationId), favoriteOrder);
  assert.deepEqual((await folders.listMembership()).map((item) => item.conversationId), membershipOrder);
  const projection = buildQuickAccessProjection(
    await favorites.list(),
    await folders.listFolders(),
    await folders.listMembership(),
    { quickAccessEnabled: true, foldersEnabled: true },
  );
  assert.equal(projection.folders[0]?.chats.length, 1);
  assert.equal(projection.folders[0]?.chats[0]?.url, "https://chatgpt.com/g/moved-chat");
});

test("a changed exact-ID native duplicate corrects stale stored metadata without moving the chat", async () => {
  const { favorites, folders } = repositories();
  const folder = await folders.createFolder("Folder");
  await favorites.add(conversation("stale", "Old Name"));
  await folders.assignConversation(folder.id, conversation("stale", "Old Name"));
  const detected = collectDetectedConversationMetadata([
    {
      conversationId: "stale",
      title: "Old Name",
      url: "/c/stale",
      titleResolved: true,
    },
    {
      conversationId: "stale",
      title: "New Name",
      url: "/c/stale",
      titleResolved: true,
    },
  ], new Map([["stale", "Old Name"]]));

  await Promise.all([
    favorites.updateDetectedTitles(detected),
    folders.updateDetectedTitles(detected),
  ]);
  const storedFavorite = (await favorites.list())[0];
  const storedMembership = await folders.getMembership("stale");
  const projection = buildQuickAccessProjection(
    await favorites.list(),
    await folders.listFolders(),
    await folders.listMembership(),
    { quickAccessEnabled: true, foldersEnabled: true },
  );
  assert.equal(storedFavorite?.title, "New Name");
  assert.equal(storedMembership?.title, "New Name");
  assert.equal(storedMembership?.folderId, folder.id);
  assert.equal(projection.folders[0]?.chats[0]?.title, "New Name");
  assert.equal(projection.looseChats.length, 0);
});

test("literal Pinned title survives discovery metadata through both repositories", async () => {
  const { favorites, folders } = repositories();
  const folder = await folders.createFolder("Folder");
  await favorites.add(conversation("literal", "Old title"));
  await folders.assignConversation(folder.id, conversation("literal", "Old title"));
  const detected = new Map([
    ["literal", {
      title: "Pinned: Test Chat",
      url: "https://chatgpt.com/c/literal",
    }],
  ]);

  await Promise.all([
    favorites.updateDetectedTitles(detected),
    folders.updateDetectedTitles(detected),
  ]);
  const projection = buildQuickAccessProjection(
    await favorites.list(),
    await folders.listFolders(),
    await folders.listMembership(),
    { quickAccessEnabled: true, foldersEnabled: true },
  );
  assert.equal((await favorites.list())[0]?.title, "Pinned: Test Chat");
  assert.equal((await folders.getMembership("literal"))?.title, "Pinned: Test Chat");
  assert.equal(projection.folders[0]?.chats[0]?.title, "Pinned: Test Chat");
});

test("literal titles survive extraction through rendered Quick Access semantics", async () => {
  const literalTitles = [
    "Pinned: Test Chat",
    "Test Chat (Pinned)",
    "Something — Pinned",
    "Pinned",
    "Pinned:",
    "My (Pinned) Notes",
  ];

  for (const [index, literalTitle] of literalTitles.entries()) {
    const { favorites, folders } = repositories();
    const folder = await folders.createFolder("Folder");
    const conversationId = `literal-${index}`;
    await favorites.add(conversation(conversationId, "Old title"));
    await folders.assignConversation(folder.id, conversation(conversationId, "Old title"));
    const extracted = selectConversationTitleWithSource({
      visibleText: literalTitle,
      ariaLabel: "Stale accessible title",
      titleAttribute: "Stale tooltip title",
    });
    const detected = collectDetectedConversationMetadata([{
      conversationId,
      title: extracted.title,
      titleResolved: true,
      url: `/c/${conversationId}`,
    }]);
    await Promise.all([
      favorites.updateDetectedTitles(detected),
      folders.updateDetectedTitles(detected),
    ]);
    const projection = buildQuickAccessProjection(
      await favorites.list(),
      await folders.listFolders(),
      await folders.listMembership(),
      { quickAccessEnabled: true, foldersEnabled: true },
    );
    const rendered = getItemNameSemantics(projection.folders[0]?.chats[0]?.title ?? "");
    assert.equal(extracted.source, "visible-text");
    assert.equal((await favorites.list())[0]?.title, literalTitle);
    assert.equal((await folders.getMembership(conversationId))?.title, literalTitle);
    assert.deepEqual(rendered, {
      accessibleName: literalTitle,
      tooltip: literalTitle,
      visibleText: literalTitle,
    });
  }
});

test("blank detected titles never overwrite stored display metadata", async () => {
  const { favorites, folders } = repositories();
  const folder = await folders.createFolder("Folder");
  await favorites.add(conversation("stable", "Stable title"));
  await folders.assignConversation(folder.id, conversation("stable", "Stable title"));
  const blank = new Map([
    ["stable", { title: "   ", url: "https://chatgpt.com/c/stable" }],
  ]);

  assert.equal(await favorites.updateDetectedTitles(blank), false);
  assert.equal(await folders.updateDetectedTitles(blank), false);
  assert.equal((await favorites.list())[0]?.title, "Stable title");
  assert.equal((await folders.getMembership("stable"))?.title, "Stable title");
});

test("root and nested projections structurally keep folders above chats", async () => {
  const { favorites, folders } = repositories();
  const rootA = await folders.createFolder("A");
  const rootB = await folders.createFolder("B");
  const child = await folders.createFolder("Child", rootA.id);
  await folders.assignConversation(rootA.id, conversation("folder-chat"));
  await folders.assignConversation(child.id, conversation("nested-chat"));
  await favorites.add(conversation("folder-chat"));
  await favorites.add(conversation("nested-chat"));
  await favorites.add(conversation("loose-chat"));

  const projection = buildQuickAccessProjection(
    await favorites.list(),
    await folders.listFolders(),
    await folders.listMembership(),
    { quickAccessEnabled: true, foldersEnabled: true },
  );
  assert.deepEqual(projection.folders.map((folder) => folder.folder.id), [rootA.id, rootB.id]);
  assert.deepEqual(projection.looseChats.map((chat) => chat.conversationId), ["loose-chat"]);
  assert.deepEqual(projection.folders[0]?.folders.map((folder) => folder.folder.id), [child.id]);
  assert.deepEqual(projection.folders[0]?.chats.map((chat) => chat.conversationId), ["folder-chat"]);
});

test("projection applies global mode to root chats and inherited modes inside folders", async () => {
  const { favorites, folders } = repositories();
  const development = await folders.createFolder("Development");
  const testing = await folders.createFolder("Testing", development.id);
  const logs = await folders.createFolder("Logs", development.id);
  await favorites.add(conversation("root-chat"));
  await favorites.add(conversation("testing-chat"));
  await favorites.add(conversation("logs-chat"));
  await folders.assignConversation(testing.id, conversation("testing-chat"));
  await folders.assignConversation(logs.id, conversation("logs-chat"));

  const projection = buildQuickAccessProjection(
    await favorites.list(),
    await folders.listFolders(),
    await folders.listMembership(),
    {
      quickAccessEnabled: true,
      foldersEnabled: true,
      globalItemNameDisplay: "compact",
      folderChatNameDisplayOverrides: {
        [development.id]: "full",
        [logs.id]: "compact",
      },
    },
  );

  assert.equal(projection.looseChats[0]?.nameDisplayMode, "compact");
  const developmentView = projection.folders[0];
  assert.equal(developmentView?.folders.find((folder) => folder.folder.id === testing.id)
    ?.chats[0]?.nameDisplayMode, "full");
  assert.equal(developmentView?.folders.find((folder) => folder.folder.id === logs.id)
    ?.chats[0]?.nameDisplayMode, "compact");
});

test("folder nesting, cross-parent movement, root movement, and sibling reorder persist", async () => {
  const { folders } = repositories();
  const first = await folders.createFolder("First");
  const second = await folders.createFolder("Second");
  const nested = await folders.createFolder("Nested", first.id);
  const sibling = await folders.createFolder("Sibling", first.id);

  await folders.moveFolder(first.id, second.id);
  assert.equal((await folders.listFolders()).find((folder) => folder.id === first.id)?.parentId, second.id);
  await folders.moveFolder(nested.id, second.id);
  assert.equal((await folders.listFolders()).find((folder) => folder.id === nested.id)?.parentId, second.id);
  await folders.moveFolder(nested.id, null);
  assert.equal((await folders.listFolders()).find((folder) => folder.id === nested.id)?.parentId, null);
  await folders.moveFolder(nested.id, null, 0);
  assert.equal((await folders.getTree())[0]?.folder.id, nested.id);
  await folders.moveFolder(sibling.id, second.id, 0);
  assert.equal((await folders.getTree()).find((node) => node.folder.id === second.id)?.children[0]?.folder.id, sibling.id);
  const rootOrder = (await folders.getTree()).map((node) => node.folder.id);
  const movingRoot = rootOrder[0];
  if (movingRoot) {
    await folders.moveFolder(movingRoot, null, rootOrder.length);
    assert.equal((await folders.getTree()).at(-1)?.folder.id, movingRoot);
  }
});

test("folder self-drop and descendant-cycle moves remain rejected", async () => {
  const { folders } = repositories();
  const root = await folders.createFolder("Root");
  const child = await folders.createFolder("Child", root.id);
  await assert.rejects(folders.moveFolder(root.id, root.id), /itself or one of its descendants/);
  await assert.rejects(folders.moveFolder(root.id, child.id), /itself or one of its descendants/);
});

test("valid Move Into destinations exclude self and descendants", async () => {
  const { folders } = repositories();
  const root = await folders.createFolder("Root");
  const child = await folders.createFolder("Child", root.id);
  const grandchild = await folders.createFolder("Grandchild", child.id);
  const other = await folders.createFolder("Other");
  assert.deepEqual(
    getValidFolderDestinations(await folders.listFolders(), root.id).map((folder) => folder.id),
    [other.id],
  );
  assert.ok(grandchild.id);
});

test("native/sidebar identity is normalized before structured-clone-safe folder assignment", async () => {
  const { storage, folders } = repositories();
  const folder = await folders.createFolder("Target");
  const domFacing = {
    conversationId: "native-chat",
    title: "Native chat",
    url: "/c/native-chat",
    link: () => "non-cloneable simulated DOM reference",
  };
  const normalized = normalizeConversationIdentity(domFacing);
  assert.equal(normalized.ok, true);
  if (!normalized.ok) {
    return;
  }
  await folders.assignConversation(folder.id, normalized.conversation);
  const stored = await storage.get<unknown[]>(STORAGE_KEYS.folderMembership, []);
  assert.doesNotThrow(() => structuredClone(stored));
  assert.equal(Object.hasOwn(stored[0] as object, "link"), false);
});

test("Quick Access and folder membership remain independent through drag-style assignment", async () => {
  const { favorites, folders } = repositories();
  const first = await folders.createFolder("First");
  const second = await folders.createFolder("Second");
  await favorites.add(conversation("shared"));
  await folders.assignConversation(first.id, conversation("shared"));
  assert.equal(await favorites.isFavorite("shared"), true);
  await folders.assignConversation(second.id, conversation("shared"));
  assert.equal((await folders.getMembership("shared"))?.folderId, second.id);
  assert.equal(await favorites.isFavorite("shared"), true);
});

test("legacy folder-only data is preserved but hidden and combined chat renders once", async () => {
  const { favorites, folders } = repositories();
  const folder = await folders.createFolder("Folder");
  await folders.assignConversation(folder.id, conversation("folder-only"));
  await folders.assignConversation(folder.id, conversation("shared"));
  await favorites.add(conversation("shared"));
  const projection = buildQuickAccessProjection(
    await favorites.list(),
    await folders.listFolders(),
    await folders.listMembership(),
    { quickAccessEnabled: true, foldersEnabled: true },
  );
  const chats = projection.folders[0]?.chats ?? [];
  assert.equal(chats.some((chat) => chat.conversationId === "folder-only"), false);
  assert.equal(chats.find((chat) => chat.conversationId === "shared")?.isQuickAccess, true);
  assert.equal(projection.looseChats.some((chat) => chat.conversationId === "shared"), false);
  await folders.removeConversation("folder-only");
  const afterUnfile = buildQuickAccessProjection(
    await favorites.list(),
    await folders.listFolders(),
    await folders.listMembership(),
    { quickAccessEnabled: true, foldersEnabled: true },
  );
  assert.equal(
    afterUnfile.folders[0]?.chats.some((chat) => chat.conversationId === "folder-only"),
    false,
  );
});

test("membership removal returns a Quick Access chat to the loose root", async () => {
  const { favorites, folders } = repositories();
  const folder = await folders.createFolder("Folder");
  await favorites.add(conversation("shared"));
  await folders.assignConversation(folder.id, conversation("shared"));
  await folders.removeConversation("shared");
  const projection = buildQuickAccessProjection(
    await favorites.list(),
    await folders.listFolders(),
    await folders.listMembership(),
    { quickAccessEnabled: true, foldersEnabled: true },
  );
  assert.deepEqual(projection.looseChats.map((chat) => chat.conversationId), ["shared"]);
});

test("a direct legacy Favorites removal cannot expose a folder-only alias", async () => {
  const { favorites, folders } = repositories();
  const folder = await folders.createFolder("Folder");
  await favorites.add(conversation("shared"));
  await folders.assignConversation(folder.id, conversation("shared"));
  await favorites.remove("shared");
  const projection = buildQuickAccessProjection(
    await favorites.list(),
    await folders.listFolders(),
    await folders.listMembership(),
    { quickAccessEnabled: true, foldersEnabled: true },
  );
  assert.equal(projection.folders[0]?.chats.length, 0);
  assert.equal((await folders.getMembership("shared"))?.folderId, folder.id);
});

test("root Quick Access and folder chat ordering persist independently", async () => {
  const { favorites, folders } = repositories();
  const folder = await folders.createFolder("Folder");
  await favorites.add(conversation("root-a"));
  await favorites.add(conversation("root-b"));
  await favorites.reorder(["root-b", "root-a"]);
  await folders.assignConversation(folder.id, conversation("folder-a"));
  await folders.assignConversation(folder.id, conversation("folder-b"));
  await folders.reorderConversations(folder.id, ["folder-b", "folder-a"]);
  assert.deepEqual((await favorites.list()).map((item) => item.conversationId), ["root-b", "root-a"]);
  assert.deepEqual((await folders.getFolderContents(folder.id)).map((item) => item.conversationId), ["folder-b", "folder-a"]);
});

test("projection treats Folders as subordinate to Quick Access", async () => {
  const { favorites, folders } = repositories();
  const folder = await folders.createFolder("Folder");
  await favorites.add(conversation("loose"));
  await favorites.add(conversation("filed"));
  await folders.assignConversation(folder.id, conversation("filed"));
  const data = [await favorites.list(), await folders.listFolders(), await folders.listMembership()] as const;
  const foldersOnly = buildQuickAccessProjection(...data, {
    quickAccessEnabled: false,
    foldersEnabled: true,
  });
  assert.equal(foldersOnly.visible, false);
  assert.equal(foldersOnly.folders.length, 0);
  assert.equal(foldersOnly.looseChats.length, 0);
  const quickOnly = buildQuickAccessProjection(...data, {
    quickAccessEnabled: true,
    foldersEnabled: false,
  });
  assert.equal(quickOnly.folders.length, 0);
  assert.deepEqual(
    quickOnly.looseChats.map((chat) => chat.conversationId),
    ["loose", "filed"],
  );
  const restored = buildQuickAccessProjection(...data, {
    quickAccessEnabled: true,
    foldersEnabled: true,
  });
  assert.equal(restored.folders[0]?.chats[0]?.conversationId, "filed");
  assert.deepEqual(restored.looseChats.map((chat) => chat.conversationId), ["loose"]);
  const neither = buildQuickAccessProjection(...data, {
    quickAccessEnabled: false,
    foldersEnabled: false,
  });
  assert.equal(neither.visible, false);
});

test("unified section UI state migrates from the legacy visible section state", async () => {
  const storage = new MemoryStorage();
  await storage.set(STORAGE_KEYS.settings, {
    enabled: true,
    favorites: { enabled: false, showIcon: true, rememberCollapsed: true },
    folders: { enabled: true, rememberCollapsed: true, showIcons: true },
  });
  await storage.set(STORAGE_KEYS.uiState, { collapsed: false });
  await storage.set(STORAGE_KEYS.foldersUiState, { collapsed: true });
  await migrateStorage(storage);
  assert.deepEqual(await storage.get(STORAGE_KEYS.quickAccessUiState, null), { collapsed: true });
});

test("duplicate folder names remain supported in unified projections", async () => {
  const { folders } = repositories();
  await folders.createFolder("Duplicate");
  await folders.createFolder("Duplicate");
  const projection = buildQuickAccessProjection(
    [],
    await folders.listFolders(),
    [],
    { quickAccessEnabled: true, foldersEnabled: true },
  );
  assert.equal(projection.folders.length, 2);
  assert.notEqual(projection.folders[0]?.folder.id, projection.folders[1]?.folder.id);
});
