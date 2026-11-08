import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SqliteCredentialVault } from "../src/credentialVault.js";
import type { Runtime } from "../src/runtime.js";
import { isSubscriberAuthorize, mountSubscriberApi, type SubscriberIdentity } from "../src/subscriberApi.js";
import { SubscriberDispatcher, SubscriberStore } from "../src/subscribers.js";
import { hostedCapabilityViolation } from "../src/zenodUnit.js";

// agent_team E42-S22: Sign in with Zenod (narrow voice-note grant) and /api/subscribers/v1, as the contract
// (agent_team docs/status/e42-s22-contract.md) promises the console.

const BASE = "https://cloud.zenod.dev";
const REDIRECT = "https://team.alpha9.io/api/connections/zenod/callback";
const VERIFIER = "v".repeat(64);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const SCOPE = "voice_notes.read voice_notes.subscribe";
const GRANT_TIME = Date.parse("2026-11-02T16:00:00.000Z");

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Entry = { evidenceRef: string; content: string; capturedAt: string; source: string; contentType: string };

async function harness(options: { enabled?: boolean; signedIn?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "zenod-subscriber-api-"));
  dirs.push(dir);
  const tenantDir = join(dir, "jordi");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(tenantDir, { recursive: true });
  let now = GRANT_TIME;
  const vault = new SqliteCredentialVault({ dataDir: tenantDir, tenantId: "jordi", masterKey: "2".repeat(64) });
  const store = new SubscriberStore(join(tenantDir, "subscribers.sqlite"), vault, () => now);
  const deliveries: Array<{ url: string; body: string }> = [];
  const dispatcher = new SubscriberDispatcher({
    tenantId: "jordi", store, policy: { privateOrigins: new Set(), privateTenants: new Set() }, publicBaseUrl: BASE,
    fetch: (async (url: string, init: RequestInit) => (deliveries.push({ url, body: String(init.body) }), new Response(null, { status: 200 }))) as never,
    lookup: async () => ["93.184.216.34"], retryMs: [1, 1], now: () => now, log: () => {},
  });
  const entries = new Map<string, Entry>([
    ["Log/2026-11-02.md#^e-new", { evidenceRef: "Log/2026-11-02.md#^e-new", content: "Voice note \"x\" ingested\n\nRemind the delivery manager about the demo.", capturedAt: "2026-11-02T16:12:01.000Z", source: "whatsapp", contentType: "voice_note" }],
    ["Log/2026-11-01.md#^e-old", { evidenceRef: "Log/2026-11-01.md#^e-old", content: "An older voice note.", capturedAt: "2026-11-01T09:00:00.000Z", source: "whatsapp", contentType: "voice_note" }],
    ["Log/2026-11-02.md#^e-memo", { evidenceRef: "Log/2026-11-02.md#^e-memo", content: "A private memory.", capturedAt: "2026-11-02T17:00:00.000Z", source: "mcp", contentType: "note" }],
  ]);
  const engine = {
    getEntry: vi.fn(async (ref: string) => { const e = entries.get(ref); if (!e) throw new Error("not found"); return e; }),
    searchEntries: vi.fn(async (q: { contentType?: string }) => [...entries.values()].filter((e) => !q.contentType || e.contentType === q.contentType)),
  };
  const runtime = {
    tenantId: "jordi", subscribers: store, subscriberDispatcher: dispatcher,
    getEngine: async () => engine, taskJobQueue: { recent: () => [] },
  } as unknown as Runtime;
  const identity: SubscriberIdentity = { userId: "u1", name: "Jordi Montes", email: "jordi@alpha9.io", provider: "google", tenantId: "jordi" };
  const app = new Hono();
  const api = mountSubscriberApi(app as never, {
    enabled: () => options.enabled !== false,
    dataDir: dir,
    getClient: (clientId) => clientId === "zc_team" ? { clientId, clientName: "Epic Team", redirectUris: [REDIRECT] } : null,
    identity: () => options.signedIn === false ? null : identity,
    signInUrl: (returnTo) => `/auth/mcp/signin?return_to=${encodeURIComponent(returnTo)}`,
    runtimeForTenant: (tenantId) => tenantId === "jordi" ? runtime : null,
    lookup: async () => ["93.184.216.34"],
    now: () => now,
  });
  // Everything the module does not claim falls through, here to a marker (in Zenod: MCP OAuth and the unit).
  app.all("*", (c) => c.text("fell through", 418));
  return { app, store, dispatcher, deliveries, api, dir, setNow: (ms: number) => { now = ms; } };
}

