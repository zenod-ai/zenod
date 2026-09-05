// DUPLICATE from core/test/engine.test.ts FakeDriveVaultRepository (b9dd9f0).
// Local snapshot double only: this does not exercise the remote Drive adapter.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { listMarkdownFiles } from "../../../../core/src/vault/files.js";
import type { FileChange, VaultRepository, VaultRevision } from "zenod";

export class FakeDriveVaultRepository implements VaultRepository {
  readonly provider = "google_drive" as const;
  private baseline = new Map<string, string>();
  private revisionNumber = 0;
  private revision: VaultRevision = {
    provider: "google_drive",
    id: "drive-revision-0",
    committedAt: "2026-08-29T10:00:00.000Z",
    urls: [],
  };

  private constructor(
    readonly path: string,
    private readonly makeUrl: (path: string, anchor?: string) => string = (path, anchor) => {
      const suffix = anchor ? `#${encodeURIComponent(anchor)}` : "";
      return `https://drive.google.com/drive/zenod-vault/${path.split("/").map(encodeURIComponent).join("/")}${suffix}`;
    },
  ) {}

  static async open(
    path: string,
    makeUrl?: (path: string, anchor?: string) => string,
  ): Promise<FakeDriveVaultRepository> {
    const repository = new FakeDriveVaultRepository(path, makeUrl);
    await repository.captureBaseline();
    return repository;
  }

  private async captureBaseline(): Promise<void> {
    this.baseline = new Map(await Promise.all(
      (await listMarkdownFiles(this.path)).map(async (path) => [path, await readFile(join(this.path, path), "utf8")] as const),
    ));
  }

  async pull(): Promise<void> {}

  async currentRevision(): Promise<VaultRevision> {
    return { ...this.revision, urls: [...this.revision.urls] };
  }

  async trackedFiles(): Promise<string[]> {
    return [...this.baseline.keys()].sort();
  }

  async contentAtHead(path: string): Promise<string | null> {
    return this.baseline.get(path) ?? null;
  }

  async pendingChanges(): Promise<FileChange[]> {
    const currentPaths = await listMarkdownFiles(this.path);
    const paths = [...new Set([...this.baseline.keys(), ...currentPaths])].sort();
    const changes: FileChange[] = [];
    for (const path of paths) {
      const before = this.baseline.get(path) ?? null;
      const after = await readFile(join(this.path, path), "utf8").catch(() => null);
      if (before !== after) changes.push({ path, before, after });
    }
    return changes;
  }

  async discardChanges(): Promise<void> {
    const currentPaths = await listMarkdownFiles(this.path);
    for (const path of currentPaths) {
      if (!this.baseline.has(path)) await rm(join(this.path, path), { force: true });
    }
    for (const [path, content] of this.baseline) {
      await mkdir(dirname(join(this.path, path)), { recursive: true });
      await writeFile(join(this.path, path), content);
    }
  }

  async commitAndPublish(_message: string): Promise<VaultRevision> {
    const changes = await this.pendingChanges();
    if (changes.length === 0) throw new Error("no pending vault changes to publish");
    this.revisionNumber += 1;
    this.revision = {
      provider: "google_drive",
      id: `drive-revision-${this.revisionNumber}`,
      committedAt: `2026-08-29T10:${String(this.revisionNumber).padStart(2, "0")}:00.000Z`,
      urls: changes.map((change) => this.urlFor(change.path)!).filter(Boolean),
    };
    await this.captureBaseline();
    return this.currentRevision();
  }

  urlFor(path: string, anchor?: string): string {
    return this.makeUrl(path, anchor);
  }
}
