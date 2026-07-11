import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { parseDocument } from "yaml";

export const PEER_SKILL_LIMITS = {
  maxFiles: 128,
  maxFileBytes: 1_048_576,
  maxBundleBytes: 4_194_304,
  maxArtifactsPerTenant: 16,
  maxTenantBytes: 32 * 1024 * 1024,
} as const;

export interface PeerSkillFileInput {
  path: string;
  content?: string;
  contentBase64?: string;
  /** Only regular files are accepted. Symlinks and other archive entry kinds are forbidden. */
  kind?: "file" | "directory" | "symlink";
}

export interface PeerSkillAttachmentRef {
  artifactId: string;
  version: string;
}

export interface PeerSkillFileMetadata {
  path: string;
  size: number;
  sha256: string;
  executable: false;
}

export interface PeerSkillArtifactMetadata extends PeerSkillAttachmentRef {
  name: string;
  description: string;
  createdAt: string;
  totalBytes: number;
  files: PeerSkillFileMetadata[];
  /** Stored scripts are data only. No API in this store loads or executes them. */
  scriptsInert: true;
}

export interface PeerSkillBundleDownload {
  format: "zenod-agent-skill-bundle-v1";
  artifact: PeerSkillArtifactMetadata;
  files: Array<{ path: string; contentBase64: string }>;
}

export interface LoadedPeerSkill {
  artifact: PeerSkillArtifactMetadata;
  /** The only artifact body disclosed automatically by the runtime loader. */
  skillMarkdown: string;
  /** Safe relative references only; reference/script bodies remain undisclosed. */
  inventory: PeerSkillFileMetadata[];
}

type PreparedFile = PeerSkillFileMetadata & { bytes: Buffer };

const writeQueues = new Map<string, Promise<void>>();

async function withWriteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const prior = writeQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  writeQueues.set(key, current);
  await prior;
  try {
    return await operation();
  } finally {
    release();
    if (writeQueues.get(key) === current) writeQueues.delete(key);
  }
}

function safeRelativePath(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 240 || value.includes("\0") || value.includes("\\")) {
    throw new Error("Skill file path is invalid.");
  }
  if (value.startsWith("/") || /^[a-zA-Z]:/.test(value)) {
    throw new Error(`Skill file path must be relative: ${value}`);
  }
  const normalized = posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized.startsWith("../")) {
    throw new Error(`Skill file path is not path-safe: ${value}`);
  }
  return normalized;
}

function decodeFile(input: PeerSkillFileInput): Buffer {
  if (input.kind && input.kind !== "file") {
    throw new Error(`Skill bundle entry is not a regular file: ${input.path}`);
  }
  const hasText = typeof input.content === "string";
  const hasBase64 = typeof input.contentBase64 === "string";
  if (hasText === hasBase64) {
    throw new Error(`Skill file must have exactly one content encoding: ${input.path}`);
  }
  if (hasText) return Buffer.from(input.content!, "utf8");
  const encoded = input.contentBase64!;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error(`Skill file has invalid base64 content: ${input.path}`);
  }
  return Buffer.from(encoded, "base64");
}

function parseSkillManifest(bytes: Buffer): { name: string; description: string; version: string | null } {
  const source = bytes.toString("utf8");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("SKILL.md must begin with YAML frontmatter.");
  const document = parseDocument(match[1]!);
  if (document.errors.length) throw new Error(`SKILL.md frontmatter is malformed: ${document.errors[0]!.message}`);
  const data = document.toJS({ maxAliasCount: 0 }) as unknown;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("SKILL.md frontmatter must be a mapping.");
  }
  const record = data as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  if (!name || !description) throw new Error("SKILL.md frontmatter requires non-empty name and description.");
  if (name.length > 100 || description.length > 2_000) {
    throw new Error("SKILL.md name or description exceeds the supported size.");
  }
  const metadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
    ? record.metadata as Record<string, unknown>
    : null;
  const declaredVersion = metadata?.version ?? record.version;
  if (declaredVersion !== undefined && typeof declaredVersion !== "string" && typeof declaredVersion !== "number") {
    throw new Error("SKILL.md version must be a string or number when present.");
  }
  const version = declaredVersion === undefined ? null : String(declaredVersion).trim();
  return { name, description, version: version || null };
}

