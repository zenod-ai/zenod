import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteTenantStore, hashToken } from "./index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("SqliteTenantStore", () => {
  it("persists imported token hashes and tenant lifecycle state across restarts", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-tenants-"));
    tempDirs.push(dataDir);
    const existingToken = "zenod_existing_token_kept_during_migration";

    const first = createSqliteTenantStore({ dataDir });
    first.importTenantTokenHash({
      tokenHash: hashToken(existingToken),
      tenant: {
        id: "tenant-existing",
        name: "Existing Tenant",
        plan: "pro",
        quota: 25,
      },
    });
    first.provisionTenant({
      tenantId: "tenant-new",
      token: "tenant-new-token",
    });
    first.setTenantStatus("tenant-new", "suspended");
    first.close();

    const restarted = createSqliteTenantStore({ dataDir });
    expect(restarted.resolveTokenHash(hashToken(existingToken))).toMatchObject({
      tenant: {
        id: "tenant-existing",
        name: "Existing Tenant",
        plan: "pro",
        quota: 25,
      },
      status: "active",
    });
    expect(
      restarted.resolveTokenHash(hashToken("tenant-new-token")),
    ).toMatchObject({
      tenant: { id: "tenant-new" },
      status: "suspended",
    });

    const rotated = restarted.rotateTenantToken("tenant-existing");
    expect(rotated?.token).toMatch(/^zenod_[a-f0-9]{48}$/);
    expect(restarted.resolveTokenHash(hashToken(existingToken))).toBeNull();
    expect(restarted.resolveTokenHash(hashToken(rotated!.token))).toMatchObject(
      {
        tenant: { id: "tenant-existing" },
        status: "active",
      },
    );
    restarted.close();

    const rotatedRestart = createSqliteTenantStore({ dataDir });
    expect(
      rotatedRestart.resolveTokenHash(hashToken(rotated!.token)),
    ).toMatchObject({
      tenant: { id: "tenant-existing" },
    });
    rotatedRestart.close();
  });
});
