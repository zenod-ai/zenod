import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { checkEvidenceImmutability, type FileChange } from "./immutability.js";
import { assertDriveTransactionInvariant, type DriveVaultTransaction } from "./driveTransaction.js";
import {
  VaultPublicationError,
  type VaultRepository,
  type VaultRevision,
} from "./repository.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const MANIFEST_NAME = "manifest.json";
const BUNDLE_NAME = "repository.bundle";
const CONTROL_FOLDER = ".zenod";
const GIT_FOLDER = ".git";
const TRANSACTIONS_FOLDER = "transactions";
const OPERATION_PROPERTY = "zenodOperationId";

export interface DriveVaultFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  version?: string;
  md5Checksum?: string;
  appProperties?: Record<string, string>;
  headRevisionId?: string;
}

export interface DriveVaultRevisionRecord {
  id: string;
  modifiedTime?: string;
  md5Checksum?: string;
  keepForever?: boolean;
}

export interface DriveVaultPrecondition {
  expectedVersion?: string;
  expectedModifiedTime?: string;
  expectedChecksum?: string;
}

/** The bounded DriveClient surface required by the Drive vault adapter. */
export interface DriveVaultClient {
  ensureVaultRootFolder(vaultBindingId: string, storedFolderId?: string | null): Promise<string>;
  ensureFolder(name: string, parentId: string): Promise<string>;
  listFiles(options?: {
    folderId?: string;
    nameContains?: string;
    pageSize?: number;
    foldersOnly?: boolean;
    allPages?: boolean;
  }): Promise<DriveVaultFile[]>;
  getFile(fileId: string): Promise<DriveVaultFile>;
  download(fileId: string): Promise<Buffer>;
  uploadFile(
    name: string,
    mimeType: string,
    data: Buffer,
    parentFolderId: string,
    options?: { appProperties?: Record<string, string> },
  ): Promise<DriveVaultFile>;
  updateFile(
    fileId: string,
    mimeType: string,
    data: Buffer,
    precondition: DriveVaultPrecondition,
  ): Promise<DriveVaultFile>;
  moveFile(fileId: string, toFolderId: string, precondition?: DriveVaultPrecondition, newName?: string): Promise<DriveVaultFile | void>;
  listRevisions(fileId: string): Promise<DriveVaultRevisionRecord[]>;
  keepRevision(fileId: string, revisionId: string): Promise<void>;
  downloadRevision(fileId: string, revisionId: string): Promise<Buffer>;
}

export interface DriveVaultRepositoryOptions {
  client: DriveVaultClient;
  workdir: string;
  tenantId: string;
  vaultBindingId: string;
  storedRootFolderId?: string | null;
  stateDir?: string;
  authorName?: string;
  authorEmail?: string;
  now?: () => Date;
  idFactory?: () => string;
}

interface ManifestFile {
  fileId: string;
  mimeType: string;
  version?: string;
  modifiedTime?: string;
  checksum: string;
  webViewLink?: string;
  headRevisionId?: string;
}

interface PreservedConflictRevision extends DriveVaultRevisionRecord {
  checksum?: string;
  contentBase64?: string;
}

interface DriveVaultManifest {
  schemaVersion: 1;
  vaultBindingId: string;
  revisionId: string;
  committedAt: string;
  commitSha: string;
  bundle: ManifestFile;
  files: Record<string, ManifestFile>;
  tombstones: Record<string, ManifestTombstone[]>;
}

interface ManifestTombstone {
  fileId: string;
  archivedName: string;
  checksum: string;
  transactionId: string;
  deletedAt: string;
}

type MutationKind = "create" | "update" | "move" | "delete";

interface JournalMutation {
  operationId: string;
  kind: MutationKind;
  path: string;
  destinationPath?: string;
  fileId?: string;
  parentPath?: string;
  mimeType?: string;
  contentBase64?: string;
  checksum?: string;
  expectedVersion?: string;
  expectedModifiedTime?: string;
  expectedChecksum?: string;
  state: "pending" | "applied" | "conflict" | "failed";
  resultingFile?: DriveVaultFile;
  baselineRevisionIds?: string[];
  conflictRevisions?: PreservedConflictRevision[];
}

interface DriveJournal {
  schemaVersion: 1;
  transactionId: string;
  tenantId: string;
  vaultBindingId: string;
  intentDigest: string;
  message: string;
  state: "prepared" | "applying" | "recovering" | "committed" | "conflict" | "failed";
  baseRevisionId: string;
  targetCommitSha: string;
  mutations: JournalMutation[];
  createdAt: string;
  updatedAt: string;
  committedAt?: string;
  manifest?: DriveVaultManifest;
  replacementFiles?: Record<string, ManifestFile>;
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function mimeFor(path: string): string {
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".yml") || path.endsWith(".yaml")) return "application/yaml";
  return "application/octet-stream";
}

function normalizePath(path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/")).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || posix.isAbsolute(normalized)) {
    throw new Error(`invalid vault-relative path: ${path}`);
  }
  if (normalized === GIT_FOLDER || normalized.startsWith(`${GIT_FOLDER}/`) || normalized === CONTROL_FOLDER || normalized.startsWith(`${CONTROL_FOLDER}/`)) {
    throw new Error(`reserved Drive vault path: ${path}`);
  }
  return normalized;
}

function isAuthorization(error: unknown): boolean {
  return /\b401\b|\b403\b|authorization|invalid_grant|revoked/i.test((error as Error)?.message ?? "");
}

function samePrecondition(file: DriveVaultFile, mutation: JournalMutation): boolean {
  if (mutation.expectedVersion && file.version !== mutation.expectedVersion) return false;
  if (mutation.expectedModifiedTime && file.modifiedTime !== mutation.expectedModifiedTime) return false;
  return Boolean(mutation.expectedVersion || mutation.expectedModifiedTime || mutation.expectedChecksum);
}

function driveUrl(fileId: string, anchor?: string): string {
  const base = `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
  return anchor ? `${base}#${encodeURIComponent(anchor)}` : base;
}

/** Google Drive authority with ordinary files plus one full Git bundle. */
export class DriveVaultRepository implements VaultRepository {
  readonly provider = "google_drive" as const;
  readonly path: string;

