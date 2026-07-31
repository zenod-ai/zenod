import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainEngine, StoreInput } from "zenod";
import { DriveClient, parseServiceAccount, testDrive } from "../src/drive.js";
import { buildDriveTools } from "../src/driveTools.js";
import { IngestQueue } from "../src/ingestQueue.js";
import { transcribeAudio } from "../src/transcribe.js";
import { Runtime } from "../src/runtime.js";
import { createApp } from "../src/app.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA_JSON = JSON.stringify({
  type: "service_account",
  client_email: "zenod@test-project.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});

const FILES = [
  {
    id: "file-1",
    name: "Zenod voice note.m4a",
    mimeType: "audio/mp4",
    size: "1000",
    modifiedTime: "2026-06-12T10:00:00Z",
    webViewLink: "https://drive.google.com/file/d/file-1/view",
    parents: ["folder-9"],
  },
  {
    id: "image-1",
    name: "Launch metrics screenshot.png",
    mimeType: "image/png",
    size: "2000",
    modifiedTime: "2026-06-12T10:05:00Z",
    webViewLink: "https://drive.google.com/file/d/image-1/view",
    parents: ["folder-9"],
  },
  {
    id: "pdf-1",
    name: "Axa policy.pdf",
    mimeType: "application/pdf",
    size: "3000",
    modifiedTime: "2026-06-12T10:10:00Z",
    webViewLink: "https://drive.google.com/file/d/pdf-1/view",
    parents: ["folder-9"],
  },
  {
    id: "scanned-pdf-1",
    name: "Scanned receipt.pdf",
    mimeType: "application/pdf",
    size: "3000",
    modifiedTime: "2026-06-12T10:15:00Z",
    webViewLink: "https://drive.google.com/file/d/scanned-pdf-1/view",
    parents: ["folder-9"],
  },
];

const TEXT_PDF = Buffer.from("%PDF-1.4\nBT\n/F1 12 Tf\n(Renewal date: 2026-08-15) Tj\n(Policy holder: Jordi) Tj\nET\n%%EOF");
const SCANNED_PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image >>\nendobj\n%%EOF");

async function waitFor<T>(read: () => T, done: (value: T) => boolean): Promise<T> {
  const started = Date.now();
  let value = read();
  while (!done(value)) {
    if (Date.now() - started > 2_000) throw new Error("timed out waiting for async work");
    await new Promise((resolve) => setTimeout(resolve, 10));
    value = read();
  }
  return value;
}

/** fetch stub: token exchange + Drive list/get/download/archive + whisper endpoint. */
function stubFetch(moves: string[] = []): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const params = new URLSearchParams(String(init?.body));
      if (params.get("grant_type") === "refresh_token") {
        expect(params.get("refresh_token")).toBe("refresh-123");
        return Response.json({ access_token: "tok-123", expires_in: 3600 });
      }
      if (params.get("grant_type") === "authorization_code") {
        expect(params.get("code")).toBe("code-123");
        return Response.json({ access_token: "tok-abc", refresh_token: "refresh-123" });
      }
      const assertion = params.get("assertion")!;
      expect(assertion.split(".")).toHaveLength(3); // a signed JWT
      return Response.json({ access_token: "tok-123", expires_in: 3600 });
    }
    if (url.startsWith("https://www.googleapis.com/oauth2/v2/userinfo")) {
      return Response.json({ email: "jordi@example.com" });
    }
    expect((init?.headers as Record<string, string> | undefined)?.Authorization ?? "Bearer tok-123").toContain(
      "Bearer",
    );
    if (url.includes("/drive/v3/files?") && method === "POST") {
      return Response.json({ id: "archive-folder-1" }); // create Archive/
    }
    if (url.includes("/drive/v3/files?")) {
      const q = new URL(url).searchParams.get("q") ?? "";
      return Response.json({ files: q.includes(`mimeType = '`) ? [] : FILES }); // no Archive/ yet
    }
    const file = FILES.find((f) => url.includes(`/drive/v3/files/${f.id}`));
    if (file && method === "PATCH") {
      moves.push(new URL(url).searchParams.get("addParents") ?? "");
      return Response.json({ id: file.id });
    }
    if (url.includes("/drive/v3/files/file-1") && url.includes("alt=media")) {
      return new Response(Buffer.from("fake-audio-bytes"));
    }
    if (url.includes("/drive/v3/files/image-1") && url.includes("alt=media")) {
      return new Response(Buffer.from("fake-png-bytes"));
    }
    if (url.includes("/drive/v3/files/pdf-1") && url.includes("alt=media")) {
      return new Response(TEXT_PDF);
    }
    if (url.includes("/drive/v3/files/scanned-pdf-1") && url.includes("alt=media")) {
      return new Response(SCANNED_PDF);
    }
    if (file && url.includes("fields=parents")) {
      return Response.json({ parents: ["folder-9"] });
    }
    if (file) {
      return Response.json(file);
    }
    if (url.includes("audio/transcriptions")) {
      return Response.json({ text: "remember to renew the travel insurance" });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("drive client", () => {
  it("rejects malformed service account JSON with a friendly error", () => {
    expect(() => parseServiceAccount("not json")).toThrow(/not valid JSON/);
    expect(() => parseServiceAccount("{}")).toThrow(/client_email or private_key/);
  });

  it("exchanges a signed JWT for a token and lists files", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const client = new DriveClient(SA_JSON);
    const files = await client.listFiles({ folderId: "folder-9" });
    expect(files.map((file) => file.name)).toContain("Zenod voice note.m4a");
    vi.unstubAllGlobals();
  });

  it("testDrive reports the service account email", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const result = await testDrive(SA_JSON);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("zenod@test-project.iam.gserviceaccount.com");
    vi.unstubAllGlobals();
  });

  it("refreshes a user OAuth token and lists files using the Google account", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const result = await testDrive(
      {
        kind: "oauth",
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "refresh-123",
        email: "jordi@example.com",
      },
      "folder-9",
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("connected as jordi@example.com");
    vi.unstubAllGlobals();
  });
});

