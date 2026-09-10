import { normalizeConversationIdentity, type ConversationIdentityInput } from "../../adapters/chatgpt/conversationIdentity";
import type { Logger } from "../../core/logger";
import { TypedEvent } from "../../shared/events";
import type { Unsubscribe } from "../../shared/types";
import {
  normalizeFolderMembership,
  normalizeFolders,
  normalizeFoldersUiState,
  normalizeFolderChatNameDisplayOverrides,
} from "../../storage/migrations";
import {
  STORAGE_KEYS,
  type FolderConversationMembership,
  type FolderRecord,
  type FoldersUiState,
} from "../../storage/schemas";
import type { KeyValueStorage } from "../../storage/StorageService";

export const MAX_FOLDER_NAME_LENGTH = 100;

export interface FolderTreeNode {
  folder: FolderRecord;
  children: FolderTreeNode[];
  conversations: FolderConversationMembership[];
}

export interface FoldersChangedEvent {
  type:
    | "created"
    | "renamed"
    | "deleted"
    | "moved"
    | "reordered"
    | "collapse-changed"
    | "conversation-assigned"
    | "conversation-removed"
    | "metadata-updated"
    | "storage-synchronized";
  folderId?: string;
  conversationId?: string;
}

type FolderIdFactory = () => string;

export class FoldersRepository {
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly changed = new TypedEvent<FoldersChangedEvent>();

  public constructor(
    private readonly storage: KeyValueStorage,
    private readonly logger?: Logger,
    private readonly createId: FolderIdFactory = () => crypto.randomUUID(),
  ) {}

  public async listFolders(): Promise<FolderRecord[]> {
    return normalizeFolders(await this.storage.get<unknown>(STORAGE_KEYS.folders, []));
  }

  public async listMembership(): Promise<FolderConversationMembership[]> {
    const folders = await this.listFolders();
    return normalizeFolderMembership(
      await this.storage.get<unknown>(STORAGE_KEYS.folderMembership, []),
      new Set(folders.map((folder) => folder.id)),
    );
  }

  public async getTree(): Promise<FolderTreeNode[]> {
    const [folders, memberships] = await Promise.all([
      this.listFolders(),
      this.listMembership(),
    ]);
    return buildFolderTree(folders, memberships);
  }

  public async getFolderContents(folderId: string): Promise<FolderConversationMembership[]> {
    return (await this.listMembership())
      .filter((item) => item.folderId === folderId)
      .sort(compareBySortIndex);
  }

  public async getMembership(
    conversationId: string,
  ): Promise<FolderConversationMembership | null> {
    return (await this.listMembership()).find(
      (item) => item.conversationId === conversationId,
    ) ?? null;
  }

  public async createFolder(name: string, parentId: string | null = null): Promise<FolderRecord> {
    let created: FolderRecord | null = null;
    await this.enqueue(async () => {
      const folders = await this.listFolders();
      const normalizedName = normalizeFolderName(name);
      if (parentId !== null && !folders.some((folder) => folder.id === parentId)) {
        throw new Error("Cannot create a folder under a missing parent.");
      }
      const id = this.createUniqueId(folders);
      created = {
        id,
        name: normalizedName,
        parentId,
        sortIndex: folders.filter((folder) => folder.parentId === parentId).length,
        createdAt: Date.now(),
        collapsed: false,
      };
      folders.push(created);
      await this.saveFolders(folders);
      this.emitChanged({ type: "created", folderId: id });
      this.logger?.debug("Folder created.", { folderId: id, parentId });
    });
    if (!created) {
      throw new Error("Folder creation did not complete.");
    }
    return created;
  }

  public async renameFolder(folderId: string, name: string): Promise<void> {
    await this.enqueue(async () => {
      const folders = await this.listFolders();
      const folder = requireFolder(folders, folderId);
      folder.name = normalizeFolderName(name);
      await this.saveFolders(folders);
      this.emitChanged({ type: "renamed", folderId });
      this.logger?.debug("Folder renamed.", { folderId });
    });
  }

