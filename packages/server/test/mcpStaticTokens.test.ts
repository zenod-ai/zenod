import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { createMemoryTenantStore, redactSecretString } from "@zenod/mcp-chassis";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FailedAttemptLimiter,
  generateMcpToken,
  hashMcpToken,
  maskMcpToken,
  McpTokenStore,
} from "../src/mcpTokens.js";
import { createZenodUnit } from "../src/zenodUnit.js";

const ORIGIN = "https://cloud.zenod.dev";
const VERIFIER = "a-deterministic-pkce-verifier-for-static-mcp-token-testing";
const REDIRECT = "https://agent.example/callback";
const CHALLENGE = `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="mcp"`;

describe("static MCP tokens on /mcp", () => {
  let dir: string;
  let unit: ReturnType<typeof createZenodUnit>;
  let tenants: ReturnType<typeof createMemoryTenantStore>;
  let cookie: string;
  let otherCookie: string;

  const request = (path: string, init?: RequestInit) => unit.app.request(new URL(path, ORIGIN), init);
  const api = (path: string, method: string, sessionCookie = cookie, body?: unknown) =>
    request(path, {
      method,
      headers: { cookie: sessionCookie, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const createToken = async (label = "Work laptop", sessionCookie = cookie) => {
    const res = await api("/api/account/mcp-tokens", "POST", sessionCookie, { label });
    expect(res.status).toBe(201);
    return (await res.json()) as { token: string; id: string; preview: string; label: string };
  };
  const rpc = (base: string, authorization: string | null, method: string, id = 1) =>
    fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params: method === "initialize"
          ? { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } }
          : {},
      }),
    });
  const mcpRequest = (authorization?: string, headers: Record<string, string> = {}) =>
    request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}), ...headers },
      body: "{}",
    });

  async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
    const server = serve({ fetch: unit.app.fetch, hostname: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-static-mcp-"));
    const webDist = join(dir, "web");
    await mkdir(webDist);
    await writeFile(join(webDist, "index.html"), "<html>SPA fallback</html>");
    tenants = createMemoryTenantStore([
      { token: "private-one", tenant: { id: "tenant-one", name: "My brain" } },
      { token: "private-two", tenant: { id: "tenant-two", name: "Other brain" } },
    ]);
    unit = createZenodUnit({
      dataDir: dir,
      webDist,
      tenantStore: tenants,
      env: { NODE_ENV: "test", ACCOUNT_STATE_SECRET: "static-test-secret", CHASSIS_VAULT_MASTER_KEY: "11".repeat(32), DOMAIN: ORIGIN },
      customer: {
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async (code) => ({ id: code === "other" ? 99 : 42, login: code === "other" ? "other" : "octocat", email: null }),
        },
      },
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
  });

  afterEach(async () => {
    await unit?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("requires the dashboard session to create, list and revoke", async () => {
    expect((await request("/api/account/mcp-tokens")).status).toBe(401);
    expect((await request("/api/account/mcp-tokens", { method: "POST", body: JSON.stringify({ label: "x" }) })).status).toBe(401);
    expect((await request("/api/account/mcp-tokens/abc", { method: "DELETE" })).status).toBe(401);
    expect((await api("/api/account/mcp-tokens", "POST", cookie, { label: "  " })).status).toBe(400);
  });

  it("creates labelled tokens (plaintext once), lists masked previews, and keeps several per account", async () => {
    const first = await createToken("Work laptop");
    const second = await createToken("CI");
    expect(first.token).toMatch(/^zmt_[A-Za-z0-9_-]{43}$/);
    expect(first.preview).toBe(`zmt_…${first.token.slice(-4)}`);
    expect(second.token).not.toBe(first.token);

    const listedRes = await api("/api/account/mcp-tokens", "GET");
    const text = await listedRes.text();
    expect(text).not.toContain(first.token);
    expect(text).not.toContain(second.token);
    const listed = JSON.parse(text) as { tokens: Array<Record<string, unknown>> };
    expect(listed.tokens.map((t) => t.label).sort()).toEqual(["CI", "Work laptop"]);
    expect(Object.keys(listed.tokens[0]!).sort()).toEqual(["created_at", "id", "label", "last_used_at", "preview", "revoked_at"]);
    // Another account sees none of them.
    const other = (await (await api("/api/account/mcp-tokens", "GET", otherCookie)).json()) as { tokens: unknown[] };
    expect(other.tokens).toEqual([]);
  });

  it("authenticates by SHA-256 hash and holds no plaintext in the database", async () => {
    const { token } = await createToken();
    const rows = unit.customerMcpTokens.rawRowsForTests();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(JSON.stringify(rows)).not.toContain(token.slice(4));
    expect(rows[0]!.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(rows[0]!.preview).toBe(maskMcpToken(token));
    // The encrypted copy is an AES-GCM envelope, not the token.
    expect(Object.keys(JSON.parse(String(rows[0]!.token_enc))).sort()).toEqual(["ct", "iv", "tag"]);
  });

  it("lets only the owning session reveal a token, never a revoked one, with no-store", async () => {
    const { token, id } = await createToken();
    expect((await request(`/api/account/mcp-tokens/${id}/reveal`)).status).toBe(401);
    const own = await api(`/api/account/mcp-tokens/${id}/reveal`, "GET");
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toBe("no-store");
    expect(((await own.json()) as { token: string }).token).toBe(token);
    // A revealed token is the same credential that authenticates.
    expect((await mcpRequest(`Bearer ${token}`)).status).not.toBe(401);
    // Another account gets 404, identical to an unknown id.
    const cross = await api(`/api/account/mcp-tokens/${id}/reveal`, "GET", otherCookie);
    expect(cross.status).toBe(404);
    expect(cross.headers.get("cache-control")).toBe("no-store");
    expect(await cross.text()).not.toContain(token);
    expect((await api("/api/account/mcp-tokens/nope/reveal", "GET")).status).toBe(404);
    // List still shows only masked previews.
    expect(await (await api("/api/account/mcp-tokens", "GET")).text()).not.toContain(token);
    expect((await api(`/api/account/mcp-tokens/${id}`, "DELETE")).status).toBe(200);
    expect((await api(`/api/account/mcp-tokens/${id}/reveal`, "GET")).status).toBe(404);
  });

  it("accepts a valid MCP token for initialize and tools/list, and rejects the same calls without it", async () => {
    const { token } = await createToken();
    await withServer(async (base) => {
      const init = await rpc(base, `Bearer ${token}`, "initialize");
      expect(init.status).toBe(200);
      expect(await init.text()).toContain("serverInfo");
      const list = await rpc(base, `Bearer ${token}`, "tools/list", 2);
      expect(list.status).toBe(200);
      expect(await list.text()).toContain("search_memory");
      const anon = await rpc(base, null, "initialize");
      expect(anon.status).toBe(401);
      expect(anon.headers.get("www-authenticate")).toContain('scope="mcp"');
    });
    const [listed] = unit.customerMcpTokens.list("github-42");
    expect(listed!.lastUsedAt).not.toBeNull();
  });

  it("gives an MCP token the same tenant identity and permissions as an OAuth grant", async () => {
    const { token } = await createToken();
    const oauth = await oauthAccessToken();
    await withServer(async (base) => {
      for (const credential of [token, oauth]) {
        expect((await rpc(base, `Bearer ${credential}`, "tools/list")).status).toBe(200);
        // Both credentials hit the same hosted capability restriction.
        const restricted = await fetch(`${base}/mcp`, {
          method: "POST",
          headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_llm_timeline", arguments: {} } }),
        });
        expect(restricted.status).toBe(403);
      }
    });
    expect(unit.runtimes.get("tenant-one")).toBeTruthy();
    expect(unit.runtimes.get("tenant-two")).toBeNull();
  });

  it("still accepts OAuth access tokens and the tenant token unchanged", async () => {
    const oauth = await oauthAccessToken();
    await withServer(async (base) => {
      expect((await rpc(base, `Bearer ${oauth}`, "initialize")).status).toBe(200);
      expect((await rpc(base, "Bearer private-one", "initialize")).status).toBe(200);
    });
  });

  it("returns 401 for revoked, unknown, malformed and missing credentials with an unchanged challenge", async () => {
    const { token, id } = await createToken();
    expect((await api(`/api/account/mcp-tokens/${id}`, "DELETE")).status).toBe(200);
    expect((await api(`/api/account/mcp-tokens/${id}`, "DELETE")).status).toBe(404);
    const unknown = generateMcpToken();
    const cases: Array<string | undefined> = [
      `Bearer ${token}`, // revoked
      `Bearer ${unknown}`, // unknown
      "Bearer", // malformed
      "Bearer ",
      `Basic ${token}`,
      `bearer ${token}`,
      "Bearer zmt_",
      "garbage",
      undefined, // missing
    ];
    for (const authorization of cases) {
      const res = await mcpRequest(authorization, { "x-forwarded-for": `198.51.100.${cases.indexOf(authorization)}` });
      expect(res.status, String(authorization)).toBe(401);
      expect(res.headers.get("www-authenticate"), String(authorization)).toBe(CHALLENGE);
    }
  });

  it("cannot revoke another account's token", async () => {
    const { token, id } = await createToken();
    expect((await api(`/api/account/mcp-tokens/${id}`, "DELETE", otherCookie)).status).toBe(404);
    await withServer(async (base) => {
      expect((await rpc(base, `Bearer ${token}`, "initialize")).status).toBe(200);
    });
  });

  it("stops working when the account is suspended or loses its subscription", async () => {
    const { token } = await createToken();
    tenants.setTenantStatus("tenant-one", "suspended");
    expect((await mcpRequest(`Bearer ${token}`)).status).toBe(401);
    tenants.setTenantStatus("tenant-one", "active");
    unit.customerAccounts.upsert("account-42", { subscription_status: "canceled" });
    expect((await mcpRequest(`Bearer ${token}`)).status).toBe(401);
  });

  it("accepts MCP tokens only as a bearer header on /mcp", async () => {
    const { token } = await createToken();
    expect((await request(`/mcp/${token}`, { method: "POST", body: "{}" })).status).toBe(401);
    const onApi = await request("/api/overview", { headers: { authorization: `Bearer ${token}` } });
    expect(onApi.status).toBe(401);
    const onOther = await request("/api/vault", { headers: { authorization: `Bearer ${token}` } });
    expect(onOther.status).toBe(401);
  });

  it("rate-limits failed MCP-token attempts per IP with 429 and does not affect other clients", async () => {
    const { token } = await createToken();
    const bad = `Bearer ${generateMcpToken()}`;
    for (let i = 0; i < 10; i += 1) {
      expect((await mcpRequest(bad, { "x-forwarded-for": "203.0.113.7" })).status).toBe(401);
    }
    const blocked = await mcpRequest(bad, { "x-forwarded-for": "203.0.113.7" });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // Even the right token is refused from the throttled address, so it cannot be brute-forced.
    expect((await mcpRequest(`Bearer ${token}`, { "x-forwarded-for": "203.0.113.7" })).status).toBe(429);
    // Another address, and non-MCP-token bearers, are untouched.
    expect((await mcpRequest(bad, { "x-forwarded-for": "203.0.113.8" })).status).toBe(401);
    expect((await mcpRequest("Bearer not-a-zmt-token", { "x-forwarded-for": "203.0.113.7" })).status).toBe(401);
  });

  /** Full browser-consent OAuth flow, returning an access token for tenant-one. */
  async function oauthAccessToken(): Promise<string> {
    const registered = await request("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude Code", redirect_uris: [REDIRECT] }),
    });
    const { client_id } = (await registered.json()) as { client_id: string };
    const params = new URLSearchParams({
      response_type: "code", client_id, redirect_uri: REDIRECT,
      code_challenge: createHash("sha256").update(VERIFIER).digest("base64url"),
      code_challenge_method: "S256", scope: "mcp", resource: `${ORIGIN}/mcp`, state: "s",
    });
    const page = await request(`/oauth/authorize?${params}`, { headers: { cookie } });
    const nonce = (await page.text()).match(/name="consent" value="([^"]+)"/)![1]!;
    const approved = await request("/oauth/authorize/decision", {
      method: "POST",
      headers: { cookie, origin: ORIGIN },
      body: new URLSearchParams({ ...Object.fromEntries(params), consent: nonce, decision: "approve" }),
    });
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const exchanged = await request("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: REDIRECT, client_id, resource: `${ORIGIN}/mcp` }),
    });
    return ((await exchanged.json()) as { access_token: string }).access_token;
  }
});

