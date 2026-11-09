import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteTenantStore } from "@zenod/mcp-chassis";
import type { CustomerAccount } from "../src/customerAccounts.js";
import type { CustomerStripeClient } from "../src/customerBilling.js";
import { createCustomerLayer } from "../src/customerLayer.js";
import { customerUserId, type CustomerPrincipal } from "../src/customerIdentity.js";
import { issueCustomerSession } from "../src/customerSession.js";
import { InboxError, InboxStore, closeInboxFor, inboxFor, inboxNeedsYou } from "../src/inboxStore.js";
import { registerInboxRoutes } from "../src/inboxRoutes.js";
import { Runtime } from "../src/runtime.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zenod-inbox-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("InboxStore (EPIC-14 S2)", () => {
  const open = () => new InboxStore(join(dir, "inbox.sqlite"));

  it("keeps a question with its recommendation first, answers it once and stops counting it", () => {
    const inbox = open();
    const question = inbox.post({
      kind: "question", from: "Librarian", title: "Join Flat and Apartment?",
      options: [{ id: "keep", label: "No, keep both" }, { id: "join", label: "Yes, join" }], recommended: "join",
      links: [{ label: "Flat", path: "Areas/Flat.md" }, { label: "bad", path: "../etc/passwd" }],
    });
    expect(question.options.map((o) => o.id)).toEqual(["join", "keep"]);
    expect(question.links).toEqual([{ label: "Flat", path: "Areas/Flat.md" }]);
    expect(inbox.needsYouCount()).toBe(1);
    inbox.markSeen();
    expect(inbox.needsYouCount()).toBe(1); // an open question needs you until it is answered
    const answered = inbox.answer(question.id, "join", "job-1");
    expect(answered).toMatchObject({ status: "answered", answer: { optionId: "join", label: "Yes, join", savedJobId: "job-1" } });
    expect(inbox.needsYouCount()).toBe(0);
    expect(() => inbox.answer(question.id, "keep")).toThrow(InboxError);
    expect(() => inbox.post({ kind: "question", from: "Librarian", title: "One choice?", options: [{ id: "a", label: "A" }] })).toThrow(/two or three/);
    inbox.close();
  });

  it("counts a finding until seen, and a poster's sourceKey keeps one item", () => {
    const inbox = open();
    const finding = inbox.post({ kind: "finding", from: "Night reader", title: "Dentist three times", sourceKey: "night:1" });
    expect(inbox.post({ kind: "finding", from: "Night reader", title: "again", sourceKey: "night:1" }).id).toBe(finding.id);
    expect(inbox.list()).toHaveLength(1);
    expect(inbox.needsYouCount()).toBe(1);
    inbox.markSeen([finding.id]);
    expect(inbox.needsYouCount()).toBe(0);
    expect(inbox.dismiss(finding.id).status).toBe("dismissed");
    inbox.close();
  });

  it("moves a desk job from Working to Done, brings it back as new, and undoes it through the desk", async () => {
    let clock = Date.parse("2026-11-08T18:00:00Z");
    const inbox = new InboxStore(join(dir, "inbox.sqlite"), () => new Date((clock += 1000)));
    const job = inbox.post({ kind: "job", title: "Split two topics", step: "Reading 23 memories" });
    expect(job).toMatchObject({ kind: "job", status: "working", from: "Memory desk", step: "Reading 23 memories" });
    inbox.markSeen();
    const step = inbox.updateJob(job.id, { status: "working", step: "Moving 15 memories" });
    expect(step.step).toBe("Moving 15 memories");
    expect(inboxNeedsYou(step)).toBe(false); // a new step stays quiet
    expect(() => inbox.dismiss(job.id)).toThrow(/still working/);
    const done = inbox.updateJob(job.id, {
      status: "done",
      result: { summary: "Two topics again.", changes: [{ what: "Hull moved", before: "Both", after: "Boat" }], search: { query: "boat", before: ["Both"], after: ["Boat"] }, changesUrl: "javascript:alert(1)" },
    });
    expect(done).toMatchObject({ status: "done", step: null, seenAt: null, result: { summary: "Two topics again.", search: { query: "boat" } } });
    expect(done.result!.changesUrl).toBeUndefined();
    expect(inbox.list()[0]!.id).toBe(job.id);
    await expect(inbox.undoJob(job.id)).rejects.toThrow(/undo is not available/);
    const undo = vi.fn(async () => {});
    inbox.setUndo(undo);
    expect((await inbox.undoJob(job.id)).status).toBe("undone");
    expect(undo).toHaveBeenCalledTimes(1);
    await expect(inbox.undoJob(job.id)).rejects.toThrow(/only a finished job/);
    expect(() => inbox.updateJob(job.id, { status: "working", step: "again" })).toThrow(/already undone/);
    inbox.close();
  });
});