function prepareFiles(inputs: PeerSkillFileInput[]): PreparedFile[] {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error("Skill bundle has no files.");
  if (inputs.length > PEER_SKILL_LIMITS.maxFiles) throw new Error("Skill bundle has too many files.");
  const seen = new Set<string>();
  let totalBytes = 0;
  const files = inputs.map((input) => {
    const path = safeRelativePath(input?.path);
    if (seen.has(path)) throw new Error(`Skill bundle has a duplicate path: ${path}`);
    seen.add(path);
    const bytes = decodeFile(input);
    if (bytes.byteLength > PEER_SKILL_LIMITS.maxFileBytes) throw new Error(`Skill file is too large: ${path}`);
    totalBytes += bytes.byteLength;
    if (totalBytes > PEER_SKILL_LIMITS.maxBundleBytes) throw new Error("Skill bundle is too large.");
    return {
      path,
      bytes,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      executable: false as const,
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (!seen.has("SKILL.md")) throw new Error("Skill bundle requires SKILL.md at its root.");
  return files;
}

function artifactDigest(files: PreparedFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(String(Buffer.byteLength(file.path)));
    hash.update(":");
    hash.update(file.path);
    hash.update(":");
    hash.update(String(file.size));
    hash.update(":");
    hash.update(file.bytes);
  }
  return hash.digest("hex");
}

export class PeerSkillStore {
  readonly rootDir: string;

  constructor(tenantDataDir: string) {
    this.rootDir = join(tenantDataDir, "peer-skills", "artifacts");
  }

  async put(inputs: PeerSkillFileInput[]): Promise<PeerSkillArtifactMetadata> {
    const files = prepareFiles(inputs);
    const manifestFile = files.find((file) => file.path === "SKILL.md")!;
    const parsed = parseSkillManifest(manifestFile.bytes);
    const artifactId = `sha256:${artifactDigest(files)}`;
    const version = parsed.version ?? artifactId.slice("sha256:".length, "sha256:".length + 12);
    return withWriteLock(this.rootDir, async () => {
      try {
        return await this.get({ artifactId, version });
      } catch (error) {
        if (!(error instanceof PeerSkillNotFoundError)) throw error;
      }

      await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      await this.enforceTenantQuota(totalBytes);
      const destination = this.artifactDir(artifactId);
      const temporary = join(this.rootDir, `.upload-${randomUUID()}`);
      const metadata: PeerSkillArtifactMetadata = {
        artifactId,
        version,
        name: parsed.name,
        description: parsed.description,
        createdAt: new Date().toISOString(),
        totalBytes,
        files: files.map(({ bytes: _bytes, ...file }) => file),
        scriptsInert: true,
      };
      try {
        await mkdir(temporary, { recursive: false, mode: 0o700 });
        for (const file of files) {
          const target = join(temporary, "files", ...file.path.split("/"));
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          await writeFile(target, file.bytes, { mode: 0o400, flag: "wx" });
        }
        await writeFile(join(temporary, "artifact.json"), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o400, flag: "wx" });
        await rename(temporary, destination);
        return this.get({ artifactId, version });
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    });
  }

  async get(ref: PeerSkillAttachmentRef): Promise<PeerSkillArtifactMetadata> {
    const artifactId = this.validateRef(ref);
    try {
      const raw = await readFile(join(this.artifactDir(artifactId), "artifact.json"), "utf8");
      const metadata = JSON.parse(raw) as PeerSkillArtifactMetadata;
      if (metadata.artifactId !== artifactId || metadata.version !== ref.version) throw new PeerSkillNotFoundError();
      return metadata;
    } catch (error) {
      if (error instanceof PeerSkillNotFoundError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) throw new PeerSkillNotFoundError();
      throw error;
    }
  }

  async download(ref: PeerSkillAttachmentRef): Promise<PeerSkillBundleDownload> {
    const artifact = await this.get(ref);
    const base = join(this.artifactDir(artifact.artifactId), "files");
    const files = await Promise.all(artifact.files.map(async (file) => {
      const target = join(base, ...safeRelativePath(file.path).split("/"));
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Stored skill artifact is invalid.");
      const bytes = await readFile(target);
      if (bytes.byteLength !== file.size || createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
        throw new Error("Stored skill artifact failed integrity verification.");
      }
      return { path: file.path, contentBase64: bytes.toString("base64") };
    }));
    return { format: "zenod-agent-skill-bundle-v1", artifact, files };
  }

  /**
   * Integrity-check an attached artifact for progressive runtime disclosure.
   * SKILL.md is the only body returned. References, assets and scripts remain an
   * inert, relative-path inventory until a future explicitly-scoped reader exists.
   */
  async load(ref: PeerSkillAttachmentRef): Promise<LoadedPeerSkill> {
    const artifact = await this.get(ref);
    const base = join(this.artifactDir(artifact.artifactId), "files");
    const seen = new Set<string>();
    let skillMarkdown: string | null = null;
    for (const file of artifact.files) {
      const path = safeRelativePath(file.path);
      if (seen.has(path)) throw new Error("Stored skill artifact has duplicate paths.");
      seen.add(path);
      if (!Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || file.executable !== false) {
        throw new Error("Stored skill artifact inventory is invalid.");
      }
      if (path !== "SKILL.md") continue;
      const target = join(base, "SKILL.md");
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Stored skill artifact is invalid.");
      const bytes = await readFile(target);
      if (bytes.byteLength !== file.size || createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
        throw new Error("Stored skill artifact failed integrity verification.");
      }
      const parsed = parseSkillManifest(bytes);
      const expectedVersion = parsed.version ?? artifact.artifactId.slice("sha256:".length, "sha256:".length + 12);
      if (parsed.name !== artifact.name || parsed.description !== artifact.description || expectedVersion !== artifact.version) {
        throw new Error("Stored skill artifact metadata failed integrity verification.");
      }
      skillMarkdown = bytes.toString("utf8");
    }
    if (skillMarkdown === null) throw new Error("Stored skill artifact has no SKILL.md.");
    return { artifact, skillMarkdown, inventory: artifact.files.map((file) => ({ ...file })) };
  }

  private validateRef(ref: PeerSkillAttachmentRef): string {
    if (!ref || typeof ref.artifactId !== "string" || !/^sha256:[a-f0-9]{64}$/.test(ref.artifactId)) {
      throw new PeerSkillNotFoundError();
    }
    if (typeof ref.version !== "string" || !ref.version || ref.version.length > 100) throw new PeerSkillNotFoundError();
    return ref.artifactId;
  }

  private async enforceTenantQuota(incomingBytes: number): Promise<void> {
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const artifacts = entries.filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name));
    if (artifacts.length >= PEER_SKILL_LIMITS.maxArtifactsPerTenant) throw new PeerSkillQuotaError();
    let storedBytes = 0;
    for (const artifact of artifacts) {
      try {
        const raw = await readFile(join(this.rootDir, artifact.name, "artifact.json"), "utf8");
        const metadata = JSON.parse(raw) as { totalBytes?: unknown };
        storedBytes += typeof metadata.totalBytes === "number" && Number.isSafeInteger(metadata.totalBytes) && metadata.totalBytes >= 0
          ? metadata.totalBytes
          : PEER_SKILL_LIMITS.maxBundleBytes;
      } catch {
        // Fail closed when a tenant artifact is corrupt or incomplete.
        storedBytes += PEER_SKILL_LIMITS.maxBundleBytes;
      }
    }
    if (storedBytes + incomingBytes > PEER_SKILL_LIMITS.maxTenantBytes) throw new PeerSkillQuotaError();
  }

  private artifactDir(artifactId: string): string {
    const digest = artifactId.startsWith("sha256:") ? artifactId.slice(7) : "invalid";
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new PeerSkillNotFoundError();
    return join(this.rootDir, digest);
  }
}

export class PeerSkillNotFoundError extends Error {
  constructor() {
    super("Peer skill artifact not found.");
    this.name = "PeerSkillNotFoundError";
  }
}

export class PeerSkillQuotaError extends Error {
  constructor() {
    super("Tenant peer skill artifact quota exceeded.");
    this.name = "PeerSkillQuotaError";
  }
}
