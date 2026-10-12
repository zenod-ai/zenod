import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChassisUsageStore, createMemoryTenantStore, createUnit } from "./index.js";

const DAY = 86_400_000;
const ROWS = 1_000_000;
const NOW = 400 * DAY;

let dir: string;
const servers: ServerType[] = [];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mcp-chassis-perf-"));
  new ChassisUsageStore({ dataDir: dir }).close(); // create schema
  const raw = new DatabaseSync(join(dir, "usage.sqlite"));
  raw.exec("BEGIN");
  const ins = raw.prepare("INSERT INTO tenant_usage (tenant_id, ts, kind, units) VALUES (?, ?, ?, 1)");
  for (let i = 0; i < ROWS; i++) ins.run(i % 3 === 0 ? "tenant_perf" : "other", (i % 380) * DAY + i, i % 5 === 0 ? "tool.x" : "mcp.request");
  raw.exec("COMMIT");
  raw.close();
}, 120_000);

afterAll(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  await rm(dir, { recursive: true, force: true });
});

describe("usage ledger with ~1M rows", () => {
  it("boot catch-up, quota check, record and the /mcp hot path stay fast; prune batches stay bounded", async () => {
    const t0 = performance.now();
    const store = new ChassisUsageStore({ dataDir: dir, retentionDays: 30, now: () => NOW, onNotice: () => {}, pruneFirstRunDelayMs: 3_600_000 });
    const bootMs = performance.now() - t0;
    try {
      const tenant = { id: "tenant_perf" };
      const meter = store.forTenant(tenant);
      const expectedUsed = Math.ceil(ROWS / 3);
      expect(meter.checkQuota(1e12)).toMatchObject({ used: expectedUsed });

      const t1 = performance.now();
      for (let i = 0; i < 1000; i++) meter.checkQuota(1e12, 1);
      const quotaMs = performance.now() - t1;
      const t2 = performance.now();
      for (let i = 0; i < 1000; i++) meter.record({ kind: "mcp.request" });
      const recordMs = performance.now() - t2;

      // /mcp hot path: tools/call over HTTP with metering on the big ledger
      const tenants = createMemoryTenantStore([{ token: "perf-token", tenant: { id: "tenant_perf", quota: 1e12 } }]);
      const unit = createUnit({ name: "perf", version: "0.0.0", storage: { dataDir: dir }, tenantAuth: { store: tenants }, metering: store, rateLimit: false });
      const base = await new Promise<string>((resolve) => {
        const server = serve({ fetch: unit.app.fetch, port: 0, hostname: "127.0.0.1" }, (a) => resolve(`http://127.0.0.1:${a.port}`));
        servers.push(server);
      });
      const call = () =>
        fetch(`${base}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer perf-token" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "noop", arguments: {} } }),
        }).then((r) => r.arrayBuffer());
      await call();
      const t3 = performance.now();
      for (let i = 0; i < 50; i++) await call();
      const mcpMsPerCall = (performance.now() - t3) / 50;

      // prune: bounded batches, scanning ~1M rows
      const pruneStart = performance.now();
      const result = await store.pruneOnce();
      const pruneMs = performance.now() - pruneStart;

      console.log(
        `perf 1M rows: boot ${bootMs.toFixed(0)}ms, quota x1000 ${quotaMs.toFixed(1)}ms, record x1000 ${recordMs.toFixed(1)}ms, ` +
          `/mcp ${mcpMsPerCall.toFixed(2)}ms/call, prune ${result.rowsPruned} rows in ${result.batches} batches ` +
          `(p95 batch ${result.p95BatchMs.toFixed(1)}ms, max ${result.maxBatchMs.toFixed(1)}ms, total ${pruneMs.toFixed(0)}ms)`,
      );

      expect(bootMs).toBeLessThan(30_000);
      expect(quotaMs).toBeLessThan(500);
      expect(recordMs).toBeLessThan(2_000);
      expect(mcpMsPerCall).toBeLessThan(50);
      expect(result.rowsPruned).toBeGreaterThan(500_000);
      expect(result.batches).toBeGreaterThan(500); // bounded batches (<= 1000 rows each)
      expect(result.p95BatchMs).toBeLessThan(250); // a batch never blocks the loop for long
      expect(result.maxBatchMs).toBeLessThan(5_000); // rare fsync/checkpoint outliers only
      // totals are untouched by pruning
      expect(meter.checkQuota(1e12).used).toBe(expectedUsed + 1000 + 51);
      expect(meter.summary().events).toBe(expectedUsed + 1000 + 51);
    } finally {
      store.close();
    }
  }, 300_000);
});
