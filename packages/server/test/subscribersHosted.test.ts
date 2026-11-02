import { createHash, createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createMemoryTenantStore } from "@zenod/mcp-chassis";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createZenodUnit } from "../src/zenodUnit.js";

// agent_team E42-S22 on the real hosted unit: Sign in with Zenod from a signed-in browser, the zvn_ token's reach
// (subscriber API yes, MCP no), signed delivery to a receiver on the operator's private origin, the Subscribers tab
// through the session bridge, Remove, and the switch.

const ORIGIN = "https://cloud.zenod.dev";
const REDIRECT = "https://team.alpha9.io/api/connections/zenod/callback";
const VERIFIER = "e42-s22-hosted-pkce-verifier-0123456789abcdefghijklmnop";

type Received = { headers: Record<string, string | string[] | undefined>; body: string };

describe("Subscribers on hosted Zenod", () => {
  let dir: string;
  let unit: ReturnType<typeof createZenodUnit>;
  let cookie: string;
  let receiver: Server;
  let receiverOrigin: string;
  const received: Received[] = [];

  const request = (path: string, init?: RequestInit) => unit.app.request(new URL(path, ORIGIN), init);

  async function boot(subscribers: "on" | "off") {
    dir = await mkdtemp(join(tmpdir(), "zenod-subscribers-hosted-"));
    const webDist = join(dir, "web");
    await mkdir(webDist);
    await writeFile(join(webDist, "index.html"), "<html>SPA fallback</html>");
    unit = createZenodUnit({
      dataDir: dir, webDist,
      tenantStore: createMemoryTenantStore([{ token: "private-one", tenant: { id: "tenant-one", name: "My brain" } }]),
      env: {
        NODE_ENV: "test", ACCOUNT_STATE_SECRET: "subscribers-test-secret", CHASSIS_VAULT_MASTER_KEY: "11".repeat(32), DOMAIN: ORIGIN,
        ZENOD_SUBSCRIBERS: subscribers,
        ZENOD_SUBSCRIBERS_PRIVATE_ORIGINS: receiverOrigin,
        ZENOD_SUBSCRIBERS_PRIVATE_TENANTS: "tenant-one",
      },
      customer: { identity: {
        authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
        exchangeAndGetUser: async () => ({ id: 42, login: "octocat", email: "jordi@alpha9.io" }),
      } },
    });
    unit.customerAccounts.upsert("account-42", { account_id: "github-42", github_id: 42, github_login: "octocat", tier: "monthly", subscription_status: "active", tenant_id: "tenant-one" });
    unit.customerTokenVault.put("github-42", "private-one");
    const login = await request("/auth/signin");
    const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
    const callback = await request(`/auth/github/callback?${new URLSearchParams({ code: "owner", state })}`);
    cookie = callback.headers.getSetCookie().find((v) => v.startsWith("zenod_customer_session="))!.split(";")[0]!;
  }

  async function connect(): Promise<string> {
    const registered = await request("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Epic Team", redirect_uris: [REDIRECT] }) });
    const { client_id } = await registered.json() as { client_id: string };
    const params = new URLSearchParams({ response_type: "code", client_id, redirect_uri: REDIRECT, state: "s1", code_challenge: createHash("sha256").update(VERIFIER).digest("base64url"), code_challenge_method: "S256", scope: "voice_notes.read voice_notes.subscribe", subscriber_kind: "agent_team", subscriber_product: "EpicSpine" });
    const page = await request(`/oauth/authorize?${params}`, { headers: { cookie } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Epic Team wants to receive your voice notes");
    expect(html).toContain("jordi@alpha9.io");
    const form = new URLSearchParams();
    for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) form.set(m[1]!, m[2]!.replace(/&amp;/g, "&"));
    form.set("decision", "approve");
    const approved = await request("/oauth/subscribers/decision", { method: "POST", headers: { cookie, origin: ORIGIN }, body: form });
    expect(approved.status).toBe(302);
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const token = await request("/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id }) });
    expect(token.status).toBe(200);
    return (await token.json() as { access_token: string }).access_token;
  }

  beforeEach(async () => {
    received.length = 0;
    receiver = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    receiverOrigin = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await unit?.close();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  it("connects a team, delivers a signed pointer it can verify, keeps the token off MCP, and Remove cuts it off", async () => {
    await boot("on");
    const token = await connect();
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    // The voice-note token is useless on MCP and on the workspace API.
    expect((await request("/mcp", { method: "POST", headers: auth, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).status).toBe(401);
    expect([401, 403]).toContain((await request("/api/settings", { headers: auth })).status);

    const created = await request("/api/subscribers/v1/subscriptions", { method: "POST", headers: auth, body: JSON.stringify({ url: `${receiverOrigin}/api/hooks/zenod/c1`, event: "voice_note.captured", name: "Epic Team" }) });
    expect(created.status).toBe(201);
    const { subscription, signing_secret } = await created.json() as { subscription: { id: string }; signing_secret: string };

    // A stored voice note reaches the receiver as a signed pointer.
    const runtime = unit.runtimes.get("tenant-one")!;
    runtime.subscriberDispatcher!.onEntryStored({ evidenceRef: "Log/2026-11-02.md#^e-abc", contentType: "voice_note", source: "whatsapp" });
    await runtime.subscriberDispatcher!.idle();
    expect(received).toHaveLength(1);
    const [{ headers, body }] = received;
    const [t, v1] = String(headers["x-zenod-signature"]).split(",").map((part) => part.split("=")[1]!);
    expect(v1).toBe(createHmac("sha256", signing_secret).update(`${t}.${body}`).digest("hex"));
    expect(Math.abs(Date.now() / 1000 - Number(t))).toBeLessThan(300);
    expect(JSON.parse(body)).toMatchObject({ type: "voice_note.captured", subscription_id: subscription.id, note: { id: "Log/2026-11-02.md#^e-abc", url: `${ORIGIN}/api/subscribers/v1/notes?id=Log%2F2026-11-02.md%23%5Ee-abc` } });

    // The Subscribers tab (session bridge) lists it with its delivery, and can add a webhook by hand.
    const tab = await request("/api/subscribers", { headers: { cookie } });
    expect(tab.status).toBe(200);
    const listed = await tab.json() as { subscribers: Array<Record<string, unknown>> };
    expect(listed.subscribers[0]).toMatchObject({ name: "Epic Team", kind: "agent_team", product: "EpicSpine", via: "oauth", last_delivery: { ok: true, http_status: 200 } });
    const manual = await request("/api/subscribers", { method: "POST", headers: { cookie, "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ url: `${receiverOrigin}/n8n`, event: "voice_note.captured", name: "My n8n flow" }) });
    expect(manual.status).toBe(201);
    expect(await manual.json()).toMatchObject({ subscription: { via: "manual", created_by: { email: "jordi@alpha9.io" } }, test_delivery: { ok: true, test: true } });
    // A bearer caller cannot forge the "added by" label.
    expect(received.at(-1)!.headers[ "x-zenod-actor"]).toBeUndefined();

    // Remove on the tab revokes the team's token at once.
    expect((await request(`/api/subscribers/${subscription.id}`, { method: "DELETE", headers: { cookie, origin: ORIGIN } })).status).toBe(204);
    expect((await request("/api/subscribers/v1/me", { headers: auth })).status).toBe(401);
  });

  it("stays dark while the switch is off: 503 everywhere, MCP OAuth unchanged", async () => {
    await boot("off");
    expect((await request("/api/subscribers", { headers: { cookie } })).status).toBe(503);
    expect((await request("/api/subscribers/v1/me", { headers: { authorization: "Bearer zvn_x" } })).status).toBe(503);
    expect(unit.runtimes.get("tenant-one")?.subscribers ?? null).toBeNull();
    const registered = await request("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT] }) });
    const { client_id } = await registered.json() as { client_id: string };
    const mcpConsent = await request(`/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id, redirect_uri: REDIRECT, code_challenge: "x".repeat(43), code_challenge_method: "S256", scope: "mcp", state: "s" })}`, { headers: { cookie } });
    expect(mcpConsent.status).toBe(200);
    expect(await mcpConsent.text()).toContain("Connect your agent");
  });
});
