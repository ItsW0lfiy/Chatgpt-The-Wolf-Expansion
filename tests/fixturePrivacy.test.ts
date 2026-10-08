import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "chatgpt-dom");
const files = readdirSync(fixtureRoot).sort();
const htmlFiles = files.filter((file) => file.endsWith(".sanitized.html"));
const noteFiles = files.filter((file) => file.endsWith(".md"));
const readFixture = (file: string): string =>
  readFileSync(path.join(fixtureRoot, file), "utf8");

test("complete ChatGPT fixture pack has the expected public-only shape", () => {
  assert.equal(htmlFiles.length, 28);
  assert.equal(noteFiles.length, 6);
  assert.equal(files.length, 34);
});

test("sanitized fixtures reject credential, bootstrap, private-path, and executable capture data", () => {
  const all = files.map(readFixture).join("\n");
  const html = htmlFiles.map(readFixture).join("\n");
  const forbidden = [
    /client-bootstrap/iu,
    /(?:authorization\s*[:=]|bearer\s+|set-cookie|cookie\s*[:=])/iu,
    /(?:access[_-]?token|refresh[_-]?token|session[_-]?token|csrf[_-]?token|api[_-]?key)\s*["']?\s*[:=]/iu,
    /eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{8,}/iu,
    /\bsk-[A-Za-z0-9_-]{16,}/u,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /(?:[A-Z]:\\Users\\|\/home\/|\/Users\/)/u,
    /(?:saved from url|warc\/|webarchive|webkit-mhtml)/iu,
    /[?&](?:access_token|token|signature|expires|x-amz-[^=]*|x-goog-[^=]*)=/iu,
    /\+[0-9][0-9 ().-]{7,}[0-9]/u,
  ];
  forbidden.forEach((pattern) => assert.doesNotMatch(all, pattern));
  assert.doesNotMatch(html, /<script\b/iu);
  assert.doesNotMatch(html, /\son(?:click|load|error|submit|focus|keydown|pointerdown)\s*=/iu);
  assert.doesNotMatch(html, /(?:javascript:|data:text\/html)/iu);
  assert.doesNotMatch(html, /backend-api\/estuary\/public_content\/enc\//iu);

  const extensionOrigins = [...html.matchAll(/moz-extension:\/\/([^/"']+)/giu)];
  assert.ok(extensionOrigins.every((match) =>
    match[1] === "wolf-expansion-runtime" ||
    match[1] === "00000000-0000-4000-8000-000000000001"));
});

test("fixture identities and image sources remain deterministic and non-live", () => {
  const all = files.map(readFixture).join("\n");
  const emails = all.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu) ?? [];
  assert.ok(emails.every((email) => email.toLowerCase().endsWith("@example.invalid")));

  const ids = all.match(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/giu) ?? [];
  assert.ok(ids.every((id) => new Set(id.replaceAll("-", "")).size <= 6));

  const routes = [...all.matchAll(/(?:https:\/\/chatgpt\.com)?\/c\/([A-Za-z0-9_-]+)/giu)];
  assert.ok(routes.every((match) =>
    /^conversation-fixture-\d+$/u.test(match[1]!) ||
    new Set(match[1]!).size <= 6));

  assert.doesNotMatch(all, /<img\b[^>]*\bsrc=["']https?:\/\/(?!example\.invalid\/)/iu);
  assert.doesNotMatch(all, /cdn\.auth0\.com\/avatars\//iu);
  assert.doesNotMatch(
    all,
    /aria-label=["'](?!Open profile menu|(?:Example|Fixture) User[^"']*open profile menu)[^"']*open profile menu/iu,
  );
});
