import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DriveArtifactArchiveProvider,
  LocalArtifactArchiveProvider,
  archiveRawArtifact,
  artifactArchiveProviderFromSettings,
  type ArtifactArchiveInput,
} from "../src/artifactArchive.js";
import type { DriveClient, DriveFile } from "../src/drive.js";
import type { Settings } from "../src/settings.js";

const fixedNow = () => new Date("2026-07-09T12:34:56.000Z");

class MockDriveClient implements Pick<DriveClient, "ensureFolder" | "uploadFile"> {
  uploaded: Array<{ name: string; mimeType: string; data: Buffer; parentFolderId: string }> = [];

  async ensureFolder(name: string, parentId: string): Promise<string> {
    expect(name).toBe("Raw Artifacts");
    expect(parentId).toBe("drive-root");
    return "raw-artifacts";
  }

  async uploadFile(name: string, mimeType: string, data: Buffer, parentFolderId: string): Promise<DriveFile> {
    this.uploaded.push({ name, mimeType, data, parentFolderId });
    return {
      id: "drive-file-1",
      name,
      mimeType,
      webViewLink: "https://drive.google.com/file/d/drive-file-1/view",
    };
  }
}

describe("LocalArtifactArchiveProvider", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("stores raw bytes plus metadata and returns a durable local handle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-artifact-"));
    dirs.push(dir);
    const provider = new LocalArtifactArchiveProvider(dir, { now: fixedNow });

    const handle = await provider.archive({
      data: Buffer.from("screenshot bytes"),
      filename: "../Screenshot 1.png",
      mediaType: "image/png",
      source: "mcp",
      sender: "jordi@example.com",
      timestamp: "2026-07-09T12:30:00.000Z",
      metadata: { conversationId: "conv-1" },
    });

    expect(handle.provider).toBe("local");
    expect(handle.filename).toBe("Screenshot_1.png");
    expect(handle.path).toContain(join("2026", "07", "09"));
    expect(handle.uri).toBe(`file://${handle.path}`);
    expect(handle.sizeBytes).toBe(Buffer.byteLength("screenshot bytes"));
    expect(handle.source).toBe("mcp");
    expect(handle.sender).toBe("jordi@example.com");

    await expect(readFile(handle.path!, "utf8")).resolves.toBe("screenshot bytes");
    const metadata = JSON.parse(await readFile(`${handle.path}.metadata.json`, "utf8")) as typeof handle;
    expect(metadata.sha256).toBe(handle.sha256);
    expect(metadata.metadata).toEqual({ conversationId: "conv-1" });
  });

  it("does not allow path traversal through the input filename", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-artifact-"));
    dirs.push(dir);
    const provider = new LocalArtifactArchiveProvider(dir, { now: fixedNow });

    const handle = await provider.archive({
      data: Buffer.from("pdf"),
      filename: "../../secret.pdf",
      mediaType: "application/pdf",
    });

    expect(handle.path?.startsWith(dir)).toBe(true);
    expect(handle.filename).toBe("secret.pdf");
    await expect(stat(handle.path!)).resolves.toBeTruthy();
  });
});

describe("DriveArtifactArchiveProvider", () => {
  it("uploads raw bytes to the Drive-compatible provider and returns a receipt handle", async () => {
    const client = new MockDriveClient();
    const provider = new DriveArtifactArchiveProvider(client as unknown as DriveClient, "drive-root", { now: fixedNow });

    const handle = await provider.archive({
      data: Buffer.from("voice bytes"),
      filename: "voice note.ogg",
      mediaType: "audio/ogg",
      source: "telegram",
    });

    expect(handle.provider).toBe("drive");
    expect(handle.id).toBe("drive-file-1");
    expect(handle.uri).toBe("drive://file/drive-file-1");
    expect(handle.url).toBe("https://drive.google.com/file/d/drive-file-1/view");
    expect(handle.mediaType).toBe("audio/ogg");
    expect(client.uploaded).toHaveLength(1);
    expect(client.uploaded[0]).toMatchObject({
      mimeType: "audio/ogg",
      parentFolderId: "raw-artifacts",
    });
    expect(client.uploaded[0]!.name).toContain("voice_note.ogg");
    expect(client.uploaded[0]!.data.toString("utf8")).toBe("voice bytes");
  });
});

describe("artifactArchiveProviderFromSettings", () => {
  it("selects local storage from env-seeded settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-artifact-settings-"));
    try {
      const settings = {
        get: (key: string) =>
          ({
            artifact_archive_provider: "local",
            artifact_archive_local_dir: dir,
          })[key] ?? null,
      } as unknown as Settings;

      const provider = artifactArchiveProviderFromSettings(settings, { now: fixedNow });
      expect(provider?.kind).toBe("local");
      const handle = await provider!.archive({ data: Buffer.from("data"), mediaType: "text/plain", filename: "note.txt" });
      expect(handle.path?.startsWith(dir)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws loudly instead of producing a success-shaped archive receipt when unconfigured", async () => {
    const settings = { get: () => null } as unknown as Settings;
    const input: ArtifactArchiveInput = { data: Buffer.from("raw"), mediaType: "application/octet-stream" };

    await expect(archiveRawArtifact(settings, input)).rejects.toThrow("artifact archive is not configured");
  });

  it("selects Drive when configured and a Drive client is injected", () => {
    const settings = {
      get: (key: string) =>
        ({
          artifact_archive_provider: "drive",
          artifact_archive_drive_folder_id: "drive-root",
        })[key] ?? null,
    } as unknown as Settings;

    const provider = artifactArchiveProviderFromSettings(settings, { driveClient: new MockDriveClient() as unknown as DriveClient });
    expect(provider?.kind).toBe("drive");
  });
});
