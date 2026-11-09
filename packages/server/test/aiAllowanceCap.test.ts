import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmAllowanceExceededError, type BrainEngine } from "zenod";

import {
  aiAllowanceExhaustedMessage,
  projectLedgerUsage,
} from "../src/customerMetering.js";
import { terminalCaptureReceipt } from "../src/phylaxChannels.js";
import { Runtime } from "../src/runtime.js";
import { Settings, tenantAllowanceEnforcedFromEnv } from "../src/settings.js";
import { TaskJobQueue } from "../src/taskJobQueue.js";
import { TaskJobStore, type MediaIngestReceipt } from "../src/taskJobStore.js";

// EPIC-7 T3: once ZENOD_TENANT_MONTHLY_ALLOWANCE_USD is set, a hosted tenant over it gets the reason
// and no AI call; ZENOD_TENANT_ALLOWANCE_MODE=shadow keeps the old log-only behaviour.

const PLATFORM_KEY = "sk-or-v1-platform-secret-value";
const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
const BLOCK = { message: aiAllowanceExhaustedMessage("2026-12-01T00:00:00.000Z"), resetsAt: "2026-12-01T00:00:00.000Z" };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spend(runtime: Runtime, usd: number, at = NOW): void {
  runtime.usageStore.record(
    {
      operation: "answer",
      provider: "openrouter",
      model: "m",
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      providerCostUsd: usd,
    },
    at,
  );
}

