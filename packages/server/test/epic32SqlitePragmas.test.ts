import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Runtime } from "../src/runtime.js";

type StoreWithDatabase = { db: DatabaseSync };

function pragmas(store: unknown): { journalMode: string; busyTimeout: number } {
  const db = (store as StoreWithDatabase).db;
  const journal = db.prepare("PRAGMA journal_mode").get() as Record<string, unknown>;
  const timeout = db.prepare("PRAGMA busy_timeout").get() as Record<string, unknown>;
  return {
    journalMode: String(journal.journal_mode ?? "").toLowerCase(),
    busyTimeout: Number(timeout.timeout ?? timeout.busy_timeout ?? Object.values(timeout)[0]),
  };
}

function runtimeStores(runtime: Runtime): Record<string, unknown> {
  return {
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
}

describe("Epic 3.2 SQLite concurrency contract", () => {
  let dir: string;
  let runtime: Runtime;
  let previousToken: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-epic32-pragmas-"));
    previousToken = process.env.ZENOD_API_TOKEN;
    process.env.ZENOD_API_TOKEN = "zenod_epic32_pragma_test_only";
    runtime = new Runtime(dir);
  });

  afterEach(async () => {
    runtime.close();
    if (previousToken === undefined) delete process.env.ZENOD_API_TOKEN;
    else process.env.ZENOD_API_TOKEN = previousToken;
    await rm(dir, { recursive: true, force: true });
  });

  it("reports WAL and busy_timeout=30000 on every open Zenod file DB", () => {
    const report = Object.fromEntries(
      Object.entries(runtimeStores(runtime)).map(([name, store]) => [name, pragmas(store)]),
    );
    expect(report).toEqual(
      Object.fromEntries(
        Object.keys(report).map((name) => [name, { journalMode: "wal", busyTimeout: 30_000 }]),
      ),
    );
  });

  it("reports WAL and busy_timeout=30000 on the chassis registry after integration", async (context) => {
    const moduleUrl = new URL("../src/tenantRuntime.ts", import.meta.url).href;
    const tenantModule = await import(/* @vite-ignore */ moduleUrl).catch(() => null);
    if (!tenantModule?.TenantRuntimeManager) {
      context.skip("TenantRuntimeManager is not present at this tester branch's recorded base");
      return;
    }

    const manager = new tenantModule.TenantRuntimeManager(join(dir, "multitenant"), runtime.agent);
    try {
      expect(pragmas(manager)).toEqual({ journalMode: "wal", busyTimeout: 30_000 });
    } finally {
      manager.close();
    }
  });
});
