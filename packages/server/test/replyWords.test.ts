import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrainEngine } from "zenod";

import { channelTurn, type ChannelBrainDeps } from "../src/channelBrain.js";
import { SqliteCredentialVault } from "../src/credentialVault.js";
import { terminalCaptureReceipt } from "../src/phylaxChannels.js";
import { Runtime } from "../src/runtime.js";
import { mountSubscriberRoutes } from "../src/subscriberRoutes.js";
import {
  normalizeReplyWord,
  parseReplyWords,
  SubscriberDispatcher,
  SubscriberStore,
  type SubscriberUrlPolicy,
} from "../src/subscribers.js";
import { TaskJobQueue } from "../src/taskJobQueue.js";
import { TaskJobStore, type TaskJob } from "../src/taskJobStore.js";

// EPIC-20 A8: the owner's one typed WhatsApp word that a subscription declared (EpicTeam: "now") is kept as a text
// note and told to that subscription only, as voice_note.captured with content_type "text"; Zenod gives no reply of its
// own to it; every other typed message is unchanged.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const publicLookup = async () => ["93.184.216.34"];
const noPrivate: SubscriberUrlPolicy = { privateOrigins: new Set(), privateTenants: new Set() };
const NOTE_REF = "Log/2026-11-22.md#^e-now001";
const RECEIPT = { evidenceRef: NOTE_REF, pagesTouched: [], commitSha: "a".repeat(40), githubUrls: [], filing: "filed" as const };

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "zenod-reply-words-"));
  dirs.push(dir);
  const vault = new SqliteCredentialVault({ dataDir: dir, tenantId: "jordi", masterKey: "3".repeat(64) });
  return { dir, store: new SubscriberStore(join(dir, "subscribers.sqlite"), vault) };
}

const epicTeam = (store: SubscriberStore, replyWords: string[] = ["now"]) =>
  store.create({ name: "Epic Team", kind: "agent_team", url: "https://team.alpha9.io/api/hooks/zenod/c1", event: "voice_note.captured", via: "manual", replyWords });

describe("reply words", () => {
  it("compares the whole message: case, punctuation and spacing ignored, nothing else", () => {
    expect(normalizeReplyWord("  Now! ")).toBe("now");
    expect(normalizeReplyWord("NOW...")).toBe("now");
    expect(normalizeReplyWord("¿Ahora?")).toBe("ahora");
    expect(normalizeReplyWord("now please")).toBe("now please");
    expect(parseReplyWords(["Now!", "now", "Go"])).toEqual(["now", "go"]);
    expect(parseReplyWords([])).toEqual([]);
    expect(parseReplyWords("now")).toBeNull();
    expect(parseReplyWords([1])).toBeNull();
    expect(parseReplyWords(["!!!"])).toBeNull();
    expect(parseReplyWords(["a", "b", "c", "d", "e", "f"])).toBeNull();
    expect(parseReplyWords(["x".repeat(33)])).toBeNull();
  });

  it("a subscription keeps its words; only an enabled one that declared the whole message matches it", async () => {
    const { store } = await makeStore();
    const team = epicTeam(store);
    const plain = store.create({ name: "Plain", kind: "webhook", url: "https://hooks.example.com/p", event: "voice_note.captured", via: "manual" });
    expect(plain.subscription.replyWords).toEqual([]);
    expect(store.get(team.subscription.id)?.replyWords).toEqual(["now"]);
    expect(store.replyWordSubscriptions("Now!").map((s) => s.id)).toEqual([team.subscription.id]);
    expect(store.replyWordSubscriptions("now")).toHaveLength(1);
    expect(store.replyWordSubscriptions("now please")).toEqual([]);
    expect(store.replyWordSubscriptions("what is now")).toEqual([]);
    expect(store.replyWordSubscriptions("")).toEqual([]);
    store.setEnabled(team.subscription.id, false);
    expect(store.replyWordSubscriptions("now")).toEqual([]);
    store.setEnabled(team.subscription.id, true);
    store.setReplyWords(team.subscription.id, []);
    expect(store.replyWordSubscriptions("now")).toEqual([]);
    store.close();
  });

  it("adds the column to a database made before reply words existed", async () => {
    const { dir, store } = await makeStore();
    const old = epicTeam(store, []);
    store.close();
    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(join(dir, "subscribers.sqlite"));
    raw.exec("ALTER TABLE subscriptions DROP COLUMN reply_words");
    raw.close();
    const vault = new SqliteCredentialVault({ dataDir: dir, tenantId: "jordi", masterKey: "3".repeat(64) });
    const reopened = new SubscriberStore(join(dir, "subscribers.sqlite"), vault);
    expect(reopened.get(old.subscription.id)?.replyWords).toEqual([]);
    reopened.setReplyWords(old.subscription.id, ["now"]);
    expect(reopened.get(old.subscription.id)?.replyWords).toEqual(["now"]);
    reopened.close();
  });
});

