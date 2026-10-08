export type NativeConversationActionUnavailableReason =
  | "row-not-mounted"
  | "action-not-found"
  | "ambiguous"
  | "unsupported";

export type NativeConversationMenuActionKind =
  | "archive"
  | "delete"
  | "move-to-project"
  | "pin"
  | "rename"
  | "share"
  | "unpin";

export interface NativeConversationMenuActionDescriptor {
  disabled: boolean;
  kind: NativeConversationMenuActionKind;
  label: string;
}

export interface NativeConversationMenuActionCandidate<TElement> {
  disabled: boolean;
  element: TElement;
  kind: NativeConversationMenuActionKind | null;
  wolfOwned: boolean;
}

export type NativeConversationActionResult =
  | { status: "delegated" }
  | {
      status: "unavailable";
      reason: NativeConversationActionUnavailableReason;
    };

export interface NativeConversationActionCandidate<TTrigger> {
  conversationIds: readonly string[];
  triggers: readonly TTrigger[];
  wolfOwned: boolean;
}

export type NativeConversationActionResolution<TTrigger> =
  | { status: "available"; trigger: TTrigger }
  | {
      status: "unavailable";
      reason: Exclude<NativeConversationActionUnavailableReason, "unsupported">;
    };

export function resolveExactNativeConversationAction<TTrigger>(
  conversationId: string,
  matchingNativeLinkCount: number,
  candidates: readonly NativeConversationActionCandidate<TTrigger>[],
): NativeConversationActionResolution<TTrigger> {
  if (matchingNativeLinkCount === 0) {
    return { status: "unavailable", reason: "row-not-mounted" };
  }

  const relevantCandidates = candidates.filter((candidate) => {
    const identities = new Set(candidate.conversationIds);
    return !candidate.wolfOwned && identities.has(conversationId);
  });
  if (relevantCandidates.length === 0) {
    return { status: "unavailable", reason: "action-not-found" };
  }
  if (
    relevantCandidates.length !== 1 ||
    relevantCandidates.some((candidate) => new Set(candidate.conversationIds).size !== 1) ||
    relevantCandidates[0]!.triggers.length !== 1
  ) {
    return { status: "unavailable", reason: "ambiguous" };
  }
  return { status: "available", trigger: relevantCandidates[0]!.triggers[0]! };
}

export function classifyNativeConversationMenuAction(
  label: string,
): NativeConversationMenuActionKind | null {
  const normalized = label.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return null;
  }
  if (/\brename\b/iu.test(normalized)) {
    return "rename";
  }
  if (/\bunpin\b/iu.test(normalized)) {
    return "unpin";
  }
  if (/\bpin\b/iu.test(normalized)) {
    return "pin";
  }
  if (/\barchive\b/iu.test(normalized)) {
    return "archive";
  }
  if (/\bdelete\b/iu.test(normalized)) {
    return "delete";
  }
  if (/^move to project(?:\b|$)/iu.test(normalized)) {
    return "move-to-project";
  }
  if (/^share(?:\b|$)/iu.test(normalized)) {
    return "share";
  }
  return null;
}

export function resolveUniqueNativeConversationMenuAction<TElement>(
  requestedKind: NativeConversationMenuActionKind,
  candidates: readonly NativeConversationMenuActionCandidate<TElement>[],
): TElement | null {
  const matches = candidates.filter(
    (candidate) =>
      !candidate.wolfOwned &&
      !candidate.disabled &&
      candidate.kind === requestedKind,
  );
  return matches.length === 1 ? matches[0]!.element : null;
}
