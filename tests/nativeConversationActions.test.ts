import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  classifyNativeConversationMenuAction,
  resolveExactNativeConversationAction,
} from "../src/adapters/chatgpt/nativeConversationActions";

test("exact conversation ID resolves its single native action trigger", () => {
  const trigger = { id: "native-menu" };
  assert.deepEqual(resolveExactNativeConversationAction("chat-a", 1, [{
    conversationIds: ["chat-a"],
    triggers: [trigger],
    wolfOwned: false,
  }]), { status: "available", trigger });
});

test("titles and row position are not inputs to native action targeting", () => {
  const wrong = { id: "wrong" };
  const correct = { id: "correct" };
  assert.deepEqual(resolveExactNativeConversationAction("chat-b", 1, [
    { conversationIds: ["chat-a"], triggers: [wrong], wolfOwned: false },
    { conversationIds: ["chat-b"], triggers: [correct], wolfOwned: false },
  ]), { status: "available", trigger: correct });
});

test("unmounted native row reports unavailable", () => {
  assert.deepEqual(resolveExactNativeConversationAction("chat-a", 0, []), {
    status: "unavailable",
    reason: "row-not-mounted",
  });
});

test("missing native action trigger fails closed", () => {
  assert.deepEqual(resolveExactNativeConversationAction("chat-a", 1, []), {
    status: "unavailable",
    reason: "action-not-found",
  });
});

test("ambiguous row identities and duplicate native rows refuse delegation", () => {
  assert.deepEqual(resolveExactNativeConversationAction("chat-a", 1, [{
    conversationIds: ["chat-a", "chat-b"],
    triggers: [{ id: "uncertain" }],
    wolfOwned: false,
  }]), { status: "unavailable", reason: "ambiguous" });
  assert.deepEqual(resolveExactNativeConversationAction("chat-a", 2, [
    { conversationIds: ["chat-a"], triggers: [{ id: "first" }], wolfOwned: false },
    { conversationIds: ["chat-a"], triggers: [{ id: "second" }], wolfOwned: false },
  ]), { status: "unavailable", reason: "ambiguous" });
});

test("Wolf-owned rows are excluded from native action resolution", () => {
  assert.deepEqual(resolveExactNativeConversationAction("chat-a", 1, [{
    conversationIds: ["chat-a"],
    triggers: [{ id: "wolf-menu" }],
    wolfOwned: true,
  }]), { status: "unavailable", reason: "action-not-found" });
});

test("Quick Access actions delegate through the native trigger without navigation or destructive APIs", () => {
  const adapter = readFileSync(
    path.join(process.cwd(), "src/adapters/chatgpt/ChatGPTAdapter.ts"),
    "utf8",
  );
  const sidebar = readFileSync(
    path.join(process.cwd(), "src/features/quickAccess/QuickAccessSidebar.ts"),
    "utf8",
  );
  const integration = readFileSync(
    path.join(process.cwd(), "src/features/quickAccess/QuickAccessMenuIntegration.ts"),
    "utf8",
  );
  assert.match(sidebar, /onOpenConversationMenu\(conversation, button\)/);
  assert.match(integration, /openNativeConversationActions\(normalized\.conversation\.conversationId\)/);
  assert.match(adapter, /trigger\.click\(\)/);
  assert.doesNotMatch(adapter, /(?:fetch|XMLHttpRequest|document\.cookie)\s*\(/);
  assert.doesNotMatch(sidebar, /location\.(?:assign|replace)|history\.(?:pushState|replaceState)/);
});

test("only supported ChatGPT-owned conversation actions are proxied", () => {
  assert.equal(classifyNativeConversationMenuAction("Rename"), "rename");
  assert.equal(classifyNativeConversationMenuAction("Pin chat"), "pin");
  assert.equal(classifyNativeConversationMenuAction("Unpin"), "unpin");
  assert.equal(classifyNativeConversationMenuAction("Archive"), "archive");
  assert.equal(classifyNativeConversationMenuAction("Delete"), "delete");
  assert.equal(classifyNativeConversationMenuAction("Move to project"), "move-to-project");
  assert.equal(classifyNativeConversationMenuAction("Share"), "share");
  assert.equal(classifyNativeConversationMenuAction("Move to Folder"), null);
});

test("sanitized native-menu evidence exposes semantic actions and a separate Wolf subtree", () => {
  const html = readFileSync(
    path.join(
      process.cwd(),
      "tests/fixtures/chatgpt-dom/chatgpt-native-conversation-menu-open.sanitized.html",
    ),
    "utf8",
  );
  const wolfRegionIndex = html.indexOf('data-wolf-expansion="quick-access-menu-actions"');
  assert.ok(wolfRegionIndex > 0);
  const nativeRegion = html.slice(0, wolfRegionIndex);
  for (const label of ["Rename", "Pin chat", "Archive", "Delete"]) {
    assert.match(nativeRegion, new RegExp(`\\b${label}\\b`, "u"));
    assert.notEqual(classifyNativeConversationMenuAction(label), null);
  }
  assert.match(html.slice(wolfRegionIndex), /Remove from Quick Access/u);
});

test("Delete delegation stops at the native menuitem and leaves confirmation to ChatGPT", () => {
  const dialog = readFileSync(
    path.join(
      process.cwd(),
      "tests/fixtures/chatgpt-dom/chatgpt-delete-confirmation-dialog.sanitized.html",
    ),
    "utf8",
  );
  const integration = readFileSync(
    path.join(process.cwd(), "src/features/quickAccess/QuickAccessMenuIntegration.ts"),
    "utf8",
  );
  assert.match(dialog, /data-testid="delete-conversation-confirm-button"/u);
  assert.doesNotMatch(integration, /delete-conversation-confirm-button/u);
});

test("native Rename remains menu-owned and no Wolf alias write is introduced", () => {
  const sidebar = readFileSync(
    path.join(process.cwd(), "src/features/quickAccess/QuickAccessSidebar.ts"),
    "utf8",
  );
  assert.doesNotMatch(sidebar, /(?:renameConversation|conversationAlias|setConversationTitle)\s*\(/);
});

test("existing native portal integration owns Wolf action injection and deduplicates containers", () => {
  const integration = readFileSync(
    path.join(process.cwd(), "src/features/quickAccess/QuickAccessMenuIntegration.ts"),
    "utf8",
  );
  assert.match(integration, /watchConversationMenus/);
  assert.match(integration, /element !== matching/);
  assert.match(integration, /if \(!matching\) \{\s*context\.menu\.append\(container\);/s);
  assert.doesNotMatch(integration, /document\.body\.append\(context\.menu\)/);
});
