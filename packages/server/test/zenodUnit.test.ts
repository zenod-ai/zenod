import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChassisStorage,
  createMemoryTenantStore,
  hashToken,
  type UnitContext,
} from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it } from "vitest";
import {
  createZenodUnit,
  ZENOD_READ_TOOLS,
  ZenodRuntimePool,
} from "../src/zenodUnit.js";

const tempDirs: string[] = [];
const CHASSIS_VAULT_MASTER_KEY = "11".repeat(32);

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
  it("declares every Zenod read tool for chassis conduct enforcement", () => {
    expect([...ZENOD_READ_TOOLS].sort()).toEqual([
      "ask_brain",
      "get_ingest_result",
      "get_memory",
      "get_recent_conversation_transcript",
      "get_task_result",
      "list_drive_files",
      "read_llm_timeline",
      "search_memory",
    ]);
  });

  it("caches one runtime per verified tenant storage root", async () => {
    const dataDir = await tempDir();
    const storage = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: CHASSIS_VAULT_MASTER_KEY,
    });
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
      expect(alpha.settings.get("artifact_archive_provider")).toBe("local");
      expect(alpha.settings.get("artifact_archive_local_dir")).toBe(
        join(dataDir, "tenant-alpha", "media"),
      );
      expect(beta.settings.get("artifact_archive_local_dir")).toBe(
        join(dataDir, "tenant-beta", "media"),
      );
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
      env: { CHASSIS_VAULT_MASTER_KEY },
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
      unit.close();
    }
  });

  it("routes product APIs through the authenticated tenant runtime", async () => {
    const dataDir = await tempDir();
    const tenants = createMemoryTenantStore([
      { token: "alpha-token", tenant: { id: "tenant-alpha" } },
      { token: "beta-token", tenant: { id: "tenant-beta" } },
    ]);
    const unit = createZenodUnit({
      dataDir,
      tenantStore: tenants,
      env: { CHASSIS_VAULT_MASTER_KEY },
    });
    try {
      for (const [token, repo] of [
        ["alpha-token", "owner/alpha"],
        ["beta-token", "owner/beta"],
      ]) {
        const response = await unit.app.request("/api/settings", {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ vault_repo: repo }),
        });
        expect(response.status).toBe(200);
      }

      const alpha = await unit.app.request(
        "/api/settings?tenantId=tenant-beta",
        { headers: { authorization: "Bearer alpha-token" } },
      );
      const beta = await unit.app.request("/api/settings", {
        headers: { authorization: "Bearer beta-token" },
      });
      expect(await alpha.json()).toMatchObject({
        settings: { vault_repo: "owner/alpha" },
      });
      expect(await beta.json()).toMatchObject({
        settings: { vault_repo: "owner/beta" },
      });

      const anonymous = await unit.app.request("/api/settings");
      expect(anonymous.status).toBe(401);

      const login = await unit.app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "alpha-token" }),
      });
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      expect(cookie).toBeTruthy();
      const sessionSettings = await unit.app.request("/api/settings", {
        headers: { cookie: cookie! },
      });
      expect(await sessionSettings.json()).toMatchObject({
        settings: { vault_repo: "owner/alpha" },
      });
    } finally {
      unit.close();
    }
  });

  it("uses the durable chassis tenant store for idempotent self-host restart", async () => {
    const dataDir = await tempDir();
    const env = {
      ZENOD_API_TOKEN: "zenod_self_host_restart_token",
      ZENOD_TENANT_ID: "self-host-test",
      CHASSIS_VAULT_MASTER_KEY,
    };
    const first = createZenodUnit({ dataDir, env });
    expect(
      await first.tenantStore.resolveTokenHash(
        hashToken(env.ZENOD_API_TOKEN),
      ),
    ).toMatchObject({ tenant: { id: "self-host-test" } });
    first.close();

    const restarted = createZenodUnit({ dataDir, env });
    try {
      expect(
        await restarted.tenantStore.resolveTokenHash(
          hashToken(env.ZENOD_API_TOKEN),
        ),
      ).toMatchObject({ tenant: { id: "self-host-test" } });
    } finally {
      restarted.close();
    }
  });
});
