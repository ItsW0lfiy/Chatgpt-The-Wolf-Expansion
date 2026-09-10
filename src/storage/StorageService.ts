import type { Unsubscribe } from "../shared/types";

interface StorageErrorLogger {
  error(message: string, ...details: unknown[]): void;
}

export interface KeyValueStorage {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  setMany(values: Record<string, unknown>): Promise<void>;
  subscribe(key: string, listener: () => void): Unsubscribe;
}

export interface StorageSnapshotService extends KeyValueStorage {
  getAll(): Promise<Record<string, unknown>>;
  removeMany(keys: readonly string[]): Promise<void>;
}

export class StorageService implements StorageSnapshotService {
  public constructor(private readonly logger?: StorageErrorLogger) {}

  public async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const result = await browser.storage.local.get(key);
      return (result[key] as T | undefined) ?? fallback;
    } catch (error) {
      this.logger?.error("Storage operation failed.", { operation: "get", key }, error);
      throw error;
    }
  }

  public async set<T>(key: string, value: T): Promise<void> {
    try {
      await browser.storage.local.set({ [key]: value });
    } catch (error) {
      this.logger?.error("Storage operation failed.", { operation: "set", key }, error);
      throw error;
    }
  }

  public async setMany(values: Record<string, unknown>): Promise<void> {
    try {
      await browser.storage.local.set(values);
    } catch (error) {
      this.logger?.error(
        "Storage operation failed.",
        { operation: "setMany", keys: Object.keys(values) },
        error,
      );
      throw error;
    }
  }

  public async getAll(): Promise<Record<string, unknown>> {
    try {
      return await browser.storage.local.get();
    } catch (error) {
      this.logger?.error("Storage operation failed.", { operation: "getAll" }, error);
      throw error;
    }
  }

  public async removeMany(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    try {
      await browser.storage.local.remove([...keys]);
    } catch (error) {
      this.logger?.error("Storage operation failed.", { operation: "removeMany", keys }, error);
      throw error;
    }
  }

  public subscribe(key: string, listener: () => void): Unsubscribe {
    const handleChange = (
      changes: Record<string, browser.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (areaName === "local" && Object.hasOwn(changes, key)) {
        listener();
      }
    };

    browser.storage.onChanged.addListener(handleChange);
    return () => browser.storage.onChanged.removeListener(handleChange);
  }
}
