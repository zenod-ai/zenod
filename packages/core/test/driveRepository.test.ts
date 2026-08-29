import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEngine,
  DriveVaultRepository,
  ensureSchemaV1,
  SqliteStateStore,
  VaultPublicationError,
  type BrainLlm,
  type DriveVaultClient,
  type DriveVaultFile,
  type DriveVaultPrecondition,
  type DriveVaultRevisionRecord,
} from "../src/index.js";

interface Stored extends DriveVaultFile { data: Buffer }

class FakeDrive implements DriveVaultClient {
  readonly files = new Map<string, Stored>();
  readonly revisions = new Map<string, Array<DriveVaultRevisionRecord & { data: Buffer }>>();
  mutationCount = 0;
  readonly listRequests: Array<{ folderId?: string; nameContains?: string; pageSize?: number; foldersOnly?: boolean; allPages?: boolean; appProperties?: Record<string, string> }> = [];
  failAt: { call: number; phase: "before" | "after" } | null = null;
  faultTriggered = false;
  revoked = false;
  raceWindow: "before_patch" | "after_patch" | null = null;
  raceData = "# Concurrent external edit\n";
  raceTargetName = "Home.md";
  raceMutation: "update" | "move" = "update";
  failMovePhase: "before" | "after" | null = null;
  authorityRace: { targetName: string; phase: "before_patch" | "after_patch"; externalFileId: string; data: string } | null = null;
  tombstoneRaceFileId: string | null = null;
  private nextId = 1;

  constructor() {
    this.files.set("my-drive", this.folder("my-drive", "My Drive", []));
  }

  private folder(id: string, name: string, parents: string[]): Stored {
    return { id, name, parents, mimeType: "application/vnd.google-apps.folder", version: "1", modifiedTime: "2026-08-29T00:00:00.000Z", appProperties: {}, data: Buffer.alloc(0) };
  }

  private async mutate<T>(run: () => T): Promise<T> {
    if (this.revoked) throw new Error("Drive API failed (401): authorization revoked");
    this.mutationCount += 1;
    const shouldFail = this.failAt?.call === this.mutationCount;
    if (shouldFail && this.failAt?.phase === "before") {
      this.faultTriggered = true;
      this.failAt = null;
      throw new Error("injected failure before remote mutation");
    }
    const result = run();
    if (shouldFail && this.failAt?.phase === "after") {
      this.faultTriggered = true;
      this.failAt = null;
      throw new Error("injected failure after remote mutation");
    }
    return result;
  }

  private clone(file: Stored): DriveVaultFile {
    const { data: _, ...metadata } = file;
    return structuredClone(metadata);
  }

  private getStored(id: string): Stored {
    if (this.revoked) throw new Error("Drive API failed (401): authorization revoked");
    const file = this.files.get(id);
    if (!file) throw new Error(`Drive API failed (404): ${id} not found`);
    return file;
  }

  private updateMetadata(file: Stored, contentChanged = false): void {
    file.version = String(Number(file.version ?? "0") + 1);
    file.modifiedTime = `2026-08-29T00:00:${String(this.mutationCount).padStart(2, "0")}.000Z`;
    file.md5Checksum = createHash("md5").update(file.data).digest("hex");
    if (contentChanged) {
      const history = this.revisions.get(file.id) ?? [];
      const revision = { id: `rev-${file.id}-${history.length + 1}`, modifiedTime: file.modifiedTime, md5Checksum: file.md5Checksum, keepForever: false, data: Buffer.from(file.data) };
      history.push(revision);
      this.revisions.set(file.id, history);
      file.headRevisionId = revision.id;
    }
  }

  async ensureVaultRootFolder(vaultBindingId: string, storedFolderId?: string | null): Promise<{ folderId: string; created: boolean }> {
    const marker = `v1:${vaultBindingId}`;
    if (storedFolderId && this.files.get(storedFolderId)?.appProperties?.zenodVaultBinding === marker) return { folderId: storedFolderId, created: false };
    const existing = [...this.files.values()].find((file) => file.appProperties?.zenodVaultBinding === marker);
    if (existing) return { folderId: existing.id, created: false };
    return this.mutate(() => {
      const id = `file-${this.nextId++}`;
      const file = this.folder(id, "Zenod Vault", ["my-drive"]);
      file.appProperties = { zenodVaultBinding: marker };
      this.files.set(id, file);
      return { folderId: id, created: true };
    });
  }

  async ensureFolder(name: string, parentId: string, options: { appProperties?: Record<string, string> } = {}): Promise<string> {
    const existing = [...this.files.values()].find((file) => file.name === name && file.parents?.includes(parentId)
      && file.mimeType === "application/vnd.google-apps.folder"
      && Object.entries(options.appProperties ?? {}).every(([key, value]) => file.appProperties?.[key] === value));
    if (existing) return existing.id;
    return this.mutate(() => {
      const id = `file-${this.nextId++}`;
      const folder = this.folder(id, name, [parentId]);
      folder.appProperties = options.appProperties ?? {};
      this.files.set(id, folder);
      return id;
    });
  }

  async listFiles(options: { folderId?: string; nameContains?: string; pageSize?: number; foldersOnly?: boolean; allPages?: boolean; appProperties?: Record<string, string> } = {}): Promise<DriveVaultFile[]> {
    if (this.revoked) throw new Error("Drive API failed (401): authorization revoked");
    this.listRequests.push(structuredClone(options));
    return [...this.files.values()]
      .filter((file) => !options.folderId || file.parents?.includes(options.folderId))
      .filter((file) => !options.nameContains || file.name.includes(options.nameContains))
      .filter((file) => Object.entries(options.appProperties ?? {}).every(([key, value]) => file.appProperties?.[key] === value))
      .filter((file) => options.foldersOnly ? file.mimeType === "application/vnd.google-apps.folder" : file.mimeType !== "application/vnd.google-apps.folder")
      .slice(0, options.pageSize ?? 50)
      .map((file) => this.clone(file));
  }

  async getFile(fileId: string): Promise<DriveVaultFile> { return this.clone(this.getStored(fileId)); }
  async download(fileId: string): Promise<Buffer> { return Buffer.from(this.getStored(fileId).data); }

