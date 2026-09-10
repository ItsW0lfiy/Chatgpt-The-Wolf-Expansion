import type { Unsubscribe } from "../shared/types";
import { STORAGE_KEYS } from "./schemas";
import type { KeyValueStorage } from "./StorageService";

export const ACCOUNT_OWNED_STORAGE_KEYS = [
  STORAGE_KEYS.favorites,
  STORAGE_KEYS.uiState,
  STORAGE_KEYS.folders,
  STORAGE_KEYS.folderMembership,
  STORAGE_KEYS.foldersUiState,
  STORAGE_KEYS.quickAccessUiState,
  STORAGE_KEYS.folderChatNameDisplayOverrides,
] as const;

const ACCOUNT_OWNED_KEYS = new Set<string>(ACCOUNT_OWNED_STORAGE_KEYS);

interface ScopedSubscription {
  listeners: Set<() => void>;
  unsubscribeStorage: Unsubscribe | null;
}

export class AccountScopeUnavailableError extends Error {
  public constructor() {
    super("Account-owned Wolf Expansion storage is unavailable until the ChatGPT account is resolved.");
    this.name = "AccountScopeUnavailableError";
  }
}

export class AccountScopedStorage implements KeyValueStorage {
  private scopeId: string | null = null;
  private readonly subscriptions = new Map<string, ScopedSubscription>();

  public constructor(private readonly storage: KeyValueStorage) {}

  public get activeScopeId(): string | null {
    return this.scopeId;
  }

  public setScope(scopeId: string | null): void {
    const normalized = scopeId?.trim() || null;
    if (normalized === this.scopeId) {
      return;
    }
    this.scopeId = normalized;
    for (const [key, subscription] of this.subscriptions) {
      subscription.unsubscribeStorage?.();
      subscription.unsubscribeStorage = this.subscribeToCurrentKey(key, subscription.listeners);
      subscription.listeners.forEach((listener) => listener());
    }
  }

  public async get<T>(key: string, fallback: T): Promise<T> {
    const resolved = this.resolveKey(key);
    return resolved ? this.storage.get(resolved, fallback) : structuredClone(fallback);
  }

  public async set<T>(key: string, value: T): Promise<void> {
    const resolved = this.requireKey(key);
    await this.storage.set(resolved, value);
  }

  public async setMany(values: Record<string, unknown>): Promise<void> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      resolved[this.requireKey(key)] = value;
    }
    await this.storage.setMany(resolved);
  }

  public subscribe(key: string, listener: () => void): Unsubscribe {
    if (!ACCOUNT_OWNED_KEYS.has(key)) {
      return this.storage.subscribe(key, listener);
    }
    const subscription = this.subscriptions.get(key) ?? {
      listeners: new Set<() => void>(),
      unsubscribeStorage: null,
    };
    subscription.listeners.add(listener);
    if (!this.subscriptions.has(key)) {
      subscription.unsubscribeStorage = this.subscribeToCurrentKey(key, subscription.listeners);
      this.subscriptions.set(key, subscription);
    }
    return () => {
      subscription.listeners.delete(listener);
      if (subscription.listeners.size === 0) {
        subscription.unsubscribeStorage?.();
        this.subscriptions.delete(key);
      }
    };
  }

  private resolveKey(key: string): string | null {
    if (!ACCOUNT_OWNED_KEYS.has(key)) {
      return key;
    }
    return this.scopeId ? getAccountScopedStorageKey(this.scopeId, key) : null;
  }

  private requireKey(key: string): string {
    const resolved = this.resolveKey(key);
    if (!resolved) {
      throw new AccountScopeUnavailableError();
    }
    return resolved;
  }

  private subscribeToCurrentKey(
    key: string,
    listeners: ReadonlySet<() => void>,
  ): Unsubscribe | null {
    const resolved = this.resolveKey(key);
    return resolved
      ? this.storage.subscribe(resolved, () => listeners.forEach((listener) => listener()))
      : null;
  }
}

export function getAccountScopedStorageKey(scopeId: string, logicalKey: string): string {
  const suffix = logicalKey.startsWith("wolfExpansion.")
    ? logicalKey.slice("wolfExpansion.".length)
    : logicalKey;
  return `wolfExpansion.accounts.${scopeId}.${suffix}`;
}

export function parseAccountScopedStorageKey(
  key: string,
): { scopeId: string; logicalKey: (typeof ACCOUNT_OWNED_STORAGE_KEYS)[number] } | null {
  const match = /^wolfExpansion\.accounts\.(sha256-[0-9a-f]{64})\.(.+)$/u.exec(key);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const logicalKey = `wolfExpansion.${match[2]}`;
  return ACCOUNT_OWNED_KEYS.has(logicalKey)
    ? {
        scopeId: match[1],
        logicalKey: logicalKey as (typeof ACCOUNT_OWNED_STORAGE_KEYS)[number],
      }
    : null;
}
