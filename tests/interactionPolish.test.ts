import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  getAnchoredMenuPosition,
  LocalConversationMenuController,
} from "../src/features/quickAccess/localConversationMenu";
import { FreshNativeActionRequestController } from "../src/features/quickAccess/freshNativeAction";
import { NativeRenameDraftController } from "../src/features/quickAccess/nativeRenameDraft";
import { resolveUniqueNativeConversationMenuAction } from "../src/adapters/chatgpt/nativeConversationActions";

const read = (file: string): string => readFileSync(path.join(process.cwd(), file), "utf8");

test("local menu state is exact-ID keyed and opening another row replaces it", () => {
  const controller = new LocalConversationMenuController();
  const first = controller.open("chat-a");
  const second = controller.open("chat-b");
  assert.equal(controller.activeState?.conversationId, "chat-b");
  assert.equal(controller.setNativeAvailability(first.requestId, "available"), false);
  assert.equal(controller.setNativeAvailability(second.requestId, "available"), true);
  assert.equal(controller.activeState?.nativeAvailability, "available");
});

test("local menu closes only the current request and stale close cannot dismiss a replacement", () => {
  const controller = new LocalConversationMenuController();
  const first = controller.open("chat-a");
  const second = controller.open("chat-b");
  assert.equal(controller.close(first.requestId), null);
  assert.equal(controller.activeState?.conversationId, "chat-b");
  assert.equal(controller.close(second.requestId)?.conversationId, "chat-b");
  assert.equal(controller.activeState, null);
});

test("anchored local menu stays within the viewport and flips above when needed", () => {
  assert.deepEqual(getAnchoredMenuPosition(
    { bottom: 130, left: 40, right: 240, top: 100 },
    { height: 160, width: 180 },
    { height: 600, width: 400 },
  ), { left: 60, top: 134 });
  assert.deepEqual(getAnchoredMenuPosition(
    { bottom: 590, left: 260, right: 390, top: 560 },
    { height: 160, width: 180 },
    { height: 600, width: 400 },
  ), { left: 210, top: 396 });
});

test("native rename drafts are runtime-only and cannot cross conversation IDs", () => {
  const controller = new NativeRenameDraftController();
  controller.begin("chat-a", 10);
  assert.equal(controller.update("chat-b", "Wrong"), false);
  assert.equal(controller.update("chat-a", "Pinned: Literal draft"), true);
  assert.deepEqual(controller.activeState, {
    conversationId: "chat-a",
    draft: "Pinned: Literal draft",
    startedAt: 10,
  });
  assert.equal(controller.finish("chat-b"), null);
  assert.equal(controller.finish("chat-a")?.draft, "Pinned: Literal draft");
  assert.equal(controller.activeState, null);
});

