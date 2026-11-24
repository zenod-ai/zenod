import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BrainEngine } from "zenod";

import { INGEST_MEMORY_SHAPE } from "../src/mcpToolSchemas.js";
import { Runtime } from "../src/runtime.js";
import { TaskJobQueue } from "../src/taskJobQueue.js";
import { TaskJobStore } from "../src/taskJobStore.js";

/** EPIC-20 A9: the number a WhatsApp note was sent TO reaches the subscriber (agent_team's desk router) as note.to_number. */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const NOTE_REF = "Log/2026-11-24.md#^e-desk001";
const RECEIPT = { evidenceRef: NOTE_REF, pagesTouched: [], commitSha: "a".repeat(40), githubUrls: [], filing: "filed" as const };

describe("to_number for subscribers (EPIC-20 A9)", () => {
  it("ingest_memory takes the toNumber Phylax sends", () => {
    expect(INGEST_MEMORY_SHAPE.toNumber.safeParse("+34600000002").success).toBe(true);
    expect(INGEST_MEMORY_SHAPE.toNumber.safeParse(undefined).success).toBe(true);
  });

  it("hands toNumber to the capture hook once a note is durably kept", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zenod-to-number-queue-"));
    const engine = { store: vi.fn(async () => RECEIPT) } as unknown as BrainEngine;
    const stored = vi.fn();
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    try {
      const queue = new TaskJobQueue(store, async () => engine, undefined, undefined, undefined, stored);
      const job = queue.enqueue("store", { content: "now", source: "whatsapp", contentType: "text", announceTo: ["sub_1"], toNumber: "+34600000002" }, "k1");
      for (let attempt = 0; attempt < 200 && store.get(job.id)?.status !== "done"; attempt += 1) await sleep(5);
      await queue.close();
      expect(stored).toHaveBeenCalledExactlyOnceWith({ evidenceRef: NOTE_REF, contentType: "text", source: "whatsapp", announceTo: ["sub_1"], toNumber: "+34600000002" });
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a typed message sent to a desk's number reaches its subscription with to_number", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zenod-to-number-rt-"));
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response("ok", { status: 200 });
    }));
    const runtime = new Runtime(dir, undefined, { seedFromEnv: false, tenantId: "jordi", subscriberEnv: { ZENOD_SUBSCRIBERS: "on" } as NodeJS.ProcessEnv });
    try {
      runtime.subscribers!.create({ name: "Epic Team", kind: "agent_team", url: "https://93.184.216.34/api/hooks/zenod/c1", event: "voice_note.captured", via: "manual", replyWords: ["now"] });
      const engine = { store: vi.fn(async () => RECEIPT) } as unknown as BrainEngine;
      vi.spyOn(runtime, "getEngine").mockResolvedValue(engine);
      const queue = runtime.taskJobQueue;
      const job = queue.enqueue("chat", { text: "now", source: "whatsapp", conversationKey: "whatsapp:+521", toNumber: "+34600000002" }, "jordi:whatsapp:m1");
      for (let attempt = 0; attempt < 400 && queue.get(job.id)?.status !== "done"; attempt += 1) await sleep(5);
      for (let attempt = 0; attempt < 400 && !calls.length; attempt += 1) await sleep(5);
      await runtime.subscriberDispatcher!.idle();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ type: "voice_note.captured", note: { id: NOTE_REF, content_type: "text", to_number: "+34600000002" } });
    } finally {
      vi.unstubAllGlobals();
      await runtime.taskJobQueue.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
