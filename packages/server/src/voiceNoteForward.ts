import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { projectCapture } from "./recentSaves.js";
import type { Runtime } from "./runtime.js";
import { SubscriberUrlError, validateSubscriberUrl, type AddressLookup, type SubscriberGrant, type SubscriberUrlPolicy } from "./subscribers.js";
import type { MediaIngestReceipt, TaskJob, TaskJobInput } from "./taskJobStore.js";

/**
 * EPIC-21 V1: one ingest door for voice notes recorded in other apps (EpicTeam Chat first). A narrow MCP server, reached
 * at /api/subscribers/v1/mcp with a `zvn_` token whose grant holds `voice_notes.write` (one grant per app, revocable).
 * The note goes into the same media seam a WhatsApp voice note uses: the raw audio is archived, a supplied transcript is
 * used as is (never transcribed again; the model that made it is recorded), otherwise Zenod transcribes it once; then a
 * Log entry tagged with the app, and filing. A repeated forward with the same idempotency key is the same note.
 * Contract: docs/voice-note-forwarding.md.
 */

/** Same formats the cloud chat's recorder sends (E14-S1), plus Opus in Ogg as messaging apps store it. */
const FORWARD_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};
/** About an hour of speech at 32 kbit/s; base64 in JSON makes the request a third larger. */
export const FORWARD_MAX_AUDIO_BYTES = 16 * 1024 * 1024;
export const FORWARD_MAX_BODY_BYTES = Math.ceil(FORWARD_MAX_AUDIO_BYTES * 4 / 3) + 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

export function forwardMediaType(contentType: string | null | undefined): string | null {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  return FORWARD_EXTENSIONS[type] ? type : null;
}

