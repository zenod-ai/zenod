import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Runtime } from "../src/runtime.js";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

describe("OAuth 2.1 provider", () => {
  let dir: string;
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-oauth-"));
    runtime = new Runtime(dir);
    runtime.settings.setAdminPassword("correct-horse-battery");
    app = createApp(runtime);
  });

  afterEach(async () => {
    runtime.close();
    runtime.oauth.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("serves discovery metadata", async () => {
    const pr = await (await app.request("/.well-known/oauth-protected-resource")).json();
    expect(pr.authorization_servers).toHaveLength(1);
    expect(pr.resource).toMatch(/\/mcp$/);

    const as = await (await app.request("/.well-known/oauth-authorization-server")).json();
    expect(as.registration_endpoint).toMatch(/\/oauth\/register$/);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.grant_types_supported).toContain("refresh_token");
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
  });

  it("challenges unauthenticated /mcp with WWW-Authenticate", async () => {
    const res = await app.request("/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
  });

  it("runs the full DCR → authorize → token → use → refresh flow", async () => {
    // 1. Dynamic Client Registration
    const reg = await app.request("/oauth/register", {
      method: "POST",
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT] }),
    });
    expect(reg.status).toBe(201);
    const { client_id } = await reg.json();
    expect(client_id).toMatch(/^zc_/);

    // 2. Authorize — GET renders the consent/login page
    const { verifier, challenge } = pkce();
    const authQuery = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
      resource: "https://app.example.com/mcp",
      scope: "mcp",
    });
    const page = await app.request(`/oauth/authorize?${authQuery}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("wants to connect");

    // 2b. Approve with the admin password
    const decision = await app.request("/oauth/authorize/decision", {
      method: "POST",
      body: new URLSearchParams({
        client_id,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "xyz",
        resource: "https://app.example.com/mcp",
        scope: "mcp",
        password: "correct-horse-battery",
        decision: "approve",
      }),
    });
    expect(decision.status).toBe(302);
    const loc = new URL(decision.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get("state")).toBe("xyz");
    expect(loc.searchParams.get("iss")).toBeTruthy();
    const code = loc.searchParams.get("code")!;
    expect(code).toBeTruthy();

    // 3. Token exchange with PKCE verifier
    const tokenRes = await app.request("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
        client_id,
      }),
    });
    expect(tokenRes.status).toBe(200);
    const tok = await tokenRes.json();
    expect(tok.token_type).toBe("Bearer");
    expect(tok.access_token).toBeTruthy();
    expect(tok.refresh_token).toBeTruthy();

    // 4. The OAuth access token is accepted on /mcp (auth passes — not 401)
    const mcp = await app.request("/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(mcp.status).not.toBe(401);

    // 5. Refresh rotates the access token
    const refreshed = await app.request("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token }),
    });
    expect(refreshed.status).toBe(200);
    const tok2 = await refreshed.json();
    expect(tok2.access_token).toBeTruthy();
    expect(tok2.access_token).not.toBe(tok.access_token);

    // the grant shows up for the UI, and revoke clears it
    expect(runtime.oauth.listTokens().some((t) => t.clientId === client_id)).toBe(true);
    runtime.oauth.revokeClient(client_id);
    expect(runtime.oauth.listTokens()).toHaveLength(0);
  });

  it("rejects a bad PKCE verifier", async () => {
    const reg = await app.request("/oauth/register", {
      method: "POST",
      body: JSON.stringify({ client_name: "X", redirect_uris: [REDIRECT] }),
    });
    const { client_id } = await reg.json();
    const { challenge } = pkce();
    const decision = await app.request("/oauth/authorize/decision", {
      method: "POST",
      body: new URLSearchParams({
        client_id,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "s",
        resource: "https://app.example.com/mcp",
        scope: "mcp",
        password: "correct-horse-battery",
        decision: "approve",
      }),
    });
    const code = new URL(decision.headers.get("location")!).searchParams.get("code")!;

    const tokenRes = await app.request("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: "the-wrong-verifier",
        redirect_uri: REDIRECT,
        client_id,
      }),
    });
    expect(tokenRes.status).toBe(400);
    expect((await tokenRes.json()).error).toBe("invalid_grant");
  });

  it("rejects an unregistered redirect_uri", async () => {
    const reg = await app.request("/oauth/register", {
      method: "POST",
      body: JSON.stringify({ client_name: "X", redirect_uris: [REDIRECT] }),
    });
    const { client_id } = await reg.json();
    const { challenge } = pkce();
    const q = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: "https://evil.example.com/steal",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const page = await app.request(`/oauth/authorize?${q}`);
    expect(page.status).toBe(400);
  });

  it("denies approval with a wrong password", async () => {
    const reg = await app.request("/oauth/register", {
      method: "POST",
      body: JSON.stringify({ client_name: "X", redirect_uris: [REDIRECT] }),
    });
    const { client_id } = await reg.json();
    const { challenge } = pkce();
    const decision = await app.request("/oauth/authorize/decision", {
      method: "POST",
      body: new URLSearchParams({
        client_id,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "s",
        resource: "r",
        scope: "mcp",
        password: "nope",
        decision: "approve",
      }),
    });
    expect(decision.status).toBe(401);
    expect(await decision.text()).toContain("Wrong password");
  });
});