describe("transcription envelope", () => {
  afterEach(() => {
    delete process.env.ZENOD_TRANSCRIPTION_FAKE_FAIL_PROVIDERS;
    delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
    vi.unstubAllGlobals();
  });

  it("fails cleanly when the local model is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing model", { status: 500 })));
    const result = await transcribeAudio(Buffer.from("x"), "a.m4a");
    expect(result.success).toBe(false);
    expect(result.provider).toBe("whisper.cpp");
    expect(result.error).toMatch(/model unavailable/);
  });

  it("transcribes through the local provider", async () => {
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "remember to renew the travel insurance";
    const result = await transcribeAudio(Buffer.from("x"), "a.m4a");
    expect(result).toEqual({
      success: true,
      transcript: "remember to renew the travel insurance",
      provider: "whisper.cpp large-v3-turbo",
    });
    delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
  });

  it("uses Groq when a Groq key is configured", async () => {
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "remember to renew the travel insurance";
    const result = await transcribeAudio(Buffer.from("x"), "a.m4a", { groqApiKey: "gsk_test" });
    expect(result).toEqual({
      success: true,
      transcript: "remember to renew the travel insurance",
      provider: "groq whisper-large-v3-turbo",
    });
    delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
  });

  it("uses OpenAI for long audio when enabled", async () => {
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "remember to renew the travel insurance";
    const result = await transcribeAudio(Buffer.from("x"), "a.m4a", {
      groqApiKey: "gsk_test",
      openaiApiKey: "sk-openai",
      useOpenAiForLongAudio: true,
      durationSeconds: 301,
    });
    expect(result).toEqual({
      success: true,
      transcript: "remember to renew the travel insurance",
      provider: "openai whisper-1",
    });
    delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
  });

  it("uses OpenRouter for long audio when selected", async () => {
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "remember to renew the travel insurance";
    const result = await transcribeAudio(Buffer.from("x"), "a.m4a", {
      groqApiKey: "gsk_test",
      openrouterApiKey: "sk-or-test",
      openrouterModel: "openai/whisper-large-v3",
      longTranscriptionProvider: "openrouter",
      durationSeconds: 301,
    });
    expect(result).toEqual({
      success: true,
      transcript: "remember to renew the travel insurance",
      provider: "openrouter openai/whisper-large-v3",
    });
    delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
  });

  it("keeps short audio on Groq when OpenRouter is configured", async () => {
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "remember to renew the travel insurance";
    const result = await transcribeAudio(Buffer.from("x"), "a.m4a", {
      groqApiKey: "gsk_test",
      openrouterApiKey: "sk-or-test",
      longTranscriptionProvider: "openrouter",
      durationSeconds: 120,
    });
    expect(result).toEqual({
      success: true,
      transcript: "remember to renew the travel insurance",
      provider: "groq whisper-large-v3-turbo",
    });
    delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
  });

  it("falls back from failed Groq to OpenRouter before local whisper", async () => {
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "remember to renew the travel insurance";
    process.env.ZENOD_TRANSCRIPTION_FAKE_FAIL_PROVIDERS = "groq";
    const result = await transcribeAudio(Buffer.from("x"), "a.m4a", {
      groqApiKey: "gsk_test",
      openrouterApiKey: "sk-or-test",
      openrouterModel: "openai/whisper-large-v3",
      longTranscriptionProvider: "local",
      durationSeconds: 120,
    });
    expect(result).toEqual({
      success: true,
      transcript: "remember to renew the travel insurance",
      provider: "openrouter openai/whisper-large-v3",
    });
    delete process.env.ZENOD_TRANSCRIPTION_FAKE_FAIL_PROVIDERS;
    delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
  });

  it("falls back from failed OpenRouter to local whisper", async () => {
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "remember to renew the travel insurance";
    process.env.ZENOD_TRANSCRIPTION_FAKE_FAIL_PROVIDERS = "openrouter";
    const result = await transcribeAudio(Buffer.from("x"), "a.m4a", {
      groqApiKey: "gsk_test",
      openrouterApiKey: "sk-or-test",
      openrouterModel: "openai/whisper-large-v3",
      longTranscriptionProvider: "openrouter",
      durationSeconds: 301,
    });
    expect(result).toEqual({
      success: true,
      transcript: "remember to renew the travel insurance",
      provider: "whisper.cpp large-v3-turbo",
    });
    delete process.env.ZENOD_TRANSCRIPTION_FAKE_FAIL_PROVIDERS;
    delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
  });

  it("keeps long audio off Groq when OpenAI is unavailable", async () => {
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "remember to renew the travel insurance";
    const result = await transcribeAudio(Buffer.from("x"), "a.m4a", {
      groqApiKey: "gsk_test",
      durationSeconds: 301,
    });
    expect(result).toEqual({
      success: true,
      transcript: "remember to renew the travel insurance",
      provider: "whisper.cpp large-v3-turbo",
    });
    delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
  });
});

