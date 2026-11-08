import type { StoreResult } from "zenod";
import type { MediaIngestReceipt, TaskJob, TaskJobStore } from "./taskJobStore.js";

/**
 * Console "Recent saves" (EPIC-7 T2.5): a customer-safe projection of the
 * tenant's own durable capture jobs. The task-job store already records every
 * capture at save time, per tenant, so the console never reads the vault.
 * Only the user's own captured text (as a short snippet), the receipt headline
 * and public vault links leave this module: no prompts, errors or tokens.
 */

export const RECENT_SAVES_DEFAULT_LIMIT = 20;
export const RECENT_SAVES_MAX_LIMIT = 50;
const SNIPPET_CHARS = 140;

export type RecentSaveChannel = "whatsapp" | "telegram" | "app" | "connector";
export type RecentSaveKind = "voice" | "text" | "image" | "document" | "link";
export type RecentSaveStatus = "saved" | "saving" | "failed";

export interface RecentSave {
  id: string;
  savedAt: string;
  channel: RecentSaveChannel;
  kind: RecentSaveKind;
  /** e.g. "WhatsApp voice", "WhatsApp text", "AI assistant". */
  channelLabel: string;
  snippet: string;
  status: RecentSaveStatus;
  /** The receipt headline the user got back, e.g. "Saved." or "Saved — filed to Inbox; …". */
  reply: string;
  notePath: string | null;
  noteUrl: string | null;
}

/** First line of a store receipt: shared with the MCP `store_memory` reply. */
export function storeReceiptHeadline(result: Pick<StoreResult, "filing" | "pagesTouched" | "topics">): string {
  if (result.topics) {
    const count = (status: string) => result.topics!.filter((topic) => topic.status === status).length;
    return `Saved — ${count("filed")} topics filed, ${count("uncertain")} uncertain, ${count("pending")} pending.${result.pagesTouched.some((path) => path.startsWith("Inbox/filing-")) ? " Unresolved assignments are recorded in Inbox." : ""}`;
  }
  return result.filing === "uncertain"
    ? `Saved — filed to ${result.pagesTouched[0] ?? "the selected page"} with an open filing question logged in the page (review anytime).`
    : result.filing === "inbox"
      ? "Saved — filed to Inbox; the filing question is logged in the note."
      : result.filing === "pending"
        ? "Filing pending."
        : "Saved.";
}

function snippet(value: string | undefined, fallback: string): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS - 1).trimEnd()}…` : text;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function channelOf(job: TaskJob): RecentSaveChannel {
  // Channel captures carry `<tenant>:<channel>:<messageId>` idempotency keys.
  const keyed = job.idempotencyKey?.match(/^[^:]+:(whatsapp|telegram):/)?.[1];
  const channel = keyed ?? job.input.source;
  if (channel === "whatsapp" || channel === "telegram") return channel;
  // E12-S1: a Keep from the web app's chat.
  return channel === "web" ? "app" : "connector";
}

function kindOf(job: TaskJob): RecentSaveKind {
  if (job.kind !== "media_ingest") return "text";
  switch (job.input.mediaType) {
    case "audio":
      return "voice";
    case "screenshot":
    case "image":
      return "image";
    case "link":
      return "link";
    default:
      return "document";
  }
}

const CHANNEL_LABEL: Record<RecentSaveChannel, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  app: "Zenod app",
  connector: "AI assistant",
};

const KIND_FALLBACK: Record<RecentSaveKind, string> = {
  voice: "Voice note",
  text: "Note",
  image: "Image",
  document: "Document",
  link: "Link",
};

type FilingLike = Pick<StoreResult, "filing" | "pagesTouched" | "topics" | "pageUrls" | "urls" | "evidenceUrl">;

function asFiling(value: unknown): FilingLike | null {
  const result = value as Partial<StoreResult> | null;
  if (!result || typeof result !== "object" || !Array.isArray(result.pagesTouched)) return null;
  return result as FilingLike;
}

function noteOf(filing: FilingLike | null): { notePath: string | null; noteUrl: string | null } {
  if (!filing) return { notePath: null, noteUrl: null };
  const notePath = filing.pagesTouched.find((path) => typeof path === "string") ?? null;
  const noteUrl = [...(filing.pageUrls ?? []), ...(filing.urls ?? []), filing.evidenceUrl]
    .map(httpsUrl)
    .find((url): url is string => url !== null) ?? null;
  return { notePath, noteUrl };
}

export function projectRecentSave(job: TaskJob, enrichment: TaskJob | null): RecentSave {
  const channel = channelOf(job);
  const kind = kindOf(job);
  const base = {
    id: job.id,
    savedAt: new Date(job.createdAt).toISOString(),
    channel,
    kind,
    channelLabel: channel === "connector" || channel === "app" ? CHANNEL_LABEL[channel] : `${CHANNEL_LABEL[channel]} ${kind}`,
    snippet: snippet(job.kind === "media_ingest" ? job.input.providedTranscript : job.input.content, KIND_FALLBACK[kind]),
  };
  if (job.status === "queued" || job.status === "running") {
    return { ...base, status: "saving", reply: "Saving…", notePath: null, noteUrl: null };
  }
  if (job.status !== "done" || !job.result) {
    return { ...base, status: "failed", reply: "Not saved.", notePath: null, noteUrl: null };
  }
  if (job.kind === "store") {
    const filing = asFiling(job.result);
    return { ...base, status: "saved", reply: filing ? storeReceiptHeadline(filing) : "Saved.", ...noteOf(filing) };
  }
  const receipt = job.result as MediaIngestReceipt;
  if (receipt.status !== "done") {
    return { ...base, status: "failed", reply: "Not saved.", notePath: null, noteUrl: null };
  }
  // Media is saved once ingested; its semantic filing finishes on the
  // follow-up enrich_memory job, whose note is the one worth linking.
  const filed = enrichment?.status === "done" ? asFiling(enrichment.result) : null;
  const filing = filed ?? asFiling(receipt.digest);
  return {
    ...base,
    status: "saved",
    reply: filed ? storeReceiptHeadline(filed) : "Saved — filing continues in the background.",
    ...noteOf(filing),
  };
}

export function recentSaves(store: TaskJobStore, limit = RECENT_SAVES_DEFAULT_LIMIT): RecentSave[] {
  const bounded = Math.min(Math.max(1, Math.floor(limit) || RECENT_SAVES_DEFAULT_LIMIT), RECENT_SAVES_MAX_LIMIT);
  return store.recentCaptures(bounded).map((job) => {
    const enrichmentId = job.kind === "media_ingest" ? (job.result as MediaIngestReceipt | null)?.digest?.enrichmentJobId : undefined;
    return projectRecentSave(job, enrichmentId ? store.get(enrichmentId) : null);
  });
}
