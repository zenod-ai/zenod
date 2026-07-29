import { createHash } from "node:crypto";

/** A host-owned, one-time authorization candidate created by a guarded peer result. */
export interface ApprovalToken {
  tool: string;
  draftHash: string;
  expiresAt: number;
  owner?: string;
  description?: string;
  args?: Record<string, unknown>;
  anyOutboundSend?: boolean;
}

export type ApprovalIntent = "approve" | "cancel" | "edit" | "none";

const TOKEN_TTL_MS = 15 * 60 * 1000;
const tokensByConversation = new Map<string, ApprovalToken[]>();
const NEGATION_RE = /\b(?:no|not|don'?t|won'?t|never|cancel|stop|abort|nvm|nevermind|hold on|wait)\b/i;
const EDIT_RE = /\b(?:change|edit|revise|rewrite|replace|instead|make it|update the (?:draft|text|message|post))\b/i;
const APPROVAL_RE = /(?:^|\b)(?:a?pprove(?:d)?|confirm(?:ed)?|go\s*ahead|do\s+it|(?:send|post|publish|ship)\s+(?:it|now)|yes|yep|yeah|ok(?:ay)?|sounds?\s+good|looks?\s+good)(?:\b|\s*:)/i;
const APPROVAL_REQUIRED_RE = /(?:\[(?:draft_not_approved|approval_required|confirmation_required)\]|\b(?:approval|confirmation)\s+(?:is\s+)?required\b|\bnot[_ -]approved\b)/i;
const INTERNAL_APPROVAL_KEY_RE = /(?:approval|approve|confirmation|confirm|token|secret|password)/i;

