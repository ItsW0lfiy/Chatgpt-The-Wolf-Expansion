import { isWolfElement, WOLF_ATTRIBUTE } from "../../shared/dom";
import type { Logger } from "../../core/logger";
import type { Unsubscribe } from "../../shared/types";
import {
  createConversationUrl,
  parseConversationId,
  parseConversationUrl,
  type ConversationRoute,
} from "./conversationUrl";
import {
  normalizeConversationIdentity,
  normalizeConversationTitle,
  selectConversationTitleWithSource,
  type ConversationTitleSource,
} from "./conversationIdentity";
import {
  TransientMenuTargetStore,
  type ConversationMenuKind,
  type PendingMenuTarget,
} from "./menuContext";
import { CHATGPT_SELECTORS } from "./selectors";
import {
  resolveChatGPTAccountEvidence,
  type ChatGPTAccountEvidence,
} from "../../accounts/accountIdentity";
import {
  getWolfRootInsertionIndex,
  type SidebarSectionKind,
} from "./sidebarPlacement";
import {
  classifyNativeConversationMenuAction,
  resolveExactNativeConversationAction,
  resolveUniqueNativeConversationMenuAction,
  type NativeConversationActionCandidate,
  type NativeConversationActionResult,
  type NativeConversationMenuActionDescriptor,
} from "./nativeConversationActions";

export interface ConversationIdentity {
  conversationId: string;
  route: ConversationRoute;
  title: string;
  url: string;
}

export interface ConversationReference extends ConversationIdentity {
  link: HTMLAnchorElement;
  titleDiagnostics: ConversationTitleDiagnostics;
  titleResolved: boolean;
}

export interface ConversationTitleDiagnostics {
  ariaLabel: string;
  normalizedTitle: string;
  selectedSource: ConversationTitleSource;
  textContentFallback: string;
  titleAttribute: string;
  visibleText: string;
}

export interface SidebarInsertionTarget {
  parent: HTMLElement;
  before: Element | null;
  placement: "before-pinned" | "before-history" | "fallback";
}

export interface ConversationMenuContext {
  menu: HTMLElement;
  kind: ConversationMenuKind;
  conversation: ConversationIdentity;
}

export interface ConversationActionInsertionTarget {
  row: HTMLElement;
  parent: HTMLElement;
  before: Element | null;
  strategy: "native-action-group" | "row-owned-sibling";
}

export interface ChatGPTAdapter {
  findSidebar(): HTMLElement | null;
  findSidebarInsertionTarget(): SidebarInsertionTarget | null;
  findConversationLinks(): HTMLAnchorElement[];
  getConversationIdFromUrl(url: string): string | null;
  getCurrentConversationId(): string | null;
  getCurrentConversationIdentity(): ConversationIdentity | null;
  getConversationTitle(element: HTMLElement): string | null;
  getConversationTitleDiagnostics(element: HTMLElement): ConversationTitleDiagnostics;
  getConversationReference(link: HTMLAnchorElement): ConversationReference | null;
  resolveConversationFromActionElement(element: Element): ConversationReference | null;
  findConversationActionInsertionTarget(
    link: HTMLAnchorElement,
  ): ConversationActionInsertionTarget | null;
  openNativeConversationActions(conversationId: string): NativeConversationActionResult;
  listNativeConversationMenuActions(menu: HTMLElement): NativeConversationMenuActionDescriptor[];
  activateNativeConversationMenuAction(
    menu: HTMLElement,
    kind: NativeConversationMenuActionDescriptor["kind"],
  ): boolean;
  activateNativeConversationPinAction(
    conversationId: string,
    kind: "pin" | "unpin",
  ): boolean;
  hideNativeConversationMenuForProxy(menu: HTMLElement): void;
  closeNativeConversationMenu(menu: HTMLElement): void;
  getNativeConversationMenuActionKind(
    menu: HTMLElement,
    element: Element,
  ): NativeConversationMenuActionDescriptor["kind"] | null;
  prepareNativeRenameTracking(conversationId: string): boolean;
  isNativeConversationRenameEditor(element: Element, conversationId: string): boolean;
  readNativeConversationRenameDraft(element: Element, conversationId: string): string | null;
  finishNativeRenameTracking(conversationId: string): void;
  getAccountEvidence(): ChatGPTAccountEvidence;
  watchAccountEvidence(callback: (evidence: ChatGPTAccountEvidence) => void): Unsubscribe;
  watchSidebar(callback: () => void): Unsubscribe;
  watchNavigation(callback: () => void): Unsubscribe;
  watchConversationMenus(callback: (context: ConversationMenuContext) => void): Unsubscribe;
  cleanupConversationActionHosts(): void;
}

const MENU_CONTEXT_MAX_AGE_MS = 3_000;

export class DefaultChatGPTAdapter implements ChatGPTAdapter {
  private lastNativePinnedExpanded: boolean | null | undefined;
  private readonly nativeRenameRows = new Map<string, HTMLElement>();

  public constructor(private readonly logger: Logger) {}

  public findSidebar(): HTMLElement | null {
    let fallback: HTMLElement | null = null;

    for (const selector of CHATGPT_SELECTORS.sidebarCandidates) {
      const candidates = document.querySelectorAll<HTMLElement>(selector);
      const withConversation = Array.from(candidates).find((candidate) =>
        candidate.querySelector(CHATGPT_SELECTORS.conversationLink),
      );

      if (withConversation) {
        return withConversation;
      }

      fallback ??= candidates.item(0);
    }

    return fallback;
  }

