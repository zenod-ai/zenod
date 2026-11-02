import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrainEngine } from "zenod";

import { SqliteCredentialVault } from "../src/credentialVault.js";
import type { Runtime } from "../src/runtime.js";
import { mountSubscriberRoutes, SUBSCRIBER_ACTOR_HEADER } from "../src/subscriberRoutes.js";
import {
  isPrivateAddress,
  signSubscriberEvent,
  SubscriberDispatcher,
  SubscriberStore,
  subscriberUrlPolicyFromEnv,
  subscribersEnabled,
  validateSubscriberUrl,
  type SubscriberUrlPolicy,
} from "../src/subscribers.js";
import type { Settings } from "../src/settings.js";
import { TaskJobQueue } from "../src/taskJobQueue.js";
import { TaskJobStore } from "../src/taskJobStore.js";

// agent_team E42-S22: Subscribers (push): per-tenant store, URL policy, signed delivery with retries and a log,
// the capture hook that replaces the PR #1472 env hook, and the Subscribers tab's API.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const publicLookup = async () => ["93.184.216.34"];
const noPrivate: SubscriberUrlPolicy = { privateOrigins: new Set(), privateTenants: new Set() };

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "zenod-subscribers-"));
  dirs.push(dir);
  const vault = new SqliteCredentialVault({ dataDir: dir, tenantId: "jordi", masterKey: "1".repeat(64) });
  const store = new SubscriberStore(join(dir, "subscribers.sqlite"), vault);
  return { dir, vault, store };
}

describe("switch", () => {
  it("is off unless the operator sets ZENOD_SUBSCRIBERS=on", () => {
    expect(subscribersEnabled({})).toBe(false);
    expect(subscribersEnabled({ ZENOD_SUBSCRIBERS: "1" })).toBe(false);
    expect(subscribersEnabled({ ZENOD_SUBSCRIBERS: " ON " })).toBe(true);
  });
});

describe("subscriber store", () => {
  it("keeps the signing secret only in the credential vault and returns it once on create", async () => {
    const { dir, store } = await makeStore();
    const { subscription, signingSecret } = store.create({ name: "My n8n flow", kind: "webhook", url: "https://hooks.example.com/zenod", event: "voice_note.captured", via: "manual", createdBy: { name: "Jordi Montes", email: "jordi@alpha9.io" } });
    expect(signingSecret).toMatch(/^whsec_[A-Za-z0-9_-]{32}$/);
    expect(store.signingSecret(subscription.id)).toBe(signingSecret);
    expect(readFileSync(join(dir, "subscribers.sqlite")).includes(Buffer.from(signingSecret))).toBe(false);
    expect(store.list().map((s) => s.name)).toEqual(["My n8n flow"]);
    expect(JSON.stringify(store.list())).not.toContain(signingSecret);
    expect(store.delete(subscription.id)).toBe(true);
    expect(store.signingSecret(subscription.id)).toBeNull();
    expect(store.list()).toEqual([]);
    store.close();
  });

  it("keeps a grant's token as a hash; removing its subscription in Zenod also revokes the grant", async () => {
    const { dir, store } = await makeStore();
    const { grant, token, tokenHash } = store.createGrant({ clientId: "zc_1", clientName: "Epic Team", scope: "voice_notes.read voice_notes.subscribe", account: { name: "Jordi Montes", email: "jordi@alpha9.io" } });
    expect(token).toMatch(/^zvn_[A-Za-z0-9_-]{43}$/);
    expect(readFileSync(join(dir, "subscribers.sqlite")).includes(Buffer.from(token))).toBe(false);
    expect(store.grantForTokenHash(tokenHash)?.id).toBe(grant.id);
    const { subscription } = store.create({ name: "Epic Team", kind: "agent_team", product: "EpicSpine", url: "https://team.alpha9.io/api/hooks/zenod/c1", event: "voice_note.captured", via: "oauth", grantId: grant.id });
    store.delete(subscription.id);
    expect(store.grantForTokenHash(tokenHash)).toBeNull();
    store.close();
  });

  it("revoking a grant removes every subscription made with it, and keeps hand-added webhooks", async () => {
    const { store } = await makeStore();
    const { grant } = store.createGrant({ clientId: "zc_1", clientName: "Epic Social", scope: "voice_notes.read voice_notes.subscribe", account: { name: null, email: null } });
    store.create({ name: "Epic Social", kind: "agent_team", url: "https://team.alpha9.io/h/2", event: "voice_note.captured", via: "oauth", grantId: grant.id });
    store.create({ name: "My n8n flow", kind: "webhook", url: "https://hooks.example.com/z", event: "voice_note.captured", via: "manual" });
    expect(store.revokeGrant(grant.id)).toBe(true);
    expect(store.list().map((s) => s.name)).toEqual(["My n8n flow"]);
    store.close();
  });
});

