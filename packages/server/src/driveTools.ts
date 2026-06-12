import type { BrainEngine, DriveSourceTools } from "zenod";
import { DriveClient, type DriveFile } from "./drive.js";
import { isAudioMimeType, transcribeAudio } from "./transcribe.js";
import type { Settings } from "./settings.js";

/**
 * The Drive half of the chat loop's external-source tools: list what the
 * service account can see, and ingest one file — transcribing audio first —
 * through the engine's store pipeline so it lands as immutable evidence
 * (with the Drive link as provenance) plus filed meaning pages.
 *
 * The shared folder is the INBOX and Drive is the binary store (the vault
 * holds markdown + pointers, never the binaries). After a successful ingest
 * the file is moved into an auto-created Archive/ subfolder — its file ID
 * and webViewLink survive the move, so the evidence pointer stays valid and
 * the inbox listing only ever shows what hasn't been consumed yet.
 */

const ARCHIVE_FOLDER = "Archive";

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set(["application/json", "application/xml", "application/x-yaml"]);
const GOOGLE_DOC_MIMES = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
]);

function describe(file: DriveFile): string {
  const size = file.size ? `${(Number(file.size) / (1024 * 1024)).toFixed(1)} MB` : "—";
  return `${file.name} | id: ${file.id} | ${file.mimeType} | ${size} | modified ${file.modifiedTime ?? "?"}`;
}

export function buildDriveTools(
  settings: Settings,
  getEngine: () => Promise<BrainEngine>,
): DriveSourceTools | undefined {
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
      const file = await client.getFile(fileId);
      const sourceLink = file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`;

      let body: string;
      let transcribedBy: string | undefined;
      if (isAudioMimeType(file.mimeType)) {
        const data = await client.download(file.id);
        const result = await transcribeAudio(data, file.name, settings.transcriptionKey());
        if (!result.success) throw new Error(`could not transcribe ${file.name}: ${result.error}`);
        body = result.transcript!;
        transcribedBy = result.provider;
      } else if (GOOGLE_DOC_MIMES.has(file.mimeType)) {
        body = await client.exportText(file.id);
      } else if (
        TEXT_MIME_PREFIXES.some((p) => file.mimeType.startsWith(p)) ||
        TEXT_MIME_EXACT.has(file.mimeType)
      ) {
        body = (await client.download(file.id)).toString("utf8");
      } else {
        throw new Error(`unsupported file type ${file.mimeType} — audio, text, and Google Docs are supported today`);
      }

      const header = [
        `${transcribedBy ? "Voice note" : "Document"} "${file.name}" ingested from Google Drive.`,
        `Original: ${sourceLink}`,
        ...(transcribedBy ? [`Transcribed by ${transcribedBy} whisper.`] : []),
      ].join("\n");

      const engine = await getEngine();
      const result = await engine.store({
        content: `${header}\n\n${body}`,
        source: "drive",
        verbatim: true,
        ...(hints && hints.length > 0 ? { hints } : {}),
      });

      // Archive after the store landed: the Drive link in the evidence is by
      // file ID, so it survives the move. A view-only share just skips this.
      let archiveNote = "archived: no (no inbox folder configured)";
      if (folderId) {
        try {
          const archiveId = await client.ensureFolder(ARCHIVE_FOLDER, folderId);
          await client.moveFile(file.id, archiveId);
          archiveNote = `archived: moved to ${ARCHIVE_FOLDER}/ in Drive (same link)`;
        } catch (err) {
          archiveNote = `archived: no — ${(err as Error).message.slice(0, 150)} (share the folder as Editor to enable archiving)`;
        }
      }

      return [
        result.question ? `NEEDS FILING — ask the user: ${result.question}` : `Ingested ${file.name}.`,
        `evidence: ${result.evidenceRef}`,
        `pages: ${result.pagesTouched.join(", ")}`,
        `commit: ${result.commitSha}`,
        archiveNote,
      ].join("\n");
    },
  };
}