  public findSidebarInsertionTarget(): SidebarInsertionTarget | null {
    const sidebar = this.findSidebar();
    if (!sidebar) {
      return null;
    }

    const pinnedMarker = this.findSidebarSectionMarker(sidebar, "pinned");
    const historyMarker = this.findSidebarSectionMarker(sidebar, "history");
    if (pinnedMarker && historyMarker) {
      const sharedParent = this.findLowestSharedParent(
        pinnedMarker,
        historyMarker,
        sidebar,
      );
      const pinnedSection = sharedParent
        ? this.findDirectChildContaining(sharedParent, pinnedMarker)
        : null;
      const historySection = sharedParent
        ? this.findDirectChildContaining(sharedParent, historyMarker)
        : null;
      if (
        sharedParent &&
        pinnedSection &&
        historySection &&
        pinnedSection !== historySection
      ) {
        this.logNativePinnedState(pinnedMarker);
        this.logger.debug("Stable Wolf sidebar anchor resolved.", {
          beforePinned: true,
          beforeHistory: false,
        });
        return {
          parent: sharedParent,
          before: pinnedSection,
          placement: "before-pinned",
        };
      }
    }

    const singleMarker = pinnedMarker ?? historyMarker;
    if (singleMarker) {
      const section = this.findStableSectionBoundary(singleMarker, sidebar);
      if (section?.parentElement instanceof HTMLElement) {
        if (pinnedMarker) {
          this.logNativePinnedState(pinnedMarker);
        }
        const placement = pinnedMarker ? "before-pinned" : "before-history";
        this.logger.debug("Stable Wolf sidebar anchor resolved.", {
          beforePinned: placement === "before-pinned",
          beforeHistory: placement === "before-history",
        });
        return {
          parent: section.parentElement,
          before: section,
          placement,
        };
      }
    }

    const nativeSections = Array.from(sidebar.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && !isWolfElement(element),
    );
    const sectionKinds = nativeSections.map((section) =>
      this.classifySidebarSection(section));
    if (sectionKinds.includes("pinned") || sectionKinds.includes("history")) {
      const insertionIndex = getWolfRootInsertionIndex(sectionKinds);
      const before = nativeSections[insertionIndex] ?? null;
      const pinnedIndex = sectionKinds.indexOf("pinned");
      if (pinnedIndex >= 0) {
        this.logNativePinnedState(nativeSections[pinnedIndex]!);
      }
      this.logger.debug("Stable Wolf sidebar anchor resolved.", {
        beforePinned: pinnedIndex >= 0,
        beforeHistory: sectionKinds[insertionIndex] === "history",
      });
      return {
        parent: sidebar,
        before,
        placement: pinnedIndex >= 0 ? "before-pinned" : "before-history",
      };
    }

    const firstConversationLink = this.findConversationLinks()[0];
    if (!firstConversationLink || !sidebar.contains(firstConversationLink)) {
      return { parent: sidebar, before: sidebar.lastElementChild, placement: "fallback" };
    }

    let section: Element = firstConversationLink;
    while (section.parentElement && section.parentElement !== sidebar) {
      section = section.parentElement;
    }

    return { parent: sidebar, before: section, placement: "fallback" };
  }

  public findConversationLinks(): HTMLAnchorElement[] {
    const sidebar = this.findSidebar();
    if (!sidebar) {
      return [];
    }

    return Array.from(
      sidebar.querySelectorAll<HTMLAnchorElement>(CHATGPT_SELECTORS.conversationLink),
    ).filter(
      (link) => !link.closest(`[${WOLF_ATTRIBUTE}]`) && this.getConversationIdFromUrl(link.href),
    );
  }

  public getConversationIdFromUrl(url: string): string | null {
    return parseConversationId(url, window.location.href);
  }

  public getCurrentConversationId(): string | null {
    return this.getConversationIdFromUrl(window.location.href);
  }

  public getCurrentConversationIdentity(): ConversationIdentity | null {
    const url = window.location.href;
    this.logger.debug("Debug current-chat action: resolving current URL.", url);
    const parsedConversation = parseConversationUrl(url, window.location.href);
    if (!parsedConversation) {
      this.logger.debug("Debug current-chat action aborted: current URL has no conversation ID.");
      return null;
    }

    const { conversationId, route } = parsedConversation;
    this.logger.debug("Debug current-chat action: conversation ID parsed.", conversationId);
    const matchingLink = this.findConversationLinks().find(
      (link) => this.getConversationIdFromUrl(link.href) === conversationId,
    );
    const detectedTitle = matchingLink ? this.getConversationTitle(matchingLink) : null;
    const cleanedPageTitle = document.title.replace(/\s*[|–-]\s*ChatGPT\s*$/iu, "").trim();
    const pageTitle = /^chatgpt$/iu.test(cleanedPageTitle) ? "" : cleanedPageTitle;
    const title = (detectedTitle ?? pageTitle) || "Current conversation";
    this.logger.debug("Debug current-chat action: title resolved.");
    return { conversationId, route, title, url: parsedConversation.canonicalUrl };
  }

  public getConversationTitle(element: HTMLElement): string | null {
    return this.getConversationTitleDiagnostics(element).normalizedTitle || null;
  }

  public getConversationTitleDiagnostics(element: HTMLElement): ConversationTitleDiagnostics {
    const titleSource = element.cloneNode(true);
    if (titleSource instanceof HTMLElement) {
      titleSource.querySelectorAll(`[${WOLF_ATTRIBUTE}]`).forEach((wolfElement) => {
        wolfElement.remove();
      });
    }
    const visibleText = normalizeConversationTitle(element.innerText);
    const textContentFallback = normalizeConversationTitle(titleSource.textContent);
    const ariaLabel = normalizeConversationTitle(element.getAttribute("aria-label"));
    const titleAttribute = normalizeConversationTitle(element.getAttribute("title"));
    const selected = selectConversationTitleWithSource({
      visibleText,
      textContentFallback,
      ariaLabel,
      titleAttribute,
    });
    return {
      ariaLabel,
      normalizedTitle: selected.title,
      selectedSource: selected.source,
      textContentFallback,
      titleAttribute,
      visibleText,
    };
  }