describe("MCP token primitives", () => {
  it("generates zmt_ tokens with at least 32 random bytes", () => {
    const token = generateMcpToken();
    expect(token).toMatch(/^zmt_[A-Za-z0-9_-]{43,}$/);
    expect(Buffer.from(token.slice(4), "base64url")).toHaveLength(32);
    expect(generateMcpToken()).not.toBe(token);
  });

  it("masks to the prefix plus the last four characters", () => {
    expect(maskMcpToken("zmt_abcdefghijklmnop1234")).toBe("zmt_…1234");
  });

  it("resolves by hash, treats revoked as unknown, and throttles last_used_at writes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-mcp-store-"));
    const store = new McpTokenStore(dir, "unit-test-secret");
    try {
      const { token, record } = store.create({ accountId: "a", tenantId: "t", label: " CI ", now: 1000 });
      expect(record.label).toBe("CI");
      expect(store.resolveHash(hashMcpToken("zmt_wrong"))).toBeNull();
      expect(store.resolveHash(hashMcpToken(token), 2000)?.lastUsedAt).toBe(2000);
      expect(store.resolveHash(hashMcpToken(token), 2500)?.lastUsedAt).toBe(2000);
      expect(store.resolveHash(hashMcpToken(token), 70_000)?.lastUsedAt).toBe(70_000);
      expect(store.reveal("a", record.id)).toBe(token);
      expect(store.reveal("b", record.id)).toBeNull();
      expect(new McpTokenStore(dir, "a-different-secret").reveal("a", record.id)).toBeNull();
      expect(store.revoke("b", record.id)).toBe(false);
      expect(store.revoke("a", record.id)).toBe(true);
      expect(store.resolveHash(hashMcpToken(token))).toBeNull();
      expect(store.reveal("a", record.id)).toBeNull();
      expect(store.list("a")[0]!.revokedAt).not.toBeNull();
      expect(() => store.create({ accountId: "a", tenantId: "t", label: "  " })).toThrow();
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("limits failures in a sliding window per key", () => {
    const limiter = new FailedAttemptLimiter(3, 1000);
    expect(limiter.isBlocked("ip", 0)).toBe(false);
    limiter.recordFailure("ip", 0);
    limiter.recordFailure("ip", 100);
    limiter.recordFailure("ip", 200);
    expect(limiter.isBlocked("ip", 300)).toBe(true);
    expect(limiter.retryAfterSeconds("ip", 300)).toBe(1);
    expect(limiter.isBlocked("other", 300)).toBe(false);
    expect(limiter.isBlocked("ip", 1001)).toBe(false); // oldest failure aged out
  });

  it("redacts MCP tokens and bearer values from log strings", () => {
    const token = generateMcpToken();
    const out = redactSecretString(`failed for ${token} header Authorization: Bearer ${token} url /mcp/${token}?token=${token}`);
    expect(out).not.toContain(token);
    expect(out).not.toContain(token.slice(4));
    expect(out).toContain("zmt_[Redacted]");
  });
});
