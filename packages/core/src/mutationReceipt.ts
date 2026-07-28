/** Host-owned validation for mutation evidence returned by an arbitrary MCP tool. */

export interface MutationReceiptEvidence {
  kind: "url" | "id" | "commit" | "evidence_ref" | "ticket_id";
  value: string;
}

export interface MutationReceiptValidation {
  verified: boolean;
  evidence: MutationReceiptEvidence[];
  text?: string;
}

const PLACEHOLDER = /(?:\{\s*[a-z0-9_-]*id\s*\}|<\s*[a-z0-9_-]*id\s*>|\bTODO\b)/i;
const FAILURE = /(?:^|\b)(?:error|failed|failure|blocked|unauthori[sz]ed|forbidden|timed?\s*out|not[_ -]approved|not[_ -]sent|not[_ -]published)(?:\b|:)/i;
const COMMIT_SHA = /^[a-f0-9]{40}$/i;
const SENSITIVE_URL_QUERY_KEY = /(?:auth|authorization|credential|key|password|secret|signature|sig|token)/i;

function cleanString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && !PLACEHOLDER.test(text) ? text : undefined;
}

function validUrl(value: string): boolean {
  if (PLACEHOLDER.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) return false;
    if ([...url.searchParams.keys()].some((key) => SENSITIVE_URL_QUERY_KEY.test(key))) return false;
    return url.pathname !== "/" || Boolean(url.search);
  } catch {
    return false;
  }
}

function parseObject(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function objectSignalsFailure(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(objectSignalsFailure);
  const obj = value as Record<string, unknown>;
  if (obj.success === false || obj.ok === false || obj.published === false || obj.sent === false) return true;
  const status = cleanString(obj.status);
  if (status && /^(?:error|failed|blocked|unauthori[sz]ed|forbidden)$/i.test(status)) return true;
  return Object.entries(obj).some(([key, nested]) =>
    /^(?:error|errors|failure)$/i.test(key) && nested != null && nested !== ""
      ? true
      : objectSignalsFailure(nested),
  );
}

function pushEvidence(
  out: MutationReceiptEvidence[],
  kind: MutationReceiptEvidence["kind"],
  value: unknown,
): void {
  const text = cleanString(value);
  if (!text) return;
  if (kind === "url" && !validUrl(text)) return;
  if (kind === "commit" && !COMMIT_SHA.test(text)) return;
  if (kind !== "url" && kind !== "commit" && !/[a-z0-9]/i.test(text)) return;
  if (!out.some((entry) => entry.kind === kind && entry.value === text)) out.push({ kind, value: text });
}

function collectStructuredEvidence(value: unknown, out: MutationReceiptEvidence[], depth = 0): void {
  if (!value || typeof value !== "object" || depth > 6) return;
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredEvidence(item, out, depth + 1);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (["url", "urls", "permalink", "permalinks", "receipturl", "receipturls", "evidenceurl", "evidenceurls", "artifacturl", "artifacturls", "githuburl", "githuburls", "pageurl", "pageurls"].includes(normalized)) {
      const values = Array.isArray(nested) ? nested : [nested];
      for (const item of values) pushEvidence(out, "url", item);
    } else if (["commit", "commitsha", "sha"].includes(normalized)) {
      pushEvidence(out, "commit", nested);
    } else if (["evidence", "evidenceref", "artifactref"].includes(normalized) && typeof nested !== "object") {
      pushEvidence(out, "evidence_ref", nested);
    } else if (["ticketid", "jobid"].includes(normalized)) {
      pushEvidence(out, "ticket_id", nested);
    } else if (["id", "receiptid", "messageid", "postid", "threadid", "deletionid"].includes(normalized)) {
      pushEvidence(out, "id", nested);
    }
    collectStructuredEvidence(nested, out, depth + 1);
  }
}

