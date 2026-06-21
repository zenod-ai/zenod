import type { DriveClient, DriveFile } from "./drive.js";

export const DRIVE_INBOX_FOLDER = "Inbox";
export const DRIVE_ARCHIVE_FOLDER = "Archive";
export const DRIVE_INGEST_ARCHIVE_FOLDER = "Drive Ingest";
export const DRIVE_VOICE_ARCHIVE_FOLDER = "Voice Notes";
export const DRIVE_IMAGE_ARCHIVE_FOLDER = "Images";

async function ensurePath(client: DriveClient, rootFolderId: string, names: string[]): Promise<string> {
  let parentId = rootFolderId;
  for (const name of names) parentId = await client.ensureFolder(name, parentId);
  return parentId;
}

export async function ensureDriveInboxFolder(client: DriveClient, rootFolderId: string): Promise<string> {
  return ensurePath(client, rootFolderId, [DRIVE_INBOX_FOLDER]);
}

export async function driveIngestArchiveFolder(client: DriveClient, rootFolderId: string): Promise<string> {
  return ensurePath(client, rootFolderId, [DRIVE_ARCHIVE_FOLDER, DRIVE_INGEST_ARCHIVE_FOLDER]);
}

export async function voiceArchiveFolder(client: DriveClient, rootFolderId: string): Promise<string> {
  return ensurePath(client, rootFolderId, [DRIVE_ARCHIVE_FOLDER, DRIVE_VOICE_ARCHIVE_FOLDER]);
}

export async function imageArchiveFolder(client: DriveClient, rootFolderId: string): Promise<string> {
  return ensurePath(client, rootFolderId, [DRIVE_ARCHIVE_FOLDER, DRIVE_IMAGE_ARCHIVE_FOLDER]);
}

export function uniqueDriveFiles(files: DriveFile[]): DriveFile[] {
  const seen = new Set<string>();
  const out: DriveFile[] = [];
  for (const file of files) {
    if (seen.has(file.id)) continue;
    seen.add(file.id);
    out.push(file);
  }
  return out;
}
