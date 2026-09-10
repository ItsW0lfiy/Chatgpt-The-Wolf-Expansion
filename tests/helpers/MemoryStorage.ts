import type { StorageSnapshotService } from "../../src/storage/StorageService";
import type { Unsubscribe } from "../../src/shared/types";

export class MemoryStorage implements StorageSnapshotService {
  private readonly values = new Map<string, unknown>();
  private readonly listeners = new Map<string, Set<() => void>>();

  public async get<T>(key: string, fallback: T): Promise<T> {
    return this.values.has(key)
      ? structuredClone(this.values.get(key)) as T
      : structuredClone(fallback);
  }

  public async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
    this.notify(key);
  }

  public async setMany(values: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      this.values.set(key, structuredClone(value));
      this.notify(key);
    }
  }

  public async getAll(): Promise<Record<string, unknown>> {
    return Object.fromEntries(
      [...this.values.entries()].map(([key, value]) => [key, structuredClone(value)]),
    );
  }

  public async removeMany(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      if (this.values.delete(key)) {
        this.notify(key);
      }
    }
  }

  public subscribe(key: string, listener: () => void): Unsubscribe {
    const listeners = this.listeners.get(key) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => listeners.delete(listener);
  }

  private notify(key: string): void {
    this.listeners.get(key)?.forEach((listener) => listener());
  }
}
