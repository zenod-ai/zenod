import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ChassisUsageStore } from "./usage.js";

const DAY = 86_400_000;
const NOW = 100 * DAY + 5_000; // day 100
const tempDirs: string[] = [];

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-chassis-retention-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  delete process.env.USAGE_RETENTION_DAYS;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function open(dir: string, extra: Record<string, unknown> = {}): ChassisUsageStore {
  return new ChassisUsageStore({
    dataDir: dir,
    now: () => NOW,
    onNotice: () => {},
    pruneFirstRunDelayMs: 3_600_000,
    ...extra,
  });
}

function seed(store: ChassisUsageStore): void {
  const t = store.forTenant({ id: "t" });
  const u = store.forTenant({ id: "u" });
  // days 10, 10, 50 are old (retention 30d => cutoff day 70); days 80, 99 stay raw.
  t.record({ kind: "mcp.request", units: 1, at: 10 * DAY + 1 });
  t.record({ kind: "mcp.request", units: 2, at: 10 * DAY + 2 });
  t.record({ kind: "tool.x", units: 4, at: 50 * DAY });
  u.record({ kind: "mcp.request", units: 8, at: 50 * DAY + 7 });
  t.record({ kind: "mcp.request", units: 1, at: 80 * DAY });
  t.record({ kind: "tool.x", units: 1, at: 99 * DAY });
}

describe("usage retention", () => {
  it("is disabled when unset: nothing is rolled up or deleted", async () => {
    const store = open(await tempDataDir());
    try {
      seed(store);
      expect(store.retentionEnabled).toBe(false);
      await expect(store.pruneOnce()).resolves.toMatchObject({ rowsPruned: 0 });
      expect(store.timeline({ id: "t" }, { limit: 100 })).toHaveLength(5);
    } finally {
      store.close();
    }
  });

  it("is enabled by USAGE_RETENTION_DAYS", async () => {
    process.env.USAGE_RETENTION_DAYS = "30";
    const store = open(await tempDataDir());
    try {
      expect(store.retentionEnabled).toBe(true);
    } finally {
      store.close();
    }
  });

  it("rolls old rows into daily buckets and keeps totals, summaries and quota correct", async () => {
    const store = open(await tempDataDir(), { retentionDays: 30, pruneBatchRows: 2 });
    try {
      seed(store);
      const t = { id: "t" };
      const beforeAll = store.summary(t);
      const beforeKind = store.summary(t, { kind: "tool.x" });
      const beforeSince = store.summary(t, { since: 60 * DAY }); // day boundary: all rolled days are < 60? none overlap
      const quotaBefore = store.checkQuota(t, 1000);

      const result = await store.pruneOnce();
      expect(result.rowsPruned).toBe(4); // 3 of t + 1 of u
      expect(result.batches).toBe(2); // 2 rows per batch

      // raw rows older than cutoff are gone, recent ones stay
      expect(store.timeline(t, { limit: 100 }).map((e) => e.ts)).toEqual([99 * DAY, 80 * DAY]);

      expect(store.summary(t)).toEqual(beforeAll); // all-time from totals
      expect(store.summary(t, { kind: "tool.x" })).toEqual(beforeKind); // raw + rollup
      expect(store.summary(t, { since: 60 * DAY })).toEqual(beforeSince);
      expect(store.checkQuota(t, 1000)).toEqual(quotaBefore);
      expect(store.summary({ id: "u" })).toMatchObject({ events: 1, units: 8 });

      // idempotent second run
      await expect(store.pruneOnce()).resolves.toMatchObject({ rowsPruned: 0 });
    } finally {
      store.close();
    }
  });

  it("windowed summary includes rolled-up days that overlap since (day granularity)", async () => {
    const store = open(await tempDataDir(), { retentionDays: 30 });
    try {
      seed(store);
      await store.pruneOnce();
      const t = { id: "t" };
      // since mid-day 10: day 10 overlaps, so its 2 events/3 units are included (events at +1,+2 are before since)
      expect(store.summary(t, { since: 10 * DAY + 100 })).toMatchObject({ events: 5, units: 9 });
      // since exactly on day 11: day 10 excluded
      expect(store.summary(t, { since: 11 * DAY })).toMatchObject({ events: 3, units: 6 });
      expect(store.summary(t, { since: 11 * DAY, kind: "mcp.request" })).toMatchObject({ events: 1, units: 1 });
    } finally {
      store.close();
    }
  });

  it("never prunes rows above the totals watermark (e.g. inserted by an overlapping old container)", async () => {
    const dir = await tempDataDir();
    const store = open(dir, { retentionDays: 30 });
    try {
      store.record({ tenant: { id: "t" }, at: 5 * DAY });
      // row inserted behind this store's back after boot: id > watermark, not yet in totals
      const other = new DatabaseSync(join(dir, "usage.sqlite"));
      other.exec("INSERT INTO tenant_usage (tenant_id, ts, kind, units) VALUES ('t', 6 * 86400000, 'mcp.request', 1)");
      other.close();
      const result = await store.pruneOnce();
      expect(result.rowsPruned).toBe(1); // only the counted row
      expect(store.timeline({ id: "t" }).map((e) => e.ts)).toEqual([6 * DAY]);
    } finally {
      store.close();
    }
    // next boot counts the surviving row exactly once; totals equal rollup + raw
    const reopened = open(dir, { retentionDays: 30 });
    try {
      expect(reopened.checkQuota({ id: "t" }, 100)).toMatchObject({ used: 2 });
      await reopened.pruneOnce();
      expect(reopened.summary({ id: "t" }, { since: 1 })).toMatchObject({ events: 2, units: 2 });
      expect(reopened.checkQuota({ id: "t" }, 100)).toMatchObject({ used: 2 });
    } finally {
      reopened.close();
    }
  });

  it("warns once when auto_vacuum is not incremental and never runs a full VACUUM", async () => {
    const notices: string[] = [];
    const store = open(await tempDataDir(), { retentionDays: 30, pruneBatchRows: 1, onNotice: (m: string) => notices.push(m) });
    try {
      seed(store);
      await store.pruneOnce();
      expect(notices.filter((m) => m.includes("auto_vacuum"))).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("runs incremental_vacuum after batches when the db is already auto_vacuum=INCREMENTAL", async () => {
    const dir = await tempDataDir();
    const pre = new DatabaseSync(join(dir, "usage.sqlite"));
    pre.exec("PRAGMA auto_vacuum = INCREMENTAL; VACUUM;");
    pre.close();
    const notices: string[] = [];
    const store = open(dir, { retentionDays: 30, pruneBatchRows: 1, onNotice: (m: string) => notices.push(m) });
    try {
      seed(store);
      await store.pruneOnce();
      expect(notices.filter((m) => m.includes("auto_vacuum"))).toHaveLength(0);
    } finally {
      store.close();
    }
  });
});
