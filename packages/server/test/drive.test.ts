import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainEngine, StoreInput } from "zenod";
import { DriveClient, parseServiceAccount, testDrive } from "../src/drive.js";
import { buildDriveTools } from "../src/driveTools.js";
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

/** fetch stub: token exchange + Drive list/get/download + whisper endpoint. */
function stubFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const assertion = new URLSearchParams(String(init?.body)).get("assertion")!;
      expect(assertion.split(".")).toHaveLength(3); // a signed JWT
      return Response.json({ access_token: "tok-123", expires_in: 3600 });
    }
    expect((init?.headers as Record<string, string> | undefined)?.Authorization ?? "Bearer tok-123").toContain(
      "Bearer",
    );
    if (url.includes("/drive/v3/files?") || url.includes("corpora=allDrives")) {
      return Response.json({ files: FILES });
    }
    if (url.includes("/drive/v3/files/file-1") && url.includes("alt=media")) {
      return new Response(Buffer.from("fake-audio-bytes"));
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
  it("fails cleanly without a key", async () => {
    const result = await transcribeAudio(Buffer.from("x"), "a.m4a", null);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no transcription key/);
  });

  it("transcribes through the configured provider", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const result = await transcribeAudio(Buffer.from("x"), "a.m4a", { provider: "groq", apiKey: "gsk_test" });
    expect(result).toEqual({
      success: true,
      transcript: "remember to renew the travel insurance",
      provider: "groq",
    });
    vi.unstubAllGlobals();
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
    runtime.state.close();
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("buildDriveTools is undefined until a service account is saved", () => {
    expect(buildDriveTools(runtime.settings, () => Promise.reject(new Error("unused")))).toBeUndefined();
  });

  it("ingests an audio file: download, transcribe, store with Drive provenance", async () => {
    vi.stubGlobal("fetch", stubFetch());
    runtime.settings.set("google_service_account_json", SA_JSON);
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

    const tools = buildDriveTools(runtime.settings, async () => fakeEngine)!;
    const listing = await tools.listDriveFiles();
    expect(listing).toContain("Zenod voice note.m4a");
    expect(listing).toContain("id: file-1");

    const report = await tools.ingestDriveFile("file-1", ["insurance"]);
    expect(report).toContain("Ingested Zenod voice note.m4a");
    expect(report).toContain("Areas/Insurance.md");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.source).toBe("drive");
    expect(stored[0]!.verbatim).toBe(true);
    expect(stored[0]!.hints).toEqual(["insurance"]);
    expect(stored[0]!.content).toContain("remember to renew the travel insurance");
    expect(stored[0]!.content).toContain("https://drive.google.com/file/d/file-1/view");
  });

  it("masks the new secrets and exposes drive status", async () => {
    runtime.settings.set("google_service_account_json", SA_JSON);
    runtime.settings.set("groq_api_key", "gsk_secret");
    const masked = runtime.settings.masked();
    expect(masked.google_service_account_json).toMatch(/^••••/);
    expect(masked.groq_api_key).toMatch(/^••••/);
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
    expect(body.transcriptionProvider).toBe("groq");
  });
});
