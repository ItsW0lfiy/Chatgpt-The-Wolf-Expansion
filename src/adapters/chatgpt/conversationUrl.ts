import type { ConversationRoute } from "../../shared/conversation";
export type { ConversationRoute } from "../../shared/conversation";

const CHATGPT_ORIGIN = "https://chatgpt.com";
const MAX_CONVERSATION_ID_LENGTH = 256;

export interface ParsedConversationUrl {
  conversationId: string;
  route: ConversationRoute;
}

export function parseConversationUrl(
  url: string,
  baseUrl: string = `${CHATGPT_ORIGIN}/`,
): ParsedConversationUrl | null {
  try {
    const parsedUrl = new URL(url, baseUrl);
    if (parsedUrl.origin !== CHATGPT_ORIGIN) {
      return null;
    }

    const match = /^\/(c|g)\/([^/?#]+)\/?$/u.exec(parsedUrl.pathname);
    if (!match?.[1] || !match[2]) {
      return null;
    }

    const conversationId = decodeURIComponent(match[2]);
    if (
      conversationId.length === 0 ||
      conversationId.length > MAX_CONVERSATION_ID_LENGTH ||
      /[\s/?#]/u.test(conversationId)
    ) {
      return null;
    }

    return { route: match[1] as ConversationRoute, conversationId };
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
): string {
  return `${CHATGPT_ORIGIN}/${route}/${encodeURIComponent(conversationId)}`;
}
