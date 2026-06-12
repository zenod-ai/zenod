import type { DriveSourceTools } from "zenod";
import { DriveClient, type DriveFile } from "./drive.js";
import type { IngestQueue } from "./ingestQueue.js";
import type { Settings } from "./settings.js";

/**
 * The Drive half of the chat/MCP tool surface: list what the service account
 * can see in the inbox, and *enqueue* a file for ingestion. The actual work —
 * download → transcribe → file → archive — runs in the background queue
 * (ingestQueue.ts), so a long transcription survives the user navigating away,
 * refreshing, even a redeploy. The tool returns immediately with the job id;
 * progress is watched in the Ingestion panel (GET /api/ingest/jobs).
 *
 * The shared folder is the INBOX and Drive is the binary store (the vault
 * holds markdown + pointers, never the binaries). After a successful ingest
 * the file moves to an auto-created Archive/ subfolder so the inbox listing
 * only ever shows what hasn't been consumed yet.
 */

function describe(file: DriveFile): string {
  const size = file.size ? `${(Number(file.size) / (1024 * 1024)).toFixed(1)} MB` : "—";
  return `${file.name} | id: ${file.id} | ${file.mimeType} | ${size} | modified ${file.modifiedTime ?? "?"}`;
}

export function buildDriveTools(settings: Settings, queue: IngestQueue): DriveSourceTools | undefined {
  const serviceAccountJson = settings.get("google_service_account_json");
  if (!serviceAccountJson) return undefined;

  const client = new DriveClient(serviceAccountJson);
  const folderId = settings.get("google_drive_folder_id");

  return {
    async listDriveFiles(query?: string): Promise<string> {
      const files = await client.listFiles({
        ...(folderId ? { folderId } : {}),
        ...(query ? { nameContains: query } : {}),
      });
      if (files.length === 0) {
        return query
          ? `no Drive files match '${query}'`
          : "the Drive inbox is empty — everything has been ingested and archived (or nothing is shared with the service account yet)";
      }
      return files.map(describe).join("\n");
    },

    async ingestDriveFile(fileId: string, hints?: string[]): Promise<string> {
      // Resolve the name for a friendly job label; fall back to the id.
      const file = await client.getFile(fileId).catch(() => null);
      const name = file?.name ?? fileId;
      const job = queue.enqueue(fileId, name, hints ?? []);
      return [
        `Queued "${name}" for ingestion (job ${job.id}, status: ${job.status}).`,
        "It downloads, transcribes locally with whisper, files the transcript into the vault, and archives the original — in the background.",
        "Tell the user it's processing and that live progress is in the Ingestion panel (Connections tab); the result lands in the vault when done.",
      ].join("\n");
    },
  };
}