  private manifest!: DriveVaultManifest;
  private manifestFile!: DriveVaultFile;
  private git!: SimpleGit;
  private rootFolderId!: string;
  private gitFolderId!: string;
  private controlFolderId!: string;
  private transactionsFolderId!: string;
  private deletedFolderId!: string;
  private readonly stateDir: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  private constructor(private readonly options: DriveVaultRepositoryOptions) {
    this.path = resolve(options.workdir);
    this.stateDir = resolve(options.stateDir ?? `${options.workdir}.zenod-drive`);
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  static async open(options: DriveVaultRepositoryOptions): Promise<DriveVaultRepository> {
    const repository = new DriveVaultRepository(options);
    await repository.initialize();
    return repository;
  }

  private async initialize(): Promise<void> {
    await mkdir(this.path, { recursive: true });
    await mkdir(join(this.stateDir, "transactions"), { recursive: true });
    this.rootFolderId = await this.options.client.ensureVaultRootFolder(
      this.options.vaultBindingId,
      this.options.storedRootFolderId,
    );
    this.gitFolderId = await this.options.client.ensureFolder(GIT_FOLDER, this.rootFolderId);
    this.controlFolderId = await this.options.client.ensureFolder(CONTROL_FOLDER, this.rootFolderId);
    this.transactionsFolderId = await this.options.client.ensureFolder(TRANSACTIONS_FOLDER, this.controlFolderId);
    this.deletedFolderId = await this.options.client.ensureFolder("deleted", this.controlFolderId);
    await this.ensureStandardFolders();
    await this.recoverTransactions();
    const manifestFile = await this.findNamedFile(this.controlFolderId, MANIFEST_NAME);
    if (!manifestFile) await this.provision();
    else await this.loadManifest(manifestFile);
    await this.materializeFromAuthority();
    await this.importExternalEdits();
  }

  private async ensureStandardFolders(): Promise<void> {
    for (const name of ["Log", "Projects", "Areas", "Notes", "Inbox", "_attachments", "_templates", ".brain"]) {
      await this.options.client.ensureFolder(name, this.rootFolderId);
    }
  }

  private async listChildren(folderId: string): Promise<DriveVaultFile[]> {
    const [files, folders] = await Promise.all([
      this.options.client.listFiles({ folderId, pageSize: 1000, allPages: true }),
      this.options.client.listFiles({ folderId, pageSize: 1000, foldersOnly: true, allPages: true }),
    ]);
    return [...files, ...folders];
  }

  private async findNamedFile(folderId: string, name: string): Promise<DriveVaultFile | null> {
    const files = await this.options.client.listFiles({ folderId, nameContains: name, pageSize: 100 });
    return files.find((file) => file.name === name) ?? null;
  }

  private async provision(): Promise<void> {
    await rm(join(this.path, ".git"), { recursive: true, force: true });
    await simpleGit().init(["--initial-branch=main", this.path]);
    this.git = simpleGit(this.path);
    await this.configureGit();
    await this.git.raw(["commit", "--allow-empty", "-m", "Initialize Zenod Drive vault"]);
    const commitSha = (await this.git.revparse(["HEAD"])).trim();
    const bundleData = await this.createBundle();
    const bundleFile = await this.options.client.uploadFile(
      BUNDLE_NAME,
      "application/x-git-bundle",
      bundleData,
      this.gitFolderId,
      { appProperties: { zenodVaultBinding: this.options.vaultBindingId } },
    );
    const revisionId = this.idFactory();
    const committedAt = this.now().toISOString();
    const manifest: DriveVaultManifest = {
      schemaVersion: 1,
      vaultBindingId: this.options.vaultBindingId,
      revisionId,
      committedAt,
      commitSha,
      bundle: this.manifestEntry(bundleFile, sha256(bundleData)),
      files: {},
      tombstones: {},
    };
    const manifestData = Buffer.from(JSON.stringify(manifest, null, 2));
    this.manifestFile = await this.options.client.uploadFile(
      MANIFEST_NAME,
      "application/json",
      manifestData,
      this.controlFolderId,
      { appProperties: { zenodVaultBinding: this.options.vaultBindingId } },
    );
    this.manifest = manifest;
  }

  private async loadManifest(file: DriveVaultFile): Promise<void> {
    const raw = await this.options.client.download(file.id);
    const manifest = JSON.parse(raw.toString("utf8")) as DriveVaultManifest;
    if (manifest.schemaVersion !== 1 || manifest.vaultBindingId !== this.options.vaultBindingId) {
      throw new Error("Drive vault manifest does not match this vault binding");
    }
    if (!manifest.revisionId || !/^[0-9a-f]{40}$/.test(manifest.commitSha) || manifest.revisionId === manifest.commitSha) {
      throw new Error("Drive vault manifest provenance is invalid");
    }
    manifest.tombstones ??= {};
    this.manifestFile = file;
    this.manifest = manifest;
  }

  private async configureGit(): Promise<void> {
    this.git = simpleGit(this.path);
    await this.git.addConfig("user.name", this.options.authorName ?? "zenod-bot");
    await this.git.addConfig("user.email", this.options.authorEmail ?? "bot@zenod.dev");
    const remotes = await this.git.getRemotes();
    if (remotes.length) throw new Error("Drive vault local Git repository must not have a remote");
  }

  private async createBundle(): Promise<Buffer> {
    const bundlePath = join(this.stateDir, `bundle-${this.idFactory()}.bundle`);
    try {
      await this.git.raw(["bundle", "create", bundlePath, "--all"]);
      await this.git.raw(["bundle", "verify", bundlePath]);
      return await readFile(bundlePath);
    } finally {
      await rm(bundlePath, { force: true });
    }
  }

  private async materializeFromAuthority(): Promise<void> {
    const localHead = await access(join(this.path, ".git"))
      .then(async () => simpleGit(this.path).revparse(["HEAD"]).then((value) => value.trim()).catch(() => null))
      .catch(() => null);
    if (localHead === this.manifest.commitSha) {
      await this.configureGit();
      return;
    }
    const bundleData = await this.options.client.download(this.manifest.bundle.fileId);
    if (sha256(bundleData) !== this.manifest.bundle.checksum) throw new Error("Drive Git bundle checksum mismatch");
    const bundlePath = join(this.stateDir, `restore-${this.idFactory()}.bundle`);
    const restored = join(this.stateDir, `restore-${this.idFactory()}`);
    try {
      await writeFile(bundlePath, bundleData);
      await simpleGit().raw(["bundle", "verify", bundlePath]);
      await rm(restored, { recursive: true, force: true });
      await simpleGit().clone(bundlePath, restored);
      const restoredGit = simpleGit(restored);
      const head = (await restoredGit.revparse(["HEAD"])).trim();
      if (head !== this.manifest.commitSha) throw new Error("Drive Git bundle HEAD does not match manifest");
      await rm(this.path, { recursive: true, force: true });
      await mkdir(dirname(this.path), { recursive: true });
      await restoredGit.removeRemote("origin");
      await rm(this.path, { recursive: true, force: true });
      await rename(restored, this.path);
      await this.configureGit();
    } finally {
      await rm(bundlePath, { force: true });
      await rm(restored, { recursive: true, force: true });
    }
  }

  private async remoteSnapshot(): Promise<Record<string, { file: DriveVaultFile; data: Buffer }>> {
    const output: Record<string, { file: DriveVaultFile; data: Buffer }> = {};
    const walk = async (folderId: string, prefix: string): Promise<void> => {
      for (const file of await this.listChildren(folderId)) {
        if (!prefix && (file.name === GIT_FOLDER || file.name === CONTROL_FOLDER)) continue;
        const path = prefix ? `${prefix}/${file.name}` : file.name;
        if (file.mimeType === FOLDER_MIME) await walk(file.id, path);
        else output[normalizePath(path)] = { file, data: await this.options.client.download(file.id) };
      }
    };
    await walk(this.rootFolderId, "");
    return output;
  }

  private async importExternalEdits(): Promise<void> {
    const snapshot = await this.remoteSnapshot();
    const paths = new Set([...Object.keys(snapshot), ...Object.keys(this.manifest.files)]);
    let changed = false;
    const changes: FileChange[] = [];
    for (const path of paths) {
      const remote = snapshot[path];
      const expected = this.manifest.files[path];
      if (!remote && expected) {
        changes.push({ path, before: await readFile(join(this.path, path), "utf8").catch(() => null), after: null });
        await rm(join(this.path, path), { force: true });
        changed = true;
      } else if (remote && (!expected || sha256(remote.data) !== expected.checksum)) {
        changes.push({
          path,
          before: await readFile(join(this.path, path), "utf8").catch(() => null),
          after: remote.data.toString("utf8"),
        });
        await mkdir(dirname(join(this.path, path)), { recursive: true });
        await writeFile(join(this.path, path), remote.data);
        changed = true;
      } else if (remote && expected) {
        const local = await readFile(join(this.path, path)).catch(() => null);
        if (!local || sha256(local) !== expected.checksum) {
          throw new Error(`Drive Git bundle tree does not match ordinary file ${path}`);
        }
      }
    }
    if (!changed) return;
    const immutability = checkEvidenceImmutability(changes);
    if (immutability.length) {
      await this.git.reset(["--hard", "HEAD"]);
      throw new VaultPublicationError({
        code: "conflict",
        message: `External Drive edits violate evidence immutability: ${immutability.map((error) => `${error.path}: ${error.message}`).join("; ")}`,
        retryable: false,
        transactionId: this.idFactory(),
        paths: [...new Set(immutability.map((error) => error.path))],
      });
    }
    await this.git.add(["-A"]);
    await this.git.commit("Import external Google Drive edits");
    const commitSha = (await this.git.revparse(["HEAD"])).trim();
    const bundleData = await this.createBundle();
    const files: Record<string, ManifestFile> = {};
    for (const [path, remote] of Object.entries(snapshot)) {
      files[path] = this.manifestEntry(remote.file, sha256(remote.data));
    }
    const transactionId = this.idFactory();
    const createdAt = this.now().toISOString();
    const mutation = this.mutation("update", `${GIT_FOLDER}/${BUNDLE_NAME}`, transactionId, this.manifest.bundle, bundleData);
    const manifestMutation = this.mutation(
      "update",
      `${CONTROL_FOLDER}/${MANIFEST_NAME}`,
      transactionId,
      this.manifestEntry(this.manifestFile, sha256(Buffer.from(JSON.stringify(this.manifest, null, 2)))),
    );
    const journal: DriveJournal = {
      schemaVersion: 1,
      transactionId,
      tenantId: this.options.tenantId,
      vaultBindingId: this.options.vaultBindingId,
      intentDigest: sha256(JSON.stringify({ base: this.manifest.revisionId, commitSha, files })),
      message: "Import external Google Drive edits",
      state: "prepared",
      baseRevisionId: this.manifest.revisionId,
      targetCommitSha: commitSha,
      mutations: [mutation, manifestMutation],
      replacementFiles: files,
      createdAt,
      updatedAt: createdAt,
    };
    await this.writeLocalJournal(journal);
    const journalFile = await this.createRemoteJournal(journal);
    await this.applyJournal(journal, journalFile, this.manifest);
    await rm(this.localJournalPath(transactionId), { force: true });
  }

  async pull(): Promise<void> {
    await this.recoverTransactions();
    const manifestFile = await this.options.client.getFile(this.manifestFile.id);
    await this.loadManifest(manifestFile);
    await this.materializeFromAuthority();
    await this.importExternalEdits();
  }

  async currentRevision(): Promise<VaultRevision> {
    const manifestFile = await this.options.client.getFile(this.manifestFile.id);
    await this.loadManifest(manifestFile);
    const bundle = await this.options.client.download(this.manifest.bundle.fileId);
    if (sha256(bundle) !== this.manifest.bundle.checksum) throw new Error("Drive Git bundle checksum mismatch");
    await this.verifyBundleData(bundle, this.manifest.commitSha);
    const localHead = (await this.git.revparse(["HEAD"])).trim();
    if (localHead !== this.manifest.commitSha) await this.materializeFromAuthority();
    return this.revision([]);
  }

  async trackedFiles(): Promise<string[]> {
    const output = await this.git.raw(["ls-files"]);
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  async contentAtHead(path: string): Promise<string | null> {
    try { return await this.git.show([`HEAD:${normalizePath(path)}`]); }
    catch { return null; }
  }

  async pendingChanges(): Promise<FileChange[]> {
    const status = await this.git.status();
    const changes: FileChange[] = [];
    const add = async (path: string, deleted: boolean) => {
      const normalized = normalizePath(path);
      const before = await this.contentAtHead(normalized);
      const after = deleted ? null : await readFile(join(this.path, normalized), "utf8").catch(() => null);
      changes.push({ path: normalized, before, after });
    };
    for (const path of [...status.modified, ...status.created, ...status.not_added]) await add(path, false);
    for (const path of status.deleted) await add(path, true);
    return changes;
  }

  async discardChanges(): Promise<void> {
    await this.recoverTransactions();
    await this.git.reset(["--hard", "HEAD"]);
    await this.git.clean("f", ["-d"]);
  }

  async commitAndPublish(message: string): Promise<VaultRevision> {
    const status = await this.git.status();
    const changedPaths = [...new Set([...status.modified, ...status.created, ...status.not_added, ...status.deleted])].map(normalizePath);
    if (!changedPaths.length) throw new VaultPublicationError({ code: "failed_before_write", message: "no vault changes to publish", retryable: false });
    const immutability = checkEvidenceImmutability(await this.pendingChanges());
    if (immutability.length) {
      throw new VaultPublicationError({
        code: "failed_before_write",
        message: immutability.map((error) => `${error.path}: ${error.message}`).join("; "),
        retryable: false,
      });
    }
    await this.assertRemoteBase(changedPaths);
    const baseManifest = structuredClone(this.manifest);
    await this.git.add(["-A"]);
    await this.git.commit(message);
    const targetCommitSha = (await this.git.revparse(["HEAD"])).trim();
    const bundleData = await this.createBundle();
    const transactionId = this.idFactory();
    const now = this.now().toISOString();
    const mutations = await this.planMutations(changedPaths, bundleData, transactionId);
    const journal: DriveJournal = {
      schemaVersion: 1,
      transactionId,
      tenantId: this.options.tenantId,
      vaultBindingId: this.options.vaultBindingId,
      intentDigest: sha256(JSON.stringify({ base: baseManifest.revisionId, targetCommitSha, mutations: mutations.map(({ contentBase64: _, ...mutation }) => mutation) })),
      message,
      state: "prepared",
      baseRevisionId: baseManifest.revisionId,
      targetCommitSha,
      mutations,
      createdAt: now,
      updatedAt: now,
    };
    await this.writeLocalJournal(journal);
    let journalFile: DriveVaultFile | null = null;
    try {
      journalFile = await this.createRemoteJournal(journal);
      const revision = await this.applyJournal(journal, journalFile, baseManifest);
      await rm(this.localJournalPath(transactionId), { force: true });
      return revision;
    } catch (error) {
      if (error instanceof VaultPublicationError) throw error;
      if (isAuthorization(error)) {
        throw new VaultPublicationError({ code: "authorization_revoked", message: (error as Error).message, retryable: false });
      }
      const applied = journal.mutations.filter((mutation) => mutation.state === "applied").map((mutation) => mutation.path);
      if (!journalFile && !applied.length) {
        await this.git.reset(["--soft", "HEAD^"]);
        throw new VaultPublicationError({ code: "failed_before_write", message: (error as Error).message, retryable: true });
      }
      throw new VaultPublicationError({
        code: "partial_recovering",
        message: `Drive publication ${transactionId} requires recovery: ${(error as Error).message}`,
        retryable: true,
        transactionId,
        appliedPaths: applied,
        pendingPaths: journal.mutations.filter((mutation) => mutation.state !== "applied").map((mutation) => mutation.path),
      });
    }
  }

  private async assertRemoteBase(paths: string[]): Promise<void> {
    const conflicts: string[] = [];
    for (const path of paths) {
      const expected = this.manifest.files[path];
      if (!expected) continue;
      try {
        const current = await this.options.client.getFile(expected.fileId);
        if (!samePrecondition(current, {
          operationId: "preflight", kind: "update", path, state: "pending",
          ...(expected.version ? { expectedVersion: expected.version } : {}),
          ...(expected.modifiedTime ? { expectedModifiedTime: expected.modifiedTime } : {}),
          expectedChecksum: expected.checksum,
        }) || sha256(await this.options.client.download(expected.fileId)) !== expected.checksum) conflicts.push(path);
      } catch (error) {
        if (isAuthorization(error)) throw error;
        conflicts.push(path);
      }
    }
    if (conflicts.length) throw new VaultPublicationError({
      code: "conflict", message: `Drive files changed externally: ${conflicts.join(", ")}`,
      retryable: false, transactionId: this.idFactory(), paths: conflicts,
    });
  }

  private async planMutations(paths: string[], bundleData: Buffer, transactionId: string): Promise<JournalMutation[]> {
    const mutations: JournalMutation[] = [];
    const deleted = paths.filter((path) => this.manifest.files[path] && !this.fileExists(path));
    const created = paths.filter((path) => !this.manifest.files[path] && this.fileExists(path));
    const createdChecksums = new Map<string, string>();
    for (const path of created) createdChecksums.set(path, sha256(await readFile(join(this.path, path))));
    const deletedChecksumCounts = new Map<string, number>();
    for (const path of deleted) {
      const checksum = this.manifest.files[path]!.checksum;
      deletedChecksumCounts.set(checksum, (deletedChecksumCounts.get(checksum) ?? 0) + 1);
    }
    const usedCreated = new Set<string>();
    for (const from of deleted) {
      const old = this.manifest.files[from]!;
      const matches = created.filter((path) => !usedCreated.has(path) && createdChecksums.get(path) === old.checksum);
      const match = deletedChecksumCounts.get(old.checksum) === 1 && matches.length === 1 ? matches[0]! : null;
      if (match) {
        usedCreated.add(match);
        mutations.push(this.mutation("move", from, transactionId, old, undefined, match));
      } else mutations.push(this.mutation("delete", from, transactionId, old));
    }
    for (const path of paths) {
      if (deleted.includes(path) || usedCreated.has(path)) continue;
      const data = await readFile(join(this.path, path));
      const existing = this.manifest.files[path];
      mutations.push(this.mutation(existing ? "update" : "create", path, transactionId, existing, data));
    }
    mutations.push(this.mutation("update", `${GIT_FOLDER}/${BUNDLE_NAME}`, transactionId, this.manifest.bundle, bundleData));
    mutations.push(this.mutation(
      "update",
      `${CONTROL_FOLDER}/${MANIFEST_NAME}`,
      transactionId,
      this.manifestEntry(this.manifestFile, sha256(Buffer.from(JSON.stringify(this.manifest, null, 2)))),
    ));
    return mutations;
  }

  private fileExists(path: string): boolean {
    return existsSync(join(this.path, path));
  }

  private mutation(kind: MutationKind, path: string, transactionId: string, existing?: ManifestFile, data?: Buffer, destinationPath?: string): JournalMutation {
    return {
      operationId: sha256(`${transactionId}:${kind}:${path}:${destinationPath ?? ""}`).slice(0, 32),
      kind, path, ...(destinationPath ? { destinationPath } : {}),
      ...(existing ? { fileId: existing.fileId, expectedVersion: existing.version, expectedModifiedTime: existing.modifiedTime, expectedChecksum: existing.checksum } : {}),
      ...(data ? { contentBase64: data.toString("base64"), checksum: sha256(data), mimeType: mimeFor(path), parentPath: posix.dirname(path) === "." ? "" : posix.dirname(path) } : {}),
      state: "pending",
    };
  }

  private async applyJournal(journal: DriveJournal, journalFile: DriveVaultFile, baseManifest: DriveVaultManifest): Promise<VaultRevision> {
    journal.state = "applying";
    await this.updateRemoteJournal(journalFile, journal);
    const manifestMutation = journal.mutations.find((mutation) => mutation.path === `${CONTROL_FOLDER}/${MANIFEST_NAME}`);
    for (const mutation of journal.mutations.filter((entry) => entry !== manifestMutation)) {
      if (mutation.state === "applied") continue;
      try {
        mutation.resultingFile = await this.applyMutation(mutation, journal, journalFile);
        mutation.state = "applied";
      } catch (error) {
        if (error instanceof VaultPublicationError) throw error;
        if (isAuthorization(error)) throw error;
        if (!/conflict/i.test((error as Error).message)) {
          journal.state = journal.mutations.some((entry) => entry.state === "applied") ? "recovering" : "applying";
          journal.updatedAt = this.now().toISOString();
          await this.writeLocalJournal(journal);
          throw error;
        }
        mutation.state = "conflict";
        const partiallyApplied = journal.mutations.some((entry) => entry.state === "applied");
        journal.state = partiallyApplied ? "recovering" : "conflict";
        journal.updatedAt = this.now().toISOString();
        await this.updateRemoteJournal(journalFile, journal).catch(() => {});
        if (partiallyApplied) {
          throw new VaultPublicationError({
            code: "partial_recovering",
            message: `Drive publication ${journal.transactionId} partially applied before a conflict at ${mutation.path}`,
            retryable: true,
            transactionId: journal.transactionId,
            appliedPaths: journal.mutations.filter((entry) => entry.state === "applied").map((entry) => entry.path),
            pendingPaths: journal.mutations.filter((entry) => entry.state !== "applied").map((entry) => entry.path),
          });
        }
        throw new VaultPublicationError({ code: "conflict", message: (error as Error).message, retryable: false, transactionId: journal.transactionId, paths: [mutation.path] });
      }
      journal.updatedAt = this.now().toISOString();
      await this.writeLocalJournal(journal);
      await this.updateRemoteJournal(journalFile, journal);
    }
    const nextManifest = this.finalManifest(journal, baseManifest);
    journal.manifest = nextManifest;
    journal.updatedAt = this.now().toISOString();
    await this.updateRemoteJournal(journalFile, journal);
    const manifestData = Buffer.from(JSON.stringify(nextManifest, null, 2));
    if (!manifestMutation) throw new Error(`Drive transaction ${journal.transactionId} has no manifest finalization mutation`);
    manifestMutation.contentBase64 = manifestData.toString("base64");
    manifestMutation.checksum = sha256(manifestData);
    manifestMutation.mimeType = "application/json";
    manifestMutation.resultingFile = await this.applyMutation(manifestMutation, journal, journalFile);
    manifestMutation.state = "applied";
    this.manifestFile = manifestMutation.resultingFile;
    journal.updatedAt = this.now().toISOString();
    await this.writeLocalJournal(journal);
    await this.updateRemoteJournal(journalFile, journal);
    const verified = JSON.parse((await this.options.client.download(this.manifestFile.id)).toString("utf8")) as DriveVaultManifest;
    if (verified.revisionId !== nextManifest.revisionId || verified.commitSha !== journal.targetCommitSha) throw new Error("Drive manifest finalization verification failed");
    const bundle = await this.options.client.download(nextManifest.bundle.fileId);
    if (sha256(bundle) !== nextManifest.bundle.checksum) throw new Error("Drive bundle finalization verification failed");
    await this.verifyBundleData(bundle, nextManifest.commitSha);
    journal.state = "committed";
    journal.committedAt = nextManifest.committedAt;
    journal.updatedAt = this.now().toISOString();
    await this.updateRemoteJournal(journalFile, journal);
    this.manifest = nextManifest;
    return this.revision(Object.keys(nextManifest.files).filter((path) => journal.mutations.some((mutation) => mutation.path === path || mutation.destinationPath === path)));
  }

  private async applyMutation(mutation: JournalMutation, journal: DriveJournal, journalFile: DriveVaultFile): Promise<DriveVaultFile> {
    if (mutation.kind === "create") {
      const parentId = await this.ensurePath(mutation.parentPath ?? "");
      const existing = (await this.listChildren(parentId)).find((file) => file.appProperties?.[OPERATION_PROPERTY] === mutation.operationId);
      if (existing) return existing;
      const sameName = (await this.listChildren(parentId)).find((file) => file.name === posix.basename(mutation.path));
      if (sameName) throw new Error(`Drive create conflict at ${mutation.path}`);
      try {
        return await this.options.client.uploadFile(posix.basename(mutation.path), mutation.mimeType!, Buffer.from(mutation.contentBase64!, "base64"), parentId, { appProperties: { [OPERATION_PROPERTY]: mutation.operationId } });
      } catch (error) {
        const recovered = (await this.listChildren(parentId)).find((file) => file.appProperties?.[OPERATION_PROPERTY] === mutation.operationId);
        if (recovered) return recovered;
        throw error;
      }
    }
    if (mutation.kind === "delete") {
      const current = await this.options.client.getFile(mutation.fileId!);
      const archivedName = `${mutation.operationId}-${posix.basename(mutation.path)}`;
      if (current.parents?.includes(this.deletedFolderId) && current.name === archivedName) return current;
      const content = await this.options.client.download(mutation.fileId!);
      if (!samePrecondition(current, mutation) || sha256(content) !== mutation.expectedChecksum) {
        throw new Error(`Drive delete conflict at ${mutation.path}`);
      }
      mutation.baselineRevisionIds = (await this.options.client.listRevisions(mutation.fileId!)).map((revision) => revision.id);
      await this.options.client.moveFile(
        mutation.fileId!,
        this.deletedFolderId,
        this.precondition(mutation),
        archivedName,
      );
      const archived = await this.options.client.getFile(mutation.fileId!);
      if (!this.isExpectedSingleAdvance(mutation, archived) || !await this.remoteContentMatches(archived, mutation.expectedChecksum!)) {
        await this.captureInterleavingConflict(mutation, journal, journalFile, content, archived);
      }
      return archived;
    }
    if (mutation.kind === "move") {
      const destinationParentId = await this.ensurePath(posix.dirname(mutation.destinationPath!) === "." ? "" : posix.dirname(mutation.destinationPath!));
      const current = await this.options.client.getFile(mutation.fileId!);
      if (current.parents?.includes(destinationParentId) && current.name === posix.basename(mutation.destinationPath!)) return current;
      const content = await this.options.client.download(mutation.fileId!);
      if (!samePrecondition(current, mutation) || sha256(content) !== mutation.expectedChecksum) throw new Error(`Drive move conflict at ${mutation.path}`);
      mutation.baselineRevisionIds = (await this.options.client.listRevisions(mutation.fileId!)).map((revision) => revision.id);
      const moved = await this.options.client.moveFile(mutation.fileId!, destinationParentId, this.precondition(mutation), posix.basename(mutation.destinationPath!));
      const post = moved ?? await this.options.client.getFile(mutation.fileId!);
      const verified = await this.options.client.getFile(mutation.fileId!);
      if (!this.isExpectedSingleAdvance(mutation, verified) || !await this.remoteContentMatches(verified, mutation.expectedChecksum!)) {
        await this.captureInterleavingConflict(mutation, journal, journalFile, content, verified);
      }
      return post;
    }
    const data = Buffer.from(mutation.contentBase64!, "base64");
    const current = await this.options.client.getFile(mutation.fileId!);
    if (await this.remoteContentMatches(current, mutation.checksum!)) return current;
    if (!samePrecondition(current, mutation)) throw new Error(`Drive update conflict at ${mutation.path}`);
    const revisionsBefore = await this.options.client.listRevisions(mutation.fileId!);
    mutation.baselineRevisionIds = revisionsBefore.map((revision) => revision.id);
    try {
      const updated = await this.options.client.updateFile(mutation.fileId!, mutation.mimeType!, data, this.precondition(mutation));
      const post = await this.options.client.getFile(mutation.fileId!);
      const postChecksum = sha256(await this.options.client.download(mutation.fileId!));
      const expectedAdvance = this.isExpectedSingleAdvance(mutation, post) && post.version === updated.version;
      if (!expectedAdvance || postChecksum !== mutation.checksum) {
        await this.captureInterleavingConflict(mutation, journal, journalFile, data, post);
      }
      return post;
    } catch (error) {
      if (error instanceof VaultPublicationError) throw error;
      const recovered = await this.options.client.getFile(mutation.fileId!).catch(() => null);
      if (recovered && await this.remoteContentMatches(recovered, mutation.checksum!)) {
        const expectedAdvance = this.isExpectedSingleAdvance(mutation, recovered);
        if (!expectedAdvance) await this.captureInterleavingConflict(mutation, journal, journalFile, data, recovered);
        return recovered;
      }
      throw error;
    }
  }

  private isExpectedSingleAdvance(mutation: JournalMutation, post: DriveVaultFile): boolean {
    if (mutation.expectedVersion && /^\d+$/.test(mutation.expectedVersion) && /^\d+$/.test(post.version ?? "")) {
      return BigInt(post.version!) === BigInt(mutation.expectedVersion) + 1n;
    }
    return Boolean(post.version);
  }

  private async captureInterleavingConflict(
    mutation: JournalMutation,
    journal: DriveJournal,
    journalFile: DriveVaultFile,
    desired: Buffer,
    post: DriveVaultFile,
  ): Promise<never> {
    const baseline = new Set(mutation.baselineRevisionIds ?? []);
    const desiredMd5 = createHash("md5").update(desired).digest("hex");
    const revisions = await this.options.client.listRevisions(mutation.fileId!);
    mutation.conflictRevisions = revisions
      .filter((revision) => !baseline.has(revision.id) && revision.md5Checksum !== desiredMd5)
      .map((revision) => ({ ...revision }));
    if (post.headRevisionId && !mutation.conflictRevisions.some((revision) => revision.id === post.headRevisionId)) {
      const postContent = await this.options.client.download(post.id);
      if (sha256(postContent) !== mutation.checksum) {
        mutation.conflictRevisions.push({
          id: post.headRevisionId,
          ...(post.modifiedTime ? { modifiedTime: post.modifiedTime } : {}),
          checksum: sha256(postContent),
          contentBase64: postContent.toString("base64"),
        });
      }
    }
    mutation.state = "conflict";
    const partiallyApplied = journal.mutations.some((entry) => entry !== mutation && entry.state === "applied");
    journal.state = partiallyApplied ? "recovering" : "conflict";
    journal.updatedAt = this.now().toISOString();
    await this.writeLocalJournal(journal);
    await this.updateRemoteJournal(journalFile, journal);
    await this.preserveConflictRevisions(mutation);
    journal.updatedAt = this.now().toISOString();
    await this.writeLocalJournal(journal);
    await this.updateRemoteJournal(journalFile, journal);
    if (!mutation.conflictRevisions.length) {
      mutation.state = "failed";
      journal.state = "failed";
      journal.updatedAt = this.now().toISOString();
      await this.writeLocalJournal(journal);
      await this.updateRemoteJournal(journalFile, journal);
      throw new VaultPublicationError({
        code: "terminal_failure",
        message: `Drive interleaving at ${mutation.path} could not be identified in blob revision history`,
        retryable: false,
        transactionId: journal.transactionId,
        appliedPaths: journal.mutations.filter((entry) => entry.state === "applied").map((entry) => entry.path),
      });
    }
    if (partiallyApplied) {
      throw new VaultPublicationError({
        code: "partial_recovering",
        message: `Drive publication ${journal.transactionId} preserved an interleaving edit at ${mutation.path}`,
        retryable: true,
        transactionId: journal.transactionId,
        appliedPaths: journal.mutations.filter((entry) => entry.state === "applied").map((entry) => entry.path),
        pendingPaths: journal.mutations.filter((entry) => entry.state !== "applied").map((entry) => entry.path),
      });
    }
    throw new VaultPublicationError({
      code: "conflict",
      message: `Drive interleaving edit preserved at ${mutation.path}`,
      retryable: false,
      transactionId: journal.transactionId,
      paths: [mutation.path],
    });
  }

  private async preserveConflictRevisions(mutation: JournalMutation): Promise<void> {
    const fileId = mutation.fileId!;
    const current = await this.options.client.getFile(fileId);
    for (const revision of mutation.conflictRevisions ?? []) {
      if (!revision.contentBase64) {
        if (revision.id === current.headRevisionId) {
          revision.contentBase64 = (await this.options.client.download(fileId)).toString("base64");
        } else {
          await this.options.client.keepRevision(fileId, revision.id);
          revision.keepForever = true;
          revision.contentBase64 = (await this.options.client.downloadRevision(fileId, revision.id)).toString("base64");
        }
      }
      const data = Buffer.from(revision.contentBase64, "base64");
      revision.checksum = sha256(data);
      const conflictPath = join(this.stateDir, "conflicts", mutation.operationId, `${revision.id}-${posix.basename(mutation.path)}`);
      await mkdir(dirname(conflictPath), { recursive: true });
      await writeFile(conflictPath, data);
    }
  }

  private async remoteContentMatches(file: DriveVaultFile, checksum: string): Promise<boolean> {
    return sha256(await this.options.client.download(file.id)) === checksum;
  }

  private precondition(mutation: JournalMutation): DriveVaultPrecondition {
    return {
      ...(mutation.expectedVersion ? { expectedVersion: mutation.expectedVersion } : {}),
      ...(mutation.expectedModifiedTime ? { expectedModifiedTime: mutation.expectedModifiedTime } : {}),
      ...(mutation.expectedChecksum ? { expectedChecksum: mutation.expectedChecksum } : {}),
    };
  }

  private finalManifest(journal: DriveJournal, base: DriveVaultManifest): DriveVaultManifest {
    const files = structuredClone(journal.replacementFiles ?? base.files);
    const tombstones = structuredClone(base.tombstones ?? {});
    let bundle = base.bundle;
    for (const mutation of journal.mutations) {
      if (mutation.path === `${GIT_FOLDER}/${BUNDLE_NAME}`) {
        bundle = this.manifestEntry(mutation.resultingFile!, mutation.checksum!);
      } else if (mutation.path === `${CONTROL_FOLDER}/${MANIFEST_NAME}`) {
        continue;
      } else if (mutation.kind === "delete") {
        const previous = files[mutation.path]!;
        delete files[mutation.path];
        const archivedName = mutation.resultingFile?.name ?? `${mutation.operationId}-${posix.basename(mutation.path)}`;
        tombstones[mutation.path] = [
          ...(tombstones[mutation.path] ?? []),
          {
            fileId: mutation.fileId!,
            archivedName,
            checksum: previous.checksum,
            transactionId: journal.transactionId,
            deletedAt: this.now().toISOString(),
          },
        ];
      }
      else if (mutation.kind === "move") {
        const previous = files[mutation.path]!;
        delete files[mutation.path];
        files[mutation.destinationPath!] = { ...previous, ...this.manifestEntry(mutation.resultingFile!, previous.checksum) };
      } else files[mutation.path] = this.manifestEntry(mutation.resultingFile!, mutation.checksum!);
    }
    return {
      schemaVersion: 1,
      vaultBindingId: this.options.vaultBindingId,
      revisionId: journal.transactionId,
      committedAt: this.now().toISOString(),
      commitSha: journal.targetCommitSha,
      bundle,
      files,
      tombstones,
    };
  }

  private manifestEntry(file: DriveVaultFile, checksum: string): ManifestFile {
    return {
      fileId: file.id, mimeType: file.mimeType, checksum,
      ...(file.version ? { version: file.version } : {}),
      ...(file.modifiedTime ? { modifiedTime: file.modifiedTime } : {}),
      ...(file.webViewLink ? { webViewLink: file.webViewLink } : {}),
      ...(file.headRevisionId ? { headRevisionId: file.headRevisionId } : {}),
    };
  }

  private async ensurePath(path: string): Promise<string> {
    let parent = this.rootFolderId;
    if (!path) return parent;
    for (const part of path.split("/")) parent = await this.options.client.ensureFolder(part, parent);
    return parent;
  }

  private async createRemoteJournal(journal: DriveJournal): Promise<DriveVaultFile> {
    const name = `${journal.transactionId}.json`;
    const operationId = `journal-${journal.transactionId}`;
    const existing = (await this.listChildren(this.transactionsFolderId)).find((file) => file.appProperties?.[OPERATION_PROPERTY] === operationId);
    if (existing) return existing;
    try {
      return await this.options.client.uploadFile(name, "application/json", Buffer.from(JSON.stringify(journal, null, 2)), this.transactionsFolderId, { appProperties: { [OPERATION_PROPERTY]: operationId } });
    } catch (error) {
      const recovered = (await this.listChildren(this.transactionsFolderId)).find((file) => file.appProperties?.[OPERATION_PROPERTY] === operationId);
      if (recovered) return recovered;
      throw error;
    }
  }

  private async updateRemoteJournal(file: DriveVaultFile, journal: DriveJournal): Promise<void> {
    this.assertJournalContract(journal);
    const data = Buffer.from(JSON.stringify(journal, null, 2));
    const current = await this.options.client.getFile(file.id);
    if (sha256(await this.options.client.download(file.id)) === sha256(data)) return;
    const updated = await this.options.client.updateFile(file.id, "application/json", data, {
      ...(current.version ? { expectedVersion: current.version } : {}),
      ...(current.modifiedTime ? { expectedModifiedTime: current.modifiedTime } : {}),
      expectedChecksum: sha256(await this.options.client.download(file.id)),
    });
    Object.assign(file, updated);
  }

  private localJournalPath(transactionId: string): string {
    return join(this.stateDir, "transactions", `${transactionId}.json`);
  }

  private async writeLocalJournal(journal: DriveJournal): Promise<void> {
    this.assertJournalContract(journal);
    const path = this.localJournalPath(journal.transactionId);
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(journal, null, 2));
    await rename(temporary, path);
  }

  private assertJournalContract(journal: DriveJournal): void {
    const contract: DriveVaultTransaction = {
      schemaVersion: 1,
      transactionId: journal.transactionId,
      tenantId: journal.tenantId,
      vaultBindingId: journal.vaultBindingId,
      idempotencyKey: journal.transactionId,
      intentDigest: journal.intentDigest,
      baseManifestVersion: journal.baseRevisionId,
      state: journal.state,
      mutations: journal.mutations.map((mutation) => ({
        operationId: mutation.operationId,
        kind: mutation.kind,
        path: mutation.path,
        ...(mutation.destinationPath ? { destinationPath: mutation.destinationPath } : {}),
        precondition: mutation.kind === "create"
          ? { mustNotExist: true }
          : {
              fileId: mutation.fileId!,
              ...(mutation.expectedVersion ? { expectedVersion: mutation.expectedVersion } : {}),
              ...(mutation.expectedModifiedTime ? { expectedModifiedTime: mutation.expectedModifiedTime } : {}),
              ...(mutation.expectedChecksum ? { expectedChecksum: mutation.expectedChecksum } : {}),
            },
        state: mutation.state,
        ...(mutation.resultingFile?.id ? { resultingFileId: mutation.resultingFile.id } : {}),
        ...(mutation.resultingFile?.version ? { resultingVersion: mutation.resultingFile.version } : {}),
      })),
      createdAt: journal.createdAt,
      updatedAt: journal.updatedAt,
      ...(journal.committedAt ? { committedAt: journal.committedAt } : {}),
      ...(journal.state === "conflict" ? { conflictPaths: journal.mutations.filter((mutation) => mutation.state === "conflict").map((mutation) => mutation.path) } : {}),
      ...(journal.state === "failed" ? { terminalErrorCode: "drive_transaction_failed" } : {}),
    };
    assertDriveTransactionInvariant(contract);
  }

  private async recoverTransactions(): Promise<void> {
    const remote = await this.options.client.listFiles({ folderId: this.transactionsFolderId, pageSize: 1000, allPages: true });
    for (const file of remote.filter((candidate) => candidate.name.endsWith(".json"))) {
      const journal = JSON.parse((await this.options.client.download(file.id)).toString("utf8")) as DriveJournal;
      if (journal.vaultBindingId !== this.options.vaultBindingId || journal.tenantId !== this.options.tenantId || journal.state === "committed" || journal.state === "failed") continue;
      const conflicts = journal.mutations.filter((mutation) => mutation.state === "conflict");
      if (conflicts.length) {
        for (const mutation of conflicts) await this.preserveConflictRevisions(mutation);
        if (journal.state === "conflict") {
          throw new VaultPublicationError({ code: "conflict", message: `Drive transaction ${journal.transactionId} requires reconciliation`, retryable: false, transactionId: journal.transactionId, paths: conflicts.map((mutation) => mutation.path) });
        }
        throw new VaultPublicationError({
          code: "partial_recovering", message: `Drive transaction ${journal.transactionId} preserved a concurrent edit and requires reconciliation`, retryable: true,
          transactionId: journal.transactionId,
          appliedPaths: journal.mutations.filter((mutation) => mutation.state === "applied").map((mutation) => mutation.path),
          pendingPaths: journal.mutations.filter((mutation) => mutation.state !== "applied").map((mutation) => mutation.path),
        });
      }
      const manifestFile = await this.findNamedFile(this.controlFolderId, MANIFEST_NAME);
      if (!manifestFile) continue;
      await this.loadManifest(manifestFile);
      if (this.manifest.revisionId === journal.transactionId && this.manifest.commitSha === journal.targetCommitSha) {
        for (const mutation of journal.mutations) {
          mutation.state = "applied";
          if (mutation.path === `${CONTROL_FOLDER}/${MANIFEST_NAME}`) mutation.resultingFile = manifestFile;
        }
        journal.state = "committed";
        journal.committedAt = this.manifest.committedAt;
        journal.updatedAt = this.now().toISOString();
        await this.updateRemoteJournal(file, journal);
        continue;
      }
      if (this.manifest.revisionId !== journal.baseRevisionId) {
        journal.state = "conflict";
        journal.updatedAt = this.now().toISOString();
        await this.updateRemoteJournal(file, journal);
        continue;
      }
      const bundleMutation = journal.mutations.find((mutation) => mutation.path === `${GIT_FOLDER}/${BUNDLE_NAME}`);
      if (!bundleMutation) throw new Error(`Drive transaction ${journal.transactionId} has no bundle payload`);
      const bundlePath = join(this.stateDir, `recovery-${journal.transactionId}.bundle`);
      await writeFile(bundlePath, Buffer.from(bundleMutation.contentBase64!, "base64"));
      const hasLocalGit = await access(join(this.path, ".git")).then(() => true).catch(() => false);
      if (hasLocalGit) {
        await this.configureGit();
        const localHead = (await this.git.revparse(["HEAD"])).trim();
        if (localHead !== journal.targetCommitSha) {
          await this.git.raw(["fetch", bundlePath, "refs/heads/main:refs/heads/recovery"]);
          await this.git.reset(["--hard", journal.targetCommitSha]);
        }
      } else {
        await rm(this.path, { recursive: true, force: true });
        await simpleGit().clone(bundlePath, this.path);
        this.git = simpleGit(this.path);
        await this.git.removeRemote("origin");
        await this.configureGit();
      }
      await rm(bundlePath, { force: true });
      journal.state = "recovering";
      await this.applyJournal(journal, file, this.manifest);
      await rm(this.localJournalPath(journal.transactionId), { force: true });
    }
  }

  private revision(paths: string[]): VaultRevision {
    return {
      provider: "google_drive",
      id: this.manifest.revisionId,
      committedAt: this.manifest.committedAt,
      commitSha: this.manifest.commitSha,
      urls: paths.map((path) => this.urlFor(path)).filter((url): url is string => Boolean(url)),
    };
  }

  private async verifyBundleData(data: Buffer, expectedHead: string): Promise<void> {
    const bundlePath = join(this.stateDir, `verify-${this.idFactory()}.bundle`);
    try {
      await writeFile(bundlePath, data);
      await this.git.raw(["bundle", "verify", bundlePath]);
      const heads = await this.git.raw(["bundle", "list-heads", bundlePath]);
      if (!heads.split("\n").some((line) => line.startsWith(`${expectedHead} `))) {
        throw new Error("Drive Git bundle does not contain the manifest commit");
      }
    } finally {
      await rm(bundlePath, { force: true });
    }
  }

  urlFor(path: string, anchor?: string): string | null {
    const entry = this.manifest?.files[normalizePath(path)];
    return entry ? (entry.webViewLink ? `${entry.webViewLink}${anchor ? `#${encodeURIComponent(anchor)}` : ""}` : driveUrl(entry.fileId, anchor)) : null;
  }
}