describe("the text event", () => {
  async function setup() {
    const { store } = await makeStore();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, body: JSON.parse(String(init.body)) }), new Response("ok", { status: 200 })));
    const dispatcher = new SubscriberDispatcher({ tenantId: "jordi", store, policy: noPrivate, publicBaseUrl: "https://cloud.zenod.dev", fetch: fetch as never, lookup: publicLookup, retryMs: [1, 1], log: () => {} });
    return { store, dispatcher, calls };
  }

  it("goes only to the subscriptions it was kept for, as voice_note.captured with content_type text", async () => {
    const { store, dispatcher, calls } = await setup();
    const team = epicTeam(store);
    store.create({ name: "Other", kind: "webhook", url: "https://hooks.example.com/o", event: "voice_note.captured", via: "manual" });
    dispatcher.onEntryStored({ evidenceRef: NOTE_REF, contentType: "text", source: "whatsapp", capturedAt: "2026-11-22T23:10:00.000Z", announceTo: [team.subscription.id] });
    await dispatcher.idle();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://team.alpha9.io/api/hooks/zenod/c1");
    expect(calls[0]!.body).toMatchObject({
      type: "voice_note.captured",
      test: false,
      subscription_id: team.subscription.id,
      note: { id: NOTE_REF, captured_at: "2026-11-22T23:10:00.000Z", source: "whatsapp", content_type: "text", url: `https://cloud.zenod.dev/api/subscribers/v1/notes?id=${encodeURIComponent(NOTE_REF)}` },
    });
    expect(store.view(store.get(team.subscription.id)!).lastDelivery).toMatchObject({ ok: true, noteId: NOTE_REF, type: "voice_note.captured" });
    store.close();
  });

  it("is never sent for a typed note nobody was named for, and voice notes are unchanged", async () => {
    const { store, dispatcher, calls } = await setup();
    epicTeam(store);
    dispatcher.onEntryStored({ evidenceRef: "Log/2026-11-22.md#^e-chat", contentType: "text", source: "whatsapp" });
    dispatcher.onEntryStored({ evidenceRef: "Log/2026-11-22.md#^e-chat2", contentType: "text", source: "whatsapp", announceTo: [] });
    dispatcher.onEntryStored({ evidenceRef: "Log/2026-11-22.md#^e-voice", contentType: "voice_note", source: "whatsapp" });
    await dispatcher.idle();
    expect(calls.map((c) => (c.body.note as { content_type: string }).content_type)).toEqual(["voice_note"]);
    store.close();
  });
});

describe("the channel brain", () => {
  const engine = { routeSend: vi.fn(), chat: vi.fn() } as unknown as BrainEngine;
  const deps = (relay: ChannelBrainDeps["relayReplyWord"]): ChannelBrainDeps => ({
    keep: () => ({ id: "store-1", status: "done" }) as TaskJob,
    job: () => ({ id: "store-1", status: "done" }) as TaskJob,
    offerJob: () => {},
    appUrl: "https://cloud.zenod.dev",
    wait: async () => {},
    ...(relay ? { relayReplyWord: relay } : {}),
  });

  it("gives no reply of its own to a message that went to a subscription, and does not read its memory", async () => {
    const relayed: string[] = [];
    const reply = await channelTurn(engine, " Now. ", "chat-1", deps((text) => (relayed.push(text), true)));
    expect(relayed).toEqual(["Now."]);
    expect(reply).toEqual({ outcome: "relayed", sources: [], text: "", silent: true });
    expect(engine.routeSend).not.toHaveBeenCalled();
  });

  it("answers every other message as before", async () => {
    const reply = await channelTurn(engine, "thanks", "chat-1", deps(() => false));
    expect(reply).toMatchObject({ outcome: "hello" });
    expect(reply).not.toHaveProperty("silent");
    expect((await channelTurn(engine, "thanks", "chat-1", deps(undefined))).outcome).toBe("hello");
  });
});

