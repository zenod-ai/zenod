import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Runtime } from "../src/runtime.js";

type StoreWithDatabase = { db: DatabaseSync };

function sqliteContract(store: unknown) {
  const db = (store as StoreWithDatabase).db;
  const journal = db.prepare("PRAGMA journal_mode").get() as Record<string, unknown>;
  const timeout = db.prepare("PRAGMA busy_timeout").get() as Record<string, unknown>;
  return {
    journalMode: String(journal.journal_mode ?? "").toLowerCase(),
    busyTimeout: Number(timeout.timeout ?? timeout.busy_timeout ?? Object.values(timeout)[0]),
  };
}

describe("Zenod SQLite concurrency contract", () => {
  let dataDir: string;
  let runtime: Runtime;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "zenod-sqlite-contract-"));
    runtime = new Runtime(dataDir);
  });

  afterEach(async () => {
    runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("opens every mutable product database in WAL mode with a 30 second busy timeout", () => {
    const stores = {
      zenod: runtime.state,
      oauth: runtime.oauth,
      whatsapp: runtime.whatsappStore,
      ingest: runtime.ingestStore,
      tasks: runtime.taskJobStore,
      execution: runtime.executionStore,
      journeys: runtime.journeyStore,
      usage: runtime.usageStore,
      notifications: runtime.notificationStore,
    };

    expect(Object.fromEntries(
      Object.entries(stores).map(([name, store]) => [name, sqliteContract(store)]),
    )).toEqual(Object.fromEntries(
      Object.keys(stores).map((name) => [
        name,
        { journalMode: "wal", busyTimeout: 30_000 },
      ]),
    ));
  });
});
