import type { DriveSourceTools } from "zenod";
import { driveClientFromSettings, type DriveFile } from "./drive.js";
import { ensureDriveInboxFolder, uniqueDriveFiles } from "./driveFolders.js";
import type { IngestQueue } from "./ingestQueue.js";
import type { Settings } from "./settings.js";

/**
 * The Drive half of the chat/MCP tool surface: list what the service account
 * can see in the inbox, and *enqueue* a file for ingestion. The actual work —
 * download → extract/transcribe → file → archive — runs in the background queue
 * (ingestQueue.ts), so a long transcription survives the user navigating away,
 * refreshing, even a redeploy. The tool returns immediately with the job id;
 * progress is watched in the Transcription panel (GET /api/ingest/jobs).
 *
 * The configured folder is the Zenod Drive root. Files dropped directly in the
 * root or in its auto-created Inbox/ subfolder can be queued. After a successful
 * ingest the file moves to Archive/Drive Ingest/ under that same root.
 */

function describe(file: DriveFile): string {
  const size = file.size ? `${(Number(file.size) / (1024 * 1024)).toFixed(1)} MB` : "—";
  return `${file.name} | id: ${file.id} | ${file.mimeType} | ${size} | modified ${file.modifiedTime ?? "?"}`;
}

export function buildDriveTools(settings: Settings, queue: IngestQueue): DriveSourceTools | undefined {
  // Hosted Drive is deliberately archive/export-only for public beta. GitHub
  // remains the source integration; the full Drive inbox/source workflow is a
  // self-hosted BYO-credentials capability.
  if (settings.googleDriveOAuthAuthority().mode === "hosted-managed") return undefined;
  const client = driveClientFromSettings(settings);
  if (!client) return undefined;

  const folderId = settings.get("google_drive_folder_id");

  return {
    async listDriveFiles(query?: string): Promise<string> {
      const files = folderId
        ? uniqueDriveFiles([
            ...(await client.listFiles({ folderId, ...(query ? { nameContains: query } : {}) })),
            ...(await ensureDriveInboxFolder(client, folderId)
              .then((inboxId) => client.listFiles({ folderId: inboxId, ...(query ? { nameContains: query } : {}) }))
              .catch(() => [])),
          ])
        : await client.listFiles({ ...(query ? { nameContains: query } : {}) });
      if (files.length === 0) {
        return query
          ? `no Drive files match '${query}'`
          : "the Zenod Drive folder is empty — everything has been ingested and archived, or nothing has been dropped in the root/Inbox yet";
      }
      return files.map(describe).join("\n");
    },

    async ingestDriveFile(fileId: string, hints?: string[]): Promise<string> {
      // Resolve the name for a friendly job label; fall back to the id.
      const file = await client.getFile(fileId).catch(() => null);
      const name = file?.name ?? fileId;
      const job = queue.enqueue(fileId, name, hints ?? []);
      return [
        `Queued "${name}" for media/document ingestion (job ${job.id}, status: ${job.status}).`,
        "It downloads, extracts text or visual facts for images/PDFs, transcribes audio with the configured provider, files the evidence into the vault, and archives the original — in the background.",
        "Tell the user it's processing and that live progress is in the ingest panel; the result lands in the vault when done.",
      ].join("\n");
    },
  };
}
