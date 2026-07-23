import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteOAuthStore } from "./index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-chassis-oauth-"));
  tempDirs.push(dir);
  return dir;
}

describe("SqliteOAuthStore", () => {
  it("persists dynamically-registered clients across restarts", async () => {
    const dataDir = await freshDir();
    const first = createSqliteOAuthStore({ dataDir });
    first.createClient({
      clientId: "zc_abc",
      clientName: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
      createdAt: 1_000,
    });
    first.close();

    const restarted = createSqliteOAuthStore({ dataDir });
    expect(restarted.getClient("zc_abc")).toEqual({
      clientId: "zc_abc",
      clientName: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
      createdAt: 1_000,
    });
    expect(restarted.getClient("missing")).toBeNull();
  });

  it("consumes an authorization code exactly once and rejects expired codes", async () => {
    const store = createSqliteOAuthStore({ dataDir: await freshDir() });
    const tenant = { id: "tenant-1", name: "Tenant One", plan: "pro" };
    store.createCode({
      code: "code-1",
      clientId: "zc_abc",
      redirectUri: "https://claude.ai/cb",
      codeChallenge: "challenge",
      resource: "https://cloud.zenod.dev/mcp",
      scope: "mcp",
      tenant,
      expiresAt: Date.now() + 60_000,
    });

    const consumed = store.consumeCode("code-1");
    expect(consumed).toMatchObject({ clientId: "zc_abc", tenant });
    // Second consume returns null — codes are single-use.
    expect(store.consumeCode("code-1")).toBeNull();

    store.createCode({
      code: "code-expired",
      clientId: "zc_abc",
      redirectUri: "https://claude.ai/cb",
      codeChallenge: "challenge",
      resource: "https://cloud.zenod.dev/mcp",
      scope: "mcp",
      tenant,
      expiresAt: Date.now() - 1,
    });
    expect(store.consumeCode("code-expired")).toBeNull();
  });

  it("issues, rotates, and expires access tokens while keeping refresh tokens durable", async () => {
    const dataDir = await freshDir();
    const first = createSqliteOAuthStore({ dataDir });
    const tenant = { id: "tenant-1" };
    first.createToken({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      clientId: "zc_abc",
      clientName: "Claude",
      resource: "https://cloud.zenod.dev/mcp",
      scope: "mcp",
      tenant,
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now(),
    });

    expect(first.resolveOAuthAccessToken("access-1")).toMatchObject({
      tenant,
      clientId: "zc_abc",
      scope: "mcp",
    });
    first.close();

    // Survives restart, then rotate the access token off the refresh token.
    const restarted = createSqliteOAuthStore({ dataDir });
    expect(restarted.getByRefreshToken("refresh-1")).toMatchObject({ accessToken: "access-1" });
    restarted.rotateAccessToken("refresh-1", "access-2", Date.now() + 60_000);
    expect(restarted.resolveOAuthAccessToken("access-1")).toBeNull();
    expect(restarted.resolveOAuthAccessToken("access-2")).toMatchObject({ clientId: "zc_abc" });

    // An expired access token no longer resolves.
    restarted.rotateAccessToken("refresh-1", "access-3", Date.now() - 1);
    expect(restarted.resolveOAuthAccessToken("access-3")).toBeNull();
    // The refresh token itself stays resolvable so a refresh grant can mint a new one.
    expect(restarted.getByRefreshToken("refresh-1")).not.toBeNull();
  });

  it("consumes provider CSRF state exactly once", async () => {
    const store = createSqliteOAuthStore({ dataDir: await freshDir() });
    store.createProviderState({
      state: "state-1",
      providerId: "github",
      tenantId: "tenant-1",
      redirectUri: "https://cloud.zenod.dev/api/oauth/providers/github/callback",
      expiresAt: Date.now() + 60_000,
    });
    expect(store.consumeProviderState("state-1")).toMatchObject({ providerId: "github" });
    expect(store.consumeProviderState("state-1")).toBeNull();
  });
});
