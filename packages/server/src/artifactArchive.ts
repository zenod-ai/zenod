import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { driveClientFromSettings, type DriveClient } from "./drive.js";
import type { Settings } from "./settings.js";

export type ArtifactArchiveProviderKind = "local" | "drive";

export interface ArtifactArchiveInput {
  data: Buffer | Uint8Array;
  mediaType: string;
  filename?: string;
  source?: string;
  sender?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactArchiveHandle {
  provider: ArtifactArchiveProviderKind;
  id: string;
  uri: string;
  mediaType: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  archivedAt: string;
  source?: string;
  sender?: string;
  timestamp?: string;
  path?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactArchiveProvider {
  readonly kind: ArtifactArchiveProviderKind;
  archive(input: ArtifactArchiveInput): Promise<ArtifactArchiveHandle>;
}

export interface ArtifactArchiveOptions {
  now?: () => Date;
  driveClient?: DriveClient;
}

const DEFAULT_DRIVE_ARCHIVE_FOLDER = "Raw Artifacts";

function safeFilename(name: string | undefined, mediaType: string): string {
  const fallbackExt = mediaType.split("/")[1]?.replace(/[^a-zA-Z0-9.+-]/g, "") || "bin";
  const raw = basename(name?.trim() || `artifact.${fallbackExt}`);
  const safe = raw.replace(/[^a-zA-Z0-9._@+-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || `artifact.${fallbackExt}`;
}

function handleBase(input: ArtifactArchiveInput, now: Date): Omit<ArtifactArchiveHandle, "provider" | "id" | "uri"> {
  const data = Buffer.from(input.data);
  return {
    mediaType: input.mediaType,
    filename: safeFilename(input.filename, input.mediaType),
    sizeBytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
    archivedAt: now.toISOString(),
    ...(input.source ? { source: input.source } : {}),
    ...(input.sender ? { sender: input.sender } : {}),
    ...(input.timestamp ? { timestamp: input.timestamp } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function datedPath(date: Date): string[] {
  return [String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")];
}

export class LocalArtifactArchiveProvider implements ArtifactArchiveProvider {
  readonly kind = "local" as const;

  constructor(
    private readonly rootDir: string,
    private readonly options: ArtifactArchiveOptions = {},
  ) {
    if (!rootDir.trim()) throw new Error("local artifact archive root directory is required");
  }

  async archive(input: ArtifactArchiveInput): Promise<ArtifactArchiveHandle> {
    const now = this.options.now?.() ?? new Date();
    const base = handleBase(input, now);
    const data = Buffer.from(input.data);
    const dir = join(this.rootDir, ...datedPath(now));
    await mkdir(dir, { recursive: true });

    const ext = extname(base.filename);
    const stem = ext ? base.filename.slice(0, -ext.length) : base.filename;
    const storedName = `${base.sha256.slice(0, 16)}-${stem || "artifact"}${ext}`;
    const artifactPath = join(dir, storedName);
    const id = randomUUID();
    const handle: ArtifactArchiveHandle = {
      ...base,
      provider: "local",
      id,
      uri: `file://${artifactPath}`,
      path: artifactPath,
    };

    await writeFile(artifactPath, data, { flag: "wx" }).catch(async (err: NodeJS.ErrnoException) => {
      if (err.code !== "EEXIST") throw err;
    });
    await writeFile(`${artifactPath}.metadata.json`, `${JSON.stringify(handle, null, 2)}\n`);
    return handle;
  }
}

export class DriveArtifactArchiveProvider implements ArtifactArchiveProvider {
  readonly kind = "drive" as const;

  constructor(
    private readonly client: DriveClient,
    private readonly rootFolderId: string,
    private readonly options: ArtifactArchiveOptions = {},
  ) {
    if (!rootFolderId.trim()) throw new Error("Drive artifact archive root folder ID is required");
  }

  async archive(input: ArtifactArchiveInput): Promise<ArtifactArchiveHandle> {
    const now = this.options.now?.() ?? new Date();
    const base = handleBase(input, now);
    const archiveFolderId = await this.client.ensureFolder(DEFAULT_DRIVE_ARCHIVE_FOLDER, this.rootFolderId);
    const storedName = `${base.sha256}-${base.filename}`;
    const existing = (await this.client.listFiles({
      folderId: archiveFolderId,
      nameContains: storedName,
      pageSize: 20,
    })).find((file) => file.name === storedName && file.mimeType === input.mediaType);
    const uploaded = existing
      ?? await this.client.uploadFile(storedName, input.mediaType, Buffer.from(input.data), archiveFolderId);

    return {
      ...base,
      provider: "drive",
      id: uploaded.id,
      uri: `drive://file/${uploaded.id}`,
      url: uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`,
      filename: uploaded.name,
    };
  }
}

export function artifactArchiveProviderFromSettings(
  settings: Settings,
  options: ArtifactArchiveOptions = {},
): ArtifactArchiveProvider | null {
  const configured = settings.get("artifact_archive_provider");
  const localDir = settings.get("artifact_archive_local_dir");
  const driveFolderId = settings.get("artifact_archive_drive_folder_id") ?? settings.get("google_drive_folder_id");
  const provider = configured ?? (localDir ? "local" : driveFolderId ? "drive" : null);

  if (provider === "local") {
    if (!localDir) throw new Error("artifact archive provider is local, but ZENOD_ARTIFACT_ARCHIVE_LOCAL_DIR is not set");
    return new LocalArtifactArchiveProvider(localDir, options);
  }

  if (provider === "drive") {
    const client = options.driveClient ?? driveClientFromSettings(settings);
    if (!client) throw new Error("artifact archive provider is drive, but Google Drive is not connected");
    if (!driveFolderId) throw new Error("artifact archive provider is drive, but no Drive folder ID is configured");
    return new DriveArtifactArchiveProvider(client, driveFolderId, options);
  }

  return null;
}

export async function archiveRawArtifact(
  settings: Settings,
  input: ArtifactArchiveInput,
  options: ArtifactArchiveOptions = {},
): Promise<ArtifactArchiveHandle> {
  const provider = artifactArchiveProviderFromSettings(settings, options);
  if (!provider) {
    throw new Error(
      "artifact archive is not configured; set ZENOD_ARTIFACT_ARCHIVE_PROVIDER=local with ZENOD_ARTIFACT_ARCHIVE_LOCAL_DIR, or configure Drive",
    );
  }
  return provider.archive(input);
}
