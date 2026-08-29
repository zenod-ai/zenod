import type { BrainEngine } from "zenod";
import { archiveRawArtifact, type ArtifactArchiveHandle } from "./artifactArchive.js";
import { driveClientFromSettings } from "./drive.js";
import { extractArtifact, isExtractableArtifactMimeType } from "./artifactExtraction.js";
import type { Settings } from "./settings.js";
import { assertDurableStoreReceipt } from "./durableReceipt.js";
import {
  TASK_JOB_LEASE_MS,
  type MediaIngestReceipt,
  type TaskJob,
  type TaskJobInput,
  type TaskJobKind,
  type TaskJobStore,
} from "./taskJobStore.js";
import { isAudioMimeType, transcribeAudio } from "./transcribe.js";

/**
 * Background worker that drains durable jobs independently from HTTP requests.
 * Agentic/capture work remains serial by design: each turn runs a
 * multi-minute LLM loop and the vault is a single serialized writer, so running
 * them concurrently only contends the write queue and hammers the provider —
 * the durable queue lets fan-out callers enqueue freely and poll for results
 * instead of holding a connection open until the (proxy/client) timeout.
 * Conversational chat has one separate lane so a slow Drive archive or image
 * extraction cannot make an unrelated user message appear unanswered. A
 * restart marks in-flight jobs interrupted (see TaskJobStore).
 */