test("Quick Access local menu remains Wolf-owned while native action DOM stays native-owned", () => {
  const integration = read("src/features/quickAccess/QuickAccessMenuIntegration.ts");
  const adapter = read("src/adapters/chatgpt/ChatGPTAdapter.ts");
  assert.match(integration, /createWolfElement\("div", "quick-access-local-menu"\)/);
  assert.match(integration, /document\.body\.append\(menu\)/);
  assert.match(integration, /hideNativeConversationMenuForProxy\(context\.menu\)/);
  assert.match(integration, /activateNativeConversationMenuAction\(\s*context\.menu,\s*request\.kind/s);
  assert.match(integration, /FreshNativeActionRequestController/);
  assert.doesNotMatch(integration, /localNativeMenu\s*:/);
  assert.doesNotMatch(integration, /append\(context\.menu\)|appendChild\(context\.menu\)/);
  assert.match(adapter, /action\.click\(\)/);
  assert.doesNotMatch(integration, /(?:fetch|XMLHttpRequest|document\.cookie)\s*\(/);
});

test("unavailable native actions do not remove Wolf-owned local actions", () => {
  const integration = read("src/features/quickAccess/QuickAccessMenuIntegration.ts");
  assert.match(integration, /ChatGPT actions unavailable right now/);
  assert.match(integration, /wolfRegion\.append\(membershipAction\)/);
  assert.match(integration, /Move to Quick Access root/);
});

test("outside pointer and Escape close the local menu without blocking unrelated clicks", () => {
  const integration = read("src/features/quickAccess/QuickAccessMenuIntegration.ts");
  assert.match(integration, /document\.addEventListener\("pointerdown", this\.handleOutsidePointer, true\)/);
  assert.match(integration, /if \(event\.key === "Escape"\)/);
  const outsideHandler = integration.slice(
    integration.indexOf("handleOutsidePointer"),
    integration.indexOf("handleDocumentKeydown"),
  );
  assert.doesNotMatch(outsideHandler, /preventDefault|stopPropagation/);
});

test("active Quick Access row is driven only by current conversation ID", () => {
  const sidebar = read("src/features/quickAccess/QuickAccessSidebar.ts");
  const feature = read("src/features/quickAccess/QuickAccessFeature.ts");
  assert.match(feature, /const currentId = this\.adapter\.getCurrentConversationId\(\)/);
  assert.match(sidebar, /chat\.conversationId === this\.currentConversationId/);
  assert.match(sidebar, /link\.setAttribute\("aria-current", "page"\)/);
  assert.doesNotMatch(sidebar, /native.*class.*current|title ===.*currentConversation/iu);
});

test("native rename preview updates only rendered text and canonical refresh owns completion", () => {
  const sidebar = read("src/features/quickAccess/QuickAccessSidebar.ts");
  const feature = read("src/features/quickAccess/QuickAccessFeature.ts");
  const integration = read("src/features/quickAccess/QuickAccessMenuIntegration.ts");
  assert.match(sidebar, /titlePreviews = new Map<string, string>\(\)/);
  assert.match(sidebar, /text\.textContent = title/);
  assert.match(feature, /await this\.refresh\("sidebar"\);\s*this\.sidebar\.clearConversationTitlePreview/s);
  const inputHandler = integration.slice(
    integration.indexOf("handleNativeRenameInput"),
    integration.indexOf("handleNativeRenameFocusOut"),
  );
  assert.doesNotMatch(inputHandler, /favoritesRepository|foldersRepository|storage/);
});

test("section spacing and shared settings-description inset are section-level contracts", () => {
  const quickCss = read("src/features/quickAccess/quick-access.css");
  const chatSettingsCss = read("src/features/settings/in-chat-settings.css");
  const optionsCss = read("src/settings/options/options.css");
  assert.match(quickCss, /--sidebar-expanded-section-margin-bottom/);
  assert.doesNotMatch(quickCss, /wolf-quick-access-chat:last-child[^}]*margin-bottom/);
  assert.match(chatSettingsCss, /\.wolf-settings-group-description\s*\{[^}]*padding-inline:\s*0\.3rem;/s);
  assert.match(optionsCss, /\.group-description\s*\{[^}]*padding-inline:\s*0\.25rem;/s);
});

test("title reveal suppresses overlaid controls and remeasures the full viewport", () => {
  const sidebar = read("src/features/quickAccess/QuickAccessSidebar.ts");
  const css = read("src/features/quickAccess/quick-access.css");
  assert.match(sidebar, /getItemNameReadableViewport/);
  assert.match(sidebar, /getItemNameRevealWidth\(viewport\.clientWidth, 0, true\)/);
  assert.match(css, /data-reveal-active="true"[\s\S]*\.wolf-quick-access-controls[\s\S]*pointer-events:\s*none/s);
  assert.match(css, /visibility:\s*hidden/);
});

test("stale native actions are discarded and only the freshly reacquired action executes", () => {
  const requests = new FreshNativeActionRequestController();
  let staleClicks = 0;
  let freshClicks = 0;
  const staleAction = { click: () => { staleClicks += 1; }, connected: false };
  const discovery = [{
    disabled: false,
    element: staleAction,
    kind: "archive" as const,
    wolfOwned: false,
  }];
  assert.equal(resolveUniqueNativeConversationMenuAction("archive", discovery), staleAction);

  requests.begin("conversation-fixture-1", "archive");
  const request = requests.consumeForConversation("conversation-fixture-1");
  assert.equal(request?.kind, "archive");
  const freshAction = { click: () => { freshClicks += 1; }, connected: true };
  const currentMenu = [{
    disabled: false,
    element: freshAction,
    kind: "archive" as const,
    wolfOwned: false,
  }];
  const resolved = resolveUniqueNativeConversationMenuAction(request!.kind, currentMenu);
  resolved?.click();
  assert.equal(staleClicks, 0);
  assert.equal(freshClicks, 1);
  assert.equal(requests.activeState, null);
});

test("Wolf descendants are excluded from fresh native action resolution", () => {
  const nativeAction = { source: "ChatGPT" };
  const wolfAction = { source: "Wolf" };
  assert.equal(resolveUniqueNativeConversationMenuAction("delete", [
    { disabled: false, element: nativeAction, kind: "delete", wolfOwned: false },
    { disabled: false, element: wolfAction, kind: "delete", wolfOwned: true },
  ]), nativeAction);
  assert.equal(resolveUniqueNativeConversationMenuAction("delete", [
    { disabled: false, element: wolfAction, kind: "delete", wolfOwned: true },
  ]), null);
});

test("folder root movement uses natural root insertion gaps without an artificial strip", () => {
  const sidebar = read("src/features/quickAccess/QuickAccessSidebar.ts");
  const css = read("src/features/quickAccess/quick-access.css");
  assert.match(sidebar, /createInsertionTarget\("folder-insert", parentId, index, depth\)/);
  assert.match(sidebar, /onMoveFolder\(payload\.folderId, parentId, targetIndex\)/);
  assert.doesNotMatch(sidebar, /Move folder to Quick Access root|folder-root-drop-target/);
  assert.doesNotMatch(css, /wolf-root-drop-target/);
});

test("drop feedback avoids rewriting an unchanged active target", () => {
  const sidebar = read("src/features/quickAccess/QuickAccessSidebar.ts");
  assert.match(sidebar, /this\.dragIndicator\.current === target/);
  assert.match(sidebar, /target\.classList\.contains\(valid \? "wolf-is-valid-drop" : "wolf-is-invalid-drop"\)/);
});

test("root folders receive subtle subtree separation without changing nested rows", () => {
  const css = read("src/features/quickAccess/quick-access.css");
  assert.match(css, /\.wolf-folder-region\[data-parent-id=""\][\s\S]*~ \.wolf-quick-access-folder/);
  assert.match(css, /color-mix\(in srgb, currentColor 12%, transparent\)/);
});