  public async deleteFolder(folderId: string): Promise<void> {
    await this.enqueue(async () => {
      const folders = await this.listFolders();
      const folder = requireFolder(folders, folderId);
      const retainedFolders = folders.filter((candidate) => candidate.id !== folderId);
      for (const child of retainedFolders) {
        if (child.parentId === folderId) {
          child.parentId = folder.parentId;
        }
      }
      const memberships = (await this.listMembership()).filter(
        (membership) => membership.folderId !== folderId,
      );
      const chatNameDisplayOverrides = normalizeFolderChatNameDisplayOverrides(
        await this.storage.get<unknown>(STORAGE_KEYS.folderChatNameDisplayOverrides, {}),
      );
      delete chatNameDisplayOverrides[folderId];
      await this.saveFoldersAndMembership(
        retainedFolders,
        memberships,
        chatNameDisplayOverrides,
      );
      this.emitChanged({ type: "deleted", folderId });
      this.logger?.debug("Folder deleted; direct conversations unfiled and subfolders preserved.", {
        folderId,
        newParentId: folder.parentId,
      });
    });
  }

  public async moveFolder(
    folderId: string,
    parentId: string | null,
    targetIndex?: number,
  ): Promise<void> {
    await this.enqueue(async () => {
      const folders = await this.listFolders();
      const folder = requireFolder(folders, folderId);
      if (parentId !== null) {
        requireFolder(folders, parentId);
      }
      if (wouldCreateFolderCycle(folders, folderId, parentId)) {
        throw new Error("Cannot move a folder into itself or one of its descendants.");
      }
      if (folder.parentId === parentId && targetIndex === undefined) {
        return;
      }
      const previousParentId = folder.parentId;
      folder.parentId = parentId;
      const targetSiblings = folders
        .filter((candidate) => candidate.parentId === parentId && candidate.id !== folderId)
        .sort(compareBySortIndex);
      const adjustedTargetIndex = targetIndex !== undefined &&
        previousParentId === parentId &&
        folder.sortIndex < targetIndex
        ? targetIndex - 1
        : targetIndex;
      const insertionIndex = adjustedTargetIndex === undefined
        ? targetSiblings.length
        : Math.max(0, Math.min(adjustedTargetIndex, targetSiblings.length));
      targetSiblings.splice(insertionIndex, 0, folder);
      targetSiblings.forEach((sibling, sortIndex) => {
        sibling.sortIndex = sortIndex;
      });
      await this.saveFolders(folders);
      this.emitChanged({ type: previousParentId === parentId ? "reordered" : "moved", folderId });
      this.logger?.debug(previousParentId === parentId ? "Folder reordered." : "Folder moved.", {
        folderId,
        parentId,
        targetIndex: insertionIndex,
      });
    });
  }