describe("subscriber URL policy", () => {
  it("accepts public HTTPS only", async () => {
    const opts = { tenantId: "jordi", policy: noPrivate, lookup: publicLookup };
    await expect(validateSubscriberUrl("https://hooks.example.com/zenod", opts)).resolves.toBeInstanceOf(URL);
    for (const bad of ["http://hooks.example.com/zenod", "https://u:p@hooks.example.com/", "https://hooks.example.com/#x", "ftp://x/", "not a url", 42]) {
      await expect(validateSubscriberUrl(bad, opts)).rejects.toMatchObject({ code: "url_not_allowed" });
    }
  });

  it("refuses private, loopback, link-local and tailnet (CGNAT) results", async () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.104.206.10", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(address)).toBe(true);
      await expect(validateSubscriberUrl("https://hooks.example.com/", { tenantId: "jordi", policy: noPrivate, lookup: async () => [address] })).rejects.toMatchObject({ code: "url_not_allowed" });
    }
    await expect(validateSubscriberUrl("https://localhost/", { tenantId: "jordi", policy: noPrivate })).rejects.toMatchObject({ code: "url_not_allowed" });
  });

  it("opens the operator's private origin only for the operator's listed tenants", async () => {
    const policy = subscriberUrlPolicyFromEnv({ ZENOD_SUBSCRIBERS_PRIVATE_ORIGINS: "http://100.104.206.10:8750, nonsense", ZENOD_SUBSCRIBERS_PRIVATE_TENANTS: "jordi" });
    expect([...policy.privateOrigins]).toEqual(["http://100.104.206.10:8750"]);
    await expect(validateSubscriberUrl("http://100.104.206.10:8750/api/hooks/zenod/c1", { tenantId: "jordi", policy })).resolves.toBeInstanceOf(URL);
    await expect(validateSubscriberUrl("http://100.104.206.10:8750/api/hooks/zenod/c1", { tenantId: "someone-else", policy })).rejects.toMatchObject({ code: "url_not_allowed" });
    await expect(validateSubscriberUrl("http://100.104.206.10:8751/", { tenantId: "jordi", policy })).rejects.toMatchObject({ code: "url_not_allowed" });
    await expect(validateSubscriberUrl("http://127.0.0.1:8750/", { tenantId: "jordi", policy })).rejects.toMatchObject({ code: "url_not_allowed" });
  });
});