  public getConversationReference(link: HTMLAnchorElement): ConversationReference | null {
    const conversationId = this.getConversationIdFromUrl(link.href);
    if (!conversationId) {
      return null;
    }

    const titleDiagnostics = this.getConversationTitleDiagnostics(link);
    const normalized = normalizeConversationIdentity({
      conversationId,
      title: titleDiagnostics.normalizedTitle,
      url: link.href,
    });
    if (!normalized.ok) {
      this.logger.debug("Conversation row rejected during identity normalization.", {
        conversationId,
        reason: normalized.reason,
      });
      return null;
    }

    return {
      ...normalized.conversation,
      link,
      titleDiagnostics,
      titleResolved: normalized.titleResolved &&
        titleDiagnostics.selectedSource === "visible-text",
    };
  }

  public resolveConversationFromActionElement(element: Element): ConversationReference | null {
    return this.findConversationNearElement(element, true);
  }

  public findConversationActionInsertionTarget(
    link: HTMLAnchorElement,
  ): ConversationActionInsertionTarget | null {
    const sidebar = this.findSidebar();
    const expectedConversationId = this.getConversationIdFromUrl(link.href);
    if (!sidebar || !expectedConversationId) {
      this.logger.debug("Inline Favorite skipped: missing sidebar or valid conversation ID.");
      return null;
    }

    let candidate = link.parentElement;
    let rowOwnedFallback: ConversationActionInsertionTarget | null = null;

    for (let depth = 0; candidate && candidate !== sidebar && depth < 8; depth += 1) {
      const identities = this.findConversationIdentitiesWithin(candidate);
      if (identities.size > 1) {
        this.logger.debug(
          "Row search reached a container with multiple conversation IDs; keeping the smaller row target.",
          identities.size,
        );
        break;
      }

      if (identities.size === 1 && identities.has(expectedConversationId)) {
        this.logger.debug("Sidebar row detected.", expectedConversationId);
        const nativeControls = Array.from(
          candidate.querySelectorAll<HTMLElement>(CHATGPT_SELECTORS.button),
        ).filter(
          (control) =>
            !control.closest(`[${WOLF_ATTRIBUTE}]`) &&
            !control.matches(CHATGPT_SELECTORS.conversationLink) &&
            this.isLikelyConversationRowAction(control),
        );
        const nativeControl = nativeControls[0];
        if (nativeControl?.parentElement) {
          this.logger.debug("Native row actions detected.", {
            conversationId: expectedConversationId,
            count: nativeControls.length,
          });
          return {
            row: candidate,
            parent: nativeControl.parentElement,
            before: nativeControl,
            strategy: "native-action-group",
          };
        }

        if (!rowOwnedFallback && candidate instanceof HTMLElement) {
          const directLinkChild = this.findDirectChildContaining(candidate, link);
          rowOwnedFallback = {
            row: candidate,
            parent: candidate,
            before: directLinkChild?.nextElementSibling ?? null,
            strategy: "row-owned-sibling",
          };
        }
      }
      candidate = candidate.parentElement;
    }

    if (rowOwnedFallback) {
      this.logger.debug("Native row actions unavailable; using stable row-owned Favorite slot.", {
        conversationId: expectedConversationId,
      });
      return rowOwnedFallback;
    }

    this.logger.debug("Row star unavailable: no unambiguous row-owned insertion point.", {
      conversationId: expectedConversationId,
    });
    return null;
  }

  public openNativeConversationActions(
    conversationId: string,
  ): NativeConversationActionResult {
    this.logger.debug("Quick Access native actions requested.", { conversationId });
    const sidebar = this.findSidebar();
    if (!sidebar) {
      return this.logNativeActionUnavailable(conversationId, "row-not-mounted");
    }

    const matchingLinks = this.findConversationLinks().filter(
      (link) => this.getConversationIdFromUrl(link.href) === conversationId,
    );
    const rowCandidates = this.findExactNativeConversationRows(conversationId).map((row) => ({
      conversationIds: [conversationId],
      triggers: Array.from(
        row.querySelectorAll<HTMLElement>(CHATGPT_SELECTORS.conversationMenuTrigger),
      ).filter((control) =>
        !control.closest(`[${WOLF_ATTRIBUTE}]`) && this.isConversationMenuTrigger(control) &&
        (!control.hasAttribute("data-conversation-options-trigger") ||
          control.getAttribute("data-conversation-options-trigger") === conversationId)),
      wolfOwned: isWolfElement(row),
    } satisfies NativeConversationActionCandidate<HTMLElement>));

    const resolution = resolveExactNativeConversationAction(
      conversationId,
      matchingLinks.length,
      rowCandidates,
    );
    if (resolution.status === "unavailable") {
      return this.logNativeActionUnavailable(conversationId, resolution.reason);
    }
    const trigger = resolution.trigger;
    if (
      !trigger.isConnected ||
      trigger.getAttribute("aria-disabled") === "true" ||
      (trigger instanceof HTMLButtonElement && trigger.disabled)
    ) {
      return this.logNativeActionUnavailable(conversationId, "unsupported");
    }

    this.logger.debug("Native row resolved.", { conversationId });
    this.logger.debug("Native action trigger resolved.", { conversationId });
    trigger.focus({ preventScroll: true });
    trigger.click();
    this.logger.debug("Native menu trigger activation dispatched.", { conversationId });
    return { status: "delegated" };
  }