  async uploadFile(name: string, mimeType: string, data: Buffer, parentFolderId: string, options: { appProperties?: Record<string, string> } = {}): Promise<DriveVaultFile> {
    return this.mutate(() => {
      const id = `file-${this.nextId++}`;
      const file: Stored = { id, name, mimeType, data: Buffer.from(data), parents: [parentFolderId], appProperties: options.appProperties ?? {}, webViewLink: `https://drive.google.test/file/${id}`, version: "0" };
      this.updateMetadata(file, true);
      this.files.set(id, file);
      return this.clone(file);
    });
  }

  private assertPrecondition(file: Stored, precondition: DriveVaultPrecondition): void {
    if (precondition.expectedVersion && file.version !== precondition.expectedVersion) throw new Error(`Drive file conflict: version changed for ${file.id}`);
    if (precondition.expectedModifiedTime && file.modifiedTime !== precondition.expectedModifiedTime) throw new Error(`Drive file conflict: modified time changed for ${file.id}`);
    if (precondition.expectedChecksum && createHash("sha256").update(file.data).digest("hex") !== precondition.expectedChecksum) throw new Error(`Drive file conflict: checksum changed for ${file.id}`);
  }

  async updateFile(fileId: string, mimeType: string, data: Buffer, precondition: DriveVaultPrecondition): Promise<DriveVaultFile> {
    const file = this.getStored(fileId);
    this.assertPrecondition(file, precondition);
    return this.mutate(() => {
      const authorityRace = this.authorityRace
        && (this.authorityRace.targetName === file.name || (this.authorityRace.targetName === "transaction.json" && file.name.endsWith(".json") && file.name !== "manifest.json"))
        ? this.authorityRace : null;
      if (authorityRace?.phase === "before_patch") {
        this.authorityRace = null;
        this.externalEdit(authorityRace.externalFileId === "self" ? fileId : authorityRace.externalFileId, authorityRace.data);
      }
      const race = file.name === this.raceTargetName ? this.raceWindow : null;
      if (race === "before_patch") this.externalEdit(fileId, this.raceData);
      file.mimeType = mimeType;
      file.data = Buffer.from(data);
      this.updateMetadata(file, true);
      const response = this.clone(file);
      if (this.tombstoneRaceFileId && file.name.endsWith(".json") && file.name !== "manifest.json"
        && data.toString("utf8").includes('"kind": "delete"') && data.toString("utf8").includes('"state": "applied"')) {
        const target = this.tombstoneRaceFileId;
        this.tombstoneRaceFileId = null;
        this.externalEdit(target, "externally changed after archive\n");
      }
      if (race === "after_patch") this.externalEdit(fileId, this.raceData);
      if (authorityRace?.phase === "after_patch") {
        this.authorityRace = null;
        this.externalEdit(authorityRace.externalFileId === "self" ? fileId : authorityRace.externalFileId, authorityRace.data);
      }
      if (race) this.raceWindow = null;
      return response;
    });
  }

  async moveFile(fileId: string, toFolderId: string, precondition: DriveVaultPrecondition = {}, newName?: string): Promise<DriveVaultFile> {
    const file = this.getStored(fileId);
    this.assertPrecondition(file, precondition);
    const race = this.raceMutation === "move" && file.name === this.raceTargetName ? this.raceWindow : null;
    if (this.failMovePhase === "before") {
      this.failMovePhase = null;
      throw new Error("injected failure before Drive move");
    }
    if (race === "before_patch") this.externalEdit(fileId, this.raceData);
    const moved = await this.mutate(() => {
      file.parents = [toFolderId];
      if (newName) file.name = newName;
      this.updateMetadata(file);
      return this.clone(file);
    });
    if (race === "after_patch") this.externalEdit(fileId, this.raceData);
    if (race) this.raceWindow = null;
    if (this.failMovePhase === "after") {
      this.failMovePhase = null;
      throw new Error("injected failure after Drive move");
    }
    return moved;
  }

  async listRevisions(fileId: string): Promise<DriveVaultRevisionRecord[]> {
    return (this.revisions.get(fileId) ?? []).map(({ data: _, ...revision }) => structuredClone(revision));
  }

  async keepRevision(fileId: string, revisionId: string): Promise<void> {
    const revision = this.revisions.get(fileId)?.find((candidate) => candidate.id === revisionId);
    if (!revision) throw new Error(`Drive revision ${revisionId} not found`);
    await this.mutate(() => { revision.keepForever = true; });
  }

  async downloadRevision(fileId: string, revisionId: string): Promise<Buffer> {
    const revision = this.revisions.get(fileId)?.find((candidate) => candidate.id === revisionId);
    if (!revision || !revision.keepForever) throw new Error(`Drive revision ${revisionId} is not preserved`);
    return Buffer.from(revision.data);
  }

  resetMutationCounter(): void { this.mutationCount = 0; this.faultTriggered = false; }

  externalEdit(fileId: string, data: string): void {
    this.externalWrite(fileId, Buffer.from(data));
  }

  externalWrite(fileId: string, data: Buffer): void {
    const file = this.getStored(fileId);
    file.data = Buffer.from(data);
    this.mutationCount += 1;
    this.updateMetadata(file, true);
  }

  externalRename(fileId: string, name: string): void {
    const file = this.getStored(fileId);
    file.name = name;
    this.mutationCount += 1;
    this.updateMetadata(file);
  }

  externalRemove(fileId: string): void {
    this.files.delete(fileId);
    this.mutationCount += 1;
  }

  corrupt(fileId: string): void { this.getStored(fileId).data = Buffer.from("corrupt"); }
}

const dirs: string[] = [];

async function temp(name: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `zenod-drive-${name}-`));
  dirs.push(path, `${path}.state`);
  return path;
}

async function open(client: FakeDrive, workdir: string, binding = "binding-one"): Promise<DriveVaultRepository> {
  return DriveVaultRepository.open({
    client,
    workdir,
    stateDir: `${workdir}.state`,
    tenantId: `tenant-${binding}`,
    vaultBindingId: binding,
    now: () => new Date("2026-08-29T12:00:00.000Z"),
  });
}

async function writeVaultFile(workdir: string, path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(join(workdir, path)), { recursive: true });
  await writeFile(join(workdir, path), data);
}