describe("signed delivery", () => {
  async function setup(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, retryMs = [1, 1]) {
    const { store } = await makeStore();
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, init }), fetchImpl(url, init)));
    const lines: string[] = [];
    const dispatcher = new SubscriberDispatcher({ tenantId: "jordi", store, policy: noPrivate, publicBaseUrl: "https://cloud.zenod.dev", fetch: fetch as never, lookup: publicLookup, retryMs, now: () => 1_800_000_000_000, log: (l) => lines.push(l) });
    return { store, dispatcher, calls, fetch, lines };
  }

  it("posts a signed pointer (never the words) to every enabled subscriber, and logs it", async () => {
    const { store, dispatcher, calls, lines } = await setup(async () => new Response("ok", { status: 200 }));
    const a = store.create({ name: "Epic Team", kind: "agent_team", url: "https://team.alpha9.io/api/hooks/zenod/c1", event: "voice_note.captured", via: "manual" });
    const b = store.create({ name: "Epic Social", kind: "agent_team", url: "https://team.alpha9.io/api/hooks/zenod/c2", event: "voice_note.captured", via: "manual" });
    const paused = store.create({ name: "Paused", kind: "webhook", url: "https://hooks.example.com/p", event: "voice_note.captured", via: "manual" });
    store.setEnabled(paused.subscription.id, false);
    dispatcher.onEntryStored({ evidenceRef: "Log/2026-11-02.md#^e-c927b7", contentType: "voice_note", source: "whatsapp", capturedAt: "2026-11-02T16:12:01.000Z" });
    dispatcher.onEntryStored({ evidenceRef: "Log/2026-11-02.md#^e-000001", contentType: "note", source: "mcp" });
    await dispatcher.idle();
    expect(calls.map((c) => c.url).sort()).toEqual(["https://team.alpha9.io/api/hooks/zenod/c1", "https://team.alpha9.io/api/hooks/zenod/c2"]);
    const call = calls.find((c) => c.url.endsWith("/c1"))!;
    const body = String(call.init.body);
    const event = JSON.parse(body);
    expect(event).toMatchObject({
      type: "voice_note.captured",
      test: false,
      subscription_id: a.subscription.id,
      note: { id: "Log/2026-11-02.md#^e-c927b7", captured_at: "2026-11-02T16:12:01.000Z", source: "whatsapp", content_type: "voice_note", url: "https://cloud.zenod.dev/api/subscribers/v1/notes?id=Log%2F2026-11-02.md%23%5Ee-c927b7" },
    });
    expect(event.id).toMatch(/^evt_/);
    expect(Object.keys(event.note).sort()).toEqual(["captured_at", "content_type", "id", "source", "url"]);
    const headers = call.init.headers as Record<string, string>;
    expect(headers["x-zenod-signature"]).toBe(`t=1800000000,v1=${createHmac("sha256", a.signingSecret).update(`1800000000.${body}`).digest("hex")}`);
    expect(headers["x-zenod-signature"]).toBe(signSubscriberEvent(body, a.signingSecret, 1_800_000_000));
    expect(headers["x-zenod-event-id"]).toBe(event.id);
    expect(headers["x-zenod-delivery-attempt"]).toBe("1");
    expect(call.init.redirect).toBe("manual");
    const view = store.view(store.get(b.subscription.id)!);
    expect(view.lastDelivery).toMatchObject({ ok: true, status: "delivered", httpStatus: 200, attempts: 1, test: false, noteId: "Log/2026-11-02.md#^e-c927b7" });
    expect(view.retries24h).toBe(0);
    expect(lines.join("\n")).not.toContain(a.signingSecret);
    store.close();
  });

  it("retries a 5xx, 429, 3xx, timeout or network error after 2 s and 10 s, then marks it failed", async () => {
    const { store, dispatcher, fetch } = await setup(async () => { throw new TypeError("fetch failed"); });
    const sub = store.create({ name: "Down", kind: "webhook", url: "https://hooks.example.com/d", event: "voice_note.captured", via: "manual" });
    dispatcher.onEntryStored({ evidenceRef: "Log/a.md#^e-1", contentType: "voice_note" });
    await dispatcher.idle();
    expect(fetch).toHaveBeenCalledTimes(3);
    const [log] = store.deliveries(sub.subscription.id);
    expect(log).toMatchObject({ ok: false, status: "failed", attempts: 3, error: "network error" });
    expect(store.view(store.get(sub.subscription.id)!).retries24h).toBe(2);
    store.close();

    for (const status of [502, 429, 302]) {
      const flaky = await setup(async () => new Response(null, { status }));
      flaky.store.create({ name: "x", kind: "webhook", url: "https://hooks.example.com/x", event: "voice_note.captured", via: "manual" });
      flaky.dispatcher.onEntryStored({ evidenceRef: "Log/a.md#^e-2", contentType: "voice_note" });
      await flaky.dispatcher.idle();
      expect(flaky.fetch).toHaveBeenCalledTimes(3);
      flaky.store.close();
    }
  });

  it("uses the 2 s and 10 s schedule by default and recovers on a later try", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const responses = [new Response(null, { status: 503 }), new Response(null, { status: 200 })];
      const { store, dispatcher, fetch } = await setup(async () => responses.shift()!, undefined as never);
      const sub = store.create({ name: "x", kind: "webhook", url: "https://hooks.example.com/x", event: "voice_note.captured", via: "manual" });
      const d = new SubscriberDispatcher({ tenantId: "jordi", store, policy: noPrivate, publicBaseUrl: "https://cloud.zenod.dev", fetch: fetch as never, lookup: publicLookup, log: () => {} });
      d.onEntryStored({ evidenceRef: "Log/a.md#^e-3", contentType: "voice_note" });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(store.deliveries(sub.subscription.id)[0]).toMatchObject({ status: "retrying", attempts: 1 });
      await vi.advanceTimersByTimeAsync(1);
      await d.idle();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(store.deliveries(sub.subscription.id)[0]).toMatchObject({ ok: true, status: "delivered", attempts: 2 });
      void dispatcher;
      store.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never retries a refusal (4xx other than 429)", async () => {
    const { store, dispatcher, fetch } = await setup(async () => new Response(null, { status: 401 }));
    const sub = store.create({ name: "x", kind: "webhook", url: "https://hooks.example.com/x", event: "voice_note.captured", via: "manual" });
    dispatcher.onEntryStored({ evidenceRef: "Log/a.md#^e-4", contentType: "voice_note" });
    await dispatcher.idle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.deliveries(sub.subscription.id)[0]).toMatchObject({ ok: false, status: "failed", httpStatus: 401, attempts: 1 });
    store.close();
  });

  it("refuses to deliver when the host now resolves to a private address (checked on every try)", async () => {
    const { store } = await makeStore();
    const fetch = vi.fn();
    const dispatcher = new SubscriberDispatcher({ tenantId: "jordi", store, policy: noPrivate, publicBaseUrl: "https://cloud.zenod.dev", fetch: fetch as never, lookup: async () => ["10.0.0.5"], retryMs: [1, 1], log: () => {} });
    const sub = store.create({ name: "x", kind: "webhook", url: "https://rebind.example.com/x", event: "voice_note.captured", via: "manual" });
    dispatcher.onEntryStored({ evidenceRef: "Log/a.md#^e-5", contentType: "voice_note" });
    await dispatcher.idle();
    expect(fetch).not.toHaveBeenCalled();
    expect(store.deliveries(sub.subscription.id)[0]).toMatchObject({ ok: false, status: "failed", attempts: 1 });
    store.close();
  });

  it("sends a test event once, marked test, even to a paused subscriber", async () => {
    const { store, dispatcher, calls } = await setup(async () => new Response(null, { status: 500 }));
    const sub = store.create({ name: "x", kind: "webhook", url: "https://hooks.example.com/x", event: "voice_note.captured", via: "manual" });
    store.setEnabled(sub.subscription.id, false);
    const result = await dispatcher.sendTest(store.get(sub.subscription.id)!);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ test: true, note: { id: "test" } });
    expect(result).toMatchObject({ ok: false, status: "failed", httpStatus: 500, attempts: 1, test: true });
    store.close();
  });

  it("stops retrying a subscriber that was removed", async () => {
    const { store, dispatcher, fetch } = await setup(async () => new Response(null, { status: 503 }), [20, 20]);
    const sub = store.create({ name: "x", kind: "webhook", url: "https://hooks.example.com/x", event: "voice_note.captured", via: "manual" });
    dispatcher.onEntryStored({ evidenceRef: "Log/a.md#^e-6", contentType: "voice_note" });
    await sleep(5);
    dispatcher.cancel(sub.subscription.id);
    store.delete(sub.subscription.id);
    await dispatcher.idle();
    expect(fetch).toHaveBeenCalledTimes(1);
    store.close();
  });
});

