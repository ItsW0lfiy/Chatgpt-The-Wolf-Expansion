import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createOpaqueAccountScopeId,
  getChatGPTAccountEvidenceSignature,
  getChatGPTUserIdFromProfileImage,
  resolveChatGPTAccountEvidence,
} from "../src/accounts/accountIdentity";

const fixture = (name: string): string => readFileSync(
  path.join(process.cwd(), "tests", "fixtures", "chatgpt-dom", name),
  "utf8",
);

const baseSignals = {
  baseUrl: "https://chatgpt.com/",
  loggedOutControlVisible: false,
  profileImageSource: "",
  profilePresent: true,
};

function createProfileImageUrl(id: string): string {
  const encoded = Buffer.from(JSON.stringify({ id }), "utf8").toString("base64url");
  return `https://chatgpt.com/backend-api/estuary/public_content/enc/${encoded}`;
}

function createRawProfileImageUrl(payload: string): string {
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  return `https://chatgpt.com/backend-api/estuary/public_content/enc/${encoded}`;
}

function createStandardBase64ProfileImageUrl(id: string): string {
  const encoded = encodeURIComponent(Buffer.from(JSON.stringify({ id }), "utf8").toString("base64"));
  return `https://chatgpt.com/backend-api/estuary/public_content/enc/${encoded}`;
}

test("logged-out fixture exposes the semantic login control used for fail-closed gating", () => {
  const html = fixture("chatgpt-logged-out-auth-controls.sanitized.html");
  assert.match(html, /data-mobile-auth-entry-action="login"/u);
  assert.deepEqual(resolveChatGPTAccountEvidence({
    ...baseSignals,
    loggedOutControlVisible: true,
    profilePresent: false,
  }), { state: "logged-out" });
  assert.deepEqual(resolveChatGPTAccountEvidence({
    ...baseSignals,
    loggedOutControlVisible: true,
    profileImageSource: createProfileImageUrl(
      "user-EXAMPLEACCOUNT123:image-one#file_one#thumbnail",
    ),
    profilePresent: true,
  }), { state: "logged-out" });
});

test("missing profile and unparseable profile identity remain unresolved", () => {
  assert.deepEqual(resolveChatGPTAccountEvidence({
    ...baseSignals,
    profilePresent: false,
  }), { state: "unresolved", reason: "missing-profile" });
  assert.deepEqual(resolveChatGPTAccountEvidence({
    ...baseSignals,
    profileImageSource: "https://cdn.auth0.com/avatars/wo.png",
  }), { state: "unresolved", reason: "invalid-profile-user-id" });
  const mutableFallbackOnly = {
    ...baseSignals,
    accountEmailText: "fallback@example.invalid",
    accountUsernameText: "@fallback-name",
    profileImageSource: "https://cdn.auth0.com/avatars/wo.png",
    profileLabel: "Fallback display name",
  };
  assert.deepEqual(resolveChatGPTAccountEvidence(mutableFallbackOnly), {
    state: "unresolved",
    reason: "invalid-profile-user-id",
  });
});

test("same stable user ID survives different avatar asset payloads and hashes to one scope", async () => {
  const firstUrl = createProfileImageUrl(
    "user-EXAMPLEACCOUNT123:image-one#file_one#thumbnail",
  );
  const secondUrl = createProfileImageUrl(
    "user-EXAMPLEACCOUNT123:image-two#file_two#thumbnail",
  ) + "?asset=regenerated";
  const first = resolveChatGPTAccountEvidence({ ...baseSignals, profileImageSource: firstUrl });
  const second = resolveChatGPTAccountEvidence({ ...baseSignals, profileImageSource: secondUrl });
  const expected = {
    state: "identified",
    source: "profile-user-id",
    identity: "chatgpt-user-id:user-EXAMPLEACCOUNT123",
  } as const;
  assert.deepEqual(first, expected);
  assert.deepEqual(second, expected);
  assert.equal(
    await createOpaqueAccountScopeId(first.state === "identified" ? first.identity : ""),
    await createOpaqueAccountScopeId(second.state === "identified" ? second.identity : ""),
  );
});

