import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sep } from "node:path";

/**
 * EPIC-21 V8: read back the archived original of one captured entry (a WhatsApp
 * voice note, an audio file) by its evidence reference. Read only. The entry's
 * own `Raw artifact:` and `Raw artifact sha256:` lines say which file and which
 * bytes; the file must sit in THIS tenant's archive (its Drive folder tree or
 * local archive dir), and the bytes must match the recorded sha256.
 */

/** 15 MB of audio is about 20 minutes of WhatsApp opus; base64 makes it ~20 MB on the wire. */
export const RAW_ARTIFACT_MAX_BYTES = 15 * 1024 * 1024;

export type RawArtifactErrorCode =
  | "not_a_capture"
  | "no_raw_artifact"
  | "archive_unavailable"
  | "not_in_this_vault"
  | "too_large"
  | "sha256_mismatch";

export class RawArtifactError extends Error {
  constructor(readonly code: RawArtifactErrorCode, message: string) {
    super(message);
    this.name = "RawArtifactError";
  }
}

export interface RawArtifactPointer {
  uri: string;
  sha256: string | null;
  mediaType: string | null;
}

export interface RawArtifact {
  uri: string;
  mimeType: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  data: Buffer;
}

/** Minimal Drive surface the reader needs (read only). */
export interface RawArtifactDrive {
  getFile(fileId: string): Promise<{ id: string; name: string; mimeType: string; size?: string; parents?: string[] }>;
  download(fileId: string): Promise<Buffer>;
}

export interface RawArtifactStore {
  drive?: RawArtifactDrive | null;
  /** The tenant's Drive roots: an archived file must sit in one of them or one level below (Raw Artifacts, Voice Notes). */
  driveFolderIds?: string[];
  /** The tenant's local archive dir (local provider). */
  localDir?: string | null;
  maxBytes?: number;
}

/** The raw-artifact lines an ingested capture carries; null when the entry has none. */
export function rawArtifactPointer(content: string): RawArtifactPointer | null {
  const uri = /^Raw artifact:\s*(\S+)\s*$/im.exec(content)?.[1];
  if (!uri) return null;
  const sha256 = /^Raw artifact sha256:\s*([0-9a-f]{64})\s*$/im.exec(content)?.[1]?.toLowerCase() ?? null;
  const mediaType = /^Media type:\s*(\S+)\s*$/im.exec(content)?.[1] ?? null;
  return { uri, sha256, mediaType };
}

function checked(data: Buffer, expected: string | null, ref: string): string {
  const actual = createHash("sha256").update(data).digest("hex");
  if (!expected) throw new RawArtifactError("sha256_mismatch", `${ref} records no Raw artifact sha256, so the archived bytes cannot be checked.`);
  if (actual !== expected) throw new RawArtifactError("sha256_mismatch", `The archived file for ${ref} does not match its recorded sha256.`);
  return actual;
}

function tooLarge(size: number, max: number, ref: string): never {
  throw new RawArtifactError("too_large", `The archived file for ${ref} is ${size} bytes, over the ${max}-byte cap of this tool.`);
}

export async function readRawArtifact(ref: string, content: string, store: RawArtifactStore): Promise<RawArtifact> {
  const pointer = rawArtifactPointer(content);
  if (!pointer) throw new RawArtifactError("no_raw_artifact", `${ref} has no archived original (no Raw artifact line).`);
  const max = store.maxBytes ?? RAW_ARTIFACT_MAX_BYTES;

  const driveId = /^drive:\/\/file\/([A-Za-z0-9_-]+)$/.exec(pointer.uri)?.[1];
  if (driveId) {
    const roots = (store.driveFolderIds ?? []).filter(Boolean);
    if (!store.drive || roots.length === 0) throw new RawArtifactError("archive_unavailable", "Google Drive is not connected for this memory, so the archive cannot be read.");
    const file = await store.drive.getFile(driveId).catch(() => null);
    if (!file) throw new RawArtifactError("not_in_this_vault", `The archived file for ${ref} is not readable from this memory's Drive.`);
    const parents = file.parents ?? [];
    let inside = parents.some((id) => roots.includes(id));
    for (const parent of parents) {
      if (inside) break;
      const folder = await store.drive.getFile(parent).catch(() => null);
      inside = Boolean(folder?.parents?.some((id) => roots.includes(id)));
    }
    if (!inside) throw new RawArtifactError("not_in_this_vault", `The archived file for ${ref} is outside this memory's archive folder.`);
    const declared = Number(file.size ?? 0);
    if (declared > max) tooLarge(declared, max, ref);
    const data = await store.drive.download(driveId);
    if (data.byteLength > max) tooLarge(data.byteLength, max, ref);
    const sha256 = checked(data, pointer.sha256, ref);
    return { uri: pointer.uri, mimeType: pointer.mediaType ?? file.mimeType, filename: file.name, sizeBytes: data.byteLength, sha256, data };
  }

  if (pointer.uri.startsWith("file://")) {
    if (!store.localDir) throw new RawArtifactError("archive_unavailable", "This memory has no local artifact archive.");
    let path: string;
    let root: string;
    try {
      path = await realpath(fileURLToPath(pointer.uri));
      root = await realpath(store.localDir);
    } catch {
      throw new RawArtifactError("not_in_this_vault", `The archived file for ${ref} is not in this memory's archive.`);
    }
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) {
      throw new RawArtifactError("not_in_this_vault", `The archived file for ${ref} is outside this memory's archive.`);
    }
    const size = (await stat(path)).size;
    if (size > max) tooLarge(size, max, ref);
    const data = await readFile(path);
    const sha256 = checked(data, pointer.sha256, ref);
    return { uri: pointer.uri, mimeType: pointer.mediaType ?? "application/octet-stream", filename: path.split(sep).pop() ?? "artifact", sizeBytes: data.byteLength, sha256, data };
  }

  throw new RawArtifactError("not_in_this_vault", `${ref} points at an archive this memory cannot read (${pointer.uri.split(":")[0]}).`);
}