export class TaskJobQueue {
  private activeChatDrain: Promise<void> | null = null;
  private activeDurableDrain: Promise<void> | null = null;
  private leaseTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly store: TaskJobStore,
    private readonly getEngine: () => Promise<BrainEngine>,
    private readonly settings?: Settings,
  ) {}

  /** Enqueue a job and start draining; returns immediately with the queued job. */
  enqueue(kind: TaskJobKind, input: TaskJobInput, idempotencyKey?: string): TaskJob {
    if (this.closed) throw new Error("TaskJobQueue is closed");
    const rejection = this.admit(kind, input);
    if (rejection) throw new Error(rejection.message);
    const job = this.store.enqueue(kind, input, idempotencyKey);
    this.requestDrains();
    return job;
  }

  get(id: string): TaskJob | null {
    return this.store.get(id);
  }

  recent(limit?: number): TaskJob[] {
    return this.store.recent(limit);
  }

  /** Fail closed before durable admission or source/provider access. */
  admit(kind: TaskJobKind, input: TaskJobInput): TaskJobAdmissionRejection | null {
    if (
      kind === "media_ingest" &&
      isDriveFileReference(input.bytesRef) &&
      this.settings?.googleDriveOAuthAuthority().mode === "hosted-managed"
    ) {
      return {
        code: "hosted_drive_source_disabled",
        message: "Hosted Google Drive is archive/export-only and cannot be used as an ingest_memory source.",
      };
    }
    return null;
  }

  /** Resume after boot: pick up anything still queued. */
  resume(): void {
    if (this.closed) return;
    this.requestDrains();
  }

  private requestDrains(): void {
    if (this.closed) return;
    this.requestChatDrain();
    this.requestDurableDrain();
  }

  private requestChatDrain(): void {
    if (this.activeChatDrain) return;
    const active = this.drain(["chat"]);
    this.activeChatDrain = active;
    void active
      .catch((error) => console.error("[task-job] chat lane failed:", error))
      .finally(() => {
        if (this.activeChatDrain === active) this.activeChatDrain = null;
      });
  }

  private requestDurableDrain(): void {
    if (this.activeDurableDrain) return;
    const active = this.drain(["task", "work", "store", "media_ingest", "enrich_memory"]);
    this.activeDurableDrain = active;
    void active
      .catch((error) => console.error("[task-job] durable lane failed:", error))
      .finally(() => {
        if (this.activeDurableDrain === active) this.activeDurableDrain = null;
      });
  }

  private async drain(kinds: readonly TaskJobKind[]): Promise<void> {
    if (this.leaseTimer) {
      clearTimeout(this.leaseTimer);
      this.leaseTimer = null;
    }
    try {
      this.store.recoverExpiredRunning();
      let job: TaskJob | null;
      while ((job = this.store.claimNextQueued(Date.now(), kinds))) {
        await this.process(job);
      }
    } finally {
      this.scheduleLeaseRecovery();
    }
  }

  private async process(job: TaskJob): Promise<void> {
    const leaseHeartbeat = setInterval(
      () => this.store.renewClaim(job.id),
      Math.max(1_000, Math.floor(TASK_JOB_LEASE_MS / 3)),
    );
    leaseHeartbeat.unref?.();
    try {
      let completed = false;
      if (job.kind === "chat") {
        const engine = await this.getEngine();
        const result = await engine.chat(
          job.input.text ?? "",
          job.input.source ?? "mcp",
          { conversationKey: job.input.conversationKey ?? "mcp" },
        );
        completed = this.store.updateClaimed(job.id, { status: "done", result });
      } else if (job.kind === "task") {
        const engine = await this.getEngine();
        const result = await engine.handleTasking({
          text: job.input.text ?? "",
          surface: "mcp",
          conversationKey: job.input.conversationKey ?? "mcp",
        });
        completed = this.store.updateClaimed(job.id, { status: "done", result });
      } else if (job.kind === "store") {
        const engine = await this.getEngine();
        const result = await engine.store({
          content: job.input.content ?? "",
          source: job.input.source ?? "mcp",
          ...(job.input.hints ? { hints: job.input.hints } : {}),
          ...(job.input.verbatim !== undefined ? { verbatim: job.input.verbatim } : {}),
          ...(job.input.contentType ? { contentType: job.input.contentType } : {}),
          ...(job.input.capturedAt ? { capturedAt: job.input.capturedAt } : {}),
          ...(job.input.sourceId ? { sourceId: job.input.sourceId } : {}),
        });
        assertDurableStoreReceipt(result);
        completed = this.store.updateClaimed(job.id, { status: "done", result });
      } else if (job.kind === "media_ingest") {
        const rejection = this.admit(job.kind, job.input);
        if (rejection) throw new Error(rejection.message);
        if (!this.settings) {
          completed = this.store.updateClaimed(job.id, {
            status: "done",
            result: mediaIngestUnavailableReceipt(job.input, null),
          });
        } else {
          const archived = await archiveMediaInput(this.settings, job.input);
          const result = await processMediaIngest(
            this.settings,
            job.input,
            archived,
            () => this.getEngine(),
            job.idempotencyKey ?? job.id,
            (input, idempotencyKey) => this.enqueue("enrich_memory", input, idempotencyKey),
          );
          completed = this.store.updateClaimed(job.id, { status: "done", result });
        }
      } else if (job.kind === "enrich_memory") {
        const engine = await this.getEngine();
        if (!engine.enrichEvidence || !job.input.evidenceRef) {
          throw new Error("capture-first enrichment is unavailable");
        }
        const result = await engine.enrichEvidence({
          evidenceRef: job.input.evidenceRef,
          content: job.input.content ?? "",
          source: job.input.source ?? "mcp",
          ...(job.input.hints ? { hints: job.input.hints } : {}),
          ...(job.input.verbatim !== undefined ? { verbatim: job.input.verbatim } : {}),
          ...(job.input.contentType ? { contentType: job.input.contentType } : {}),
          ...(job.input.capturedAt ? { capturedAt: job.input.capturedAt } : {}),
          ...(job.input.sourceId ? { sourceId: job.input.sourceId } : {}),
        });
        assertDurableStoreReceipt(result);
        completed = this.store.updateClaimed(job.id, { status: "done", result });
      } else {
        const engine = await this.getEngine();
        const result = await engine.work({
          objective: job.input.objective ?? "",
          ...(job.input.plan ? { plan: job.input.plan } : {}),
        });
        completed = this.store.updateClaimed(job.id, { status: "done", result });
      }
      if (completed) console.log(`[task-job] ${job.id} done: ${job.kind}`);
      else console.warn(`[task-job] ${job.id} result ignored after claim ownership changed`);
    } catch (err) {
      console.error(`[task-job] ${job.id} failed:`, err);
      if (!this.store.updateClaimed(job.id, { status: "error", error: (err as Error).message })) {
        console.warn(`[task-job] ${job.id} error ignored after claim ownership changed`);
      }
    } finally {
      clearInterval(leaseHeartbeat);
    }
  }

  private scheduleLeaseRecovery(): void {
    if (this.closed) return;
    const expiresAt = this.store.nextRunningLeaseExpiry();
    if (expiresAt === null) return;
    const delay = Math.max(1, expiresAt - Date.now() + 1);
    this.leaseTimer = setTimeout(() => {
      this.leaseTimer = null;
      this.requestDrains();
    }, delay);
    this.leaseTimer.unref?.();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.leaseTimer) {
      clearTimeout(this.leaseTimer);
      this.leaseTimer = null;
    }
    await Promise.all([this.activeChatDrain, this.activeDurableDrain]);
  }
}

