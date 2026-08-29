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

  it("finishes media capture before durable semantic enrichment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-capture-first-media-"));
    dirs.push(dir);
    const settings = {
      get: (key: string) => ({
        artifact_archive_provider: "local",
        artifact_archive_local_dir: join(dir, "archive"),
      })[key] ?? null,
    } as unknown as Settings;
    let releaseEnrichment!: () => void;
    const enrichmentGate = new Promise<void>((resolve) => { releaseEnrichment = resolve; });
    const captureEvidence = vi.fn(async () => ({
      evidenceRef: "Log/2026-08-28.md#^e-fast01",
      pagesTouched: [],
      commitSha: "a".repeat(40),
      githubUrls: [],
      filing: "pending" as const,
    }));
    const enrichEvidence = vi.fn(async () => {
      await enrichmentGate;
      return {
        evidenceRef: "Log/2026-08-28.md#^e-fast01",
        pagesTouched: ["Projects/Memory.md"],
        commitSha: "b".repeat(40),
        githubUrls: [],
        filing: "filed" as const,
      };
    });
    const engine = { captureEvidence, enrichEvidence } as unknown as BrainEngine;
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const queue = new TaskJobQueue(store, async () => engine, settings);

    const media = queue.enqueue("media_ingest", {
      mediaType: "audio",
      bytesRef: `data:audio/ogg;base64,${Buffer.from("raw voice").toString("base64")}`,
      filename: "voice.ogg",
      sourceHint: "WhatsApp voice note",
      providedTranscript: "Blue Lantern is already transcribed.",
      transcriptionProvider: "channel",
      transcriptionDisposition: "provided",
    }, "alpha:whatsapp:blue-lantern");

    for (let attempt = 0; attempt < 100 && store.get(media.id)?.status !== "done"; attempt += 1) await sleep(5);
    const captured = store.get(media.id);
    expect(captured).toMatchObject({
      status: "done",
      result: {
        message: "Media artifact and extraction captured in Zenod; semantic filing continues in the background.",
        digest: {
          evidenceRef: "Log/2026-08-28.md#^e-fast01",
          filing: "pending",
          enrichmentJobId: expect.any(String),
        },
      },
    });
    expect(captureEvidence).toHaveBeenCalledTimes(1);
    expect(enrichEvidence).toHaveBeenCalledTimes(1);
    expect(store.get((captured!.result as MediaIngestReceipt).digest.enrichmentJobId!)?.status).toBe("running");

    releaseEnrichment();
    await queue.close();
    expect(store.get((captured!.result as MediaIngestReceipt).digest.enrichmentJobId!)?.status).toBe("done");
    store.close();
  });

  it("answers chat while a slow media archive is still being filed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-media-chat-lane-"));
    dirs.push(dir);
    const settings = {
      get: (key: string) => ({
        artifact_archive_provider: "local",
        artifact_archive_local_dir: join(dir, "archive"),
      })[key] ?? null,
    } as unknown as Settings;
    let releaseMedia!: () => void;
    const mediaGate = new Promise<void>((resolve) => {
      releaseMedia = resolve;
    });
    const storeMemory = vi.fn(async () => {
      await mediaGate;
      return {
        evidenceRef: "Log/2026-08-28.md#^e-media",
        pagesTouched: ["Inbox/Voice.md"],
        commitSha: "a".repeat(40),
        githubUrls: [],
      };
    });
    const chat = vi.fn(async () => ({
      text: "Chat stayed responsive.",
      sources: [],
      actions: [],
    }));
    const engine = { store: storeMemory, chat } as unknown as BrainEngine;
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const queue = new TaskJobQueue(store, async () => engine, settings);

    const media = queue.enqueue("media_ingest", {
      mediaType: "audio",
      bytesRef: `data:audio/ogg;base64,${Buffer.from("raw voice").toString("base64")}`,
      filename: "voice.ogg",
      sourceHint: "WhatsApp voice note",
      providedTranscript: "The transcript is already ready.",
      transcriptionProvider: "channel",
      transcriptionDisposition: "provided",
    });
    for (let attempt = 0; attempt < 50 && storeMemory.mock.calls.length === 0; attempt += 1) {
      await sleep(5);
    }
    expect(store.get(media.id)?.status).toBe("running");

    const conversation = queue.enqueue("chat", {
      text: "Are you still there?",
      conversationKey: "whatsapp:alpha",
    });
    for (let attempt = 0; attempt < 50 && store.get(conversation.id)?.status !== "done"; attempt += 1) {
      await sleep(5);
    }

    expect(store.get(conversation.id)).toMatchObject({
      status: "done",
      result: { text: "Chat stayed responsive." },
    });
    expect(store.get(media.id)?.status).toBe("running");
    expect(chat).toHaveBeenCalledTimes(1);

    releaseMedia();
    await queue.close();
    expect(store.get(media.id)?.status).toBe("done");
    store.close();
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
      revision: null,
      urls: [],
      commitSha: "c".repeat(40),
      githubUrls: ["https://github.com/owner/vault/blob/main/Areas/Insurance.md"],
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.content).toContain("Travel insurance renews on 2026-08-15.");
    expect(stored[0]!.content).toContain("Extraction artifact: file://");
    expect(stored[0]!.verbatim).toBe(true);
  });

  it("archives raw audio and files a Phylax-supplied transcript without transcribing twice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-media-supplied-transcript-"));
    dirs.push(dir);
    const archiveDir = join(dir, "archive");
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "This must never replace the supplied transcript.";
    const settings = {
      get: (key: string) => ({
        artifact_archive_provider: "local",
        artifact_archive_local_dir: archiveDir,
      })[key] ?? null,
    } as unknown as Settings;
    const stored: StoreInput[] = [];
    const engine = {
      async store(input: StoreInput) {
        stored.push(input);
        return {
          evidenceRef: "Log/2026-08-27.md#^e-supplied",
          pagesTouched: ["Inbox/Voice.md"],
          commitSha: "f".repeat(40),
          githubUrls: [],
        };
      },
    } as unknown as BrainEngine;
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const queue = new TaskJobQueue(store, async () => engine, settings);

    const job = queue.enqueue("media_ingest", {
      mediaType: "audio",
      bytesRef: `data:audio/ogg;base64,${Buffer.from("raw WhatsApp audio").toString("base64")}`,
      filename: "voice.ogg",
      sourceHint: "WhatsApp voice note",
      contentHint: "WhatsApp voice note",
      providedTranscript: "The exact transcript produced once by Phylax.",
      transcriptionProvider: "openrouter/mistral/voxtral-small-24b-2507",
      audioDurationSeconds: 4_200,
      transcriptionDisposition: "provided",
    });
    let done = store.get(job.id);
    for (let i = 0; i < 50 && done?.status !== "done"; i += 1) {
      await sleep(10);
      done = store.get(job.id);
    }

    expect(done?.status).toBe("done");
    const receipt = done!.result as MediaIngestReceipt;
    expect(receipt.rawArtifact.handle).toMatch(/^file:\/\//);
    expect(receipt.extraction).toMatchObject({
      provider: "openrouter/mistral/voxtral-small-24b-2507",
      transcriptionStatus: "transcribed",
      durationSeconds: 4_200,
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.content).toContain("The exact transcript produced once by Phylax.");
    expect(stored[0]!.content).not.toContain("This must never replace the supplied transcript.");
    await queue.close();
    store.close();
  });

  it("archives audio over two hours without transcription and files a memory pointer to the raw artifact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-media-duration-limit-"));
    dirs.push(dir);
    const archiveDir = join(dir, "archive");
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "This transcription path must not run.";
    const settings = {
      get: (key: string) => ({
        artifact_archive_provider: "local",
        artifact_archive_local_dir: archiveDir,
      })[key] ?? null,
    } as unknown as Settings;
    const stored: StoreInput[] = [];
    const engine = {
      async store(input: StoreInput) {
        stored.push(input);
        return {
          evidenceRef: "Log/2026-08-27.md#^e-over-two-hours",
          pagesTouched: ["Inbox/Voice.md"],
          commitSha: "e".repeat(40),
          githubUrls: [],
        };
      },
    } as unknown as BrainEngine;
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const queue = new TaskJobQueue(store, async () => engine, settings);

    const job = queue.enqueue("media_ingest", {
      mediaType: "audio",
      bytesRef: `data:audio/ogg;base64,${Buffer.from("very long raw audio").toString("base64")}`,
      filename: "long-voice.ogg",
      sourceHint: "WhatsApp voice note",
      contentHint: "WhatsApp voice note",
      providedTranscript: "",
      transcriptionProvider: "Phylax channel transcription",
      audioDurationSeconds: 7_201,
      transcriptionDisposition: "skip_duration_limit",
    });
    let done = store.get(job.id);
    for (let i = 0; i < 50 && done?.status !== "done"; i += 1) {
      await sleep(10);
      done = store.get(job.id);
    }

    expect(done?.status).toBe("done");
    const receipt = done!.result as MediaIngestReceipt;
    expect(receipt.message).toContain("without transcription");
    expect(receipt.rawArtifact.handle).toMatch(/^file:\/\//);
    expect(receipt.extraction).toMatchObject({
      transcriptionStatus: "skipped_duration_limit",
      durationSeconds: 7_201,
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.content).toContain("exceeds Zenod's 2-hour transcription limit");
    expect(stored[0]!.content).toContain("Raw artifact:");
    expect(stored[0]!.content).not.toContain("This transcription path must not run.");
    await queue.close();
    store.close();
  });

  it("archives a Phylax-unavailable voice without invoking Zenod transcription", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-media-phylax-unavailable-"));
    dirs.push(dir);
    const archiveDir = join(dir, "archive");
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "This second transcription must never run.";
    const settings = {
      get: (key: string) => ({
        artifact_archive_provider: "local",
        artifact_archive_local_dir: archiveDir,
      })[key] ?? null,
    } as unknown as Settings;
    const stored: StoreInput[] = [];
    const engine = {
      async store(input: StoreInput) {
        stored.push(input);
        return {
          evidenceRef: "Log/2026-08-27.md#^e-phylax-unavailable",
          pagesTouched: ["Inbox/Voice.md"],
          commitSha: "d".repeat(40),
          githubUrls: [],
        };
      },
    } as unknown as BrainEngine;
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const queue = new TaskJobQueue(store, async () => engine, settings);

    const job = queue.enqueue("media_ingest", {
      mediaType: "audio",
      bytesRef: `data:audio/ogg;base64,${Buffer.from("raw unavailable audio").toString("base64")}`,
      filename: "voice.ogg",
      sourceHint: "Telegram voice note",
      providedTranscript: "",
      transcriptionProvider: "Phylax channel transcription",
      audioDurationSeconds: 42,
      transcriptionDisposition: "skip_unavailable",
    });
    let done = store.get(job.id);
    for (let i = 0; i < 50 && done?.status !== "done"; i += 1) {
      await sleep(10);
      done = store.get(job.id);
    }

    expect(done?.status).toBe("done");
    const receipt = done!.result as MediaIngestReceipt;
    expect(receipt.extraction).toMatchObject({
      transcriptionStatus: "skipped_unavailable",
      durationSeconds: 42,
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.content).toContain("authenticated channel reported transcription unavailable");
    expect(stored[0]!.content).not.toContain("This second transcription must never run.");
    await queue.close();
    store.close();
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
          evidenceUrl: "https://github.com/zenod-ai/vault/blob/main/Log/2026-07-31.md#L8",
          pagesTouched: ["Projects/Launch.md"],
          pageUrls: ["https://github.com/zenod-ai/vault/blob/main/Projects/Launch.md"],
          commitSha: "d".repeat(40),
          githubUrls: ["https://github.com/zenod-ai/vault/commit/" + "d".repeat(40)],
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
        evidenceUrl: "https://github.com/zenod-ai/vault/blob/main/Log/2026-07-31.md#L8",
        pageUrls: ["https://github.com/zenod-ai/vault/blob/main/Projects/Launch.md"],
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
      googleDriveOAuthAuthority: () => ({ mode: "self-hosted" as const }),
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

  it("ZAL-20 self-hosted Drive journey preserves ingest_memory Drive references", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-selfhost-drive-ref-"));
    dirs.push(dir);
    const archiveDir = join(dir, "archive");
    const settings = {
      get: (key: string) =>
        ({
          artifact_archive_provider: "local",
          artifact_archive_local_dir: archiveDir,
          google_oauth_client_id: "selfhost-client",
          google_oauth_client_secret: "selfhost-secret",
        })[key] ?? null,
      getRaw: (key: string) => key === "google_oauth_refresh_token" ? "selfhost-refresh" : null,
      googleDriveOAuthAuthority: () => ({ mode: "self-hosted" as const }),
    } as unknown as Settings;
    const providerFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "selfhost-access", expires_in: 3600 });
      }
      if (url.includes("/drive/v3/files/selfhost-doc") && new URL(url).searchParams.get("alt") === "media") {
        return new Response("Self-hosted Drive source remains supported.", {
          headers: { "content-type": "text/plain" },
        });
      }
      if (url.includes("/drive/v3/files/selfhost-doc")) {
        return Response.json({
          id: "selfhost-doc",
          name: "source.txt",
          mimeType: "text/plain",
          webViewLink: "https://drive.google.com/file/d/selfhost-doc/view",
        });
      }
      throw new Error(`unexpected provider request: ${url}`);
    });
    vi.stubGlobal("fetch", providerFetch);
    const stored: StoreInput[] = [];
    const engine = {
      async store(input: StoreInput) {
        stored.push(input);
        return {
          evidenceRef: "Log/2026-08-26.md#^e-selfhost-drive",
          pagesTouched: ["Areas/Self-hosted.md"],
          commitSha: "e".repeat(40),
          githubUrls: [],
        };
      },
    } as unknown as BrainEngine;
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const queue = new TaskJobQueue(store, async () => engine, settings);

    const job = queue.enqueue("media_ingest", {
      mediaType: "document",
      bytesRef: "drive://file/selfhost-doc",
    });
    let done = store.get(job.id);
    for (let i = 0; i < 50 && done?.status !== "done"; i += 1) {
      await sleep(10);
      done = store.get(job.id);
    }

    expect(done?.status).toBe("done");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.content).toContain("Self-hosted Drive source remains supported.");
    expect(providerFetch).toHaveBeenCalled();
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
