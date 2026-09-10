import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConversationIdentity } from "../src/adapters/chatgpt/conversationIdentity";
import { FavoritesRepository } from "../src/features/favorites/FavoritesRepository";
import { createFavoriteListView } from "../src/features/favorites/favoritesViewModel";
import { MemoryStorage } from "./helpers/MemoryStorage";

function conversation(conversationId: string, title = conversationId) {
  return {
    conversationId,
    route: "c" as const,
    title,
    url: `https://chatgpt.com/c/${conversationId}`,
  };
}

test("adds a Favorite and prevents duplicate identity records", async () => {
  const repository = new FavoritesRepository(new MemoryStorage());
  await repository.add(conversation("chat-a", "First title"));
  await repository.add(conversation("chat-a", "Updated title"));

  const favorites = await repository.list();
  assert.equal(favorites.length, 1);
  assert.equal(favorites[0]?.conversationId, "chat-a");
  assert.equal(favorites[0]?.title, "Updated title");
});

test("removes a Favorite without affecting other records", async () => {
  const repository = new FavoritesRepository(new MemoryStorage());
  await repository.add(conversation("chat-a"));
  await repository.add(conversation("chat-b"));
  await repository.remove("chat-a");

  assert.deepEqual(
    (await repository.list()).map((favorite) => favorite.conversationId),
    ["chat-b"],
  );
});

test("re-adds a previously removed conversation", async () => {
  const repository = new FavoritesRepository(new MemoryStorage());
  await repository.add(conversation("chat-returning", "First title"));
  await repository.remove("chat-returning");
  await repository.add(conversation("chat-returning", "Returning title"));

  const favorites = await repository.list();
  assert.equal(favorites.length, 1);
  assert.equal(favorites[0]?.conversationId, "chat-returning");
  assert.equal(favorites[0]?.title, "Returning title");
});

test("stores only schema fields from a sidebar reference with non-cloneable extras", async () => {
  const repository = new FavoritesRepository(new MemoryStorage());
  const sidebarReference = {
    ...conversation("chat-sidebar", "Sidebar title"),
    link: () => "simulated non-cloneable DOM reference",
  };

  await repository.add(sidebarReference);
  assert.deepEqual(Object.keys((await repository.list())[0]!).sort(), [
    "addedAt",
    "conversationId",
    "route",
    "sortIndex",
    "title",
    "url",
  ]);
});

test("adds normalized sidebar-style and top-right-style identities", async () => {
  const repository = new FavoritesRepository(new MemoryStorage());
  const sidebarInput = {
    conversationId: "chat-sidebar-normalized",
    title: "Sidebar",
    url: "/c/chat-sidebar-normalized",
    link: { simulatedDomReference: true },
  };
  const sidebar = normalizeConversationIdentity(sidebarInput);
  const topRight = normalizeConversationIdentity({
    conversationId: "chat-top-normalized",
    title: "Top right",
    url: "https://chatgpt.com/c/chat-top-normalized",
  });
  assert.equal(sidebar.ok, true);
  assert.equal(topRight.ok, true);
  if (!sidebar.ok || !topRight.ok) {
    return;
  }

  await repository.add(sidebar.conversation);
  await repository.add(topRight.conversation);
  assert.deepEqual(
    (await repository.list()).map((favorite) => favorite.conversationId),
    ["chat-sidebar-normalized", "chat-top-normalized"],
  );
});

test("persists manual ordering and normalizes sort indexes", async () => {
  const repository = new FavoritesRepository(new MemoryStorage());
  await repository.add(conversation("chat-a"));
  await repository.add(conversation("chat-b"));
  await repository.add(conversation("chat-c"));
  await repository.reorder(["chat-c", "chat-a", "chat-b"]);

  const favorites = await repository.list();
  assert.deepEqual(
    favorites.map((favorite) => favorite.conversationId),
    ["chat-c", "chat-a", "chat-b"],
  );
  assert.deepEqual(
    favorites.map((favorite) => favorite.sortIndex),
    [0, 1, 2],
  );
});

test("repository add emits a change and produces a renderable Favorite item", async () => {
  const repository = new FavoritesRepository(new MemoryStorage());
  const events: string[] = [];
  const unsubscribe = repository.subscribe((event) => events.push(event.type));

  await repository.add(conversation("chat-visible", "Visible Favorite"));
  const items = createFavoriteListView(await repository.list());
  unsubscribe();

  assert.ok(events.includes("added"));
  assert.deepEqual(items, [
    {
      conversationId: "chat-visible",
      title: "Visible Favorite",
      url: "https://chatgpt.com/c/chat-visible",
    },
  ]);
});
