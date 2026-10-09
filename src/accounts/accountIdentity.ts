export type ChatGPTAccountEvidence =
  | { state: "logged-out" }
  | {
      reason: "missing-profile" | "invalid-profile-user-id";
      state: "unresolved";
    }
  | {
      identity: string;
      source: "profile-user-id" | "rendered-theme-user-id";
      state: "identified";
    };

export interface ChatGPTAccountSignals {
  baseUrl: string;
  loggedOutControlVisible: boolean;
  profileImageSource: string;
  profilePresent: boolean;
  renderedThemeUserId?: string;
}

const ESTUARY_PROFILE_CARRIER_PATH = "/backend-api/estuary/public_content/enc/";
const CHATGPT_USER_ID_PATTERN = /^user-[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/u;

export async function createOpaqueAccountScopeId(identity: string): Promise<string> {
  const data = new TextEncoder().encode(`wolf-expansion-account-scope\0${identity}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return `sha256-${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")).join("")}`;
}

export function getChatGPTUserIdFromProfileImage(
  value: string,
  baseUrl: string,
): string | null {
  try {
    const url = new URL(value, baseUrl);
    if (
      url.origin !== "https://chatgpt.com" ||
      url.username !== "" ||
      url.password !== "" ||
      !url.pathname.startsWith(ESTUARY_PROFILE_CARRIER_PATH)
    ) {
      return null;
    }

    const encodedSegment = url.pathname.slice(ESTUARY_PROFILE_CARRIER_PATH.length);
    if (!encodedSegment || encodedSegment.includes("/")) {
      return null;
    }
    const decodedPayload = decodeBase64Url(decodeURIComponent(encodedSegment));
    if (decodedPayload === null) {
      return null;
    }
    const payload: unknown = JSON.parse(decodedPayload);
    if (!isRecord(payload) || typeof payload.id !== "string") {
      return null;
    }
    const separatorIndex = payload.id.indexOf(":");
    const userId = separatorIndex >= 0 ? payload.id.slice(0, separatorIndex) : payload.id;
    return CHATGPT_USER_ID_PATTERN.test(userId) ? userId : null;
  } catch {
    return null;
  }
}

export function getChatGPTUserIdFromRenderedThemeAttribute(value: string): string | null {
  return CHATGPT_USER_ID_PATTERN.test(value) ? value : null;
}

export function resolveChatGPTAccountEvidence(
  signals: ChatGPTAccountSignals,
): ChatGPTAccountEvidence {
  if (signals.loggedOutControlVisible) {
    return { state: "logged-out" };
  }
  if (!signals.profilePresent) {
    return { state: "unresolved", reason: "missing-profile" };
  }

  const profileUserId = getChatGPTUserIdFromProfileImage(
    signals.profileImageSource,
    signals.baseUrl,
  );
  const renderedThemeUserId = getChatGPTUserIdFromRenderedThemeAttribute(
    signals.renderedThemeUserId ?? "",
  );
  const userId = profileUserId ?? renderedThemeUserId;
  return userId
    ? {
        identity: `chatgpt-user-id:${userId}`,
        source: profileUserId ? "profile-user-id" : "rendered-theme-user-id",
        state: "identified",
      }
    : { state: "unresolved", reason: "invalid-profile-user-id" };
}

export function getChatGPTAccountEvidenceSignature(
  evidence: ChatGPTAccountEvidence,
): string {
  switch (evidence.state) {
    case "identified":
      return `identified:${evidence.identity}`;
    case "unresolved":
      return `unresolved:${evidence.reason}`;
    case "logged-out":
      return "logged-out";
  }
}

function decodeBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/u.test(value)) {
    return null;
  }
  const unpadded = value.replace(/=+$/u, "");
  const remainder = unpadded.length % 4;
  if (remainder === 1) {
    return null;
  }
  const base64 = unpadded.replace(/-/gu, "+").replace(/_/gu, "/") +
    "=".repeat((4 - remainder) % 4);
  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
