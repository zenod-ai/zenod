import type { Settings } from "./settings.js";

export interface VoiceAudio {
  data: Buffer;
  filename: string;
  mimeType: string;
}

/** Why media archive uploads are currently unavailable, or null when ready. */
export function driveArchiveUnavailableReason(settings: Settings): string | null {
  if (!settings.driveConfigured()) return "Google Drive is not connected.";
  if (!settings.get("google_drive_folder_id")) return "missing Zenod Drive folder ID.";
  return null;
}

/** Did the agent judge this note worth keeping? It signals that by filing it. */
export function agentKeptNote(reply: { actions?: Array<{ tool: string }> }): boolean {
  return reply.actions?.some((action) =>
    ["capture", "capture_note", "add_memory", "store_memory"].includes(action.tool)
  ) === true;
}

function archiveFilename(
  prefix: string,
  who: string,
  timestampMs: number,
  ext: string,
  fallbackExt: string,
): string {
  const iso = new Date(timestampMs).toISOString().replace(/[:.]/g, "-");
  const slug = who.replace(/[^a-zA-Z0-9_@.-]+/g, "_").slice(0, 40) || "unknown";
  return `${prefix}-${iso}-${slug}.${ext.replace(/^\./, "") || fallbackExt}`;
}

export function voiceArchiveFilename(who: string, timestampMs: number, ext: string): string {
  return archiveFilename("voice", who, timestampMs, ext, "ogg");
}

export function imageArchiveFilename(who: string, timestampMs: number, ext: string): string {
  return archiveFilename("image", who, timestampMs, ext, "jpg");
}
