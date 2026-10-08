import assert from "node:assert/strict";
import test from "node:test";
import {
  createConversationUrl,
  parseConversationId,
  parseConversationUrl,
} from "../src/adapters/chatgpt/conversationUrl";
import { CHATGPT_SELECTORS } from "../src/adapters/chatgpt/selectors";

const conversationId = "12345678-1234-1234-1234-123456789abc";

test("extracts an ID from absolute and relative ChatGPT conversation URLs", () => {
  assert.equal(parseConversationId(`https://chatgpt.com/c/${conversationId}`), conversationId);
  assert.equal(parseConversationId(`/c/${conversationId}`), conversationId);
});

test("accepts safe future non-UUID conversation IDs", () => {
  assert.equal(parseConversationId("/c/future-id_abc.123"), "future-id_abc.123");
});

test("parses and creates both supported conversation routes", () => {
  assert.deepEqual(parseConversationUrl(`/c/${conversationId}`), {
    conversationId,
    route: "c",
    canonicalUrl: `https://chatgpt.com/c/${conversationId}`,
  });
  assert.deepEqual(parseConversationUrl(`https://chatgpt.com/g/${conversationId}?view=1#latest`), {
    conversationId,
    route: "g",
    canonicalUrl: `https://chatgpt.com/g/${conversationId}`,
  });
  assert.equal(createConversationUrl(conversationId, "c"), `https://chatgpt.com/c/${conversationId}`);
  assert.equal(createConversationUrl(conversationId, "g"), `https://chatgpt.com/g/${conversationId}`);
});

test("preserves current project conversation locations", () => {
  const projectId = "g-p-PROJECT_fixture_123";
  const parsed = parseConversationUrl(`/g/${projectId}/c/${conversationId}?view=1#latest`);
  assert.deepEqual(parsed, {
    conversationId,
    route: "g",
    projectId,
    canonicalUrl: `https://chatgpt.com/g/${projectId}/c/${conversationId}`,
  });
  assert.equal(
    createConversationUrl(conversationId, "g", projectId),
    `https://chatgpt.com/g/${projectId}/c/${conversationId}`,
  );
});

test("rejects unrelated origins, paths, and encoded separators", () => {
  assert.equal(parseConversationId(`https://example.com/c/${conversationId}`), null);
  assert.equal(parseConversationId(`/g/${conversationId}`), conversationId);
  assert.equal(parseConversationId(`/c/${conversationId}/messages`), null);
  assert.equal(parseConversationId("/c/not%2Fa-row"), null);
  assert.equal(parseConversationId(`/x/${conversationId}`), null);
  assert.equal(parseConversationId(`/g/${conversationId}/messages`), null);
  assert.equal(parseConversationId(`/g/not-a-project/c/${conversationId}`), null);
  assert.equal(parseConversationId(`/g/g-p-project/c/${conversationId}/messages`), null);
});

test("native sidebar discovery selector includes both supported route families", () => {
  assert.match(CHATGPT_SELECTORS.conversationLink, /href\^="\/c\/"/);
  assert.match(CHATGPT_SELECTORS.conversationLink, /href\^="\/g\/"/);
});
