import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CustomerManagedAiAdmissionQueue,
  type ManagedAiAdmissionInput,
  type ManagedAiRawKind,
} from "../src/customerManagedAiAdmission.js";
import { ManagedAiDownstreamOutbox } from "../src/customerManagedAiOutbox.js";

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
const settingUp = { percentageUsed: null, state: "setting_up" as const, resetsAt: null };

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
          job: {
            kind,
            status: "paused_at_cap",
            resetsAt: paused.resetsAt,
            attempts: 0,
          },
        });
        expect(Buffer.from(queue.raw(outcome.job.id)!).toString()).toBe(`${kind}-raw-evidence`);
      }
      expect(processor).not.toHaveBeenCalled();
    } finally {
      queue.close();
    }
  });

  it("journals but does not run paid work while the combined product allowance is setting up", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-managed-admission-setting-up-"));
    dirs.push(dir);
    const queue = new CustomerManagedAiAdmissionQueue(join(dir, "admission.sqlite"));
    const processor = vi.fn();
    try {
      const outcome = await queue.submit(input("audio", "awaiting-phylax"), settingUp, processor);
      expect(outcome).toMatchObject({
        state: "waiting_for_usage",
        job: { status: "waiting_for_usage", attempts: 0 },
      });
      expect(processor).not.toHaveBeenCalled();
      expect(await queue.resume(async () => settingUp, processor)).toBe(0);
      expect(processor).not.toHaveBeenCalled();
    } finally {
      queue.close();
    }
  });

  it("persists and atomically claims Telegram paused and terminal notice intents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-managed-admission-notices-"));
    dirs.push(dir);
    const path = join(dir, "admission.sqlite");
    const telegramInput = {
      ...input("text", "telegram:42:7"),
      path: "/internal/telegram",
      raw: Buffer.from(JSON.stringify({ chatId: "42", messageId: "7", text: "remember this" })),
    };
    const now = Date.parse("2026-09-02T00:00:00.000Z");
    const queue = new CustomerManagedAiAdmissionQueue(path, () => now);
    const pausedOutcome = await queue.submit(telegramInput, paused, vi.fn());
    expect(pausedOutcome.job.pausedNotice).toMatchObject({ state: "pending" });
    expect(queue.claimNotice(pausedOutcome.job.id, "paused")?.pausedNotice).toMatchObject({ state: "sending" });
    expect(queue.claimNotice(pausedOutcome.job.id, "paused")).toBeNull();
    expect(queue.completeNotice(pausedOutcome.job.id, "paused", true).pausedNotice).toMatchObject({ state: "sent" });

    await queue.resume(async () => normal, async () => ({
      value: { replyText: "stored" },
      receipt: {
        state: "completed" as const,
        statusCode: 200,
        contentType: "application/json",
        body: JSON.stringify({ replyText: "stored" }),
        completedAt: new Date().toISOString(),
      },
    }));
    const completed = queue.get(pausedOutcome.job.id)!;
    expect(completed.terminalNotice).toMatchObject({ state: "pending" });
    queue.close();

    const restarted = new CustomerManagedAiAdmissionQueue(path);
    try {
      expect(restarted.noticeCandidates()).toHaveLength(1);
      expect(restarted.claimNotice(completed.id, "terminal")?.terminalNotice).toMatchObject({ state: "sending" });
      // Ambiguous process death remains sending across restart and is never
      // claimed again, preventing a duplicate Telegram message.
      restarted.close();
      const secondRestart = new CustomerManagedAiAdmissionQueue(path);
      try {
        expect(secondRestart.claimNotice(completed.id, "terminal")).toBeNull();
        expect(secondRestart.noticeCandidates()).toHaveLength(0);
      } finally {
        secondRestart.close();
      }
    } catch (error) {
      try { restarted.close(); } catch {}
      throw error;
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

  it("recovers commit-before-admission-receipt through the durable outbox without a second invocation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-managed-admission-crash-window-"));
    dirs.push(dir);
    const admissionPath = join(dir, "admission.sqlite");
    const outboxPath = join(dir, "outbox.sqlite");
    let now = 1_000;
    const outbox = new ManagedAiDownstreamOutbox(outboxPath, { now: () => now });
    const paidInvocation = vi.fn(async () => Response.json({ stored: true }));
    const processor = async (admitted: ManagedAiAdmissionInput) => {
      const response = await outbox.execute(admitted, paidInvocation);
      const body = await response.clone().text();
      return {
        value: response,
        receipt: {
          state: response.ok ? "completed" as const : "failed" as const,
          statusCode: response.status,
          contentType: response.headers.get("content-type"),
          body,
          completedAt: new Date(now).toISOString(),
        },
      };
    };
    const crashing = new CustomerManagedAiAdmissionQueue(
      admissionPath,
      () => now,
      () => { throw new Error("fault after downstream commit"); },
    );
    await expect(crashing.submit(input("text", "crash-window"), normal, processor))
      .rejects.toThrow("simulated admission process death");
    const stranded = crashing.getByIdempotencyKey("tenant-42", "crash-window")!;
    expect(stranded).toMatchObject({ status: "processing", terminalReceipt: null, attempts: 1 });
    crashing.close();

    now += 5 * 60_000 + 1;
    const restarted = new CustomerManagedAiAdmissionQueue(admissionPath, () => now);
    try {
      expect(await restarted.resume(async () => normal, processor)).toBe(1);
      expect(paidInvocation).toHaveBeenCalledTimes(1);
      expect(restarted.get(stranded.id)).toMatchObject({
        status: "done",
        attempts: 2,
        terminalReceipt: { state: "completed", statusCode: 200 },
      });
      const replay = await restarted.submit(input("text", "crash-window"), normal, processor);
      expect(replay).toMatchObject({ state: "replayed", job: { id: stranded.id } });
      expect(paidInvocation).toHaveBeenCalledTimes(1);
    } finally {
      restarted.close();
      outbox.close();
    }
  });
});
