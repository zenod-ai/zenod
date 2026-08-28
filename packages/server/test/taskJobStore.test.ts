import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrainEngine } from "zenod";

import { TASK_JOB_LEASE_MS, TaskJobStore } from "../src/taskJobStore.js";
import { TaskJobQueue } from "../src/taskJobQueue.js";

// C-27 / #580 — "Acknowledged writes are never lost." A `store` job (vault filing +
// add_memory) that a restart interrupts mid-flight must be RESUMED on boot and completed
// with its receipt — not dropped as failed. A fresh TaskJobStore on the same on-disk DB
// simulates the process restart.
const tmpDb = () => join(mkdtempSync(join(tmpdir(), "zenod-taskjob-")), "task.sqlite");

describe("TaskJobStore restart durability (C-27 / #580)", () => {
  it("re-queues interrupted semantic enrichment without duplicating its idempotent job", () => {
    const path = tmpDb();
    let store = new TaskJobStore(path, "tenant-alpha");
    const accepted = store.enqueue(
      "enrich_memory",
      {
        evidenceRef: "Log/2026-08-28.md#^e-a1b2c3",
        content: "captured transcript",
        source: "whatsapp",
      },
      "enrich:tenant-alpha:whatsapp:provider-1",
    );
    store.update(accepted.id, { status: "running" });
    store.close();

    store = new TaskJobStore(path, "tenant-alpha");
    const replay = store.enqueue(
      "enrich_memory",
      { evidenceRef: "ignored", content: "ignored" },
      "enrich:tenant-alpha:whatsapp:provider-1",
    );
    expect(replay).toMatchObject({
      id: accepted.id,
      status: "queued",
      attempts: 1,
      input: { evidenceRef: "Log/2026-08-28.md#^e-a1b2c3" },
    });
    expect(store.recent()).toHaveLength(1);
    store.close();
  });

  it("re-queues an interrupted store (write) job on boot instead of dropping it", () => {
    const path = tmpDb();
    let store = new TaskJobStore(path);
    const job = store.enqueue("store", { content: "I like the temperature in the Pyrenees in summer" });
    store.update(job.id, { status: "running" }); // worker started it, then the server died

    store = new TaskJobStore(path); // <-- restart
    const after = store.get(job.id)!;
    expect(after.status).toBe("queued"); // resumed, not "interrupted"
    expect(after.attempts).toBe(1);
    expect(store.nextQueued()?.id).toBe(job.id); // the worker will pick it back up
    expect(after.input.content).toContain("Pyrenees"); // the content survived
  });

  it("gives up honestly after MAX resume attempts (never an infinite restart loop)", () => {
    const path = tmpDb();
    let store = new TaskJobStore(path);
    const job = store.enqueue("store", { content: "x" });
    for (let i = 0; i < 4; i += 1) {
      store.update(job.id, { status: "running" });
      store = new TaskJobStore(path); // restart mid-run, repeatedly
    }
    const after = store.get(job.id)!;
    expect(after.status).toBe("interrupted");
    expect(after.error).toMatch(/gave up/);
  });

  it("does not auto-reexecute an ambiguous running chat after restart", () => {
    const path = tmpDb();
    let store = new TaskJobStore(path, "tenant-alpha");
    const job = store.enqueue(
      "chat",
      { text: "create something", source: "whatsapp", conversationKey: "k" },
      "tenant-alpha:whatsapp:message-1",
    );
    store.update(job.id, { status: "running" });
    store = new TaskJobStore(path, "tenant-alpha"); // restart
    expect(store.get(job.id)!.status).toBe("interrupted");
    const replay = store.enqueue(
      "chat",
      { text: "duplicate must not run", source: "whatsapp", conversationKey: "k" },
      "tenant-alpha:whatsapp:message-1",
    );
    expect(replay).toMatchObject({ id: job.id, status: "interrupted", input: { text: "create something" } });
    expect(store.nextQueued()).toBeNull();
  });

  it("leaves a never-started queued job queued across a restart", () => {
    const path = tmpDb();
    let store = new TaskJobStore(path);
    const job = store.enqueue("store", { content: "still queued" });
    store = new TaskJobStore(path); // restart before the worker touched it
    expect(store.get(job.id)!.status).toBe("queued");
    expect(store.get(job.id)!.attempts).toBe(0);
  });

  it("returns the original durable store job for a repeated tenant idempotency key", () => {
    const path = tmpDb();
    let store = new TaskJobStore(path, "tenant-alpha");
    const original = store.enqueue(
      "store",
      { content: "original content wins" },
      "whatsapp:voice:message-42",
    );
    store.update(original.id, {
      status: "done",
      result: {
        evidenceRef: "Log/2026-07-29.md#^e-original",
        pagesTouched: ["Areas/Mechanical Capture.md"],
        commitSha: "a".repeat(40),
        githubUrls: ["https://github.com/zenod-ai/vault/commit/" + "a".repeat(40)],
      },
    });
    store.close();

    store = new TaskJobStore(path, "tenant-alpha");
    const replay = store.enqueue(
      "store",
      { content: "different retry payload must not replace the original" },
      "whatsapp:voice:message-42",
    );

    expect(replay.id).toBe(original.id);
    expect(replay.status).toBe("done");
    expect(replay.input.content).toBe("original content wins");
    expect(replay.result).toMatchObject({
      evidenceRef: "Log/2026-07-29.md#^e-original",
      commitSha: "a".repeat(40),
    });
    expect(store.recent()).toHaveLength(1);
    store.close();
  });

  it("returns the original queued job after a crash between acceptance and processing", () => {
    const path = tmpDb();
    let store = new TaskJobStore(path, "tenant-alpha");
    const accepted = store.enqueue(
      "store",
      { content: "accepted before the process stopped" },
      "whatsapp:voice:message-accepted",
    );
    store.close();

    store = new TaskJobStore(path, "tenant-alpha");
    const replay = store.enqueue(
      "store",
      { content: "retry after restart" },
      "whatsapp:voice:message-accepted",
    );

    expect(replay.id).toBe(accepted.id);
    expect(replay.status).toBe("queued");
    expect(replay.input.content).toBe("accepted before the process stopped");
    expect(store.nextQueued()?.id).toBe(accepted.id);
    expect(store.recent()).toHaveLength(1);
    store.close();
  });

  it("returns and resumes the original media ingest for a repeated artifact key", () => {
    const path = tmpDb();
    let store = new TaskJobStore(path, "tenant-alpha");
    const accepted = store.enqueue(
      "media_ingest",
      {
        mediaType: "image",
        artifactUrl: "https://phylax.invalid/artifacts/tenant-alpha/photo.jpg?capability=secret",
        filename: "photo.jpg",
        contentHint: "Whiteboard after the planning meeting",
      },
      "whatsapp:image:message-42",
    );
    store.update(accepted.id, { status: "running" });

    store = new TaskJobStore(path, "tenant-alpha");
    const replay = store.enqueue(
      "media_ingest",
      {
        mediaType: "image",
        artifactUrl: "https://phylax.invalid/artifacts/tenant-alpha/retry.jpg?capability=different",
        filename: "retry.jpg",
      },
      "whatsapp:image:message-42",
    );

    expect(replay.id).toBe(accepted.id);
    expect(replay.status).toBe("queued");
    expect(replay.attempts).toBe(1);
    expect(replay.input).toMatchObject({
      filename: "photo.jpg",
      contentHint: "Whiteboard after the planning meeting",
    });
    expect(store.recent()).toHaveLength(1);
    store.close();
  });

  it("atomically coalesces competing enqueue calls for the same tenant key", () => {
    const path = tmpDb();
    const firstConnection = new TaskJobStore(path, "tenant-alpha");
    const secondConnection = new TaskJobStore(path, "tenant-alpha");

    const first = firstConnection.enqueue(
      "store",
      { content: "accepted first" },
      "whatsapp:voice:message-race",
    );
    const second = secondConnection.enqueue(
      "store",
      { content: "competing retry" },
      "whatsapp:voice:message-race",
    );

    expect(second.id).toBe(first.id);
    expect(second.input.content).toBe("accepted first");
    expect(firstConnection.recent()).toHaveLength(1);
    firstConnection.close();
    secondConnection.close();
  });

  it("allows only one queue consumer to execute a coalesced store job", async () => {
    const path = tmpDb();
    const firstStore = new TaskJobStore(path, "tenant-alpha");
    let releaseStore!: () => void;
    const storeGate = new Promise<void>((resolve) => {
      releaseStore = resolve;
    });
    const storeMemory = vi.fn(async () => {
        await storeGate;
        return {
          evidenceRef: "Log/2026-07-29.md#^e-once",
          pagesTouched: ["Areas/Mechanical Capture.md"],
          commitSha: "b".repeat(40),
          githubUrls: [],
        };
      });
    const engine = { store: storeMemory } as unknown as BrainEngine;
    const firstQueue = new TaskJobQueue(firstStore, async () => engine);

    const first = firstQueue.enqueue(
      "store",
      { content: "execute exactly once" },
      "whatsapp:voice:message-two-consumers",
    );
    for (let attempt = 0; attempt < 50 && storeMemory.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(storeMemory).toHaveBeenCalledTimes(1);
    expect(firstStore.get(first.id)?.status).toBe("running");

    // Simulate a rolling deployment: the replacement opens the same durable
    // queue only after the old process has already begun the memory write.
    const secondStore = new TaskJobStore(path, "tenant-alpha");
    const secondQueue = new TaskJobQueue(secondStore, async () => engine);
    const replay = secondQueue.enqueue(
      "store",
      { content: "competing consumer retry" },
      "whatsapp:voice:message-two-consumers",
    );
    expect(replay.id).toBe(first.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(storeMemory).toHaveBeenCalledTimes(1);
    expect(secondStore.get(first.id)?.status).toBe("running");

    releaseStore();
    for (let attempt = 0; attempt < 50 && firstStore.get(first.id)?.status !== "done"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(firstStore.get(first.id)?.status).toBe("done");
    expect(storeMemory).toHaveBeenCalledTimes(1);
    await firstQueue.close();
    await secondQueue.close();
    firstStore.close();
    secondStore.close();
  });

  it("recovers an expired claim and fences the stale owner", () => {
    const path = tmpDb();
    const originalOwner = new TaskJobStore(path, "tenant-alpha");
    const accepted = originalOwner.enqueue(
      "store",
      { content: "lease recovery" },
      "whatsapp:voice:message-expired-lease",
      1_000,
    );
    expect(originalOwner.claimNextQueued(1_000)?.id).toBe(accepted.id);

    const replacement = new TaskJobStore(path, "tenant-alpha", () => 2_000);
    expect(replacement.get(accepted.id)?.status).toBe("running");
    replacement.recoverExpiredRunning(1_000 + TASK_JOB_LEASE_MS + 1);
    expect(replacement.get(accepted.id)).toMatchObject({ status: "queued", attempts: 1 });
    expect(
      originalOwner.updateClaimed(
        accepted.id,
        {
          status: "done",
          result: {
            evidenceRef: "Log/stale.md#^e-stale",
            pagesTouched: [],
            commitSha: "c".repeat(40),
            githubUrls: [],
          },
        },
        1_000 + TASK_JOB_LEASE_MS + 2,
      ),
    ).toBe(false);

    expect(replacement.claimNextQueued(1_000 + TASK_JOB_LEASE_MS + 3)?.id).toBe(accepted.id);
    expect(
      replacement.updateClaimed(
        accepted.id,
        {
          status: "done",
          result: {
            evidenceRef: "Log/recovered.md#^e-recovered",
            pagesTouched: [],
            commitSha: "d".repeat(40),
            githubUrls: [],
          },
        },
        1_000 + TASK_JOB_LEASE_MS + 4,
      ),
    ).toBe(true);
    expect(replacement.get(accepted.id)?.result).toMatchObject({
      evidenceRef: "Log/recovered.md#^e-recovered",
    });
    originalOwner.close();
    replacement.close();
  });

  it("waits for an active claim before shutdown closes its store", async () => {
    const store = new TaskJobStore(tmpDb(), "tenant-alpha");
    let releaseStore!: () => void;
    const storeGate = new Promise<void>((resolve) => {
      releaseStore = resolve;
    });
    const storeMemory = vi.fn(async () => {
      await storeGate;
      return {
        evidenceRef: "Log/2026-07-29.md#^e-shutdown",
        pagesTouched: [],
        commitSha: "e".repeat(40),
        githubUrls: [],
      };
    });
    const queue = new TaskJobQueue(
      store,
      async () => ({ store: storeMemory }) as unknown as BrainEngine,
    );
    const job = queue.enqueue("store", { content: "finish before close" });
    for (let attempt = 0; attempt < 50 && storeMemory.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    let closed = false;
    const closing = queue.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(closed).toBe(false);

    releaseStore();
    await closing;
    expect(store.get(job.id)?.status).toBe("done");
    expect(storeMemory).toHaveBeenCalledTimes(1);
    store.close();
  });

  it("scopes the same idempotency key by tenant and hides foreign jobs", () => {
    const path = tmpDb();
    const alpha = new TaskJobStore(path, "tenant-alpha");
    const beta = new TaskJobStore(path, "tenant-beta");

    const alphaJob = alpha.enqueue("store", { content: "alpha" }, "provider-message-7");
    const betaJob = beta.enqueue("store", { content: "beta" }, "provider-message-7");

    expect(betaJob.id).not.toBe(alphaJob.id);
    expect(alpha.get(betaJob.id)).toBeNull();
    expect(beta.get(alphaJob.id)).toBeNull();
    expect(alpha.recent().map((job) => job.id)).toEqual([alphaJob.id]);
    expect(beta.recent().map((job) => job.id)).toEqual([betaJob.id]);
    alpha.close();
    beta.close();
  });

  it("isolates media ingest jobs and receipts for the same provider key across tenants", () => {
    const path = tmpDb();
    const alpha = new TaskJobStore(path, "tenant-alpha");
    const beta = new TaskJobStore(path, "tenant-beta");
    const key = "whatsapp:image:shared-provider-id";
    const alphaJob = alpha.enqueue("media_ingest", { mediaType: "image", bytesRef: "alpha" }, key);
    const betaJob = beta.enqueue("media_ingest", { mediaType: "image", bytesRef: "beta" }, key);

    expect(betaJob.id).not.toBe(alphaJob.id);
    expect(alpha.get(betaJob.id)).toBeNull();
    expect(beta.get(alphaJob.id)).toBeNull();
    expect(alpha.get(alphaJob.id)?.input.bytesRef).toBe("alpha");
    expect(beta.get(betaJob.id)?.input.bytesRef).toBe("beta");
    alpha.close();
    beta.close();
  });

  it("keeps calls without an idempotency key backward-compatible", () => {
    const store = new TaskJobStore(tmpDb(), "tenant-alpha");
    const first = store.enqueue("store", { content: "same content" });
    const second = store.enqueue("store", { content: "same content" });

    expect(second.id).not.toBe(first.id);
    expect(store.recent()).toHaveLength(2);
    store.close();
  });
});
