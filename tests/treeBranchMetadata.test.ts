import assert from "node:assert/strict";
import test from "node:test";
import {
  createTreeBranchMetadata,
  getChildAncestorContinuations,
} from "../src/features/quickAccess/treeBranchMetadata";
import { buildQuickAccessProjection } from "../src/features/quickAccess/quickAccessProjection";
import type {
  FavoriteConversation,
  FolderConversationMembership,
  FolderRecord,
} from "../src/storage/schemas";

function folder(id: string, parentId: string | null, sortIndex: number): FolderRecord {
  return { id, name: id, parentId, sortIndex, createdAt: sortIndex + 1, collapsed: false };
}

function favorite(id: string, sortIndex: number): FavoriteConversation {
  return {
    conversationId: id,
    route: "c",
    title: id,
    url: `https://chatgpt.com/c/${id}`,
    addedAt: sortIndex + 1,
    sortIndex,
  };
}

function membership(
  conversationId: string,
  folderId: string,
  sortIndex: number,
): FolderConversationMembership {
  return {
    conversationId,
    route: "c",
    folderId,
    title: conversationId,
    url: `https://chatgpt.com/c/${conversationId}`,
    assignedAt: sortIndex + 1,
    sortIndex,
  };
}

test("final and continuing sibling branches are explicit runtime metadata", () => {
  const first = createTreeBranchMetadata(1, 0, 2, []);
  const last = createTreeBranchMetadata(1, 1, 2, []);
  assert.equal(first.isLastSibling, false);
  assert.equal(last.isLastSibling, true);
  assert.deepEqual(first.ancestorHasNextSibling, []);
});

test("nested branch carries continuation only when its non-root ancestor has a later sibling", () => {
  const root = createTreeBranchMetadata(0, 0, 2, []);
  const directChild = createTreeBranchMetadata(
    1,
    0,
    2,
    getChildAncestorContinuations(root),
  );
  const nested = createTreeBranchMetadata(
    2,
    0,
    1,
    getChildAncestorContinuations(directChild),
  );
  assert.deepEqual(directChild.ancestorHasNextSibling, []);
  assert.deepEqual(nested.ancestorHasNextSibling, [true]);
});

test("projection gives root chats no connector and actual children branch metadata", () => {
  const folders = [folder("development", null, 0), folder("concepts", "development", 0)];
  const favorites = [favorite("concept-chat", 0), favorite("root-chat", 1)];
  const memberships = [membership("concept-chat", "concepts", 0)];
  const projection = buildQuickAccessProjection(favorites, folders, memberships, {
    quickAccessEnabled: true,
    foldersEnabled: true,
  });
  const rootChat = projection.looseChats[0]!;
  const concepts = projection.folders[0]!.folders[0]!;
  const conceptChat = concepts.chats[0]!;
  assert.equal(rootChat.branch.depth, 0);
  assert.deepEqual(rootChat.branch.ancestorHasNextSibling, []);
  assert.equal(concepts.branch.depth, 1);
  assert.equal(conceptChat.branch.depth, 2);
});

test("folders-before-chats produces continuing then final child branch states", () => {
  const folders = [folder("development", null, 0), folder("concepts", "development", 0)];
  const favorites = [favorite("chat", 0)];
  const memberships = [membership("chat", "development", 0)];
  const projection = buildQuickAccessProjection(favorites, folders, memberships, {
    quickAccessEnabled: true,
    foldersEnabled: true,
  });
  const development = projection.folders[0]!;
  assert.equal(development.folders[0]!.branch.isLastSibling, false);
  assert.equal(development.chats[0]!.branch.isLastSibling, true);
});

test("reorder and cross-parent movement recalculate branch ancestry", () => {
  const initialFolders = [
    folder("a", null, 0),
    folder("b", null, 1),
    folder("child", "a", 0),
  ];
  const before = buildQuickAccessProjection([], initialFolders, [], {
    quickAccessEnabled: true,
    foldersEnabled: true,
  });
  assert.equal(before.folders[0]!.folders[0]!.branch.depth, 1);

  const movedFolders = initialFolders.map((item) => ({
    ...item,
    parentId: item.id === "child" ? "b" : item.parentId,
    sortIndex: item.id === "b" ? 0 : item.id === "a" ? 1 : item.sortIndex,
  }));
  const after = buildQuickAccessProjection([], movedFolders, [], {
    quickAccessEnabled: true,
    foldersEnabled: true,
  });
  assert.equal(after.folders[0]!.folder.id, "b");
  assert.equal(after.folders[0]!.folders[0]!.folder.id, "child");
  assert.equal(after.folders[0]!.folders[0]!.branch.depth, 1);
});

test("moving a foldered chat to root removes all connector ancestry", () => {
  const folders = [folder("folder", null, 0)];
  const favorites = [favorite("chat", 0)];
  const filed = buildQuickAccessProjection(
    favorites,
    folders,
    [membership("chat", "folder", 0)],
    { quickAccessEnabled: true, foldersEnabled: true },
  );
  assert.equal(filed.folders[0]!.chats[0]!.branch.depth, 1);
  const root = buildQuickAccessProjection(favorites, folders, [], {
    quickAccessEnabled: true,
    foldersEnabled: true,
  });
  assert.equal(root.looseChats[0]!.branch.depth, 0);
  assert.deepEqual(root.looseChats[0]!.branch.ancestorHasNextSibling, []);
});

test("branch metadata exists only in projection and not persistent records", () => {
  assert.doesNotMatch(JSON.stringify(folder("folder", null, 0)), /branch|ancestorHasNextSibling/);
  assert.doesNotMatch(JSON.stringify(favorite("chat", 0)), /branch|ancestorHasNextSibling/);
  assert.doesNotMatch(JSON.stringify(membership("chat", "folder", 0)), /branch|ancestorHasNextSibling/);
});
