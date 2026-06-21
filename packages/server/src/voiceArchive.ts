import { driveClientFromSettings } from "./drive.js";
import { imageArchiveFolder, voiceArchiveFolder } from "./driveFolders.js";
import type { Settings } from "./settings.js";

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
async function archiveToFolder(settings: Settings, media: VoiceAudio, kind: "voice" | "image"): Promise<VoiceArchiveResult | null> {
  const folderId = settings.get("google_drive_folder_id");
  const client = driveClientFromSettings(settings);
  if (!client || !folderId) return null;
  const archiveId = kind === "image" ? await imageArchiveFolder(client, folderId) : await voiceArchiveFolder(client, folderId);
  const file = await client.uploadFile(media.filename, media.mimeType, media.data, archiveId);
  return { fileId: file.id, name: file.name, webViewLink: file.webViewLink };
}

/** Why media archive uploads are currently unavailable, or null when ready. */
export function driveArchiveUnavailableReason(settings: Settings): string | null {
  if (!driveClientFromSettings(settings)) return "Google Drive is not connected.";
  if (!settings.get("google_drive_folder_id")) return "missing Zenod Drive folder ID.";
  return null;
}

/**
 * Archive a voice note's audio to Google Drive — best effort. Called only when
 * the agent judged the note substantive (it filed it via capture_note), so we
 * keep something the user may want to hear back later.
 */
export function archiveVoiceNote(settings: Settings, audio: VoiceAudio): Promise<VoiceArchiveResult | null> {
  return archiveToFolder(settings, audio, "voice");
}

/**
 * Archive an image to Google Drive — best effort, mirroring voice notes. Called
 * only when the agent kept the image (filed it), so the original lands in Drive
 * alongside the vault note describing it.
 */
export function archiveImage(settings: Settings, image: VoiceAudio): Promise<VoiceArchiveResult | null> {
  return archiveToFolder(settings, image, "image");
}