// Runtime dirs created by hostedRuntime are removed after each test (no /tmp leak).
const runtimeDirs: string[] = [];
afterEach(() => {
  for (const dir of runtimeDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function hostedRuntime(options: { allowance: number | null; enforced?: boolean; platform?: boolean }): Runtime {
  const dir = mkdtempSync(join(tmpdir(), "zenod-ai-cap-"));
  runtimeDirs.push(dir);
  return new Runtime(dir, undefined, {
    seedFromEnv: false,
    tenantId: "tenant-a",
    ...(options.platform === false ? {} : { platformLlm: { apiKey: PLATFORM_KEY } }),
    tenantMonthlyAllowanceUsd: options.allowance,
    ...(options.enforced === undefined ? {} : { tenantAllowanceEnforced: options.enforced }),
  });
}

async function waitTerminal(store: TaskJobStore, id: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = store.get(id);
    if (job && (job.status === "done" || job.status === "error")) return job;
    await sleep(5);
  }
  throw new Error(`job ${id} did not finish`);
}

describe("AI allowance config", () => {
  it("enforces by default and keeps shadow mode behind ZENOD_TENANT_ALLOWANCE_MODE=shadow", () => {
    expect(tenantAllowanceEnforcedFromEnv({} as NodeJS.ProcessEnv)).toBe(true);
    expect(tenantAllowanceEnforcedFromEnv({ ZENOD_TENANT_ALLOWANCE_MODE: "enforce" } as NodeJS.ProcessEnv)).toBe(true);
    expect(tenantAllowanceEnforcedFromEnv({ ZENOD_TENANT_ALLOWANCE_MODE: " Shadow " } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("tells the user why, and when it resets, without internals", () => {
    const message = aiAllowanceExhaustedMessage("2026-12-01T00:00:00.000Z");
    expect(message).toContain("used this month's AI allowance");
    expect(message).toContain("1 December 2026");
    // EPIC-14 S10: answers stop, capture does not.
    expect(message).toContain("still kept");
    expect(message).not.toContain("not saved");
    expect(message).not.toMatch(/OpenRouter|\$|token|Phylax/i);
  });
});

describe("Runtime AI allowance gate", () => {
  it("is off while no allowance is set or off the platform key", () => {
    const unset = hostedRuntime({ allowance: null });
    spend(unset, 100);
    expect(unset.aiAllowanceBlock(NOW)).toBeNull();
    expect(() => unset.checkTenantAllowance(NOW)).not.toThrow();

    const selfHosted = hostedRuntime({ allowance: 1, platform: false });
    spend(selfHosted, 100);
    expect(selfHosted.aiAllowanceBlock(NOW)).toBeNull();
    expect(() => selfHosted.checkTenantAllowance(NOW)).not.toThrow();
  });

  it("lets calls through under the allowance and stops them at it", () => {
    const runtime = hostedRuntime({ allowance: 1 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      spend(runtime, 0.4);
      expect(runtime.aiAllowanceBlock(NOW)).toBeNull();
      expect(() => runtime.checkTenantAllowance(NOW)).not.toThrow();

      spend(runtime, 0.6);
      const later = NOW + 61_000; // past the 60s spend cache
      expect(runtime.aiAllowanceBlock(later)).toMatchObject({ message: BLOCK.message, resetsAt: BLOCK.resetsAt });
      expect(() => runtime.checkTenantAllowance(later)).toThrow(LlmAllowanceExceededError);
      const logged = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("llm.allowance.exceeded"));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain("mode=enforce");
      expect(logged[0]).not.toContain(PLATFORM_KEY);
    } finally {
      warn.mockRestore();
    }
  });

  it("shadow mode reports the overrun but never blocks", () => {
    const runtime = hostedRuntime({ allowance: 1, enforced: false });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      spend(runtime, 5);
      expect(runtime.aiAllowanceStatus(NOW)).toMatchObject({ exhausted: true, enforced: false });
      expect(runtime.aiAllowanceBlock(NOW)).toBeNull();
      expect(() => runtime.checkTenantAllowance(NOW)).not.toThrow();
    } finally {
      warn.mockRestore();
    }
  });

  it("a new UTC month starts from zero", () => {
    const runtime = hostedRuntime({ allowance: 1 });
    spend(runtime, 5, Date.UTC(2026, 9, 31, 23, 0, 0));
    expect(runtime.aiAllowanceBlock(NOW)).toBeNull();
  });
});

describe("console usage projection", () => {
  it("pauses at the allowance only when enforced", () => {
    expect(projectLedgerUsage(4, 4, 80, NOW, true)).toMatchObject({ state: "paused", percentageUsed: 100, allowanceUsd: 4 });
    expect(projectLedgerUsage(4, 4, 80, NOW, false)).toMatchObject({ state: "warn", percentageUsed: 100 });
    expect(projectLedgerUsage(1, 4, 80, NOW, true)).toMatchObject({ state: "normal", percentageUsed: 25 });
    expect(projectLedgerUsage(9, null, 80, NOW, true)).toMatchObject({ state: "normal", percentageUsed: 0, allowanceUsd: null });
  });
});

describe("TaskJobQueue over the AI allowance", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function queueWith(block: typeof BLOCK | null, engine: Partial<BrainEngine> = {}) {
    const dir = await mkdtemp(join(tmpdir(), "zenod-ai-cap-queue-"));
    dirs.push(dir);
    const settings = {
      get: (key: string) => ({
        artifact_archive_provider: "local",
        artifact_archive_local_dir: join(dir, "archive"),
      })[key] ?? null,
      googleDriveOAuthAuthority: () => ({ mode: "self-managed" }),
    } as unknown as Settings;
    const getEngine = vi.fn(async () => engine as BrainEngine);
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const queue = new TaskJobQueue(store, getEngine, settings, undefined, () => block);
    return { store, queue, getEngine };
  }

  it("answers a chat turn with the reason, never asks the model, and keeps the words as a note", async () => {
    const chat = vi.fn();
    const { store, queue } = await queueWith(BLOCK, { chat } as Partial<BrainEngine>);
    const quiet = [vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];
    try {
      const job = queue.enqueue("chat", { text: "remember the blue lantern", source: "whatsapp", conversationKey: "whatsapp:1" }, "t:whatsapp:m1");
      const done = await waitTerminal(store, job.id);
      expect(done).toMatchObject({ status: "done", result: { text: BLOCK.message, sources: [] } });
      expect(chat).not.toHaveBeenCalled();
      // EPIC-14 S10: capture is always kept, under the same key the channel brain keeps it with.
      const kept = store.recent(10).find((other) => other.kind === "store");
      expect(kept).toMatchObject({ input: { content: "remember the blue lantern", source: "whatsapp" }, idempotencyKey: "whatsapp-keep:t:whatsapp:m1" });
    } finally {
      quiet.forEach((spy) => spy.mockRestore());
      await queue.close();
    }
  });

  it("answers a chat that hits the allowance mid-turn with the reason, not a generic failure", async () => {
    const chat = vi.fn(async () => { throw new LlmAllowanceExceededError(BLOCK.message, BLOCK.resetsAt); });
    const { store, queue } = await queueWith(null, { chat } as unknown as Partial<BrainEngine>);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const job = queue.enqueue("chat", { text: "hello" });
      expect(await waitTerminal(store, job.id)).toMatchObject({ status: "done", result: { text: BLOCK.message } });
    } finally {
      warn.mockRestore();
      await queue.close();
    }
  });

  it("archives a media capture raw but does not transcribe, read or file it", async () => {
    const captureEvidence = vi.fn();
    const { store, queue, getEngine } = await queueWith(BLOCK, { captureEvidence } as unknown as Partial<BrainEngine>);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const job = queue.enqueue("media_ingest", {
        mediaType: "audio",
        bytesRef: `data:audio/ogg;base64,${Buffer.from("raw voice").toString("base64")}`,
        filename: "voice.ogg",
        sourceHint: "WhatsApp voice note",
        providedTranscript: "Blue Lantern.",
        transcriptionProvider: "channel",
        transcriptionDisposition: "provided",
      }, "t:whatsapp:m2");
      const done = await waitTerminal(store, job.id);
      const receipt = done.result as MediaIngestReceipt;
      expect(done.status).toBe("done");
      expect(receipt).toMatchObject({
        status: "done",
        code: "ai_allowance_exhausted",
        digest: { evidenceRef: null, pagesTouched: [] },
        extraction: { provider: null },
      });
      expect(receipt.message).toContain("archived the original file");
      expect(receipt.rawArtifact.handle).toEqual(expect.any(String));
      expect(getEngine).not.toHaveBeenCalled();
      expect(captureEvidence).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await queue.close();
    }
  });

  it("fails other job kinds with the reason as the error", async () => {
    const work = vi.fn();
    const { store, queue, getEngine } = await queueWith(BLOCK, { work } as unknown as Partial<BrainEngine>);
    const quiet = [vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];
    try {
      const job = queue.enqueue("work", { objective: "tidy a topic" });
      expect(await waitTerminal(store, job.id)).toMatchObject({ status: "error", error: BLOCK.message });
      expect(getEngine).not.toHaveBeenCalled();
    } finally {
      quiet.forEach((spy) => spy.mockRestore());
      await queue.close();
    }
  });

  it("runs normally while under the allowance", async () => {
    const chat = vi.fn(async () => ({ text: "Saved.", sources: [] }));
    const { store, queue } = await queueWith(null, { chat } as unknown as Partial<BrainEngine>);
    try {
      const job = queue.enqueue("chat", { text: "hi" });
      expect(await waitTerminal(store, job.id)).toMatchObject({ status: "done", result: { text: "Saved." } });
      expect(chat).toHaveBeenCalledTimes(1);
    } finally {
      await queue.close();
    }
  });
});

describe("hosted runtime end to end (staging proof)", () => {
  it("a tenant over the allowance gets the reason for a WhatsApp chat turn and no provider call", async () => {
    const fetchSpy = vi.fn(async () => { throw new Error("no provider call expected"); });
    vi.stubGlobal("fetch", fetchSpy);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = hostedRuntime({ allowance: 0.5 });
    try {
      spend(runtime, 0.75, Date.now());
      const job = runtime.taskJobQueue.enqueue(
        "chat",
        { text: "Remember the blue lantern", source: "whatsapp", conversationKey: "whatsapp:+34600000000" },
        "tenant-a:whatsapp:wamid-1",
      );
      let result = runtime.taskJobQueue.get(job.id);
      for (let attempt = 0; attempt < 200 && result?.status !== "done" && result?.status !== "error"; attempt += 1) {
        await sleep(5);
        result = runtime.taskJobQueue.get(job.id);
      }
      expect(result).toMatchObject({ status: "done", result: { text: expect.stringContaining("used this month's AI allowance") } });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      warn.mockRestore();
      await runtime.taskJobQueue.close();
    }
  });
});

describe("Phylax relays Zenod's allowance stop verbatim", () => {
  it("does not dress an allowance stop up as a Saved receipt", () => {
    const receipt = terminalCaptureReceipt(
      {
        content: [{ type: "text", text: "done" }],
        structuredContent: {
          ticket_id: "job-1",
          state: "done",
          result: {
            status: "done",
            code: "ai_allowance_exhausted",
            message: "⚠️ You have used this month's AI allowance on your Zenod plan.",
            rawArtifact: { handle: "local://a", archiveUrl: "https://drive.google.com/file/d/x" },
          },
        },
      },
      "job-1",
      "ingest_memory",
    );
    expect(receipt).toMatchObject({ state: "done", evidenceRef: null });
    expect(receipt?.text).toBe("⚠️ You have used this month's AI allowance on your Zenod plan.\nOriginal: https://drive.google.com/file/d/x");
    expect(receipt?.text).not.toContain("Saved");
  });
});

describe("Phylax master allowance coupling", () => {
  it("warns when the AI allowance leaves the channel less than its configured allowance", async () => {
    const { loadZenodPhylaxConfig } = await import("../src/zenodPhylax.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      loadZenodPhylaxConfig({
        ZENOD_TENANT_MONTHLY_ALLOWANCE_USD: "3",
        ZENOD_MASTER_ALLOWANCE_UNITS: "3000000",
        ZENOD_PHYLAX_ALLOWANCE_UNITS: "1000000",
      } as NodeJS.ProcessEnv);
      expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain("exceed ZENOD_MASTER_ALLOWANCE_UNITS 3000000");
      warn.mockClear();
      loadZenodPhylaxConfig({
        ZENOD_TENANT_MONTHLY_ALLOWANCE_USD: "3",
        ZENOD_MASTER_ALLOWANCE_UNITS: "4000000",
        ZENOD_PHYLAX_ALLOWANCE_UNITS: "1000000",
      } as NodeJS.ProcessEnv);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
