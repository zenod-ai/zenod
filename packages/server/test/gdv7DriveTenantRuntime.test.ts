import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryTenantStore } from "@zenod/mcp-chassis";
import { DriveVaultRepository, type DriveVaultRepositoryOptions, type VaultRepository } from "zenod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createZenodUnit } from "../src/zenodUnit.js";

const dirs: string[] = [];
const MASTER_KEY = "71".repeat(32);

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gdv7-runtime-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function googleSession(unit: ReturnType<typeof createZenodUnit>, subject: string): Promise<{ cookie: string; userId: string }> {
  const cookiePair = (setCookie: string, name: string): string => {
    const match = setCookie.match(new RegExp(`(?:^|,\\s*)(${name}=[^;]+)`));
    if (!match?.[1]) throw new Error(`missing ${name} cookie`);
    return match[1];
  };
  const start = await unit.app.request("/auth/google/start");
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const flowCookie = cookiePair(start.headers.get("set-cookie")!, "zenod_google_oidc_flow");
  const callback = await unit.app.request(`/auth/google/callback?code=${encodeURIComponent(subject)}&state=${encodeURIComponent(state)}`, {
    headers: { cookie: flowCookie },
  });
  const cookie = cookiePair(callback.headers.get("set-cookie")!, "zenod_customer_session");
  const me = await unit.app.request("/api/me", { headers: { cookie } });
  return { cookie, userId: (await me.json() as { user_id: string }).user_id };
}

function fakeDriveRepository(input: DriveVaultRepositoryOptions): VaultRepository & { authorityBinding(): { folderId: string; manifestFileId: string } } {
  const suffix = input.tenantId.replace(/[^a-z0-9_-]/gi, "-");
  return {
    provider: "google_drive",
    path: input.workdir,
    authorityBinding: () => ({ folderId: `folder-${suffix}`, manifestFileId: `manifest-${suffix}` }),
    pull: async () => {},
    currentRevision: async () => ({
      provider: "google_drive",
      id: `drive-revision-${suffix}`,
      committedAt: "2026-08-29T20:00:00.000Z",
      urls: [`https://drive.google.com/file/d/manifest-${suffix}/view`],
      commitSha: "a".repeat(40),
    }),
    trackedFiles: async () => ["Log/2026-08-29.md"],
    contentAtHead: async () => "# Durable Drive memory\n",
    pendingChanges: async () => [],
    discardChanges: async () => {},
    commitAndPublish: async () => ({
      provider: "google_drive",
      id: `drive-revision-${suffix}`,
      committedAt: "2026-08-29T20:00:00.000Z",
      urls: [`https://drive.google.com/file/d/manifest-${suffix}/view`],
      commitSha: "a".repeat(40),
    }),
    urlFor: (path) => `https://drive.google.com/file/d/${encodeURIComponent(path)}/view`,
  };
}

