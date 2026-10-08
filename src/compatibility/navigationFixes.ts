import type { SettingsService } from "../settings/settings";
import type { Unsubscribe } from "../shared/types";

const CONTENT_ANCHOR_SELECTOR = [
  '[data-thread-find-target="conversation"]',
  "[data-chatgpt-conversation-selection-target]",
  "main [data-message-author-role]",
].join(", ");
const TYPING_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[role="textbox"]',
].join(", ");
const INTERACTIVE_SELECTOR = [
  TYPING_SELECTOR,
  "button",
  "a[href]",
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  "summary",
].join(", ");
const MIDDLE_HOLD_THRESHOLD_MS = 180;
const AUTOSCROLL_DEAD_ZONE_PX = 10;
const MAX_AUTOSCROLL_SPEED_PX_PER_SECOND = 1_800;

export function isNavigationTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TYPING_SELECTOR) !== null;
}

export function isNavigationInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null;
}

export function getPageScrollDistance(clientHeight: number): number {
  return Math.max(1, Math.round(clientHeight * 0.9));
}

export function getAutoscrollVelocity(pointerOffsetY: number): number {
  const magnitude = Math.abs(pointerOffsetY);
  if (magnitude <= AUTOSCROLL_DEAD_ZONE_PX) {
    return 0;
  }
  const speed = Math.min(
    MAX_AUTOSCROLL_SPEED_PX_PER_SECOND,
    Math.pow(magnitude - AUTOSCROLL_DEAD_ZONE_PX, 1.35) * 5,
  );
  return Math.sign(pointerOffsetY) * speed;
}

export function getAutoscrollFrameDelta(
  pointerOffsetY: number,
  elapsedMilliseconds: number,
): number {
  const boundedElapsed = Math.min(Math.max(elapsedMilliseconds, 0), 50);
  return getAutoscrollVelocity(pointerOffsetY) * boundedElapsed / 1_000;
}

export class NavigationCompatibilityController {
  private enabled = false;
  private unsubscribeSettings: Unsubscribe | null = null;
  private autoscroll: {
    frameId: number;
    held: boolean;
    originY: number;
    pointerY: number;
    startedAt: number;
    lastFrameAt: number;
    marker: HTMLElement;
    scroller: HTMLElement;
  } | null = null;
  private readonly preparedScrollers = new Map<HTMLElement, string | null>();

  public constructor(private readonly settingsService: SettingsService) {}

  public start(): void {
    document.addEventListener("click", this.handleClick, true);
    document.addEventListener("focusin", this.handleFocusIn, true);
    document.addEventListener("keydown", this.handleKeyDown, true);
    document.addEventListener("mousedown", this.handleMouseDown, true);
    document.addEventListener("mousemove", this.handleMouseMove, true);
    document.addEventListener("mouseup", this.handleMouseUp, true);
    document.addEventListener("auxclick", this.handleAuxClick, true);
    window.addEventListener("blur", this.stopAutoscroll);
    window.addEventListener("pagehide", this.stopAutoscroll);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.unsubscribeSettings = this.settingsService.subscribe(() => {
      this.loadSettings();
    });
    this.loadSettings();
  }

  public stop(): void {
    this.enabled = false;
    this.stopAutoscroll();
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    document.removeEventListener("click", this.handleClick, true);
    document.removeEventListener("focusin", this.handleFocusIn, true);
    document.removeEventListener("keydown", this.handleKeyDown, true);
    document.removeEventListener("mousedown", this.handleMouseDown, true);
    document.removeEventListener("mousemove", this.handleMouseMove, true);
    document.removeEventListener("mouseup", this.handleMouseUp, true);
    document.removeEventListener("auxclick", this.handleAuxClick, true);
    window.removeEventListener("blur", this.stopAutoscroll);
    window.removeEventListener("pagehide", this.stopAutoscroll);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    for (const [scroller, originalTabIndex] of this.preparedScrollers) {
      if (originalTabIndex === null) {
        scroller.removeAttribute("tabindex");
      } else {
        scroller.setAttribute("tabindex", originalTabIndex);
      }
    }
    this.preparedScrollers.clear();
  }

  private readonly refreshSettings = async (): Promise<void> => {
    const settings = await this.settingsService.get();
    this.enabled = settings.enabled && settings.compatibility.navigationFixes;
    if (!this.enabled) {
      this.stopAutoscroll();
    }
  };

  private loadSettings(): void {
    void this.refreshSettings().catch((error: unknown) => {
      this.enabled = false;
      this.stopAutoscroll();
      console.error("[Wolf Expansion] Could not load navigation compatibility settings.", error);
    });
  }

  private readonly handleClick = (event: MouseEvent): void => {
    if (!this.enabled) {
      return;
    }
    if (this.autoscroll) {
      this.stopAutoscroll();
      return;
    }
    if (isNavigationInteractiveTarget(event.target) || !(event.target instanceof Element)) {
      return;
    }
    const scroller = this.findConversationScroller(event.target);
    if (!scroller || !scroller.contains(event.target)) {
      return;
    }
    window.setTimeout(() => {
      if (this.enabled && !isNavigationTypingTarget(document.activeElement)) {
        this.focusScroller(scroller);
      }
    }, 0);
  };

