import type { BrainEngine } from "zenod";
import { DriveClient } from "./drive.js";
import { isAudioMimeType, transcribeAudio } from "./transcribe.js";
import type { IngestJob, IngestStore } from "./ingestStore.js";
import type { Settings } from "./settings.js";

/**
 * Background worker that drains the ingest queue one job at a time, fully
 * decoupled from any HTTP request. Each job updates its own row as it moves
 * download → transcribe (with whisper %) → file → archive, so the UI can
 * watch it from any tab and it survives navigation/refresh. A restart marks
 * in-flight jobs interrupted (see IngestStore) and the user can retry.
 */

const ARCHIVE_FOLDER = "Archive";
const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set(["application/json", "application/xml", "application/x-yaml"]);
const GOOGLE_DOC_MIMES = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
]);

export class IngestQueue {
  private draining = false;
  /** Abort controllers for jobs currently being processed, so Cancel can kill whisper. */
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly store: IngestStore,
    private readonly settings: Settings,
    private readonly getEngine: () => Promise<BrainEngine>,
  ) {}

  /** Enqueue a file (skips if one is already queued/running for it) and start draining. */
  enqueue(driveFileId: string, fileName: string, hints: string[] = []): IngestJob {
    const existing = this.store.activeForFile(driveFileId);
    const job = existing ?? this.store.enqueue(driveFileId, fileName, hints);
    void this.drain();
    return job;
  }

  retry(jobId: string): IngestJob | null {
    const job = this.store.requeue(jobId);
    if (job) void this.drain();
    return job;
  }

  /**
   * Cancel a job. If it's running, abort kills the whisper/ffmpeg child; if
   * it's only queued, mark it interrupted directly. Either way it lands as
   * interrupted ("cancelled") and is retryable on the current model.
   */
  cancel(jobId: string): IngestJob | null {
    const job = this.store.get(jobId);
    if (!job) return null;
    this.store.update(jobId, { status: "interrupted", step: "cancelled", progress: 0 });
    this.running.get(jobId)?.abort();
    return this.store.get(jobId);
  }

  /** Resume after boot: pick up anything still queued. */
  resume(): void {
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let job: IngestJob | null;
      while ((job = this.store.nextQueued())) {
        await this.process(job);
      }
    } finally {
      this.draining = false;
    }
  }

  private async process(job: IngestJob): Promise<void> {
    const serviceAccountJson = this.settings.get("google_service_account_json");
    if (!serviceAccountJson) {
      this.store.update(job.id, { status: "error", error: "Google Drive is not connected" });
      return;
    }
    const client = new DriveClient(serviceAccountJson);
    const folderId = this.settings.get("google_drive_folder_id");
    const controller = new AbortController();
    this.running.set(job.id, controller);

    try {
      const file = await client.getFile(job.driveFileId);
      const cached = this.store.cachedPayload(job.id);
      const sourceLink = cached?.sourceLink ?? file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`;
      console.log(`[ingest] ${job.id} start: ${file.name} (${file.mimeType})`);

      this.store.update(job.id, { status: "downloading", step: `Downloading ${file.name}`, progress: 0 });

      let body: string;
      let transcribedBy: string | undefined;
      if (cached) {
        body = cached.body;
        transcribedBy = cached.provider ?? undefined;
        console.log(`[ingest] ${job.id} using cached transcript for ${file.name} (${body.length} chars)`);
      } else if (isAudioMimeType(file.mimeType)) {
        const data = await client.download(file.id);
        this.store.update(job.id, { status: "transcribing", step: `Transcribing ${file.name}`, progress: 0 });
        const result = await transcribeAudio(data, file.name, {
          model: this.settings.whisperModel(),
          groqApiKey: this.settings.get("groq_api_key"),
          openaiApiKey: this.settings.get("openai_api_key"),
          useOpenAiForLongAudio: this.settings.useOpenAiForLongTranscription(),
          onProgress: (pct) => this.store.update(job.id, { progress: pct }),
          signal: controller.signal,
        });
        if (!result.success) throw new Error(`transcription failed: ${result.error}`);
        body = result.transcript!;
        transcribedBy = result.provider;
        this.store.update(job.id, {
          cachedBody: body,
          cachedProvider: transcribedBy ?? null,
          cachedSourceLink: sourceLink,
          progress: 100,
        });
        console.log(`[ingest] ${job.id} transcribed ${file.name} via ${transcribedBy} (${body.length} chars)`);
      } else if (GOOGLE_DOC_MIMES.has(file.mimeType)) {
        body = await client.exportText(file.id);
        this.store.update(job.id, { cachedBody: body, cachedProvider: null, cachedSourceLink: sourceLink });
      } else if (TEXT_MIME_PREFIXES.some((p) => file.mimeType.startsWith(p)) || TEXT_MIME_EXACT.has(file.mimeType)) {
        body = (await client.download(file.id)).toString("utf8");
        this.store.update(job.id, { cachedBody: body, cachedProvider: null, cachedSourceLink: sourceLink });
      } else {
        throw new Error(`unsupported file type ${file.mimeType} — audio, text, and Google Docs are supported`);
      }

      const header = [
        `${transcribedBy ? "Voice note" : "Document"} "${file.name}" ingested from Google Drive.`,
        `Original: ${sourceLink}`,
        ...(transcribedBy ? [`Transcribed by ${transcribedBy}.`] : []),
      ].join("\n");

      this.store.update(job.id, {
        status: "filing",
        step: cached ? `Filing cached transcript for ${file.name}` : `Filing ${file.name}`,
        progress: 100,
      });
      const engine = await this.getEngine();
      const stored = await engine.store({
        content: `${header}\n\n${body}`,
        source: "drive",
        verbatim: true,
        ...(job.hints.length > 0 ? { hints: job.hints } : {}),
      });

      // Archive the original (file ID — and its link — survive the move).
      let archived = false;
      const archiveParentId = folderId ?? file.parents?.[0];
      if (archiveParentId) {
        try {
          const archiveId = await client.ensureFolder(ARCHIVE_FOLDER, archiveParentId);
          await client.moveFile(file.id, archiveId);
          archived = true;
        } catch (err) {
          console.error(`[ingest] ${job.id} archive skipped: ${(err as Error).message}`);
        }
      } else {
        console.error(`[ingest] ${job.id} archive skipped: no Drive parent folder found`);
      }

      this.store.update(job.id, {
        status: "done",
        step: stored.question
          ? `Filed to Inbox — ${stored.question}`
          : stored.backlog?.candidates.length
            ? `Filed; proposed ${stored.backlog.candidates.length} backlog candidate${stored.backlog.candidates.length === 1 ? "" : "s"}`
            : null,
        progress: 100,
        evidenceRef: stored.evidenceRef,
        pages: stored.pagesTouched,
        commitSha: stored.commitSha,
        archived,
      });
      console.log(`[ingest] ${job.id} done: ${file.name} → ${stored.pagesTouched.join(", ")} (archived: ${archived})`);
    } catch (err) {
      if (controller.signal.aborted) {
        // Cancelled by the user — cancel() already set it to interrupted; don't
        // overwrite with an error.
        console.log(`[ingest] ${job.id} cancelled`);
      } else {
        console.error(`[ingest] ${job.id} failed:`, err);
        this.store.update(job.id, { status: "error", step: null, error: (err as Error).message });
      }
    } finally {
      this.running.delete(job.id);
    }
  }
}
