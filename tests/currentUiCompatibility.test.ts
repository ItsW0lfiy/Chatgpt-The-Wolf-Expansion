import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveChatGPTAccountEvidence } from "../src/accounts/accountIdentity";
import { parseConversationUrl } from "../src/adapters/chatgpt/conversationUrl";
import { CHATGPT_SELECTORS } from "../src/adapters/chatgpt/selectors";

const fixture = (name: string): string => readFileSync(
  path.join(process.cwd(), "tests", "fixtures", "chatgpt-dom", name),
  "utf8",
);

test("current conversation rows retain semantic identity and action anchors", () => {
  const normal = fixture("chatgpt-conversation-row-c-current-2026-09-27.sanitized.html");
  const project = fixture("chatgpt-conversation-row-g-project-current-2026-09-27.sanitized.html");
  for (const row of [normal, project]) {
    assert.match(row, /role="listitem"/u);
    assert.match(row, /data-thread-title-trigger="true"/u);
    assert.match(row, /data-interactive-row-link="true"/u);
    assert.match(row, /<button[^>]*aria-haspopup="menu"[^>]*aria-label="Chat actions"/u);
  }
  assert.doesNotMatch(normal, /data-conversation-options-trigger=/u);
  assert.doesNotMatch(project, /data-conversation-options-trigger=/u);
  assert.match(CHATGPT_SELECTORS.conversationMenuTrigger, /Chat actions/u);
});

test("current project row resolves its conversation segment without losing project location", () => {
  const project = fixture("chatgpt-conversation-row-g-project-current-2026-09-27.sanitized.html");
  const href = project.match(/href="([^"]+)"/u)?.[1];
  assert.ok(href);
  const parsed = parseConversationUrl(href, "https://chatgpt.com/");
  assert.ok(parsed);
  assert.equal(parsed.route, "g");
  assert.match(parsed.projectId ?? "", /^g-p-/u);
  assert.match(parsed.canonicalUrl, /^https:\/\/chatgpt\.com\/g\/g-p-[^/]+\/c\/[^/?#]+$/u);
  assert.equal(parsed.canonicalUrl, new URL(href, "https://chatgpt.com/").href);
});

test("current menu remains a semantic Radix menu without action-specific test IDs", () => {
  const menu = fixture("chatgpt-conversation-menu-current-2026-09-27.sanitized.html");
  assert.match(menu, /role="menu"[^>]*data-radix-menu-content/u);
  for (const action of ["Rename", "Move to project", "Share", "Archive", "Delete"]) {
    assert.match(menu, new RegExp(`>${action}<`, "u"));
  }
  assert.doesNotMatch(menu, /data-testid="(?:rename|pin|archive|delete)[^"]*"/iu);
});

test("current sidebar preserves a semantic root, scroll body, and native sections", () => {
  const sidebar = fixture("chatgpt-sidebar-current-2026-09-27.sanitized.html");
  assert.match(sidebar, /<nav[^>]*aria-label="Chat history"/u);
  assert.match(sidebar, /data-app-action-sidebar-scroll=/u);
  assert.match(sidebar, /data-app-action-sidebar-section-heading="Pinned"/u);
  assert.match(sidebar, /data-sidebar-project-container-id="pinned"/u);
  assert.match(sidebar, />Pinned</u);
  assert.match(sidebar, />Projects</u);
  assert.match(sidebar, />Recents</u);
});

test("sidebar adapter accepts both current and previous semantic navigation roots", () => {
  assert.ok(CHATGPT_SELECTORS.sidebarCandidates.includes('nav[aria-label="Sidebar"]'));
  assert.ok(CHATGPT_SELECTORS.sidebarCandidates.includes('nav[aria-label="Chat history"]'));
  assert.equal(CHATGPT_SELECTORS.sidebarScrollBody, "[data-app-action-sidebar-scroll]");
  assert.match(CHATGPT_SELECTORS.sidebarSection, /data-app-action-sidebar-section-heading/u);
  assert.match(CHATGPT_SELECTORS.sidebarSectionContainer, /data-sidebar-project-container-id/u);
});

test("current row keeps native controls in a shared trailing rail", () => {
  const row = fixture("chatgpt-sidebar-current-2026-09-27.sanitized.html");
  const actionButton = row.indexOf('aria-label="Chat actions"');
  const pinButton = row.indexOf('aria-label="Pin chat"');
  assert.ok(actionButton >= 0);
  assert.ok(pinButton > actionButton);
  assert.match(
    row.slice(Math.max(0, actionButton - 1200), pinButton + 200),
    /flex items-center[^>]*justify-end/u,
  );
});

test("current routed settings app is not mistaken for a conversation page", () => {
  const settings = fixture("chatgpt-settings-app-current-2026-09-27.sanitized.html");
  assert.match(settings, /general-settings/u);
  assert.equal(parseConversationUrl("https://chatgpt.com/settings/general-settings"), null);
});

test("current profile control establishes presence but not a stable account scope", () => {
  const account = fixture("chatgpt-account-control-current-2026-09-27.sanitized.html");
  const profileMenu = fixture("chatgpt-profile-menu-current-2026-09-27.sanitized.html");
  assert.match(account, /aria-label="Open profile menu"[^>]*aria-haspopup="menu"/u);
  assert.match(profileMenu, /data-testid="workspace-switcher-trigger"/u);
  assert.match(CHATGPT_SELECTORS.accountProfileButton, /Open profile menu/u);
  assert.deepEqual(resolveChatGPTAccountEvidence({
    baseUrl: "https://chatgpt.com/",
    loggedOutControlVisible: false,
    profileImageSource: "data:image/png;base64,SANITIZED",
    profilePresent: true,
  }), { state: "unresolved", reason: "invalid-profile-user-id" });

  assert.deepEqual(resolveChatGPTAccountEvidence({
    baseUrl: "https://chatgpt.com/",
    loggedOutControlVisible: false,
    profileImageSource: "data:image/png;base64,SANITIZED",
    profilePresent: true,
    renderedThemeUserId: "user-EXAMPLEACCOUNT123",
  }), {
    state: "identified",
    source: "rendered-theme-user-id",
    identity: "chatgpt-user-id:user-EXAMPLEACCOUNT123",
  });
});
