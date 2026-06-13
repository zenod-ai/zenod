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
  },
];

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
      const assertion = new URLSearchParams(String(init?.body)).get("assertion")!;
      expect(assertion.split(".")).toHaveLength(3); // a signed JWT
      return Response.json({ access_token: "tok-123", expires_in: 3600 });
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
    if (url.includes("/drive/v3/files/file-1") && method === "PATCH") {
      moves.push(new URL(url).searchParams.get("addParents") ?? "");
      return Response.json({ id: "file-1" });
    }
    if (url.includes("/drive/v3/files/file-1") && url.includes("alt=media")) {
      return new Response(Buffer.from("fake-audio-bytes"));
    }
    if (url.includes("/drive/v3/files/file-1") && url.includes("fields=parents")) {
      return Response.json({ parents: ["folder-9"] });
    }
    if (url.includes("/drive/v3/files/file-1")) {
      return Response.json(FILES[0]);
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
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe("Zenod voice note.m4a");
    vi.unstubAllGlobals();
  });

  it("testDrive reports the service account email", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const result = await testDrive(SA_JSON);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("zenod@test-project.iam.gserviceaccount.com");
    vi.unstubAllGlobals();
  });
});

describe("transcription envelope", () => {
  it("fails cleanly when the local model is unavailable", async () => {
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
          githubUrls: [],
        };
      },
    } as unknown as BrainEngine;

    const queue = new IngestQueue(runtime.ingestStore, runtime.settings, async () => fakeEngine);
    const tools = buildDriveTools(runtime.settings, queue)!;
    const listing = await tools.listDriveFiles();
    expect(listing).toContain("Zenod voice note.m4a");
    expect(listing).toContain("id: file-1");

    const report = await tools.ingestDriveFile("file-1", ["insurance"]);
    expect(report).toContain('Queued "Zenod voice note.m4a" for ingestion');

    const done = await waitFor(
      () => runtime.ingestStore.recent(1)[0],
      (job) => job?.status === "done",
    );
    expect(done?.evidenceRef).toBe("Log/2026-06-12.md#^e-abc123");
    expect(done?.pages).toEqual(["Areas/Insurance.md"]);
    expect(done?.archived).toBe(true);
    expect(moves).toEqual(["archive-folder-1"]); // moved into the auto-created Archive/
    expect(stored).toHaveLength(1);
    expect(stored[0]!.source).toBe("drive");
    expect(stored[0]!.verbatim).toBe(true);
    expect(stored[0]!.hints).toEqual(["insurance"]);
    expect(stored[0]!.content).toContain("remember to renew the travel insurance");
    expect(stored[0]!.content).toContain("https://drive.google.com/file/d/file-1/view");
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

  it("masks the new secrets and exposes drive status", async () => {
    runtime.settings.set("google_service_account_json", SA_JSON);
    const masked = runtime.settings.masked();
    expect(masked.google_service_account_json).toMatch(/^••••/);
    expect(masked.google_service_account_json).not.toContain("PRIVATE KEY");

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
    expect(body.transcriptionProvider).toBe("whisper.cpp (local)");
  });
});
