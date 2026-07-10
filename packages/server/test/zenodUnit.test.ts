import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChassisStorage,
  createMemoryTenantStore,
  type UnitContext,
} from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it } from "vitest";
import { createZenodUnit, ZenodRuntimePool } from "../src/zenodUnit.js";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-unit-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function contextFor(
  storage: ChassisStorage,
  tenantId: string,
): UnitContext {
  const tenant = { id: tenantId };
  return {
    unitName: "zenod",
    tenant,
    storage: storage.forTenant(tenant),
    usage: null,
    operatingRules: null,
  };
}

describe("Zenod chassis unit", () => {
  it("caches one runtime per verified tenant storage root", async () => {
    const dataDir = await tempDir();
    const storage = new ChassisStorage({ dataDir });
    const pool = new ZenodRuntimePool();
    try {
      const alphaContext = contextFor(storage, "tenant-alpha");
      const betaContext = contextFor(storage, "tenant-beta");
      const alpha = pool.forContext(alphaContext);
      const beta = pool.forContext(betaContext);

      expect(pool.forContext(alphaContext)).toBe(alpha);
      expect(alpha.dataDir).toBe(join(dataDir, "tenant-alpha"));
      expect(beta.dataDir).toBe(join(dataDir, "tenant-beta"));
      expect(alpha.dataDir).not.toBe(beta.dataDir);
      expect(alpha.settings.getRaw("api_token")).toBeNull();
      expect(beta.settings.getRaw("api_token")).toBeNull();
      alpha.settings.set("github_token", "ghp_alpha_secret");
      const alphaHandle = alpha.state.getSetting("github_token");
      expect(alphaHandle).toMatch(/^zenod-secret:v1:/);
      expect(alphaHandle).not.toContain("ghp_alpha_secret");
      expect(alpha.settings.get("github_token")).toBe("ghp_alpha_secret");
      expect(beta.credentialVault.materialize("github_token", alphaHandle!)).toBeNull();
    } finally {
      pool.close();
    }
  });

  it("boots through createUnit and delegates provisioning to the chassis store", async () => {
    const dataDir = await tempDir();
    const tenants = createMemoryTenantStore();
    const unit = createZenodUnit({
      dataDir,
      tenantStore: tenants,
      controlPlane: { token: "control-secret" },
    });
    try {
      const health = await unit.app.request("/healthz");
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toMatchObject({
        status: "ok",
        name: "zenod",
      });

      const provisioned = await unit.app.request("/api/tenants", {
        method: "POST",
        headers: {
          authorization: "Bearer control-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ tenantId: "tenant-alpha" }),
      });
      expect(provisioned.status).toBe(201);
      expect(tenants.snapshot()).toHaveLength(1);
      expect(JSON.stringify(tenants.snapshot())).not.toContain(
        (await provisioned.json() as { token: string }).token,
      );
    } finally {
      unit.runtimes.close();
    }
  });
});
