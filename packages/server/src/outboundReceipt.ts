/**
 * E1-T1/T3 — Outbound send receipts.
 *
 * Honesty must be STRUCTURAL, not a model disposition (AlfaBlok/obsidian-brain#228).
 * A connector returns a raw text blob; the brain must NOT be free to dress that up as
 * "Posted: <made-up URL>". So every send is reduced to ONE of two verified shapes:
 *
 *   { verified: true,  url, id, channel }              → a real receipt with a LIVE url
 *   { verified: false, reason, channel }               → FAILED + the verbatim reason
 *
 * The relay text is then a PURE FUNCTION of that object (renderOutboundReceipt) — a
 * success line is only ever emitted with a real url derived from the connector's own
 * response, never composed freehand. This directly kills the iteration-2 failure where
 * a reply rendered its own placeholder "Posted: https://x.com/… (tweet ID would be
 * here)" as a live URL.
 *
 * E1-T3: the reason is scrubbed of engine/vendor noise ("Upgrade to Plus", quota text,
 * the word "Composio") so none of it reaches user-facing text.
 */

export type OutboundChannel = "x" | "reddit" | "email";

export interface OutboundReceipt {
  channel: OutboundChannel;
  verified: boolean;
  /** Live URL of the posted/sent artifact (present only when verified). */
  url?: string;
  /** The artifact id (tweet id, reddit id, message id) when the connector returned one. */
  id?: string;
  /** Verbatim, scrubbed failure reason (present only when NOT verified). */
  reason?: string;
}

/** Vendor/engine noise that must never reach user-facing text (E1-T3). */
const NOISE_PATTERNS: RegExp[] = [
  /upgrade to (?:plus|premium|pro)\b[^.\n]*\.?/gi,
  /\byou(?:'ve| have) reached your (?:monthly )?(?:usage )?(?:cap|limit|quota)\b[^.\n]*\.?/gi,
  /\bcomposio\b/gi,
  /\bopenrouter\b/gi,
  /\bplease upgrade\b[^.\n]*\.?/gi,
];

export function scrubVendorNoise(text: string): string {
  let out = text;
  for (const pat of NOISE_PATTERNS) out = out.replace(pat, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Build the canonical live URL for a posted X status from its numeric id. */
export function tweetUrl(id: string): string {
  return `https://x.com/i/web/status/${id}`;
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function deepFindUrl(value: unknown, matcher: RegExp): string | undefined {
  if (typeof value === "string") return matcher.test(value) ? value.trim() : undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = deepFindUrl(item, matcher);
      if (hit) return hit;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) {
      const hit = deepFindUrl(v, matcher);
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * A connector "error" string (the never-throw shape from callConnector/callComposio)
 * begins with one of these stems. Treat any such text as a FAILED receipt, never a
 * success — even if the model would otherwise narrate it as done.
 */
const FAILURE_STEMS = [
  "could not reach",
  "reported an error",
  "did not complete",
  "is not connected",
  "not connected yet",
  "nothing to post",
  "could not attach",
];

function looksLikeFailure(text: string): boolean {
  const t = text.toLowerCase();
  return FAILURE_STEMS.some((stem) => t.includes(stem));
}

function parse(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reduce a connector's raw response into a verified receipt for a channel. A receipt
 * is `verified` ONLY when a real artifact url (or an id we can turn into one) is
 * recovered from the connector's own response. Anything else is FAILED.
 */
export function parseOutboundReceipt(channel: OutboundChannel, raw: string): OutboundReceipt {
  const text = raw?.trim() ?? "";
  if (!text || looksLikeFailure(text)) {
    return { channel, verified: false, reason: scrubVendorNoise(text) || "the connector returned no detail" };
  }

  const parsed = parse(text);
  const data = (parsed?.data && typeof parsed.data === "object" ? (parsed.data as Record<string, unknown>) : parsed) ?? {};

  if (channel === "x") {
    const id = firstString(data.id, (data as Record<string, unknown>).media_id, parsed?.id);
    if (id) return { channel, verified: true, id, url: tweetUrl(id) };
    // No id → we cannot prove a post happened; fail rather than guess a URL.
    return { channel, verified: false, reason: scrubVendorNoise(text) || "the X connector did not return a post id" };
  }

  if (channel === "reddit") {
    const url =
      firstString(data.url, data.permalink, (data as Record<string, unknown>).post_url) ??
      deepFindUrl(parsed ?? text, /reddit\.com\/[^\s"']+/i);
    const id = firstString(data.id, data.name, (data as Record<string, unknown>).post_id);
    if (url) return { channel, verified: true, url, ...(id ? { id } : {}) };
    if (id) return { channel, verified: true, id }; // a real id is proof enough even without a permalink
    return { channel, verified: false, reason: scrubVendorNoise(text) || "the Reddit connector did not return a post url or id" };
  }

  // email: there is no public URL; a message/thread id (or an explicit ok) is the receipt.
  const id = firstString(data.id, (data as Record<string, unknown>).message_id, (data as Record<string, unknown>).threadId);
  if (id) return { channel, verified: true, id };
  // Some mail connectors just return a plain "sent" acknowledgement with no id.
  if (/\b(sent|delivered|queued|accepted|ok)\b/i.test(text) && !parsed) {
    return { channel, verified: true };
  }
  return { channel, verified: false, reason: scrubVendorNoise(text) || "the email connector did not confirm the send" };
}

const CHANNEL_LABEL: Record<OutboundChannel, string> = {
  x: "X (Twitter)",
  reddit: "Reddit",
  email: "email",
};

const CHANNEL_VERB: Record<OutboundChannel, string> = {
  x: "Posted to X",
  reddit: "Posted to Reddit",
  email: "Sent the email",
};

/**
 * Render a receipt into the ONLY user-facing text the brain should relay. Success text
 * is a pure function of the verified receipt (real url/id), failure text is an explicit
 * FAILED + reason. The brain is instructed to relay this verbatim — never to compose a
 * "Posted:" line on its own.
 */
export function renderOutboundReceipt(receipt: OutboundReceipt): string {
  const label = CHANNEL_LABEL[receipt.channel];
  if (!receipt.verified) {
    return `FAILED to send to ${label}: ${receipt.reason || "the send could not be verified"}. Do NOT tell the user it was sent.`;
  }
  const verb = CHANNEL_VERB[receipt.channel];
  if (receipt.url) return `${verb}. Live URL: ${receipt.url}`;
  if (receipt.id) return `${verb}. Confirmed id: ${receipt.id}`;
  return `${verb}. The connector confirmed the send.`;
}

/**
 * I4-R1 — the honest affordance for an approve verb with NO committed send.
 *
 * When the user says "approve" / "post now" but the approve carries no concrete final
 * draft to publish (no committed content reached the send path), the ONLY honest reply
 * is to tell them how to actually commit the send — never a fabricated "posted" and
 * never a silent no-op. This is the structural counterpart to renderOutboundReceipt: an
 * approve either becomes a verified receipt (a real send happened) or this affordance (no
 * send happened). There is no third shape.
 */
export function renderApproveAffordance(channel?: OutboundChannel): string {
  const where = channel ? ` to ${CHANNEL_LABEL[channel]}` : "";
  return (
    `Nothing was sent${where}: there is no committed draft to publish. ` +
    `Show the user the exact final text and target, and tell them to say "post now" to send it. ` +
    `Do NOT claim anything was posted or sent.`
  );
}
