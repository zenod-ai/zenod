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

function cookiePair(setCookie: string, name: string): string {
  const match = setCookie.match(new RegExp(`(?:^|,\\s*)(${name}=[^;]+)`));
  if (!match?.[1]) throw new Error(`missing ${name} cookie`);
  return match[1];
}

async function googleSession(unit: ReturnType<typeof createZenodUnit>, subject: string): Promise<{ cookie: string; userId: string }> {
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

async function driveConsentStart(unit: ReturnType<typeof createZenodUnit>, cookie: string, origin = "https://cloud.zenod.test") {
  const response = await unit.app.request("https://cloud.zenod.test/api/vault/drive/oauth/start", {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify({ intent: "connect_drive_vault" }),
  });
  const body = await response.json() as { url?: string };
  const url = body.url ? new URL(body.url) : null;
  return {
    response,
    url,
    state: url?.searchParams.get("state") ?? "",
    flowCookie: response.headers.get("set-cookie")
      ? cookiePair(response.headers.get("set-cookie")!, "zenod_google_drive_vault_flow")
      : "",
  };
}

async function expectScrubbedDriveRedirect(
  response: Response,
  error: string,
  sensitive: string[] = [],
): Promise<void> {
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(`https://cloud.zenod.test/app?vault=${error}#vault`);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("set-cookie")).toContain("zenod_google_drive_vault_flow=");
  expect(response.headers.get("content-type") ?? "").not.toContain("text/html");
  const body = await response.text();
  for (const value of sensitive.filter(Boolean)) {
    expect(response.headers.get("location")).not.toContain(value);
    expect(body).not.toContain(value);
  }
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
    let failNextBootstrap = false;
    vi.spyOn(DriveVaultRepository, "open").mockImplementation(async (input) => {
      opened.push(input);
      const repository = fakeDriveRepository(input);
      if (failNextBootstrap) {
        failNextBootstrap = false;
        repository.currentRevision = async () => {
          throw new Error("Drive vault bootstrap failed");
        };
      }
      return repository as DriveVaultRepository;
    });
    const providerCalls: string[] = [];
    let deferNextDriveResponse = false;
    let resolveDeferredDrive: ((response: Response) => void) | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      providerCalls.push(url);
      if (url === "https://oauth2.googleapis.com/token") {
        const tokenBody = new URLSearchParams(String(init?.body));
        const code = tokenBody.get("code") ?? "unknown";
        if (tokenBody.get("grant_type") === "authorization_code") {
          expect(tokenBody.get("code_verifier")).toBeTruthy();
        }
        if (code === "exchange-fail") {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        return Response.json({ access_token: `${code}-access`, refresh_token: `${code}-refresh` });
      }
      if (url === "https://www.googleapis.com/oauth2/v2/userinfo") {
        return Response.json({ email: "drive-owner@example.test" });
      }
      if (url.startsWith("https://www.googleapis.com/drive/v3/")) {
        if (deferNextDriveResponse) {
          deferNextDriveResponse = false;
          return await new Promise<Response>((resolve) => { resolveDeferredDrive = resolve; });
        }
        return Response.json({ files: [] });
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
      unit.customerAccounts.upsert("checkout-alpha-retry", {
        account_id: "account-alpha",
        user_id: alpha.userId,
        tier: "monthly",
        subscription_status: "active",
        tenant_id: "tenant-alpha",
        tenant_slug: "tenant-alpha",
        claimed_at: "2099-08-29T20:01:00.000Z",
        checkout_completed_at: new Date().toISOString(),
      });

      const ambientGet = await unit.app.request("https://cloud.zenod.test/api/vault/drive/oauth/start", {
        headers: { cookie: alpha.cookie },
      });
      expect(ambientGet.status).not.toBe(302);
      const evilOrigin = await driveConsentStart(unit, alpha.cookie, "https://evil.example");
      expect(evilOrigin.response.status).toBe(403);
      const missingIntent = await unit.app.request("https://cloud.zenod.test/api/vault/drive/oauth/start", {
        method: "POST",
        headers: { cookie: alpha.cookie, origin: "https://cloud.zenod.test", "content-type": "application/json" },
        body: "{}",
      });
      expect(missingIntent.status).toBe(400);
      const alphaStart = await driveConsentStart(unit, alpha.cookie);
      expect(alphaStart.response.status).toBe(200);
      const alphaConsent = alphaStart.url!;
      expect(alphaConsent.searchParams.get("scope")?.split(" ").sort()).toEqual([
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/userinfo.email",
      ]);
      expect(alphaConsent.searchParams.get("code_challenge")).toBeTruthy();
      expect(alphaConsent.searchParams.get("code_challenge_method")).toBe("S256");
      const alphaState = alphaStart.state;
      expect(alphaState).toContain(".");
      expect(unit.customerAccounts.resolveVaultAuthorityForTenantId("tenant-alpha")?.account).toMatchObject({
        vault_provider: null,
        vault_binding_id: null,
      });

      const expiredSession = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=expired-session&state=${encodeURIComponent(alphaState)}`,
      );
      await expectScrubbedDriveRedirect(expiredSession, "drive_session", [alphaState, "expired-session"]);

      const missingFlow = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=missing-flow&state=${encodeURIComponent(alphaState)}`,
        { headers: { cookie: alpha.cookie } },
      );
      await expectScrubbedDriveRedirect(missingFlow, "drive_expired", [
        alphaState,
        "missing-flow",
        "account-alpha",
        "checkout-alpha-retry",
        "tenant-alpha",
      ]);
      expect(providerCalls).toHaveLength(0);

      const crossTenant = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=cross-tenant&state=${encodeURIComponent(alphaState)}`,
        { headers: { cookie: `${beta.cookie}; ${alphaStart.flowCookie}` } },
      );
      await expectScrubbedDriveRedirect(crossTenant, "drive_expired", [alphaState, "cross-tenant"]);
      expect(providerCalls).toHaveLength(0);

      const alphaCallback = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=alpha-drive&state=${encodeURIComponent(alphaState)}`,
        { headers: { cookie: `${alpha.cookie}; ${alphaStart.flowCookie}` } },
      );
      expect(alphaCallback.status).toBe(303);
      expect(alphaCallback.headers.get("cache-control")).toBe("no-store");
      expect(alphaCallback.headers.get("referrer-policy")).toBe("no-referrer");
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
      const encryptedToken = alphaRuntime.state.getSetting("google_drive_vault_oauth_refresh_token")!;
      expect(encryptedToken).toMatch(/^zenod-secret:v1:/);
      expect(encryptedToken).not.toContain("alpha-drive-refresh");
      const betaRuntime = unit.runtimes.get("tenant-beta")!;
      expect(betaRuntime.credentialVault.materialize("google_drive_vault_oauth_refresh_token", encryptedToken)).toBeNull();

      unit.customerAccounts.upsert("checkout-alpha-late-null", {
        account_id: "account-alpha",
        user_id: alpha.userId,
        tier: "monthly",
        subscription_status: "active",
        tenant_id: "tenant-alpha",
        tenant_slug: "tenant-alpha",
        claimed_at: "2100-08-29T20:01:00.000Z",
        checkout_completed_at: new Date().toISOString(),
      });
      expect(unit.customerAccounts.get("checkout-alpha-late-null")).toMatchObject({
        session_id: "checkout-alpha-late-null",
        vault_provider: null,
      });
      expect(unit.customerAccounts.resolveVaultAuthorityForTenantId("tenant-alpha")?.binding).toMatchObject({
        provider: "google_drive",
        binding_id: alphaAccount.vault_binding_id,
      });

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
      const oldDriveClient = opened[1]!.client;
      await oldDriveClient.listFiles();

      await tenants.setTenantStatus("tenant-alpha", "suspended");
      const beforeSuspendedRecovery = opened.length;
      const suspended = await unit.app.request("https://cloud.zenod.test/api/vault/drive/recover", {
        method: "POST",
        headers: { cookie: alpha.cookie, origin: "https://cloud.zenod.test" },
      });
      expect(suspended.status).toBe(409);
      expect(opened).toHaveLength(beforeSuspendedRecovery);
      await tenants.setTenantStatus("tenant-alpha", "active");

      alphaRuntime.settings.setRaw("google_oauth_refresh_token", "archive-refresh-token");
      deferNextDriveResponse = true;
      const lateOldRequest = oldDriveClient.listFiles();
      await vi.waitFor(() => expect(resolveDeferredDrive).not.toBeNull());
      const providerCallsBeforeDisconnect = providerCalls.length;
      const disconnect = await unit.app.request("https://cloud.zenod.test/api/vault/drive/disconnect", {
        method: "POST",
        headers: { cookie: alpha.cookie, origin: "https://cloud.zenod.test" },
      });
      expect(disconnect.status).toBe(200);
      await expect(disconnect.json()).resolves.toEqual({ ok: true, filesDeleted: false });
      expect(providerCalls).toHaveLength(providerCallsBeforeDisconnect);
      expect(unit.customerAccounts.resolveVaultAuthorityForTenantId("tenant-alpha")?.account).toMatchObject({
        vault_provider: "google_drive",
        vault_binding_status: "revoked",
        vault_drive_folder_id: "folder-tenant-alpha",
        vault_drive_manifest_file_id: "manifest-tenant-alpha",
      });
      expect(alphaRuntime.settings.getRaw("google_drive_vault_oauth_refresh_token")).toBeNull();
      expect(alphaRuntime.settings.getRaw("google_oauth_refresh_token")).toBe("archive-refresh-token");

      const deniedStart = await driveConsentStart(unit, alpha.cookie);
      const denied = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?error=access_denied&state=${encodeURIComponent(deniedStart.state)}`,
        { headers: { cookie: `${alpha.cookie}; ${deniedStart.flowCookie}` } },
      );
      await expectScrubbedDriveRedirect(denied, "drive_denied", [deniedStart.state, "access_denied"]);
      expect(unit.customerAccounts.resolveVaultAuthorityForTenantId("tenant-alpha")?.account).toMatchObject({
        vault_provider: "google_drive",
        vault_binding_status: "revoked",
      });

      const reconnectStart = await driveConsentStart(unit, alpha.cookie);
      const reconnect = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=alpha-reconnect&state=${encodeURIComponent(reconnectStart.state)}`,
        { headers: { cookie: `${alpha.cookie}; ${reconnectStart.flowCookie}` } },
      );
      expect(reconnect.status).toBe(303);
      expect(unit.customerAccounts.resolveVaultAuthorityForTenantId("tenant-alpha")?.account).toMatchObject({
        vault_binding_id: alphaAccount.vault_binding_id,
        vault_binding_status: "ready",
        vault_authorization_epoch: 2,
      });
      expect(alphaRuntime.settings.getRaw("google_oauth_refresh_token")).toBe("archive-refresh-token");
      alphaRuntime.settings.setRaw("google_oauth_refresh_token", "archive-rotated-token");
      expect(alphaRuntime.settings.getRaw("google_drive_vault_oauth_refresh_token")).toBe("alpha-reconnect-refresh");
      alphaRuntime.settings.setRaw("google_oauth_refresh_token", "");
      expect(alphaRuntime.settings.vaultConfigured()).toBe(true);
      expect(alphaRuntime.settings.getRaw("google_drive_vault_oauth_refresh_token")).toBe("alpha-reconnect-refresh");

      resolveDeferredDrive!(new Response('{"error":{"errors":[{"reason":"authError"}]}}', { status: 401 }));
      await expect(lateOldRequest).rejects.toThrow(/Drive API/);
      expect(unit.customerAccounts.resolveVaultAuthorityForTenantId("tenant-alpha")?.account).toMatchObject({
        vault_binding_status: "ready",
        vault_authorization_epoch: 2,
      });
      const callsBeforeOldRevival = providerCalls.length;
      await expect(oldDriveClient.listFiles()).rejects.toThrow(/authorization is unavailable/);
      expect(providerCalls).toHaveLength(callsBeforeOldRevival);

      const suspendedStart = await driveConsentStart(unit, beta.cookie);
      await tenants.setTenantStatus("tenant-beta", "suspended");
      const callsBeforeSuspendedCallback = providerCalls.length;
      const suspendedCallback = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=suspended&state=${encodeURIComponent(suspendedStart.state)}`,
        { headers: { cookie: `${beta.cookie}; ${suspendedStart.flowCookie}` } },
      );
      await expectScrubbedDriveRedirect(suspendedCallback, "drive_tenant", [suspendedStart.state, "suspended"]);
      expect(providerCalls).toHaveLength(callsBeforeSuspendedCallback);
      await tenants.setTenantStatus("tenant-beta", "active");
      const suspendedReplay = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=after-suspension&state=${encodeURIComponent(suspendedStart.state)}`,
        { headers: { cookie: `${beta.cookie}; ${suspendedStart.flowCookie}` } },
      );
      await expectScrubbedDriveRedirect(suspendedReplay, "drive_expired", [suspendedStart.state, "after-suspension"]);
      expect(unit.customerAccounts.resolveForTenantId("tenant-beta")).toMatchObject({
        vault_provider: null,
        vault_binding_id: null,
      });

      const missingCodeStart = await driveConsentStart(unit, beta.cookie);
      const callsBeforeMissingCode = providerCalls.length;
      const missingCode = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?state=${encodeURIComponent(missingCodeStart.state)}`,
        { headers: { cookie: `${beta.cookie}; ${missingCodeStart.flowCookie}` } },
      );
      await expectScrubbedDriveRedirect(missingCode, "drive_config", [missingCodeStart.state]);
      expect(providerCalls).toHaveLength(callsBeforeMissingCode);
      expect(unit.customerAccounts.resolveForTenantId("tenant-beta")).toMatchObject({
        vault_provider: null,
        vault_binding_id: null,
      });

      const missingConfigStart = await driveConsentStart(unit, beta.cookie);
      betaRuntime.settings.setRaw("google_oauth_client_id", "");
      betaRuntime.settings.setRaw("google_oauth_client_secret", "");
      const callsBeforeMissingConfig = providerCalls.length;
      const missingConfig = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=config-missing&state=${encodeURIComponent(missingConfigStart.state)}`,
        { headers: { cookie: `${beta.cookie}; ${missingConfigStart.flowCookie}` } },
      );
      await expectScrubbedDriveRedirect(missingConfig, "drive_config", [missingConfigStart.state, "config-missing"]);
      expect(providerCalls).toHaveLength(callsBeforeMissingConfig);
      expect(unit.customerAccounts.resolveForTenantId("tenant-beta")).toMatchObject({
        vault_provider: null,
        vault_binding_id: null,
      });
      betaRuntime.settings.set("google_oauth_client_id", "tenant-beta-drive-client");
      betaRuntime.settings.set("google_oauth_client_secret", "tenant-beta-drive-secret");

      const betaStart = await driveConsentStart(unit, beta.cookie);
      const betaState = betaStart.state;
      const exchangeFailure = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=exchange-fail&state=${encodeURIComponent(betaState)}`,
        { headers: { cookie: `${beta.cookie}; ${betaStart.flowCookie}` } },
      );
      await expectScrubbedDriveRedirect(exchangeFailure, "drive_exchange", [betaState, "exchange-fail"]);
      const failedBinding = unit.customerAccounts.resolveForTenantId("tenant-beta")!;
      expect(failedBinding).toMatchObject({
        vault_provider: "google_drive",
        vault_binding_status: "error",
        vault_drive_folder_id: null,
        vault_drive_manifest_file_id: null,
      });

      const callsBeforeFailedReplay = providerCalls.length;
      const failedReplay = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=fresh-after-failure&state=${encodeURIComponent(betaState)}`,
        { headers: { cookie: `${beta.cookie}; ${betaStart.flowCookie}` } },
      );
      await expectScrubbedDriveRedirect(failedReplay, "drive_expired", [betaState, "fresh-after-failure"]);
      expect(providerCalls).toHaveLength(callsBeforeFailedReplay);

      const credentialRetryStart = await driveConsentStart(unit, beta.cookie);
      const credentialRetryState = credentialRetryStart.state;
      const stateBindingId = (state: string) => (JSON.parse(Buffer.from(state.split(".")[0]!, "base64url").toString("utf8")) as { bid: string }).bid;
      expect(stateBindingId(credentialRetryState)).toBe(failedBinding.vault_binding_id);
      const originalSetRaw = betaRuntime.settings.setRaw.bind(betaRuntime.settings);
      const setRaw = vi.spyOn(betaRuntime.settings, "setRaw").mockImplementation((key, value) => {
        if (key === "google_drive_vault_oauth_refresh_token") throw new Error("encrypted credential authority unavailable");
        originalSetRaw(key, value);
      });
      const credentialFailure = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=credential-fail&state=${encodeURIComponent(credentialRetryState)}`,
        { headers: { cookie: `${beta.cookie}; ${credentialRetryStart.flowCookie}` } },
      );
      await expectScrubbedDriveRedirect(credentialFailure, "drive_exchange", [credentialRetryState, "credential-fail"]);
      expect(unit.customerAccounts.resolveForTenantId("tenant-beta")).toMatchObject({
        vault_binding_id: failedBinding.vault_binding_id,
        vault_binding_status: "error",
        vault_drive_folder_id: null,
        vault_drive_manifest_file_id: null,
      });
      expect(opened).toHaveLength(3);
      setRaw.mockRestore();

      const bootstrapRetryStart = await driveConsentStart(unit, beta.cookie);
      failNextBootstrap = true;
      const bootstrapFailure = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=bootstrap-fail&state=${encodeURIComponent(bootstrapRetryStart.state)}`,
        { headers: { cookie: `${beta.cookie}; ${bootstrapRetryStart.flowCookie}` } },
      );
      await expectScrubbedDriveRedirect(bootstrapFailure, "drive_bootstrap", [bootstrapRetryStart.state, "bootstrap-fail"]);
      expect(unit.customerAccounts.resolveForTenantId("tenant-beta")).toMatchObject({
        vault_binding_id: failedBinding.vault_binding_id,
        vault_binding_status: "error",
      });

      const successfulRetryStart = await driveConsentStart(unit, beta.cookie);
      const successfulRetryState = successfulRetryStart.state;
      expect(stateBindingId(successfulRetryState)).toBe(failedBinding.vault_binding_id);
      const successfulRetry = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=beta-drive&state=${encodeURIComponent(successfulRetryState)}`,
        { headers: { cookie: `${beta.cookie}; ${successfulRetryStart.flowCookie}` } },
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
        { headers: { cookie: `${beta.cookie}; ${successfulRetryStart.flowCookie}` } },
      );
      await expectScrubbedDriveRedirect(replay, "drive_expired", [successfulRetryState, "replay"]);
      expect(providerCalls).toHaveLength(callsBeforeReplay);
      expect(unit.customerAccounts.resolveForTenantId("tenant-beta")).toMatchObject({
        vault_binding_id: failedBinding.vault_binding_id,
        vault_binding_status: "ready",
      });
    } finally {
      await unit.close();
    }
  });

  it("rejects a Drive callback when the active account changes after consent starts", async () => {
    const dataDir = await tempDir();
    const tenants = createMemoryTenantStore([{ token: "swap-token", tenant: { id: "tenant-swap" } }]);
    const unit = createZenodUnit({
      dataDir,
      tenantStore: tenants,
      env: {
        NODE_ENV: "test",
        ACCOUNT_STATE_SECRET: "gdv7-account-swap-secret",
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
              id: code, login: `${code}@example.test`, email: `${code}@example.test`, email_verified: true,
            }),
          },
        },
      },
    });
    const providerCalls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      providerCalls.push(String(input));
      throw new Error("provider must not be called after an account swap");
    }));
    try {
      const session = await googleSession(unit, "google-swap");
      unit.customerAccounts.upsert("checkout-a", {
        account_id: "account-a", user_id: session.userId, tenant_id: "tenant-swap",
        tenant_slug: "tenant-swap", subscription_status: "active",
        claimed_at: "2026-08-29T20:00:00.000Z", checkout_completed_at: "2026-08-29T20:00:00.000Z",
      });
      unit.customerTokenVault.put("account-a", "swap-token");
      const runtime = unit.runtimes.forTenantStorage("tenant-swap", unit.storage.forTenant({ id: "tenant-swap" }));
      runtime.settings.set("google_oauth_client_id", "drive-client");
      runtime.settings.set("google_oauth_client_secret", "drive-secret");
      const start = await driveConsentStart(unit, session.cookie);
      expect(start.response.status).toBe(200);

      unit.customerAccounts.upsert("checkout-b", {
        account_id: "account-b", user_id: session.userId, tenant_id: "tenant-swap",
        tenant_slug: "tenant-swap", subscription_status: "active",
        claimed_at: "2099-08-29T20:00:00.000Z", checkout_completed_at: "2099-08-29T20:00:00.000Z",
      });
      const callback = await unit.app.request(
        `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=swap&state=${encodeURIComponent(start.state)}`,
        { headers: { cookie: `${session.cookie}; ${start.flowCookie}` } },
      );
      await expectScrubbedDriveRedirect(callback, "drive_expired", [start.state, "swap"]);
      expect(providerCalls).toHaveLength(0);
      expect(unit.customerAccounts.get("checkout-a")).toMatchObject({ vault_provider: null, vault_binding_id: null });
      expect(unit.customerAccounts.get("checkout-b")).toMatchObject({ vault_provider: null, vault_binding_id: null });
    } finally {
      await unit.close();
    }
  });

  it("requires a fresh Drive start when the canonical checkout session changes", async () => {
    for (const cancelOriginal of [false, true]) {
      const dataDir = await tempDir();
      const tenantId = `tenant-session-${cancelOriginal ? "canceled" : "active"}`;
      const token = `token-${cancelOriginal}`;
      const tenants = createMemoryTenantStore([{ token, tenant: { id: tenantId } }]);
      const unit = createZenodUnit({
        dataDir,
        tenantStore: tenants,
        env: {
          NODE_ENV: "test", ACCOUNT_STATE_SECRET: `gdv7-session-${cancelOriginal}`,
          CHASSIS_VAULT_MASTER_KEY: MASTER_KEY, GOOGLE_OIDC_CLIENT_ID: "identity-client",
          GOOGLE_OIDC_CLIENT_SECRET: "identity-secret", CUSTOMER_APP_URL: "https://cloud.zenod.test",
        },
        customer: { identityProviders: { google: {
          authorizeUrl: (state) => `https://accounts.google.test/auth?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async (code) => ({
            id: code, login: `${code}@example.test`, email: `${code}@example.test`, email_verified: true,
          }),
        } } },
      });
      const providerCalls: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
        providerCalls.push(String(input));
        throw new Error("provider must not be called for stale checkout state");
      }));
      try {
        const session = await googleSession(unit, `google-session-${cancelOriginal}`);
        unit.customerAccounts.upsert("checkout-original", {
          account_id: "account-shared", user_id: session.userId, tenant_id: tenantId,
          tenant_slug: tenantId, subscription_status: "active",
          claimed_at: "2026-08-29T20:00:00.000Z", checkout_completed_at: "2026-08-29T20:00:00.000Z",
        });
        unit.customerTokenVault.put("account-shared", token);
        const runtime = unit.runtimes.forTenantStorage(tenantId, unit.storage.forTenant({ id: tenantId }));
        runtime.settings.set("google_oauth_client_id", "drive-client");
        runtime.settings.set("google_oauth_client_secret", "drive-secret");
        const staleStart = await driveConsentStart(unit, session.cookie);
        expect(staleStart.response.status).toBe(200);
        if (cancelOriginal) {
          unit.customerAccounts.upsert("checkout-original", { subscription_status: "canceled" });
        }
        unit.customerAccounts.upsert("checkout-new", {
          account_id: "account-shared", user_id: session.userId, tenant_id: tenantId,
          tenant_slug: tenantId, subscription_status: "active",
          claimed_at: "2099-08-29T20:00:00.000Z", checkout_completed_at: "2099-08-29T20:00:00.000Z",
        });

        const staleCallback = await unit.app.request(
          `https://cloud.zenod.test/api/vault/drive/oauth/callback?code=stale&state=${encodeURIComponent(staleStart.state)}`,
          { headers: { cookie: `${session.cookie}; ${staleStart.flowCookie}` } },
        );
        await expectScrubbedDriveRedirect(staleCallback, "drive_expired", [staleStart.state, "stale"]);
        expect(providerCalls).toHaveLength(0);
        expect(unit.customerAccounts.get("checkout-original")).toMatchObject({ vault_provider: null, vault_binding_id: null });
        expect(unit.customerAccounts.get("checkout-new")).toMatchObject({ vault_provider: null, vault_binding_id: null });

        const freshStart = await driveConsentStart(unit, session.cookie);
        expect(freshStart.response.status).toBe(200);
        const freshState = JSON.parse(Buffer.from(freshStart.state.split(".")[0]!, "base64url").toString("utf8")) as { sid: string };
        expect(freshState.sid).toBe("checkout-new");
      } finally {
        await unit.close();
      }
    }
  });

  it("fails hosted Drive credential authority closed for conflicting tenant ownership rows", async () => {
    const dataDir = await tempDir();
    const tenants = createMemoryTenantStore([{ token: "alpha-token", tenant: { id: "tenant-alpha" } }]);
    const unit = createZenodUnit({
      dataDir,
      tenantStore: tenants,
      env: {
        NODE_ENV: "test",
        ACCOUNT_STATE_SECRET: "gdv7-conflicting-owner-secret",
        CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
      },
    });
    try {
      unit.customerAccounts.upsert("owner-a", {
        account_id: "account-a", user_id: "user-a", tenant_id: "tenant-alpha", subscription_status: "active",
      });
      unit.customerAccounts.upsert("owner-b", {
        account_id: "account-b", user_id: "user-b", tenant_id: "tenant-alpha", subscription_status: "active",
      });
      unit.customerTokenVault.put("account-a", "alpha-token");
      const runtime = unit.runtimes.forTenantStorage("tenant-alpha", unit.storage.forTenant({ id: "tenant-alpha" }));
      runtime.settings.set("google_oauth_client_id", "drive-client");
      runtime.settings.set("google_oauth_client_secret", "drive-secret");

      expect(runtime.settings.googleDriveOAuthAuthority()).toEqual({ mode: "hosted-managed", credentials: null });
    } finally {
      await unit.close();
    }
  });
});