describe("InboxStore replies (EPIC-14 S2 round 3)", () => {
  it("keeps words on a card, answers a question in words, and hands a persona its unread feedback once", () => {
    let clock = Date.parse("2026-11-08T18:00:00Z");
    const inbox = new InboxStore(join(dir, "inbox.sqlite"), () => new Date((clock += 1000)));
    const finding = inbox.post({ kind: "finding", from: "Weekly recap", title: "Dentist twice, never booked" });
    const other = inbox.post({ kind: "finding", from: "Librarian", title: "Flat and Apartment" });
    const question = inbox.post({ kind: "question", from: "Weekly recap", title: "Keep the garden recap?", options: [{ id: "y", label: "Yes" }, { id: "n", label: "No" }] });
    expect(() => inbox.addReply(finding.id, { kind: "feedback", text: "   " })).toThrow(/a few words/);
    const replied = inbox.addReply(finding.id, { kind: "feedback", text: "Useful, but I booked it yesterday", readAt: null });
    expect(replied.replies).toMatchObject([{ kind: "feedback", text: "Useful, but I booked it yesterday" }]);
    expect(replied.status).toBe("open");
    expect(replied.seenAt).not.toBeNull();
    inbox.addReply(other.id, { kind: "feedback", text: "for the librarian" });

    const answered = inbox.answerInWords(question.id, "Only in spring", "job-9");
    expect(answered).toMatchObject({ status: "answered", answer: { optionId: "words", label: "Only in spring", savedJobId: "job-9" }, replies: [{ kind: "answer", text: "Only in spring" }] });
    expect(() => inbox.answerInWords(question.id, "again")).toThrow(InboxError);

    const unread = inbox.unreadFeedback("Weekly recap");
    expect(unread.map((entry) => entry.reply.text)).toEqual(["Useful, but I booked it yesterday"]);
    const last = inbox.lastFeedbackAt("Weekly recap");
    expect(last).toBe(unread[0]!.reply.at);
    inbox.markFeedbackRead(unread);
    expect(inbox.unreadFeedback("Weekly recap")).toEqual([]);
    expect(inbox.get(finding.id)!.replies[0]!.readAt).toBeTruthy();
    expect(inbox.lastFeedbackAt("Weekly recap")).toBe(last);
    expect(inbox.unreadFeedback("Librarian")).toHaveLength(1);

    const first = inbox.post({ kind: "job", title: "Split two topics" });
    const next = inbox.post({ kind: "job", title: "Also move Yard quotes" });
    expect(inbox.linkFollowUp(next.id, first).followUpOf).toEqual({ id: first.id, title: "Split two topics" });
    inbox.close();
  });
});