interface ArchivedMediaInput {
  handle: ArtifactArchiveHandle;
  data: Buffer;
  mediaType: string;
  filename: string;
  sourceLink?: string;
  sourceKind: "mcp" | "url" | "drive";
}

interface MediaExtraction {
  body: string;
  provider: string;
  kind: "audio" | "image" | "pdf" | "text";
  filename: string;
  label: string;
  transcriptionStatus?: "transcribed" | "skipped_duration_limit" | "skipped_unavailable";
}

function parseDataUrl(bytesRef: string): { data: Buffer; mediaType: string } {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(bytesRef);
  if (!match) throw new Error("bytesRef data URL is malformed");
  const mediaType = match[1] || "application/octet-stream";
  const isBase64 = bytesRef.slice(0, bytesRef.indexOf(",")).includes(";base64");
  const data = isBase64 ? Buffer.from(match[2]!, "base64") : Buffer.from(decodeURIComponent(match[2]!), "utf8");
  return { data, mediaType };
}

async function archiveMediaInput(settings: Settings, input: TaskJobInput): Promise<ArchivedMediaInput> {
  const source = input.sourceHint ?? "mcp";
  const timestamp = input.senderTimestamp;
  const filename = input.filename ?? `${input.mediaType ?? "artifact"}.bin`;

  if (input.artifactUrl) {
    const response = await fetch(input.artifactUrl);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`artifact download failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    const mediaType = inferMimeType(input, filename, response.headers.get("content-type")?.split(";")[0]?.trim() || null);
    const data = Buffer.from(await response.arrayBuffer());
    const handle = await archiveRawArtifact(settings, {
      data,
      mediaType,
      filename,
      source,
      timestamp,
      metadata: {
        bytesRefKind: "transport-capability",
        mediaTypeHint: input.mediaType,
        contentHint: input.contentHint,
        hints: input.mediaHints,
      },
    });
    return { handle, data, mediaType, filename, sourceLink: input.artifactUrl, sourceKind: "url" };
  }

  if (input.bytesRef?.startsWith("data:")) {
    const { data, mediaType } = parseDataUrl(input.bytesRef);
    const inferredMediaType = inferMimeType(input, filename, mediaType);
    const handle = await archiveRawArtifact(settings, {
      data,
      mediaType: inferredMediaType,
      filename,
      source,
      timestamp,
      metadata: {
        bytesRefKind: "data-url",
        mediaTypeHint: input.mediaType,
        contentHint: input.contentHint,
        hints: input.mediaHints,
      },
    });
    return { handle, data, mediaType: inferredMediaType, filename, sourceKind: "mcp" };
  }

  const driveFileId = driveFileIdFromRef(input.bytesRef);
  if (driveFileId) {
    const client = driveClientFromSettings(settings);
    if (!client) throw new Error("Drive media ingest requested, but Google Drive is not connected");
    const file = await client.getFile(driveFileId);
    const sourceLink = file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`;
    const driveFilename = input.filename ?? file.name;
    const data = file.mimeType.startsWith("application/vnd.google-apps.")
      ? Buffer.from(await client.exportText(file.id), "utf8")
      : await client.download(file.id);
    const mediaType = file.mimeType.startsWith("application/vnd.google-apps.")
      ? "text/plain"
      : inferMimeType(input, driveFilename, file.mimeType);
    const handle = await archiveRawArtifact(settings, {
      data,
      mediaType,
      filename: driveFilename,
      source,
      timestamp,
      metadata: {
        bytesRefKind: "drive",
        driveFileId,
        sourceLink,
        mediaTypeHint: input.mediaType,
        contentHint: input.contentHint,
        hints: input.mediaHints,
      },
    });
    return { handle, data, mediaType, filename: driveFilename, sourceLink, sourceKind: "drive" };
  }

  if (input.bytesRef) {
    const data = Buffer.from(`${JSON.stringify({ bytesRef: input.bytesRef, sourceHint: input.sourceHint, contentHint: input.contentHint })}\n`);
    const mediaType = "application/vnd.zenod.artifact-ref+json";
    const handle = await archiveRawArtifact(settings, {
      data,
      mediaType: "application/vnd.zenod.artifact-ref+json",
      filename: input.filename ?? "artifact-ref.json",
      source,
      timestamp,
      metadata: {
        bytesRef: input.bytesRef,
        mediaTypeHint: input.mediaType,
        contentHint: input.contentHint,
        hints: input.mediaHints,
      },
    });
    return { handle, data, mediaType, filename: input.filename ?? "artifact-ref.json", sourceKind: "mcp" };
  }

  throw new Error("media ingest requires artifactUrl or bytesRef");
}

