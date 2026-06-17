import { driveClientFromSettings } from "./drive.js";
import type { Settings } from "./settings.js";

const VOICE_ARCHIVE_FOLDER = "Voice Notes";
const IMAGE_ARCHIVE_FOLDER = "Images";

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

/** A safe, descriptive Drive filename: <prefix>-<iso>-<who>.<ext>. */
function archiveFilename(prefix: string, who: string, timestampMs: number, ext: string, fallbackExt: string): string {
  const iso = new Date(timestampMs).toISOString().replace(/[:.]/g, "-");
  const slug = who.replace(/[^a-zA-Z0-9_@.-]+/g, "_").slice(0, 40) || "unknown";
  return `${prefix}-${iso}-${slug}.${ext.replace(/^\./, "") || fallbackExt}`;
}

/** A safe, descriptive Drive filename: voice-<iso>-<who>.<ext>. */
export function voiceArchiveFilename(who: string, timestampMs: number, ext: string): string {
  return archiveFilename("voice", who, timestampMs, ext, "ogg");
}

/** A safe, descriptive Drive filename: image-<iso>-<who>.<ext>. */
export function imageArchiveFilename(who: string, timestampMs: number, ext: string): string {
  return archiveFilename("image", who, timestampMs, ext, "jpg");
}

/**
 * Archive a media buffer to a Drive subfolder — best effort. No-ops (returns
 * null) when Drive isn't configured, and the caller must treat any throw as
 * non-fatal: archiving must never block or break the reply.
 */
async function archiveToFolder(settings: Settings, media: VoiceAudio, folder: string): Promise<VoiceArchiveResult | null> {
  const folderId = settings.get("google_drive_folder_id");
  const client = driveClientFromSettings(settings);
  if (!client || !folderId) return null;
  const archiveId = await client.ensureFolder(folder, folderId);
  const file = await client.uploadFile(media.filename, media.mimeType, media.data, archiveId);
  return { fileId: file.id, name: file.name, webViewLink: file.webViewLink };
}

/**
 * Archive a voice note's audio to Google Drive — best effort. Called only when
 * the agent judged the note substantive (it filed it via capture_note), so we
 * keep something the user may want to hear back later.
 */
export function archiveVoiceNote(settings: Settings, audio: VoiceAudio): Promise<VoiceArchiveResult | null> {
  return archiveToFolder(settings, audio, VOICE_ARCHIVE_FOLDER);
}

/**
 * Archive an image to Google Drive — best effort, mirroring voice notes. Called
 * only when the agent kept the image (filed it), so the original lands in Drive
 * alongside the vault note describing it.
 */
export function archiveImage(settings: Settings, image: VoiceAudio): Promise<VoiceArchiveResult | null> {
  return archiveToFolder(settings, image, IMAGE_ARCHIVE_FOLDER);
}
