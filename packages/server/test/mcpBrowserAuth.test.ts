import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMemoryTenantStore } from "@zenod/mcp-chassis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createZenodUnit } from "../src/zenodUnit.js";

const ORIGIN = "https://cloud.zenod.dev";
const VERIFIER = "a-deterministic-pkce-verifier-for-browser-consent-testing";
const REDIRECT = "https://agent.example/callback";

describe("hosted MCP browser authorization", () => {
  let dir: string;
  let unit: ReturnType<typeof createZenodUnit>;
  let tenants: ReturnType<typeof createMemoryTenantStore>;
  let cookie: string;
  let otherCookie: string;
  let params: URLSearchParams;

  const request = (path: string, init?: RequestInit) => unit.app.request(new URL(path, ORIGIN), init);
  const cookieHeaders = (value = cookie) => ({ cookie: value });
  const decision = (nonce: string, values: Record<string, string> = {}, sessionCookie = cookie, extraHeaders: Record<string, string> = {}) => request("/oauth/authorize/decision", {
    method: "POST",
    headers: { ...cookieHeaders(sessionCookie), origin: ORIGIN, ...extraHeaders },
    body: new URLSearchParams({ ...Object.fromEntries(params), consent: nonce, decision: "approve", ...values }),
  });
  const consent = async () => {
    const response = await request(`/oauth/authorize?${params}`, { headers: cookieHeaders() });
    expect(response.status).toBe(200);
    const html = await response.text();
    return { html, nonce: html.match(/name="consent" value="([^"]+)"/)![1]! };
  };
  const exchange = (code: string, verifier = VERIFIER) => request("/oauth/token", {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: params.get("client_id")!, resource: `${ORIGIN}/mcp` }),
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-mcp-browser-"));
    const webDist = join(dir, "web");
    await mkdir(webDist);
    await writeFile(join(webDist, "index.html"), "<html>SPA fallback</html>");
    tenants = createMemoryTenantStore([
      { token: "private-one", tenant: { id: "tenant-one", name: "My brain" } },
      { token: "private-two", tenant: { id: "tenant-two", name: "Other brain" } },
    ]);
    unit = createZenodUnit({
      dataDir: dir, webDist, tenantStore: tenants,
      env: { NODE_ENV: "test", ACCOUNT_STATE_SECRET: "browser-test-secret", CHASSIS_VAULT_MASTER_KEY: "11".repeat(32), DOMAIN: ORIGIN },
      customer: { identity: {
        authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
        exchangeAndGetUser: async (code) => ({ id: code === "other" ? 99 : 42, login: code === "other" ? "other" : "octocat", email: null }),
      } },
    });
    for (const [id, tenantId, token] of [[42, "tenant-one", "private-one"], [99, "tenant-two", "private-two"]] as const) {
      unit.customerAccounts.upsert(`account-${id}`, { account_id: `github-${id}`, github_id: id, github_login: `user-${id}`, tier: "monthly", subscription_status: "active", tenant_id: tenantId });
      unit.customerTokenVault.put(`github-${id}`, token);
    }
    async function signIn(code: string) {
      const login = await request("/auth/signin");
      const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
      const callback = await request(`/auth/github/callback?${new URLSearchParams({ code, state })}`);
      return callback.headers.getSetCookie().find((v) => v.startsWith("zenod_customer_session="))!.split(";")[0]!;
    }
    cookie = await signIn("owner");
    otherCookie = await signIn("other");
    const registered = await request("/oauth/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Grok Bot", redirect_uris: [REDIRECT] }),
    });
    expect(registered.status).toBe(201);
    const { client_id } = await registered.json() as { client_id: string };
    params = new URLSearchParams({ response_type: "code", client_id, redirect_uri: REDIRECT, code_challenge: createHash("sha256").update(VERIFIER).digest("base64url"), code_challenge_method: "S256", scope: "mcp", resource: `${ORIGIN}/mcp`, state: "agent-state" });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await unit?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("uses the existing browser session, reveals no tenant credential, and issues a tenant-bound MCP grant", async () => {
    const { html, nonce } = await consent();
    expect(html).toContain("Grok Bot");
    expect(html).toContain("octocat");
    expect(html).toContain("My brain");
    expect(html).toContain(">Allow</button>");
    expect(html).not.toMatch(/Tenant token|name="token"|private-one|private-two/);
    // A forged token/tenant in the form cannot override the browser identity.
    const approved = await decision(nonce, { token: "private-two", tenant_id: "tenant-two" });
    expect(approved.status).toBe(302);
    expect(approved.headers.get("cache-control")).toBe("no-store");
    const callback = new URL(approved.headers.get("location")!);
    expect(callback.searchParams.get("state")).toBe("agent-state");
    const tokenResponse = await exchange(callback.searchParams.get("code")!);
    expect(tokenResponse.status).toBe(200);
    const { access_token } = await tokenResponse.json() as { access_token: string };
    expect((await exchange(callback.searchParams.get("code")!)).status).toBe(400);
    expect((await decision(nonce)).status).toBe(403);

    const server = serve({ fetch: unit.app.fetch, hostname: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const client = new Client({ name: "browser-test", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${access_token}` } } }));
      expect((await client.listTools()).tools.some((tool) => tool.name === "search_memory")).toBe(true);
      expect(unit.runtimes.get("tenant-one")).toBeTruthy();
      expect(unit.runtimes.get("tenant-two")).toBeNull();
      const restricted = await fetch(`${base}/mcp`, {
        method: "POST", headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_llm_timeline", arguments: {} } }),
      });
      expect(restricted.status).toBe(403);
      // Verify entitlement changes apply to an already-issued OAuth token.
      tenants.setTenantStatus("tenant-one", "suspended");
      expect((await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${access_token}` } })).status).toBe(401);
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("resumes the exact consent request after sign-in and binds that sign-in to its browser", async () => {
    const authorization = `/oauth/authorize?${params}`;
    const response = await request(authorization);
    expect(response.status).toBe(302);
    const signinUrl = new URL(response.headers.get("location")!, ORIGIN);
    expect(signinUrl.pathname).toBe("/auth/mcp/signin");
    expect(signinUrl.searchParams.get("return_to")).toBe(authorization);
    const choice = await request(signinUrl.toString());
    expect(await choice.text()).toContain("Continue with GitHub");
    const login = await request(`/auth/github/start?${new URLSearchParams({ return_to: authorization })}`);
    const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
    const callbackPath = `/auth/github/callback?${new URLSearchParams({ code: "owner", state })}`;
    expect((await request(callbackPath)).status).toBe(400);
    const bindingCookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const callback = await request(callbackPath, { headers: cookieHeaders(bindingCookie) });
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${ORIGIN}${authorization}`);
    const session = callback.headers.getSetCookie().find((v) => v.startsWith("zenod_customer_session="))!.split(";")[0]!;
    const resumed = await request(callback.headers.get("location")!, { headers: cookieHeaders(session) });
    expect(resumed.status).toBe(200);
    expect(await resumed.text()).toContain(">Allow</button>");
  });

  it("rejects absent, changed, expired, cross-origin, and cross-account consent", async () => {
    const { nonce } = await consent();
    expect((await decision("")).status).toBe(403);
    expect((await decision(nonce, { state: "different-request" })).status).toBe(403);
    expect((await decision(nonce, { code_challenge: "changed" })).status).toBe(403);
    expect((await decision(nonce, {}, otherCookie)).status).toBe(403);
    expect((await decision(nonce, {}, cookie, { origin: "https://attacker.example" })).status).toBe(403);
    expect((await decision(nonce, { token: "private-one" }, "")).status).toBe(401);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect((await decision(nonce)).status).toBe(403);
  });

  it("denies cleanly without minting a code", async () => {
    const { nonce } = await consent();
    const denied = await decision(nonce, { decision: "deny" });
    const url = new URL(denied.headers.get("location")!);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("agent-state");
    expect(url.searchParams.has("code")).toBe(false);
    expect((await decision(nonce)).status).toBe(403);
  });

  it("rechecks workspace entitlement and token binding before approval", async () => {
    const { nonce } = await consent();
    unit.customerTokenVault.put("github-42", "private-two");
    expect((await decision(nonce)).status).toBe(403);
    unit.customerTokenVault.put("github-42", "private-one");
    tenants.setTenantStatus("tenant-one", "suspended");
    expect((await decision(nonce)).status).toBe(403);
    tenants.setTenantStatus("tenant-one", "active");
    unit.customerAccounts.upsert("account-42", { subscription_status: "canceled" });
    expect((await decision(nonce)).status).toBe(403);
    expect((await request(`/oauth/authorize?${params}`, { headers: cookieHeaders() })).status).toBe(403);
  });

  it("enforces PKCE on the resulting code", async () => {
    const { nonce } = await consent();
    const approved = await decision(nonce);
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    expect((await exchange(code, "wrong-verifier")).status).toBe(400);
  });

  it.each(["https://evil.example/", "//evil.example/", "/oauth/authorize/../../evil", "/oauth/authorize\\evil", "/oauth/authorize#evil"])("does not accept an unsafe sign-in return path: %s", async (returnTo) => {
    const login = await request(`/auth/signin?${new URLSearchParams({ return_to: returnTo })}`);
    const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
    const callback = await request(`/auth/github/callback?${new URLSearchParams({ code: "owner", state })}`);
    expect(callback.headers.get("location")).toBe(`${ORIGIN}/app`);
  });

  it("publishes one credential-free URL and serves discovery ahead of the SPA", async () => {
    const challenge = await request("/mcp");
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get("www-authenticate")).toContain("oauth-protected-resource");
    const account = await request("/api/console/account", { headers: cookieHeaders() });
    expect(await account.json()).toMatchObject({ mcp_url: `${ORIGIN}/mcp` });
    const metadata = await request("/.well-known/oauth-protected-resource/mcp");
    expect(await metadata.json()).toMatchObject({ resource: `${ORIGIN}/mcp` });
    const server = await request("/.well-known/oauth-authorization-server");
    expect(await server.json()).toMatchObject({ authorization_endpoint: `${ORIGIN}/oauth/authorize` });
  });
});