async function processMediaIngest(
  settings: Settings,
  input: TaskJobInput,
  archived: ArchivedMediaInput,
  getEngine: () => Promise<BrainEngine>,
  captureIdentity: string,
  enqueueEnrichment: (input: TaskJobInput, idempotencyKey: string) => TaskJob,
): Promise<MediaIngestReceipt> {
  const canTranscribe = input.mediaType === "audio" || isAudioMimeType(archived.mediaType);
  const canExtractArtifact =
    isExtractableArtifactMimeType(archived.mediaType) &&
    (input.mediaType === "screenshot" ||
      input.mediaType === "image" ||
      input.mediaType === "pdf" ||
      isExtractableArtifactMimeType(archived.mediaType));
  const canReadText = input.mediaType === "document" || input.mediaType === "link" || isTextMimeType(archived.mediaType);
  if (!canTranscribe && !canExtractArtifact && !canReadText) {
    return mediaIngestUnavailableReceipt(input, archived.handle);
  }
  if (input.transcriptionDisposition === "skip_duration_limit"
    && !(typeof input.audioDurationSeconds === "number"
      && Number.isFinite(input.audioDurationSeconds)
      && input.audioDurationSeconds > 2 * 60 * 60)) {
    throw new Error("skip_duration_limit requires a reported audio duration over 2 hours");
  }

  const engine = await getEngine();
  const extraction: MediaExtraction = canTranscribe
    ? input.transcriptionDisposition === "skip_duration_limit"
      ? skippedDurationLimitExtraction(input, archived)
      : input.transcriptionDisposition === "skip_unavailable"
        ? skippedUnavailableExtraction(input, archived)
      : input.providedTranscript?.trim()
        ? suppliedTranscriptExtraction(input, archived)
        : await transcribeMedia(settings, archived)
    : canExtractArtifact
      ? await extractVisualMedia(engine, archived)
      : extractTextMedia(archived);

  const extractionHandle = await archiveRawArtifact(settings, {
    data: Buffer.from(extraction.body, "utf8"),
    mediaType: "text/plain",
    filename: extraction.filename,
    source: input.sourceHint ?? archived.sourceKind,
    timestamp: input.senderTimestamp,
    metadata: {
      kind: extraction.kind,
      provider: extraction.provider,
      rawArtifact: archived.handle.uri,
      ...(archived.sourceKind === "drive" && archived.sourceLink
        ? { sourceLink: archived.sourceLink }
        : {}),
      contentHint: input.contentHint,
    },
  });

  const content = [
    `${extraction.label} "${archived.filename}" ingested through Zenod media seam.`,
    `Raw artifact: ${archived.handle.uri}`,
    ...(archived.handle.url ? [`Raw artifact URL: ${archived.handle.url}`] : []),
    `Raw artifact sha256: ${archived.handle.sha256}`,
    `Media type: ${archived.mediaType}`,
    `Source: ${input.sourceHint ?? archived.sourceKind}`,
    ...(input.senderTimestamp ? [`Source timestamp: ${input.senderTimestamp}`] : []),
    ...(extraction.transcriptionStatus === "skipped_duration_limit"
      ? ["Transcription: skipped because the audio exceeds Zenod's 2-hour transcription limit."]
      : extraction.transcriptionStatus === "skipped_unavailable"
        ? ["Transcription: skipped because the authenticated channel reported it unavailable."]
      : [`${extraction.kind === "audio" ? "Transcribed" : "Extracted"} by ${extraction.provider}.`]),
    `Extraction artifact: ${extractionHandle.uri}`,
    ...(input.contentHint ? [`User context: ${input.contentHint}`] : []),
    "",
    extraction.body,
  ].join("\n");
  const storeInput = {
    content,
    source: sourceFromHint(input.sourceHint),
    verbatim: true,
    contentType: input.mediaType ?? extraction.kind,
    ...(input.senderTimestamp ? { capturedAt: input.senderTimestamp } : {}),
    ...(input.mediaHints?.length ? { hints: input.mediaHints } : {}),
    sourceId: captureIdentity,
  } as const;
  const stored = engine.captureEvidence
    ? await engine.captureEvidence(storeInput)
    : await engine.store(storeInput);
  assertDurableStoreReceipt(stored);
  const enrichment = engine.captureEvidence && engine.enrichEvidence
    ? enqueueEnrichment(
        {
          content,
          source: storeInput.source,
          hints: storeInput.hints,
          verbatim: true,
          contentType: storeInput.contentType,
          ...(storeInput.capturedAt ? { capturedAt: storeInput.capturedAt } : {}),
          sourceId: captureIdentity,
          evidenceRef: stored.evidenceRef,
        },
        `enrich:${captureIdentity}`,
      )
    : null;

  return {
    status: "done",
    message: extraction.transcriptionStatus === "skipped_duration_limit"
      ? "Audio archived without transcription because it exceeds the 2-hour limit; a Zenod entry pointing to the audio was filed."
      : extraction.transcriptionStatus === "skipped_unavailable"
        ? "Audio archived without another transcription attempt; a Zenod entry pointing to the audio was filed."
      : enrichment
        ? "Media artifact and extraction captured in Zenod; semantic filing continues in the background."
        : "Media artifact archived, extracted, digested, filed, and durably saved.",
    mediaType: input.mediaType ?? extraction.kind,
    source: receiptSource(input),
    rawArtifact: { handle: archived.handle.uri, archiveUrl: archived.handle.url ?? archived.handle.uri, sha256: archived.handle.sha256 },
    extraction: {
      handle: extractionHandle.uri,
      archiveUrl: extractionHandle.url ?? extractionHandle.uri,
      transcriptHandle: extraction.kind === "audio" ? extractionHandle.uri : undefined,
      ocrHandle: extraction.kind === "image" ? extractionHandle.uri : undefined,
      provider: extraction.provider,
      ...(extraction.transcriptionStatus ? { transcriptionStatus: extraction.transcriptionStatus } : {}),
      ...(input.audioDurationSeconds !== undefined ? { durationSeconds: input.audioDurationSeconds } : {}),
    },
    digest: {
      evidenceRef: stored.evidenceRef,
      ...(stored.evidenceUrl ? { evidenceUrl: stored.evidenceUrl } : {}),
      pagesTouched: stored.pagesTouched,
      ...(stored.pageUrls ? { pageUrls: stored.pageUrls } : {}),
      revision: stored.revision ?? null,
      urls: stored.urls ?? [],
      ...(stored.commitSha !== undefined ? { commitSha: stored.commitSha } : {}),
      ...(stored.githubUrls !== undefined ? { githubUrls: stored.githubUrls } : {}),
      ...(stored.filing ? { filing: stored.filing } : {}),
      ...(enrichment ? { enrichmentJobId: enrichment.id } : {}),
    },
  };
}

