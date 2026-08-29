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
const BINDING_PROPERTY = "zenodVaultBinding";
const ROLE_PROPERTY = "zenodVaultRole";
const MANIFEST_ROLE = "manifest";
const BUNDLE_ROLE = "bundle";
const GIT_FOLDER_ROLE = "git-folder";
const CONTROL_FOLDER_ROLE = "control-folder";
const TRANSACTIONS_FOLDER_ROLE = "transactions-folder";
const DELETED_FOLDER_ROLE = "deleted-folder";

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

export interface DriveVaultRootResolution {
  folderId: string;
  created: boolean;
}

/** The bounded DriveClient surface required by the Drive vault adapter. */
export interface DriveVaultClient {
  ensureVaultRootFolder(vaultBindingId: string, storedFolderId?: string | null): Promise<DriveVaultRootResolution>;
  ensureFolder(name: string, parentId: string, options?: { appProperties?: Record<string, string> }): Promise<string>;
  listFiles(options?: {
    folderId?: string;
    nameContains?: string;
    pageSize?: number;
    foldersOnly?: boolean;
    allPages?: boolean;
    appProperties?: Record<string, string>;
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
  bootstrap?: true;
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function operationIdFor(transactionId: string, kind: MutationKind, path: string, destinationPath?: string): string {
  return sha256(`${transactionId}:${kind}:${path}:${destinationPath ?? ""}`).slice(0, 32);
}

function journalIntentDigest(journal: Omit<DriveJournal, "intentDigest"> | DriveJournal): string {
  return sha256(JSON.stringify({
    schemaVersion: journal.schemaVersion,
    transactionId: journal.transactionId,
    tenantId: journal.tenantId,
    vaultBindingId: journal.vaultBindingId,
    message: journal.message,
    baseRevisionId: journal.baseRevisionId,
    targetCommitSha: journal.targetCommitSha,
    bootstrap: journal.bootstrap === true,
    replacementFiles: journal.replacementFiles ?? null,
    mutations: journal.mutations.map((mutation) => ({
      operationId: mutation.operationId,
      kind: mutation.kind,
      path: mutation.path,
      destinationPath: mutation.destinationPath ?? null,
      fileId: mutation.fileId ?? null,
      parentPath: mutation.parentPath ?? null,
      mimeType: mutation.path === `${CONTROL_FOLDER}/${MANIFEST_NAME}` ? null : mutation.mimeType ?? null,
      checksum: mutation.path === `${CONTROL_FOLDER}/${MANIFEST_NAME}` ? null : mutation.checksum ?? null,
      expectedVersion: mutation.expectedVersion ?? null,
      expectedModifiedTime: mutation.expectedModifiedTime ?? null,
      expectedChecksum: mutation.expectedChecksum ?? null,
    })),
  }));
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
    const root = await this.options.client.ensureVaultRootFolder(
      this.options.vaultBindingId,
      this.options.storedRootFolderId,
    );
    this.rootFolderId = root.folderId;
    const recoveredManifest = await this.discoverManifestFile(this.rootFolderId);
    let bootstrap: { file: DriveVaultFile; journal: DriveJournal } | null = null;
    if (recoveredManifest) {
      this.controlFolderId = recoveredManifest.parents?.[0] ?? "";
      if (!this.controlFolderId) throw new Error("Drive vault manifest has no control-folder parent");
      const controlFolder = await this.options.client.getFile(this.controlFolderId);
      const recoveredRootId = controlFolder.parents?.length === 1 ? controlFolder.parents[0]! : "";
      if (recoveredRootId !== this.rootFolderId) {
        throw new Error("Drive vault manifest does not belong to the stored root authority");
      }
      const recoveredRoot = await this.options.client.getFile(this.rootFolderId);
      if (recoveredRoot.mimeType !== FOLDER_MIME || recoveredRoot.appProperties?.[BINDING_PROPERTY] !== `v1:${this.options.vaultBindingId}`) {
        throw new Error("Drive vault root authority marker is missing or invalid");
      }
      await this.loadManifest(recoveredManifest);
      const bundleFile = await this.options.client.getFile(this.manifest.bundle.fileId);
      this.gitFolderId = bundleFile.parents?.[0] ?? "";
      if (!this.gitFolderId) throw new Error("Drive vault bundle has no Git-folder parent");
      await this.validateControlParents(recoveredManifest, bundleFile);
    } else {
      if (root.created) {
        this.gitFolderId = await this.ensureBootstrapFolder(GIT_FOLDER, this.rootFolderId, GIT_FOLDER_ROLE);
        this.controlFolderId = await this.ensureBootstrapFolder(CONTROL_FOLDER, this.rootFolderId, CONTROL_FOLDER_ROLE);
        this.transactionsFolderId = await this.ensureBootstrapFolder(TRANSACTIONS_FOLDER, this.controlFolderId, TRANSACTIONS_FOLDER_ROLE);
        this.deletedFolderId = await this.ensureBootstrapFolder("deleted", this.controlFolderId, DELETED_FOLDER_ROLE);
      } else {
        await this.validateBootstrapSkeleton(this.rootFolderId, {
          [GIT_FOLDER_ROLE]: GIT_FOLDER,
          [CONTROL_FOLDER_ROLE]: CONTROL_FOLDER,
        });
        this.gitFolderId = await this.findBootstrapRoleFolder(this.rootFolderId, GIT_FOLDER, GIT_FOLDER_ROLE) ?? "";
        this.controlFolderId = await this.findBootstrapRoleFolder(this.rootFolderId, CONTROL_FOLDER, CONTROL_FOLDER_ROLE) ?? "";
        if (this.controlFolderId) {
          await this.validateBootstrapSkeleton(this.controlFolderId, {
            [TRANSACTIONS_FOLDER_ROLE]: TRANSACTIONS_FOLDER,
            [DELETED_FOLDER_ROLE]: "deleted",
          });
          this.transactionsFolderId = await this.findBootstrapRoleFolder(this.controlFolderId, TRANSACTIONS_FOLDER, TRANSACTIONS_FOLDER_ROLE) ?? "";
          this.deletedFolderId = await this.findBootstrapRoleFolder(this.controlFolderId, "deleted", DELETED_FOLDER_ROLE) ?? "";
        }
        if (this.gitFolderId && this.controlFolderId && this.transactionsFolderId && this.deletedFolderId) {
          bootstrap = await this.findBootstrapJournal();
        }
        if (!bootstrap) {
          for (const [folderId, label] of [
            [this.gitFolderId, GIT_FOLDER],
            [this.transactionsFolderId, `${CONTROL_FOLDER}/${TRANSACTIONS_FOLDER}`],
            [this.deletedFolderId, `${CONTROL_FOLDER}/deleted`],
          ] as const) {
            if (folderId) await this.validateEmptyBootstrapFolder(folderId, label);
          }
        }
        this.gitFolderId ||= await this.ensureBootstrapFolder(GIT_FOLDER, this.rootFolderId, GIT_FOLDER_ROLE);
        this.controlFolderId ||= await this.ensureBootstrapFolder(CONTROL_FOLDER, this.rootFolderId, CONTROL_FOLDER_ROLE);
        this.transactionsFolderId ||= await this.ensureBootstrapFolder(TRANSACTIONS_FOLDER, this.controlFolderId, TRANSACTIONS_FOLDER_ROLE);
        this.deletedFolderId ||= await this.ensureBootstrapFolder("deleted", this.controlFolderId, DELETED_FOLDER_ROLE);
      }
    }
    if (recoveredManifest) {
      this.transactionsFolderId = await this.discoverJournalFolder() ?? await this.findUniqueChildFolder(this.controlFolderId, TRANSACTIONS_FOLDER) ?? "";
      this.deletedFolderId = await this.discoverDeletedFolder() ?? await this.findUniqueChildFolder(this.controlFolderId, "deleted") ?? "";
      if (!this.transactionsFolderId || !this.deletedFolderId) {
        throw new Error("Drive vault control authority is incomplete");
      }
      await this.validateManifestControlAuthority(recoveredManifest, this.manifest);
      await this.recoverTransactions();
      await this.validateManifestAuthority(this.manifestFile, this.manifest);
    } else {
      if (!this.transactionsFolderId || !this.deletedFolderId) {
        throw new Error("Drive vault authority is incomplete; refusing to reprovision an existing marked root");
      }
      bootstrap ??= await this.findBootstrapJournal();
      if (bootstrap) await this.provision(bootstrap.journal, bootstrap.file);
      else await this.provision();
    }
    await this.ensureStandardFolders();
    await this.materializeFromAuthority();
    await this.importExternalEdits();
  }

  private async discoverManifestFile(rootFolderId: string): Promise<DriveVaultFile | null> {
    const candidates: DriveVaultFile[] = [];
    const folders = await this.options.client.listFiles({ folderId: rootFolderId, foldersOnly: true, pageSize: 1000, allPages: true });
    for (const folder of folders) {
      const marked = await this.options.client.listFiles({
        folderId: folder.id,
        pageSize: 1000,
        allPages: true,
        appProperties: { [BINDING_PROPERTY]: this.options.vaultBindingId, [ROLE_PROPERTY]: MANIFEST_ROLE },
      });
      for (const file of marked) {
        if (file.mimeType !== "application/json") continue;
        const parsed = await this.options.client.download(file.id)
          .then((data) => JSON.parse(data.toString("utf8")) as Partial<DriveVaultManifest>)
          .catch(() => null);
        if (parsed?.schemaVersion === 1 && parsed.vaultBindingId === this.options.vaultBindingId && parsed.bundle && parsed.files) candidates.push(file);
      }
    }
    if (candidates.length > 1) throw new Error("Drive vault has multiple manifest authorities");
    return candidates[0] ?? null;
  }

  private async findUniqueChildFolder(parentId: string, name: string): Promise<string | null> {
    const matches = (await this.options.client.listFiles({ folderId: parentId, nameContains: name, foldersOnly: true, pageSize: 1000, allPages: true }))
      .filter((file) => file.name === name && file.parents?.length === 1 && file.parents[0] === parentId);
    if (matches.length > 1) throw new Error(`Drive vault has duplicate ${name} folders`);
    return matches[0]?.id ?? null;
  }

  private async ensureBootstrapFolder(name: string, parentId: string, role: string): Promise<string> {
    return this.options.client.ensureFolder(name, parentId, {
      appProperties: { [BINDING_PROPERTY]: this.options.vaultBindingId, [ROLE_PROPERTY]: role },
    });
  }

  private async findBootstrapRoleFolder(parentId: string, name: string, role: string): Promise<string | null> {
    const matches = (await this.options.client.listFiles({
      folderId: parentId,
      nameContains: name,
      foldersOnly: true,
      pageSize: 1000,
      allPages: true,
      appProperties: { [BINDING_PROPERTY]: this.options.vaultBindingId, [ROLE_PROPERTY]: role },
    })).filter((file) => file.name === name && file.parents?.length === 1 && file.parents[0] === parentId);
    if (matches.length > 1) throw new Error(`Drive bootstrap role ${role} is ambiguous`);
    return matches[0]?.id ?? null;
  }

  private async validateEmptyBootstrapFolder(folderId: string, label: string): Promise<void> {
    const children = await this.listChildren(folderId);
    if (children.length) {
      throw new Error(`Drive vault authority is incomplete; ${label} contains prior-authority remnants`);
    }
  }

  private async validateBootstrapSkeleton(parentId: string, roleNames: Record<string, string>): Promise<void> {
    const children = await this.listChildren(parentId);
    const seen = new Set<string>();
    for (const child of children) {
      const role = child.appProperties?.[ROLE_PROPERTY];
      if (child.mimeType !== FOLDER_MIME || child.parents?.length !== 1 || child.parents[0] !== parentId
        || child.appProperties?.[BINDING_PROPERTY] !== this.options.vaultBindingId || !role || !Object.hasOwn(roleNames, role)
        || child.name !== roleNames[role]
        || seen.has(role)) {
        throw new Error(`Drive vault authority is incomplete; conflicting bootstrap remnant ${child.name} (${child.id})`);
      }
      seen.add(role);
    }
  }

  private async validateControlParents(manifestFile: DriveVaultFile, bundleFile: DriveVaultFile): Promise<void> {
    const control = await this.options.client.getFile(this.controlFolderId);
    const gitFolder = await this.options.client.getFile(this.gitFolderId);
    if (manifestFile.parents?.length !== 1 || manifestFile.parents[0] !== control.id
      || control.mimeType !== FOLDER_MIME || control.parents?.length !== 1 || control.parents[0] !== this.rootFolderId) {
      throw new Error("Drive vault control folder is outside its bound root");
    }
    if (bundleFile.parents?.length !== 1 || bundleFile.parents[0] !== gitFolder.id
      || gitFolder.mimeType !== FOLDER_MIME || gitFolder.parents?.length !== 1 || gitFolder.parents[0] !== this.rootFolderId) {
      throw new Error("Drive vault Git folder is outside its bound root");
    }
  }

  private async discoverJournalFolder(): Promise<string | null> {
    const parents = new Set<string>();
    for (const folder of await this.options.client.listFiles({ folderId: this.controlFolderId, foldersOnly: true, pageSize: 1000, allPages: true })) {
      const files = await this.options.client.listFiles({ folderId: folder.id, pageSize: 1000, allPages: true });
      if (files.some((file) => file.appProperties?.[OPERATION_PROPERTY]?.startsWith("journal-"))) parents.add(folder.id);
    }
    if (parents.size > 1) throw new Error("Drive vault has multiple transaction journal folders");
    return [...parents][0] ?? null;
  }

  private async discoverDeletedFolder(): Promise<string | null> {
    const parents = new Set<string>();
    for (const tombstones of Object.values(this.manifest.tombstones ?? {})) {
      for (const tombstone of tombstones) {
        const file = await this.options.client.getFile(tombstone.fileId);
        if (file.parents?.length === 1) parents.add(file.parents[0]!);
      }
    }
    if (parents.size > 1) throw new Error("Drive vault has multiple tombstone folders");
    if (!parents.size) return null;
    const folderId = [...parents][0]!;
    const folder = await this.options.client.getFile(folderId);
    if (folder.parents?.length !== 1 || folder.parents[0] !== this.controlFolderId) throw new Error("Drive vault tombstone folder is outside its control folder");
    return folderId;
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

  private async findBootstrapJournal(): Promise<{ file: DriveVaultFile; journal: DriveJournal } | null> {
    const found: Array<{ file: DriveVaultFile; journal: DriveJournal }> = [];
    for (const file of await this.options.client.listFiles({ folderId: this.transactionsFolderId, pageSize: 1000, allPages: true })) {
      if (!file.name.endsWith(".json")) throw new Error("Drive vault contains an invalid bootstrap journal file");
      const journal = await this.options.client.download(file.id)
        .then((data) => JSON.parse(data.toString("utf8")) as DriveJournal)
        .catch(() => null);
      if (!journal || journal.bootstrap !== true) throw new Error("Drive vault contains an invalid bootstrap journal without a manifest authority");
      found.push({ file, journal });
    }
    if (found.length > 1) throw new Error("Drive vault has multiple bootstrap authorities");
    if (found[0]?.journal.state === "committed") throw new Error("Drive vault manifest authority is missing after committed bootstrap");
    return found[0] ?? null;
  }

  private async applyBootstrapCreate(
    mutation: JournalMutation,
    parentId: string,
    name: string,
    role: string,
    data = Buffer.from(mutation.contentBase64!, "base64"),
  ): Promise<DriveVaultFile> {
    const existing = (await this.listChildren(parentId)).filter((file) => file.appProperties?.[OPERATION_PROPERTY] === mutation.operationId);
    if (existing.length > 1) throw new Error(`Drive bootstrap create is ambiguous at ${mutation.path}`);
    if (existing[0]) {
      if (existing[0].name !== name || existing[0].parents?.length !== 1 || existing[0].parents[0] !== parentId || sha256(await this.options.client.download(existing[0].id)) !== sha256(data)) {
        throw new Error(`Drive bootstrap create identity mismatch at ${mutation.path}`);
      }
      return existing[0];
    }
    return this.options.client.uploadFile(name, mutation.mimeType ?? mimeFor(mutation.path), data, parentId, {
      appProperties: {
        [OPERATION_PROPERTY]: mutation.operationId,
        [BINDING_PROPERTY]: this.options.vaultBindingId,
        [ROLE_PROPERTY]: role,
      },
    });
  }

  private async validateBootstrapJournal(file: DriveVaultFile, journal: DriveJournal): Promise<void> {
    if (
      journal.schemaVersion !== 1 || journal.bootstrap !== true
      || journal.tenantId !== this.options.tenantId || journal.vaultBindingId !== this.options.vaultBindingId
      || file.name !== `${journal.transactionId}.json`
      || file.appProperties?.[OPERATION_PROPERTY] !== `journal-${journal.transactionId}`
      || file.parents?.length !== 1 || file.parents[0] !== this.transactionsFolderId
      || journal.baseRevisionId !== "uninitialized" || !/^[0-9a-f]{40}$/.test(journal.targetCommitSha)
      || journal.intentDigest !== journalIntentDigest(journal)
      || journal.mutations.length !== 2
    ) throw new Error("Drive bootstrap journal validation failed");
    const [bundle, manifest] = journal.mutations;
    if (
      bundle?.kind !== "create" || bundle.path !== `${GIT_FOLDER}/${BUNDLE_NAME}`
      || bundle.operationId !== operationIdFor(journal.transactionId, bundle.kind, bundle.path)
      || !bundle.contentBase64 || bundle.checksum !== sha256(Buffer.from(bundle.contentBase64, "base64"))
      || manifest?.kind !== "create" || manifest.path !== `${CONTROL_FOLDER}/${MANIFEST_NAME}`
      || manifest.operationId !== operationIdFor(journal.transactionId, manifest.kind, manifest.path)
    ) throw new Error("Drive bootstrap mutation validation failed");
    this.assertJournalContract(journal);
  }

  private async provision(existingJournal?: DriveJournal, existingJournalFile?: DriveVaultFile): Promise<void> {
    await rm(join(this.path, ".git"), { recursive: true, force: true });
    await simpleGit().init(["--initial-branch=main", this.path]);
    this.git = simpleGit(this.path);
    await this.configureGit();
    let journal = existingJournal;
    if (!journal) {
      await this.git.raw(["commit", "--allow-empty", "-m", "Initialize Zenod Drive vault"]);
      const commitSha = (await this.git.revparse(["HEAD"])).trim();
      const bundleData = await this.createBundle();
      const revisionId = this.idFactory();
      const createdAt = this.now().toISOString();
      const mutations: JournalMutation[] = [
        this.mutation("create", `${GIT_FOLDER}/${BUNDLE_NAME}`, revisionId, undefined, bundleData),
        this.mutation("create", `${CONTROL_FOLDER}/${MANIFEST_NAME}`, revisionId),
      ];
      journal = {
        schemaVersion: 1, transactionId: revisionId, tenantId: this.options.tenantId,
        vaultBindingId: this.options.vaultBindingId, intentDigest: "", message: "Initialize Zenod Drive vault",
        state: "prepared", baseRevisionId: "uninitialized", targetCommitSha: commitSha,
        mutations, createdAt, updatedAt: createdAt, bootstrap: true,
      };
      journal.intentDigest = journalIntentDigest(journal);
      await this.writeLocalJournal(journal);
    } else {
      await this.validateBootstrapJournal(existingJournalFile!, journal);
      const bundleMutation = journal.mutations[0]!;
      const bundlePath = join(this.stateDir, `bootstrap-${journal.transactionId}.bundle`);
      await writeFile(bundlePath, Buffer.from(bundleMutation.contentBase64!, "base64"));
      await simpleGit().clone(bundlePath, this.path).catch(async () => {
        await rm(this.path, { recursive: true, force: true });
        await simpleGit().clone(bundlePath, this.path);
      });
      await rm(bundlePath, { force: true });
      this.git = simpleGit(this.path);
      await this.git.removeRemote("origin").catch(() => undefined);
      await this.configureGit();
    }
    const journalFile = existingJournalFile ?? await this.createRemoteJournal(journal);
    journal.state = "applying";
    await this.updateRemoteJournal(journalFile, journal);
    const bundleMutation = journal.mutations[0]!;
    const bundleFile = await this.applyBootstrapCreate(bundleMutation, this.gitFolderId, BUNDLE_NAME, BUNDLE_ROLE);
    bundleMutation.resultingFile = bundleFile;
    bundleMutation.state = "applied";
    journal.updatedAt = this.now().toISOString();
    await this.writeLocalJournal(journal);
    await this.updateRemoteJournal(journalFile, journal);
    const revisionId = journal.transactionId;
    const committedAt = this.now().toISOString();
    const manifest: DriveVaultManifest = {
      schemaVersion: 1,
      vaultBindingId: this.options.vaultBindingId,
      revisionId,
      committedAt,
      commitSha: journal.targetCommitSha,
      bundle: this.manifestEntry(bundleFile, bundleMutation.checksum!),
      files: {},
      tombstones: {},
    };
    const manifestData = Buffer.from(JSON.stringify(manifest, null, 2));
    const manifestMutation = journal.mutations[1]!;
    this.manifestFile = await this.applyBootstrapCreate(manifestMutation, this.controlFolderId, MANIFEST_NAME, MANIFEST_ROLE, manifestData);
    manifestMutation.resultingFile = this.manifestFile;
    manifestMutation.state = "applied";
    journal.manifest = manifest;
    journal.state = "committed";
    journal.committedAt = committedAt;
    journal.updatedAt = this.now().toISOString();
    await this.writeLocalJournal(journal);
    await this.updateRemoteJournal(journalFile, journal);
    this.manifest = manifest;
    await this.validateManifestAuthority(this.manifestFile, manifest);
    await this.verifyBundleData(await this.options.client.download(bundleFile.id), manifest.commitSha);
    await rm(this.localJournalPath(journal.transactionId), { force: true });
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

  private async validateManifestControlAuthority(file: DriveVaultFile, manifest: DriveVaultManifest): Promise<void> {
    if (
      file.parents?.length !== 1 || file.parents[0] !== this.controlFolderId
      || file.appProperties?.[BINDING_PROPERTY] !== this.options.vaultBindingId
      || file.appProperties?.[ROLE_PROPERTY] !== MANIFEST_ROLE
    ) throw new Error("Drive vault manifest is outside its bound control folder");
    const control = await this.options.client.getFile(this.controlFolderId);
    if (control.mimeType !== FOLDER_MIME || control.parents?.length !== 1 || control.parents[0] !== this.rootFolderId) {
      throw new Error("Drive vault control folder is outside its bound root");
    }
    const gitFolder = await this.options.client.getFile(this.gitFolderId);
    if (gitFolder.mimeType !== FOLDER_MIME || gitFolder.parents?.length !== 1 || gitFolder.parents[0] !== this.rootFolderId) {
      throw new Error("Drive vault Git folder is outside its bound root");
    }
    const bundle = await this.options.client.getFile(manifest.bundle.fileId);
    if (
      bundle.name !== BUNDLE_NAME || bundle.parents?.length !== 1 || bundle.parents[0] !== this.gitFolderId
      || bundle.appProperties?.[BINDING_PROPERTY] !== this.options.vaultBindingId
      || bundle.appProperties?.[ROLE_PROPERTY] !== BUNDLE_ROLE
    ) throw new Error("Drive vault bundle is outside its bound Git folder");
  }

  private async validateManifestAuthority(file: DriveVaultFile, manifest: DriveVaultManifest): Promise<void> {
    await this.validateManifestControlAuthority(file, manifest);

    const normalized = new Set<string>();
    const fileIds = new Set<string>([file.id, manifest.bundle.fileId]);
    const snapshot = await this.remoteSnapshot();
    for (const [path, entry] of Object.entries(manifest.files)) {
      const safe = normalizePath(path);
      if (safe !== path || normalized.has(safe) || fileIds.has(entry.fileId)) throw new Error(`Drive vault manifest path identity is invalid at ${path}`);
      normalized.add(safe);
      fileIds.add(entry.fileId);
      if (snapshot[path]?.file.id !== entry.fileId || snapshot[path]?.file.mimeType !== entry.mimeType) {
        throw new Error(`Drive vault manifest file is outside its exact path at ${path}`);
      }
    }
    for (const [path, tombstones] of Object.entries(manifest.tombstones ?? {})) {
      if (normalizePath(path) !== path) throw new Error(`Drive vault tombstone path is invalid at ${path}`);
      const seen = new Set<string>();
      for (const tombstone of tombstones) {
        if (seen.has(tombstone.fileId) || fileIds.has(tombstone.fileId)) throw new Error(`Drive vault tombstone identity is duplicated at ${path}`);
        seen.add(tombstone.fileId);
        fileIds.add(tombstone.fileId);
        const archived = await this.options.client.getFile(tombstone.fileId);
        if (archived.parents?.length !== 1 || archived.parents[0] !== this.deletedFolderId || archived.name !== tombstone.archivedName) {
          throw new Error(`Drive vault tombstone is outside its archive at ${path}`);
        }
        if (sha256(await this.options.client.download(archived.id)) !== tombstone.checksum) {
          throw new Error(`Drive vault tombstone checksum mismatch at ${path}`);
        }
      }
    }
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
    const bundleData = await this.options.client.download(this.manifest.bundle.fileId);
    if (sha256(bundleData) !== this.manifest.bundle.checksum) throw new Error("Drive Git bundle checksum mismatch");
    await this.verifyBundleData(bundleData, this.manifest.commitSha);
    const localHead = await access(join(this.path, ".git"))
      .then(async () => simpleGit(this.path).revparse(["HEAD"]).then((value) => value.trim()).catch(() => null))
      .catch(() => null);
    if (localHead === this.manifest.commitSha) {
      await this.configureGit();
      return;
    }
    const bundlePath = join(this.stateDir, `restore-${this.idFactory()}.bundle`);
    const restored = join(this.stateDir, `restore-${this.idFactory()}`);
    try {
      await writeFile(bundlePath, bundleData);
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
        if (!prefix && (file.id === this.gitFolderId || file.id === this.controlFolderId)) continue;
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
      intentDigest: "",
      message: "Import external Google Drive edits",
      state: "prepared",
      baseRevisionId: this.manifest.revisionId,
      targetCommitSha: commitSha,
      mutations: [mutation, manifestMutation],
      replacementFiles: files,
      createdAt,
      updatedAt: createdAt,
    };
    journal.intentDigest = journalIntentDigest(journal);
    await this.writeLocalJournal(journal);
    const journalFile = await this.createRemoteJournal(journal);
    await this.applyJournal(journal, journalFile, this.manifest);
    await rm(this.localJournalPath(transactionId), { force: true });
  }

  async pull(): Promise<void> {
    await this.recoverTransactions();
    const manifestFile = await this.options.client.getFile(this.manifestFile.id);
    await this.loadManifest(manifestFile);
    await this.validateManifestAuthority(manifestFile, this.manifest);
    await this.materializeFromAuthority();
    await this.importExternalEdits();
  }

  async currentRevision(): Promise<VaultRevision> {
    const manifestFile = await this.options.client.getFile(this.manifestFile.id);
    await this.loadManifest(manifestFile);
    await this.validateManifestAuthority(manifestFile, this.manifest);
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
    const mutations = await this.planMutations(changedPaths, bundleData, transactionId, await this.committedRenames());
    const journal: DriveJournal = {
      schemaVersion: 1,
      transactionId,
      tenantId: this.options.tenantId,
      vaultBindingId: this.options.vaultBindingId,
      intentDigest: "",
      message,
      state: "prepared",
      baseRevisionId: baseManifest.revisionId,
      targetCommitSha,
      mutations,
      createdAt: now,
      updatedAt: now,
    };
    journal.intentDigest = journalIntentDigest(journal);
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

  private async committedRenames(): Promise<Map<string, string>> {
    const output = await this.git.raw(["diff-tree", "--no-commit-id", "--name-status", "-r", "-M100%", "HEAD^", "HEAD"]);
    const moves = new Map<string, string>();
    for (const line of output.split("\n")) {
      const [status, from, to] = line.split("\t");
      if (status?.startsWith("R") && from && to) moves.set(normalizePath(from), normalizePath(to));
    }
    return moves;
  }

  private async planMutations(
    paths: string[],
    bundleData: Buffer,
    transactionId: string,
    committedRenames = new Map<string, string>(),
  ): Promise<JournalMutation[]> {
    const mutations: JournalMutation[] = [];
    const deleted = paths.filter((path) => this.manifest.files[path] && !this.fileExists(path));
    const created = paths.filter((path) => !this.manifest.files[path] && this.fileExists(path));
    const createdChecksums = new Map<string, string>();
    for (const path of created) createdChecksums.set(path, sha256(await readFile(join(this.path, path))));
    const usedDeleted = new Set<string>();
    const usedCreated = new Set<string>();
    for (const [from, to] of committedRenames) {
      if (!deleted.includes(from) || !created.includes(to) || createdChecksums.get(to) !== this.manifest.files[from]?.checksum) continue;
      usedDeleted.add(from);
      usedCreated.add(to);
      mutations.push(this.mutation("move", from, transactionId, this.manifest.files[from], undefined, to));
    }
    for (const from of deleted) {
      if (usedDeleted.has(from)) continue;
      const old = this.manifest.files[from]!;
      const matches = created.filter((path) => !usedCreated.has(path) && createdChecksums.get(path) === old.checksum);
      const match = matches.sort((left, right) => this.pathMoveScore(from, right) - this.pathMoveScore(from, left) || left.localeCompare(right))[0] ?? null;
      if (match) {
        usedDeleted.add(from);
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

  private pathMoveScore(from: string, to: string): number {
    const left = from.split("/");
    const right = to.split("/");
    let score = posix.basename(from) === posix.basename(to) ? 1000 : 0;
    for (let index = 1; index <= Math.min(left.length, right.length); index += 1) {
      if (left[left.length - index] !== right[right.length - index]) break;
      score += 10;
    }
    return score - Math.abs(left.length - right.length);
  }

  private fileExists(path: string): boolean {
    return existsSync(join(this.path, path));
  }

  private mutation(kind: MutationKind, path: string, transactionId: string, existing?: ManifestFile, data?: Buffer, destinationPath?: string): JournalMutation {
    return {
      operationId: operationIdFor(transactionId, kind, path, destinationPath),
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
    await this.verifyOrdinaryAuthority(nextManifest, journal, journalFile, "before manifest finalization");
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
    await this.verifyOrdinaryAuthority(nextManifest, journal, journalFile, "after manifest finalization");
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

  private async verifyOrdinaryAuthority(
    expected: DriveVaultManifest,
    journal: DriveJournal,
    journalFile: DriveVaultFile,
    phase: string,
  ): Promise<void> {
    const snapshot = await this.remoteSnapshot();
    const conflicts: string[] = [];
    const paths = new Set([...Object.keys(snapshot), ...Object.keys(expected.files)]);
    for (const path of paths) {
      const actual = snapshot[path];
      const entry = expected.files[path];
      if (!actual || !entry || actual.file.id !== entry.fileId || actual.file.version !== entry.version
        || actual.file.modifiedTime !== entry.modifiedTime || sha256(actual.data) !== entry.checksum) conflicts.push(path);
    }
    for (const [path, tombstones] of Object.entries(expected.tombstones ?? {})) {
      for (const tombstone of tombstones) {
        const archived = await this.options.client.getFile(tombstone.fileId).catch(() => null);
        const checksum = archived ? await this.options.client.download(archived.id).then(sha256).catch(() => null) : null;
        if (!archived || archived.name !== tombstone.archivedName || archived.parents?.length !== 1
          || archived.parents[0] !== this.deletedFolderId || checksum !== tombstone.checksum) conflicts.push(path);
      }
    }
    if (!conflicts.length) return;
    for (const path of conflicts) {
      const actual = snapshot[path];
      if (!actual) continue;
      const conflictPath = join(this.stateDir, "conflicts", `authority-${journal.transactionId}`, path);
      await mkdir(dirname(conflictPath), { recursive: true });
      await writeFile(conflictPath, actual.data);
    }
    journal.state = journal.mutations.some((mutation) => mutation.state === "applied") ? "recovering" : "conflict";
    journal.updatedAt = this.now().toISOString();
    await this.writeLocalJournal(journal);
    await this.updateRemoteJournal(journalFile, journal);
    if (journal.state === "recovering") {
      throw new VaultPublicationError({
        code: "partial_recovering", message: `Drive ordinary-file authority changed ${phase}: ${conflicts.join(", ")}`,
        retryable: true, transactionId: journal.transactionId,
        appliedPaths: journal.mutations.filter((mutation) => mutation.state === "applied").map((mutation) => mutation.path), pendingPaths: conflicts,
      });
    }
    throw new VaultPublicationError({
      code: "conflict", message: `Drive ordinary-file authority changed ${phase}: ${conflicts.join(", ")}`,
      retryable: false, transactionId: journal.transactionId, paths: conflicts,
    });
  }

  private async applyMutation(mutation: JournalMutation, journal: DriveJournal, journalFile: DriveVaultFile): Promise<DriveVaultFile> {
    if (mutation.kind === "create") {
      const parentId = await this.ensurePath(mutation.parentPath ?? "");
      const recovered = (await this.listChildren(parentId)).filter((file) => file.appProperties?.[OPERATION_PROPERTY] === mutation.operationId);
      if (recovered.length > 1) throw new Error(`Drive create operation is ambiguous at ${mutation.path}`);
      if (recovered[0]) {
        if (recovered[0].name !== posix.basename(mutation.path) || recovered[0].mimeType !== mutation.mimeType
          || !await this.remoteContentMatches(recovered[0], mutation.checksum!)) throw new Error(`Drive create replay mismatch at ${mutation.path}`);
        return recovered[0];
      }
      const sameName = (await this.listChildren(parentId)).find((file) => file.name === posix.basename(mutation.path));
      if (sameName) throw new Error(`Drive create conflict at ${mutation.path}`);
      try {
        return await this.options.client.uploadFile(posix.basename(mutation.path), mutation.mimeType!, Buffer.from(mutation.contentBase64!, "base64"), parentId, { appProperties: { [OPERATION_PROPERTY]: mutation.operationId } });
      } catch (error) {
        const after = (await this.listChildren(parentId)).filter((file) => file.appProperties?.[OPERATION_PROPERTY] === mutation.operationId);
        if (after.length === 1 && after[0]!.name === posix.basename(mutation.path) && await this.remoteContentMatches(after[0]!, mutation.checksum!)) return after[0]!;
        throw error;
      }
    }
    if (mutation.kind === "delete") {
      const current = await this.options.client.getFile(mutation.fileId!);
      const archivedName = `${mutation.operationId}-${posix.basename(mutation.path)}`;
      if (current.parents?.includes(this.deletedFolderId) && current.name === archivedName) {
        if (!await this.remoteContentMatches(current, mutation.expectedChecksum!)) throw new Error(`Drive delete replay checksum mismatch at ${mutation.path}`);
        return current;
      }
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
      if (current.parents?.includes(destinationParentId) && current.name === posix.basename(mutation.destinationPath!)) {
        if (!this.isExpectedSingleAdvance(mutation, current) || !await this.remoteContentMatches(current, mutation.expectedChecksum!)) {
          throw new Error(`Drive move replay mismatch at ${mutation.path}`);
        }
        return current;
      }
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
    if (await this.remoteContentMatches(current, mutation.checksum!)) {
      if (!this.isExpectedSingleAdvance(mutation, current)) {
        throw new Error(`Drive update replay version mismatch at ${mutation.path}`);
      }
      return current;
    }
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
    const currentData = await this.options.client.download(file.id);
    const expectedChecksum = sha256(currentData);
    if ((file.version && current.version !== file.version) || (file.modifiedTime && current.modifiedTime !== file.modifiedTime)) {
      await this.materializeJournalConflict(journal.transactionId, current, currentData, []);
      throw new VaultPublicationError({
        code: "conflict", message: `Drive transaction journal changed externally: ${journal.transactionId}`,
        retryable: false, transactionId: journal.transactionId, paths: [`${CONTROL_FOLDER}/${TRANSACTIONS_FOLDER}/${file.name}`],
      });
    }
    if (expectedChecksum === sha256(data)) return;
    const baseline = await this.options.client.listRevisions(file.id);
    try {
      const updated = await this.options.client.updateFile(file.id, "application/json", data, {
        ...(current.version ? { expectedVersion: current.version } : {}),
        ...(current.modifiedTime ? { expectedModifiedTime: current.modifiedTime } : {}),
        expectedChecksum,
      });
      const post = await this.options.client.getFile(file.id);
      const postData = await this.options.client.download(file.id);
      const singleAdvance = current.version && /^\d+$/.test(current.version) && /^\d+$/.test(post.version ?? "")
        ? BigInt(post.version!) === BigInt(current.version) + 1n
        : Boolean(post.version);
      if (!singleAdvance || post.version !== updated.version || sha256(postData) !== sha256(data)) {
        await this.materializeJournalConflict(journal.transactionId, post, postData, baseline.map((revision) => revision.id), data);
        throw new VaultPublicationError({
          code: "conflict", message: `Drive transaction journal interleaving detected: ${journal.transactionId}`,
          retryable: false, transactionId: journal.transactionId, paths: [`${CONTROL_FOLDER}/${TRANSACTIONS_FOLDER}/${file.name}`],
        });
      }
      Object.assign(file, post);
    } catch (error) {
      if (error instanceof VaultPublicationError) throw error;
      const recovered = await this.options.client.getFile(file.id).catch(() => null);
      const recoveredData = recovered ? await this.options.client.download(file.id).catch(() => null) : null;
      const singleAdvance = current.version && recovered?.version && /^\d+$/.test(current.version) && /^\d+$/.test(recovered.version)
        ? BigInt(recovered.version) === BigInt(current.version) + 1n
        : Boolean(recovered?.version);
      if (recovered && recoveredData && singleAdvance && sha256(recoveredData) === sha256(data)) {
        Object.assign(file, recovered);
        return;
      }
      if (recovered && recoveredData && recovered.version === current.version
        && recovered.modifiedTime === current.modifiedTime && sha256(recoveredData) === expectedChecksum) {
        throw error;
      }
      if (recovered && recoveredData) await this.materializeJournalConflict(journal.transactionId, recovered, recoveredData, baseline.map((revision) => revision.id), data);
      throw error;
    }
  }

  private async materializeJournalConflict(
    transactionId: string,
    current: DriveVaultFile,
    currentData: Buffer,
    baselineRevisionIds: string[],
    desired?: Buffer,
  ): Promise<void> {
    const desiredMd5 = desired ? createHash("md5").update(desired).digest("hex") : null;
    const revisions = await this.options.client.listRevisions(current.id).catch(() => []);
    const candidates = revisions.filter((revision) => !baselineRevisionIds.includes(revision.id) && revision.md5Checksum !== desiredMd5);
    if (!candidates.length) {
      const path = join(this.stateDir, "conflicts", `journal-${transactionId}`, `${current.headRevisionId ?? "head"}-${current.name}`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, currentData);
      await this.createJournalConflictMarker(transactionId, [{ id: current.headRevisionId ?? "head", checksum: sha256(currentData) }]);
      return;
    }
    const preserved: Array<{ id: string; checksum: string }> = [];
    for (const revision of candidates) {
      let data: Buffer;
      if (revision.id === current.headRevisionId) data = currentData;
      else {
        await this.options.client.keepRevision(current.id, revision.id);
        data = await this.options.client.downloadRevision(current.id, revision.id);
      }
      const path = join(this.stateDir, "conflicts", `journal-${transactionId}`, `${revision.id}-${current.name}`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
      preserved.push({ id: revision.id, checksum: sha256(data) });
    }
    await this.createJournalConflictMarker(transactionId, preserved);
  }

  private async createJournalConflictMarker(transactionId: string, revisions: Array<{ id: string; checksum: string }>): Promise<void> {
    const operationId = `journal-conflict-${transactionId}`;
    const existing = (await this.listChildren(this.transactionsFolderId)).filter((file) => file.appProperties?.[OPERATION_PROPERTY] === operationId);
    if (existing.length > 1) throw new Error(`Drive journal conflict marker is ambiguous for ${transactionId}`);
    if (existing[0]) return;
    const data = Buffer.from(JSON.stringify({
      schemaVersion: 1, kind: "journal_conflict", transactionId,
      tenantId: this.options.tenantId, vaultBindingId: this.options.vaultBindingId, revisions,
    }, null, 2));
    try {
      await this.options.client.uploadFile(`${transactionId}.conflict.json`, "application/json", data, this.transactionsFolderId, {
        appProperties: { [OPERATION_PROPERTY]: operationId },
      });
    } catch (error) {
      const recovered = (await this.listChildren(this.transactionsFolderId)).filter((file) => file.appProperties?.[OPERATION_PROPERTY] === operationId);
      if (recovered.length === 1) return;
      throw error;
    }
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

  private async validateExecutableJournal(file: DriveVaultFile, journal: DriveJournal): Promise<void> {
    if (
      journal.schemaVersion !== 1 || journal.bootstrap === true
      || journal.tenantId !== this.options.tenantId || journal.vaultBindingId !== this.options.vaultBindingId
      || file.name !== `${journal.transactionId}.json`
      || file.appProperties?.[OPERATION_PROPERTY] !== `journal-${journal.transactionId}`
      || file.parents?.length !== 1 || file.parents[0] !== this.transactionsFolderId
      || !/^[0-9a-f]{40}$/.test(journal.targetCommitSha)
      || journal.intentDigest !== journalIntentDigest(journal)
    ) throw new Error("Drive transaction journal identity validation failed");
    this.assertJournalContract(journal);
    const manifestMutations = journal.mutations.filter((mutation) => mutation.path === `${CONTROL_FOLDER}/${MANIFEST_NAME}`);
    const bundleMutations = journal.mutations.filter((mutation) => mutation.path === `${GIT_FOLDER}/${BUNDLE_NAME}`);
    if (manifestMutations.length !== 1 || bundleMutations.length !== 1) throw new Error("Drive transaction control mutation set is invalid");
    const finalized = this.manifest.revisionId === journal.transactionId && this.manifest.commitSha === journal.targetCommitSha;
    const terminal = journal.state === "committed" || journal.state === "failed";
    if (!terminal && !finalized && this.manifest.revisionId !== journal.baseRevisionId) throw new Error("Drive transaction base authority is stale");
    if (!terminal && journal.replacementFiles) await this.validateReplacementSnapshot(journal);

    const addressedPaths = new Set<string>();
    for (const mutation of journal.mutations) {
      if (mutation.operationId !== operationIdFor(journal.transactionId, mutation.kind, mutation.path, mutation.destinationPath)) {
        throw new Error(`Drive transaction operation identity is invalid at ${mutation.path}`);
      }
      const isManifest = mutation.path === `${CONTROL_FOLDER}/${MANIFEST_NAME}`;
      const isBundle = mutation.path === `${GIT_FOLDER}/${BUNDLE_NAME}`;
      if ((isManifest || isBundle) && mutation.kind !== "update") throw new Error(`Drive transaction control operation is invalid at ${mutation.path}`);
      if (!isManifest && !isBundle) {
        if (normalizePath(mutation.path) !== mutation.path) throw new Error(`Drive transaction path is unsafe at ${mutation.path}`);
        if (mutation.destinationPath && normalizePath(mutation.destinationPath) !== mutation.destinationPath) throw new Error(`Drive transaction destination is unsafe at ${mutation.path}`);
      }
      for (const path of [mutation.path, mutation.destinationPath].filter((path): path is string => Boolean(path))) {
        if (addressedPaths.has(path)) throw new Error(`Drive transaction path is addressed more than once at ${path}`);
        addressedPaths.add(path);
      }
      if (mutation.contentBase64 && mutation.checksum !== sha256(Buffer.from(mutation.contentBase64, "base64"))) {
        throw new Error(`Drive transaction payload checksum is invalid at ${mutation.path}`);
      }
      if (mutation.kind === "create") {
        const expectedParent = posix.dirname(mutation.path) === "." ? "" : posix.dirname(mutation.path);
        if (mutation.fileId || mutation.parentPath !== expectedParent || mutation.expectedChecksum || mutation.expectedVersion || mutation.expectedModifiedTime) {
          throw new Error(`Drive create instruction is not root-derived at ${mutation.path}`);
        }
      } else if (!terminal && !finalized) {
        const base = isManifest ? this.manifestEntry(this.manifestFile, sha256(Buffer.from(JSON.stringify(this.manifest, null, 2))))
          : isBundle ? this.manifest.bundle : this.manifest.files[mutation.path];
        if (!base || mutation.fileId !== base.fileId || mutation.expectedChecksum !== base.checksum
          || mutation.expectedVersion !== base.version || mutation.expectedModifiedTime !== base.modifiedTime) {
          throw new Error(`Drive transaction target is not bound to base authority at ${mutation.path} (${journal.transactionId}/${journal.state}, base ${journal.baseRevisionId}, current ${this.manifest.revisionId})`);
        }
      }
      if (!terminal && mutation.state === "applied") await this.validateAppliedMutation(mutation, journal, finalized);
    }
  }

  private async validateReplacementSnapshot(journal: DriveJournal): Promise<void> {
    const files = journal.replacementFiles!;
    const snapshot = await this.remoteSnapshot();
    const ids = new Set<string>();
    const paths = Object.keys(files);
    const conflicts: string[] = [];
    if (paths.length !== Object.keys(snapshot).length) conflicts.push(...new Set([...paths, ...Object.keys(snapshot)]));
    for (const [path, entry] of Object.entries(files)) {
      if (normalizePath(path) !== path || ids.has(entry.fileId)) throw new Error(`Drive import snapshot identity is invalid at ${path}`);
      ids.add(entry.fileId);
      const actual = snapshot[path];
      if (!actual || actual.file.id !== entry.fileId || actual.file.version !== entry.version
        || actual.file.modifiedTime !== entry.modifiedTime || sha256(actual.data) !== entry.checksum) {
        conflicts.push(path);
      }
    }
    if (!conflicts.length) return;
    const unique = [...new Set(conflicts)].sort();
    for (const path of unique) {
      const actual = snapshot[path];
      if (!actual) continue;
      const conflictPath = join(this.stateDir, "conflicts", `import-${journal.transactionId}`, path);
      await mkdir(dirname(conflictPath), { recursive: true });
      await writeFile(conflictPath, actual.data);
    }
    if (journal.state === "recovering" || journal.mutations.some((mutation) => mutation.state === "applied")) {
      throw new VaultPublicationError({
        code: "partial_recovering", message: `Drive import snapshot changed before recovery: ${unique.join(", ")}`,
        retryable: true, transactionId: journal.transactionId,
        appliedPaths: journal.mutations.filter((mutation) => mutation.state === "applied").map((mutation) => mutation.path), pendingPaths: unique,
      });
    }
    throw new VaultPublicationError({
      code: "conflict", message: `Drive import snapshot changed before execution: ${unique.join(", ")}`,
      retryable: false, transactionId: journal.transactionId, paths: unique,
    });
  }

  private async validateAppliedMutation(mutation: JournalMutation, journal: DriveJournal, finalized: boolean): Promise<void> {
    if (!mutation.resultingFile?.id) throw new Error(`Drive applied mutation lacks a result at ${mutation.path}`);
    const actual = await this.options.client.getFile(mutation.resultingFile.id);
    if (actual.id !== mutation.resultingFile.id) throw new Error(`Drive applied result identity mismatch at ${mutation.path}`);
    if (mutation.kind === "create") {
      if (actual.appProperties?.[OPERATION_PROPERTY] !== mutation.operationId) throw new Error(`Drive create result operation mismatch at ${mutation.path}`);
    } else if (actual.id !== mutation.fileId) throw new Error(`Drive applied result changed target identity at ${mutation.path}`);
    if (mutation.path === `${CONTROL_FOLDER}/${MANIFEST_NAME}`) {
      if (actual.parents?.length !== 1 || actual.parents[0] !== this.controlFolderId) throw new Error("Drive manifest result escaped its control folder");
    } else if (mutation.path === `${GIT_FOLDER}/${BUNDLE_NAME}`) {
      if (actual.name !== BUNDLE_NAME || actual.parents?.length !== 1 || actual.parents[0] !== this.gitFolderId) throw new Error("Drive bundle result escaped its Git folder");
    } else if (mutation.kind === "delete") {
      const archivedName = `${mutation.operationId}-${posix.basename(mutation.path)}`;
      if (actual.name !== archivedName || actual.parents?.length !== 1 || actual.parents[0] !== this.deletedFolderId) throw new Error(`Drive delete result escaped its archive at ${mutation.path}`);
      if (!await this.remoteContentMatches(actual, mutation.expectedChecksum!)) throw new Error(`Drive delete result checksum mismatch at ${mutation.path}`);
    } else {
      const target = mutation.kind === "move" ? mutation.destinationPath! : mutation.path;
      const parentPath = posix.dirname(target) === "." ? "" : posix.dirname(target);
      const parentId = await this.resolveExistingFolder(parentPath);
      if (!parentId || actual.name !== posix.basename(target) || actual.parents?.length !== 1 || actual.parents[0] !== parentId) {
        throw new Error(`Drive applied result escaped its expected path at ${target} (${mutation.kind}/${mutation.state}, ${journal.transactionId}/${journal.state})`);
      }
    }
    if (finalized) {
      if (mutation.path === `${CONTROL_FOLDER}/${MANIFEST_NAME}`) {
        if (actual.id !== this.manifestFile.id) throw new Error("Drive transaction finalized a foreign manifest");
      } else if (mutation.path === `${GIT_FOLDER}/${BUNDLE_NAME}`) {
        if (actual.id !== this.manifest.bundle.fileId) throw new Error("Drive transaction finalized a foreign bundle");
      } else if (mutation.kind === "delete") {
        const tombstone = (this.manifest.tombstones[mutation.path] ?? []).find((entry) => entry.transactionId === journal.transactionId);
        if (!tombstone || tombstone.fileId !== actual.id) throw new Error(`Drive transaction finalized a foreign delete at ${mutation.path}`);
      } else {
        const target = mutation.kind === "move" ? mutation.destinationPath! : mutation.path;
        if (this.manifest.files[target]?.fileId !== actual.id) throw new Error(`Drive transaction finalized a foreign file at ${target}`);
      }
    }
  }

  private async resolveExistingFolder(path: string): Promise<string | null> {
    let parent = this.rootFolderId;
    if (!path) return parent;
    for (const part of path.split("/")) {
      const matches = (await this.listChildren(parent)).filter((file) => file.mimeType === FOLDER_MIME && file.name === part);
      if (matches.length > 1) throw new Error(`Drive folder path is ambiguous at ${path}`);
      if (!matches[0]) return null;
      parent = matches[0].id;
    }
    return parent;
  }

  private async preflightRecovery(remote: DriveVaultFile[]): Promise<void> {
    for (const file of remote) {
      if (file.appProperties?.[OPERATION_PROPERTY]?.startsWith("journal-conflict-")) continue;
      const journal = await this.options.client.download(file.id)
        .then((data) => JSON.parse(data.toString("utf8")) as DriveJournal)
        .catch(() => null);
      if (!journal) throw new Error(`Drive transaction journal ${file.id} is not valid JSON`);
      if (journal.bootstrap === true) {
        await this.validateBootstrapJournal(file, journal);
        continue;
      }
      await this.validateExecutableJournal(file, journal);
      await this.validateRecoveryManifest(journal);
    }
  }

  /**
   * Bind an executable journal to the exact base tree before any recovery
   * mutation. The only permitted path drift is an already-recorded, applied
   * move/delete from that same validated journal.
   */
  private async validateRecoveryManifest(journal: DriveJournal): Promise<void> {
    const finalized = this.manifest.revisionId === journal.transactionId && this.manifest.commitSha === journal.targetCommitSha;
    if (finalized || journal.state === "committed" || journal.state === "failed") return;
    const snapshot = await this.remoteSnapshot();
    for (const [path, entry] of Object.entries(this.manifest.files)) {
      const actual = snapshot[path];
      if (actual?.file.id === entry.fileId && actual.file.mimeType === entry.mimeType) continue;
      const transition = journal.mutations.find((mutation) => mutation.fileId === entry.fileId
        && mutation.path === path && (mutation.kind === "move" || mutation.kind === "delete"));
      if (!transition) throw new Error(`Drive vault manifest file is outside its exact path before recovery at ${path}`);
      const moved = await this.options.client.getFile(entry.fileId).catch(() => null);
      if (!moved) throw new Error(`Drive vault recovery target disappeared at ${path}`);
      if (transition.kind === "delete") {
        const archivedName = `${transition.operationId}-${posix.basename(path)}`;
        if (moved.name !== archivedName || moved.parents?.length !== 1 || moved.parents[0] !== this.deletedFolderId) {
          throw new Error(`Drive vault recovery delete escaped its exact archive at ${path}`);
        }
      } else {
        const target = transition.destinationPath!;
        const parentPath = posix.dirname(target) === "." ? "" : posix.dirname(target);
        const parentId = await this.resolveExistingFolder(parentPath);
        if (!parentId || moved.name !== posix.basename(target) || moved.parents?.length !== 1 || moved.parents[0] !== parentId) {
          throw new Error(`Drive vault recovery move escaped its exact destination at ${path}`);
        }
      }
      if (transition.state !== "conflict" && !await this.remoteContentMatches(moved, transition.expectedChecksum!)) {
        throw new Error(`Drive vault recovery result checksum mismatch at ${path}`);
      }
    }
  }

  private async recoverTransactions(): Promise<void> {
    const remote = await this.options.client.listFiles({ folderId: this.transactionsFolderId, pageSize: 1000, allPages: true });
    for (const file of remote.filter((candidate) => candidate.appProperties?.[OPERATION_PROPERTY]?.startsWith("journal-conflict-"))) {
      const marker = await this.options.client.download(file.id).then((data) => JSON.parse(data.toString("utf8")) as {
        schemaVersion?: unknown; kind?: unknown; transactionId?: unknown; tenantId?: unknown; vaultBindingId?: unknown;
      }).catch(() => null);
      const transactionId = file.appProperties![OPERATION_PROPERTY]!.slice("journal-conflict-".length);
      if (!marker || marker.schemaVersion !== 1 || marker.kind !== "journal_conflict" || marker.transactionId !== transactionId
        || marker.tenantId !== this.options.tenantId || marker.vaultBindingId !== this.options.vaultBindingId
        || file.name !== `${transactionId}.conflict.json` || file.parents?.length !== 1 || file.parents[0] !== this.transactionsFolderId) {
        throw new Error("Drive journal conflict marker validation failed");
      }
      throw new VaultPublicationError({
        code: "conflict", message: `Drive transaction journal ${transactionId} has a preserved external edit`,
        retryable: false, transactionId, paths: [`${CONTROL_FOLDER}/${TRANSACTIONS_FOLDER}/${transactionId}.json`],
      });
    }
    await this.preflightRecovery(remote);
    for (const file of remote.sort((left, right) => Number(Boolean(right.appProperties?.[OPERATION_PROPERTY]?.startsWith("journal-conflict-"))) - Number(Boolean(left.appProperties?.[OPERATION_PROPERTY]?.startsWith("journal-conflict-"))))) {
      if (file.appProperties?.[OPERATION_PROPERTY]?.startsWith("journal-conflict-")) {
        const marker = await this.options.client.download(file.id).then((data) => JSON.parse(data.toString("utf8")) as {
          schemaVersion?: unknown; kind?: unknown; transactionId?: unknown; tenantId?: unknown; vaultBindingId?: unknown;
        }).catch(() => null);
        const transactionId = file.appProperties[OPERATION_PROPERTY].slice("journal-conflict-".length);
        if (!marker || marker.schemaVersion !== 1 || marker.kind !== "journal_conflict" || marker.transactionId !== transactionId
          || marker.tenantId !== this.options.tenantId || marker.vaultBindingId !== this.options.vaultBindingId
          || file.name !== `${transactionId}.conflict.json` || file.parents?.length !== 1 || file.parents[0] !== this.transactionsFolderId) {
          throw new Error("Drive journal conflict marker validation failed");
        }
        throw new VaultPublicationError({
          code: "conflict", message: `Drive transaction journal ${transactionId} has a preserved external edit`,
          retryable: false, transactionId, paths: [`${CONTROL_FOLDER}/${TRANSACTIONS_FOLDER}/${transactionId}.json`],
        });
      }
      const journal = await this.options.client.download(file.id)
        .then((data) => JSON.parse(data.toString("utf8")) as DriveJournal)
        .catch(() => null);
      if (!journal) throw new Error(`Drive transaction journal ${file.id} is not valid JSON`);
      if (journal.bootstrap === true) {
        await this.validateBootstrapJournal(file, journal);
        if (journal.state !== "committed") {
          if (this.manifest.revisionId !== journal.transactionId || this.manifest.commitSha !== journal.targetCommitSha) {
            throw new Error("Drive bootstrap journal conflicts with manifest authority");
          }
          const bundle = await this.options.client.getFile(this.manifest.bundle.fileId);
          const bundleMutation = journal.mutations[0]!;
          const manifestMutation = journal.mutations[1]!;
          if (bundle.appProperties?.[OPERATION_PROPERTY] !== bundleMutation.operationId
            || this.manifestFile.appProperties?.[OPERATION_PROPERTY] !== manifestMutation.operationId) {
            throw new Error("Drive bootstrap result operation identity is invalid");
          }
          bundleMutation.resultingFile = bundle;
          bundleMutation.state = "applied";
          manifestMutation.resultingFile = this.manifestFile;
          manifestMutation.state = "applied";
          journal.state = "committed";
          journal.committedAt = this.manifest.committedAt;
          journal.updatedAt = this.now().toISOString();
          await this.updateRemoteJournal(file, journal);
        }
        continue;
      }
      await this.validateExecutableJournal(file, journal);
      if (journal.state === "committed" || journal.state === "failed") continue;
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
      const manifestFile = await this.options.client.getFile(this.manifestFile.id).catch(() => null);
      if (!manifestFile) throw new Error("Drive vault manifest authority disappeared during recovery");
      await this.loadManifest(manifestFile);
      await this.validateManifestControlAuthority(manifestFile, this.manifest);
      if (this.manifest.revisionId === journal.transactionId && this.manifest.commitSha === journal.targetCommitSha) {
        const results = await this.verifyFinalizedTransaction(journal, file);
        for (const [index, mutation] of journal.mutations.entries()) {
          mutation.state = "applied";
          mutation.resultingFile = results[index]!;
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

  private async verifyFinalizedTransaction(journal: DriveJournal, journalFile: DriveVaultFile): Promise<DriveVaultFile[]> {
    await this.verifyOrdinaryAuthority(this.manifest, journal, journalFile, "during finalized recovery");
    const bundleMutation = journal.mutations.find((mutation) => mutation.path === `${GIT_FOLDER}/${BUNDLE_NAME}`)!;
    const bundle = await this.options.client.getFile(this.manifest.bundle.fileId);
    const bundleData = await this.options.client.download(bundle.id);
    if (bundle.id !== bundleMutation.fileId || sha256(bundleData) !== bundleMutation.checksum
      || sha256(bundleData) !== this.manifest.bundle.checksum) throw new Error("Drive finalized transaction bundle proof failed");
    await this.verifyBundleData(bundleData, journal.targetCommitSha);

    const results: DriveVaultFile[] = [];
    for (const mutation of journal.mutations) {
      let actual: DriveVaultFile;
      if (mutation.path === `${CONTROL_FOLDER}/${MANIFEST_NAME}`) actual = this.manifestFile;
      else if (mutation.path === `${GIT_FOLDER}/${BUNDLE_NAME}`) actual = bundle;
      else if (mutation.kind === "delete") {
        const tombstone = (this.manifest.tombstones[mutation.path] ?? []).find((entry) => entry.transactionId === journal.transactionId);
        if (!tombstone) throw new Error(`Drive finalized transaction has no tombstone at ${mutation.path}`);
        actual = await this.options.client.getFile(tombstone.fileId);
      } else {
        const target = mutation.kind === "move" ? mutation.destinationPath! : mutation.path;
        const entry = this.manifest.files[target];
        if (!entry) throw new Error(`Drive finalized transaction has no file at ${target}`);
        actual = await this.options.client.getFile(entry.fileId);
      }
      await this.validateAppliedMutation({ ...mutation, state: "applied", resultingFile: actual }, journal, true);
      results.push(actual);
    }
    return results;
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
    const verifier = join(this.stateDir, `verify-repo-${this.idFactory()}`);
    const restored = join(this.stateDir, `verify-clone-${this.idFactory()}`);
    try {
      await writeFile(bundlePath, data);
      // Verification in the warm workspace can satisfy prerequisites from local
      // objects and therefore accept an incremental/thin bundle.  A Drive
      // authority bundle must stand alone for a cold machine.
      await simpleGit().init(["--initial-branch=main", verifier]);
      const isolatedGit = simpleGit(verifier);
      await isolatedGit.raw(["bundle", "verify", bundlePath]);
      const heads = await isolatedGit.raw(["bundle", "list-heads", bundlePath]);
      if (!heads.split("\n").some((line) => line.startsWith(`${expectedHead} `))) {
        throw new Error("Drive Git bundle does not contain the manifest commit");
      }
      await rm(restored, { recursive: true, force: true });
      await isolatedGit.clone(bundlePath, restored);
      const coldGit = simpleGit(restored);
      const coldHead = (await coldGit.revparse(["HEAD"])).trim();
      if (coldHead !== expectedHead) throw new Error("Drive Git bundle is not cold-cloneable at manifest HEAD");
    } finally {
      await rm(bundlePath, { force: true });
      await rm(verifier, { recursive: true, force: true });
      await rm(restored, { recursive: true, force: true });
    }
  }

  urlFor(path: string, anchor?: string): string | null {
    const entry = this.manifest?.files[normalizePath(path)];
    return entry ? (entry.webViewLink ? `${entry.webViewLink}${anchor ? `#${encodeURIComponent(anchor)}` : ""}` : driveUrl(entry.fileId, anchor)) : null;
  }
}