  public listNativeConversationMenuActions(
    menu: HTMLElement,
  ): NativeConversationMenuActionDescriptor[] {
    const descriptors: NativeConversationMenuActionDescriptor[] = [];
    const seenKinds = new Set<string>();
    const ambiguousKinds = new Set<string>();
    const candidates = Array.from(
      menu.querySelectorAll<HTMLElement>(CHATGPT_SELECTORS.menuItem),
    ).filter((item) => !item.closest(`[${WOLF_ATTRIBUTE}]`));
    candidates.forEach((item) => {
      const label = normalizeConversationTitle(
        item.getAttribute("aria-label") || item.innerText || item.textContent || item.title,
      );
      const kind = classifyNativeConversationMenuAction(label);
      if (!kind) {
        return;
      }
      if (seenKinds.has(kind)) {
        ambiguousKinds.add(kind);
        return;
      }
      seenKinds.add(kind);
      descriptors.push({
        disabled: item.getAttribute("aria-disabled") === "true" ||
          (item instanceof HTMLButtonElement && item.disabled),
        kind,
        label,
      });
    });
    for (const kind of ambiguousKinds) {
      this.logger.debug("Native conversation menu action rejected as ambiguous.", { kind });
    }
    const safeDescriptors = descriptors.filter((descriptor) => !ambiguousKinds.has(descriptor.kind));
    return safeDescriptors;
  }

  public activateNativeConversationMenuAction(
    menu: HTMLElement,
    kind: NativeConversationMenuActionDescriptor["kind"],
  ): boolean {
    if (!menu.isConnected) {
      return false;
    }
    const candidates = Array.from(
      menu.querySelectorAll<HTMLElement>(CHATGPT_SELECTORS.menuItem),
    ).map((item) => ({
      disabled: item.getAttribute("aria-disabled") === "true" ||
        (item instanceof HTMLButtonElement && item.disabled),
      element: item,
      kind: classifyNativeConversationMenuAction(
        item.getAttribute("aria-label") || item.innerText || item.textContent || item.title,
      ),
      wolfOwned: item.closest(`[${WOLF_ATTRIBUTE}]`) !== null,
    }));
    const action = resolveUniqueNativeConversationMenuAction(kind, candidates);
    if (!action?.isConnected) {
      return false;
    }
    action.click();
    return true;
  }

  public activateNativeConversationPinAction(
    conversationId: string,
    kind: "pin" | "unpin",
  ): boolean {
    const rows = this.findExactNativeConversationRows(conversationId);
    if (rows.length !== 1) {
      return false;
    }
    const expected = kind === "pin" ? /^Pin(?:\s|$)/iu : /^Unpin(?:\s|$)/iu;
    const buttons = Array.from(rows[0]!.querySelectorAll<HTMLElement>(
      CHATGPT_SELECTORS.nativeConversationPinButton,
    )).filter((button) =>
      !button.closest(`[${WOLF_ATTRIBUTE}]`) &&
      expected.test(button.getAttribute("aria-label")?.trim() ?? "") &&
      button.getAttribute("aria-disabled") !== "true" &&
      (!(button instanceof HTMLButtonElement) || !button.disabled));
    if (buttons.length !== 1 || !buttons[0]!.isConnected) {
      return false;
    }
    buttons[0]!.click();
    return true;
  }

  public hideNativeConversationMenuForProxy(menu: HTMLElement): void {
    menu.dataset.wolfNativeProxyMenu = "true";
    menu.style.setProperty("visibility", "hidden", "important");
    menu.style.setProperty("pointer-events", "none", "important");
  }