function fakeJournalDigest(journal: any): string {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: journal.schemaVersion,
    transactionId: journal.transactionId,
    tenantId: journal.tenantId,
    vaultBindingId: journal.vaultBindingId,
    message: journal.message,
    baseRevisionId: journal.baseRevisionId,
    targetCommitSha: journal.targetCommitSha,
    bootstrap: journal.bootstrap === true,
    replacementFiles: journal.replacementFiles ?? null,
    mutations: journal.mutations.map((mutation: any) => ({
      operationId: mutation.operationId, kind: mutation.kind, path: mutation.path,
      destinationPath: mutation.destinationPath ?? null, fileId: mutation.fileId ?? null,
      parentPath: mutation.parentPath ?? null,
      mimeType: mutation.path === ".zenod/manifest.json" ? null : mutation.mimeType ?? null,
      checksum: mutation.path === ".zenod/manifest.json" ? null : mutation.checksum ?? null,
      expectedVersion: mutation.expectedVersion ?? null,
      expectedModifiedTime: mutation.expectedModifiedTime ?? null,
      expectedChecksum: mutation.expectedChecksum ?? null,
    })),
  })).digest("hex");
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("DriveVaultRepository", () => {
  it("runs the real engine store/search/get/ask loop and publishes Log plus meaning page", async () => {
    const drive = new FakeDrive();
    const workdir = await temp("engine");
    const repo = await open(drive, workdir);
    await ensureSchemaV1(workdir);
    const state = new SqliteStateStore(":memory:");
    const llm: BrainLlm = {
      async classify() {
        return {
          disposition: "integrate_page",
          confidence: 0.95,
          summary: "record insurance renewal",
          tags: ["insurance"],
          pages: [{ path: "Areas/Insurance.md", action: "create", title: "Insurance" }],
        };
      },
      async composePage(input) {
        return [
          "---", "title: Insurance", "type: area", "tags: [insurance]",
          `created: ${input.today}`, `updated: ${input.today}`,
          "summary: Active insurance details.", "---", "", "# Insurance", "",
          `- Policy renewal recorded (${input.citation}).`,
          "- See [[Areas/Areas Index|Areas]].", "",
        ].join("\n");
      },
      async describeImage() { return "image"; },
      async answer() { return { text: "The policy renewal is recorded.", readPaths: ["Areas/Insurance.md"] }; },
      async work() { return { text: "No work" }; },
      async extractBacklog() { return { candidates: [] }; },
    };
    try {
      const engine = createEngine({ repo, llm, state, readSyncTtlMs: 0 });
      const stored = await engine.store({ content: "My insurance renews in March 2027.", source: "cli" });
      expect(stored.revision).toMatchObject({
        provider: "google_drive",
        id: expect.any(String),
        commitSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      });
      expect(stored.revision?.id).not.toBe(stored.revision?.commitSha);
      expect(stored.githubUrls).toBeUndefined();
      expect([...drive.files.values()].some((file) => file.name === "Insurance.md")).toBe(true);
      expect([...drive.files.values()].some((file) => file.name === "2026-08-29.md")).toBe(true);
      expect((await engine.search("insurance"))[0]?.provider).toBe("google_drive");
      expect((await engine.get("Areas/Insurance.md")).provider).toBe("google_drive");
      expect((await engine.ask("What did I record?")).text).toContain("renewal");
    } finally {
      state.close();
    }
  });

  it("publishes ordinary Markdown and attachments with independent Drive/Git provenance and cold-start reconstruction", async () => {
    const drive = new FakeDrive();
    const workdir = await temp("publish");
    const repo = await open(drive, workdir);
    await writeVaultFile(workdir, "Log/2026-08-29.md", "# evidence\n");
    await writeVaultFile(workdir, "Areas/Home.md", "# Home\n");
    await writeVaultFile(workdir, "_attachments/source.bin", Buffer.from([0, 1, 2, 255]));

    const revision = await repo.commitAndPublish("memory: capture evidence");

    expect(revision.provider).toBe("google_drive");
    expect(revision.id).not.toBe(revision.commitSha);
    expect(revision.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(revision.githubUrls).toBeUndefined();
    expect(revision.urls).toHaveLength(3);
    expect(await simpleGit(workdir).getRemotes()).toEqual([]);

    const rebuilt = await temp("rebuilt");
    const recovered = await open(drive, rebuilt);
    expect(await readFile(join(rebuilt, "Areas/Home.md"), "utf8")).toBe("# Home\n");
    expect(await readFile(join(rebuilt, "_attachments/source.bin"))).toEqual(Buffer.from([0, 1, 2, 255]));
    expect((await recovered.currentRevision()).commitSha).toBe(revision.commitSha);
    expect(await simpleGit(rebuilt).getRemotes()).toEqual([]);
  });

  it("imports an external Markdown edit as an explicit Git commit", async () => {
    const drive = new FakeDrive();
    const first = await temp("external-first");
    const repo = await open(drive, first);
    await writeVaultFile(first, "Areas/Home.md", "# Home\n");
    const published = await repo.commitAndPublish("seed home");
    const fileId = [...drive.files.values()].find((file) => file.name === "Home.md")!.id;
    drive.externalEdit(fileId, "# Home\n\nEdited in Drive.\n");

    const second = await temp("external-second");
    const imported = await open(drive, second);
    const revision = await imported.currentRevision();
    expect(revision.commitSha).not.toBe(published.commitSha);
    expect((await simpleGit(second).log()).latest?.message).toBe("Import external Google Drive edits");
    expect(await readFile(join(second, "Areas/Home.md"), "utf8")).toContain("Edited in Drive");
  });

  it("recovers renamed root/control/manifest authority and refuses missing-manifest reprovision", async () => {
    const drive = new FakeDrive();
    const first = await temp("renamed-authority");
    const repo = await open(drive, first);
    await writeVaultFile(first, "Notes/Home.md", "# Home\n");
    const revision = await repo.commitAndPublish("seed authority");
    const root = [...drive.files.values()].find((file) => file.appProperties?.zenodVaultBinding === "v1:binding-one")!;
    const control = [...drive.files.values()].find((file) => file.name === ".zenod" && file.parents?.includes(root.id))!;
    const manifest = [...drive.files.values()].find((file) => file.name === "manifest.json" && file.parents?.includes(control.id))!;
    drive.externalRename(root.id, "My renamed vault");
    drive.externalRename(control.id, "control-renamed");
    drive.externalRename(manifest.id, "authority-renamed.json");

    const rebuilt = await temp("renamed-authority-rebuilt");
    expect((await open(drive, rebuilt)).urlFor("Notes/Home.md")).toContain("file-");
    expect((await simpleGit(rebuilt).revparse(["HEAD"])).trim()).toBe(revision.commitSha);

    drive.externalRemove(manifest.id);
    const before = [...drive.files.values()].filter((file) => file.name === "repository.bundle").length;
    await expect(open(drive, await temp("missing-authority"))).rejects.toThrow(/incomplete|manifest authority/i);
    expect([...drive.files.values()].filter((file) => file.name === "repository.bundle")).toHaveLength(before);
  });

  it("never bootstraps a second authority when all control blobs were removed from a marked root", async () => {
    const drive = new FakeDrive();
    await open(drive, await temp("removed-control-seed"));
    for (const file of [...drive.files.values()]) {
      if (file.name === "manifest.json" || file.name === "repository.bundle" || file.name.endsWith(".json")) drive.externalRemove(file.id);
    }
    const before = drive.mutationCount;
    const beforeIds = [...drive.files.keys()].sort();
    await expect(open(drive, await temp("removed-control-restart"))).rejects.toThrow(/incomplete|existing marked root/i);
    expect(drive.mutationCount).toBe(before);
    expect([...drive.files.keys()].sort()).toEqual(beforeIds);
    expect([...drive.files.values()].some((file) => file.name === "manifest.json" || file.name === "repository.bundle")).toBe(false);
  });

  it.each([
    { bundle: true, archive: false, label: "nested bundle" },
    { bundle: false, archive: true, label: "nested tombstone" },
    { bundle: true, archive: true, label: "nested bundle and tombstone" },
  ])("rejects $label remnants before any bootstrap write", async ({ bundle, archive }) => {
    const drive = new FakeDrive();
    const workdir = await temp(`nested-remnant-${Number(bundle)}-${Number(archive)}`);
    const repo = await open(drive, workdir);
    await writeVaultFile(workdir, "Notes/Old.md", "old authority\n");
    await repo.commitAndPublish("seed nested authority");
    if (archive) {
      await rm(join(workdir, "Notes/Old.md"));
      await repo.commitAndPublish("archive old authority");
    }
    const root = [...drive.files.values()].find((file) => file.appProperties?.zenodVaultBinding === "v1:binding-one")!;
    const git = [...drive.files.values()].find((file) => file.appProperties?.zenodVaultRole === "git-folder")!;
    const control = [...drive.files.values()].find((file) => file.appProperties?.zenodVaultRole === "control-folder")!;
    const transactions = [...drive.files.values()].find((file) => file.appProperties?.zenodVaultRole === "transactions-folder")!;
    for (const file of [...drive.files.values()]) {
      const isStandardRootChild = file.parents?.includes(root.id) && file.id !== git.id && file.id !== control.id;
      const isManifest = file.name === "manifest.json";
      const isJournal = file.parents?.includes(transactions.id);
      const isBundle = file.name === "repository.bundle";
      const isArchive = file.parents?.includes([...drive.files.values()].find((candidate) => candidate.appProperties?.zenodVaultRole === "deleted-folder")!.id);
      if (isStandardRootChild || isManifest || isJournal || (isBundle && !bundle) || (isArchive && !archive)) drive.externalRemove(file.id);
    }
    const before = drive.mutationCount;
    const beforeIds = [...drive.files.keys()].sort();
    await expect(open(drive, await temp(`nested-remnant-restart-${Number(bundle)}-${Number(archive)}`))).rejects.toThrow(/prior-authority remnants/);
    expect(drive.mutationCount).toBe(before);
    expect([...drive.files.keys()].sort()).toEqual(beforeIds);
    expect([...drive.files.values()].filter((file) => file.name === "manifest.json")).toHaveLength(0);
    expect([...drive.files.values()].filter((file) => file.parents?.includes(transactions.id))).toHaveLength(0);
    expect([...drive.files.values()].filter((file) => file.name === "repository.bundle")).toHaveLength(bundle ? 1 : 0);
  });

  it("discovers authority only through the selected root and marker-scoped children", async () => {
    const drive = new FakeDrive();
    await open(drive, await temp("bounded-discovery-seed"));
    drive.listRequests.length = 0;
    await open(drive, await temp("bounded-discovery-restart"));
    expect(drive.listRequests.every((request) => Boolean(request.folderId))).toBe(true);
    expect(drive.listRequests).toContainEqual(expect.objectContaining({
      appProperties: { zenodVaultBinding: "binding-one", zenodVaultRole: "manifest" },
    }));
  });

  it("recovers bootstrap from failures before and after every mutation, starting with root creation", async () => {
    for (const phase of ["before", "after"] as const) {
      let reachedEnd = false;
      for (let call = 1; call <= 20; call += 1) {
        const drive = new FakeDrive();
        drive.failAt = { call, phase };
        await open(drive, await temp(`bootstrap-fault-${call}-${phase}`)).catch(() => null);
        if (!drive.faultTriggered) {
          reachedEnd = true;
          break;
        }
        drive.failAt = null;
        const recovered = await open(drive, await temp(`bootstrap-recover-${call}-${phase}`));
        expect((await recovered.currentRevision()).commitSha).toMatch(/^[0-9a-f]{40}$/);
        const roots = [...drive.files.values()].filter((file) => file.appProperties?.zenodVaultBinding === "v1:binding-one");
        expect(roots).toHaveLength(1);
        const roleCount = (role: string) => [...drive.files.values()].filter((file) => file.appProperties?.zenodVaultBinding === "binding-one"
          && file.appProperties?.zenodVaultRole === role).length;
        for (const role of ["git-folder", "control-folder", "transactions-folder", "deleted-folder", "bundle", "manifest"]) {
          expect(roleCount(role), `${role} count after ${phase} fault ${call}`).toBe(1);
        }
      }
      expect(reachedEnd, `bootstrap fault matrix exceeded 20 mutations for ${phase}`).toBe(true);
    }
  }, 120_000);

  it("rejects a prerequisite-dependent bundle that only verifies in a warm repository", async () => {
    const drive = new FakeDrive();
    const workdir = await temp("thin-bundle");
    const repo = await open(drive, workdir);
    await writeVaultFile(workdir, "Notes/One.md", "one\n");
    await repo.commitAndPublish("one");
    await writeVaultFile(workdir, "Notes/Two.md", "two\n");
    await repo.commitAndPublish("two");
    const thinPath = join(await temp("thin-file"), "incremental.bundle");
    await simpleGit(workdir).raw(["bundle", "create", thinPath, "HEAD", "^HEAD^"]);
    await simpleGit(workdir).raw(["bundle", "verify", thinPath]);
    const thin = await readFile(thinPath);
    const bundle = [...drive.files.values()].find((file) => file.name === "repository.bundle")!;
    drive.externalWrite(bundle.id, thin);
    const manifestFile = [...drive.files.values()].find((file) => file.name === "manifest.json")!;
    const manifest = JSON.parse(manifestFile.data.toString("utf8"));
    manifest.bundle.checksum = createHash("sha256").update(thin).digest("hex");
    manifest.bundle.version = bundle.version;
    manifest.bundle.modifiedTime = bundle.modifiedTime;
    manifest.bundle.headRevisionId = bundle.headRevisionId;
    drive.externalWrite(manifestFile.id, Buffer.from(JSON.stringify(manifest, null, 2)));
    await expect(repo.currentRevision()).rejects.toThrow(/prerequisite|clone|bundle/i);
    await expect(open(drive, workdir)).rejects.toThrow(/prerequisite|clone|bundle/i);
  });

  it.each(["corrupt", "missing"] as const)("verifies %s remote bundle even when the warm cache HEAD matches", async (mode) => {
    const drive = new FakeDrive();
    const workdir = await temp(`warm-bundle-${mode}`);
    await open(drive, workdir);
    const bundle = [...drive.files.values()].find((file) => file.name === "repository.bundle")!;
    if (mode === "corrupt") drive.corrupt(bundle.id);
    else drive.externalRemove(bundle.id);
    await expect(open(drive, workdir)).rejects.toThrow(/bundle|not found/i);
  });

  it.each([
    { targetName: "repository.bundle", phase: "before_patch" as const },
    { targetName: "manifest.json", phase: "after_patch" as const },
  ])("fails closed when an imported file changes $phase of $targetName publication", async ({ targetName, phase }) => {
    const drive = new FakeDrive();
    const first = await temp(`import-race-${targetName}-${phase}`);
    const repo = await open(drive, first);
    await writeVaultFile(first, "Areas/Home.md", "# Home\n");
    await repo.commitAndPublish("seed import race");
    const home = [...drive.files.values()].find((file) => file.name === "Home.md")!;
    drive.externalEdit(home.id, "# First external edit\n");
    drive.authorityRace = { targetName, phase, externalFileId: home.id, data: "# Second external edit\n" };
    const second = await temp(`import-race-rebuild-${targetName}-${phase}`);
    await expect(open(drive, second)).rejects.toMatchObject({ failure: { code: "partial_recovering" } });
    expect(drive.files.get(home.id)?.data.toString()).toBe("# Second external edit\n");
    const restart = await temp(`import-race-restart-${targetName}-${phase}`);
    await expect(open(drive, restart)).rejects.toMatchObject({ failure: { code: "partial_recovering" } });
  });

  it("rejects local or external evidence rewrites before publication/import", async () => {
    const drive = new FakeDrive();
    const workdir = await temp("immutability");
    const repo = await open(drive, workdir);
    await writeVaultFile(workdir, "Log/2026-08-29.md", "# Original evidence\n");
    await repo.commitAndPublish("seed evidence");
    await writeVaultFile(workdir, "Log/2026-08-29.md", "# Rewritten locally\n");
    await expect(repo.commitAndPublish("rewrite")).rejects.toMatchObject({ failure: { code: "failed_before_write" } });
    await repo.discardChanges();

    const log = [...drive.files.values()].find((file) => file.name === "2026-08-29.md")!;
    drive.externalEdit(log.id, "# Rewritten externally\n");
    const restarted = await temp("immutability-restart");
    await expect(open(drive, restarted)).rejects.toMatchObject({ failure: { code: "conflict", paths: ["Log/2026-08-29.md"] } });
  });

  it("preserves stable Drive IDs across update and move, then deletes explicitly", async () => {
    const drive = new FakeDrive();
    const workdir = await temp("mutations");
    const repo = await open(drive, workdir);
    await writeVaultFile(workdir, "Areas/Home.md", "# Home\n");
    await repo.commitAndPublish("create");
    const created = [...drive.files.values()].find((file) => file.name === "Home.md")!;

    await writeVaultFile(workdir, "Areas/Home.md", "# Home updated\n");
    await repo.commitAndPublish("update");
    expect(drive.files.get(created.id)?.data.toString()).toBe("# Home updated\n");

    await mkdir(join(workdir, "Notes"), { recursive: true });
    await import("node:fs/promises").then(({ rename }) => rename(join(workdir, "Areas/Home.md"), join(workdir, "Notes/Home.md")));
    await repo.commitAndPublish("move");
    expect(drive.files.get(created.id)?.name).toBe("Home.md");
    expect(repo.urlFor("Areas/Home.md")).toBeNull();
    expect(repo.urlFor("Notes/Home.md")).toContain(created.id);

    await rm(join(workdir, "Notes/Home.md"));
    await repo.commitAndPublish("delete");
    expect(drive.files.has(created.id)).toBe(true);
    expect(repo.urlFor("Notes/Home.md")).toBeNull();
    expect(drive.files.get(created.id)?.name).toContain("Home.md");
    expect(drive.files.get(created.id)?.parents).toContain(
      [...drive.files.values()].find((file) => file.name === "deleted")!.id,
    );
    const manifestFile = [...drive.files.values()].find((file) => file.name === "manifest.json")!;
    const manifest = JSON.parse(manifestFile.data.toString("utf8")) as { tombstones: Record<string, Array<{ fileId: string; archivedName: string }>> };
    expect(manifest.tombstones["Notes/Home.md"]).toEqual([
      expect.objectContaining({ fileId: created.id, archivedName: expect.stringMatching(/-Home\.md$/) }),
    ]);

    const restartedDir = await temp("mutations-restart");
    const restarted = await open(drive, restartedDir);
    expect(await readFile(join(restartedDir, "Notes/Home.md"), "utf8").catch(() => null)).toBeNull();
    expect(restarted.urlFor("Notes/Home.md")).toBeNull();
  });

  it("retains each stable Drive ID when identical-content files move together", async () => {
    const drive = new FakeDrive();
    const workdir = await temp("identical-moves");
    const repo = await open(drive, workdir);
    await writeVaultFile(workdir, "Areas/Alpha.md", "identical\n");
    await writeVaultFile(workdir, "Projects/Beta.md", "identical\n");
    await repo.commitAndPublish("seed identical files");
    const alphaId = [...drive.files.values()].find((file) => file.name === "Alpha.md")!.id;
    const betaId = [...drive.files.values()].find((file) => file.name === "Beta.md")!.id;
    await mkdir(join(workdir, "Notes"), { recursive: true });
    await mkdir(join(workdir, "Inbox"), { recursive: true });
    const { rename } = await import("node:fs/promises");
    await rename(join(workdir, "Areas/Alpha.md"), join(workdir, "Notes/Alpha.md"));
    await rename(join(workdir, "Projects/Beta.md"), join(workdir, "Inbox/Beta.md"));
    await repo.commitAndPublish("move identical files");
    expect(repo.urlFor("Notes/Alpha.md")).toContain(alphaId);
    expect(repo.urlFor("Inbox/Beta.md")).toContain(betaId);
    expect([...drive.files.values()].filter((file) => file.name === "Alpha.md")).toHaveLength(1);
    expect([...drive.files.values()].filter((file) => file.name === "Beta.md")).toHaveLength(1);
  });

  it.each(["before", "after"] as const)("replays a delete idempotently after a failure %s the archive move", async (phase) => {
    const drive = new FakeDrive();
    const workdir = await temp(`delete-fault-${phase}`);
    const repo = await open(drive, workdir);
    await writeVaultFile(workdir, "Notes/Delete.md", "delete me\n");
    await repo.commitAndPublish("seed delete");
    await rm(join(workdir, "Notes/Delete.md"));
    drive.failMovePhase = phase;
    await expect(repo.commitAndPublish("delete with fault")).rejects.toMatchObject({ failure: { code: "partial_recovering" } });

    const restartedDir = await temp(`delete-fault-restart-${phase}`);
    const restarted = await open(drive, restartedDir);
    expect(restarted.urlFor("Notes/Delete.md")).toBeNull();
    const manifestFile = [...drive.files.values()].find((file) => file.name === "manifest.json")!;
    const manifest = JSON.parse(manifestFile.data.toString("utf8")) as { tombstones: Record<string, unknown[]> };
    expect(manifest.tombstones["Notes/Delete.md"]).toHaveLength(1);
    expect([...drive.files.values()].filter((file) => file.name.endsWith("-Delete.md"))).toHaveLength(1);
  });

  it("fails closed when archived bytes change after delete evidence is journaled", async () => {
    const drive = new FakeDrive();
    const workdir = await temp("delete-archive-race");
    const repo = await open(drive, workdir);
    await writeVaultFile(workdir, "Notes/Delete.md", "delete me\n");
    const base = await repo.commitAndPublish("seed delete race");
    const file = [...drive.files.values()].find((candidate) => candidate.name === "Delete.md")!;
    await rm(join(workdir, "Notes/Delete.md"));
    drive.tombstoneRaceFileId = file.id;
    await expect(repo.commitAndPublish("delete with archive race")).rejects.toMatchObject({ failure: { code: "partial_recovering" } });
    const manifest = [...drive.files.values()].find((candidate) => candidate.name === "manifest.json")!;
    expect(JSON.parse(manifest.data.toString("utf8")).revisionId).toBe(base.id);
    await expect(open(drive, await temp("delete-archive-race-restart"))).rejects.toThrow(/checksum|authority changed|reconciliation/i);
  });

  it.each(["before_patch", "after_patch"] as const)("preserves an external edit racing delete %s", async (raceWindow) => {
    const drive = new FakeDrive();
    const workdir = await temp(`delete-race-${raceWindow}`);
    const repo = await open(drive, workdir);
    await writeVaultFile(workdir, "Notes/Home.md", "# Home\n");
    await repo.commitAndPublish("seed delete race");
    await rm(join(workdir, "Notes/Home.md"));
    drive.raceMutation = "move";
    drive.raceWindow = raceWindow;
    drive.raceData = `# Delete race ${raceWindow}\n`;

    await expect(repo.commitAndPublish("racing delete")).rejects.toMatchObject({ failure: { code: "conflict", paths: ["Notes/Home.md"] } });
    const conflictFiles = await readdir(join(`${workdir}.state`, "conflicts"), { recursive: true });
    const materialized = conflictFiles.find((path) => String(path).endsWith("Home.md"))!;
    expect(await readFile(join(`${workdir}.state`, "conflicts", materialized), "utf8")).toBe(`# Delete race ${raceWindow}\n`);
    const restartedDir = await temp(`delete-race-restart-${raceWindow}`);
    await expect(open(drive, restartedDir)).rejects.toMatchObject({ failure: { code: "conflict", paths: ["Notes/Home.md"] } });
  });

  it("fails closed on concurrent edits and revoked authorization without deleting Drive files", async () => {
    const drive = new FakeDrive();
    const workdir = await temp("conflict");
    const repo = await open(drive, workdir);
    await writeVaultFile(workdir, "Areas/Home.md", "# Home\n");
    await repo.commitAndPublish("seed home");
    await writeVaultFile(workdir, "Areas/Home.md", "# Local edit\n");
    const file = [...drive.files.values()].find((candidate) => candidate.name === "Home.md")!;
    drive.externalEdit(file.id, "# External edit\n");
    await expect(repo.commitAndPublish("local edit")).rejects.toMatchObject({ failure: { code: "conflict", paths: ["Areas/Home.md"] } });

    const count = drive.files.size;
    drive.revoked = true;
    await expect(repo.pull()).rejects.toThrow(/authorization revoked/);
    expect(drive.files.size).toBe(count);
  });

  it.each(["before_patch", "after_patch"] as const)(
    "preserves and materializes an external blob revision racing %s without finalizing",
    async (raceWindow) => {
      const drive = new FakeDrive();
      const workdir = await temp(`race-${raceWindow}`);
      const repo = await open(drive, workdir);
      await writeVaultFile(workdir, "Areas/Home.md", "# Home\n");
      const base = await repo.commitAndPublish("seed home");
      await writeVaultFile(workdir, "Areas/Home.md", "# Zenod update\n");
      drive.raceWindow = raceWindow;
      drive.raceData = `# External ${raceWindow}\n`;

      await expect(repo.commitAndPublish("racing update")).rejects.toMatchObject({ failure: { code: "conflict", paths: ["Areas/Home.md"] } });
      expect((await repo.currentRevision()).id).toBe(base.id);
      const conflictRoot = join(`${workdir}.state`, "conflicts");
      const conflictFiles = await readdir(conflictRoot, { recursive: true });
      expect(conflictFiles.some((path) => String(path).endsWith("Home.md"))).toBe(true);
      const materialized = conflictFiles.find((path) => String(path).endsWith("Home.md"))!;
      expect(await readFile(join(conflictRoot, materialized), "utf8")).toBe(`# External ${raceWindow}\n`);

      const externalRevision = [...drive.revisions.values()].flat().find((revision) => revision.data.toString() === `# External ${raceWindow}\n`)!;
      const home = [...drive.files.values()].find((file) => file.name === "Home.md")!;
      expect(externalRevision.id === home.headRevisionId || externalRevision.keepForever).toBe(true);
      const restarted = await temp(`race-restart-${raceWindow}`);
      await expect(open(drive, restarted)).rejects.toMatchObject({ failure: { code: "conflict", paths: ["Areas/Home.md"] } });
    },
  );

  it.each(["before_patch", "after_patch"] as const)("fails closed when the durable journal races %s", async (phase) => {
    const drive = new FakeDrive();
    const workdir = await temp(`journal-race-${phase}`);
    const repo = await open(drive, workdir);
    const base = await repo.currentRevision();
    await writeVaultFile(workdir, "Notes/Race.md", "journal race\n");
    drive.authorityRace = { targetName: "transaction.json", phase, externalFileId: "self", data: '{"tampered":true}' };
    await expect(repo.commitAndPublish("journal race")).rejects.toMatchObject({ failure: { code: "conflict" } });
    expect((await repo.currentRevision()).id).toBe(base.id);
    const conflicts = await readdir(join(`${workdir}.state`, "conflicts"), { recursive: true });
    expect(conflicts.some((path) => String(path).includes("journal-"))).toBe(true);
    await expect(open(drive, await temp(`journal-race-restart-${phase}`))).rejects.toMatchObject({ failure: { code: "conflict" } });
  });

  it("recovers idempotently after failures before and after every publication mutation", async () => {
    for (const phase of ["before", "after"] as const) {
      let reachedEnd = false;
      for (let failureCall = 1; failureCall <= 20; failureCall += 1) {
        const drive = new FakeDrive();
        const workdir = await temp(`fault-${phase}-${failureCall}`);
        const repo = await open(drive, workdir);
        await writeVaultFile(workdir, "Log/2026-08-29.md", "# evidence\n");
        await writeVaultFile(workdir, "Areas/Home.md", "# Home\n");
        drive.resetMutationCounter();
        drive.failAt = { call: failureCall, phase };
        await repo.commitAndPublish("fault matrix").catch((error) => {
          expect(error).toBeInstanceOf(VaultPublicationError);
        });
        if (!drive.faultTriggered) {
          reachedEnd = true;
          break;
        }
        drive.failAt = null;
        const recoveredDir = await temp(`fault-recover-${phase}-${failureCall}`);
        const recovered = await open(drive, recoveredDir);
        if (phase === "before" && failureCall === 1) {
          expect(await readFile(join(recoveredDir, "Log/2026-08-29.md"), "utf8").catch(() => null)).toBeNull();
          expect((await recovered.currentRevision()).commitSha).toMatch(/^[0-9a-f]{40}$/);
          continue;
        }
        expect(await readFile(join(recoveredDir, "Log/2026-08-29.md"), "utf8")).toBe("# evidence\n");
        expect(await readFile(join(recoveredDir, "Areas/Home.md"), "utf8")).toBe("# Home\n");
        expect((await recovered.currentRevision()).commitSha).toMatch(/^[0-9a-f]{40}$/);
        expect([...drive.files.values()].filter((file) => file.name === "2026-08-29.md")).toHaveLength(1);
        expect([...drive.files.values()].filter((file) => file.name === "Home.md")).toHaveLength(1);
      }
      expect(reachedEnd, `fault matrix exceeded 20 remote mutations for ${phase}`).toBe(true);
    }
  }, 120_000);

  it("isolates two vault bindings and detects bundle corruption", async () => {
    const drive = new FakeDrive();
    const oneDir = await temp("one");
    const twoDir = await temp("two");
    const one = await open(drive, oneDir, "binding-one");
    const two = await open(drive, twoDir, "binding-two");
    await writeVaultFile(oneDir, "Notes/One.md", "one\n");
    await writeVaultFile(twoDir, "Notes/Two.md", "two\n");
    await one.commitAndPublish("one");
    await two.commitAndPublish("two");
    expect(one.urlFor("Notes/Two.md")).toBeNull();
    expect(two.urlFor("Notes/One.md")).toBeNull();
    const bundle = [...drive.files.values()].find((file) => file.name === "repository.bundle" && file.parents?.includes([...drive.files.values()].find((folder) => folder.name === ".git" && folder.parents?.includes([...drive.files.values()].find((root) => root.appProperties?.zenodVaultBinding === "v1:binding-one")!.id))!.id))!;
    drive.corrupt(bundle.id);
    await expect(one.currentRevision()).rejects.toThrow(/bundle checksum mismatch/);
  });

  it("rejects cross-vault manifest and executable-journal targets without mutating the victim", async () => {
    const drive = new FakeDrive();
    const oneDir = await temp("adversarial-one");
    const twoDir = await temp("adversarial-two");
    const one = await open(drive, oneDir, "binding-one");
    const two = await open(drive, twoDir, "binding-two");
    await writeVaultFile(oneDir, "Notes/Shared.md", "one\n");
    await writeVaultFile(twoDir, "Notes/Shared.md", "two\n");
    await one.commitAndPublish("one seed");
    await two.commitAndPublish("two seed");
    const victim = [...drive.files.values()].find((file) => file.name === "Shared.md" && file.data.toString() === "two\n")!;
    const attacker = [...drive.files.values()].find((file) => file.name === "Shared.md" && file.data.toString() === "one\n")!;

    await writeVaultFile(oneDir, "Notes/Shared.md", "one pending\n");
    drive.resetMutationCounter();
    drive.failAt = { call: 3, phase: "before" };
    await expect(one.commitAndPublish("pending attack source")).rejects.toBeInstanceOf(VaultPublicationError);
    drive.failAt = null;
    const rootOne = [...drive.files.values()].find((file) => file.appProperties?.zenodVaultBinding === "v1:binding-one")!;
    const controlOne = [...drive.files.values()].find((file) => file.name === ".zenod" && file.parents?.includes(rootOne.id))!;
    const txFolder = [...drive.files.values()].find((file) => file.name === "transactions" && file.parents?.includes(controlOne.id))!;
    const pendingFile = [...drive.files.values()].find((file) => file.name.endsWith(".json") && file.parents?.includes(txFolder.id)
      && JSON.parse(file.data.toString("utf8")).state !== "committed")!;
    const pending = JSON.parse(pendingFile.data.toString("utf8"));
    const redirected = pending.mutations.find((mutation: any) => mutation.fileId === attacker.id)!;
    redirected.fileId = victim.id;
    redirected.expectedVersion = victim.version;
    redirected.expectedModifiedTime = victim.modifiedTime;
    redirected.expectedChecksum = createHash("sha256").update(victim.data).digest("hex");
    pending.intentDigest = fakeJournalDigest(pending);
    drive.externalWrite(pendingFile.id, Buffer.from(JSON.stringify(pending, null, 2)));
    const beforeJournalOpen = drive.mutationCount;
    await expect(open(drive, await temp("adversarial-journal-restart"), "binding-one")).rejects.toThrow(/not bound to base authority/);
    expect(drive.mutationCount).toBe(beforeJournalOpen);
    expect(drive.files.get(victim.id)?.data.toString()).toBe("two\n");

    // Remove the malicious nonterminal journal so manifest isolation is tested independently.
    drive.externalRemove(pendingFile.id);
    const manifestOne = [...drive.files.values()].find((file) => file.name === "manifest.json" && file.parents?.includes(controlOne.id))!;
    const originalManifest = Buffer.from(manifestOne.data);
    const redirectedPathManifest = JSON.parse(originalManifest.toString("utf8"));
    redirectedPathManifest.files["Notes/Shared.md"] = {
      fileId: victim.id, mimeType: victim.mimeType, version: victim.version, modifiedTime: victim.modifiedTime,
      checksum: createHash("sha256").update(victim.data).digest("hex"), webViewLink: victim.webViewLink, headRevisionId: victim.headRevisionId,
    };
    drive.externalWrite(manifestOne.id, Buffer.from(JSON.stringify(redirectedPathManifest, null, 2)));
    const beforePathOpen = drive.mutationCount;
    await expect(open(drive, await temp("adversarial-manifest-path"), "binding-one")).rejects.toThrow(/outside its exact path/);
    expect(drive.mutationCount).toBe(beforePathOpen);
    expect(drive.files.get(victim.id)?.data.toString()).toBe("two\n");
    drive.externalWrite(manifestOne.id, originalManifest);

    const rootTwo = [...drive.files.values()].find((file) => file.appProperties?.zenodVaultBinding === "v1:binding-two")!;
    const gitTwo = [...drive.files.values()].find((file) => file.name === ".git" && file.parents?.includes(rootTwo.id))!;
    const bundleTwo = [...drive.files.values()].find((file) => file.name === "repository.bundle" && file.parents?.includes(gitTwo.id))!;
    const tamperedManifest = JSON.parse(originalManifest.toString("utf8"));
    tamperedManifest.bundle.fileId = bundleTwo.id;
    tamperedManifest.bundle.checksum = createHash("sha256").update(bundleTwo.data).digest("hex");
    drive.externalWrite(manifestOne.id, Buffer.from(JSON.stringify(tamperedManifest, null, 2)));
    const beforeManifestOpen = drive.mutationCount;
    await expect(open(drive, await temp("adversarial-manifest-restart"), "binding-one")).rejects.toThrow(/outside its bound/);
    expect(drive.mutationCount).toBe(beforeManifestOpen);
    expect(drive.files.get(victim.id)?.data.toString()).toBe("two\n");
  });

  it("rejects a jointly edited same-vault manifest and journal before mutating the redirected victim", async () => {
    const drive = new FakeDrive();
    const workdir = await temp("same-vault-adversarial");
    const repo = await open(drive, workdir);
    await writeVaultFile(workdir, "Notes/Source.md", "source\n");
    await writeVaultFile(workdir, "Notes/Victim.md", "victim\n");
    await repo.commitAndPublish("seed same-vault files");
    const source = [...drive.files.values()].find((file) => file.name === "Source.md")!;
    const victim = [...drive.files.values()].find((file) => file.name === "Victim.md")!;
    await writeVaultFile(workdir, "Notes/Source.md", "pending\n");
    drive.resetMutationCounter();
    drive.failAt = { call: 3, phase: "before" };
    await expect(repo.commitAndPublish("pending redirected update")).rejects.toBeInstanceOf(VaultPublicationError);
    drive.failAt = null;

    const manifestFile = [...drive.files.values()].find((file) => file.name === "manifest.json")!;
    const manifest = JSON.parse(manifestFile.data.toString("utf8"));
    manifest.files["Notes/Source.md"] = {
      fileId: victim.id, mimeType: victim.mimeType, version: victim.version, modifiedTime: victim.modifiedTime,
      checksum: createHash("sha256").update(victim.data).digest("hex"), webViewLink: victim.webViewLink, headRevisionId: victim.headRevisionId,
    };
    drive.externalWrite(manifestFile.id, Buffer.from(JSON.stringify(manifest, null, 2)));

    const pendingFile = [...drive.files.values()].find((file) => file.name.endsWith(".json") && file.name !== "manifest.json"
      && JSON.parse(file.data.toString("utf8")).state !== "committed")!;
    const pending = JSON.parse(pendingFile.data.toString("utf8"));
    const update = pending.mutations.find((mutation: any) => mutation.fileId === source.id)!;
    Object.assign(update, {
      fileId: victim.id, expectedVersion: victim.version, expectedModifiedTime: victim.modifiedTime,
      expectedChecksum: createHash("sha256").update(victim.data).digest("hex"),
    });
    const manifestMutation = pending.mutations.find((mutation: any) => mutation.path === ".zenod/manifest.json")!;
    Object.assign(manifestMutation, {
      fileId: manifestFile.id, expectedVersion: manifestFile.version, expectedModifiedTime: manifestFile.modifiedTime,
      expectedChecksum: createHash("sha256").update(manifestFile.data).digest("hex"),
    });
    pending.intentDigest = fakeJournalDigest(pending);
    drive.externalWrite(pendingFile.id, Buffer.from(JSON.stringify(pending, null, 2)));
    const before = drive.mutationCount;
    await expect(open(drive, await temp("same-vault-adversarial-restart"))).rejects.toThrow(/exact path before recovery/);
    expect(drive.mutationCount).toBe(before);
    expect(drive.files.get(victim.id)?.data.toString()).toBe("victim\n");
  });
});