function sourceFromHint(sourceHint: string | undefined): "mcp" | "whatsapp" | "telegram" | "drive" {
  const normalized = sourceHint?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("whatsapp")) return "whatsapp";
  if (normalized.startsWith("telegram")) return "telegram";
  if (normalized.startsWith("drive")) return "drive";
  return "mcp";
}

async function transcribeMedia(
  settings: Settings,
  archived: ArchivedMediaInput,
): Promise<MediaExtraction> {
  const result = await transcribeAudio(archived.data, archived.filename, {
    model: settings.whisperModel(),
    groqApiKey: settings.get("groq_api_key"),
    openaiApiKey: settings.get("openai_api_key"),
    openrouterApiKey: settings.get("openrouter_api_key"),
    openrouterModel: settings.openrouterTranscriptionModel(),
    longTranscriptionProvider: settings.longTranscriptionProvider(),
    useOpenAiForLongAudio: settings.useOpenAiForLongTranscription(),
  });
  if (!result.success) throw new Error(`transcription failed: ${result.error}`);
  return {
    body: result.transcript ?? "",
    provider: result.provider ?? "audio transcription",
    kind: "audio",
    filename: `${stripKnownExtension(archived.filename)}.transcript.txt`,
    label: "Voice note",
    transcriptionStatus: "transcribed",
  };
}

