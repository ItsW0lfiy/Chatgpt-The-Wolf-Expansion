import type {
  ChatGPTAdapter,
  ConversationReference,
} from "../../adapters/chatgpt/ChatGPTAdapter";
import { normalizeConversationIdentity, type NormalizedConversationIdentity } from "../../adapters/chatgpt/conversationIdentity";
import type { Logger } from "../../core/logger";
import type { WolfSidebarRoot } from "../../core/WolfSidebarRoot";
import { createWolfElement } from "../../shared/dom";
import { createIcon } from "../../shared/icons";
import type {
  FolderRecord,
  ItemNameDisplayMode,
  WolfExpansionSettings,
} from "../../storage/schemas";
import { getFolderChatNameDisplayChoice } from "../../settings/folderDisplayMode";
import { wouldCreateFolderCycle } from "../folders/FoldersRepository";
import {
  getValidFolderDestinations,
  type QuickAccessChatView,
  type QuickAccessFolderView,
  type QuickAccessProjection,
} from "./quickAccessProjection";
import {
  FolderNameEditorController,
  MAX_FOLDER_NAME_LENGTH,
  isFolderDraggable,
  type FolderNameEditorResolution,
  type FolderNameEditorState,
} from "./folderNameEditorState";
import { ExclusiveDragIndicator } from "./dragIndicatorState";
import {
  ITEM_NAME_RESET_DURATION_MS,
  ITEM_NAME_REVEAL_DELAY_MS,
  getItemNameOverflowState,
  getItemNameReadableViewport,
  getItemNameRevealWidth,
  getItemNameSemantics,
} from "./itemNameDisplay";
import {
  getChevronPresentation,
  getQuickAccessHierarchyLayout,
} from "./hierarchyLayout";
import {
  shouldCancelFolderNameEditor,
  shouldCloseFolderMenu,
} from "./outsideInteraction";
import type { TreeBranchMetadata } from "./treeBranchMetadata";

interface QuickAccessSidebarCallbacks {
  onSectionCollapseChange(collapsed: boolean): Promise<void>;
  onToggleQuickAccess(conversation: NormalizedConversationIdentity): Promise<boolean>;
  onRemoveQuickAccess(conversationId: string): Promise<void>;
  onReorderRootChats(conversationIds: string[]): Promise<void>;
  onFolderCollapseChange(folderId: string, collapsed: boolean): Promise<void>;
  onCreateFolder(name: string, parentId: string | null): Promise<void>;
  onRenameFolder(folderId: string, name: string): Promise<void>;
  onMoveFolder(folderId: string, parentId: string | null, targetIndex?: number): Promise<void>;
  onMoveFolderByOne(folderId: string, direction: -1 | 1): Promise<void>;
  onDeleteFolder(folderId: string): Promise<void>;
  onSetFolderChatNameDisplay(
    folderId: string,
    mode: ItemNameDisplayMode | null,
  ): Promise<void>;
  onAssignConversation(
    folderId: string,
    conversation: NormalizedConversationIdentity,
    source: ChatDragKind,
  ): Promise<void>;
  onRemoveConversationFromFolder(conversationId: string): Promise<void>;
  onReorderFolderChats(folderId: string, conversationIds: string[]): Promise<void>;
  onDebugToggleCurrentConversation(): Promise<void>;
  onOpenConversationMenu(
    conversation: NormalizedConversationIdentity,
    anchor: HTMLElement,
  ): void;
}

type ChatDragKind = "native-chat" | "quick-access-chat" | "folder-chat";
type DragPayload =
  | {
      kind: ChatDragKind;
      conversation: NormalizedConversationIdentity;
      sourceFolderId: string | null;
      isQuickAccess: boolean;
    }
  | { kind: "folder"; folderId: string };

type EditorMode =
  | { kind: "move"; folderId: string }
  | { kind: "delete"; folderId: string; name: string }
  | { kind: "actions"; folderId: string }
  | null;

interface EditorDomSnapshot {
  hadFocus: boolean;
  selectionEnd: number | null;
  selectionStart: number | null;
}

export class QuickAccessSidebar {
  private section: HTMLElement | null = null;
  private actionRoot: HTMLElement | null = null;
  private editorMode: EditorMode = null;
  private readonly nameEditor = new FolderNameEditorController();
  private activeNameEditorForm: HTMLFormElement | null = null;
  private activeNameEditorKey: string | null = null;
  private editorReconciliationInProgress = false;
  private editorIntentionalBlur = false;
  private dragPayload: DragPayload | null = null;
  private readonly dragIndicator = new ExclusiveDragIndicator<HTMLElement>();
  private projection: QuickAccessProjection = { folders: [], looseChats: [], visible: false };
  private settings: WolfExpansionSettings | null = null;
  private collapsed = false;
  private currentConversationId: string | null = null;
  private readonly titlePreviews = new Map<string, string>();
  private lastRenderSignature: string | null = null;
  private readonly conversations = new Map<string, NormalizedConversationIdentity>();
  private readonly nativeDraggableStates = new Map<HTMLElement, string | null>();
  private folderMenuGuardInstalled = false;

  public constructor(
    private readonly adapter: ChatGPTAdapter,
    private readonly callbacks: QuickAccessSidebarCallbacks,
    private readonly sidebarRoot: WolfSidebarRoot,
    private readonly logger: Logger,
  ) {}