describe("Phylax", () => {
  const result = (payload: Record<string, unknown>) => ({
    content: [{ type: "text" as const, text: "done" }],
    structuredContent: { ticket_id: "job-1", state: "done", result: payload },
  });

  it("sends nothing for a silent chat result, and still sends an ordinary reply", () => {
    expect(terminalCaptureReceipt(result({ outcome: "relayed", sources: [], text: "", silent: true }), "job-1", "chat_with_zenod"))
      .toEqual({ state: "done", text: "", evidenceRef: null, silent: true });
    const normal = terminalCaptureReceipt(result({ outcome: "hello", sources: [], text: "Hi!" }), "job-1", "chat_with_zenod");
    expect(normal).toMatchObject({ state: "done", text: "Hi!" });
    expect(normal).not.toHaveProperty("silent");
    // a result that is empty but not marked silent is still the old "no reply text" notice
    expect(terminalCaptureReceipt(result({ text: "" }), "job-1", "chat_with_zenod")?.text).toContain("returned no reply text");
  });
});

describe("the reply-word routes", () => {
  async function app() {
    const { store } = await makeStore();
    const dispatcher = new SubscriberDispatcher({ tenantId: "jordi", store, policy: noPrivate, publicBaseUrl: "https://cloud.zenod.dev", fetch: (async () => new Response(null, { status: 200 })) as never, lookup: publicLookup, retryMs: [1, 1], log: () => {} });
    const runtime = { tenantId: "jordi", subscribers: store, subscriberDispatcher: dispatcher } as unknown as Runtime;
    const hono = new Hono();
    mountSubscriberRoutes(hono as never, runtime, { lookup: publicLookup });
    const send = (method: string, path: string, body: unknown) => hono.request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { store, send };
  }

  it("takes reply words when a webhook is added and when it is patched, and shows them", async () => {
    const { store, send } = await app();
    const created = await send("POST", "/api/subscribers", { url: "https://hooks.example.com/zenod", reply_words: ["Now"] });
    expect(created.status).toBe(201);
    const made = (await created.json() as { subscription: { id: string; reply_words: string[] } }).subscription;
    expect(made.reply_words).toEqual(["now"]);
    const patched = await send("PATCH", `/api/subscribers/${made.id}`, { reply_words: ["go", "Now"] });
    expect(patched.status).toBe(200);
    expect((await patched.json() as { subscription: { reply_words: string[] } }).subscription.reply_words).toEqual(["go", "now"]);
    expect((await send("PATCH", `/api/subscribers/${made.id}`, { enabled: false })).status).toBe(200);
    expect(store.get(made.id)).toMatchObject({ enabled: false, replyWords: ["go", "now"] });
    expect((await send("PATCH", `/api/subscribers/${made.id}`, { reply_words: "now" })).status).toBe(400);
    expect((await send("POST", "/api/subscribers", { url: "https://hooks.example.com/zenod2", reply_words: [3] })).status).toBe(400);
    store.close();
  });
});

