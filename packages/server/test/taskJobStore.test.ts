import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TaskJobStore } from "../src/taskJobStore.js";

// C-27 / #580 — "Acknowledged writes are never lost." A `store` job (vault filing +
// add_memory) that a restart interrupts mid-flight must be RESUMED on boot and completed
// with its receipt — not dropped as failed. A fresh TaskJobStore on the same on-disk DB
// simulates the process restart.
const tmpDb = () => join(mkdtempSync(join(tmpdir(), "zenod-taskjob-")), "task.sqlite");

describe("TaskJobStore restart durability (C-27 / #580)", () => {
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

  it("does NOT auto-resume a task/work job — only writes (task durability lives elsewhere)", () => {
    const path = tmpDb();
    let store = new TaskJobStore(path);
    const job = store.enqueue("task", { text: "run something", conversationKey: "k" });
    store.update(job.id, { status: "running" });
    store = new TaskJobStore(path); // restart
    expect(store.get(job.id)!.status).toBe("interrupted");
  });

  it("leaves a never-started queued job queued across a restart", () => {
    const path = tmpDb();
    let store = new TaskJobStore(path);
    const job = store.enqueue("store", { content: "still queued" });
    store = new TaskJobStore(path); // restart before the worker touched it
    expect(store.get(job.id)!.status).toBe("queued");
    expect(store.get(job.id)!.attempts).toBe(0);
  });

  it("persists provided transcript provenance for media ingest jobs", () => {
    const path = tmpDb();
    let store = new TaskJobStore(path);
    const job = store.enqueue("media_ingest", {
      mediaType: "audio",
      bytesRef: "drive://file/audio-1",
      transcript: {
        text: "Already transcribed upstream.",
        source: "phylax",
        version: "v2",
      },
    });

    store = new TaskJobStore(path);
    expect(store.get(job.id)?.input.transcript).toEqual({
      text: "Already transcribed upstream.",
      source: "phylax",
      version: "v2",
    });
  });
});