/** Scoped per app and per tenant: two apps can never collide, and one app's retries file once. */
export function forwardIdempotencyKey(tenantId: string, clientId: string, key: string): string {
  const app = createHash("sha256").update(clientId).digest("hex").slice(0, 12);
  return `${tenantId}:forward:${app}:${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

export function isForwardJobKey(tenantId: string, clientId: string, key: string | null): boolean {
  const app = createHash("sha256").update(clientId).digest("hex").slice(0, 12);
  return Boolean(key?.startsWith(`${tenantId}:forward:${app}:`));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app";
}

export interface ForwardArgs {
  sourceApp: string;
  idempotencyKey: string;
  transcript?: string;
  transcriptModel?: string;
  recordedAt?: string;
  durationSeconds?: number;
}

/** The media_ingest input for one forwarded note. */
export function forwardIngestInput(audio: Buffer, mediaType: string, args: ForwardArgs, grant: SubscriberGrant, now: Date): TaskJobInput {
  const app = args.sourceApp.trim();
  const at = args.recordedAt ?? now.toISOString();
  const transcript = args.transcript?.trim() ? args.transcript : undefined;
  return {
    mediaType: "audio",
    contentType: "voice_note",
    bytesRef: `data:${mediaType};base64,${audio.toString("base64")}`,
    filename: `${slug(app)}-voice-note-${at.replace(/[:.]/g, "-")}.${FORWARD_EXTENSIONS[mediaType]}`,
    sourceHint: `${app} voice note`,
    sourceApp: app,
    forwardedBy: grant.clientId,
    senderTimestamp: at,
    ...(args.durationSeconds !== undefined ? { audioDurationSeconds: args.durationSeconds } : {}),
    ...(transcript
      ? {
          providedTranscript: transcript,
          transcriptionDisposition: "provided" as const,
          transcriptionProvider: `${args.transcriptModel?.trim() || "unnamed model"} (transcribed by ${app})`,
        }
      : {}),
  };
}

export class ForwardAudioError extends Error {
  constructor(readonly code: "invalid_audio" | "audio_too_large" | "unsupported_audio" | "audio_url_not_allowed" | "audio_fetch_failed", message: string) {
    super(message);
  }
}

async function fetchAudio(rawUrl: string, options: { tenantId: string; policy: SubscriberUrlPolicy; lookup?: AddressLookup; fetch?: typeof fetch }): Promise<{ data: Buffer; contentType: string | null }> {
  let url: URL;
  try {
    url = await validateSubscriberUrl(rawUrl, { tenantId: options.tenantId, policy: options.policy, lookup: options.lookup });
  } catch (error) {
    if (error instanceof SubscriberUrlError) throw new ForwardAudioError("audio_url_not_allowed", error.message);
    throw error;
  }
  let response: Response;
  try {
    // No redirects: the address checked above is the address fetched.
    response = await (options.fetch ?? fetch)(url, { redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw new ForwardAudioError("audio_fetch_failed", "The audio URL could not be fetched.");
  }
  if (!response.ok) throw new ForwardAudioError("audio_fetch_failed", `The audio URL answered ${response.status}.`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > FORWARD_MAX_AUDIO_BYTES) throw new ForwardAudioError("audio_too_large", "The audio is larger than 16 MB.");
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > FORWARD_MAX_AUDIO_BYTES) throw new ForwardAudioError("audio_too_large", "The audio is larger than 16 MB.");
  return { data, contentType: response.headers.get("content-type") };
}

export interface ForwardServerOptions {
  runtime: Runtime;
  grant: SubscriberGrant;
  tenantId: string;
  policy: SubscriberUrlPolicy;
  lookup?: AddressLookup;
  fetch?: typeof fetch;
  now?: () => number;
}

const INGEST_VOICE_NOTE_SHAPE = {
  sourceApp: z.string().trim().min(1).max(60).describe("The app the note was recorded in, as the person knows it, e.g. 'EpicTeam Chat'. Shown in the Log entry and the receipt."),
  idempotencyKey: z.string().trim().min(1).max(200).describe("Your stable id for this note, e.g. its id in your app. Forwarding again with the same key returns the first job and files nothing new."),
  audioBase64: z.string().min(1).optional().describe("The raw audio, base64. Give this or audioUrl."),
  audioUrl: z.string().url().optional().describe("A public HTTPS URL Zenod can fetch the raw audio from without signing in (e.g. a short-lived signed link). Give this or audioBase64."),
  mimeType: z.string().optional().describe("The audio format, e.g. audio/webm, audio/ogg, audio/mp4, audio/mpeg, audio/wav. Required with audioBase64."),
  transcript: z.string().max(200_000).optional().describe("The transcript your app already made. Used as is and never transcribed again. Leave out to have Zenod transcribe the audio once."),
  transcriptModel: z.string().trim().min(1).max(120).optional().describe("The model that made the transcript, e.g. 'gpt-4o-mini-transcribe'. Recorded with the note."),
  recordedAt: z.string().datetime({ offset: true }).optional().describe("When the note was recorded, ISO-8601. Defaults to now."),
  durationSeconds: z.number().nonnegative().max(24 * 60 * 60).optional().describe("The note's length in seconds, if known."),
};

const GET_VOICE_NOTE_INGEST_SHAPE = {
  jobId: z.string().min(1).describe("The jobId ingest_voice_note returned."),
};

type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown>; isError?: boolean };

function failure(code: string, message: string): ToolResult {
  return { content: [{ type: "text", text: message }], structuredContent: { code, message }, isError: true };
}

/** What a forwarding app sees about one of its notes. */
export function forwardJobView(runtime: Runtime, job: TaskJob): Record<string, unknown> {
  const receipt = job.status === "done" ? job.result as MediaIngestReceipt | null : null;
  const save = projectCapture(runtime.taskJobStore, job);
  // Filing into topic pages finishes in the background enrichment job; its pages are the ones that count.
  const enrichmentId = receipt?.digest.enrichmentJobId;
  const enrichment = enrichmentId ? runtime.taskJobStore.get(enrichmentId) : null;
  const filed = enrichment?.status === "done" ? (enrichment.result as { pagesTouched?: string[] } | null)?.pagesTouched : undefined;
  return {
    jobId: job.id,
    status: job.status,
    filing: save.status,
    sourceApp: job.input.sourceApp ?? null,
    transcript: job.input.providedTranscript?.trim() ? "supplied" : "zenod",
    transcribedBy: receipt?.extraction.provider ?? (job.input.providedTranscript?.trim() ? job.input.transcriptionProvider ?? null : null),
    evidenceRef: receipt?.digest.evidenceRef ?? null,
    pagesTouched: filed ?? receipt?.digest.pagesTouched ?? [],
    ...(job.error ? { error: job.error } : {}),
  };
}

export function createVoiceNoteForwardServer(options: ForwardServerOptions): McpServer {
  const { runtime, grant, tenantId } = options;
  const now = options.now ?? Date.now;
  const server = new McpServer({ name: "zenod-voice-note-forwarding", version: "1.0.0" });

  server.registerTool(
    "ingest_voice_note",
    {
      title: "Forward a voice note to Zenod",
      description:
        "Add one voice note recorded in your app to the person's Zenod memory. Zenod keeps the raw audio, uses your transcript as is when you send one (otherwise it transcribes the audio once), writes a Log entry tagged with your app and files it like a WhatsApp voice note. Returns a jobId at once; get_voice_note_ingest returns the receipt.",
      inputSchema: INGEST_VOICE_NOTE_SHAPE,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args): Promise<ToolResult> => {
      if (Boolean(args.audioBase64) === Boolean(args.audioUrl)) return failure("invalid_input", "Send exactly one of audioBase64 or audioUrl.");
      // Never refused for the AI allowance (EPIC-14 S10): filing runs past it, and far past it the queue
      // still archives the audio raw.
      const key = forwardIdempotencyKey(tenantId, grant.clientId, args.idempotencyKey);
      let audio: Buffer;
      let contentType: string | null | undefined = args.mimeType;
      try {
        if (args.audioBase64) {
          if (!args.mimeType) return failure("invalid_input", "mimeType is required with audioBase64.");
          if (args.audioBase64.length > FORWARD_MAX_BODY_BYTES) throw new ForwardAudioError("audio_too_large", "The audio is larger than 16 MB.");
          audio = Buffer.from(args.audioBase64, "base64");
          if (audio.length > FORWARD_MAX_AUDIO_BYTES) throw new ForwardAudioError("audio_too_large", "The audio is larger than 16 MB.");
        } else {
          const fetched = await fetchAudio(args.audioUrl!, { tenantId, policy: options.policy, lookup: options.lookup, fetch: options.fetch });
          audio = fetched.data;
          contentType = args.mimeType ?? fetched.contentType;
        }
      } catch (error) {
        if (error instanceof ForwardAudioError) return failure(error.code, error.message);
        throw error;
      }
      if (audio.length === 0) return failure("invalid_audio", "The audio is empty.");
      const mediaType = forwardMediaType(contentType);
      if (!mediaType) return failure("unsupported_audio", `Unsupported audio format ${contentType ?? "(none)"}; send webm, ogg, mp4/m4a, aac, mp3 or wav.`);
      const startedAt = now();
      let job: TaskJob;
      try {
        job = runtime.taskJobQueue.enqueue("media_ingest", forwardIngestInput(audio, mediaType, args, grant, new Date(startedAt)), key);
      } catch (error) {
        console.warn(`[voice-forward] capture unavailable for ${tenantId}: ${error instanceof Error ? error.message : String(error)}`);
        return failure("capture_unavailable", "Zenod could not take the note right now; forward it again with the same idempotencyKey.");
      }
      const duplicate = job.createdAt < startedAt || job.status !== "queued";
      const view = { ...forwardJobView(runtime, job), duplicate };
      return {
        content: [{ type: "text", text: duplicate ? `Already received as job ${job.id} (${job.status}); nothing new was filed.` : `Queued voice note job ${job.id}. Poll get_voice_note_ingest with this jobId.` }],
        structuredContent: view,
      };
    },
  );

  server.registerTool(
    "get_voice_note_ingest",
    {
      title: "Check a forwarded voice note",
      description: "The receipt for a voice note your app forwarded: queued, running, done or error; whether your transcript was used or Zenod transcribed it; and the Log entry and pages it was filed to.",
      inputSchema: GET_VOICE_NOTE_INGEST_SHAPE,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ jobId }): Promise<ToolResult> => {
      const job = runtime.taskJobQueue.get(jobId);
      // Only this app's own notes: another app's job, or anything else in the memory, is "not found".
      if (!job || job.kind !== "media_ingest" || !isForwardJobKey(tenantId, grant.clientId, job.idempotencyKey)) {
        return failure("not_found", `No voice note job ${jobId} for this connection.`);
      }
      const view = forwardJobView(runtime, job);
      return { content: [{ type: "text", text: `Voice note job ${job.id}: ${job.status}.` }], structuredContent: view, isError: job.status === "error" };
    },
  );

  return server;
}