function suppliedTranscriptExtraction(input: TaskJobInput, archived: ArchivedMediaInput): MediaExtraction {
  const body = input.providedTranscript?.trim() ?? "";
  if (!body) throw new Error("authenticated channel supplied an empty transcript");
  return {
    body,
    provider: input.transcriptionProvider?.trim() || "authenticated channel transcription",
    kind: "audio",
    filename: `${stripKnownExtension(archived.filename)}.transcript.txt`,
    label: "Voice note",
    transcriptionStatus: "transcribed",
  };
}

function skippedDurationLimitExtraction(input: TaskJobInput, archived: ArchivedMediaInput): MediaExtraction {
  const duration = typeof input.audioDurationSeconds === "number" && Number.isFinite(input.audioDurationSeconds)
    ? `${Math.round(input.audioDurationSeconds)} seconds`
    : "more than 2 hours";
  return {
    body: [
      "This voice note was archived without transcription because it exceeds Zenod's 2-hour transcription limit.",
      `Reported audio duration: ${duration}.`,
      "Use the raw audio archive link in this evidence entry for separate processing.",
    ].join("\n"),
    provider: "not transcribed (2-hour duration limit)",
    kind: "audio",
    filename: `${stripKnownExtension(archived.filename)}.archive-note.txt`,
    label: "Voice note",
    transcriptionStatus: "skipped_duration_limit",
  };
}

function skippedUnavailableExtraction(_input: TaskJobInput, archived: ArchivedMediaInput): MediaExtraction {
  return {
    body: [
      "This voice note was archived without another transcription attempt because the authenticated channel reported transcription unavailable.",
      "Use the raw audio archive link in this evidence entry for separate processing.",
    ].join("\n"),
    provider: "not transcribed (channel unavailable)",
    kind: "audio",
    filename: `${stripKnownExtension(archived.filename)}.archive-note.txt`,
    label: "Voice note",
    transcriptionStatus: "skipped_unavailable",
  };
}

async function extractVisualMedia(
  engine: BrainEngine,
  archived: ArchivedMediaInput,
): Promise<{ body: string; provider: string; kind: "image" | "pdf"; filename: string; label: string }> {
  const result = await extractArtifact({
    data: archived.data,
    fileName: archived.filename,
    mimeType: archived.mediaType,
    engine,
  });
  return {
    body: result.body,
    provider: result.provider ?? result.kind,
    kind: result.kind === "pdf" ? "pdf" : "image",
    filename: `${stripKnownExtension(archived.filename)}.extraction.txt`,
    label: result.kind === "pdf" ? "PDF/document" : "Screenshot/image",
  };
}

