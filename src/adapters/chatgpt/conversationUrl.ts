import type { ConversationRoute } from "../../shared/conversation";
export type { ConversationRoute } from "../../shared/conversation";

const CHATGPT_ORIGIN = "https://chatgpt.com";
const MAX_CONVERSATION_ID_LENGTH = 256;

export interface ParsedConversationUrl {
  conversationId: string;
  route: ConversationRoute;
  canonicalUrl: string;
  projectId?: string;
}

const PROJECT_ID_PREFIX = "g-p-";

export function parseConversationUrl(
  url: string,
  baseUrl: string = `${CHATGPT_ORIGIN}/`,
): ParsedConversationUrl | null {
  try {
    const parsedUrl = new URL(url, baseUrl);
    if (parsedUrl.origin !== CHATGPT_ORIGIN) {
      return null;
    }

    const normalOrLegacy = /^\/(c|g)\/([^/?#]+)\/?$/u.exec(parsedUrl.pathname);
    const projectConversation = /^\/g\/([^/?#]+)\/c\/([^/?#]+)\/?$/u.exec(parsedUrl.pathname);
    const route = projectConversation ? "g" : normalOrLegacy?.[1];
    const rawConversationId = projectConversation?.[2] ?? normalOrLegacy?.[2];
    const rawProjectId = projectConversation?.[1];
    if (!route || !rawConversationId) {
      return null;
    }

    const conversationId = decodeURIComponent(rawConversationId);
    if (
      conversationId.length === 0 ||
      conversationId.length > MAX_CONVERSATION_ID_LENGTH ||
      /[\s/?#]/u.test(conversationId)
    ) {
      return null;
    }

    if (rawProjectId) {
      const projectId = decodeURIComponent(rawProjectId);
      if (
        !projectId.startsWith(PROJECT_ID_PREFIX) ||
        projectId.length > MAX_CONVERSATION_ID_LENGTH ||
        /[\s/?#]/u.test(projectId)
      ) {
        return null;
      }
      return {
        route: "g",
        conversationId,
        projectId,
        canonicalUrl: `${CHATGPT_ORIGIN}/g/${encodeURIComponent(projectId)}/c/${encodeURIComponent(conversationId)}`,
      };
    }

    return {
      route: route as ConversationRoute,
      conversationId,
      canonicalUrl: `${CHATGPT_ORIGIN}/${route}/${encodeURIComponent(conversationId)}`,
    };
  } catch {
    return null;
  }
}

export function parseConversationId(
  url: string,
  baseUrl: string = `${CHATGPT_ORIGIN}/`,
): string | null {
  return parseConversationUrl(url, baseUrl)?.conversationId ?? null;
}

export function createConversationUrl(
  conversationId: string,
  route: ConversationRoute = "c",
  projectId?: string,
): string {
  if (route === "g" && projectId) {
    return `${CHATGPT_ORIGIN}/g/${encodeURIComponent(projectId)}/c/${encodeURIComponent(conversationId)}`;
  }
  return `${CHATGPT_ORIGIN}/${route}/${encodeURIComponent(conversationId)}`;
}
