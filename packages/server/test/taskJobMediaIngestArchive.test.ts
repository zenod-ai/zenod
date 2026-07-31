import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrainEngine, StoreInput } from "zenod";

import { Settings } from "../src/settings.js";
import { TaskJobQueue } from "../src/taskJobQueue.js";
import { TaskJobStore, type MediaIngestReceipt } from "../src/taskJobStore.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("TaskJobQueue media_ingest archive integration", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("archives, transcribes, files, and returns the full audio media receipt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-media-ingest-"));
    dirs.push(dir);
    const archiveDir = join(dir, "archive");
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "Travel insurance renews on 2026-08-15.";
    const settings = {
      get: (key: string) =>
        ({
          artifact_archive_provider: "local",
          artifact_archive_local_dir: archiveDir,
        })[key] ?? null,
      whisperModel: () => "large-v3-turbo",
      openrouterTranscriptionModel: () => "openai/whisper-large-v3-turbo",
      longTranscriptionProvider: () => "local",
      useOpenAiForLongTranscription: () => false,
    } as unknown as Settings;
    const stored: StoreInput[] = [];
    const engine = {
      async store(input: StoreInput) {
        stored.push(input);
        return {
          evidenceRef: "Log/2026-07-09.md#^e-audio",
          pagesTouched: ["Areas/Insurance.md"],
          commitSha: "c".repeat(40),
          githubUrls: ["https://github.com/owner/vault/blob/main/Areas/Insurance.md"],
        };
      },
    } as unknown as BrainEngine;
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const queue = new TaskJobQueue(store, async () => engine, settings);

    const job = queue.enqueue("media_ingest", {
      mediaType: "audio",
      bytesRef: "data:audio/ogg;base64,dm9pY2UgYnl0ZXM=",
      filename: "voice.ogg",
      sourceHint: "mcp-test",
      contentHint: "remember this",
    });

    let done = store.get(job.id);
    for (let i = 0; i < 50 && done?.status !== "done"; i += 1) {
      await sleep(10);
      done = store.get(job.id);
    }

    expect(done?.status).toBe("done");
    const receipt = done!.result as MediaIngestReceipt;
    expect(receipt.status).toBe("done");
    expect(receipt.rawArtifact.handle).toMatch(/^file:\/\//);
    expect(receipt.rawArtifact.archiveUrl).toBe(receipt.rawArtifact.handle);
    expect(receipt.rawArtifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.extraction.handle).toMatch(/^file:\/\//);
    expect(receipt.extraction.transcriptHandle).toBe(receipt.extraction.handle);
    expect(receipt.extraction.provider).toBe("whisper.cpp large-v3-turbo");
    expect(receipt.digest).toEqual({
      evidenceRef: "Log/2026-07-09.md#^e-audio",
      pagesTouched: ["Areas/Insurance.md"],
      commitSha: "c".repeat(40),
      githubUrls: ["https://github.com/owner/vault/blob/main/Areas/Insurance.md"],
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.content).toContain("Travel insurance renews on 2026-08-15.");
    expect(stored[0]!.content).toContain("Extraction artifact: file://");
    expect(stored[0]!.verbatim).toBe(true);
  });

  it("extracts an image ingest job, files it through the memory pipeline, and returns terminal receipts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-media-ingest-image-"));
    dirs.push(dir);
    const archiveDir = join(dir, "archive");
    const settings = {
      get: (key: string) =>
        ({
          artifact_archive_provider: "local",
          artifact_archive_local_dir: archiveDir,
        })[key] ?? null,
    } as unknown as Settings;
    const stored: StoreInput[] = [];
    const engine = {
      async describeImage(data: Uint8Array, mimeType: string) {
        expect(Buffer.from(data).toString("utf8")).toBe("fake screenshot bytes");
        expect(mimeType).toBe("image/png");
        return "Screenshot says launch revenue is EUR 500 and owner is Jordi.";
      },
      async store(input: StoreInput) {
        stored.push(input);
        return {
          evidenceRef: "Log/2026-07-09.md#^e-img",
          pagesTouched: ["Projects/Launch.md"],
          commitSha: "a".repeat(40),
          githubUrls: ["https://github.com/owner/vault/blob/main/Projects/Launch.md"],
        };
      },
    } as unknown as BrainEngine;
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const queue = new TaskJobQueue(store, async () => engine, settings);

    const job = queue.enqueue("media_ingest", {
      mediaType: "screenshot",
      bytesRef: `data:image/png;base64,${Buffer.from("fake screenshot bytes").toString("base64")}`,
      filename: "launch-screenshot.png",
      sourceHint: "mcp-test",
      contentHint: "remember the launch metric",
      senderTimestamp: "2026-07-31T15:00:00.000Z",
      mediaHints: ["launch"],
    });

    let done = store.get(job.id);
    for (let i = 0; i < 50 && done?.status !== "done"; i += 1) {
      await sleep(10);
      done = store.get(job.id);
    }

    expect(done?.status).toBe("done");
    const receipt = done!.result as MediaIngestReceipt;
    expect(receipt.status).toBe("done");
    expect(receipt.rawArtifact.handle).toMatch(/^file:\/\//);
    expect(receipt.extraction.provider).toBe("vision model");
    expect(receipt.extraction.handle).toMatch(/^file:\/\//);
    expect(receipt.extraction.ocrHandle).toBe(receipt.extraction.handle);
    expect(receipt.digest.evidenceRef).toBe("Log/2026-07-09.md#^e-img");
    expect(receipt.digest.pagesTouched).toEqual(["Projects/Launch.md"]);
    expect(receipt.digest.commitSha).toBe("a".repeat(40));
    expect(receipt.digest.githubUrls).toEqual(["https://github.com/owner/vault/blob/main/Projects/Launch.md"]);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.content).toContain("Raw artifact sha256:");
    expect(stored[0]!.content).toContain("Extracted by vision model.");
    expect(stored[0]!.content).toContain("launch revenue is EUR 500");
    expect(stored[0]!.content).toContain("User context: remember the launch metric");
    expect(stored[0]!.content).toContain("Media type: image/png");
    expect(stored[0]!.content).toContain("Source: mcp-test");
    expect(stored[0]!.content).toContain("Source timestamp: 2026-07-31T15:00:00.000Z");
    expect(stored[0]!.hints).toEqual(["launch"]);
    expect(stored[0]!.verbatim).toBe(true);
  });

  it("archives a capability-fetched image without persisting the transient capability", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-media-capability-"));
    dirs.push(dir);
    const archiveDir = join(dir, "archive");
    const transientUrl = "https://phylax.test/artifacts/tenant/photo.png?expires=1999999999999&signature=transient-secret";
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(transientUrl);
      return new Response(Buffer.from("capability image bytes"), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }));
    const settings = {
      get: (key: string) =>
        ({
          artifact_archive_provider: "local",
          artifact_archive_local_dir: archiveDir,
        })[key] ?? null,
    } as unknown as Settings;
    const stored: StoreInput[] = [];
    const engine = {
      async describeImage() {
        return "A handwritten launch checklist with three checked items.";
      },
      async store(input: StoreInput) {
        stored.push(input);
        return {
          evidenceRef: "Log/2026-07-31.md#^e-capability",
          evidenceUrl: "https://github.test/log#L8",
          pagesTouched: ["Projects/Launch.md"],
          pageUrls: ["https://github.test/launch"],
          commitSha: "d".repeat(40),
          githubUrls: ["https://github.test/commit/" + "d".repeat(40)],
          filing: "filed" as const,
        };
      },
    } as unknown as BrainEngine;
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const queue = new TaskJobQueue(store, async () => engine, settings);

    const job = queue.enqueue("media_ingest", {
      mediaType: "image",
      artifactUrl: transientUrl,
      filename: "photo.png",
      sourceHint: "WhatsApp media",
      contentHint: "Planning board after the meeting",
    });
    let done = store.get(job.id);
    for (let i = 0; i < 50 && done?.status !== "done"; i += 1) {
      await sleep(10);
      done = store.get(job.id);
    }

    expect(done?.status).toBe("done");
    expect(JSON.stringify(done?.result)).not.toContain(transientUrl);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.content).not.toContain(transientUrl);
    expect(done?.result).toMatchObject({
      digest: {
        evidenceUrl: "https://github.test/log#L8",
        pageUrls: ["https://github.test/launch"],
        filing: "filed",
      },
    });
    const archivedFiles = await readdir(archiveDir, { recursive: true });
    const metadataFiles = archivedFiles.filter((file) => String(file).endsWith(".metadata.json"));
    const metadata = await Promise.all(metadataFiles.map((file) => readFile(join(archiveDir, String(file)), "utf8")));
    expect(metadata.join("\n")).not.toContain(transientUrl);
    await queue.close();
    store.close();
  });

  it("fails loudly before filing when production Drive custody is unavailable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-media-drive-required-"));
    dirs.push(dir);
    const settings = {
      get: (key: string) => key === "artifact_archive_provider" ? "drive" : null,
    } as unknown as Settings;
    const engine = { store: vi.fn(), describeImage: vi.fn() } as unknown as BrainEngine;
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const queue = new TaskJobQueue(store, async () => engine, settings);

    const job = queue.enqueue("media_ingest", {
      mediaType: "image",
      bytesRef: `data:image/png;base64,${Buffer.from("unarchived image").toString("base64")}`,
      filename: "must-go-to-drive.png",
    });
    let failed = store.get(job.id);
    for (let i = 0; i < 50 && failed?.status !== "error"; i += 1) {
      await sleep(10);
      failed = store.get(job.id);
    }

    expect(failed).toMatchObject({
      status: "error",
      result: null,
      error: "artifact archive provider is drive, but Google Drive is not connected",
    });
    expect((engine.store as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((engine.describeImage as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    await queue.close();
    store.close();
  });

  it("extracts embedded text from a PDF ingest job and records digest receipts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-media-ingest-pdf-"));
    dirs.push(dir);
    const archiveDir = join(dir, "archive");
    const settings = {
      get: (key: string) =>
        ({
          artifact_archive_provider: "local",
          artifact_archive_local_dir: archiveDir,
        })[key] ?? null,
    } as unknown as Settings;
    const pdf = Buffer.from("%PDF-1.4\nBT\n(Renewal date: 2026-08-15) Tj\n(Policy holder: Jordi) Tj\nET\n%%EOF");
    const stored: StoreInput[] = [];
    const engine = {
      async store(input: StoreInput) {
        stored.push(input);
        return {
          evidenceRef: "Log/2026-07-09.md#^e-pdf",
          pagesTouched: ["Areas/Insurance.md"],
          commitSha: "b".repeat(40),
          githubUrls: ["https://github.com/owner/vault/blob/main/Areas/Insurance.md"],
        };
      },
    } as unknown as BrainEngine;
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const queue = new TaskJobQueue(store, async () => engine, settings);

    const job = queue.enqueue("media_ingest", {
      mediaType: "pdf",
      bytesRef: `data:application/pdf;base64,${pdf.toString("base64")}`,
      filename: "axa-policy.pdf",
      mediaHints: ["insurance"],
    });

    let done = store.get(job.id);
    for (let i = 0; i < 50 && done?.status !== "done"; i += 1) {
      await sleep(10);
      done = store.get(job.id);
    }

    const receipt = done!.result as MediaIngestReceipt;
    expect(receipt.status).toBe("done");
    expect(receipt.extraction.provider).toBe("embedded PDF text");
    expect(receipt.digest.evidenceRef).toBe("Log/2026-07-09.md#^e-pdf");
    expect(receipt.digest.commitSha).toBe("b".repeat(40));
    expect(stored[0]!.content).toContain("Renewal date: 2026-08-15");
    expect(stored[0]!.content).toContain("Policy holder: Jordi");
  });
});