function collectTextEvidence(raw: string, out: MutationReceiptEvidence[]): void {
  for (const match of raw.matchAll(/\b(?:live|receipt|evidence|artifact)\s+url\s*:\s*(https:\/\/[^\s"'<>]+)/gi)) {
    pushEvidence(out, "url", match[1]?.replace(/[),.;]+$/, ""));
  }

  for (const match of raw.matchAll(/\bcommit(?:\s+sha)?\s*:\s*([a-f0-9]{40})\b/gi)) {
    pushEvidence(out, "commit", match[1]);
  }
  for (const match of raw.matchAll(/\bevidence(?:[_ ]ref)?\s*:\s*([^\n]+)/gi)) {
    pushEvidence(out, "evidence_ref", match[1]);
  }
  for (const match of raw.matchAll(/\b(?:confirmed|receipt|message|ticket|job)\s+(?:id|handle)\s*:\s*([^\s,;]+)/gi)) {
    pushEvidence(out, /ticket|job/i.test(match[0]) ? "ticket_id" : "id", match[1]);
  }

  // Legacy peers sometimes return immutable links as otherwise-unlabelled text.
  // A bare URL can augment concrete same-result evidence, but can never prove a
  // mutation by itself.
  if (out.some((entry) => entry.kind !== "url")) {
    for (const match of raw.matchAll(/https:\/\/[^\s"'<>]+/gi)) {
      pushEvidence(out, "url", match[0]?.replace(/[),.;]+$/, ""));
    }
  }
}

function renderEvidence({ kind, value }: MutationReceiptEvidence): string {
  if (kind === "url") return `- Evidence: <${value}>`;
  const label = kind === "commit"
    ? "Commit"
    : kind === "evidence_ref"
      ? "Reference"
      : kind === "ticket_id"
        ? "Ticket"
        : "Receipt";
  return `- ${label}: \`${value.replace(/`/g, "\\`")}\``;
}

export function renderVerifiedMutationReceipt(_tool: string, evidence: readonly MutationReceiptEvidence[]): string {
  const ordered = [...evidence].sort((left, right) =>
    left.kind === "url" && right.kind !== "url"
      ? -1
      : left.kind !== "url" && right.kind === "url"
        ? 1
        : 0,
  );
  return [
    "Done — the change was verified.",
    "",
    "Evidence:",
    ...ordered.map(renderEvidence),
  ].join("\n");
}

/**
 * Validate result evidence, not success prose. MCP annotations may decide that this
 * function should run, but only concrete handles returned in this same result pass it.
 */
export function validateMutationReceipt(tool: string, raw: string): MutationReceiptValidation {
  const text = raw?.trim() ?? "";
  if (!text || PLACEHOLDER.test(text) || FAILURE.test(text)) return { verified: false, evidence: [] };

  const parsed = parseObject(text);
  if (parsed && objectSignalsFailure(parsed)) return { verified: false, evidence: [] };

  const evidence: MutationReceiptEvidence[] = [];
  if (parsed) collectStructuredEvidence(parsed, evidence);
  collectTextEvidence(text, evidence);
  if (evidence.length === 0) return { verified: false, evidence };
  return { verified: true, evidence, text: renderVerifiedMutationReceipt(tool, evidence) };
}

const SUCCESS_CLAIM = /\b(?:posted|published|sent|delivered|deleted|removed|created|stored|saved|committed|completed|done|succeeded|successful|uploaded|written|filed|applied|is\s+live|now\s+live)\b/gi;
const EXPLICIT_SUCCESS_JSON = /"(?:published|sent|deleted|created|stored|done|success|ok)"\s*:\s*true/i;
const READ_CONTEXT = /\b(?:found|located|read|searched|listed)\b[^.!?\n]*\b(?:stored|saved|created)\b/i;
const NEGATED_CLAIM_LEAD = /(?:\b(?:no|not|never|nothing|neither|wasn't|isn't|didn't|couldn't|cannot|can't|won't|without|failed\s+to|blocked\s+from)\b(?:\s+\w+){0,3}\s*)$/i;

/** True when free model prose asserts a mutation outcome without receipt provenance. */
export function hasMutationSuccessClaim(text: string): boolean {
  if (!text.trim()) return false;
  if (PLACEHOLDER.test(text) || EXPLICIT_SUCCESS_JSON.test(text)) return true;
  return text.split(/(?<=[.!?\n])\s+/).some((sentence) => {
    if (READ_CONTEXT.test(sentence)) return false;
    for (const match of sentence.matchAll(SUCCESS_CLAIM)) {
      const lead = sentence.slice(Math.max(0, match.index! - 48), match.index!);
      if (!NEGATED_CLAIM_LEAD.test(lead)) return true;
    }
    return false;
  });
}