  private readonly handleFocusIn = (event: FocusEvent): void => {
    if (!this.enabled || !(event.target instanceof HTMLElement) ||
      event.target.tagName.toLowerCase() !== "main") {
      return;
    }
    const main = event.target;
    window.setTimeout(() => {
      if (!this.enabled || document.activeElement !== main) {
        return;
      }
      const scroller = this.findConversationScroller(main);
      if (scroller) {
        this.focusScroller(scroller);
      }
    }, 0);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) {
      return;
    }
    if (event.key === "Escape" && this.autoscroll) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.stopAutoscroll();
      return;
    }
    if (event.key !== "PageUp" && event.key !== "PageDown") {
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
      isNavigationTypingTarget(event.target)) {
      return;
    }
    const scroller = this.findConversationScroller(
      event.target instanceof Element ? event.target : undefined,
    );
    if (!scroller) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.stopAutoscroll();
    scroller.scrollTop += (event.key === "PageDown" ? 1 : -1) *
      getPageScrollDistance(scroller.clientHeight);
    this.focusScroller(scroller);
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (!this.enabled) {
      return;
    }
    if (this.autoscroll && event.button !== 1) {
      this.stopAutoscroll();
      return;
    }
    if (event.button !== 1 || !(event.target instanceof Element) ||
      event.target.closest("a[href]")) {
      return;
    }
    const scroller = this.findConversationScroller(event.target);
    if (!scroller || !scroller.contains(event.target)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.stopAutoscroll();
    this.startAutoscroll(scroller, event.clientX, event.clientY);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (this.autoscroll) {
      this.autoscroll.pointerY = event.clientY;
    }
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    const state = this.autoscroll;
    if (!state || event.button !== 1) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    state.held = false;
    if (performance.now() - state.startedAt >= MIDDLE_HOLD_THRESHOLD_MS) {
      this.stopAutoscroll();
    }
  };

  private readonly handleAuxClick = (event: MouseEvent): void => {
    if (!this.enabled || event.button !== 1 || !(event.target instanceof Element) ||
      event.target.closest("a[href]")) {
      return;
    }
    const scroller = this.findConversationScroller(event.target);
    if (scroller?.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.stopAutoscroll();
    }
  };

  private startAutoscroll(scroller: HTMLElement, clientX: number, clientY: number): void {
    const marker = this.createAutoscrollMarker(clientX, clientY);
    const now = performance.now();
    this.autoscroll = {
      frameId: 0,
      held: true,
      originY: clientY,
      pointerY: clientY,
      startedAt: now,
      lastFrameAt: now,
      marker,
      scroller,
    };
    document.documentElement.append(marker);
    this.focusScroller(scroller);
    this.autoscroll.frameId = window.requestAnimationFrame(this.tickAutoscroll);
  }

  private readonly tickAutoscroll = (now: number): void => {
    const state = this.autoscroll;
    if (!state || !state.scroller.isConnected || !this.enabled) {
      this.stopAutoscroll();
      return;
    }
    const delta = getAutoscrollFrameDelta(state.pointerY - state.originY, now - state.lastFrameAt);
    state.lastFrameAt = now;
    if (delta !== 0) {
      state.scroller.scrollTop += delta;
    }
    state.frameId = window.requestAnimationFrame(this.tickAutoscroll);
  };

  private readonly stopAutoscroll = (): void => {
    const state = this.autoscroll;
    if (!state) {
      return;
    }
    this.autoscroll = null;
    window.cancelAnimationFrame(state.frameId);
    state.marker.remove();
  };

  private findConversationScroller(origin?: Element): HTMLElement | null {
    const explicit = document.querySelector<HTMLElement>(".thread-scroll-container");
    if (explicit && this.isScrollable(explicit)) {
      return explicit;
    }
    const anchors = origin?.closest(CONTENT_ANCHOR_SELECTOR)
      ? [origin]
      : Array.from(document.querySelectorAll<HTMLElement>(CONTENT_ANCHOR_SELECTOR));
    for (const anchor of anchors) {
      let candidate: HTMLElement | null = anchor instanceof HTMLElement
        ? anchor
        : anchor.parentElement;
      while (candidate) {
        if (this.isScrollable(candidate)) {
          return candidate;
        }
        candidate = candidate.parentElement;
      }
    }
    const documentScroller = document.scrollingElement;
    return documentScroller instanceof HTMLElement ? documentScroller : null;
  }

  private isScrollable(element: HTMLElement): boolean {
    if (element.scrollHeight <= element.clientHeight + 1) {
      return false;
    }
    const overflowY = window.getComputedStyle(element).overflowY;
    return /^(?:auto|scroll|overlay)$/u.test(overflowY);
  }

  private focusScroller(scroller: HTMLElement): void {
    if (!this.preparedScrollers.has(scroller)) {
      this.preparedScrollers.set(scroller, scroller.getAttribute("tabindex"));
      if (!scroller.hasAttribute("tabindex")) {
        scroller.setAttribute("tabindex", "-1");
      }
    }
    scroller.focus({ preventScroll: true });
  }

  private createAutoscrollMarker(clientX: number, clientY: number): HTMLElement {
    const marker = document.createElement("div");
    marker.dataset.wolfExpansion = "navigation-autoscroll-marker";
    marker.setAttribute("aria-hidden", "true");
    Object.assign(marker.style, {
      alignItems: "center",
      background: "color-mix(in srgb, Canvas 88%, transparent)",
      border: "1px solid color-mix(in srgb, CanvasText 35%, transparent)",
      borderRadius: "50%",
      color: "CanvasText",
      display: "flex",
      height: "26px",
      justifyContent: "center",
      left: `${clientX - 13}px`,
      pointerEvents: "none",
      position: "fixed",
      top: `${clientY - 13}px`,
      width: "26px",
      zIndex: "2147483647",
    });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", "M8 1 4.5 5h7L8 1Zm0 14 3.5-4h-7L8 15Z");
    svg.append(path);
    marker.append(svg);
    return marker;
  }
}