const authorizeUrl = (params: Record<string, string> = {}) => {
  const url = new URL("/oauth/authorize", BASE);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: "zc_team", redirect_uri: REDIRECT, state: "st8", code_challenge: CHALLENGE, code_challenge_method: "S256", scope: SCOPE, subscriber_kind: "agent_team", subscriber_product: "EpicSpine", ...params })) url.searchParams.set(k, v);
  return url.toString();
};

async function consent(app: Hono, decision = "approve"): Promise<URL> {
  const page = await app.request(authorizeUrl());
  expect(page.status).toBe(200);
  const html = await page.text();
  const form = new URLSearchParams();
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) form.set(match[1]!, match[2]!.replace(/&amp;/g, "&"));
  form.set("decision", decision);
  const res = await app.request(`${BASE}/oauth/subscribers/decision`, { method: "POST", body: form, headers: { origin: BASE } });
  expect(res.status).toBe(302);
  return new URL(res.headers.get("location")!);
}

async function signIn(app: Hono): Promise<{ token: string; body: Record<string, unknown> }> {
  const back = await consent(app);
  const code = back.searchParams.get("code")!;
  const res = await app.request(`${BASE}/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: "zc_team" }) });
  expect(res.status).toBe(200);
  const body = await res.json() as Record<string, unknown>;
  return { token: String(body.access_token), body };
}

const bearer = (token: string, init: RequestInit = {}) => ({ ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers as Record<string, string> ?? {}) } });

describe("Sign in with Zenod", () => {
  it("claims only voice_notes.* authorize requests", () => {
    expect(isSubscriberAuthorize(SCOPE)).toBe(true);
    expect(isSubscriberAuthorize("mcp")).toBe(false);
    expect(isSubscriberAuthorize(undefined)).toBe(false);
  });

  it("shows the consent screen: who asks, what it gets and does not get, Cancel / Allow", async () => {
    const { app } = await harness();
    const html = await (await app.request(authorizeUrl())).text();
    for (const text of ["Epic Team wants to receive your voice notes", "team.alpha9.io · an agent team on EpicSpine", "Jordi Montes", "jordi@alpha9.io · signed in with Google", "Not you?", "It will get", "A signal each time a new voice note lands in your Zenod", "It will not get", "Any right to write, change or delete in your Zenod", "<strong>Subscribers</strong>", "Cancel", "Allow", "cloud.zenod.dev/oauth/authorize · scope: voice_notes.read voice_notes.subscribe"]) {
      expect(html).toContain(text);
    }
  });

  it("sends a signed-out user to Zenod sign-in and back", async () => {
    const { app } = await harness({ signedIn: false });
    const res = await app.request(authorizeUrl());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/auth\/mcp\/signin\?return_to=%2Foauth%2Fauthorize%3F/);
  });

  it("refuses a scope that mixes in anything else, an unknown client or a foreign redirect", async () => {
    const { app } = await harness();
    const mixed = await app.request(authorizeUrl({ scope: `${SCOPE} mcp` }));
    expect(new URL(mixed.headers.get("location")!).searchParams.get("error")).toBe("invalid_scope");
    expect((await app.request(authorizeUrl({ client_id: "zc_nobody" }))).status).toBe(400);
    expect((await app.request(authorizeUrl({ redirect_uri: "https://evil.example/cb" }))).status).toBe(400);
    expect((await app.request(authorizeUrl({ scope: "mcp" }))).status).toBe(418);
  });

  it("Cancel returns access_denied; a replayed or forged form is refused", async () => {
    const { app } = await harness();
    const back = await consent(app, "deny");
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe("st8");
    const forged = await app.request(`${BASE}/oauth/subscribers/decision`, { method: "POST", body: new URLSearchParams({ client_id: "zc_team", redirect_uri: REDIRECT, code_challenge: CHALLENGE, code_challenge_method: "S256", scope: SCOPE, consent: "made-up", decision: "approve" }) });
    expect(forged.status).toBe(403);
  });

  it("Allow gives a zvc_ code; the token exchange checks PKCE and gives a zvn_ token with the account", async () => {
    const { app } = await harness();
    const back = await consent(app);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("st8");
    expect(back.searchParams.get("iss")).toBe(BASE);
    const code = back.searchParams.get("code")!;
    expect(code).toMatch(/^zvc_/);
    const wrong = await app.request(`${BASE}/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: "w".repeat(64) }) });
    expect(await wrong.json()).toMatchObject({ error: "invalid_grant" });
    // single use: the failed try consumed it
    const again = await app.request(`${BASE}/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: VERIFIER }) });
    expect(await again.json()).toMatchObject({ error: "invalid_grant" });
    const { token, body } = await signIn(app);
    expect(token).toMatch(/^zvn_/);
    expect(body).toMatchObject({ token_type: "Bearer", scope: SCOPE, account: { email: "jordi@alpha9.io", name: "Jordi Montes" } });
    expect(body).not.toHaveProperty("refresh_token");
    expect(body).not.toHaveProperty("expires_in");
    expect(String(body.grant_id)).toMatch(/^grt_/);
  });

  it("leaves MCP OAuth alone: other codes, refresh tokens and revokes fall through", async () => {
    const { app } = await harness();
    expect((await app.request(`${BASE}/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: "plain-mcp-code" }) })).status).toBe(418);
    expect((await app.request(`${BASE}/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "r" }) })).status).toBe(418);
    expect((await app.request(`${BASE}/oauth/revoke`, { method: "POST", body: new URLSearchParams({ token: "other" }) })).status).toBe(418);
  });
});

describe("subscriber API", () => {
  it("me, create (secret once), 409 on a second, list, get with log, test, delete", async () => {
    const { app, store, deliveries } = await harness();
    const { token } = await signIn(app);
    expect(await (await app.request(`${BASE}/api/subscribers/v1/me`, bearer(token))).json()).toMatchObject({ scope: SCOPE, account: { email: "jordi@alpha9.io" } });
    const created = await app.request(`${BASE}/api/subscribers/v1/subscriptions`, bearer(token, { method: "POST", body: JSON.stringify({ url: "https://team.alpha9.io/api/hooks/zenod/c1", event: "voice_note.captured", name: "Epic Team" }) }));
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const body = await created.json() as { subscription: Record<string, unknown>; signing_secret: string };
    expect(body.signing_secret).toMatch(/^whsec_/);
    expect(body.subscription).toMatchObject({ name: "Epic Team", kind: "agent_team", product: "EpicSpine", via: "oauth", enabled: true, event: "voice_note.captured", last_delivery: null, retries_24h: 0, created_by: { name: "Jordi Montes", email: "jordi@alpha9.io" } });
    const id = String(body.subscription.id);
    const second = await app.request(`${BASE}/api/subscribers/v1/subscriptions`, bearer(token, { method: "POST", body: JSON.stringify({ url: "https://team.alpha9.io/x", event: "voice_note.captured" }) }));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "subscription_exists", subscription_id: id } });
    const list = await (await app.request(`${BASE}/api/subscribers/v1/subscriptions`, bearer(token))).json() as { subscriptions: unknown[] };
    expect(list.subscriptions).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(body.signing_secret);
    const test = await (await app.request(`${BASE}/api/subscribers/v1/subscriptions/${id}/test`, bearer(token, { method: "POST" }))).json();
    expect(test).toMatchObject({ delivery: { ok: true, test: true, http_status: 200, attempts: 1 } });
    expect(JSON.parse(deliveries[0]!.body)).toMatchObject({ test: true, note: { id: "test" } });
    const one = await (await app.request(`${BASE}/api/subscribers/v1/subscriptions/${id}`, bearer(token))).json() as { deliveries: unknown[] };
    expect(one.deliveries).toHaveLength(1);
    expect((await app.request(`${BASE}/api/subscribers/v1/subscriptions/${id}`, bearer(token, { method: "DELETE" }))).status).toBe(204);
    expect(store.list()).toEqual([]);
    // the token stays valid after a delete; /oauth/revoke ends the connection
    expect((await app.request(`${BASE}/api/subscribers/v1/me`, bearer(token))).status).toBe(200);
  });

  it("refuses bad input with the contract's codes", async () => {
    const { app } = await harness();
    const { token } = await signIn(app);
    const post = (body: unknown) => app.request(`${BASE}/api/subscribers/v1/subscriptions`, bearer(token, { method: "POST", body: JSON.stringify(body) }));
    expect(await (await post({ url: "https://team.alpha9.io/x", event: "note.created" })).json()).toMatchObject({ error: { code: "unsupported_event" } });
    expect(await (await post({ url: "http://team.alpha9.io/x", event: "voice_note.captured" })).json()).toMatchObject({ error: { code: "url_not_allowed" } });
    expect(await (await post({ url: "https://team.alpha9.io/x", event: "voice_note.captured", kind: "robot" })).json()).toMatchObject({ error: { code: "invalid_request" } });
    expect((await app.request(`${BASE}/api/subscribers/v1/subscriptions/sub_nope`, bearer(token))).status).toBe(404);
    expect(await (await app.request(`${BASE}/api/subscribers/v1/me`)).json()).toMatchObject({ error: { code: "invalid_token" } });
    expect((await app.request(`${BASE}/api/subscribers/v1/me`, bearer("zvn_made-up"))).status).toBe(401);
  });

  it("reads voice notes captured since the grant or announced to it, and nothing else", async () => {
    const { app, dispatcher } = await harness();
    const { token } = await signIn(app);
    await app.request(`${BASE}/api/subscribers/v1/subscriptions`, bearer(token, { method: "POST", body: JSON.stringify({ url: "https://team.alpha9.io/api/hooks/zenod/c1", event: "voice_note.captured" }) }));
    const read = (id: string) => app.request(`${BASE}/api/subscribers/v1/notes?id=${encodeURIComponent(id)}`, bearer(token));
    const fresh = await read("Log/2026-11-02.md#^e-new");
    expect(fresh.status).toBe(200);
    expect(await fresh.json()).toMatchObject({ note: { id: "Log/2026-11-02.md#^e-new", captured_at: "2026-11-02T16:12:01.000Z", source: "whatsapp", content_type: "voice_note", text: expect.stringContaining("Remind the delivery manager") } });
    for (const id of ["Log/2026-11-01.md#^e-old", "Log/2026-11-02.md#^e-memo", "Log/2026-11-02.md#^e-missing", "Areas/Insurance.md"]) {
      const res = await read(id);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "note_not_found" } });
    }
    // an older note Zenod did announce to this grant (e.g. a capture whose clock ran behind) is readable
    dispatcher.onEntryStored({ evidenceRef: "Log/2026-11-01.md#^e-old", contentType: "voice_note", source: "whatsapp", capturedAt: "2026-11-01T09:00:00.000Z" });
    await dispatcher.idle();
    expect((await read("Log/2026-11-01.md#^e-old")).status).toBe(200);
    expect(await (await read("test")).json()).toMatchObject({ note: { id: "test", text: expect.stringContaining("test note") } });
  });

  it("lists pointers to voice notes since a time for the safety net, never from before the grant, never the words", async () => {
    const { app } = await harness();
    const { token } = await signIn(app);
    const list = async (query = "") => (await app.request(`${BASE}/api/subscribers/v1/notes${query}`, bearer(token))).json() as Promise<{ notes: Array<Record<string, unknown>>; has_more: boolean }>;
    const all = await list("?since=2026-10-01T00:00:00.000Z");
    expect(all.notes).toEqual([{ id: "Log/2026-11-02.md#^e-new", captured_at: "2026-11-02T16:12:01.000Z", source: "whatsapp", content_type: "voice_note", url: `${BASE}/api/subscribers/v1/notes?id=Log%2F2026-11-02.md%23%5Ee-new` }]);
    expect(all.has_more).toBe(false);
    expect((await list("?since=2026-11-02T17:00:00.000Z")).notes).toEqual([]);
    expect((await list()).notes).toHaveLength(1);
    expect((await app.request(`${BASE}/api/subscribers/v1/notes?since=yesterday`, bearer(token))).status).toBe(400);
  });

  it("revoke from the team side, or Remove in Zenod, kills the token at once", async () => {
    const { app, store } = await harness();
    const first = await signIn(app);
    await app.request(`${BASE}/api/subscribers/v1/subscriptions`, bearer(first.token, { method: "POST", body: JSON.stringify({ url: "https://team.alpha9.io/a", event: "voice_note.captured" }) }));
    const revoked = await app.request(`${BASE}/oauth/revoke`, { method: "POST", body: new URLSearchParams({ token: first.token }) });
    expect(revoked.status).toBe(200);
    expect(store.list()).toEqual([]);
    expect(await (await app.request(`${BASE}/api/subscribers/v1/me`, bearer(first.token))).json()).toMatchObject({ error: { code: "invalid_token" } });

    const second = await signIn(app);
    const created = await (await app.request(`${BASE}/api/subscribers/v1/subscriptions`, bearer(second.token, { method: "POST", body: JSON.stringify({ url: "https://team.alpha9.io/b", event: "voice_note.captured" }) }))).json() as { subscription: { id: string } };
    store.delete(created.subscription.id); // Remove on the Subscribers tab
    expect((await app.request(`${BASE}/api/subscribers/v1/subscriptions`, bearer(second.token))).status).toBe(401);
  });

  it("rate limits tests to 10 a minute per grant", async () => {
    const { app } = await harness();
    const { token } = await signIn(app);
    const created = await (await app.request(`${BASE}/api/subscribers/v1/subscriptions`, bearer(token, { method: "POST", body: JSON.stringify({ url: "https://team.alpha9.io/a", event: "voice_note.captured" }) }))).json() as { subscription: { id: string } };
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await app.request(`${BASE}/api/subscribers/v1/subscriptions/${created.subscription.id}/test`, bearer(token, { method: "POST" }))).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("switched off", () => {
  it("answers 503 subscribers_disabled and never creates the index table", async () => {
    const { app, dir } = await harness({ enabled: false });
    const res = await app.request(`${BASE}/api/subscribers/v1/me`, bearer("zvn_x"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "subscribers_disabled" } });
    expect((await app.request(authorizeUrl())).status).toBe(503);
    expect(existsSync(join(dir, "subscriber-index.sqlite"))).toBe(false);
  });
});

describe("hosted capability allowlist", () => {
  it("lets a hosted customer use the Subscribers tab and nothing wider", () => {
    expect(hostedCapabilityViolation("GET", "/api/subscribers")).toBeNull();
    expect(hostedCapabilityViolation("POST", "/api/subscribers")).toBeNull();
    expect(hostedCapabilityViolation("PATCH", "/api/subscribers/sub_abc-1")).toBeNull();
    expect(hostedCapabilityViolation("DELETE", "/api/subscribers/sub_abc-1")).toBeNull();
    expect(hostedCapabilityViolation("POST", "/api/subscribers/sub_abc-1/test")).toBeNull();
    expect(hostedCapabilityViolation("PUT", "/api/subscribers/sub_abc-1")).not.toBeNull();
    expect(hostedCapabilityViolation("DELETE", "/api/subscribers/../tenants")).not.toBeNull();
    // EPIC-21 V1: remove an app that forwards voice notes.
    expect(hostedCapabilityViolation("DELETE", "/api/subscribers/forwarders/grt_abc-1")).toBeNull();
    expect(hostedCapabilityViolation("DELETE", "/api/subscribers/forwarders/../x")).not.toBeNull();
  });
});
