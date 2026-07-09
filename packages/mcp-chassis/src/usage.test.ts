import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
});