describe("inbox routes (EPIC-14 S2)", () => {
  async function setup() {
    const runtimes = new Map<string, Runtime>();
    for (const tenant of ["tenant-a", "tenant-b"]) {
      runtimes.set(tenant, new Runtime(join(dir, tenant), undefined, {
        tenantId: tenant, seedFromEnv: false, platformLlm: { apiKey: "sk-or-v1-test-platform" }, tenantMonthlyAllowanceUsd: 1,
      }));
    }
    const tenants = createSqliteTenantStore({ dataDir: dir });
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test", CUSTOMER_APP_URL: "https://cloud.zenod.dev", ACCOUNT_STATE_SECRET: "test-state-secret",
      STRIPE_SECRET_KEY: "sk_test_not-used", STRIPE_WEBHOOK_SECRET: "whsec_test", STRIPE_MODE: "test", PRICE_MONTHLY: "price_monthly", PRICE_YEARLY: "price_yearly",
    };
    const layer = createCustomerLayer(
      { dataDir: dir, runtimeForAccount: (account: CustomerAccount) => (account.tenant_id ? runtimes.get(account.tenant_id) ?? null : null) },
      { env, stripe: {} as CustomerStripeClient, tenantStore: tenants },
    );
    const principal = (subject: string): CustomerPrincipal => ({
      user_id: customerUserId("google", subject), provider: "google", provider_subject: subject, display_name: subject,
      avatar_url: null, email: `${subject}@example.test`, email_verified: true, github_id: null, github_login: null,
    });
    const cookieFor = async (user: CustomerPrincipal) => {
      const issuer = new Hono();
      issuer.get("/", (c) => { issueCustomerSession(c, user, env); return c.text("ok"); });
      return (await issuer.request("/")).headers.get("set-cookie")!;
    };
    const ada = principal("ada");
    const bob = principal("bob");
    layer.accounts.upsert("cs_ada", { account_id: "user-ada", user_id: ada.user_id, tier: "monthly", tenant_id: "tenant-a", subscription_status: "active" });
    layer.accounts.upsert("cs_bob", { account_id: "user-bob", user_id: bob.user_id, tier: "monthly", tenant_id: "tenant-b", subscription_status: "active" });
    const call = async (method: string, path: string, user?: CustomerPrincipal, body?: unknown) =>
      layer.app.request(path, {
        method,
        headers: { ...(user ? { cookie: await cookieFor(user) } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    const close = async () => {
      tenants.close();
      for (const runtime of runtimes.values()) {
        closeInboxFor(runtime);
        await runtime.close();
      }
    };
    return { runtimes, ada, bob, eve: principal("eve"), call, close };
  }

  it("shows each customer only their own inbox, and files an answer into their memory once", async () => {
    const t = await setup();
    try {
      expect((await t.call("GET", "/api/console/inbox")).status).toBe(401);
      expect((await t.call("GET", "/api/console/inbox", t.eve)).status).toBe(404);
      const a = t.runtimes.get("tenant-a")!;
      // A persona posts through the internal API (S4 will).
      const question = inboxFor(a).post({
        kind: "question", from: "Librarian", title: "Who fixes the boiler?",
        options: [{ id: "ana", label: "Ana" }, { id: "luis", label: "Luis" }], recommended: "ana",
      });
      const list = await (await t.call("GET", "/api/console/inbox", t.ada)).json();
      expect(list.needsYou).toBe(1);
      expect(list.items[0]).toMatchObject({ id: question.id, kind: "question", needsYou: true });
      expect(await (await t.call("GET", "/api/console/inbox", t.bob)).json()).toEqual({ items: [], needsYou: 0 });
      // Bob cannot answer Ada's question: it is not in his inbox.
      expect((await t.call("POST", `/api/console/inbox/${question.id}/answer`, t.bob, { option: "ana" })).status).toBe(404);
      expect((await t.call("POST", `/api/console/inbox/${question.id}/answer`, t.ada, { option: "nope" })).status).toBe(400);

      const enqueue = vi.spyOn(a.taskJobQueue, "enqueue");
      const answered = await t.call("POST", `/api/console/inbox/${question.id}/answer`, t.ada, { option: "ana" });
      expect(answered.status).toBe(200);
      const body = await answered.json();
      expect(body).toMatchObject({ needsYou: 0, item: { status: "answered", answer: { label: "Ana" } } });
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0]![0]).toBe("store");
      expect(enqueue.mock.calls[0]![1]).toEqual({ content: "Who fixes the boiler?\n\nMy answer: Ana\n\n(Answered in the Zenod inbox, asked by Librarian.)", source: "web" });
      expect(enqueue.mock.calls[0]![2]).toBe(`tenant-a:inbox-answer:${question.id}`);
      expect(body.item.answer.savedJobId).toBe(a.taskJobStore.recentCaptures(10)[0]!.id);
      expect((await t.call("POST", `/api/console/inbox/${question.id}/answer`, t.ada, { option: "luis" })).status).toBe(409);
      expect(t.runtimes.get("tenant-b")!.taskJobStore.recentCaptures(10)).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it("shows examples of each kind that never write to the memory, and clears them", async () => {
    const t = await setup();
    try {
      const shown = await (await t.call("POST", "/api/console/inbox/examples", t.ada)).json();
      expect(shown.items.map((item: { kind: string; status: string }) => `${item.kind}:${item.status}`).sort()).toEqual(["finding:open", "job:done", "job:working", "question:open", "suggestion:open"]);
      expect(shown.items.every((item: { example: boolean }) => item.example)).toBe(true);
      expect(shown.needsYou).toBe(5);
      // Twice is still one of each.
      expect((await (await t.call("POST", "/api/console/inbox/examples", t.ada)).json()).items).toHaveLength(5);

      const byKind = (kind: string, status: string) => shown.items.find((item: { kind: string; status: string }) => item.kind === kind && item.status === status);
      const enqueue = vi.spyOn(t.runtimes.get("tenant-a")!.taskJobQueue, "enqueue");
      expect((await t.call("POST", `/api/console/inbox/${byKind("question", "open").id}/answer`, t.ada, { option: "join" })).status).toBe(200);
      expect(enqueue).not.toHaveBeenCalled();
      expect((await t.call("POST", `/api/console/inbox/${byKind("job", "working").id}/undo`, t.ada)).status).toBe(409);
      const undone = await (await t.call("POST", `/api/console/inbox/${byKind("job", "done").id}/undo`, t.ada)).json();
      expect(undone.item.status).toBe("undone");
      expect((await (await t.call("POST", `/api/console/inbox/${byKind("finding", "open").id}/dismiss`, t.ada)).json()).item.status).toBe("dismissed");
      // S26: Do it on the example suggestion starts nothing; a made-up finished job shows, and its Undo works.
      const did = await (await t.call("POST", `/api/console/inbox/${byKind("suggestion", "open").id}/do`, t.ada, {})).json();
      expect(did.item).toMatchObject({ status: "accepted", done: { jobItemId: did.followUp.id } });
      expect(did.followUp).toMatchObject({ kind: "job", example: true, status: "done" });
      expect(enqueue).not.toHaveBeenCalled();
      expect((await (await t.call("POST", `/api/console/inbox/${did.followUp.id}/undo`, t.ada)).json()).item.status).toBe("undone");

      const seen = await (await t.call("POST", "/api/console/inbox/seen", t.ada, {})).json();
      expect(seen.needsYou).toBe(0);
      expect((await (await t.call("GET", "/api/console/inbox/count", t.ada)).json()).needsYou).toBe(0);

      inboxFor(t.runtimes.get("tenant-a")!).post({ kind: "finding", from: "Night reader", title: "A real finding" });
      const cleared = await (await t.call("DELETE", "/api/console/inbox/examples", t.ada)).json();
      expect(cleared.items.map((item: { title: string }) => item.title)).toEqual(["A real finding"]);
      expect(cleared.needsYou).toBe(1);
      expect((await (await t.call("GET", "/api/console/inbox", t.bob)).json()).items).toEqual([]);
    } finally {
      await t.close();
    }
  });

  it("the reply box: a persona's question answered in words is filed once, a finding keeps its feedback, examples start nothing", async () => {
    const t = await setup();
    try {
      const a = t.runtimes.get("tenant-a")!;
      const question = inboxFor(a).post({ kind: "question", from: "Librarian", title: "Who fixes the boiler?", options: [{ id: "ana", label: "Ana" }, { id: "luis", label: "Luis" }] });
      const finding = inboxFor(a).post({ kind: "finding", from: "Weekly recap", title: "Dentist twice" });
      expect((await t.call("POST", `/api/console/inbox/${question.id}/reply`, t.ada, { text: "  " })).status).toBe(400);
      expect((await t.call("POST", `/api/console/inbox/${question.id}/reply`, t.ada, { text: "x".repeat(1001) })).status).toBe(400);
      expect((await t.call("POST", `/api/console/inbox/${question.id}/reply`, t.bob, { text: "Ana" })).status).toBe(404);

      const enqueue = vi.spyOn(a.taskJobQueue, "enqueue");
      const answered = await (await t.call("POST", `/api/console/inbox/${question.id}/reply`, t.ada, { text: "Neither, the landlord does" })).json();
      expect(answered).toMatchObject({ needsYou: 1, item: { status: "answered", answer: { optionId: "words", label: "Neither, the landlord does" } } });
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0]![1]).toEqual({ content: "Who fixes the boiler?\n\nMy answer: Neither, the landlord does\n\n(Answered in the Zenod inbox, asked by Librarian.)", source: "web" });
      expect((await t.call("POST", `/api/console/inbox/${question.id}/reply`, t.ada, { text: "again" })).status).toBe(409);

      const fed = await (await t.call("POST", `/api/console/inbox/${finding.id}/reply`, t.ada, { text: "Good catch, keep these" })).json();
      expect(fed.item).toMatchObject({ status: "open", replies: [{ kind: "feedback", text: "Good catch, keep these", readAt: null }] });
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(inboxFor(a).unreadFeedback("Weekly recap")).toHaveLength(1);

      const shown = (await (await t.call("POST", "/api/console/inbox/examples", t.ada)).json()).items as Array<{ id: string; kind: string; status: string }>;
      const job = shown.find((item) => item.kind === "job" && item.status === "done")!;
      const kept = await (await t.call("POST", `/api/console/inbox/${job.id}/reply`, t.ada, { text: "Also split Yard quotes" })).json();
      expect(kept.item.replies).toMatchObject([{ kind: "followup", text: "Also split Yard quotes", followUpItemId: null }]);
      expect(enqueue).toHaveBeenCalledTimes(1);
    } finally {
      await t.close();
    }
  });
});

describe("suggestions and voice feedback (EPIC-14 S26)", () => {
  it("a suggestion needs you until Do it or Not now, keeps its change, and hands its helper the Not now reason once", () => {
    const inbox = new InboxStore(join(dir, "inbox.sqlite"));
    expect(() => inbox.post({ kind: "suggestion", from: "Topic gardener", title: "Join them", action: "  " })).toThrow(/needs the change/);
    const one = inbox.post({ kind: "suggestion", from: "Topic gardener", title: "Join Flat and Apartment", action: "Join Apartment into Flat." });
    expect(one).toMatchObject({ kind: "suggestion", status: "open", action: "Join Apartment into Flat.", done: null });
    inbox.markSeen();
    expect(inboxNeedsYou(inbox.get(one.id)!)).toBe(true);
    expect(() => inbox.dismiss(one.id)).toThrow(InboxError);
    const accepted = inbox.acceptSuggestion(one.id, "Join Apartment into Flat.", "job-item-1");
    expect(accepted).toMatchObject({ status: "accepted", done: { jobItemId: "job-item-1", changed: false } });
    expect(inboxNeedsYou(accepted)).toBe(false);
    expect(() => inbox.declineSuggestion(one.id)).toThrow(/already settled/);

    const two = inbox.post({ kind: "suggestion", from: "Topic gardener", title: "Split Boat", action: "Split Boat." });
    inbox.declineSuggestion(two.id, "Not this month");
    inbox.addReply(two.id, { kind: "feedback", text: "Ask me again in spring", readAt: null, voice: { seconds: 6 } });
    const unread = inbox.unreadFeedback("Topic gardener");
    expect(unread.map((entry) => [entry.reply.kind, entry.reply.text])).toEqual([["notnow", "Not this month"], ["feedback", "Ask me again in spring"]]);
    inbox.markFeedbackRead(unread);
    expect(inbox.unreadFeedback("Topic gardener")).toEqual([]);
    expect(inbox.get(two.id)!.replies[1]).toMatchObject({ voice: { seconds: 6 } });
    inbox.close();
  });

  it("a voice note on a card is transcribed and kept as feedback for its helper, after what was typed", async () => {
    const runtime = new Runtime(join(dir, "tenant-v"), undefined, { tenantId: "tenant-v", seedFromEnv: false, platformLlm: { apiKey: "sk-or-v1-test-platform" } });
    const transcribe = vi.fn(async () => ({ success: true, transcript: "Good one, but keep the Ruzafa visits apart." }));
    const app = new Hono();
    registerInboxRoutes(app, async () => ({ runtime, tenantId: "tenant-v" }), { transcribe });
    try {
      const inbox = inboxFor(runtime);
      const suggestion = inbox.post({ kind: "suggestion", from: "Topic gardener", title: "Join Flat hunt into Moving", action: "Join Flat hunt into Moving." });
      const job = inbox.post({ kind: "job", title: "A desk job" });
      const send = (id: string, type = "audio/webm", query = "") =>
        app.request(`/api/console/inbox/${id}/voice-feedback${query}`, { method: "POST", headers: { "content-type": type, "x-seconds": "7.4" }, body: new Uint8Array([1, 2, 3]) });
      expect((await send(suggestion.id, "text/plain")).status).toBe(415);
      expect((await send(job.id)).status).toBe(404);
      const sent = await send(suggestion.id, "audio/webm;codecs=opus", `?typed=${encodeURIComponent("Mostly yes.")}`);
      expect(sent.status).toBe(200);
      const body = await sent.json();
      expect(body.item.replies).toMatchObject([{ kind: "feedback", text: "Mostly yes.\n\nGood one, but keep the Ruzafa visits apart.", voice: { seconds: 7 }, readAt: null }]);
      expect(body.item.status).toBe("open");
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect((transcribe.mock.calls[0] as unknown[])[2]).toBe(`zenod-app-feedback-${suggestion.id}.webm`);
      expect(inbox.unreadFeedback("Topic gardener")).toHaveLength(1);

      transcribe.mockResolvedValueOnce({ success: false, noSpeech: true } as never);
      const silent = await send(suggestion.id);
      expect(silent.status).toBe(422);
      expect((await silent.json()).message).toMatch(/No words/);
      expect(inbox.get(suggestion.id)!.replies).toHaveLength(1);
    } finally {
      closeInboxFor(runtime);
      await runtime.close();
    }
  });
});
