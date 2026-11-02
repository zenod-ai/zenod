import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrainEngine } from "zenod";

import { createEntryHook, entryHookConfigFromEnv, signEntryHook, type EntryHookConfig } from "../src/entryHook.js";
import type { Settings } from "../src/settings.js";
import { TaskJobQueue } from "../src/taskJobQueue.js";
import { TaskJobStore } from "../src/taskJobStore.js";

// agent_team E42-S20: a stored voice note pokes the console on the same host (signed pointer, operator-only, off by default).

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const config: EntryHookConfig = { url: "http://100.104.206.10:8750/api/hooks/zenod/voice-note", secret: "s3cret", tenants: new Set(["jordi"]), contentTypes: new Set(["voice_note"]) };

describe("entry hook", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("is off unless URL, secret and tenants are all set and the URL is http(s)", () => {
    expect(entryHookConfigFromEnv({})).toBeNull();
    expect(entryHookConfigFromEnv({ ZENOD_ENTRY_HOOK_URL: "http://x/h", ZENOD_ENTRY_HOOK_SECRET: "s" })).toBeNull();
    expect(entryHookConfigFromEnv({ ZENOD_ENTRY_HOOK_URL: "file:///etc/passwd", ZENOD_ENTRY_HOOK_SECRET: "s", ZENOD_ENTRY_HOOK_TENANTS: "a" })).toBeNull();
    const on = entryHookConfigFromEnv({ ZENOD_ENTRY_HOOK_URL: "http://x/h", ZENOD_ENTRY_HOOK_SECRET: "s", ZENOD_ENTRY_HOOK_TENANTS: " a, b " });
    expect(on && [...on.tenants]).toEqual(["a", "b"]);
    expect(on && [...on.contentTypes]).toEqual(["voice_note"]);
  });

  it("posts a signed pointer for a listed tenant's voice note, and nothing for other tenants or types", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response(null, { status: 202 })));
    const lines: string[] = [];
    const hook = createEntryHook(config, "jordi", { fetch: fetch as never, now: () => 1_800_000_000_000, log: (l) => lines.push(l) });
    hook({ evidenceRef: "Log/2026-11-02.md#^e-c927b7", contentType: "voice_note", source: "whatsapp" });
    hook({ evidenceRef: "Log/2026-11-02.md#^e-000001", contentType: "note", source: "mcp" });
    createEntryHook(config, "someone-else", { fetch: fetch as never })({ evidenceRef: "Log/x.md#^e-1", contentType: "voice_note" });
    createEntryHook(null, "jordi", { fetch: fetch as never })({ evidenceRef: "Log/x.md#^e-1", contentType: "voice_note" });
    await sleep(10);
    expect(calls).toHaveLength(1);
    const body = String(calls[0].init.body);
    expect(JSON.parse(body)).toEqual({ event: "voice_note.stored", evidenceRef: "Log/2026-11-02.md#^e-c927b7", tenant: "jordi" });
    const sig = (calls[0].init.headers as Record<string, string>)["x-zenod-signature"];
    expect(sig).toBe(`t=1800000000,v1=${createHmac("sha256", "s3cret").update(`1800000000.${body}`).digest("hex")}`);
    expect(sig).toBe(signEntryHook(body, "s3cret", 1_800_000_000));
    expect(lines).toEqual(["[entry-hook] tenant=jordi Log/2026-11-02.md#^e-c927b7 -> 202"]);
    expect(lines.join("\n")).not.toContain("s3cret");
  });

  it("retries a 5xx or network error twice, never a 4xx, and never throws", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(new Response(null, { status: 502 })).mockResolvedValueOnce(new Response(null, { status: 202 }));
    const lines: string[] = [];
    createEntryHook(config, "jordi", { fetch: fetch as never, retryMs: [1, 1], log: (l) => lines.push(l) })({ evidenceRef: "Log/a.md#^e-1", contentType: "voice_note" });
    await sleep(30);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(lines).toEqual(["[entry-hook] tenant=jordi Log/a.md#^e-1 -> 202"]);

    const refused = vi.fn(async () => new Response(null, { status: 401 }));
    createEntryHook(config, "jordi", { fetch: refused as never, retryMs: [1, 1], log: () => {} })({ evidenceRef: "Log/a.md#^e-2", contentType: "voice_note" });
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const downLines: string[] = [];
    createEntryHook(config, "jordi", { fetch: down as never, retryMs: [1, 1], log: (l) => downLines.push(l) })({ evidenceRef: "Log/a.md#^e-3", contentType: "voice_note" });
    await sleep(30);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(down).toHaveBeenCalledTimes(3);
    expect(downLines).toEqual(["[entry-hook] tenant=jordi Log/a.md#^e-3 failed after 3 tries (TypeError)"]);
  });

  it("the queue calls it once a WhatsApp voice note is durably captured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-entry-hook-"));
    dirs.push(dir);
    const settings = { get: (key: string) => ({ artifact_archive_provider: "local", artifact_archive_local_dir: join(dir, "archive") })[key] ?? null } as unknown as Settings;
    const receipt = { evidenceRef: "Log/2026-11-02.md#^e-c927b7", pagesTouched: [], commitSha: "a".repeat(40), githubUrls: [], filing: "filed" as const };
    const engine = { captureEvidence: vi.fn(async () => receipt), enrichEvidence: vi.fn(async () => receipt) } as unknown as BrainEngine;
    const stored = vi.fn();
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const queue = new TaskJobQueue(store, async () => engine, settings, undefined, undefined, stored);
    const job = queue.enqueue("media_ingest", {
      mediaType: "audio", contentType: "voice_note", sourceHint: "WhatsApp voice note", filename: "v.ogg",
      bytesRef: `data:audio/ogg;base64,${Buffer.from("voice").toString("base64")}`,
      providedTranscript: "Push, not poll.", transcriptionDisposition: "provided",
    }, "jordi:whatsapp:v1");
    for (let attempt = 0; attempt < 200 && store.get(job.id)?.status !== "done"; attempt += 1) await sleep(5);
    await queue.close();
    expect(stored).toHaveBeenCalledExactlyOnceWith({ evidenceRef: "Log/2026-11-02.md#^e-c927b7", contentType: "voice_note", source: "whatsapp" });
    store.close();
  });
});