test("standard base64 and base64url Estuary payloads resolve the same stable user ID", () => {
  const id = "user-EXAMPLEACCOUNT123:image#file_one#thumbnail";
  assert.equal(
    getChatGPTUserIdFromProfileImage(createProfileImageUrl(id), baseSignals.baseUrl),
    "user-EXAMPLEACCOUNT123",
  );
  assert.equal(
    getChatGPTUserIdFromProfileImage(createStandardBase64ProfileImageUrl(id), baseSignals.baseUrl),
    "user-EXAMPLEACCOUNT123",
  );
});

test("mutable profile metadata cannot change account identity or scope", async () => {
  const profileImageSource = createProfileImageUrl(
    "user-EXAMPLEACCOUNT123:image-one#file_one#thumbnail",
  );
  const firstSignals = {
    ...baseSignals,
    accountEmailText: "first@example.invalid",
    accountUsernameText: "@first-name",
    profileImageSource,
    profileLabel: "First display name",
  };
  const secondSignals = {
    ...baseSignals,
    accountEmailText: "second@example.invalid",
    accountUsernameText: "@second-name",
    profileImageSource,
    profileLabel: "Second display name",
  };
  const first = resolveChatGPTAccountEvidence(firstSignals);
  const second = resolveChatGPTAccountEvidence(secondSignals);
  assert.deepEqual(first, second);
  assert.equal(getChatGPTAccountEvidenceSignature(first), getChatGPTAccountEvidenceSignature(second));
  assert.equal(first.state, "identified");
  assert.equal(second.state, "identified");
  if (first.state === "identified" && second.state === "identified") {
    assert.equal(
      await createOpaqueAccountScopeId(first.identity),
      await createOpaqueAccountScopeId(second.identity),
    );
  }
});

test("different stable user IDs produce different identities and opaque scopes", async () => {
  const accountA = resolveChatGPTAccountEvidence({
    ...baseSignals,
    profileImageSource: createProfileImageUrl("user-ACCOUNTAAAA:image#file_a#thumbnail"),
  });
  const accountB = resolveChatGPTAccountEvidence({
    ...baseSignals,
    profileImageSource: createProfileImageUrl("user-ACCOUNTBBBB:image#file_b#thumbnail"),
  });
  assert.equal(accountA.state, "identified");
  assert.equal(accountB.state, "identified");
  if (accountA.state === "identified" && accountB.state === "identified") {
    assert.notEqual(accountA.identity, accountB.identity);
    assert.notEqual(
      await createOpaqueAccountScopeId(accountA.identity),
      await createOpaqueAccountScopeId(accountB.identity),
    );
  }
});

test("Estuary carrier parsing fails closed for malformed or untrusted inputs", () => {
  const invalidJson = createRawProfileImageUrl("not-json");
  const missingId = createRawProfileImageUrl(JSON.stringify({ other: "value" }));
  const invalidId = createProfileImageUrl("profile-EXAMPLEACCOUNT123:image");
  const unrelated = "https://images.example.invalid/backend-api/estuary/public_content/enc/value";
  const wrongChatGptPath = "https://chatgpt.com/profile/image/value";
  const invalidBase64 = "https://chatgpt.com/backend-api/estuary/public_content/enc/!!!!";

  assert.equal(getChatGPTUserIdFromProfileImage(unrelated, baseSignals.baseUrl), null);
  assert.equal(getChatGPTUserIdFromProfileImage(wrongChatGptPath, baseSignals.baseUrl), null);
  assert.equal(getChatGPTUserIdFromProfileImage(invalidBase64, baseSignals.baseUrl), null);
  assert.equal(getChatGPTUserIdFromProfileImage(invalidJson, baseSignals.baseUrl), null);
  assert.equal(getChatGPTUserIdFromProfileImage(missingId, baseSignals.baseUrl), null);
  assert.equal(getChatGPTUserIdFromProfileImage(invalidId, baseSignals.baseUrl), null);
});

test("unresolved evidence signatures contain no mutable avatar or profile fingerprint", () => {
  const first = resolveChatGPTAccountEvidence({
    ...baseSignals,
    profileImageSource: "https://example.invalid/avatar-one",
  });
  const second = resolveChatGPTAccountEvidence({
    ...baseSignals,
    profileImageSource: "https://example.invalid/avatar-two",
  });
  assert.equal(getChatGPTAccountEvidenceSignature(first), "unresolved:invalid-profile-user-id");
  assert.equal(getChatGPTAccountEvidenceSignature(second), "unresolved:invalid-profile-user-id");
});
