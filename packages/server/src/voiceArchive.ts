import { driveClientFromSettings } from "./drive.js";
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
  return (
    reply.actions?.some((a) =>
      ["capture", "capture_note", "add_memory", "store_memory"].includes(a.tool),
    ) === true
  );
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
  const folderId = settings.get("google_drive_folder_id");
  const client = driveClientFromSettings(settings);
  if (!client || !folderId) return null;
  const archiveId = await client.ensureFolder(VOICE_ARCHIVE_FOLDER, folderId);
  const file = await client.uploadFile(audio.filename, audio.mimeType, audio.data, archiveId);
  return { fileId: file.id, name: file.name, webViewLink: file.webViewLink };
}
