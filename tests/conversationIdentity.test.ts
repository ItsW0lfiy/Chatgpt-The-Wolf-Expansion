import assert from "node:assert/strict";
import test from "node:test";
import {
  collectDetectedConversationMetadata,
  normalizeConversationIdentity,
  normalizeConversationTitle,
  selectConversationTitle,
  selectConversationTitleWithSource,
} from "../src/adapters/chatgpt/conversationIdentity";

test("normalizes sidebar and top-right inputs to the same plain identity shape", () => {
  const sidebarInput = {
    conversationId: "chat-a",
    title: "Sidebar title",
    url: "https://chatgpt.com/c/chat-a",
    link: { nonCloneableDomPlaceholder: true },
  };
  const topRightInput = {
    conversationId: "chat-b",
    title: "Top-right title",
    url: "https://chatgpt.com/c/chat-b",
  };

  assert.deepEqual(normalizeConversationIdentity(sidebarInput), {
    ok: true,
    conversation: {
      conversationId: "chat-a",
      route: "c",
      title: "Sidebar title",
      url: "https://chatgpt.com/c/chat-a",
    },
    titleResolved: true,
  });
  assert.deepEqual(normalizeConversationIdentity(topRightInput), {
    ok: true,
    conversation: {
      conversationId: "chat-b",
      route: "c",
      title: "Top-right title",
      url: "https://chatgpt.com/c/chat-b",
    },
    titleResolved: true,
  });
});

test("rejects malformed or mismatched conversation identity", () => {
  assert.equal(
    normalizeConversationIdentity({ title: "Missing ID", url: "/c/chat-a" }).ok,
    false,
  );
  assert.equal(
    normalizeConversationIdentity({
      conversationId: "chat-a",
      title: "Wrong URL",
      url: "https://chatgpt.com/c/chat-b",
    }).ok,
    false,
  );
  assert.equal(
    normalizeConversationIdentity({
      conversationId: "chat-a",
      title: "Wrong origin",
      url: "https://example.com/c/chat-a",
    }).ok,
    false,
  );
});

test("normalizes surviving group-chat routes without forcing them to /c/", () => {
  assert.deepEqual(normalizeConversationIdentity({
    conversationId: "group-chat",
    route: "g",
    title: "Retired group chat",
    url: "/g/group-chat?from=sidebar",
  }), {
    ok: true,
    conversation: {
      conversationId: "group-chat",
      route: "g",
      title: "Retired group chat",
      url: "https://chatgpt.com/g/group-chat",
    },
    titleResolved: true,
  });
  assert.equal(normalizeConversationIdentity({
    conversationId: "group-chat",
    route: "c",
    title: "Mismatch",
    url: "/g/group-chat",
  }).ok, false);
});

test("uses a safe title fallback without changing conversation identity", () => {
  assert.deepEqual(
    normalizeConversationIdentity({
      conversationId: "chat-untitled",
      title: "   ",
      url: "/c/chat-untitled",
    }),
    {
      ok: true,
      conversation: {
        conversationId: "chat-untitled",
        route: "c",
        title: "Untitled conversation",
        url: "https://chatgpt.com/c/chat-untitled",
      },
      titleResolved: false,
    },
  );
});

test("preserves literal conversation titles that mention Pinned or OpenAI Pin", () => {
  const literalTitles = [
    "Pinned: Test Chat",
    "Test Chat (Pinned)",
    "Something — Pinned",
    "Test Chat [Pinned]",
    "OpenAI Pin",
    "Pinned",
    "My (Pinned) Notes",
    "Pinned:",
  ];

  for (const title of literalTitles) {
    assert.equal(normalizeConversationTitle(title), title);
  }
});

test("normalizes only extraction whitespace without interpreting title content", () => {
  assert.equal(
    normalizeConversationTitle("  Pinned:\n  Test\tChat  "),
    "Pinned: Test Chat",
  );
});

test("prefers current visible row text over stale title attributes", () => {
  assert.equal(selectConversationTitle({
    visibleText: "New live title",
    ariaLabel: "Old aria title",
    titleAttribute: "Old title attribute",
  }), "New live title");
  assert.equal(selectConversationTitle({
    visibleText: "   ",
    ariaLabel: "Accessible fallback",
    titleAttribute: "Tooltip fallback",
  }), "Accessible fallback");
  assert.deepEqual(selectConversationTitleWithSource({
    visibleText: "",
    textContentFallback: "Hidden or detached fallback",
    ariaLabel: "Stale accessible title",
  }), {
    source: "text-content-fallback",
    title: "Hidden or detached fallback",
  });
});

test("detected metadata rejects unresolved and conflicting transitional titles", () => {
  const detected = collectDetectedConversationMetadata([
    {
      conversationId: "stable",
      title: "Stable title",
      url: "/c/stable",
      titleResolved: true,
    },
    {
      conversationId: "blank",
      title: "Untitled conversation",
      url: "/c/blank",
      titleResolved: false,
    },
    {
      conversationId: "renaming",
      title: "Old title",
      url: "/c/renaming",
      titleResolved: true,
    },
    {
      conversationId: "renaming",
      title: "New title",
      url: "/c/renaming",
      titleResolved: true,
    },
  ]);

  assert.deepEqual([...detected.entries()], [[
    "stable",
    { title: "Stable title", route: "c", url: "https://chatgpt.com/c/stable" },
  ]]);
});

test("a single changed duplicate supersedes the cached title during native row replacement", () => {
  const detected = collectDetectedConversationMetadata([
    {
      conversationId: "renaming",
      title: "Old title",
      url: "/c/renaming",
      titleResolved: true,
    },
    {
      conversationId: "renaming",
      title: "New title",
      url: "/c/renaming",
      titleResolved: true,
    },
  ], new Map([["renaming", "Old title"]]));

  assert.deepEqual(detected.get("renaming"), {
    title: "New title",
    route: "c",
    url: "https://chatgpt.com/c/renaming",
  });
});

test("conflicting native candidates remain rejected without one cached-title successor", () => {
  const detected = collectDetectedConversationMetadata([
    {
      conversationId: "ambiguous",
      title: "First",
      url: "/c/ambiguous",
      titleResolved: true,
    },
    {
      conversationId: "ambiguous",
      title: "Second",
      url: "/c/ambiguous",
      titleResolved: true,
    },
  ], new Map([["ambiguous", "Neither"]]));
  assert.equal(detected.has("ambiguous"), false);
});

test("one changed route supersedes a duplicate using the cached URL", () => {
  const detected = collectDetectedConversationMetadata([
    {
      conversationId: "project-moved",
      title: "Same title",
      url: "/c/project-moved",
      titleResolved: true,
    },
    {
      conversationId: "project-moved",
      title: "Same title",
      url: "/g/project-moved",
      titleResolved: true,
    },
  ], new Map([[
    "project-moved",
    { title: "Same title", url: "https://chatgpt.com/c/project-moved" },
  ]]));
  assert.deepEqual(detected.get("project-moved"), {
    title: "Same title",
    route: "g",
    url: "https://chatgpt.com/g/project-moved",
  });
});