describe("capture hook", () => {
  it("the queue tells the dispatcher once a WhatsApp voice note is durably captured (replaces the PR #1472 env hook)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-subscribers-queue-"));
    dirs.push(dir);
    const settings = { get: (key: string) => ({ artifact_archive_provider: "local", artifact_archive_local_dir: join(dir, "archive") })[key] ?? null } as unknown as Settings;
    const receipt = { evidenceRef: "Log/2026-11-02.md#^e-c927b7", pagesTouched: [], commitSha: "a".repeat(40), githubUrls: [], filing: "filed" as const };
    const engine = { captureEvidence: vi.fn(async () => receipt), enrichEvidence: vi.fn(async () => receipt) } as unknown as BrainEngine;
    const stored = vi.fn();
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const queue = new TaskJobQueue(store, async () => engine, settings, undefined, undefined, stored);
    const job = queue.enqueue("media_ingest", {
      mediaType: "audio", contentType: "voice_note", sourceHint: "WhatsApp voice note", filename: "v.ogg",
      bytesRef: `data:audio/ogg;base64,${Buffer.from("voice").toString("base64")}`,
      providedTranscript: "Push, not poll.", transcriptionDisposition: "provided",
    }, "jordi:whatsapp:v1");
    for (let attempt = 0; attempt < 200 && store.get(job.id)?.status !== "done"; attempt += 1) await sleep(5);
    await queue.close();
    expect(stored).toHaveBeenCalledExactlyOnceWith({ evidenceRef: "Log/2026-11-02.md#^e-c927b7", contentType: "voice_note", source: "whatsapp" });
    store.close();
  });

  it("the retired env hook is gone: setting its old variables sends nothing", async () => {
    vi.stubEnv("ZENOD_ENTRY_HOOK_URL", "http://100.104.206.10:8750/api/hooks/zenod/voice-note");
    vi.stubEnv("ZENOD_ENTRY_HOOK_SECRET", "s3cret");
    vi.stubEnv("ZENOD_ENTRY_HOOK_TENANTS", "jordi");
    const source = readFileSync(new URL("../src/runtime.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/ENTRY_HOOK|entryHook/);
    await expect(import("../src/entryHook.js" as string)).rejects.toThrow();
  });
});