function extractTextMedia(archived: ArchivedMediaInput): { body: string; provider: string; kind: "text"; filename: string; label: string } {
  const body = archived.data.toString("utf8").trim();
  if (!body) throw new Error(`text extraction failed for ${archived.filename}: no text found`);
  return {
    body,
    provider: "plain text",
    kind: "text",
    filename: `${stripKnownExtension(archived.filename)}.extraction.txt`,
    label: "Document/link",
  };
}

function receiptSource(input: TaskJobInput): MediaIngestReceipt["source"] {
  return {
    ...(input.filename ? { filename: input.filename } : {}),
    ...(input.sourceHint ? { sourceHint: input.sourceHint } : {}),
    ...(input.senderTimestamp ? { senderTimestamp: input.senderTimestamp } : {}),
    ...(input.contentHint ? { contentHint: input.contentHint } : {}),
    ...(input.mediaHints ? { hints: input.mediaHints } : {}),
  };
}

const DRIVE_FILE_REFERENCE_PREFIXES = ["drive://file/", "drive:", "google-drive:", "gdrive:"] as const;

export interface TaskJobAdmissionRejection {
  code: "hosted_drive_source_disabled";
  message: string;
}

export function isDriveFileReference(bytesRef: string | undefined): boolean {
  return Boolean(bytesRef && DRIVE_FILE_REFERENCE_PREFIXES.some((prefix) => bytesRef.startsWith(prefix)));
}

function driveFileIdFromRef(bytesRef: string | undefined): string | null {
  if (!bytesRef) return null;
  for (const prefix of DRIVE_FILE_REFERENCE_PREFIXES) {
    if (bytesRef.startsWith(prefix)) return bytesRef.slice(prefix.length);
  }
  return null;
}

function inferMimeType(input: TaskJobInput, filename: string, observed: string | null): string {
  if (observed && observed !== "application/octet-stream") return observed;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf") || input.mediaType === "pdf") return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (input.mediaType === "audio") return "audio/ogg";
  if (input.mediaType === "screenshot" || input.mediaType === "image") return "image/png";
  if (input.mediaType === "document" || input.mediaType === "link") return "text/plain";
  return observed || "application/octet-stream";
}

function isTextMimeType(mediaType: string): boolean {
  return mediaType.startsWith("text/") || ["application/json", "application/xml", "application/x-yaml"].includes(mediaType);
}

function stripKnownExtension(filename: string): string {
  return filename.replace(/\.[A-Za-z0-9]{1,8}$/, "") || "artifact";
}

function mediaIngestUnavailableReceipt(input: TaskJobInput, rawArtifact: ArtifactArchiveHandle | null = null): MediaIngestReceipt {
  return {
    status: "error",
    code: "media_ingest_processor_unavailable",
    message:
      "Media ingest MCP seam accepted the job, but raw artifact archive, transcription/OCR/extraction, and digest processors are not wired in this instance yet. Implement #660-#662 adapters before treating media ingest as green.",
    mediaType: input.mediaType ?? "unknown",
    source: {
      ...(input.filename ? { filename: input.filename } : {}),
      ...(input.sourceHint ? { sourceHint: input.sourceHint } : {}),
      ...(input.senderTimestamp ? { senderTimestamp: input.senderTimestamp } : {}),
      ...(input.contentHint ? { contentHint: input.contentHint } : {}),
      ...(input.mediaHints ? { hints: input.mediaHints } : {}),
    },
    rawArtifact: { handle: rawArtifact?.uri ?? null, archiveUrl: rawArtifact?.url ?? rawArtifact?.uri ?? null },
    extraction: {
      handle: null,
      transcriptHandle: input.mediaType === "audio" ? null : undefined,
      ocrHandle: input.mediaType === "screenshot" || input.mediaType === "image" ? null : undefined,
      provider: null,
    },
    digest: { evidenceRef: null, pagesTouched: [], revision: null, urls: [] },
    nextAdapterIssues: ["https://github.com/zenod-ai/zenod/issues/660", "https://github.com/zenod-ai/zenod/issues/661", "https://github.com/zenod-ai/zenod/issues/662"],
  };
}