  public async reorderFolder(folderId: string, direction: -1 | 1): Promise<void> {
    await this.enqueue(async () => {
      const folders = await this.listFolders();
      const folder = requireFolder(folders, folderId);
      const siblings = folders
        .filter((candidate) => candidate.parentId === folder.parentId)
        .sort(compareBySortIndex);
      const currentIndex = siblings.findIndex((candidate) => candidate.id === folderId);
      const targetIndex = currentIndex + direction;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length) {
        return;
      }
      const current = siblings[currentIndex];
      const target = siblings[targetIndex];
      if (!current || !target) {
        return;
      }
      siblings[currentIndex] = target;
      siblings[targetIndex] = current;
      siblings.forEach((sibling, sortIndex) => {
        sibling.sortIndex = sortIndex;
      });
      await this.saveFolders(folders);
      this.emitChanged({ type: "reordered", folderId });
    });
  }

  public async setFolderCollapsed(folderId: string, collapsed: boolean): Promise<void> {
    await this.enqueue(async () => {
      const folders = await this.listFolders();
      const folder = requireFolder(folders, folderId);
      if (folder.collapsed === collapsed) {
        return;
      }
      folder.collapsed = collapsed;
      await this.saveFolders(folders);
      this.emitChanged({ type: "collapse-changed", folderId });
    });
  }

  public async assignConversation(
    folderId: string,
    conversationInput: ConversationIdentityInput,
  ): Promise<void> {
    const normalized = normalizeConversationIdentity(conversationInput);
    if (!normalized.ok) {
      throw new Error(`Cannot assign conversation: ${normalized.reason}.`);
    }
    const conversation = normalized.conversation;
    await this.enqueue(async () => {
      const folders = await this.listFolders();
      requireFolder(folders, folderId);
      const memberships = await this.listMembership();
      const existingIndex = memberships.findIndex(
        (membership) => membership.conversationId === conversation.conversationId,
      );
      const existing = existingIndex >= 0 ? memberships[existingIndex] : null;
      const membership: FolderConversationMembership = {
        conversationId: conversation.conversationId,
        route: conversation.route,
        folderId,
        title: conversation.title,
        url: conversation.url,
        assignedAt: existing?.assignedAt ?? Date.now(),
        sortIndex: existing?.folderId === folderId
          ? existing.sortIndex
          : memberships.filter((item) => item.folderId === folderId).length,
      };
      if (existingIndex >= 0) {
        memberships[existingIndex] = membership;
      } else {
        memberships.push(membership);
      }
      await this.saveMembership(memberships, folders);
      this.emitChanged({
        type: "conversation-assigned",
        folderId,
        conversationId: conversation.conversationId,
      });
      this.logger?.debug("Conversation assigned to folder.", {
        folderId,
        conversationId: conversation.conversationId,
      });
    });
  }

  public async removeConversation(conversationId: string): Promise<void> {
    await this.enqueue(async () => {
      const folders = await this.listFolders();
      const previous = await this.listMembership();
      const memberships = previous.filter((item) => item.conversationId !== conversationId);
      if (memberships.length === previous.length) {
        return;
      }
      await this.saveMembership(memberships, folders);
      this.emitChanged({ type: "conversation-removed", conversationId });
      this.logger?.debug("Conversation removed from folder.", { conversationId });
    });
  }

  public async reorderConversations(
    folderId: string,
    conversationIds: readonly string[],
  ): Promise<void> {
    await this.enqueue(async () => {
      const folders = await this.listFolders();
      requireFolder(folders, folderId);
      const memberships = await this.listMembership();
      const folderContents = memberships
        .filter((membership) => membership.folderId === folderId)
        .sort(compareBySortIndex);
      const byId = new Map(folderContents.map((membership) => [membership.conversationId, membership]));
      const reordered = conversationIds
        .map((conversationId) => byId.get(conversationId))
        .filter((membership): membership is FolderConversationMembership => membership !== undefined);
      for (const membership of folderContents) {
        if (!conversationIds.includes(membership.conversationId)) {
          reordered.push(membership);
        }
      }
      reordered.forEach((membership, sortIndex) => {
        membership.sortIndex = sortIndex;
      });
      await this.saveMembership(memberships, folders);
      this.emitChanged({ type: "reordered", folderId });
      this.logger?.debug("Folder chat reordered.", { folderId });
    });
  }

  public async updateDetectedTitles(
    detectedTitles: ReadonlyMap<string, { title: string; route?: "c" | "g"; url: string }>,
  ): Promise<boolean> {
    let changed = false;
    await this.enqueue(async () => {
      const folders = await this.listFolders();
      const memberships = await this.listMembership();
      for (const membership of memberships) {
        const detected = detectedTitles.get(membership.conversationId);
        if (!detected) {
          continue;
        }
        const normalized = normalizeConversationIdentity({
          conversationId: membership.conversationId,
          route: detected.route,
          title: detected.title,
          url: detected.url,
        });
        if (
          normalized.ok &&
          normalized.titleResolved &&
          (membership.title !== normalized.conversation.title ||
            membership.route !== normalized.conversation.route ||
            membership.url !== normalized.conversation.url)
        ) {
          membership.title = normalized.conversation.title;
          membership.route = normalized.conversation.route;
          membership.url = normalized.conversation.url;
          changed = true;
        }
      }
      if (changed) {
        await this.saveMembership(memberships, folders);
        this.emitChanged({ type: "metadata-updated" });
      }
    });
    return changed;
  }

  public async getUiState(): Promise<FoldersUiState> {
    return normalizeFoldersUiState(
      await this.storage.get<unknown>(STORAGE_KEYS.foldersUiState, { collapsed: false }),
    );
  }

  public async saveUiState(state: FoldersUiState): Promise<void> {
    await this.storage.set(STORAGE_KEYS.foldersUiState, normalizeFoldersUiState(state));
  }

  public subscribe(listener: (event: FoldersChangedEvent) => void): Unsubscribe {
    const unsubscribeInternal = this.changed.subscribe(listener);
    const notifyStorage = (): void => listener({ type: "storage-synchronized" });
    const unsubscribeFolders = this.storage.subscribe(STORAGE_KEYS.folders, notifyStorage);
    const unsubscribeMembership = this.storage.subscribe(STORAGE_KEYS.folderMembership, notifyStorage);
    return () => {
      unsubscribeInternal();
      unsubscribeFolders();
      unsubscribeMembership();
    };
  }

  public async whenIdle(): Promise<void> {
    await this.operationQueue;
  }

  private createUniqueId(folders: readonly FolderRecord[]): string {
    const existingIds = new Set(folders.map((folder) => folder.id));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = this.createId().trim();
      if (id && !existingIds.has(id)) {
        return id;
      }
    }
    throw new Error("Could not generate a unique folder ID.");
  }

  private async saveFolders(folders: FolderRecord[]): Promise<void> {
    await this.storage.set(STORAGE_KEYS.folders, normalizeFolders(folders));
  }

  private async saveMembership(
    memberships: FolderConversationMembership[],
    folders: readonly FolderRecord[],
  ): Promise<void> {
    await this.storage.set(
      STORAGE_KEYS.folderMembership,
      normalizeFolderMembership(memberships, new Set(folders.map((folder) => folder.id))),
    );
  }

  private async saveFoldersAndMembership(
    folders: FolderRecord[],
    memberships: FolderConversationMembership[],
    folderChatNameDisplayOverrides?: Record<string, "compact" | "full">,
  ): Promise<void> {
    const normalizedFolders = normalizeFolders(folders);
    await this.storage.setMany({
      [STORAGE_KEYS.folders]: normalizedFolders,
      [STORAGE_KEYS.folderMembership]: normalizeFolderMembership(
        memberships,
        new Set(normalizedFolders.map((folder) => folder.id)),
      ),
      ...(folderChatNameDisplayOverrides
        ? { [STORAGE_KEYS.folderChatNameDisplayOverrides]: folderChatNameDisplayOverrides }
        : {}),
    });
  }

  private emitChanged(event: FoldersChangedEvent): void {
    this.changed.emit(event);
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const nextOperation = this.operationQueue.then(operation, operation);
    this.operationQueue = nextOperation.catch(() => undefined);
    await nextOperation;
  }
}

