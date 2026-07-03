import { createHash } from "node:crypto";

/**
 * M-1 — stateful approval token for a standing outbound draft.
 *
 * The peer-mutation guard (taskingPolicy.ts) previously string-matched a write verb
 * ("post", "publish", "send") in the user's CURRENT message and had no memory of a
 * draft shown earlier in the conversation — so a follow-up "Tweet approved" was
 * blocked because "approved" isn't a write verb, even though a real standing draft
 * was waiting. Fixing that requires real state: when a mutating outbound call is
 * blocked for lack of an explicit verb but DOES carry real draft content, that block
 * doubles as the draft-approval prompt and registers a one-time token (tool + a hash
 * of the exact draft content, ~15min expiry) on the conversation. A later
 * natural-language affirmative ("approved", "send it") resolves the SAME tool with
 * the SAME content by consuming that token — never a bare affirmative alone, and
 * never a different tool/content than what was actually shown.
 *
 * In-process, per-conversation, single-slot (one standing draft at a time) — the
 * same scope tradeoff outboundTools.ts's E1-T4 idempotency cache already makes; a
 * durable store is a later concern.
 */

export interface ApprovalToken {
  tool: string;
  draftHash: string;
  expiresAt: number;
  /**
   * P-1 — a token registered from the outbound-COMPOSE path (ask_outbound) rather than
   * a blocked direct send. Console never sees the exact final text Callistheness drafts
   * there (Callistheness holds it), so there is no tool+content hash to match against
   * later. Such a token resolves against ANY outbound send tool's affirmative in this
   * conversation instead of a specific tool/content match.
   */
  anyOutboundSend?: boolean;
}

const TOKEN_TTL_MS = 15 * 60 * 1000;
const tokensByConversation = new Map<string, ApprovalToken>();

function canonicalDraft(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    return JSON.stringify(content, Object.keys(content as Record<string, unknown>).sort());
  }
  return String(content ?? "");
}

export function draftHash(content: unknown): string {
  return createHash("sha256").update(canonicalDraft(content)).digest("hex").slice(0, 32);
}

/** Register a one-time approval token for a just-blocked draft on this conversation. */
export function registerApprovalToken(conversationId: string, tool: string, content: unknown): void {
  tokensByConversation.set(conversationId, { tool, draftHash: draftHash(content), expiresAt: Date.now() + TOKEN_TTL_MS });
}

/**
 * P-1 — register a standing approval for a draft composed through the ask_outbound
 * path, where Console has no exact final-content hash to key on (see anyOutboundSend
 * above). One-time, per-conversation, same TTL as a direct-ask token.
 */
export function registerOutboundComposeApprovalToken(conversationId: string): void {
  tokensByConversation.set(conversationId, { tool: "", draftHash: "", expiresAt: Date.now() + TOKEN_TTL_MS, anyOutboundSend: true });
}

function liveToken(conversationId: string): ApprovalToken | undefined {
  const token = tokensByConversation.get(conversationId);
  if (!token) return undefined;
  if (Date.now() > token.expiresAt) {
    tokensByConversation.delete(conversationId);
    return undefined;
  }
  return token;
}

/** True when a non-expired token exists for this exact tool + draft content. */
export function hasValidApprovalToken(conversationId: string, tool: string, content: unknown): boolean {
  const token = liveToken(conversationId);
  if (!token) return false;
  if (token.anyOutboundSend) return true;
  return token.tool === tool && token.draftHash === draftHash(content);
}

/** One-time use: delete the token once it resolves a mutation. */
export function consumeApprovalToken(conversationId: string): void {
  tokensByConversation.delete(conversationId);
}

/** True when ANY non-expired token (either shape) stands for this conversation. */
export function hasAnyLiveApprovalToken(conversationId: string): boolean {
  return Boolean(liveToken(conversationId));
}

/** Test-only: reset all tokens between cases. */
export function __resetApprovalTokens(): void {
  tokensByConversation.clear();
}