describe("drive tools + API", () => {
  let dir: string;
  let runtime: Runtime;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-drive-"));
    runtime = new Runtime(dir);
  });

  afterEach(async () => {
    runtime.close();
    await rm(dir, { recursive: true, force: true });
    delete process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT;
    vi.unstubAllGlobals();
  });

  it("buildDriveTools is undefined until a service account is saved", () => {
    expect(buildDriveTools(runtime.settings, runtime.ingestQueue)).toBeUndefined();
  });

  it("ingests an audio file: download, transcribe, store, archive in Drive", async () => {
    const moves: string[] = [];
    vi.stubGlobal("fetch", stubFetch(moves));
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "remember to renew the travel insurance";
    runtime.settings.set("google_service_account_json", SA_JSON);
    runtime.settings.set("google_drive_folder_id", "folder-9");

    const stored: StoreInput[] = [];
    const fakeEngine = {
      async store(input: StoreInput) {
        stored.push(input);
        return {
          evidenceRef: "Log/2026-06-12.md#^e-abc123",
          pagesTouched: ["Areas/Insurance.md"],
            commitSha: "0".repeat(40),
          githubUrls: [
            "https://github.com/o/r/blob/main/Log/2026-06-12.md",
            "https://github.com/o/r/blob/main/Areas/Insurance.md",
          ],
          backlog: {
            candidates: [
              {
                title: "Renew travel insurance",
                type: "action",
                owner: "human",
                priority: "P1",
                status: "proposed",
                source_refs: [{ path: "Log/2026-06-12.md#^e-abc123", githubUrl: "" }],
                summary: "Renew the travel insurance from the voice note.",
                context: "Drive voice note ingestion",
                acceptance_criteria: ["Travel insurance is renewed."],
                dependencies: [],
                open_questions: [],
                difficulty: "low",
                suggested_labels: ["backlog"],
              },
            ],
            written: [{ path: "Backlog/renew-travel-insurance.md", githubUrl: "", title: "Renew travel insurance" }],
            skipped: [],
            source_refs: [{ path: "Log/2026-06-12.md#^e-abc123", githubUrl: "" }],
          },
        };
      },
    } as unknown as BrainEngine;

    const queue = new IngestQueue(runtime.ingestStore, runtime.settings, async () => fakeEngine);
    const tools = buildDriveTools(runtime.settings, queue)!;
    const listing = await tools.listDriveFiles();
    expect(listing).toContain("Zenod voice note.m4a");
    expect(listing).toContain("id: file-1");

    const report = await tools.ingestDriveFile("file-1", ["insurance"]);
    expect(report).toContain('Queued "Zenod voice note.m4a" for media/document ingestion');

    const done = await waitFor(
      () => runtime.ingestStore.recent(1)[0],
      (job) => job?.status === "done",
    );
    expect(done?.evidenceRef).toBe("Log/2026-06-12.md#^e-abc123");
    expect(done?.sourceLink).toBe("https://drive.google.com/file/d/file-1/view");
    expect(done?.transcribedBy).toBe("whisper.cpp large-v3-turbo");
    expect(done?.pages).toEqual(["Areas/Insurance.md"]);
    expect(done?.githubUrls).toEqual([
      "https://github.com/o/r/blob/main/Log/2026-06-12.md",
      "https://github.com/o/r/blob/main/Areas/Insurance.md",
    ]);
    expect(done?.backlog?.candidates[0]?.title).toBe("Renew travel insurance");
    expect(done?.backlog?.written[0]?.path).toBe("Backlog/renew-travel-insurance.md");
    expect(done?.archived).toBe(true);
    expect(done?.cached).toBe(true);
    expect(moves).toEqual(["archive-folder-1"]); // moved into the auto-created Archive/
    expect(stored).toHaveLength(1);
    expect(stored[0]!.source).toBe("drive");
    expect(stored[0]!.verbatim).toBe(true);
    expect(stored[0]!.hints).toEqual(["insurance"]);
    expect(stored[0]!.content).toContain("remember to renew the travel insurance");
    expect(stored[0]!.content).toContain("https://drive.google.com/file/d/file-1/view");
  });

  it("returns a loud terminal error when audio transcription fails and does not fake a commit", async () => {
    vi.stubGlobal("fetch", stubFetch());
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "you";
    runtime.settings.set("google_service_account_json", SA_JSON);
    runtime.settings.set("google_drive_folder_id", "folder-9");

    const stored: StoreInput[] = [];
    const fakeEngine = {
      async store(input: StoreInput) {
        stored.push(input);
        throw new Error("store should not be called after transcription failure");
      },
    } as unknown as BrainEngine;

    const queue = new IngestQueue(runtime.ingestStore, runtime.settings, async () => fakeEngine);
    const tools = buildDriveTools(runtime.settings, queue)!;
    await tools.ingestDriveFile("file-1", ["insurance"]);

    const failed = await waitFor(
      () => runtime.ingestStore.recent(1)[0],
      (job) => job?.status === "error",
    );
    expect(failed?.error).toMatch(/transcription failed/i);
    expect(failed?.commitSha).toBeNull();
    expect(failed?.evidenceRef).toBeNull();
    expect(failed?.githubUrls).toEqual([]);
    expect(stored).toHaveLength(0);
  });

  it("uses the configured Groq key for Drive audio ingestion", async () => {
    const moves: string[] = [];
    vi.stubGlobal("fetch", stubFetch(moves));
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "remember to renew the travel insurance";
    runtime.settings.set("google_service_account_json", SA_JSON);
    runtime.settings.set("google_drive_folder_id", "folder-9");
    runtime.settings.set("groq_api_key", "gsk_test");

    const stored: StoreInput[] = [];
    const fakeEngine = {
      async store(input: StoreInput) {
        stored.push(input);
        return {
          evidenceRef: "Log/2026-06-12.md#^e-abc123",
          pagesTouched: ["Areas/Insurance.md"],
          commitSha: "0".repeat(40),
          githubUrls: [],
        };
      },
    } as unknown as BrainEngine;

    const queue = new IngestQueue(runtime.ingestStore, runtime.settings, async () => fakeEngine);
    const tools = buildDriveTools(runtime.settings, queue)!;

    await tools.ingestDriveFile("file-1", ["insurance"]);
    await waitFor(
      () => runtime.ingestStore.recent(1)[0],
      (job) => job?.status === "done",
    );

    expect(stored).toHaveLength(1);
    expect(stored[0]!.content).toContain("Transcribed by groq whisper-large-v3-turbo.");
  });

  it("ingests an image: vision extraction, vault evidence, commit receipt, and Drive archive", async () => {
    const moves: string[] = [];
    vi.stubGlobal("fetch", stubFetch(moves));
    runtime.settings.set("google_service_account_json", SA_JSON);
    runtime.settings.set("google_drive_folder_id", "folder-9");

    const stored: StoreInput[] = [];
    const fakeEngine = {
      async describeImage(data: Uint8Array, mimeType: string, prompt?: string) {
        expect(Buffer.from(data).toString("utf8")).toBe("fake-png-bytes");
        expect(mimeType).toBe("image/png");
        expect(prompt).toContain("visible text");
        return "Screenshot fact: launch revenue is EUR 500 and owner is Jordi.";
      },
      async store(input: StoreInput) {
        stored.push(input);
        return {
          evidenceRef: "Log/2026-06-12.md#^e-img123",
          pagesTouched: ["Projects/Launch.md"],
          commitSha: "1".repeat(40),
          githubUrls: ["https://github.com/owner/vault/blob/111/Projects/Launch.md"],
        };
      },
    } as unknown as BrainEngine;

    const queue = new IngestQueue(runtime.ingestStore, runtime.settings, async () => fakeEngine);
    const tools = buildDriveTools(runtime.settings, queue)!;

    const report = await tools.ingestDriveFile("image-1", ["launch"]);
    expect(report).toContain('Queued "Launch metrics screenshot.png" for media/document ingestion');

    const done = await waitFor(
      () => runtime.ingestStore.recent(1)[0],
      (job) => job?.status === "done",
    );
    expect(done?.evidenceRef).toBe("Log/2026-06-12.md#^e-img123");
    expect(done?.pages).toEqual(["Projects/Launch.md"]);
    expect(done?.commitSha).toBe("1".repeat(40));
    expect(done?.archived).toBe(true);
    expect(done?.cached).toBe(true);
    expect(done?.extractionProvider).toBe("vision model");
    expect(done?.sourceLink).toBe("https://drive.google.com/file/d/image-1/view");
    expect(moves).toEqual(["archive-folder-1"]);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.source).toBe("drive");
    expect(stored[0]!.verbatim).toBe(true);
    expect(stored[0]!.hints).toEqual(["launch"]);
    expect(stored[0]!.content).toContain('Media artifact "Launch metrics screenshot.png" ingested from Google Drive.');
    expect(stored[0]!.content).toContain("Original: https://drive.google.com/file/d/image-1/view");
    expect(stored[0]!.content).toContain("Extracted by vision model.");
    expect(stored[0]!.content).toContain("launch revenue is EUR 500");
  });

  it("ingests an embedded-text PDF through the same evidence and archive path", async () => {
    vi.stubGlobal("fetch", stubFetch());
    runtime.settings.set("google_service_account_json", SA_JSON);
    runtime.settings.set("google_drive_folder_id", "folder-9");

    const stored: StoreInput[] = [];
    const fakeEngine = {
      async store(input: StoreInput) {
        stored.push(input);
        return {
          evidenceRef: "Log/2026-06-12.md#^e-pdf123",
          pagesTouched: ["Areas/Insurance.md"],
          commitSha: "2".repeat(40),
          githubUrls: ["https://github.com/owner/vault/blob/222/Areas/Insurance.md"],
        };
      },
    } as unknown as BrainEngine;

    const queue = new IngestQueue(runtime.ingestStore, runtime.settings, async () => fakeEngine);
    const tools = buildDriveTools(runtime.settings, queue)!;

    await tools.ingestDriveFile("pdf-1", ["insurance"]);
    const done = await waitFor(
      () => runtime.ingestStore.recent(1)[0],
      (job) => job?.status === "done",
    );
    expect(done?.evidenceRef).toBe("Log/2026-06-12.md#^e-pdf123");
    expect(done?.pages).toEqual(["Areas/Insurance.md"]);
    expect(done?.commitSha).toBe("2".repeat(40));
    expect(done?.extractionProvider).toBe("embedded PDF text");
    expect(done?.sourceLink).toBe("https://drive.google.com/file/d/pdf-1/view");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.content).toContain('Media artifact "Axa policy.pdf" ingested from Google Drive.');
    expect(stored[0]!.content).toContain("Extracted by embedded PDF text.");
    expect(stored[0]!.content).toContain("Renewal date: 2026-08-15");
    expect(stored[0]!.content).toContain("Policy holder: Jordi");
  });

  it("fails loudly for scanned PDFs when OCR/vision extraction cannot read text", async () => {
    vi.stubGlobal("fetch", stubFetch());
    runtime.settings.set("google_service_account_json", SA_JSON);
    runtime.settings.set("google_drive_folder_id", "folder-9");

    const fakeEngine = {
      async store() {
        throw new Error("store should not run after extraction failure");
      },
    } as unknown as BrainEngine;

    const queue = new IngestQueue(runtime.ingestStore, runtime.settings, async () => fakeEngine);
    const tools = buildDriveTools(runtime.settings, queue)!;

    await tools.ingestDriveFile("scanned-pdf-1", ["receipts"]);
    const failed = await waitFor(
      () => runtime.ingestStore.recent(1)[0],
      (job) => job?.status === "error",
    );
    expect(failed?.error).toContain("PDF extraction failed");
    expect(failed?.error).toContain("scanned PDFs need OCR/vision extraction configured");
    expect(failed?.evidenceRef).toBeNull();
    expect(failed?.commitSha).toBeNull();
  });

  it("retries filing from the cached transcript without transcribing again", async () => {
    vi.stubGlobal("fetch", stubFetch());
    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "first cached transcript";
    runtime.settings.set("google_service_account_json", SA_JSON);
    runtime.settings.set("google_drive_folder_id", "folder-9");

    const stored: StoreInput[] = [];
    let failStore = true;
    const fakeEngine = {
      async store(input: StoreInput) {
        stored.push(input);
        if (failStore) {
          failStore = false;
          throw new Error("temporary filing failure");
        }
        return {
          evidenceRef: "Log/2026-06-12.md#^e-abc123",
          pagesTouched: ["Areas/Insurance.md"],
          commitSha: "0".repeat(40),
          githubUrls: [],
        };
      },
    } as unknown as BrainEngine;

    const queue = new IngestQueue(runtime.ingestStore, runtime.settings, async () => fakeEngine);
    const tools = buildDriveTools(runtime.settings, queue)!;

    await tools.ingestDriveFile("file-1", ["insurance"]);
    const failed = await waitFor(
      () => runtime.ingestStore.recent(1)[0],
      (job) => job?.status === "error",
    );
    expect(failed?.cached).toBe(true);
    expect(failed?.error).toBe("temporary filing failure");

    process.env.ZENOD_WHISPER_FAKE_TRANSCRIPT = "second transcript should not be used";
    queue.retry(failed!.id);
    const done = await waitFor(
      () => runtime.ingestStore.recent(1)[0],
      (job) => job?.status === "done",
    );

    expect(done?.cached).toBe(true);
    expect(stored).toHaveLength(2);
    expect(stored[1]!.content).toContain("first cached transcript");
    expect(stored[1]!.content).not.toContain("second transcript should not be used");
  });

  it("masks the new secrets and exposes drive status", async () => {
    runtime.settings.set("google_service_account_json", SA_JSON);
    runtime.settings.set("google_oauth_client_secret", "oauth-secret");
    const masked = runtime.settings.masked();
    expect(masked.google_service_account_json).toMatch(/^••••/);
    expect(masked.google_service_account_json).not.toContain("PRIVATE KEY");
    expect(masked.google_oauth_client_secret).toMatch(/^••••/);

    const app = createApp(runtime);
    runtime.settings.setAdminPassword("hunter2hunter2");
    const login = await app.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: "hunter2hunter2" }),
    });
    const cookie = login.headers.get("set-cookie")!;
    const status = await app.request("/api/drive/status", { headers: { cookie } });
    expect(status.status).toBe(200);
    const body = await status.json();
    expect(body.configured).toBe(true);
    expect(body.clientEmail).toBe("zenod@test-project.iam.gserviceaccount.com");
    expect(body.transcriptionProvider).toBe("local whisper.cpp for long notes");
  });

  it("connects Google Drive OAuth through start/callback and prefers OAuth for Drive", async () => {
    vi.stubGlobal("fetch", stubFetch());
    runtime.settings.set("google_service_account_json", SA_JSON);
    runtime.settings.set("google_oauth_client_id", "client-id");
    runtime.settings.set("google_oauth_client_secret", "client-secret");
    runtime.settings.set("artifact_archive_provider", "local");
    runtime.settings.setAdminPassword("hunter2hunter2");
    const app = createApp(runtime);
    const login = await app.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: "hunter2hunter2" }),
    });
    const cookie = login.headers.get("set-cookie")!;

    const start = await app.request("https://c1.zenod.dev/api/drive/oauth/start", { headers: { cookie } });
    expect(start.status).toBe(302);
    const location = start.headers.get("location")!;
    expect(location).toContain("accounts.google.com");
    const state = runtime.settings.getRaw("google_oauth_state")!;
    expect(location).toContain(encodeURIComponent(state));

    const callback = await app.request(
      `https://c1.zenod.dev/api/drive/oauth/callback?code=code-123&state=${encodeURIComponent(state)}`,
      { headers: { cookie } },
    );
    expect(callback.status).toBe(302);
    expect(runtime.settings.getRaw("google_oauth_refresh_token")).toBe("refresh-123");
    expect(runtime.settings.getRaw("google_oauth_email")).toBe("jordi@example.com");
    expect(runtime.settings.get("artifact_archive_provider")).toBe("drive");

    const status = await app.request("/api/drive/status", { headers: { cookie } });
    const body = await status.json();
    expect(body.configured).toBe(true);
    expect(body.authMode).toBe("oauth");
    expect(body.oauthEmail).toBe("jordi@example.com");
  });

  it("exposes OpenRouter as the long-note and Groq fallback provider", async () => {
    runtime.settings.set("google_service_account_json", SA_JSON);
    runtime.settings.set("openrouter_api_key", "sk-or-test");
    runtime.settings.set("openrouter_transcription_model", "openai/whisper-large-v3");
    const app = createApp(runtime);
    runtime.settings.setAdminPassword("hunter2hunter2");
    const login = await app.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: "hunter2hunter2" }),
    });
    const cookie = login.headers.get("set-cookie")!;
    const status = await app.request("/api/drive/status", { headers: { cookie } });
    expect(status.status).toBe(200);
    const body = await status.json();
    expect(body.transcriptionProvider).toBe(
      "openrouter openai/whisper-large-v3 for notes over 5 min and Groq fallback",
    );
  });

  it("exposes popular OpenRouter transcription models with cost metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toContain("sort=most-popular");
        return Response.json({
          data: [
            {
              id: "google/gemini-3-flash-preview",
              name: "Google: Gemini 3 Flash Preview",
              architecture: { modality: "text+image+audio+video->text" },
              pricing: { prompt: "0.0000005", completion: "0.000003" },
            },
            {
              id: "openai/gpt-4o-mini-transcribe",
              name: "OpenAI: GPT-4o Mini Transcribe",
              architecture: { modality: "audio->transcription" },
              pricing: { prompt: "0.00000125", completion: "0.000005" },
            },
            {
              id: "openai/whisper-large-v3",
              name: "OpenAI: Whisper Large V3",
              architecture: { modality: "audio->transcription" },
              pricing: { prompt: "0.0015", completion: "0" },
            },
          ],
        });
      }),
    );
    runtime.settings.set("openrouter_transcription_model", "openai/whisper-large-v3");
    const app = createApp(runtime);
    runtime.settings.setAdminPassword("hunter2hunter2");
    const login = await app.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: "hunter2hunter2" }),
    });
    const cookie = login.headers.get("set-cookie")!;
    const response = await app.request("/api/transcription/openrouter-models", { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.selected).toBe("openai/whisper-large-v3");
    expect(body.fallback).toBe(false);
    expect(body.models).toHaveLength(2);
    expect(body.models[0]).toMatchObject({
      id: "openai/gpt-4o-mini-transcribe",
      name: "OpenAI: GPT-4o Mini Transcribe",
      popularityRank: 1,
      costLabel: "$1.25/1M in · $5.00/1M out",
    });
    expect(body.models[1]).toMatchObject({
      id: "openai/whisper-large-v3",
      popularityRank: 2,
      costLabel: "$0.0015/min audio",
    });
  });
});