export function normalizeFolderName(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new Error("Folder name cannot be empty.");
  }
  return normalized.slice(0, MAX_FOLDER_NAME_LENGTH);
}

export function wouldCreateFolderCycle(
  folders: readonly FolderRecord[],
  folderId: string,
  candidateParentId: string | null,
): boolean {
  if (candidateParentId === null) {
    return false;
  }
  if (candidateParentId === folderId) {
    return true;
  }
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const visited = new Set<string>();
  let currentId: string | null = candidateParentId;
  while (currentId) {
    if (currentId === folderId || visited.has(currentId)) {
      return true;
    }
    visited.add(currentId);
    currentId = byId.get(currentId)?.parentId ?? null;
  }
  return false;
}

export function buildFolderTree(
  folders: readonly FolderRecord[],
  memberships: readonly FolderConversationMembership[],
): FolderTreeNode[] {
  const nodes = new Map<string, FolderTreeNode>();
  for (const folder of folders) {
    nodes.set(folder.id, { folder, children: [], conversations: [] });
  }
  for (const membership of memberships) {
    nodes.get(membership.folderId)?.conversations.push(membership);
  }
  const roots: FolderTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.folder.parentId ? nodes.get(node.folder.parentId) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (items: FolderTreeNode[]): void => {
    items.sort((left, right) => compareBySortIndex(left.folder, right.folder));
    for (const item of items) {
      item.conversations.sort(compareBySortIndex);
      sortNodes(item.children);
    }
  };
  sortNodes(roots);
  return roots;
}

function requireFolder(folders: readonly FolderRecord[], folderId: string): FolderRecord {
  const folder = folders.find((candidate) => candidate.id === folderId);
  if (!folder) {
    throw new Error(`Folder not found: ${folderId}`);
  }
  return folder;
}

function compareBySortIndex(
  left: { sortIndex: number; createdAt?: number; assignedAt?: number },
  right: { sortIndex: number; createdAt?: number; assignedAt?: number },
): number {
  return left.sortIndex - right.sortIndex ||
    (left.createdAt ?? left.assignedAt ?? 0) - (right.createdAt ?? right.assignedAt ?? 0);
}