describe("end to end on a tenant runtime", () => {
  it("keeps a typed 'now', tells the subscription, and gives no reply; any other message is answered as before", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zenod-reply-words-rt-"));
    mkdirSync(dir, { recursive: true });
    const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
      return new Response("ok", { status: 200 });
    }));
    const runtime = new Runtime(dir, undefined, { seedFromEnv: false, tenantId: "jordi", subscriberEnv: { ZENOD_SUBSCRIBERS: "on" } as NodeJS.ProcessEnv });
    try {
      const store = runtime.subscribers!;
      const team = store.create({ name: "Epic Team", kind: "agent_team", url: "https://93.184.216.34/api/hooks/zenod/c1", event: "voice_note.captured", via: "manual", replyWords: ["now"] });
      const stored: unknown[] = [];
      const engine = {
        store: vi.fn(async (input: unknown) => (stored.push(input), RECEIPT)),
        routeSend: vi.fn(async () => ({ action: "keep", keep: "milk is low", question: null, by: "model" })),
      } as unknown as BrainEngine;
      vi.spyOn(runtime, "getEngine").mockResolvedValue(engine);
      const queue = runtime.taskJobQueue;
      const wait = async (id: string) => {
        for (let attempt = 0; attempt < 400; attempt += 1) {
          const job = queue.get(id);
          if (job && (job.status === "done" || job.status === "error")) return job;
          await sleep(5);
        }
        throw new Error(`job ${id} did not finish`);
      };

      const job = await wait(queue.enqueue("chat", { text: "Now!", source: "whatsapp", conversationKey: "whatsapp:+521" }, "jordi:whatsapp:m1").id);
      expect(job.status).toBe("done");
      expect(job.result).toMatchObject({ outcome: "relayed", text: "", silent: true });
      await runtime.subscriberDispatcher!.idle();
      for (let attempt = 0; attempt < 400 && !calls.length; attempt += 1) await sleep(5);
      expect(stored).toEqual([expect.objectContaining({ content: "Now!", source: "whatsapp", contentType: "text" })]);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.body).toMatchObject({ type: "voice_note.captured", test: false, subscription_id: team.subscription.id, note: { id: NOTE_REF, source: "whatsapp", content_type: "text" } });
      expect(calls[0]!.headers["x-zenod-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);

      // the same message again under the same WhatsApp message id is not kept or sent twice
      const again = await wait(queue.enqueue("chat", { text: "Now!", source: "whatsapp", conversationKey: "whatsapp:+521" }, "jordi:whatsapp:m1").id);
      expect(again.id).toBe(job.id);
      expect(stored).toHaveLength(1);

      // any other message: the channel brain answers as it always did and nothing goes to the subscription
      const other = await wait(queue.enqueue("chat", { text: "milk is low", source: "whatsapp", conversationKey: "whatsapp:+521" }, "jordi:whatsapp:m2").id);
      expect(other.status).toBe("done");
      expect(other.result).toMatchObject({ outcome: "keep" });
      expect(other.result).not.toHaveProperty("silent");
      await runtime.subscriberDispatcher!.idle();
      await sleep(30);
      expect(calls).toHaveLength(1);

      // paused: the word is an ordinary message again
      store.setEnabled(team.subscription.id, false);
      const paused = await wait(queue.enqueue("chat", { text: "now", source: "whatsapp", conversationKey: "whatsapp:+521" }, "jordi:whatsapp:m3").id);
      expect(paused.result).not.toHaveProperty("silent");
    } finally {
      await runtime.taskJobQueue.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("the stored-job input", () => {
  it("hands announceTo to the capture hook once a typed note is durably kept", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-reply-words-queue-"));
    dirs.push(dir);
    const engine = { store: vi.fn(async () => RECEIPT) } as unknown as BrainEngine;
    const stored = vi.fn();
    const store = new TaskJobStore(join(dir, "tasks.sqlite"));
    const queue = new TaskJobQueue(store, async () => engine, undefined, undefined, undefined, stored);
    const job = queue.enqueue("store", { content: "now", source: "whatsapp", contentType: "text", announceTo: ["sub_1"] }, "k1");
    for (let attempt = 0; attempt < 200 && store.get(job.id)?.status !== "done"; attempt += 1) await sleep(5);
    await queue.close();
    expect(stored).toHaveBeenCalledExactlyOnceWith({ evidenceRef: NOTE_REF, contentType: "text", source: "whatsapp", announceTo: ["sub_1"] });
    store.close();
  });
});
