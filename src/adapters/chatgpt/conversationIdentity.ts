import { parseConversationUrl, type ConversationRoute } from "./conversationUrl";

export interface ConversationIdentityInput {
  conversationId?: unknown;
  route?: unknown;
  title?: unknown;
  url?: unknown;
}

export interface NormalizedConversationIdentity {
  conversationId: string;
  route: ConversationRoute;
  title: string;
  url: string;
}

export type ConversationIdentityNormalizationResult =
  | { ok: true; conversation: NormalizedConversationIdentity; titleResolved: boolean }
  | { ok: false; reason: string };

export interface ConversationTitleCandidates {
  visibleText?: unknown;
  textContentFallback?: unknown;
  ariaLabel?: unknown;
  titleAttribute?: unknown;
}

export type ConversationTitleSource =
  | "aria-label"
  | "none"
  | "text-content-fallback"
  | "title-attribute"
  | "visible-text";

export interface SelectedConversationTitle {
  source: ConversationTitleSource;
  title: string;
}

export interface DetectedConversationIdentityInput extends ConversationIdentityInput {
  titleResolved: boolean;
}

export interface DetectedConversationMetadata {
  title: string;
  route: ConversationRoute;
  url: string;
}

const FALLBACK_CONVERSATION_TITLE = "Untitled conversation";

export function normalizeConversationTitle(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/gu, " ").trim();
}

export function selectConversationTitle(
  candidates: ConversationTitleCandidates,
): string {
  return selectConversationTitleWithSource(candidates).title;
}

export function selectConversationTitleWithSource(
  candidates: ConversationTitleCandidates,
): SelectedConversationTitle {
  const visibleText = normalizeConversationTitle(candidates.visibleText);
  if (visibleText) {
    return { source: "visible-text", title: visibleText };
  }
  const textContentFallback = normalizeConversationTitle(candidates.textContentFallback);
  if (textContentFallback) {
    return { source: "text-content-fallback", title: textContentFallback };
  }
  const ariaLabel = normalizeConversationTitle(candidates.ariaLabel);
  if (ariaLabel) {
    return { source: "aria-label", title: ariaLabel };
  }
  const titleAttribute = normalizeConversationTitle(candidates.titleAttribute);
  if (titleAttribute) {
    return { source: "title-attribute", title: titleAttribute };
  }
  return { source: "none", title: "" };
}

export function collectDetectedConversationMetadata(
  conversations: readonly DetectedConversationIdentityInput[],
  knownMetadata: ReadonlyMap<
    string,
    string | { title: string; url?: string }
  > = new Map(),
): Map<string, DetectedConversationMetadata> {
  const candidates = new Map<string, DetectedConversationMetadata[]>();

  for (const conversation of conversations) {
    if (!conversation.titleResolved) {
      continue;
    }
    const normalized = normalizeConversationIdentity(conversation);
    if (!normalized.ok || !normalized.titleResolved) {
      continue;
    }
    const { conversationId, route, title, url } = normalized.conversation;
    const existing = candidates.get(conversationId) ?? [];
    if (!existing.some((candidate) => candidate.title === title && candidate.url === url)) {
      existing.push({ title, route, url });
    }
    candidates.set(conversationId, existing);
  }

  const detected = new Map<string, DetectedConversationMetadata>();
  for (const [conversationId, choices] of candidates) {
    if (choices.length === 1) {
      detected.set(conversationId, choices[0]!);
      continue;
    }

    // ChatGPT can briefly keep an older duplicate row mounted while replacing a
    // renamed row. If exactly one visible candidate differs from our cached title,
    // that changed candidate is the only useful authoritative observation.
    const known = knownMetadata.get(conversationId);
    const knownTitle = typeof known === "string" ? known : known?.title;
    const knownUrl = typeof known === "string" ? undefined : known?.url;
    const changedChoices = knownTitle === undefined
      ? []
      : choices.filter((choice) =>
          choice.title !== knownTitle || (knownUrl !== undefined && choice.url !== knownUrl));
    if (changedChoices.length === 1) {
      detected.set(conversationId, changedChoices[0]!);
    }
  }

  return detected;
}

export function normalizeConversationIdentity(
  input: ConversationIdentityInput,
): ConversationIdentityNormalizationResult {
  if (typeof input.conversationId !== "string" || !input.conversationId.trim()) {
    return { ok: false, reason: "conversationId is missing or empty" };
  }

  const conversationId = input.conversationId.trim();
  if (typeof input.url !== "string") {
    return { ok: false, reason: "URL is missing, invalid, or belongs to another conversation" };
  }
  const parsedUrl = parseConversationUrl(input.url);
  if (!parsedUrl || parsedUrl.conversationId !== conversationId) {
    return { ok: false, reason: "URL is missing, invalid, or belongs to another conversation" };
  }
  if (input.route !== undefined && input.route !== parsedUrl.route) {
    return { ok: false, reason: "route does not match the conversation URL" };
  }
  const normalizedUrl = parsedUrl.canonicalUrl;

  const resolvedTitle = normalizeConversationTitle(input.title);
  return {
    ok: true,
    conversation: {
      conversationId,
      route: parsedUrl.route,
      title: resolvedTitle || FALLBACK_CONVERSATION_TITLE,
      url: normalizedUrl,
    },
    titleResolved: resolvedTitle.length > 0,
  };
}
