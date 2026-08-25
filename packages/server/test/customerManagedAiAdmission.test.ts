import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CustomerManagedAiAdmissionQueue,
  type ManagedAiAdmissionInput,
  type ManagedAiRawKind,
} from "../src/customerManagedAiAdmission.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function input(kind: ManagedAiRawKind, idempotencyKey = `message-${kind}`): ManagedAiAdmissionInput {
  return {
    tenantId: "tenant-42",
    idempotencyKey,
    kind,
    method: "POST",
    path: kind === "audio" ? "/api/chat/voice/transcribe" : "/api/chat",
    contentType: kind === "audio" ? "audio/webm" : "application/json",
    raw: Buffer.from(`${kind}-raw-evidence`),
  };
}

const normal = { percentageUsed: 20, state: "normal" as const, resetsAt: "2026-09-01T00:00:00.000Z" };
const paused = { percentageUsed: 100, state: "paused" as const, resetsAt: "2026-09-01T00:00:00.000Z" };

describe("managed AI raw-evidence admission", () => {
  it("journals text, audio, and image before returning a typed cap pause", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-managed-admission-"));
    dirs.push(dir);
    const queue = new CustomerManagedAiAdmissionQueue(join(dir, "admission.sqlite"));
    const processor = vi.fn();
    try {
      for (const kind of ["text", "audio", "image"] as const) {
        const outcome = await queue.submit(input(kind), paused, processor);
        expect(outcome).toMatchObject({
          state: "paused_at_cap",
          job: { kind, status: "paused_at_cap", resetsAt: paused.resetsAt, attempts: 0 },
        });
        expect(Buffer.from(queue.raw(outcome.job.id)!).toString()).toBe(`${kind}-raw-evidence`);
      }
      expect(processor).not.toHaveBeenCalled();
    } finally {
      queue.close();
    }
  });

  it("survives restart, waits for the authoritative reset, resumes once, and replays one receipt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-managed-admission-"));
    dirs.push(dir);
    const path = join(dir, "admission.sqlite");
    let now = Date.parse("2026-08-31T23:59:00.000Z");
    const first = new CustomerManagedAiAdmissionQueue(path, () => now);
    const queued = await first.submit(input("text", "stable-message"), paused, vi.fn());
    expect(queued.state).toBe("paused_at_cap");
    const jobId = queued.job.id;
    first.close();

    const restarted = new CustomerManagedAiAdmissionQueue(path, () => now);
    const processor = vi.fn(async () => ({
      value: { ok: true },
      receipt: {
        state: "completed" as const,
        statusCode: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
        completedAt: new Date(now).toISOString(),
      },
    }));
    try {
      expect(await restarted.resume(async () => normal, processor)).toBe(0);
      now = Date.parse("2026-09-01T00:00:01.000Z");
      expect(await restarted.resume(async () => normal, processor)).toBe(1);
      expect(await restarted.resume(async () => normal, processor)).toBe(0);
      expect(processor).toHaveBeenCalledTimes(1);
      expect(restarted.get(jobId)).toMatchObject({
        status: "done",
        attempts: 1,
        terminalReceipt: { state: "completed", statusCode: 200 },
      });

      const replay = await restarted.submit(input("text", "stable-message"), normal, vi.fn());
      expect(replay).toMatchObject({ state: "replayed", job: { id: jobId } });
    } finally {
      restarted.close();
    }
  });

  it("allows only one cross-process claimant and persists one terminal receipt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-managed-admission-"));
    dirs.push(dir);
    const path = join(dir, "admission.sqlite");
    const first = new CustomerManagedAiAdmissionQueue(path);
    const second = new CustomerManagedAiAdmissionQueue(path);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const processor = vi.fn(async () => {
      await gate;
      return {
        value: { ok: true },
        receipt: {
          state: "completed" as const,
          statusCode: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
          completedAt: new Date().toISOString(),
        },
      };
    });
    try {
      const active = first.submit(input("image", "same-provider-message"), normal, processor);
      await vi.waitFor(() => expect(processor).toHaveBeenCalledTimes(1));
      const concurrent = await second.submit(input("image", "same-provider-message"), normal, processor);
      expect(concurrent).toMatchObject({ state: "processing" });
      release();
      const completed = await active;
      expect(completed).toMatchObject({ state: "processed", job: { status: "done" } });
      expect(processor).toHaveBeenCalledTimes(1);
      expect(second.get(completed.job.id)?.terminalReceipt).toMatchObject({ state: "completed" });
    } finally {
      first.close();
      second.close();
    }
  });

  it("returns and replays the same stored failure receipt when paid processing throws", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-managed-admission-"));
    dirs.push(dir);
    const queue = new CustomerManagedAiAdmissionQueue(join(dir, "admission.sqlite"));
    try {
      const failed = await queue.submit(input("text", "failed-message"), normal, async () => {
        throw new Error("provider unavailable");
      });
      expect(failed).toMatchObject({
        state: "failed",
        receipt: { state: "failed", statusCode: 503 },
        job: { status: "error", terminalReceipt: { state: "failed", statusCode: 503 } },
      });
      const replay = await queue.submit(input("text", "failed-message"), normal, vi.fn());
      expect(replay).toMatchObject({
        state: "replayed",
        receipt: { state: "failed", statusCode: 503 },
      });
    } finally {
      queue.close();
    }
  });
});