function canonicalDraft(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return `[${content.map(canonicalDraft).join(",")}]`;
  if (content && typeof content === "object") {
    const entries = Object.entries(content as Record<string, unknown>)
      .filter(([key]) => !INTERNAL_APPROVAL_KEY_RE.test(key))
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, value]) => `${JSON.stringify(key)}:${canonicalDraft(value)}`).join(",")}}`;
  }
  return JSON.stringify(content ?? null);
}

export function draftHash(content: unknown): string {
  return createHash("sha256").update(canonicalDraft(content)).digest("hex").slice(0, 32);
}

function liveTokens(conversationId: string): ApprovalToken[] {
  const now = Date.now();
  const live = (tokensByConversation.get(conversationId) ?? []).filter((token) => token.expiresAt > now);
  if (live.length) tokensByConversation.set(conversationId, live);
  else tokensByConversation.delete(conversationId);
  return live;
}

/** Deterministic intent classification. It recognizes language; it never grants authority. */
export function classifyApprovalIntent(userRequest: string): ApprovalIntent {
  const text = userRequest.trim();
  if (!text) return "none";
  if (NEGATION_RE.test(text)) return "cancel";
  if (EDIT_RE.test(text)) return "edit";
  return APPROVAL_RE.test(text) ? "approve" : "none";
}

/** Exact text restated by APPROVE:/PPROVE:, if present. */
export function approvedExactText(userRequest: string): string | undefined {
  const match = userRequest.trim().match(/^a?pprove(?:d)?\s*:\s*["“]([\s\S]*?)["”]\s*[.!]?\s*$/i);
  return match?.[1];
}

export function isApprovalRequiredResult(result: string): boolean {
  return APPROVAL_REQUIRED_RE.test(result);
}

function hasSubstantiveArgs(args: Record<string, unknown>): boolean {
  return Object.entries(args).some(
    ([key, value]) => !INTERNAL_APPROVAL_KEY_RE.test(key) && value !== undefined && value !== null && canonicalDraft(value).length > 2,
  );
}

/** Register the exact arguments refused by a mutating peer as a standing action. */
export function registerStandingApproval(
  conversationId: string,
  owner: string,
  tool: string,
  args: Record<string, unknown>,
  result: string,
  description = "",
): boolean {
  if (!isApprovalRequiredResult(result) || !hasSubstantiveArgs(args)) return false;
  const cleanArgs = Object.fromEntries(Object.entries(args).filter(([key]) => !INTERNAL_APPROVAL_KEY_RE.test(key)));
  const token: ApprovalToken = {
    owner,
    description,
    tool,
    args: cleanArgs,
    draftHash: draftHash(cleanArgs),
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };
  const others = liveTokens(conversationId).filter((candidate) => candidate.owner !== owner || candidate.tool !== tool);
  tokensByConversation.set(conversationId, [...others, token]);
  return true;
}

/** Register a one-time legacy approval token for a just-blocked draft. */
export function registerApprovalToken(conversationId: string, tool: string, content: unknown): void {
  tokensByConversation.set(conversationId, [{ tool, draftHash: draftHash(content), expiresAt: Date.now() + TOKEN_TTL_MS }]);
}

export function registerOutboundComposeApprovalToken(conversationId: string): void {
  tokensByConversation.set(conversationId, [{ tool: "", draftHash: "", expiresAt: Date.now() + TOKEN_TTL_MS, anyOutboundSend: true }]);
}

export function hasValidApprovalToken(conversationId: string, tool: string, content: unknown): boolean {
  const tokens = liveTokens(conversationId);
  return tokens.some((token) => token.anyOutboundSend || (!token.owner && token.tool === tool && token.draftHash === draftHash(content)));
}

function canonicalExactArgs(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalExactArgs).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalExactArgs(item)}`)
      .join(",")}}`;
  }
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function exactArgsMatch(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
  return canonicalExactArgs(expected) === canonicalExactArgs(actual);
}

export type StandingApprovalResolution = "allowed" | "nothing_pending" | "ambiguous" | "mismatch";

/**
 * Validate a model-selected commit candidate against host-owned standing state.
 * The candidate must stay on the same connection, exact tool, and canonical
 * full argument object. Extra arguments are a different operation.
 */
export function resolveStandingApproval(input: {
  conversationId: string;
  owner: string;
  tool: string;
  args: Record<string, unknown>;
  userRequest: string;
  description?: string;
}): StandingApprovalResolution {
  const tokens = liveTokens(input.conversationId).filter((token) => token.owner && token.args);
  if (tokens.length === 0) return "nothing_pending";
  const exactText = approvedExactText(input.userRequest);
  const candidates = exactText === undefined
    ? tokens
    : tokens.filter((token) => Object.values(token.args!).some((value) => typeof value === "string" && value === exactText));
  if (candidates.length === 0) return "mismatch";
  const exactCandidates = candidates.filter((candidate) =>
    candidate.owner === input.owner &&
    candidate.tool === input.tool &&
    exactArgsMatch(candidate.args!, input.args),
  );
  if (exactCandidates.length === 0) return "mismatch";
  if (exactCandidates.length !== 1) return "ambiguous";
  const candidate = exactCandidates[0]!;
  tokensByConversation.set(input.conversationId, liveTokens(input.conversationId).filter((token) => token !== candidate));
  return "allowed";
}

export function cancelStandingApprovals(conversationId: string): boolean {
  const existed = liveTokens(conversationId).length > 0;
  tokensByConversation.delete(conversationId);
  return existed;
}

export function consumeApprovalToken(conversationId: string): void {
  tokensByConversation.delete(conversationId);
}

export function hasAnyLiveApprovalToken(conversationId: string): boolean {
  return liveTokens(conversationId).length > 0;
}

/** Serializable snapshot used by the tenant SQLite boundary. */
export function approvalTokenSnapshot(conversationId: string): ApprovalToken[] {
  return liveTokens(conversationId).map((token) => ({ ...token, ...(token.args ? { args: structuredClone(token.args) } : {}) }));
}

/** Replace in-memory state from the current tenant's durable conversation row. */
export function hydrateApprovalTokens(conversationId: string, tokens: ApprovalToken[]): void {
  const live = tokens.filter((token) => token.expiresAt > Date.now());
  if (live.length) tokensByConversation.set(conversationId, live);
  else tokensByConversation.delete(conversationId);
}

export function __resetApprovalTokens(): void {
  tokensByConversation.clear();
}
