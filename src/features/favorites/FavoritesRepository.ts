import type { Unsubscribe } from "../../shared/types";
import { TypedEvent } from "../../shared/events";
import type { Logger } from "../../core/logger";
import { normalizeConversationIdentity } from "../../adapters/chatgpt/conversationIdentity";
import { normalizeFavorites, normalizeUiState } from "../../storage/migrations";
import {
  STORAGE_KEYS,
  type FavoriteConversation,
  type FavoritesUiState,
} from "../../storage/schemas";
import type { KeyValueStorage } from "../../storage/StorageService";

export interface NewFavoriteConversation {
  conversationId: string;
  route?: "c" | "g";
  title: string;
  url: string;
}

export interface FavoritesChangedEvent {
  type: "added" | "removed" | "reordered" | "metadata-updated" | "storage-synchronized";
  conversationId?: string;
}

export class FavoritesRepository {
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly changed = new TypedEvent<FavoritesChangedEvent>();

  public constructor(
    private readonly storage: KeyValueStorage,
    private readonly logger?: Logger,
  ) {}

  public async list(): Promise<FavoriteConversation[]> {
    const value = await this.storage.get<unknown>(STORAGE_KEYS.favorites, []);
    return normalizeFavorites(value);
  }

  public async isFavorite(conversationId: string): Promise<boolean> {
    return (await this.list()).some((favorite) => favorite.conversationId === conversationId);
  }

  public async add(conversation: NewFavoriteConversation): Promise<void> {
    const normalized = normalizeConversationIdentity(conversation);
    if (!normalized.ok) {
      throw new Error(`Cannot add Favorite: ${normalized.reason}.`);
    }
    const safeConversation = normalized.conversation;
    await this.enqueue(async () => {
      const favorites = await this.list();
      const existing = favorites.find(
        (favorite) => favorite.conversationId === safeConversation.conversationId,
      );

      if (existing) {
        existing.title = safeConversation.title;
        existing.route = safeConversation.route;
        existing.url = safeConversation.url;
      } else {
        favorites.push({
          conversationId: safeConversation.conversationId,
          route: safeConversation.route,
          title: safeConversation.title,
          url: safeConversation.url,
          addedAt: Date.now(),
          sortIndex: favorites.length,
        });
      }

      await this.save(favorites);
      this.emitChanged({
        type: existing ? "metadata-updated" : "added",
        conversationId: safeConversation.conversationId,
      });
      this.logger?.debug(existing ? "Favorite metadata updated." : "Favorite added.", safeConversation.conversationId);
    });
  }

  public async remove(conversationId: string): Promise<void> {
    await this.enqueue(async () => {
      const previousFavorites = await this.list();
      const favorites = previousFavorites.filter(
        (favorite) => favorite.conversationId !== conversationId,
      );
      if (favorites.length === previousFavorites.length) {
        this.logger?.debug("Favorite remove skipped: conversation was not a Favorite.", conversationId);
        return;
      }
      await this.save(favorites);
      this.emitChanged({ type: "removed", conversationId });
      this.logger?.debug("Favorite removed.", conversationId);
    });
  }

  public async toggle(conversation: NewFavoriteConversation): Promise<boolean> {
    const normalized = normalizeConversationIdentity(conversation);
    if (!normalized.ok) {
      throw new Error(`Cannot toggle Favorite: ${normalized.reason}.`);
    }
    const safeConversation = normalized.conversation;
    let isNowFavorite = false;

    this.logger?.debug("Favorite pipeline: repository toggle called.", {
      conversationId: safeConversation.conversationId,
      url: safeConversation.url,
    });

    await this.enqueue(async () => {
      const favorites = await this.list();
      const existingIndex = favorites.findIndex(
        (favorite) => favorite.conversationId === safeConversation.conversationId,
      );

      if (existingIndex >= 0) {
        favorites.splice(existingIndex, 1);
      } else {
        favorites.push({
          conversationId: safeConversation.conversationId,
          route: safeConversation.route,
          title: safeConversation.title,
          url: safeConversation.url,
          addedAt: Date.now(),
          sortIndex: favorites.length,
        });
        isNowFavorite = true;
      }

      await this.save(favorites);
      this.emitChanged({
        type: isNowFavorite ? "added" : "removed",
        conversationId: safeConversation.conversationId,
      });
      this.logger?.debug(isNowFavorite ? "Favorite added." : "Favorite removed.", safeConversation.conversationId);
    });

    return isNowFavorite;
  }

