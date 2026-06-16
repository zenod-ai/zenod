import { DriveClient } from "./drive.js";
import type { Settings } from "./settings.js";

const VOICE_ARCHIVE_FOLDER = "Voice Notes";

export interface VoiceAudio {
  data: Buffer;
  filename: string;
  mimeType: string;
}

export interface VoiceArchiveResult {
  fileId: string;
  name: string;
  webViewLink?: string;
}

/** Did the agent judge this note worth keeping? It signals that by filing it. */
export function agentKeptNote(reply: { actions?: Array<{ tool: string }> }): boolean {
  return reply.actions?.some((a) => a.tool === "capture_note") === true;
}

/** A safe, descriptive Drive filename: voice-<iso>-<who>.<ext>. */
export function voiceArchiveFilename(who: string, timestampMs: number, ext: string): string {
  const iso = new Date(timestampMs).toISOString().replace(/[:.]/g, "-");
  const slug = who.replace(/[^a-zA-Z0-9_@.-]+/g, "_").slice(0, 40) || "unknown";
  return `voice-${iso}-${slug}.${ext.replace(/^\./, "") || "ogg"}`;
}

/**
 * Archive a voice note's audio to Google Drive — best effort. Called only when
 * the agent judged the note substantive (it filed it via capture_note), so we
 * keep something the user may want to hear back later. No-ops (returns null)
 * when Drive isn't configured, and the caller must treat any throw as
 * non-fatal: archiving must never block or break the reply.
 */
export async function archiveVoiceNote(settings: Settings, audio: VoiceAudio): Promise<VoiceArchiveResult | null> {
  const serviceAccountJson = settings.get("google_service_account_json");
  const folderId = settings.get("google_drive_folder_id");
  if (!serviceAccountJson || !folderId) return null;
  const client = new DriveClient(serviceAccountJson);
  const archiveId = await client.ensureFolder(VOICE_ARCHIVE_FOLDER, folderId);
  const file = await client.uploadFile(audio.filename, audio.mimeType, audio.data, archiveId);
  return { fileId: file.id, name: file.name, webViewLink: file.webViewLink };
}