  public closeNativeConversationMenu(menu: HTMLElement): void {
    if (!menu.isConnected) {
      return;
    }
    menu.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    }));
  }

  public getNativeConversationMenuActionKind(
    menu: HTMLElement,
    element: Element,
  ): NativeConversationMenuActionDescriptor["kind"] | null {
    const item = element.closest<HTMLElement>(CHATGPT_SELECTORS.menuItem);
    if (!item || !menu.contains(item) || item.closest(`[${WOLF_ATTRIBUTE}]`)) {
      return null;
    }
    const label = item.getAttribute("aria-label") || item.innerText || item.textContent || item.title;
    return classifyNativeConversationMenuAction(label);
  }

  public prepareNativeRenameTracking(conversationId: string): boolean {
    const rows = this.findExactNativeConversationRows(conversationId);
    if (rows.length !== 1) {
      return false;
    }
    this.nativeRenameRows.set(conversationId, rows[0]!);
    return true;
  }

  public isNativeConversationRenameEditor(
    element: Element,
    conversationId: string,
  ): boolean {
    if (element.closest(`[${WOLF_ATTRIBUTE}]`) || !this.findSidebar()?.contains(element)) {
      return false;
    }
    if (!element.matches(CHATGPT_SELECTORS.nativeConversationRenameEditor)) {
      return false;
    }
    const trackedRow = this.nativeRenameRows.get(conversationId);
    if (trackedRow?.isConnected && trackedRow.contains(element)) {
      return true;
    }
    const reference = this.findConversationNearElement(element);
    return reference?.conversationId === conversationId;
  }

  public readNativeConversationRenameDraft(
    element: Element,
    conversationId: string,
  ): string | null {
    if (!this.isNativeConversationRenameEditor(element, conversationId)) {
      return null;
    }
    if (element instanceof HTMLInputElement) {
      return element.value;
    }
    return null;
  }

  public finishNativeRenameTracking(conversationId: string): void {
    this.nativeRenameRows.delete(conversationId);
  }

  public getAccountEvidence(): ChatGPTAccountEvidence {
    const profileButtons = Array.from(
      document.querySelectorAll<HTMLElement>(CHATGPT_SELECTORS.accountProfileButton),
    ).filter((element) => !element.closest(`[${WOLF_ATTRIBUTE}]`) &&
      element.getAttribute("aria-hidden") !== "true" && !element.hidden);
    const profile = profileButtons.find((element) => element.querySelector("img[src]")) ??
      profileButtons[0] ?? null;
    return resolveChatGPTAccountEvidence({
      baseUrl: window.location.href,
      loggedOutControlVisible: Array.from(
        document.querySelectorAll<HTMLElement>(CHATGPT_SELECTORS.loggedOutAuthControl),
      ).some((element) => element.getAttribute("aria-hidden") !== "true" && !element.hidden),
      profileImageSource: profile?.querySelector<HTMLImageElement>("img[src]")?.src.trim() ?? "",
      profilePresent: profile !== null,
    });
  }

  public watchAccountEvidence(
    callback: (evidence: ChatGPTAccountEvidence) => void,
  ): Unsubscribe {
    let scheduled = false;
    const emit = (): void => {
      if (scheduled) {
        return;
      }
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        callback(this.getAccountEvidence());
      });
    };
    const accountSelector = [
      CHATGPT_SELECTORS.accountProfileButton,
      CHATGPT_SELECTORS.loggedOutAuthControl,
    ].join(",");
    const containsAccountEvidence = (node: Node): boolean =>
      node instanceof Element &&
      (node.matches(accountSelector) || node.querySelector(accountSelector) !== null);
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) =>
        containsAccountEvidence(mutation.target) ||
        Array.from(mutation.addedNodes).some(containsAccountEvidence) ||
        Array.from(mutation.removedNodes).some(containsAccountEvidence))) {
        emit();
      }
    });
    observer.observe(document.body, {
      attributeFilter: [
        "aria-hidden",
        "aria-label",
        "data-mobile-auth-entry-action",
        "data-testid",
        "hidden",
        "src",
      ],
      attributes: true,
      childList: true,
      subtree: true,
    });
    window.addEventListener("pageshow", emit);
    return () => {
      observer.disconnect();
      window.removeEventListener("pageshow", emit);
    };
  }

  public watchSidebar(callback: () => void): Unsubscribe {
    let observedSidebar: HTMLElement | null = null;
    const sidebarObserver = new MutationObserver((mutations) => {
      const relevantMutation = mutations.some((mutation) => {
        if (isWolfElement(mutation.target)) {
          return false;
        }

        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return changedNodes.length === 0 || changedNodes.some((node) => !isWolfElement(node));
      });

      if (relevantMutation) {
        this.logger.debug("Sidebar MutationObserver requested reconciliation.");
        callback();
      }
    });

    const observeCurrentSidebar = (): void => {
      const nextSidebar = this.findSidebar();
      if (nextSidebar === observedSidebar && nextSidebar?.isConnected) {
        return;
      }

      sidebarObserver.disconnect();
      observedSidebar = nextSidebar;
      if (observedSidebar) {
        this.logger.debug("Sidebar detected; observer bound.");
        sidebarObserver.observe(observedSidebar, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["href", "aria-expanded", "aria-label", "title"],
        });
      }
      callback();
    };

    observeCurrentSidebar();

    const replacementObserver = new MutationObserver((mutations) => {
      if (!observedSidebar || !observedSidebar.isConnected) {
        observeCurrentSidebar();
        return;
      }

      const sidebarWasRemoved = mutations.some((mutation) =>
        Array.from(mutation.removedNodes).some(
          (node) => node === observedSidebar || (node instanceof Element && node.contains(observedSidebar)),
        ),
      );
      if (sidebarWasRemoved) {
        this.logger.debug("Sidebar replacement detected; reconciling integration.");
        observeCurrentSidebar();
      }
    });
    replacementObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      sidebarObserver.disconnect();
      replacementObserver.disconnect();
    };
  }

  private logNativeActionUnavailable(
    conversationId: string,
    reason: Exclude<NativeConversationActionResult, { status: "delegated" }>['reason'],
  ): NativeConversationActionResult {
    this.logger.debug("Native menu unavailable.", { conversationId, reason });
    return { status: "unavailable", reason };
  }

  public watchNavigation(callback: () => void): Unsubscribe {
    let previousUrl = window.location.href;
    let scheduled = false;

    const detectChange = (): void => {
      if (scheduled) {
        return;
      }

      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (window.location.href !== previousUrl) {
          previousUrl = window.location.href;
          callback();
        }
      });
    };

    const handleClick = (): void => detectChange();
    const handleHistoryNavigation = (): void => detectChange();
    const titleElement = document.querySelector("title");
    const titleObserver = titleElement
      ? new MutationObserver(detectChange)
      : null;

    document.addEventListener("click", handleClick, true);
    window.addEventListener("popstate", handleHistoryNavigation);
    window.addEventListener("hashchange", handleHistoryNavigation);
    titleObserver?.observe(titleElement as HTMLTitleElement, { childList: true, characterData: true });

    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", handleHistoryNavigation);
      window.removeEventListener("hashchange", handleHistoryNavigation);
      titleObserver?.disconnect();
    };
  }

  public watchConversationMenus(
    callback: (context: ConversationMenuContext) => void,
  ): Unsubscribe {
    const pendingTarget = new TransientMenuTargetStore<ConversationIdentity>(
      MENU_CONTEXT_MAX_AGE_MS,
    );
    let activeMenu: HTMLElement | null = null;
    let activeContext: Omit<ConversationMenuContext, "menu"> | null = null;
    let contextUrl = window.location.href;
    let navigationCheckScheduled = false;

    const clearMenuContext = (reason: string): void => {
      pendingTarget.clear();
      activeMenu = null;
      activeContext = null;
      this.logger.debug(reason);
    };

    const detectNavigation = (): void => {
      if (navigationCheckScheduled) {
        return;
      }
      navigationCheckScheduled = true;
      queueMicrotask(() => {
        navigationCheckScheduled = false;
        if (window.location.href !== contextUrl) {
          contextUrl = window.location.href;
          clearMenuContext("Navigation changed; transient menu target cleared.");
        }
      });
    };

    const rememberMenuTarget = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(`[${WOLF_ATTRIBUTE}]`)) {
        return;
      }

      const button = target.closest<HTMLElement>(CHATGPT_SELECTORS.button);
      if (!button || !this.isConversationMenuTrigger(button)) {
        return;
      }

      const isSidebarOpener = this.findSidebar()?.contains(button) === true;
      if (isSidebarOpener) {
        this.logger.debug("Sidebar menu opener clicked.");
      }
      const reference = this.findConversationNearElement(button);
      if (reference) {
        this.logger.debug("Sidebar menu owning conversation resolved.", reference.conversationId);
        rememberPendingTarget("sidebar-conversation", reference, button);
        this.logger.debug("Sidebar menu transient target stored.", reference.conversationId);
      } else if (this.isCurrentConversationMenuTrigger(button)) {
        this.logger.debug("Current conversation menu detected.");
        const currentConversation = this.getCurrentConversationIdentity();
        if (!currentConversation) {
          this.logger.debug(
            "Menu classification failed: current conversation URL has no conversation ID.",
          );
          clearMenuContext("Unresolved current-conversation menu context cleared.");
          return;
        }

        this.logger.debug(
          "Current conversation ID resolved.",
          currentConversation.conversationId,
        );
        rememberPendingTarget("current-conversation", currentConversation, button);
      } else {
        this.logger.debug("Menu classification failed: opener was unrelated or uncertain.");
        clearMenuContext("Unrelated menu opener cleared the transient menu target.");
      }
    };

    const rememberPendingTarget = (
      kind: ConversationMenuKind,
      conversation: ConversationIdentity,
      button: HTMLElement,
    ): void => {
      pendingTarget.remember({
        kind,
        conversation,
        controlledElementId: button.getAttribute("aria-controls"),
        openedAt: Date.now(),
      });
      activeMenu = null;
      activeContext = null;
      window.setTimeout(inspectVisibleMenus, 0);
      window.requestAnimationFrame(inspectVisibleMenus);
    };

    const inspectMenu = (menu: HTMLElement): void => {
      if (!menu.isConnected) {
        return;
      }

      if (menu === activeMenu && activeContext) {
        callback({ menu, ...activeContext });
        return;
      }

      this.logger.debug("Menu portal detected.");
      const pending = pendingTarget.current(Date.now());
      this.logger.debug(`Transient menu target available=${pending !== null}`);
      if (!pending || !this.menuMatchesPendingTarget(menu, pending)) {
        return;
      }

      activeMenu = menu;
      activeContext = {
        kind: pending.kind,
        conversation: pending.conversation,
      };
      pendingTarget.clear();
      this.logger.debug(`Menu classified: ${activeContext.kind}.`);
      callback({ menu, ...activeContext });
    };

    const inspectVisibleMenus = (): void => {
      const pending = pendingTarget.current(Date.now());
      if (!pending) {
        return;
      }

      const visibleMenus = Array.from(
        document.querySelectorAll<HTMLElement>(CHATGPT_SELECTORS.menu),
      ).filter((menu) => menu.getClientRects().length > 0);
      const matchingMenus = visibleMenus.filter((menu) =>
        this.menuMatchesPendingTarget(menu, pending),
      );
      if (matchingMenus.length === 1) {
        inspectMenu(matchingMenus[0]!);
      } else if (matchingMenus.length > 1) {
        this.logger.debug(
          "Menu classification failed: multiple visible portal menus matched the opener.",
          matchingMenus.length,
        );
      }
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        let nativeMenuContentChanged = false;
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement) || isWolfElement(node)) {
            continue;
          }

          nativeMenuContentChanged = true;

          if (node.matches(CHATGPT_SELECTORS.menu)) {
            inspectMenu(node);
          }

          node.querySelectorAll<HTMLElement>(CHATGPT_SELECTORS.menu).forEach(inspectMenu);
        }

        if (nativeMenuContentChanged && mutation.target instanceof Element) {
          const containingMenu = mutation.target.closest<HTMLElement>(CHATGPT_SELECTORS.menu);
          if (containingMenu) {
            inspectMenu(containingMenu);
          }
        }

        if (
          activeMenu &&
          Array.from(mutation.removedNodes).some(
            (node) =>
              node === activeMenu ||
              (node instanceof Element && node.contains(activeMenu)),
          )
        ) {
          activeMenu = null;
          activeContext = null;
          pendingTarget.clear();
          this.logger.debug("Conversation menu closed; transient menu target cleared.");
        }
      }
    });

    document.addEventListener("click", rememberMenuTarget, true);
    document.addEventListener("click", detectNavigation, true);
    window.addEventListener("popstate", detectNavigation);
    window.addEventListener("hashchange", detectNavigation);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("click", rememberMenuTarget, true);
      document.removeEventListener("click", detectNavigation, true);
      window.removeEventListener("popstate", detectNavigation);
      window.removeEventListener("hashchange", detectNavigation);
      observer.disconnect();
      pendingTarget.clear();
      activeMenu = null;
      activeContext = null;
    };
  }

  public cleanupConversationActionHosts(): void {
    document.querySelectorAll<HTMLElement>('[data-wolf-expansion-host="conversation-action"]')
      .forEach((element) => element.removeAttribute("data-wolf-expansion-host"));
  }

  private findConversationNearElement(
    element: Element,
    favoriteDiagnostics = false,
  ): ConversationReference | null {
    const sidebar = this.findSidebar();
    if (!sidebar?.contains(element)) {
      if (favoriteDiagnostics) {
        this.logger.debug("Favorite aborted: action is not inside the current sidebar.");
      }
      return null;
    }

    let candidate: Element | null = element;
    for (let depth = 0; candidate && candidate !== sidebar && depth < 8; depth += 1) {
      const links = this.findRawConversationLinksWithin(candidate);
      if (links.length === 0) {
        candidate = candidate.parentElement;
        continue;
      }

      const identities = this.findConversationIdentitiesWithin(candidate);
      if (identities.size === 0) {
        if (favoriteDiagnostics) {
          this.logger.debug("Favorite aborted: could not parse conversation ID.", links[0]?.href);
        }
        return null;
      }

      if (identities.size > 1) {
        if (favoriteDiagnostics) {
          this.logger.debug(
            `Favorite aborted: found ${links.length} candidate conversation links resolving to ${identities.size} conversation IDs.`,
          );
        }
        return null;
      }

      const [conversationId, link] = identities.entries().next().value as [
        string,
        HTMLAnchorElement,
      ];
      if (favoriteDiagnostics) {
        this.logger.debug("Favorite target: owning ChatGPT row identified.", { depth });
        this.logger.debug("Favorite target: conversation link found.");
        this.logger.debug("Favorite target: conversation URL.", link.href);
        this.logger.debug("Favorite target: conversation ID parsed.", conversationId);
      }

      const titleDiagnostics = this.getConversationTitleDiagnostics(link);
      const normalized = normalizeConversationIdentity({
        conversationId,
        title: titleDiagnostics.normalizedTitle,
        url: link.href,
      });
      if (!normalized.ok) {
        if (favoriteDiagnostics) {
          this.logger.debug(`Favorite aborted: ${normalized.reason}.`);
        }
        return null;
      }

      if (favoriteDiagnostics) {
        this.logger.debug("Favorite target: title validation complete.", {
          titleResolved: normalized.titleResolved,
        });
      }
      return {
        ...normalized.conversation,
        link,
        titleDiagnostics,
        titleResolved: normalized.titleResolved &&
          titleDiagnostics.selectedSource === "visible-text",
      };
    }

    if (favoriteDiagnostics) {
      this.logger.debug("Favorite aborted: no owning chat row; found 0 conversation links.");
    }
    return null;
  }

  private findExactConversationRow(
    link: HTMLAnchorElement,
    conversationId: string,
  ): HTMLElement | null {
    const sidebar = this.findSidebar();
    let candidate = link.parentElement;
    for (let depth = 0; candidate && candidate !== sidebar && depth < 8; depth += 1) {
      const identities = this.findConversationIdentitiesWithin(candidate);
      if (identities.size > 1) {
        return null;
      }
      if (identities.size === 1 && identities.has(conversationId)) {
        const hasNativeActions = Array.from(
          candidate.querySelectorAll<HTMLElement>(CHATGPT_SELECTORS.button),
        ).some((control) =>
          !control.closest(`[${WOLF_ATTRIBUTE}]`) &&
          (control.hasAttribute("data-trailing-button") ||
            this.isConversationMenuTrigger(control)));
        if (hasNativeActions) {
          return candidate;
        }
      }
      candidate = candidate.parentElement;
    }
    return null;
  }

  private findExactNativeConversationRows(conversationId: string): HTMLElement[] {
    const sidebar = this.findSidebar();
    if (!sidebar) {
      return [];
    }
    const rows = new Set<HTMLElement>();
    const links = this.findConversationLinks().filter(
      (link) => this.getConversationIdFromUrl(link.href) === conversationId,
    );
    for (const link of links) {
      const row = this.findExactConversationRow(link, conversationId);
      if (row) {
        rows.add(row);
      }
    }
    return [...rows];
  }

  private isConversationMenuTrigger(button: HTMLElement): boolean {
    if (button.getAttribute("aria-haspopup") === "menu") {
      return true;
    }

    const descriptor = this.getControlDescriptor(button);
    return (
      /menu|more|options|actions/iu.test(descriptor) ||
      /^(?:…|⋯|\.\.\.)$/u.test(button.textContent?.replace(/\s+/gu, "").trim() ?? "")
    );
  }

  private isCurrentConversationMenuTrigger(button: HTMLElement): boolean {
    if (this.findSidebar()?.contains(button)) {
      return false;
    }

    const accessibleName = this.getControlDescriptor(button);
    const visibleLabel = button.textContent?.replace(/\s+/gu, "").trim() ?? "";
    const looksLikeConversationOverflow =
      /more|options|actions|conversation|chat/iu.test(accessibleName) ||
      /^(?:…|⋯|\.\.\.)$/u.test(visibleLabel);
    if (!looksLikeConversationOverflow) {
      return false;
    }

    const explicitlyConversationScoped =
      /(?:conversation|chat).*(?:menu|more|options|actions)|(?:menu|more|options|actions).*(?:conversation|chat)/iu
        .test(accessibleName);
    return (
      explicitlyConversationScoped ||
      button.closest(CHATGPT_SELECTORS.currentConversationMenuRegion) !== null
    );
  }

  private isLikelyConversationRowAction(control: HTMLElement): boolean {
    if (control.getAttribute("aria-haspopup") === "menu") {
      return true;
    }

    const accessibleName = this.getControlDescriptor(control);
    return /pin|menu|more|options|actions/iu.test(accessibleName);
  }

  private getControlDescriptor(control: HTMLElement): string {
    return [
      control.getAttribute("aria-label"),
      control.title,
      control.getAttribute("data-testid"),
      control.getAttribute("data-action"),
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ");
  }

  private classifySidebarSection(section: HTMLElement): SidebarSectionKind {
    const candidates = [
      section,
      ...section.querySelectorAll<HTMLElement>(CHATGPT_SELECTORS.sidebarSectionLabel),
    ];
    for (const candidate of candidates) {
      if (
        candidate.matches(CHATGPT_SELECTORS.conversationLink) ||
        candidate.closest(`[${WOLF_ATTRIBUTE}]`)
      ) {
        continue;
      }
      const descriptors = [
        candidate.getAttribute("aria-label"),
        candidate.getAttribute("title"),
        candidate.getAttribute("data-testid"),
        candidate.textContent,
      ]
        .filter((value): value is string => Boolean(value));
      for (const value of descriptors) {
        const descriptor = value.replace(/\s+/gu, " ").trim();
        if (/^(?:expand |collapse )?pinned(?: chats| conversations)?$/iu.test(descriptor)) {
          return "pinned";
        }
        if (/^(?:expand |collapse )?(?:recent(?: chats)?|chats|your chats)$/iu.test(descriptor)) {
          return "history";
        }
      }
    }
    return "other";
  }

  private findSidebarSectionMarker(
    sidebar: HTMLElement,
    kind: Exclude<SidebarSectionKind, "other">,
  ): HTMLElement | null {
    const candidates = [
      sidebar,
      ...sidebar.querySelectorAll<HTMLElement>(CHATGPT_SELECTORS.sidebarSectionLabel),
    ];
    return candidates.find((candidate) => {
      if (
        candidate.closest(`[${WOLF_ATTRIBUTE}]`) ||
        candidate.matches(CHATGPT_SELECTORS.conversationLink)
      ) {
        return false;
      }
      return this.getSidebarMarkerKind(candidate) === kind;
    }) ?? null;
  }

  private getSidebarMarkerKind(element: HTMLElement): SidebarSectionKind {
    const descriptors = [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.textContent,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.replace(/\s+/gu, " ").trim());
    if (descriptors.some((value) =>
      /^(?:expand |collapse )?pinned(?: chats| conversations)?$/iu.test(value))) {
      return "pinned";
    }
    if (descriptors.some((value) =>
      /^(?:expand |collapse )?(?:recent(?: chats)?|chats|your chats)$/iu.test(value))) {
      return "history";
    }
    return "other";
  }

  private findLowestSharedParent(
    first: Element,
    second: Element,
    boundary: HTMLElement,
  ): HTMLElement | null {
    const secondAncestors = new Set<Element>();
    let secondCandidate: Element | null = second;
    while (secondCandidate) {
      secondAncestors.add(secondCandidate);
      if (secondCandidate === boundary) {
        break;
      }
      secondCandidate = secondCandidate.parentElement;
    }

    let firstCandidate: Element | null = first;
    while (firstCandidate) {
      if (secondAncestors.has(firstCandidate) && firstCandidate instanceof HTMLElement) {
        return firstCandidate;
      }
      if (firstCandidate === boundary) {
        break;
      }
      firstCandidate = firstCandidate.parentElement;
    }
    return null;
  }

  private findStableSectionBoundary(
    marker: HTMLElement,
    sidebar: HTMLElement,
  ): HTMLElement | null {
    let candidate: HTMLElement | null = marker;
    while (candidate && candidate !== sidebar) {
      if (
        candidate !== marker &&
        candidate.querySelector(CHATGPT_SELECTORS.conversationLink)
      ) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }

    const semanticOwner = marker.closest<HTMLElement>(
      "section, [role=\"region\"], [role=\"group\"]",
    );
    if (semanticOwner && semanticOwner !== sidebar && sidebar.contains(semanticOwner)) {
      return semanticOwner;
    }
    return marker.parentElement && marker.parentElement !== sidebar
      ? marker.parentElement
      : marker;
  }

  private logNativePinnedState(section: HTMLElement): void {
    const pinnedExpanded = this.getNativePinnedExpanded(section);
    if (
      pinnedExpanded !== null &&
      pinnedExpanded !== this.lastNativePinnedExpanded
    ) {
      this.logger.debug("Native Pinned state changed.", { expanded: pinnedExpanded });
    }
    this.lastNativePinnedExpanded = pinnedExpanded;
  }

  private getNativePinnedExpanded(section: HTMLElement): boolean | null {
    const candidates = [
      section,
      ...section.querySelectorAll<HTMLElement>(CHATGPT_SELECTORS.sidebarSectionLabel),
    ];
    for (const candidate of candidates) {
      if (candidate.closest(`[${WOLF_ATTRIBUTE}]`)) {
        continue;
      }
      const descriptor = [
        candidate.getAttribute("aria-label"),
        candidate.getAttribute("title"),
        candidate.getAttribute("data-testid"),
        candidate.textContent,
      ]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.replace(/\s+/gu, " ").trim())
        .find((value) =>
          /^(?:expand |collapse )?pinned(?: chats| conversations)?$/iu.test(value));
      if (!descriptor) {
        continue;
      }
      const expanded = candidate.getAttribute("aria-expanded");
      if (expanded === "true") {
        return true;
      }
      if (expanded === "false") {
        return false;
      }
    }
    return null;
  }

  private findDirectChildContaining(parent: HTMLElement, descendant: Element): Element | null {
    let child: Element = descendant;
    while (child.parentElement && child.parentElement !== parent) {
      child = child.parentElement;
    }
    return child.parentElement === parent ? child : null;
  }

  private menuMatchesPendingTarget(
    menu: HTMLElement,
    pending: PendingMenuTarget<ConversationIdentity>,
  ): boolean {
    if (!pending.controlledElementId) {
      return true;
    }

    const controlledElement = document.getElementById(pending.controlledElementId);
    if (!controlledElement) {
      return true;
    }
    return (
      menu.id === pending.controlledElementId ||
      controlledElement === menu ||
      controlledElement?.contains(menu) === true ||
      menu.contains(controlledElement)
    );
  }

  private findRawConversationLinksWithin(element: Element): HTMLAnchorElement[] {
    const links: HTMLAnchorElement[] = [];
    if (
      element instanceof HTMLAnchorElement &&
      element.matches(CHATGPT_SELECTORS.conversationLink) &&
      !element.closest(`[${WOLF_ATTRIBUTE}]`)
    ) {
      links.push(element);
    }

    for (const link of element.querySelectorAll<HTMLAnchorElement>(CHATGPT_SELECTORS.conversationLink)) {
      if (!link.closest(`[${WOLF_ATTRIBUTE}]`)) {
        links.push(link);
      }
    }
    return links;
  }

  private findConversationIdentitiesWithin(
    element: Element,
  ): Map<string, HTMLAnchorElement> {
    const identities = new Map<string, HTMLAnchorElement>();
    for (const link of this.findRawConversationLinksWithin(element)) {
      const conversationId = this.getConversationIdFromUrl(link.href);
      if (conversationId && !identities.has(conversationId)) {
        identities.set(conversationId, link);
      }
    }
    return identities;
  }
}
