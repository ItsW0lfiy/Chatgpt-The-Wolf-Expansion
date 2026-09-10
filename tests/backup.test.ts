import assert from "node:assert/strict";
import test from "node:test";
import { BackupService, BACKUP_FORMAT, BackupValidationError } from "../src/backup/BackupService";
import { getAccountScopedStorageKey } from "../src/storage/AccountScopedStorage";
import { STORAGE_KEYS, STORAGE_SCHEMA_VERSION } from "../src/storage/schemas";
import { MemoryStorage } from "./helpers/MemoryStorage";

const SCOPE_A = "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SCOPE_B = "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function scoped(scopeId: string, key: string): string {
  return getAccountScopedStorageKey(scopeId, key);
}

function accountValues(scopeId: string, conversationId: string, route: "c" | "g") {
  const folderId = `folder-${conversationId}`;
  return {
    [scoped(scopeId, STORAGE_KEYS.favorites)]: [{
      conversationId,
      route,
      title: `Title ${conversationId}`,
      url: `https://chatgpt.com/${route}/${conversationId}`,
      addedAt: 1,
      sortIndex: 0,
    }],
    [scoped(scopeId, STORAGE_KEYS.uiState)]: { collapsed: true },
    [scoped(scopeId, STORAGE_KEYS.folders)]: [{
      id: folderId,
      name: `Folder ${conversationId}`,
      parentId: null,
      sortIndex: 0,
      createdAt: 1,
      collapsed: false,
    }],
    [scoped(scopeId, STORAGE_KEYS.folderMembership)]: [{
      conversationId,
      route,
      folderId,
      title: `Title ${conversationId}`,
      url: `https://chatgpt.com/${route}/${conversationId}`,
      assignedAt: 1,
      sortIndex: 0,
    }],
    [scoped(scopeId, STORAGE_KEYS.foldersUiState)]: { collapsed: false },
    [scoped(scopeId, STORAGE_KEYS.quickAccessUiState)]: { collapsed: true },
    [scoped(scopeId, STORAGE_KEYS.folderChatNameDisplayOverrides)]: { [folderId]: "full" },
  };
}

test("backup round trip preserves settings, account boundaries, folders, and conversation metadata", async () => {
  const source = new MemoryStorage();
  await source.setMany({
    [STORAGE_KEYS.schemaVersion]: STORAGE_SCHEMA_VERSION,
    [STORAGE_KEYS.settings]: { enabled: false, debug: { enabled: true } },
    ...accountValues(SCOPE_A, "chat-a", "c"),
    ...accountValues(SCOPE_B, "chat-b", "g"),
  });
  const exported = await new BackupService(source, "0.2.0-dev.3").createBackup();
  assert.equal(exported.envelope.format, BACKUP_FORMAT);
  assert.equal(exported.envelope.data.accounts.length, 2);
  assert.match(exported.envelope.integrity.value, /^[0-9a-f]{64}$/u);

  const destination = new MemoryStorage();
  await destination.set("wolfExpansion.unrelatedOldValue", "remove-me");
  await new BackupService(destination, "0.2.0-dev.3").restoreBackup(exported.json);
  const restored = await destination.getAll();
  assert.equal(restored["wolfExpansion.unrelatedOldValue"], undefined);
  assert.equal((restored[scoped(SCOPE_A, STORAGE_KEYS.favorites)] as unknown[]).length, 1);
  assert.equal(
    (restored[scoped(SCOPE_B, STORAGE_KEYS.favorites)] as Array<{ route: string }>)[0]?.route,
    "g",
  );
  assert.equal(
    (restored[scoped(SCOPE_B, STORAGE_KEYS.folderMembership)] as Array<{ folderId: string }>)[0]
      ?.folderId,
    "folder-chat-b",
  );
  assert.equal((restored[STORAGE_KEYS.settings] as { enabled: boolean }).enabled, false);
  assert.ok(restored[STORAGE_KEYS.preRestoreSafetySnapshot]);
});

test("malformed, wrong-format, future, and integrity-failed backups are rejected", async () => {
  const service = new BackupService(new MemoryStorage(), "0.2.0-dev.3");
  await assert.rejects(service.restoreBackup("not json"), BackupValidationError);
  await assert.rejects(
    service.restoreBackup(JSON.stringify({ format: "other", formatVersion: 1 })),
    /not a Wolf Expansion backup/,
  );
  await assert.rejects(
    service.restoreBackup(JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 99 })),
    /newer unsupported/,
  );
  const { envelope } = await service.createBackup();
  const corrupted = structuredClone(envelope);
  corrupted.data.lastBackupAt += 1;
  await assert.rejects(service.restoreBackup(JSON.stringify(corrupted)), /integrity/);
});

test("failed restore validation leaves existing storage untouched", async () => {
  const storage = new MemoryStorage();
  await storage.setMany(accountValues(SCOPE_A, "keep-me", "c"));
  const before = await storage.getAll();
  const service = new BackupService(storage, "0.2.0-dev.3");
  await assert.rejects(service.restoreBackup("{}"));
  assert.deepEqual(await storage.getAll(), before);
});

test("backup exports no raw ChatGPT account identity", async () => {
  const storage = new MemoryStorage();
  await storage.setMany(accountValues(SCOPE_A, "chat-safe", "c"));
  const { json } = await new BackupService(storage, "0.2.0-dev.3").createBackup();
  assert.doesNotMatch(json, /chatgpt-user-id|user-EXAMPLE/iu);
  assert.match(json, /sha256-a{64}/u);
});

test("checksummed but structurally corrupt account records are rejected before storage changes", async () => {
  const source = new MemoryStorage();
  await source.setMany(accountValues(SCOPE_A, "chat-a", "c"));
  const { envelope } = await new BackupService(source, "0.2.0-dev.3").createBackup();
  const malformed = structuredClone(envelope) as unknown as Record<string, unknown>;
  const data = malformed.data as Record<string, unknown>;
  const accounts = data.accounts as Array<Record<string, unknown>>;
  const account = accounts[0]!;
  const values = account.values as Record<string, unknown>;
  values.favorites = [{ conversationId: 42 }];
  malformed.integrity = {
    algorithm: "SHA-256",
    value: await hashUnsigned(malformed),
  };
  const destination = new MemoryStorage();
  await destination.set("wolfExpansion.keep", "safe");
  const before = await destination.getAll();
  await assert.rejects(
    new BackupService(destination, "0.2.0-dev.3").restoreBackup(JSON.stringify(malformed)),
    /malformed organization records/,
  );
  assert.deepEqual(await destination.getAll(), before);
});

test("checksummed backup with incomplete settings is rejected before storage changes", async () => {
  const source = new MemoryStorage();
  await source.setMany(accountValues(SCOPE_A, "chat-a", "c"));
  const { envelope } = await new BackupService(source, "0.2.0-dev.3").createBackup();
  const malformed = structuredClone(envelope) as unknown as Record<string, unknown>;
  const data = malformed.data as Record<string, unknown>;
  data.settings = { enabled: true };
  malformed.integrity = {
    algorithm: "SHA-256",
    value: await hashUnsigned(malformed),
  };
  const destination = new MemoryStorage();
  await destination.set("wolfExpansion.keep", "safe");
  const before = await destination.getAll();
  await assert.rejects(
    new BackupService(destination, "0.2.0-dev.3").restoreBackup(JSON.stringify(malformed)),
    /incomplete/,
  );
  assert.deepEqual(await destination.getAll(), before);
});

async function hashUnsigned(envelope: Record<string, unknown>): Promise<string> {
  const { integrity: _integrity, ...unsigned } = envelope;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalStringify(unsigned)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
