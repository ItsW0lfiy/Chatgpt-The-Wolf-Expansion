import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  getAutoscrollFrameDelta,
  getAutoscrollVelocity,
  getPageScrollDistance,
} from "../src/compatibility/navigationFixes";

const read = (file: string): string => readFileSync(path.join(process.cwd(), file), "utf8");

test("navigation fixes use deterministic page and elapsed-time autoscroll geometry", () => {
  assert.equal(getPageScrollDistance(1_000), 900);
  assert.equal(getAutoscrollVelocity(5), 0);
  assert.equal(getAutoscrollVelocity(-5), 0);
  assert.ok(getAutoscrollVelocity(80) > 0);
  assert.ok(getAutoscrollVelocity(-80) < 0);
  assert.equal(
    getAutoscrollFrameDelta(80, 32),
    getAutoscrollVelocity(80) * 0.032,
  );
  assert.equal(
    getAutoscrollFrameDelta(80, 500),
    getAutoscrollVelocity(80) * 0.05,
  );
});

test("navigation compatibility is a dedicated document-start content script", () => {
  const manifest = JSON.parse(read("src/manifest.json")) as {
    content_scripts: Array<{ js: string[]; run_at?: string }>;
    permissions: string[];
  };
  const early = manifest.content_scripts.find((entry) =>
    entry.js.includes("navigation-compat.js"));
  assert.deepEqual(early, {
    matches: ["https://chatgpt.com/*"],
    js: ["navigation-compat.js"],
    run_at: "document_start",
  });
  assert.deepEqual(manifest.permissions, ["storage"]);
});

test("navigation fixes preserve typing, links, and unrelated browser shortcuts", () => {
  const source = read("src/compatibility/navigationFixes.ts");
  assert.match(source, /isNavigationTypingTarget\(event\.target\)/u);
  assert.match(source, /event\.target\.closest\("a\[href\]"\)/u);
  assert.match(source, /event\.ctrlKey \|\| event\.altKey \|\| event\.metaKey \|\| event\.shiftKey/u);
  assert.doesNotMatch(source, /F\d{1,2}/u);
  assert.doesNotMatch(source, /setInterval/u);
});

test("middle-click autoscroll owns a Wolf marker and cleans up on lifecycle exits", () => {
  const source = read("src/compatibility/navigationFixes.ts");
  assert.match(source, /navigation-autoscroll-marker/u);
  assert.match(source, /requestAnimationFrame/u);
  assert.match(source, /pagehide/u);
  assert.match(source, /visibilitychange/u);
  assert.match(source, /state\.marker\.remove\(\)/u);
});

test("both settings frontends expose the shared opt-in compatibility setting", () => {
  const inChat = read("src/features/settings/InChatSettingsFeature.ts");
  const options = read("src/settings/options/options.html");
  assert.match(inChat, /Navigation compatibility fixes/u);
  assert.match(options, /Navigation compatibility fixes/u);
  assert.match(inChat, /compatibility:\s*\{\s*navigationFixes:/su);
});
