import { driveClientFromSettings } from "./drive.js";
import { imageArchiveFolder, voiceArchiveFolder } from "./driveFolders.js";
import type { Settings } from "./settings.js";
import type { VoiceAudio } from "./voiceArchivePrimitives.js";
export {
  agentKeptNote,
  driveArchiveUnavailableReason,
  imageArchiveFilename,
  voiceArchiveFilename,
  type VoiceAudio,
} from "./voiceArchivePrimitives.js";

export interface VoiceArchiveResult {
  fileId: string;
  name: string;
  webViewLink?: string;
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