describe("GDV-7 Drive tenant runtime", () => {
  it("binds signed consent to one entitled tenant, rebuilds from Drive cache loss, and disconnects without deleting files", async () => {
    const dataDir = await tempDir();
    const tenants = createMemoryTenantStore([
      { token: "alpha-token", tenant: { id: "tenant-alpha" } },
      { token: "beta-token", tenant: { id: "tenant-beta" } },
    ]);
    const unit = createZenodUnit({
      dataDir,
      tenantStore: tenants,
      env: {
        NODE_ENV: "test",
        ACCOUNT_STATE_SECRET: "gdv7-customer-state-secret",
        CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
        GOOGLE_OIDC_CLIENT_ID: "identity-client",
        GOOGLE_OIDC_CLIENT_SECRET: "identity-secret",
        CUSTOMER_APP_URL: "https://cloud.zenod.test",
      },
      customer: {
        identityProviders: {
          google: {
            authorizeUrl: (state) => `https://accounts.google.test/auth?state=${encodeURIComponent(state)}`,
            exchangeAndGetUser: async (code) => ({
              id: code,
              login: `${code}@example.test`,
              email: `${code}@example.test`,
              email_verified: true,
            }),
          },
        },
      },
    });
    const opened: DriveVaultRepositoryOptions[] = [];
    vi.spyOn(DriveVaultRepository, "open").mockImplementation(async (input) => {
      opened.push(input);
      return fakeDriveRepository(input) as DriveVaultRepository;
    });
    const providerCalls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      providerCalls.push(url);
      if (url === "https://oauth2.googleapis.com/token") {
        const code = new URLSearchParams(String(init?.body)).get("code") ?? "unknown";
        if (code === "exchange-fail") {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        return Response.json({ access_token: `${code}-access`, refresh_token: `${code}-refresh` });
      }
      if (url === "https://www.googleapis.com/oauth2/v2/userinfo") {
        return Response.json({ email: "drive-owner@example.test" });
      }
      throw new Error(`unexpected provider request ${url}`);
    }));

    try {
      const alpha = await googleSession(unit, "google-alpha");
      const beta = await googleSession(unit, "google-beta");
      for (const account of [
        { session: "checkout-alpha", id: "account-alpha", user: alpha.userId, tenant: "tenant-alpha", token: "alpha-token" },
        { session: "checkout-beta", id: "account-beta", user: beta.userId, tenant: "tenant-beta", token: "beta-token" },
      ]) {
        unit.customerAccounts.upsert(account.session, {
          account_id: account.id,
          user_id: account.user,
          tier: "monthly",
          subscription_status: "active",
          tenant_id: account.tenant,
          tenant_slug: account.tenant,
          checkout_completed_at: new Date().toISOString(),
        });
        unit.customerTokenVault.put(account.id, account.token);
        const runtime = unit.runtimes.forTenantStorage(account.tenant, unit.storage.forTenant({ id: account.tenant }));
        runtime.settings.set("google_oauth_client_id", `${account.tenant}-drive-client`);
        runtime.settings.set("google_oauth_client_secret", `${account.tenant}-drive-secret`);
      }

      const alphaStart = await unit.app.request("https://cloud.zenod.test/api/vault/drive/oauth/start", {
        headers: { cookie: alpha.cookie },
      });
      expect(alphaStart.status).toBe(302);
      const alphaConsent = new URL(alphaStart.headers.get("location")!);
      expect(alphaConsent.searchParams.get("scope")?.split(" ").sort()).toEqual([
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/userinfo.email",
      ]);
      const alphaState = alphaConsent.searchParams.get("state")!;
      expect(alphaState).toContain(".");
      expect(unit.customerAccounts.resolveForTenantId("tenant-alpha")).toMatchObject({
        vault_provider: null,
        vault_binding_id: null,
      });

      const crossTenant = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=cross-tenant&state=${encodeURIComponent(alphaState)}`,
        { headers: { cookie: beta.cookie } },
      );
      expect(crossTenant.status).toBe(400);
      expect(providerCalls).toHaveLength(0);

      const alphaCallback = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=alpha-drive&state=${encodeURIComponent(alphaState)}`,
        { headers: { cookie: alpha.cookie } },
      );
      expect(alphaCallback.status).toBe(303);
      expect(opened).toHaveLength(1);
      expect(opened[0]).toMatchObject({ tenantId: "tenant-alpha" });
      const alphaAccount = unit.customerAccounts.resolveForTenantId("tenant-alpha")!;
      expect(alphaAccount).toMatchObject({
        vault_provider: "google_drive",
        vault_binding_status: "ready",
        vault_drive_folder_id: "folder-tenant-alpha",
        vault_drive_manifest_file_id: "manifest-tenant-alpha",
      });
      const alphaRuntime = unit.runtimes.get("tenant-alpha")!;
      const encryptedToken = alphaRuntime.state.getSetting("google_oauth_refresh_token")!;
      expect(encryptedToken).toMatch(/^zenod-secret:v1:/);
      expect(encryptedToken).not.toContain("alpha-drive-refresh");
      const betaRuntime = unit.runtimes.get("tenant-beta")!;
      expect(betaRuntime.credentialVault.materialize("google_oauth_refresh_token", encryptedToken)).toBeNull();

      const ready = await unit.app.request("/api/vault/provider", { headers: { cookie: alpha.cookie } });
      await expect(ready.json()).resolves.toMatchObject({
        provider: "google_drive",
        ready: true,
        memory: { store: true, search: true, get: true, ask: true },
        githubTasking: false,
      });

      await alphaRuntime.reclone();
      await alphaRuntime.getRepo();
      expect(opened).toHaveLength(2);
      expect(opened[1]).toMatchObject({
        tenantId: "tenant-alpha",
        vaultBindingId: alphaAccount.vault_binding_id,
        storedRootFolderId: "folder-tenant-alpha",
      });
      expect(opened[1]!.stateDir).toBe(opened[0]!.stateDir);

      await tenants.setTenantStatus("tenant-alpha", "suspended");
      const beforeSuspendedRecovery = opened.length;
      const suspended = await unit.app.request("https://cloud.zenod.test/api/vault/drive/recover", {
        method: "POST",
        headers: { cookie: alpha.cookie, origin: "https://cloud.zenod.test" },
      });
      expect(suspended.status).toBe(409);
      expect(opened).toHaveLength(beforeSuspendedRecovery);
      await tenants.setTenantStatus("tenant-alpha", "active");

      const providerCallsBeforeDisconnect = providerCalls.length;
      const disconnect = await unit.app.request("https://cloud.zenod.test/api/vault/drive/disconnect", {
        method: "POST",
        headers: { cookie: alpha.cookie, origin: "https://cloud.zenod.test" },
      });
      expect(disconnect.status).toBe(200);
      await expect(disconnect.json()).resolves.toEqual({ ok: true, filesDeleted: false });
      expect(providerCalls).toHaveLength(providerCallsBeforeDisconnect);
      expect(unit.customerAccounts.resolveForTenantId("tenant-alpha")).toMatchObject({
        vault_provider: "google_drive",
        vault_binding_status: "revoked",
        vault_drive_folder_id: "folder-tenant-alpha",
        vault_drive_manifest_file_id: "manifest-tenant-alpha",
      });
      expect(alphaRuntime.settings.getRaw("google_oauth_refresh_token")).toBeNull();

      const betaStart = await unit.app.request("https://cloud.zenod.test/api/vault/drive/oauth/start", {
        headers: { cookie: beta.cookie },
      });
      const betaState = new URL(betaStart.headers.get("location")!).searchParams.get("state")!;
      const exchangeFailure = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=exchange-fail&state=${encodeURIComponent(betaState)}`,
        { headers: { cookie: beta.cookie } },
      );
      expect(exchangeFailure.status).toBe(502);
      const failedBinding = unit.customerAccounts.resolveForTenantId("tenant-beta")!;
      expect(failedBinding).toMatchObject({
        vault_provider: "google_drive",
        vault_binding_status: "error",
        vault_drive_folder_id: null,
        vault_drive_manifest_file_id: null,
      });

      const credentialRetryStart = await unit.app.request("https://cloud.zenod.test/api/vault/drive/oauth/start", {
        headers: { cookie: beta.cookie },
      });
      const credentialRetryState = new URL(credentialRetryStart.headers.get("location")!).searchParams.get("state")!;
      const stateBindingId = (state: string) => (JSON.parse(Buffer.from(state.split(".")[0]!, "base64url").toString("utf8")) as { bid: string }).bid;
      expect(stateBindingId(credentialRetryState)).toBe(failedBinding.vault_binding_id);
      const originalSetRaw = betaRuntime.settings.setRaw.bind(betaRuntime.settings);
      const setRaw = vi.spyOn(betaRuntime.settings, "setRaw").mockImplementation((key, value) => {
        if (key === "google_oauth_refresh_token") throw new Error("encrypted credential authority unavailable");
        originalSetRaw(key, value);
      });
      const credentialFailure = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=credential-fail&state=${encodeURIComponent(credentialRetryState)}`,
        { headers: { cookie: beta.cookie } },
      );
      expect(credentialFailure.status).toBe(502);
      expect(unit.customerAccounts.resolveForTenantId("tenant-beta")).toMatchObject({
        vault_binding_id: failedBinding.vault_binding_id,
        vault_binding_status: "error",
        vault_drive_folder_id: null,
        vault_drive_manifest_file_id: null,
      });
      expect(opened).toHaveLength(2);
      setRaw.mockRestore();

      const successfulRetryStart = await unit.app.request("https://cloud.zenod.test/api/vault/drive/oauth/start", {
        headers: { cookie: beta.cookie },
      });
      const successfulRetryState = new URL(successfulRetryStart.headers.get("location")!).searchParams.get("state")!;
      expect(stateBindingId(successfulRetryState)).toBe(failedBinding.vault_binding_id);
      const successfulRetry = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=beta-drive&state=${encodeURIComponent(successfulRetryState)}`,
        { headers: { cookie: beta.cookie } },
      );
      expect(successfulRetry.status).toBe(303);
      expect(unit.customerAccounts.resolveForTenantId("tenant-beta")).toMatchObject({
        vault_binding_id: failedBinding.vault_binding_id,
        vault_binding_status: "ready",
        vault_drive_folder_id: "folder-tenant-beta",
        vault_drive_manifest_file_id: "manifest-tenant-beta",
      });

      const callsBeforeReplay = providerCalls.length;
      const replay = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=replay&state=${encodeURIComponent(successfulRetryState)}`,
        { headers: { cookie: beta.cookie } },
      );
      expect(replay.status).toBe(400);
      expect(providerCalls).toHaveLength(callsBeforeReplay);
      expect(unit.customerAccounts.resolveForTenantId("tenant-beta")).toMatchObject({
        vault_binding_id: failedBinding.vault_binding_id,
        vault_binding_status: "ready",
      });
    } finally {
      await unit.close();
    }
  });
});