  public render(
    projection: QuickAccessProjection,
    settings: WolfExpansionSettings,
    collapsed: boolean,
    currentConversationId: string | null,
  ): void {
    this.projection = projection;
    this.settings = settings;
    this.collapsed = collapsed;
    this.currentConversationId = currentConversationId;
    this.conversations.clear();
    collectProjectionConversations(projection, this.conversations);
    const editorSnapshot = this.captureActiveEditor();
    this.editorReconciliationInProgress = editorSnapshot !== null;
    const section = this.ensureMounted();
    if (!section) {
      this.editorReconciliationInProgress = false;
      return;
    }
    const renderSignature = this.createRenderSignature(
      projection,
      settings,
      collapsed,
      currentConversationId,
    );
    if (this.lastRenderSignature === renderSignature && section.childElementCount > 0) {
      this.finishEditorReconciliation(editorSnapshot);
      this.syncFolderMenuOutsideGuard();
      this.logger.debug("Wolf root moved without rebuilding Quick Access content.");
      return;
    }
    section.dataset.itemNameDisplay = settings.favorites.itemNameDisplay;
    section.dataset.folderIcons = String(
      settings.folders.enabled && settings.folders.showIcons,
    );
    if (this.dragPayload) {
      this.logger.debug("Quick Access reconciliation cancelled the active drag safely.");
      this.endDrag();
    } else {
      this.clearDropFeedback();
    }
    section.replaceChildren();

    const header = document.createElement("div");
    header.className = "wolf-quick-access-header";
    const toggle = createWolfElement("button", "quick-access-toggle");
    toggle.type = "button";
    toggle.className = "wolf-quick-access-toggle";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-controls", "wolf-expansion-quick-access-tree");
    toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} Quick Access`);
    toggle.dataset.chevronDirection = getChevronPresentation(!collapsed).direction;
    toggle.append(
      createIcon(getChevronPresentation(!collapsed).icon),
      document.createTextNode("Quick Access"),
    );
    toggle.addEventListener("click", () => {
      void this.runSafely(() => this.callbacks.onSectionCollapseChange(!collapsed));
    });
    const addFolder = this.createIconButton("plus", "Create root folder");
    addFolder.hidden = !settings.folders.enabled;
    addFolder.addEventListener("click", () => {
      this.beginCreateFolder(null);
    });
    header.append(toggle, addFolder);
    section.append(header);

    if (settings.debug.enabled && settings.favorites.enabled) {
      const currentConversationId = this.adapter.getCurrentConversationId();
      const debug = createWolfElement("button", "debug-quick-access-current");
      debug.type = "button";
      debug.className = "wolf-debug-quick-access-current";
      debug.textContent = `Debug: ${currentConversationId && this.conversations.has(currentConversationId) ? "Remove current chat from" : "Add current chat to"} Quick Access`;
      debug.disabled = currentConversationId === null;
      debug.addEventListener("click", () => void this.runSafely(
        this.callbacks.onDebugToggleCurrentConversation,
      ));
      section.append(debug);
    }

    const nameEditorState = this.nameEditor.activeState;
    if (nameEditorState?.kind === "create" && nameEditorState.parentId === null) {
      section.append(this.createNameEditor(nameEditorState, "Folder name"));
    }

    const tree = createWolfElement("div", "quick-access-tree");
    tree.id = "wolf-expansion-quick-access-tree";
    tree.className = "wolf-quick-access-tree";
    tree.classList.toggle("wolf-is-collapsed", collapsed);
    tree.setAttribute("aria-hidden", String(collapsed));
    tree.inert = collapsed;
    tree.setAttribute("role", "tree");
    tree.setAttribute("aria-label", "Quick Access folders and conversations");
    const treeContent = document.createElement("div");
    treeContent.className = "wolf-quick-access-tree-content";
    this.appendHierarchyRegions(
      treeContent,
      projection.folders,
      projection.looseChats,
      null,
      0,
    );
    if (projection.folders.length === 0 && projection.looseChats.length === 0) {
      const empty = document.createElement("p");
      empty.className = "wolf-quick-access-empty";
      empty.textContent = settings.folders.enabled
        ? "No Quick Access chats or folders yet"
        : "No Quick Access chats yet";
      treeContent.append(empty);
    }
    tree.append(treeContent);
    section.append(tree);

    const status = createWolfElement("p", "drag-status");
    status.className = "wolf-visually-hidden";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    section.append(status);
    this.lastRenderSignature = renderSignature;
    this.finishEditorReconciliation(editorSnapshot);
    this.syncFolderMenuOutsideGuard();
  }

  public syncNativeRows(
    conversationReferences: readonly ConversationReference[],
    favoriteIds: ReadonlySet<string>,
    quickAccessEnabled: boolean,
    foldersEnabled: boolean,
  ): void {
    this.bindActionRoot();
    const retainedActions = new Set<HTMLElement>();
    const retainedRows = new Set<HTMLElement>();
    for (const reference of conversationReferences) {
      const normalized = normalizeConversationIdentity(reference);
      if (!normalized.ok) {
        continue;
      }
      this.conversations.set(reference.conversationId, normalized.conversation);
      const target = this.adapter.findConversationActionInsertionTarget(reference.link);
      if (!target) {
        continue;
      }
      retainedRows.add(target.row);
      if (foldersEnabled) {
        this.markNativeRowDraggable(target.row, reference.conversationId);
      }
      if (!quickAccessEnabled) {
        continue;
      }
      const existing = Array.from(
        target.row.querySelectorAll<HTMLElement>(
          '[data-wolf-expansion="row-quick-access-action"]',
        ),
      ).find((element) => element.dataset.conversationId === reference.conversationId);
      const container = existing ?? createWolfElement("span", "row-quick-access-action");
      retainedActions.add(container);
      container.className = "wolf-row-actions";
      container.dataset.conversationId = reference.conversationId;
      container.dataset.insertionStrategy = target.strategy;
      const button = container.querySelector<HTMLButtonElement>(
        '[data-wolf-expansion="quick-access-row-action"]',
      ) ?? createWolfElement("button", "quick-access-row-action");
      button.type = "button";
      button.className = "wolf-quick-access-star-button";
      button.dataset.conversationId = reference.conversationId;
      button.dataset.wolfExpansionAction = "toggle-quick-access";
      this.updateStarButton(
        button,
        favoriteIds.has(reference.conversationId),
        reference.title,
      );
      if (!button.parentElement) {
        container.append(button);
      }
      if (container.parentElement !== target.parent || container.nextElementSibling !== target.before) {
        target.parent.insertBefore(container, target.before);
      }
    }
    document
      .querySelectorAll<HTMLElement>('[data-wolf-expansion="row-quick-access-action"]')
      .forEach((element) => {
        if (!retainedActions.has(element)) {
          element.remove();
        }
      });
    for (const row of this.nativeDraggableStates.keys()) {
      if (!retainedRows.has(row) || !foldersEnabled) {
        this.restoreNativeRow(row);
      }
    }
  }

  public remove(): void {
    if (this.section) {
      this.sidebarRoot.unmount("quick-access", this.section);
    }
    this.section = null;
    this.lastRenderSignature = null;
    this.unbindActionRoot();
    document
      .querySelectorAll<HTMLElement>(
        '[data-wolf-expansion="row-quick-access-action"], [data-wolf-expansion="quick-access-row-action"]',
      )
      .forEach((element) => element.remove());
    for (const row of Array.from(this.nativeDraggableStates.keys())) {
      this.restoreNativeRow(row);
    }
    this.adapter.cleanupConversationActionHosts();
    this.dragPayload = null;
    this.editorMode = null;
    this.removeFolderMenuOutsideGuard();
    this.cancelNameEditor(false);
    this.titlePreviews.clear();
  }

  private appendHierarchyRegions(
    parent: HTMLElement,
    folders: readonly QuickAccessFolderView[],
    chats: readonly QuickAccessChatView[],
    parentId: string | null,
    depth: number,
  ): void {
    const folderRegion = createWolfElement("div", "folder-region");
    folderRegion.className = "wolf-folder-region";
    folderRegion.dataset.parentId = parentId ?? "";
    folders.forEach((folder, index) => {
      folderRegion.append(
        this.createInsertionTarget("folder-insert", parentId, index, depth),
        this.createFolder(folder, depth, index, folders.length),
      );
    });
    folderRegion.append(
      this.createInsertionTarget("folder-insert", parentId, folders.length, depth),
    );
    parent.append(folderRegion);

    const chatRegion = createWolfElement("div", "chat-region");
    chatRegion.className = "wolf-chat-region";
    chatRegion.dataset.parentId = parentId ?? "";
    chats.forEach((chat, index) => {
      chatRegion.append(
        this.createInsertionTarget("chat-insert", parentId, index, depth),
        this.createChat(chat, depth, index, chats.length),
      );
    });
    chatRegion.append(
      this.createInsertionTarget("chat-insert", parentId, chats.length, depth),
    );
    parent.append(chatRegion);
  }

  private createFolder(
    node: QuickAccessFolderView,
    depth: number,
    index: number,
    siblingCount: number,
  ): HTMLElement {
    const item = createWolfElement("div", "quick-access-folder");
    item.className = "wolf-quick-access-folder";
    item.dataset.folderId = node.folder.id;
    item.dataset.wolfDragKind = "folder";
    item.dataset.wolfDropKind = "folder";
    item.dataset.hasParent = String(depth > 0);
    item.dataset.itemNameDisplay = this.settings?.favorites.itemNameDisplay ?? "compact";
    this.applyTreeBranchMetadata(item, node.branch);
    item.draggable = isFolderDraggable(this.nameEditor.activeState, node.folder.id);
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-expanded", String(!node.folder.collapsed));
    const hierarchyLayout = getQuickAccessHierarchyLayout(depth, "folder");
    item.dataset.logicalDepth = String(hierarchyLayout.logicalDepth);
    item.dataset.visualDepth = String(hierarchyLayout.visualDepth);
    item.style.setProperty("--wolf-depth", String(hierarchyLayout.visualDepth));
    item.style.setProperty("--wolf-depth-offset", String(hierarchyLayout.logicalDepth));

    const row = document.createElement("div");
    row.className = "wolf-quick-access-folder-row";
    const chevron = getChevronPresentation(!node.folder.collapsed);
    const toggle = this.createIconButton(
      chevron.icon,
      `${node.folder.collapsed ? "Expand" : "Collapse"} ${node.folder.name}`,
    );
    toggle.classList.add("wolf-folder-toggle");
    toggle.dataset.chevronDirection = chevron.direction;
    toggle.setAttribute("aria-expanded", String(!node.folder.collapsed));
    toggle.addEventListener("click", () => void this.runSafely(() =>
      this.callbacks.onFolderCollapseChange(node.folder.id, !node.folder.collapsed)));
    const name = document.createElement("span");
    name.className = "wolf-folder-name";
    if (this.settings?.folders.showIcons) {
      name.append(createIcon("folder"));
    }
    name.append(this.createItemNameViewport(
      node.folder.name,
      this.settings?.favorites.itemNameDisplay ?? "compact",
    ));
    name.title = node.folder.name;
    const controls = document.createElement("span");
    controls.className = "wolf-quick-access-controls";
    controls.append(
      this.createFolderOrderButton(node.folder, -1, index === 0),
      this.createFolderOrderButton(node.folder, 1, index === siblingCount - 1),
    );
    const actions = this.createIconButton("more", `Manage ${node.folder.name}`);
    actions.dataset.folderMenuTrigger = node.folder.id;
    actions.addEventListener("click", () => {
      this.cancelNameEditor(false);
      this.editorMode = this.editorMode?.kind === "actions" &&
        this.editorMode.folderId === node.folder.id
        ? null
        : { kind: "actions", folderId: node.folder.id };
      this.rerender();
    });
    controls.append(actions);
    row.append(toggle, name, controls);
    item.append(row);
    item.prepend(this.createTreeGuides(node.branch));

    if (this.isEditorFor(node.folder.id)) {
      item.append(this.createFolderEditor(node));
    }
    const children = document.createElement("div");
    children.className = "wolf-quick-access-children";
    children.classList.toggle("wolf-is-collapsed", node.folder.collapsed);
    children.setAttribute("role", "group");
    children.setAttribute("aria-hidden", String(node.folder.collapsed));
    children.inert = node.folder.collapsed;
    const childrenContent = document.createElement("div");
    childrenContent.className = "wolf-quick-access-children-content";
    this.appendHierarchyRegions(
      childrenContent,
      node.folders,
      node.chats,
      node.folder.id,
      depth + 1,
    );
    children.append(childrenContent);
    item.append(children);
    return item;
  }

  private createChat(
    chat: QuickAccessChatView,
    depth: number,
    index: number,
    siblingCount: number,
  ): HTMLElement {
    const displayedTitle = this.titlePreviews.get(chat.conversationId) ?? chat.title;
    const nameSemantics = getItemNameSemantics(displayedTitle);
    const item = createWolfElement("div", "quick-access-chat");
    item.className = "wolf-quick-access-chat";
    item.dataset.conversationId = chat.conversationId;
    item.dataset.wolfDragKind = chat.folderId ? "folder-chat" : "quick-access-chat";
    item.dataset.sourceFolderId = chat.folderId ?? "";
    item.dataset.isQuickAccess = String(chat.isQuickAccess);
    item.dataset.hasParent = String(depth > 0);
    item.dataset.itemNameDisplay = chat.nameDisplayMode;
    const isCurrent = chat.conversationId === this.currentConversationId;
    item.classList.toggle("wolf-is-current-conversation", isCurrent);
    this.applyTreeBranchMetadata(item, chat.branch);
    item.draggable = true;
    const hierarchyLayout = getQuickAccessHierarchyLayout(depth, "chat");
    item.dataset.logicalDepth = String(hierarchyLayout.logicalDepth);
    item.dataset.visualDepth = String(hierarchyLayout.visualDepth);
    item.style.setProperty("--wolf-depth", String(hierarchyLayout.visualDepth));
    item.style.setProperty("--wolf-depth-offset", String(hierarchyLayout.logicalDepth));

    const link = createWolfElement("a", "quick-access-chat-link");
    link.className = "wolf-quick-access-chat-link";
    link.href = chat.url;
    link.append(this.createItemNameViewport(nameSemantics.visibleText, chat.nameDisplayMode));
    link.title = nameSemantics.tooltip;
    link.setAttribute("aria-label", nameSemantics.accessibleName);
    if (isCurrent) {
      link.setAttribute("aria-current", "page");
    }
    const controls = document.createElement("span");
    controls.className = "wolf-quick-access-controls";
    if (chat.folderId) {
      controls.append(
        this.createFolderChatOrderButton(chat, -1, index === 0),
        this.createFolderChatOrderButton(chat, 1, index === siblingCount - 1),
      );
      if (this.settings?.favorites.enabled && this.settings.favorites.showIcon) {
        const star = this.createIconButton(
          chat.isQuickAccess ? "star-filled" : "star-outline",
          `${chat.isQuickAccess ? "Remove from" : "Add to"} Quick Access`,
        );
        star.setAttribute("aria-pressed", String(chat.isQuickAccess));
        star.addEventListener("click", () => {
          const conversation = this.conversations.get(chat.conversationId);
          if (conversation) {
            void this.runSafely(() => this.callbacks.onToggleQuickAccess(conversation).then(() => undefined));
          }
        });
        controls.append(star);
      }
      const removeFromFolder = this.createIconButton("folder", `Remove ${chat.title} from folder`);
      removeFromFolder.addEventListener("click", () => void this.runSafely(() =>
        this.callbacks.onRemoveConversationFromFolder(chat.conversationId)));
      controls.append(removeFromFolder);
    } else {
      controls.append(
        this.createChatOrderButton(chat, -1, index === 0),
        this.createChatOrderButton(chat, 1, index === siblingCount - 1),
      );
      const remove = this.createIconButton("star-filled", `Remove ${chat.title} from Quick Access`);
      remove.addEventListener("click", () => void this.runSafely(() =>
        this.callbacks.onRemoveQuickAccess(chat.conversationId)));
      controls.append(remove);
    }
    controls.append(this.createNativeActionsButton(chat));
    item.append(this.createTreeGuides(chat.branch), link, controls);
    return item;
  }

  private createTreeGuides(branch: TreeBranchMetadata): HTMLElement {
    const guides = createWolfElement("span", "tree-guides");
    guides.className = "wolf-tree-guides";
    guides.setAttribute("aria-hidden", "true");
    if (branch.depth === 0) {
      guides.hidden = true;
      return guides;
    }
    branch.ancestorHasNextSibling.forEach((continues, column) => {
      if (!continues) {
        return;
      }
      const guide = document.createElement("span");
      guide.className = "wolf-tree-guide wolf-tree-guide-ancestor";
      guide.style.setProperty("--wolf-tree-column", String(column));
      guides.append(guide);
    });
    const branchGuide = document.createElement("span");
    branchGuide.className = "wolf-tree-guide wolf-tree-guide-branch";
    branchGuide.classList.toggle("wolf-is-last-branch", branch.isLastSibling);
    branchGuide.style.setProperty("--wolf-tree-column", String(branch.depth - 1));
    guides.append(branchGuide);
    return guides;
  }

  private applyTreeBranchMetadata(
    item: HTMLElement,
    branch: TreeBranchMetadata,
  ): void {
    item.dataset.treeDepth = String(branch.depth);
    item.dataset.treeLastSibling = String(branch.isLastSibling);
    item.dataset.treeAncestorContinuations = branch.ancestorHasNextSibling
      .map((continues) => continues ? "1" : "0")
      .join("");
  }

  private createNativeActionsButton(chat: QuickAccessChatView): HTMLButtonElement {
    const label = `Actions for ${chat.title}`;
    const button = this.createIconButton("more", label);
    button.dataset.nativeConversationActions = chat.conversationId;
    button.setAttribute("aria-haspopup", "menu");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const conversation = this.conversations.get(chat.conversationId);
      if (!conversation) {
        this.logger.debug("Local Quick Access menu aborted: conversation identity unavailable.", {
          conversationId: chat.conversationId,
        });
        return;
      }
      this.callbacks.onOpenConversationMenu(conversation, button);
    });
    return button;
  }

  private createInsertionTarget(
    kind: "folder-insert" | "chat-insert",
    parentId: string | null,
    index: number,
    depth: number,
  ): HTMLElement {
    const target = createWolfElement("div", "drop-insertion-target");
    target.className = "wolf-drop-insertion-target";
    target.dataset.wolfDropKind = kind;
    target.dataset.parentId = parentId ?? "";
    target.dataset.targetIndex = String(index);
    const hierarchyLayout = getQuickAccessHierarchyLayout(
      depth,
      kind === "folder-insert" ? "folder" : "chat",
    );
    target.style.setProperty("--wolf-depth-offset", String(hierarchyLayout.logicalDepth));
    target.setAttribute("aria-label", kind === "folder-insert"
      ? "Folder insertion position"
      : "Conversation insertion position");
    return target;
  }

  private createFolderEditor(node: QuickAccessFolderView): HTMLElement {
    const nameEditorState = this.nameEditor.activeState;
    if (
      (nameEditorState?.kind === "create" && nameEditorState.parentId === node.folder.id) ||
      (nameEditorState?.kind === "rename" && nameEditorState.folderId === node.folder.id)
    ) {
      return this.createNameEditor(
        nameEditorState,
        nameEditorState.kind === "create" ? "Subfolder name" : "Folder name",
      );
    }
    const mode = this.editorMode;
    if (!mode) {
      return document.createElement("span");
    }
    if (mode.kind === "actions") {
      const panel = this.createEditorPanel(node.folder.id);
      const displayRow = document.createElement("label");
      displayRow.className = "wolf-folder-display-choice";
      const displayLabel = document.createElement("span");
      displayLabel.textContent = "Chat name display";
      const displaySelect = document.createElement("select");
      displaySelect.className = "wolf-quick-access-select";
      for (const [value, label] of [
        ["inherit", "Use inherited/default"],
        ["compact", "Compact"],
        ["full", "Full"],
      ] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        displaySelect.append(option);
      }
      displaySelect.value = getFolderChatNameDisplayChoice(
        node.folder.id,
        this.settings?.folders.chatNameDisplayOverrides ?? {},
      );
      displaySelect.addEventListener("change", () => {
        const mode = displaySelect.value === "compact" || displaySelect.value === "full"
          ? displaySelect.value
          : null;
        this.editorMode = null;
        this.removeFolderMenuOutsideGuard();
        void this.runSafely(() =>
          this.callbacks.onSetFolderChatNameDisplay(node.folder.id, mode));
      });
      displayRow.append(displayLabel, displaySelect);
      panel.append(
        this.createEditorActionButton("New subfolder", () =>
          this.beginCreateFolder(node.folder.id)),
        this.createEditorActionButton("Rename", () =>
          this.beginRenameFolder(node.folder)),
        displayRow,
        this.createModeButton("Move into…", { kind: "move", folderId: node.folder.id }),
      );
      const parent = this.getFolderRecord(node.folder.parentId);
      if (parent) {
        panel.append(this.createOperationButton("Move to parent", () =>
          this.callbacks.onMoveFolder(node.folder.id, parent.parentId)));
      }
      if (node.folder.parentId !== null) {
        panel.append(this.createOperationButton("Move to root", () =>
          this.callbacks.onMoveFolder(node.folder.id, null)));
      }
      panel.append(
        this.createOperationButton("Move up", () =>
          this.callbacks.onMoveFolderByOne(node.folder.id, -1)),
        this.createOperationButton("Move down", () =>
          this.callbacks.onMoveFolderByOne(node.folder.id, 1)),
        this.createModeButton("Delete", {
          kind: "delete",
          folderId: node.folder.id,
          name: node.folder.name,
        }),
        this.createCancelButton(),
      );
      return panel;
    }
    if (mode.kind === "delete") {
      const panel = this.createEditorPanel(node.folder.id);
      const warning = document.createElement("span");
      warning.textContent = `Delete “${mode.name}”? Chats will be unfiled and subfolders preserved.`;
      const remove = this.createOperationButton("Delete", () =>
        this.callbacks.onDeleteFolder(node.folder.id));
      remove.classList.add("wolf-danger-action");
      panel.append(warning, remove, this.createCancelButton());
      return panel;
    }
    const panel = this.createEditorPanel(node.folder.id);
    const select = document.createElement("select");
    select.className = "wolf-quick-access-select";
    const destinations = getValidFolderDestinations(this.getFolderRecords(), node.folder.id);
    if (destinations.length === 0) {
      const empty = document.createElement("span");
      empty.textContent = "No valid destination folders";
      panel.append(empty, this.createCancelButton());
      return panel;
    }
    for (const folder of destinations) {
      const option = document.createElement("option");
      option.value = folder.id;
      option.textContent = folder.name;
      select.append(option);
    }
    if (node.folder.parentId && destinations.some((folder) => folder.id === node.folder.parentId)) {
      select.value = node.folder.parentId;
    }
    panel.append(
      select,
      this.createOperationButton("Move", () =>
        this.callbacks.onMoveFolder(node.folder.id, select.value)),
      this.createCancelButton(),
    );
    return panel;
  }

  private bindActionRoot(): void {
    const sidebar = this.adapter.findSidebar();
    if (sidebar === this.actionRoot) {
      return;
    }
    this.unbindActionRoot();
    this.actionRoot = sidebar;
    this.actionRoot?.addEventListener("click", this.handleDelegatedClick, true);
    this.actionRoot?.addEventListener("dragstart", this.handleDragStart);
    this.actionRoot?.addEventListener("dragover", this.handleDragOver);
    this.actionRoot?.addEventListener("dragleave", this.handleDragLeave);
    this.actionRoot?.addEventListener("drop", this.handleDrop);
    this.actionRoot?.addEventListener("dragend", this.handleDragEnd);
  }

  private unbindActionRoot(): void {
    this.actionRoot?.removeEventListener("click", this.handleDelegatedClick, true);
    this.actionRoot?.removeEventListener("dragstart", this.handleDragStart);
    this.actionRoot?.removeEventListener("dragover", this.handleDragOver);
    this.actionRoot?.removeEventListener("dragleave", this.handleDragLeave);
    this.actionRoot?.removeEventListener("drop", this.handleDrop);
    this.actionRoot?.removeEventListener("dragend", this.handleDragEnd);
    this.actionRoot = null;
  }

  private readonly handleDelegatedClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element) || !this.actionRoot) {
      return;
    }
    const button = target.closest<HTMLButtonElement>(
      '[data-wolf-expansion="quick-access-row-action"][data-wolf-expansion-action="toggle-quick-access"]',
    );
    if (!button || !this.actionRoot.contains(button)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const reference = this.adapter.resolveConversationFromActionElement(button);
    if (!reference) {
      this.logger.debug("Quick Access row action aborted: conversation target unresolved.");
      return;
    }
    const normalized = normalizeConversationIdentity(reference);
    if (!normalized.ok) {
      this.logger.debug(`Quick Access row action aborted: ${normalized.reason}.`);
      return;
    }
    void this.runSafely(async () => {
      const active = await this.callbacks.onToggleQuickAccess(normalized.conversation);
      this.updateVisibleStars(normalized.conversation.conversationId, active, reference.title);
    });
  };

  private readonly handleDragStart = (event: DragEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest('[data-wolf-expansion="quick-access-name-editor"]')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const source = target.closest<HTMLElement>(
      '[data-wolf-drag-kind], [data-wolf-native-chat-drag="true"]',
    );
    if (!source) {
      return;
    }
    if (source.dataset.wolfNativeChatDrag === "true") {
      const reference = this.adapter.resolveConversationFromActionElement(source);
      const normalized = reference ? normalizeConversationIdentity(reference) : null;
      if (!normalized?.ok) {
        event.preventDefault();
        this.logger.debug("Native chat drag rejected: identity could not be normalized.");
        return;
      }
      this.dragPayload = {
        kind: "native-chat",
        conversation: normalized.conversation,
        sourceFolderId: null,
        isQuickAccess: false,
      };
      this.logger.debug("Drag started: chat.", { source: "native-chat" });
    } else if (source.dataset.wolfDragKind === "folder") {
      const folderId = source.dataset.folderId;
      if (!folderId) {
        event.preventDefault();
        return;
      }
      if (this.nameEditor.isEditingFolder(folderId)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      this.dragPayload = { kind: "folder", folderId };
      this.section?.classList.add("wolf-is-dragging-folder");
      this.logger.debug("Drag started: folder.", { folderId });
    } else {
      const conversationId = source.dataset.conversationId;
      const conversation = conversationId ? this.conversations.get(conversationId) : null;
      const kind = source.dataset.wolfDragKind;
      if (!conversation || (kind !== "quick-access-chat" && kind !== "folder-chat")) {
        event.preventDefault();
        return;
      }
      this.dragPayload = {
        kind,
        conversation,
        sourceFolderId: source.dataset.sourceFolderId || null,
        isQuickAccess: source.dataset.isQuickAccess === "true",
      };
      this.logger.debug("Drag started: chat.", { source: kind });
    }
    event.dataTransfer?.setData("application/x-wolf-expansion", this.dragPayload.kind);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
    source.classList.add("wolf-is-drag-source");
    this.section?.classList.add("wolf-is-dragging");
  };

  private readonly handleDragOver = (event: DragEvent): void => {
    const target = this.findDropTarget(event);
    if (!target || !this.dragPayload) {
      return;
    }
    event.preventDefault();
    const validity = this.getDropValidity(target, this.dragPayload);
    this.setDropFeedback(target, validity);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = validity ? "move" : "none";
    }
    this.announce(validity ? "Valid drop target" : "Invalid drop target");
  };

  private readonly handleDragLeave = (event: DragEvent): void => {
    const target = this.findDropTarget(event);
    if (target && !target.contains(event.relatedTarget as Node | null)) {
      this.clearDropFeedback(target);
    }
  };

  private readonly handleDrop = (event: DragEvent): void => {
    const target = this.findDropTarget(event);
    const payload = this.dragPayload;
    if (!target || !payload) {
      return;
    }
    event.preventDefault();
    if (!this.getDropValidity(target, payload)) {
      this.logger.debug("Drop rejected: invalid target.");
      this.endDrag();
      return;
    }
    void this.runSafely(() => this.executeDrop(target, payload));
    this.endDrag();
  };

  private readonly handleDragEnd = (): void => this.endDrag();

  private async executeDrop(target: HTMLElement, payload: DragPayload): Promise<void> {
    const kind = target.dataset.wolfDropKind;
    const parentId = target.dataset.parentId || null;
    const targetIndex = Number(target.dataset.targetIndex ?? "0");
    if (kind === "folder") {
      const folderId = target.dataset.folderId;
      if (!folderId) {
        return;
      }
      this.logger.debug(`Drop target folder=${folderId}`);
      if (payload.kind === "folder") {
        await this.callbacks.onMoveFolder(payload.folderId, folderId);
        this.logger.debug("Folder parent changed.", { folderId: payload.folderId, parentId: folderId });
      } else {
        await this.callbacks.onAssignConversation(folderId, payload.conversation, payload.kind);
      }
      return;
    }
    if (kind === "folder-insert") {
      if (payload.kind === "folder") {
        await this.callbacks.onMoveFolder(payload.folderId, parentId, targetIndex);
        this.logger.debug("Folder reordered.", { folderId: payload.folderId, parentId, targetIndex });
      } else {
        this.logger.debug("Drop constrained to chat region.");
        await this.moveChatToRegion(payload, parentId, 0);
      }
      return;
    }
    if (kind === "chat-insert") {
      if (payload.kind === "folder") {
        this.logger.debug("Drop constrained to folder region.");
        const siblingCount = parentId
          ? this.findFolderView(parentId)?.folders.length ?? 0
          : this.projection.folders.length;
        await this.callbacks.onMoveFolder(payload.folderId, parentId, siblingCount);
      } else {
        await this.moveChatToRegion(payload, parentId, targetIndex);
      }
    }
  }

  private async moveChatToRegion(
    payload: Exclude<DragPayload, { kind: "folder" }>,
    parentId: string | null,
    targetIndex: number,
  ): Promise<void> {
    if (parentId) {
      await this.callbacks.onAssignConversation(parentId, payload.conversation, payload.kind);
      const originalIds = (this.findFolderView(parentId)?.chats ?? [])
        .map((chat) => chat.conversationId);
      const currentIndex = originalIds.indexOf(payload.conversation.conversationId);
      const ids = originalIds.filter((id) => id !== payload.conversation.conversationId);
      if (currentIndex >= 0 && currentIndex < targetIndex) {
        targetIndex -= 1;
      }
      ids.splice(Math.max(0, Math.min(targetIndex, ids.length)), 0, payload.conversation.conversationId);
      await this.callbacks.onReorderFolderChats(parentId, ids);
      return;
    }
    if (payload.kind === "folder-chat") {
      await this.callbacks.onRemoveConversationFromFolder(payload.conversation.conversationId);
      if (!payload.isQuickAccess) {
        return;
      }
    }
    const originalIds = this.projection.looseChats.map((chat) => chat.conversationId);
    const currentIndex = originalIds.indexOf(payload.conversation.conversationId);
    const ids = originalIds.filter((id) => id !== payload.conversation.conversationId);
    if (currentIndex >= 0 && currentIndex < targetIndex) {
      targetIndex -= 1;
    }
    ids.splice(Math.max(0, Math.min(targetIndex, ids.length)), 0, payload.conversation.conversationId);
    await this.callbacks.onReorderRootChats(ids);
    this.logger.debug("Chat reordered.", { parentId: null, targetIndex });
  }

  private getDropValidity(target: HTMLElement, payload: DragPayload): boolean {
    const kind = target.dataset.wolfDropKind;
    if (kind === "folder") {
      const folderId = target.dataset.folderId;
      if (!folderId) {
        return false;
      }
      if (payload.kind !== "folder") {
        return true;
      }
      if (folderId === payload.folderId) {
        this.logger.debug("Drop rejected: self-parent.", { folderId });
        return false;
      }
      const cyclic = wouldCreateFolderCycle(this.getFolderRecords(), payload.folderId, folderId);
      if (cyclic) {
        this.logger.debug("Drop rejected: descendant cycle.", {
          folderId: payload.folderId,
          parentId: folderId,
        });
      }
      return !cyclic;
    }
    if (kind === "folder-insert") {
      if (payload.kind !== "folder") {
        return target.dataset.parentId !== "" || payload.kind === "folder-chat" || payload.isQuickAccess;
      }
      return !wouldCreateFolderCycle(
        this.getFolderRecords(),
        payload.folderId,
        target.dataset.parentId || null,
      );
    }
    if (kind === "chat-insert") {
      if (payload.kind === "folder") {
        return !wouldCreateFolderCycle(
          this.getFolderRecords(),
          payload.folderId,
          target.dataset.parentId || null,
        );
      }
      return target.dataset.parentId !== "" || payload.kind === "folder-chat" || payload.isQuickAccess;
    }
    return false;
  }

  private findDropTarget(event: DragEvent): HTMLElement | null {
    const target = event.target;
    return target instanceof Element
      ? target.closest<HTMLElement>("[data-wolf-drop-kind]")
      : null;
  }

  private markNativeRowDraggable(row: HTMLElement, conversationId: string): void {
    if (!this.nativeDraggableStates.has(row)) {
      this.nativeDraggableStates.set(row, row.getAttribute("draggable"));
    }
    row.draggable = true;
    row.dataset.wolfNativeChatDrag = "true";
    row.dataset.wolfConversationId = conversationId;
  }

  private restoreNativeRow(row: HTMLElement): void {
    const previous = this.nativeDraggableStates.get(row);
    if (previous === null) {
      row.removeAttribute("draggable");
    } else if (previous !== undefined) {
      row.setAttribute("draggable", previous);
    }
    delete row.dataset.wolfNativeChatDrag;
    delete row.dataset.wolfConversationId;
    this.nativeDraggableStates.delete(row);
  }

  private updateStarButton(
    button: HTMLButtonElement,
    active: boolean,
    title: string,
  ): void {
    button.replaceChildren(createIcon(active ? "star-filled" : "star-outline"));
    button.classList.toggle("wolf-is-quick-access", active);
    button.title = `${active ? "Remove" : "Add"} ${title} ${active ? "from" : "to"} Quick Access`;
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(active));
  }

  private updateVisibleStars(conversationId: string, active: boolean, title: string): void {
    this.actionRoot
      ?.querySelectorAll<HTMLButtonElement>('[data-wolf-expansion="quick-access-row-action"]')
      .forEach((button) => {
        if (button.dataset.conversationId === conversationId) {
          this.updateStarButton(button, active, title);
        }
      });
  }

  public setConversationTitlePreview(conversationId: string, draft: string): void {
    this.titlePreviews.set(conversationId, draft);
    this.updateRenderedConversationTitle(conversationId, draft);
  }

  public clearConversationTitlePreview(conversationId: string): void {
    this.titlePreviews.delete(conversationId);
    const canonical = this.conversations.get(conversationId);
    if (canonical) {
      this.updateRenderedConversationTitle(conversationId, canonical.title);
    }
  }

  private updateRenderedConversationTitle(conversationId: string, title: string): void {
    const row = this.section?.querySelector<HTMLElement>(
      `[data-wolf-expansion="quick-access-chat"][data-conversation-id="${CSS.escape(conversationId)}"]`,
    );
    const link = row?.querySelector<HTMLAnchorElement>(
      '[data-wolf-expansion="quick-access-chat-link"]',
    );
    const viewport = link?.querySelector<HTMLElement>(".wolf-item-name-viewport");
    const text = viewport?.querySelector<HTMLElement>(".wolf-item-name-text");
    if (!link || !viewport || !text) {
      return;
    }
    text.textContent = title;
    viewport.title = title;
    link.title = title;
    link.setAttribute("aria-label", title);
    viewport.dispatchEvent(new Event("wolf-title-reset"));
  }

  private createItemNameViewport(
    value: string,
    displayMode: ItemNameDisplayMode,
  ): HTMLSpanElement {
    const viewport = document.createElement("span");
    viewport.className = "wolf-item-name-viewport";
    viewport.dataset.itemNameDisplay = displayMode;
    viewport.title = value;
    const text = document.createElement("span");
    text.className = "wolf-item-name-text";
    text.textContent = value;
    viewport.append(text);
    let revealTimeoutId: number | undefined;
    let resetTimeoutId: number | undefined;
    let pointerInside = false;

    const clearRevealTimeout = (): void => {
      if (revealTimeoutId !== undefined) {
        window.clearTimeout(revealTimeoutId);
        revealTimeoutId = undefined;
      }
    };
    const clearResetTimeout = (): void => {
      if (resetTimeoutId !== undefined) {
        window.clearTimeout(resetTimeoutId);
        resetTimeoutId = undefined;
      }
    };
    const clearRevealGeometry = (): void => {
      text.style.removeProperty("--wolf-name-scroll-distance");
      text.style.removeProperty("--wolf-name-scroll-duration");
      text.style.removeProperty("--wolf-name-reset-duration");
    };

    const resetReveal = (): void => {
      pointerInside = false;
      clearRevealTimeout();
      clearResetTimeout();
      delete viewport.dataset.overflowing;
      delete viewport.dataset.revealActive;
      delete viewport.dataset.revealReturning;
      clearRevealGeometry();
    };
    viewport.addEventListener("wolf-title-reset", resetReveal);

    viewport.addEventListener("pointerenter", () => {
      pointerInside = true;
      clearRevealTimeout();
      clearResetTimeout();
      delete viewport.dataset.revealReturning;
      if (viewport.dataset.itemNameDisplay !== "compact") {
        return;
      }
      const readableViewport = this.measureItemNameViewport(viewport);
      const overflowState = getItemNameOverflowState(
        text.scrollWidth,
        getItemNameRevealWidth(
          viewport.clientWidth,
          readableViewport.inlineEndOcclusion,
          false,
        ),
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
      if (overflowState.overflowing) {
        viewport.dataset.overflowing = "true";
      } else {
        delete viewport.dataset.overflowing;
      }
      if (!overflowState.revealMetrics) {
        delete viewport.dataset.revealActive;
        delete viewport.dataset.revealReturning;
        clearRevealGeometry();
        return;
      }
      revealTimeoutId = window.setTimeout(() => {
        revealTimeoutId = undefined;
        if (!pointerInside || !viewport.isConnected) {
          return;
        }
        viewport.dataset.revealActive = "true";
        window.requestAnimationFrame(() => {
          if (!pointerInside || !viewport.isConnected ||
            viewport.dataset.revealActive !== "true") {
            return;
          }
          const activeMetrics = getItemNameOverflowState(
            text.scrollWidth,
            getItemNameRevealWidth(viewport.clientWidth, 0, true),
            false,
          ).revealMetrics;
          if (!activeMetrics) {
            delete viewport.dataset.revealActive;
            delete viewport.dataset.overflowing;
            clearRevealGeometry();
            return;
          }
          text.style.setProperty(
            "--wolf-name-scroll-distance",
            `${activeMetrics.distancePixels}px`,
          );
          text.style.setProperty(
            "--wolf-name-scroll-duration",
            `${activeMetrics.durationSeconds}s`,
          );
        });
      }, ITEM_NAME_REVEAL_DELAY_MS);
    });
    viewport.addEventListener("pointerleave", () => {
      pointerInside = false;
      clearRevealTimeout();
      clearResetTimeout();
      if (viewport.dataset.revealActive === "true") {
        delete viewport.dataset.revealActive;
        viewport.dataset.revealReturning = "true";
        text.style.setProperty(
          "--wolf-name-reset-duration",
          `${ITEM_NAME_RESET_DURATION_MS}ms`,
        );
        resetTimeoutId = window.setTimeout(() => {
          resetTimeoutId = undefined;
          delete viewport.dataset.revealReturning;
          clearRevealGeometry();
        }, ITEM_NAME_RESET_DURATION_MS);
        return;
      }
      delete viewport.dataset.revealReturning;
      clearRevealGeometry();
    });
    return viewport;
  }

  private measureItemNameViewport(
    viewport: HTMLElement,
  ): ReturnType<typeof getItemNameReadableViewport> {
    const row = viewport.closest<HTMLElement>(
      ".wolf-quick-access-folder-row, .wolf-quick-access-chat",
    );
    const controls = row?.querySelector<HTMLElement>(".wolf-quick-access-controls") ?? null;
    if (!controls) {
      return getItemNameReadableViewport(
        viewport.clientWidth,
        0,
        viewport.clientWidth,
        viewport.clientWidth,
        viewport.clientWidth,
        "ltr",
      );
    }
    const viewportRect = viewport.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const direction = window.getComputedStyle(viewport).direction;
    return getItemNameReadableViewport(
      viewport.clientWidth,
      viewportRect.left,
      viewportRect.right,
      controlsRect.left,
      controlsRect.right,
      direction === "rtl" ? "rtl" : "ltr",
    );
  }

  private createNameEditor(
    state: FolderNameEditorState,
    label: string,
  ): HTMLFormElement {
    const key = this.getNameEditorKey(state);
    if (this.activeNameEditorForm && this.activeNameEditorKey === key) {
      return this.activeNameEditorForm;
    }
    const form = createWolfElement("form", "quick-access-name-editor");
    form.className = "wolf-quick-access-editor";
    form.dataset.editorKey = key;
    const input = document.createElement("input");
    input.className = "wolf-quick-access-input";
    input.type = "text";
    input.maxLength = MAX_FOLDER_NAME_LENGTH;
    input.required = true;
    input.value = state.draft;
    input.placeholder = label;
    input.setAttribute("aria-label", label);
    input.setAttribute("aria-invalid", "false");
    input.addEventListener("input", (event) => {
      event.stopPropagation();
      input.setCustomValidity("");
      input.setAttribute("aria-invalid", "false");
      this.nameEditor.updateDraft(input.value);
      this.logger.debug(state.kind === "rename"
        ? "Rename editor input event."
        : "Folder creation editor input event.");
    });
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      this.logger.debug(state.kind === "rename"
        ? `Rename editor keydown key=${describeEditorKey(event.key)}`
        : `Folder creation editor keydown key=${describeEditorKey(event.key)}`);
      if (event.key === "Enter") {
        event.preventDefault();
        this.resolveNameEditor(input);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancelNameEditor();
        return;
      }
      if (event.key === "Tab") {
        this.editorIntentionalBlur = true;
      }
    });
    input.addEventListener("keyup", (event) => event.stopPropagation());
    input.addEventListener("keypress", (event) => event.stopPropagation());
    input.addEventListener("beforeinput", (event) => event.stopPropagation());
    for (const eventName of [
      "compositionstart",
      "compositionupdate",
      "compositionend",
      "copy",
      "cut",
      "paste",
    ]) {
      input.addEventListener(eventName, (event) => event.stopPropagation());
    }
    input.addEventListener("focus", () => {
      this.editorIntentionalBlur = false;
      if (state.kind === "rename") {
        this.logger.debug(`Rename editor focused folder=${state.folderId}`);
      }
    });
    input.addEventListener("blur", () => {
      if (state.kind === "rename") {
        this.logger.debug(`Rename editor focus lost folder=${state.folderId}`);
      }
      window.setTimeout(() => this.handleNameEditorBlur(input), 0);
    });
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "wolf-quick-access-editor-button";
    save.textContent = "Save";
    save.addEventListener("pointerdown", this.keepEditorFocusDuringButtonPress);
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "wolf-quick-access-editor-button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("pointerdown", this.keepEditorFocusDuringButtonPress);
    cancel.addEventListener("click", (event) => {
      event.stopPropagation();
      this.cancelNameEditor();
    });
    form.append(input, save, cancel);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.resolveNameEditor(input);
    });
    this.isolateNameEditorPointerEvents(form);
    this.activeNameEditorForm = form;
    this.activeNameEditorKey = key;
    this.installEditorFocusGuard();
    if (state.kind === "rename") {
      this.logger.debug(`Rename editor mounted folder=${state.folderId}`);
    } else {
      this.logger.debug("Folder creation editor mounted.", { parentId: state.parentId });
    }
    return form;
  }

  private beginCreateFolder(parentId: string | null): void {
    this.editorMode = null;
    this.discardNameEditorDom();
    this.nameEditor.startCreate(parentId);
    this.rerender();
    this.focusEditor(true);
  }

  private beginRenameFolder(folder: FolderRecord): void {
    this.logger.debug(`Folder rename requested folder=${folder.id}`);
    this.editorMode = null;
    this.discardNameEditorDom();
    this.nameEditor.startRename(folder.id, folder.name);
    this.rerender();
    this.focusEditor(true);
  }

  private resolveNameEditor(input: HTMLInputElement): void {
    this.nameEditor.updateDraft(input.value);
    const resolution = this.nameEditor.resolveEnter();
    if (!resolution) {
      return;
    }
    if (resolution.status === "invalid") {
      input.setCustomValidity("Folder name cannot be empty.");
      input.setAttribute("aria-invalid", "true");
      input.reportValidity();
      this.focusEditor(false);
      return;
    }
    if (resolution.status === "commit") {
      this.commitNameEditor(resolution);
      return;
    }
    if (resolution.status === "cancel") {
      this.logNameEditorCancellation(resolution.state);
    }
    this.finishNameEditor();
  }

  private commitNameEditor(
    resolution: Extract<FolderNameEditorResolution, { status: "commit" }>,
  ): void {
    const { state, name } = resolution;
    if (state.kind === "rename") {
      this.logger.debug(`Rename commit requested folder=${state.folderId}`);
    }
    this.finishNameEditor();
    void this.runSafely(async () => {
      if (state.kind === "rename") {
        await this.callbacks.onRenameFolder(state.folderId, name);
        this.logger.debug(`Rename committed folder=${state.folderId}`);
      } else {
        await this.callbacks.onCreateFolder(name, state.parentId);
        this.logger.debug("Folder created through name editor.", { parentId: state.parentId });
      }
    });
  }

  private cancelNameEditor(rerender = true): void {
    const resolution = this.nameEditor.cancel();
    if (!resolution) {
      return;
    }
    this.logNameEditorCancellation(resolution.state);
    this.finishNameEditor(rerender);
  }

  private cancelNameEditorFromOutside(): void {
    const activeForm = this.activeNameEditorForm;
    const resolution = this.nameEditor.resolveOutsidePointer();
    if (!resolution) {
      return;
    }
    this.logNameEditorCancellation(resolution.state);
    this.editorMode = null;
    this.restoreEditedFolderDraggable(resolution.state);
    this.discardNameEditorDom();
    activeForm?.remove();
    this.lastRenderSignature = null;
    this.logger.debug("Folder name editor cancelled by outside pointer input.");
  }

  private restoreEditedFolderDraggable(state: FolderNameEditorState): void {
    const folderId = state.kind === "rename" ? state.folderId : state.parentId;
    if (!folderId) {
      return;
    }
    const folder = this.section?.querySelector<HTMLElement>(
      `[data-wolf-expansion="quick-access-folder"][data-folder-id="${CSS.escape(folderId)}"]`,
    );
    if (folder) {
      folder.draggable = true;
    }
  }

  private logNameEditorCancellation(state: FolderNameEditorState): void {
    if (state.kind === "rename") {
      this.logger.debug(`Rename cancelled folder=${state.folderId}`);
    } else {
      this.logger.debug("Folder creation cancelled.", { parentId: state.parentId });
    }
  }

  private finishNameEditor(rerender = true): void {
    this.editorMode = null;
    this.discardNameEditorDom();
    if (rerender) {
      this.rerender();
    }
  }

  private discardNameEditorDom(): void {
    this.removeEditorFocusGuard();
    this.activeNameEditorForm = null;
    this.activeNameEditorKey = null;
    this.editorIntentionalBlur = false;
    this.editorReconciliationInProgress = false;
  }

  private getNameEditorKey(state: FolderNameEditorState): string {
    return state.kind === "rename"
      ? `rename:${state.folderId}`
      : `create:${state.parentId ?? "root"}`;
  }

  private captureActiveEditor(): EditorDomSnapshot | null {
    const form = this.activeNameEditorForm;
    const input = form?.querySelector<HTMLInputElement>(".wolf-quick-access-input") ?? null;
    if (!form || !input || !this.nameEditor.activeState) {
      return null;
    }
    this.nameEditor.updateDraft(input.value);
    return {
      hadFocus: document.activeElement === input,
      selectionEnd: input.selectionEnd,
      selectionStart: input.selectionStart,
    };
  }

  private finishEditorReconciliation(snapshot: EditorDomSnapshot | null): void {
    this.editorReconciliationInProgress = false;
    const state = this.nameEditor.activeState;
    if (!state) {
      return;
    }
    const form = this.activeNameEditorForm;
    if (!form?.isConnected) {
      if (state.kind === "rename") {
        this.logger.debug("Rename editor unexpectedly replaced.", { folderId: state.folderId });
      }
      this.cancelNameEditor(false);
      return;
    }
    if (snapshot) {
      if (state.kind === "rename") {
        this.logger.debug("Rename editor preserved during reconciliation.", {
          folderId: state.folderId,
        });
      }
      if (snapshot.hadFocus) {
        this.restoreEditorFocus(snapshot.selectionStart, snapshot.selectionEnd);
      }
    }
  }

  private restoreEditorFocus(selectionStart: number | null, selectionEnd: number | null): void {
    queueMicrotask(() => {
      const input = this.activeNameEditorForm
        ?.querySelector<HTMLInputElement>(".wolf-quick-access-input");
      if (!input?.isConnected || !this.nameEditor.activeState || this.editorIntentionalBlur) {
        return;
      }
      input.focus({ preventScroll: true });
      if (selectionStart !== null && selectionEnd !== null) {
        input.setSelectionRange(selectionStart, selectionEnd);
      }
    });
  }

  private handleNameEditorBlur(input: HTMLInputElement): void {
    if (this.editorReconciliationInProgress || !this.nameEditor.activeState) {
      return;
    }
    if (this.activeNameEditorForm?.contains(document.activeElement)) {
      return;
    }
    if (this.editorIntentionalBlur) {
      return;
    }
    this.logger.debug("Rename editor focus was moved programmatically; restoring it.");
    this.restoreEditorFocus(input.selectionStart, input.selectionEnd);
  }

  private installEditorFocusGuard(): void {
    document.addEventListener("pointerdown", this.handleEditorDocumentPointerDown, true);
  }

  private removeEditorFocusGuard(): void {
    document.removeEventListener("pointerdown", this.handleEditorDocumentPointerDown, true);
  }

  private syncFolderMenuOutsideGuard(): void {
    if (this.editorMode && !this.folderMenuGuardInstalled) {
      document.addEventListener("pointerdown", this.handleFolderMenuDocumentPointerDown, true);
      this.folderMenuGuardInstalled = true;
    } else if (!this.editorMode) {
      this.removeFolderMenuOutsideGuard();
    }
  }

  private removeFolderMenuOutsideGuard(): void {
    if (!this.folderMenuGuardInstalled) {
      return;
    }
    document.removeEventListener("pointerdown", this.handleFolderMenuDocumentPointerDown, true);
    this.folderMenuGuardInstalled = false;
  }

  private readonly handleFolderMenuDocumentPointerDown = (event: PointerEvent): void => {
    const mode = this.editorMode;
    const target = event.target;
    if (!mode || !(target instanceof Node)) {
      return;
    }
    const panel = this.section?.querySelector<HTMLElement>(
      `[data-wolf-expansion="quick-access-folder-editor"][data-folder-id="${CSS.escape(mode.folderId)}"]`,
    );
    const trigger = this.section?.querySelector<HTMLElement>(
      `[data-folder-menu-trigger="${CSS.escape(mode.folderId)}"]`,
    );
    if (!shouldCloseFolderMenu(
      panel?.contains(target) ?? false,
      trigger?.contains(target) ?? false,
    )) {
      return;
    }
    this.editorMode = null;
    panel?.remove();
    this.lastRenderSignature = null;
    this.removeFolderMenuOutsideGuard();
    this.logger.debug("Folder action menu closed by outside pointer input.", {
      folderId: mode.folderId,
    });
  };

  private readonly handleEditorDocumentPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    const insideEditor = target instanceof Node &&
      (this.activeNameEditorForm?.contains(target) ?? false);
    this.editorIntentionalBlur = !insideEditor;
    if (shouldCancelFolderNameEditor(insideEditor)) {
      this.cancelNameEditorFromOutside();
    }
  };

  private readonly keepEditorFocusDuringButtonPress = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  private isolateNameEditorPointerEvents(form: HTMLFormElement): void {
    for (const eventName of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup"] as const) {
      form.addEventListener(eventName, (event) => event.stopPropagation());
    }
    form.addEventListener("dragstart", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  private createEditorPanel(folderId: string): HTMLDivElement {
    const panel = createWolfElement("div", "quick-access-folder-editor");
    panel.className = "wolf-quick-access-editor";
    panel.dataset.folderId = folderId;
    return panel;
  }

  private createModeButton(label: string, mode: Exclude<EditorMode, null>): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wolf-quick-access-editor-button";
    button.textContent = label;
    button.addEventListener("click", () => {
      this.editorMode = mode;
      this.rerender();
    });
    return button;
  }

  private createEditorActionButton(label: string, operation: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wolf-quick-access-editor-button";
    button.textContent = label;
    button.addEventListener("click", operation);
    return button;
  }

  private createOperationButton(label: string, operation: () => Promise<void>): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wolf-quick-access-editor-button";
    button.textContent = label;
    button.addEventListener("click", () => {
      this.editorMode = null;
      this.removeFolderMenuOutsideGuard();
      void this.runSafely(operation);
    });
    return button;
  }

  private createCancelButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wolf-quick-access-editor-button";
    button.textContent = "Cancel";
    button.addEventListener("click", () => {
      this.editorMode = null;
      this.rerender();
    });
    return button;
  }

  private createFolderOrderButton(
    folder: FolderRecord,
    direction: -1 | 1,
    disabled: boolean,
  ): HTMLButtonElement {
    const button = this.createIconButton(
      direction === -1 ? "arrow-up" : "arrow-down",
      `Move ${folder.name} ${direction === -1 ? "up" : "down"}`,
    );
    button.disabled = disabled;
    button.addEventListener("click", () => void this.runSafely(() =>
      this.callbacks.onMoveFolderByOne(folder.id, direction)));
    return button;
  }

  private createChatOrderButton(
    chat: QuickAccessChatView,
    direction: -1 | 1,
    disabled: boolean,
  ): HTMLButtonElement {
    const button = this.createIconButton(
      direction === -1 ? "arrow-up" : "arrow-down",
      `Move ${chat.title} ${direction === -1 ? "up" : "down"}`,
    );
    button.disabled = disabled;
    button.addEventListener("click", () => void this.runSafely(async () => {
      const ids = this.projection.looseChats.map((item) => item.conversationId);
      const current = ids.indexOf(chat.conversationId);
      const target = current + direction;
      if (current < 0 || target < 0 || target >= ids.length) {
        return;
      }
      const swap = ids[target];
      if (!swap) {
        return;
      }
      ids[target] = chat.conversationId;
      ids[current] = swap;
      await this.callbacks.onReorderRootChats(ids);
    }));
    return button;
  }

  private createFolderChatOrderButton(
    chat: QuickAccessChatView,
    direction: -1 | 1,
    disabled: boolean,
  ): HTMLButtonElement {
    const button = this.createIconButton(
      direction === -1 ? "arrow-up" : "arrow-down",
      `Move ${chat.title} ${direction === -1 ? "up" : "down"} in folder`,
    );
    button.disabled = disabled;
    button.addEventListener("click", () => void this.runSafely(async () => {
      if (!chat.folderId) {
        return;
      }
      const ids = (this.findFolderView(chat.folderId)?.chats ?? [])
        .map((item) => item.conversationId);
      const current = ids.indexOf(chat.conversationId);
      const target = current + direction;
      if (current < 0 || target < 0 || target >= ids.length) {
        return;
      }
      const swap = ids[target];
      if (!swap) {
        return;
      }
      ids[target] = chat.conversationId;
      ids[current] = swap;
      await this.callbacks.onReorderFolderChats(chat.folderId, ids);
    }));
    return button;
  }

  private createIconButton(
    icon: Parameters<typeof createIcon>[0],
    label: string,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wolf-icon-button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.append(createIcon(icon));
    return button;
  }

  private ensureMounted(): HTMLElement | null {
    if (!this.section) {
      this.section = createWolfElement("section", "quick-access-section");
      this.section.className = "wolf-quick-access-section";
      this.section.setAttribute("aria-label", "Wolf Expansion Quick Access");
    }
    if (!this.sidebarRoot.mount("quick-access", this.section)) {
      return null;
    }
    this.logger.debug("Quick Access collapse state preserved.", {
      expanded: !this.collapsed,
    });
    return this.section;
  }

  private getFolderRecords(): FolderRecord[] {
    const records: FolderRecord[] = [];
    const collect = (folders: readonly QuickAccessFolderView[]): void => {
      for (const folder of folders) {
        records.push(folder.folder);
        collect(folder.folders);
      }
    };
    collect(this.projection.folders);
    return records;
  }

  private getFolderRecord(folderId: string | null): FolderRecord | null {
    return folderId
      ? this.getFolderRecords().find((folder) => folder.id === folderId) ?? null
      : null;
  }

  private findFolderView(folderId: string): QuickAccessFolderView | null {
    const find = (folders: readonly QuickAccessFolderView[]): QuickAccessFolderView | null => {
      for (const folder of folders) {
        if (folder.folder.id === folderId) {
          return folder;
        }
        const nested = find(folder.folders);
        if (nested) {
          return nested;
        }
      }
      return null;
    };
    return find(this.projection.folders);
  }

  private isEditorFor(folderId: string): boolean {
    const nameEditorState = this.nameEditor.activeState;
    if (
      (nameEditorState?.kind === "create" && nameEditorState.parentId === folderId) ||
      (nameEditorState?.kind === "rename" && nameEditorState.folderId === folderId)
    ) {
      return true;
    }
    const mode = this.editorMode;
    return mode !== null && mode.folderId === folderId;
  }

  private rerender(): void {
    if (this.settings) {
      this.render(
        this.projection,
        this.settings,
        this.collapsed,
        this.currentConversationId,
      );
    }
  }

  private createRenderSignature(
    projection: QuickAccessProjection,
    settings: WolfExpansionSettings,
    collapsed: boolean,
    currentConversationId: string | null,
  ): string {
    const editor = this.nameEditor.activeState;
    const editorIdentity = editor?.kind === "rename"
      ? `rename:${editor.folderId}`
      : editor?.kind === "create"
        ? `create:${editor.parentId ?? "root"}`
        : null;
    return JSON.stringify({
      projection,
      settings: {
        debug: settings.debug.enabled,
        favorites: settings.favorites,
        folders: settings.folders,
      },
      collapsed,
      currentConversationId,
      titlePreviews: [...this.titlePreviews],
      editorIdentity,
      editorMode: this.editorMode,
    });
  }

  private focusEditor(selectContents: boolean): void {
    const input = this.activeNameEditorForm
      ?.querySelector<HTMLInputElement>(".wolf-quick-access-input");
    input?.focus({ preventScroll: true });
    if (selectContents) {
      input?.select();
    }
  }

  private setDropFeedback(target: HTMLElement, valid: boolean): void {
    if (
      this.dragIndicator.current === target &&
      target.classList.contains(valid ? "wolf-is-valid-drop" : "wolf-is-invalid-drop")
    ) {
      return;
    }
    const previous = this.dragIndicator.activate(target);
    if (previous) {
      this.removeDropFeedbackClasses(previous);
    }
    target.classList.toggle("wolf-is-valid-drop", valid);
    target.classList.toggle("wolf-is-invalid-drop", !valid);
    target.dataset.dropStatus = valid ? "Valid drop target" : "Invalid drop target";
  }

  private clearDropFeedback(target?: HTMLElement): void {
    const active = this.dragIndicator.clear(target);
    if (active) {
      this.removeDropFeedbackClasses(active);
    }
    if (target === undefined) {
      this.section
        ?.querySelectorAll<HTMLElement>(".wolf-is-valid-drop, .wolf-is-invalid-drop")
        .forEach((element) => this.removeDropFeedbackClasses(element));
    }
  }

  private removeDropFeedbackClasses(target: HTMLElement): void {
    target.classList.remove("wolf-is-valid-drop", "wolf-is-invalid-drop");
    delete target.dataset.dropStatus;
  }

  private endDrag(): void {
    this.clearDropFeedback();
    this.section?.classList.remove("wolf-is-dragging", "wolf-is-dragging-folder");
    this.actionRoot?.querySelectorAll(".wolf-is-drag-source").forEach((element) => {
      element.classList.remove("wolf-is-drag-source");
    });
    this.dragPayload = null;
  }

  private announce(message: string): void {
    const status = this.section?.querySelector<HTMLElement>(
      '[data-wolf-expansion="drag-status"]',
    );
    if (status && status.textContent !== message) {
      status.textContent = message;
    }
  }

  private async runSafely(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      this.logger.error("A Quick Access action failed.", error);
    }
  }
}

function collectProjectionConversations(
  projection: QuickAccessProjection,
  target: Map<string, NormalizedConversationIdentity>,
): void {
  for (const chat of projection.looseChats) {
    target.set(chat.conversationId, toIdentity(chat));
  }
  const collectFolders = (folders: readonly QuickAccessFolderView[]): void => {
    for (const folder of folders) {
      for (const chat of folder.chats) {
        target.set(chat.conversationId, toIdentity(chat));
      }
      collectFolders(folder.folders);
    }
  };
  collectFolders(projection.folders);
}

function toIdentity(chat: QuickAccessChatView): NormalizedConversationIdentity {
  return {
    conversationId: chat.conversationId,
    route: chat.route,
    title: chat.title,
    url: chat.url,
  };
}

function describeEditorKey(key: string): string {
  return key.length === 1 ? "printable" : key;
}
