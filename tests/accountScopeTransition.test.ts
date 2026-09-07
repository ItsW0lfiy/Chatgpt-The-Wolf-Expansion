import assert from "node:assert/strict";
import test from "node:test";
import { AccountScopeTransition } from "../src/accounts/accountScopeTransition";

test("newer account evidence invalidates older in-flight ownership", () => {
  const transition = new AccountScopeTransition();
  const accountB = transition.begin();
  const accountA = transition.begin();
  assert.equal(transition.isPending, true);
  assert.equal(transition.isCurrent(accountB), false);
  assert.equal(transition.complete(accountB), false);
  assert.equal(transition.isPending, true);
  assert.equal(transition.isCurrent(accountA), true);
  assert.equal(transition.complete(accountA), true);
  assert.equal(transition.isPending, false);
});

test("logout starts a new fail-closed transition until its state is applied", () => {
  const transition = new AccountScopeTransition();
  const signedIn = transition.begin();
  assert.equal(transition.complete(signedIn), true);
  assert.equal(transition.isPending, false);
  const logout = transition.begin();
  assert.equal(transition.isPending, true);
  assert.equal(transition.complete(logout), true);
  assert.equal(transition.isPending, false);
});

test("new account evidence wins while an older scope hash is still resolving", async () => {
  const transition = new AccountScopeTransition();
  let releaseOldHash: (() => void) | undefined;
  const oldHashReady = new Promise<void>((resolve) => {
    releaseOldHash = resolve;
  });
  const appliedScopes: string[] = [];

  const oldGeneration = transition.begin();
  const oldWork = oldHashReady.then(() => {
    if (transition.isCurrent(oldGeneration)) {
      appliedScopes.push("old-scope");
      transition.complete(oldGeneration);
    }
  });
  const newGeneration = transition.begin();
  if (transition.isCurrent(newGeneration)) {
    appliedScopes.push("new-scope");
    transition.complete(newGeneration);
  }
  releaseOldHash?.();
  await oldWork;

  assert.deepEqual(appliedScopes, ["new-scope"]);
  assert.equal(transition.isCurrent(oldGeneration), false);
});
