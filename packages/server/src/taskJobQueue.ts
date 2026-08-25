import type { BrainEngine } from "zenod";
import { archiveRawArtifact, type ArtifactArchiveHandle } from "./artifactArchive.js";
import { driveClientFromSettings } from "./drive.js";
import { extractArtifact, isExtractableArtifactMimeType } from "./artifactExtraction.js";
import type { Settings } from "./settings.js";
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
 * Background worker that drains the agentic-job queue one job at a time, fully
 * decoupled from any HTTP request. Serial by design: each turn runs a
 * multi-minute LLM loop and the vault is a single serialized writer, so running
 * them concurrently only contends the write queue and hammers the provider —
 * the durable queue lets fan-out callers enqueue freely and poll for results
 * instead of holding a connection open until the (proxy/client) timeout. A
 * restart marks in-flight jobs interrupted (see TaskJobStore).
 */
export class TaskJobQueue {
  private activeDrain: Promise<void> | null = null;
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
    const job = this.store.enqueue(kind, input, idempotencyKey);
    this.requestDrain();
    return job;
  }

  get(id: string): TaskJob | null {
    return this.store.get(id);
  }

  recent(limit?: number): TaskJob[] {
    return this.store.recent(limit);
  }

  /** Resume after boot: pick up anything still queued. */
  resume(): void {
    if (this.closed) return;
    this.requestDrain();
  }

  private requestDrain(): void {
    if (this.closed || this.activeDrain) return;
    const active = this.drain();
    this.activeDrain = active;
    void active
      .catch((error) => console.error("[task-job] queue drain failed:", error))
      .finally(() => {
        if (this.activeDrain === active) this.activeDrain = null;
      });
  }

  private async drain(): Promise<void> {
    if (this.leaseTimer) {
      clearTimeout(this.leaseTimer);
      this.leaseTimer = null;
    }
    try {
      this.store.recoverExpiredRunning();
      let job: TaskJob | null;
      while ((job = this.store.claimNextQueued())) {
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
        completed = this.store.updateClaimed(job.id, { status: "done", result });
      } else if (job.kind === "media_ingest") {
        if (!this.settings) {
          completed = this.store.updateClaimed(job.id, {
            status: "done",
            result: mediaIngestUnavailableReceipt(job.input, null),
          });
        } else {
          const archived = await archiveMediaInput(this.settings, job.input);
          const result = await processMediaIngest(this.settings, job.input, archived, () => this.getEngine());
          completed = this.store.updateClaimed(job.id, { status: "done", result });
        }
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
      this.requestDrain();
    }, delay);
    this.leaseTimer.unref?.();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.leaseTimer) {
      clearTimeout(this.leaseTimer);
      this.leaseTimer = null;
    }
    await this.activeDrain;
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

  const engine = await getEngine();
  const extraction = canTranscribe
    ? await transcribeMedia(settings, archived)
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
    `${extraction.kind === "audio" ? "Transcribed" : "Extracted"} by ${extraction.provider}.`,
    `Extraction artifact: ${extractionHandle.uri}`,
    ...(input.contentHint ? [`User context: ${input.contentHint}`] : []),
    "",
    extraction.body,
  ].join("\n");
  const stored = await engine.store({
    content,
    source: sourceFromHint(input.sourceHint),
    verbatim: true,
    contentType: input.mediaType ?? extraction.kind,
    ...(input.senderTimestamp ? { capturedAt: input.senderTimestamp } : {}),
    ...(input.mediaHints?.length ? { hints: input.mediaHints } : {}),
  });

  return {
    status: "done",
    message: "Media artifact archived, extracted, digested, filed, and committed.",
    mediaType: input.mediaType ?? extraction.kind,
    source: receiptSource(input),
    rawArtifact: { handle: archived.handle.uri, archiveUrl: archived.handle.url ?? archived.handle.uri, sha256: archived.handle.sha256 },
    extraction: {
      handle: extractionHandle.uri,
      archiveUrl: extractionHandle.url ?? extractionHandle.uri,
      transcriptHandle: extraction.kind === "audio" ? extractionHandle.uri : undefined,
      ocrHandle: extraction.kind === "image" ? extractionHandle.uri : undefined,
      provider: extraction.provider,
    },
    digest: {
      evidenceRef: stored.evidenceRef,
      ...(stored.evidenceUrl ? { evidenceUrl: stored.evidenceUrl } : {}),
      pagesTouched: stored.pagesTouched,
      ...(stored.pageUrls ? { pageUrls: stored.pageUrls } : {}),
      commitSha: stored.commitSha,
      githubUrls: stored.githubUrls,
      ...(stored.filing ? { filing: stored.filing } : {}),
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
): Promise<{ body: string; provider: string; kind: "audio"; filename: string; label: string }> {
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

function driveFileIdFromRef(bytesRef: string | undefined): string | null {
  if (!bytesRef) return null;
  for (const prefix of ["drive://file/", "drive:", "google-drive:", "gdrive:"]) {
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
    digest: { evidenceRef: null, pagesTouched: [], commitSha: null, githubUrls: [] },
    nextAdapterIssues: ["https://github.com/zenod-ai/zenod/issues/660", "https://github.com/zenod-ai/zenod/issues/661", "https://github.com/zenod-ai/zenod/issues/662"],
  };
}
