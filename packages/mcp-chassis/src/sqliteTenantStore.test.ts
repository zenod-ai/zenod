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

  it("persists one replaceable profile token per tenant with inherited lifecycle", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "mcp-chassis-profile-tokens-"),
    );
    tempDirs.push(dataDir);
    const expiresAt = Date.now() + 60_000;
    const store = createSqliteTenantStore({ dataDir });
    const primary = store.provisionTenant({
      tenantId: "tenant-a",
      token: "ordinary-tenant-token",
      expiresAt,
    });
    const other = store.provisionTenant({
      tenantId: "tenant-b",
      token: "other-tenant-token",
    });
    const first = store.provisionTenantToken("tenant-a", "memory-channel");
    const otherScoped = store.provisionTenantToken(
      "tenant-b",
      "memory-channel",
    );

    expect(first?.record).toMatchObject({
      tenant: { id: "tenant-a" },
      profile: "memory-channel",
      status: "active",
      expiresAt,
    });
    expect(otherScoped?.record.tenant.id).toBe("tenant-b");
    expect(primary.record.tokenHash).toBe(hashToken("ordinary-tenant-token"));
    expect(other.record.tokenHash).toBe(hashToken("other-tenant-token"));

    const replacement = store.provisionTenantToken(
      "tenant-a",
      "memory-channel",
    );
    expect(replacement?.token).not.toBe(first?.token);
    expect(store.resolveTokenHash(hashToken(first!.token))).toBeNull();
    expect(
      store.resolveTokenHash(hashToken(replacement!.token)),
    ).toMatchObject({
      tenant: { id: "tenant-a" },
      profile: "memory-channel",
      expiresAt,
    });
    expect(
      store.resolveTokenHash(hashToken(otherScoped!.token)),
    ).toMatchObject({
      tenant: { id: "tenant-b" },
      profile: "memory-channel",
    });

    store.setTenantStatus("tenant-a", "suspended");
    expect(
      store.resolveTokenHash(hashToken(replacement!.token)),
    ).toMatchObject({
      status: "suspended",
      expiresAt,
    });
    expect(
      store.resolveTokenHash(hashToken("ordinary-tenant-token")),
    ).toMatchObject({ status: "suspended", expiresAt });
    store.close();

    const restarted = createSqliteTenantStore({ dataDir });
    expect(
      restarted.resolveTokenHash(hashToken(replacement!.token)),
    ).toMatchObject({
      tenant: { id: "tenant-a" },
      profile: "memory-channel",
      status: "suspended",
      expiresAt,
    });
    expect(
      restarted.resolveTokenHash(hashToken(otherScoped!.token)),
    ).toMatchObject({
      tenant: { id: "tenant-b" },
      profile: "memory-channel",
      status: "active",
    });
    restarted.close();
  });
});