describe("Subscribers tab API (tenant runtime)", () => {
  async function tabApp(responder: () => Response = () => new Response(null, { status: 200 })) {
    const { store } = await makeStore();
    const fetch = vi.fn(async () => responder());
    const dispatcher = new SubscriberDispatcher({ tenantId: "jordi", store, policy: noPrivate, publicBaseUrl: "https://cloud.zenod.dev", fetch: fetch as never, lookup: publicLookup, retryMs: [1, 1], log: () => {} });
    const runtime = { tenantId: "jordi", subscribers: store, subscriberDispatcher: dispatcher } as unknown as Runtime;
    const app = new Hono();
    mountSubscriberRoutes(app as never, runtime, { lookup: publicLookup });
    return { app, store, fetch };
  }
  const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("adds a webhook by hand: secret shown once, a test event sent at once, then listed without the secret", async () => {
    const { app, store, fetch } = await tabApp();
    const res = await app.request("/api/subscribers", json({ url: "https://hooks.example.com/zenod", event: "voice_note.captured", name: "My n8n flow" }, { [SUBSCRIBER_ACTOR_HEADER]: JSON.stringify({ name: "Jordi Montes", email: "jordi@alpha9.io" }) }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const created = await res.json() as { subscription: Record<string, unknown>; signing_secret: string; test_delivery: Record<string, unknown> };
    expect(created.signing_secret).toMatch(/^whsec_/);
    expect(created.subscription).toMatchObject({ name: "My n8n flow", kind: "webhook", via: "manual", enabled: true, created_by: { name: "Jordi Montes", email: "jordi@alpha9.io" } });
    expect(created.test_delivery).toMatchObject({ ok: true, test: true, http_status: 200, attempts: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const list = await (await app.request("/api/subscribers")).json() as { subscribers: Array<Record<string, unknown>> };
    expect(list.subscribers).toHaveLength(1);
    expect(list.subscribers[0]).toMatchObject({ name: "My n8n flow", retries_24h: 0, last_delivery: { ok: true, test: true } });
    expect((list.subscribers[0]!.deliveries as unknown[]).length).toBe(1);
    expect(JSON.stringify(list)).not.toContain(created.signing_secret);
    store.close();
  });

  it("refuses a private or non-HTTPS URL and an unknown event", async () => {
    const { app, store } = await tabApp();
    const bad = await app.request("/api/subscribers", json({ url: "http://hooks.example.com/zenod" }));
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: { code: "url_not_allowed" } });
    const event = await app.request("/api/subscribers", json({ url: "https://hooks.example.com/zenod", event: "note.created" }));
    expect(await event.json()).toMatchObject({ error: { code: "unsupported_event" } });
    expect(store.list()).toEqual([]);
    store.close();
  });

  it("pauses, tests and removes; Remove on a connected team revokes its grant", async () => {
    const { app, store } = await tabApp();
    const { grant, tokenHash } = store.createGrant({ clientId: "zc_1", clientName: "Epic Team", scope: "voice_notes.read voice_notes.subscribe", account: { name: "Jordi Montes", email: "jordi@alpha9.io" } });
    const { subscription } = store.create({ name: "Epic Team", kind: "agent_team", product: "EpicSpine", url: "https://team.alpha9.io/api/hooks/zenod/c1", event: "voice_note.captured", via: "oauth", grantId: grant.id });
    const paused = await app.request(`/api/subscribers/${subscription.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    expect(await paused.json()).toMatchObject({ subscription: { enabled: false } });
    const tested = await app.request(`/api/subscribers/${subscription.id}/test`, { method: "POST" });
    expect(await tested.json()).toMatchObject({ delivery: { ok: true, test: true } });
    expect((await app.request(`/api/subscribers/${subscription.id}`, { method: "DELETE" })).status).toBe(204);
    expect(store.grantForTokenHash(tokenHash)).toBeNull();
    expect((await app.request(`/api/subscribers/${subscription.id}`, { method: "DELETE" })).status).toBe(404);
    store.close();
  });

  it("answers 503 subscribers_disabled while the switch is off", async () => {
    const app = new Hono();
    mountSubscriberRoutes(app as never, { tenantId: "jordi", subscribers: null, subscriberDispatcher: null } as unknown as Runtime);
    for (const [path, init] of [["/api/subscribers", {}], ["/api/subscribers", json({ url: "https://x.example/" })], ["/api/subscribers/sub_x/test", { method: "POST" }], ["/api/subscribers/sub_x", { method: "DELETE" }]] as const) {
      const res = await app.request(path, init);
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: { code: "subscribers_disabled" } });
    }
  });
});
