import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { ChassisUsageStore } from "./usage.js";

const tempDirs: string[] = [];

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-chassis-usage-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("tenant usage metering", () => {
  it("records tenant-keyed usage rows and returns only the requested tenant's rows", async () => {
    const store = new ChassisUsageStore({ dataDir: await tempDataDir() });
    try {
      store.record({ tenant: { id: "tenant_alpha" }, kind: "mcp.request", units: 1, at: 10 });
      store.record({ tenant: { id: "tenant_beta" }, kind: "mcp.request", units: 7, at: 20 });
      store.record({ tenant: { id: "tenant_alpha" }, kind: "tool.search", units: 2, at: 30 });

      expect(store.summary({ id: "tenant_alpha" })).toEqual({
        tenantId: "tenant_alpha",
        since: 0,
        events: 2,
        units: 3,
        byKind: [
          { kind: "mcp.request", events: 1, units: 1 },
          { kind: "tool.search", events: 1, units: 2 },
        ],
      });
      expect(store.summary({ id: "tenant_beta" })).toMatchObject({ tenantId: "tenant_beta", events: 1, units: 7 });
      expect(store.timeline({ id: "tenant_alpha" }).map((event) => event.tenantId)).toEqual([
        "tenant_alpha",
        "tenant_alpha",
      ]);
      expect(JSON.stringify(store.timeline({ id: "tenant_alpha" }))).not.toContain("tenant_beta");
    } finally {
      store.close();
    }
  });

  it("blocks quota checks at zero remaining units", async () => {
    const store = new ChassisUsageStore({ dataDir: await tempDataDir() });
    try {
      const alpha = store.forTenant({ id: "tenant_alpha" });

      expect(alpha.checkQuota(0)).toMatchObject({
        allowed: false,
        quota: 0,
        used: 0,
        requested: 1,
        remaining: 0,
      });

      expect(alpha.checkQuota(1)).toMatchObject({ allowed: true, quota: 1, used: 0, remaining: 1 });
      alpha.record();
      expect(alpha.checkQuota(1)).toMatchObject({
        allowed: false,
        quota: 1,
        used: 1,
        requested: 1,
        remaining: 0,
      });
    } finally {
      store.close();
    }
  });

  it("does not touch the ledger for null quota and reports used as unknown", async () => {
    const store = new ChassisUsageStore({ dataDir: await tempDataDir() });
    try {
      const alpha = store.forTenant({ id: "tenant_alpha" });
      alpha.record({ units: 5 });
      expect(alpha.checkQuota(null)).toEqual({ allowed: true, quota: null, used: null, requested: 1, remaining: null });
      expect(alpha.checkQuota(undefined, 3).allowed).toBe(true);
    } finally {
      store.close();
    }
  });

  it("keeps running totals identical to a full scan and enforces the quota at the limit", async () => {
    const store = new ChassisUsageStore({ dataDir: await tempDataDir() });
    try {
      const alpha = store.forTenant({ id: "tenant_alpha" });
      store.record({ tenant: { id: "tenant_beta" }, units: 100 });
      for (let i = 0; i < 3; i++) alpha.record({ kind: "mcp.request", units: 1 });
      alpha.record({ kind: "tool.search", units: 4 });
      expect(alpha.checkQuota(7, 1)).toMatchObject({ allowed: false, used: 7, remaining: 0 });
      expect(alpha.checkQuota(8, 1)).toMatchObject({ allowed: true, used: 7, remaining: 1 });
      expect(alpha.checkQuota(8, 2).allowed).toBe(false);
      const fast = alpha.summary();
      const scanned = alpha.summary({ since: 1 }); // bypasses totals, scans rows
      expect(fast.events).toBe(scanned.events);
      expect(fast.units).toBe(scanned.units);
      expect(fast.byKind).toEqual(scanned.byKind);
    } finally {
      store.close();
    }
  });

  it("backfills running totals once from a legacy ledger", async () => {
    const dir = await tempDataDir();
    const legacy = new DatabaseSync(join(dir, "usage.sqlite"));
    legacy.exec(`CREATE TABLE tenant_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL, units INTEGER NOT NULL DEFAULT 1, metadata_json TEXT);
      INSERT INTO tenant_usage (tenant_id, ts, kind, units) VALUES ('t', 1, 'mcp.request', 1), ('t', 2, 'mcp.request', 1), ('t', 3, 'x', 5);`);
    legacy.close();
    let store = new ChassisUsageStore({ dataDir: dir });
    try {
      expect(store.checkQuota({ id: "t" }, 100)).toMatchObject({ used: 7 });
      store.record({ tenant: { id: "t" }, units: 2 });
    } finally {
      store.close();
    }
    store = new ChassisUsageStore({ dataDir: dir }); // reopen: must not double count
    try {
      expect(store.checkQuota({ id: "t" }, 100)).toMatchObject({ used: 9 });
    } finally {
      store.close();
    }
  });

  it("self-heals totals from a watermark: rows inserted behind the store's back are counted once on next boot", async () => {
    const dir = await tempDataDir();
    let store = new ChassisUsageStore({ dataDir: dir });
    store.record({ tenant: { id: "t" }, units: 3 });
    store.close();
    // Simulate an older container (no totals maintenance) inserting rows during rollback/overlap.
    const raw = new DatabaseSync(join(dir, "usage.sqlite"));
    raw.exec("INSERT INTO tenant_usage (tenant_id, ts, kind, units) VALUES ('t', 5, 'mcp.request', 1), ('u', 6, 'x', 4)");
    raw.close();
    store = new ChassisUsageStore({ dataDir: dir });
    try {
      expect(store.checkQuota({ id: "t" }, 100)).toMatchObject({ used: 4 });
      expect(store.checkQuota({ id: "u" }, 100)).toMatchObject({ used: 4 });
    } finally {
      store.close();
    }
    store = new ChassisUsageStore({ dataDir: dir }); // idempotent
    try {
      expect(store.checkQuota({ id: "t" }, 100)).toMatchObject({ used: 4 });
      const t = store.forTenant({ id: "t" });
      t.record({ units: 2 });
      expect(t.summary().units).toBe(t.summary({ since: 1 }).units);
    } finally {
      store.close();
    }
    const check = new DatabaseSync(join(dir, "usage.sqlite"));
    const wm = check.prepare("SELECT value FROM usage_meta WHERE key='totals_watermark'").get() as { value: string };
    const max = check.prepare("SELECT MAX(id) AS m FROM tenant_usage").get() as { m: number };
    expect(Number(wm.value)).toBe(max.m);
    check.close();
  });

  it("rebuilds totals from scratch when no watermark exists (drifted legacy totals)", async () => {
    const dir = await tempDataDir();
    let store = new ChassisUsageStore({ dataDir: dir });
    store.record({ tenant: { id: "t" }, units: 3 });
    store.close();
    const raw = new DatabaseSync(join(dir, "usage.sqlite"));
    raw.exec("UPDATE tenant_usage_totals SET units = 999; DELETE FROM usage_meta WHERE key = 'totals_watermark'");
    raw.close();
    store = new ChassisUsageStore({ dataDir: dir });
    try {
      expect(store.checkQuota({ id: "t" }, 100)).toMatchObject({ used: 3 });
    } finally {
      store.close();
    }
  });

  it("catches up across multiple chunks", async () => {
    const dir = await tempDataDir();
    new ChassisUsageStore({ dataDir: dir }).close();
    const raw = new DatabaseSync(join(dir, "usage.sqlite"));
    raw.exec("BEGIN");
    const ins = raw.prepare("INSERT INTO tenant_usage (tenant_id, ts, kind, units) VALUES (?, ?, 'mcp.request', 1)");
    for (let i = 0; i < 120_000; i++) ins.run(i % 2 ? "a" : "b", i);
    raw.exec("COMMIT");
    raw.close();
    const store = new ChassisUsageStore({ dataDir: dir });
    try {
      expect(store.checkQuota({ id: "a" }, 1e9)).toMatchObject({ used: 60_000 });
      expect(store.checkQuota({ id: "b" }, 1e9)).toMatchObject({ used: 60_000 });
    } finally {
      store.close();
    }
  });

  it("keeps per-request quota check and record O(1) on a large ledger", async () => {
    const dir = await tempDataDir();
    const seed = new ChassisUsageStore({ dataDir: dir });
    seed.close();
    const raw = new DatabaseSync(join(dir, "usage.sqlite"));
    raw.exec("BEGIN");
    const ins = raw.prepare("INSERT INTO tenant_usage (tenant_id, ts, kind, units) VALUES ('big', ?, 'mcp.request', 1)");
    for (let i = 0; i < 300_000; i++) ins.run(i);
    raw.exec("DELETE FROM usage_meta; COMMIT");
    raw.close();
    const store = new ChassisUsageStore({ dataDir: dir }); // re-runs backfill
    try {
      const meter = store.forTenant({ id: "big" });
      const t0 = performance.now();
      for (let i = 0; i < 1000; i++) {
        meter.checkQuota(null, 1);
        meter.record({ kind: "mcp.request" });
      }
      const nullMs = performance.now() - t0;
      const t1 = performance.now();
      for (let i = 0; i < 1000; i++) {
        meter.checkQuota(10_000_000, 1);
        meter.record({ kind: "mcp.request" });
      }
      const quotaMs = performance.now() - t1;
      console.log(`usage hot path, 300k rows: null ${nullMs.toFixed(1)}ms, quota ${quotaMs.toFixed(1)}ms per 1000`);
      expect(nullMs).toBeLessThan(1500);
      expect(quotaMs).toBeLessThan(1500);
      expect(meter.checkQuota(10_000_000)).toMatchObject({ used: 302_000 });
    } finally {
      store.close();
    }
  });
});