  public async reorder(conversationIds: readonly string[]): Promise<void> {
    await this.enqueue(async () => {
      const favorites = await this.list();
      const byId = new Map(favorites.map((favorite) => [favorite.conversationId, favorite]));
      const reordered = conversationIds
        .map((conversationId) => byId.get(conversationId))
        .filter((favorite): favorite is FavoriteConversation => favorite !== undefined);

      for (const favorite of favorites) {
        if (!conversationIds.includes(favorite.conversationId)) {
          reordered.push(favorite);
        }
      }

      await this.save(reordered);
      this.emitChanged({ type: "reordered" });
    });
  }

  public async updateDetectedTitles(
    detectedTitles: ReadonlyMap<string, { title: string; route?: "c" | "g"; url: string }>,
  ): Promise<boolean> {
    let changed = false;

    await this.enqueue(async () => {
      const favorites = await this.list();
      for (const favorite of favorites) {
        const detected = detectedTitles.get(favorite.conversationId);
        if (!detected) {
          continue;
        }
        const normalized = normalizeConversationIdentity({
          conversationId: favorite.conversationId,
          route: detected.route,
          title: detected.title,
          url: detected.url,
        });
        if (
          normalized.ok &&
          normalized.titleResolved &&
          (favorite.title !== normalized.conversation.title ||
            favorite.route !== normalized.conversation.route ||
            favorite.url !== normalized.conversation.url)
        ) {
          favorite.title = normalized.conversation.title;
          favorite.route = normalized.conversation.route;
          favorite.url = normalized.conversation.url;
          changed = true;
        }
      }

      if (changed) {
        await this.save(favorites);
        this.emitChanged({ type: "metadata-updated" });
      }
    });

    return changed;
  }

  public async getUiState(): Promise<FavoritesUiState> {
    const value = await this.storage.get<unknown>(STORAGE_KEYS.uiState, { collapsed: false });
    return normalizeUiState(value);
  }

  public async saveUiState(state: FavoritesUiState): Promise<void> {
    await this.storage.set(STORAGE_KEYS.uiState, normalizeUiState(state));
  }

  public subscribe(listener: (event: FavoritesChangedEvent) => void): Unsubscribe {
    const unsubscribeInternal = this.changed.subscribe(listener);
    const unsubscribeStorage = this.storage.subscribe(STORAGE_KEYS.favorites, () => {
      listener({ type: "storage-synchronized" });
    });
    return () => {
      unsubscribeInternal();
      unsubscribeStorage();
    };
  }

  public async whenIdle(): Promise<void> {
    await this.operationQueue;
  }

  private async save(favorites: FavoriteConversation[]): Promise<void> {
    const normalized = favorites.map((favorite, sortIndex) => ({ ...favorite, sortIndex }));
    this.logger?.debug("Favorite pipeline: browser.storage.local write started.", {
      key: STORAGE_KEYS.favorites,
      count: normalized.length,
    });
    await this.storage.set(STORAGE_KEYS.favorites, normalized);
    this.logger?.debug("Favorite pipeline: browser.storage.local write completed.", {
      key: STORAGE_KEYS.favorites,
      count: normalized.length,
    });
  }

  private emitChanged(event: FavoritesChangedEvent): void {
    this.changed.emit(event);
    this.logger?.debug("Favorite pipeline: favoritesChanged emitted.", event);
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const nextOperation = this.operationQueue.then(operation, operation);
    this.operationQueue = nextOperation.catch(() => undefined);
    await nextOperation;
  }
}
