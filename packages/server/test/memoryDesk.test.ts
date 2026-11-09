import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteTenantStore } from "@zenod/mcp-chassis";
import { looksLikeDeskJob, type BrainEngine, type DeskJobInput, type DeskJobResult, type DeskPlan } from "zenod";
import type { CustomerAccount } from "../src/customerAccounts.js";
import type { CustomerStripeClient } from "../src/customerBilling.js";
import { createCustomerLayer } from "../src/customerLayer.js";
import { customerUserId, type CustomerPrincipal } from "../src/customerIdentity.js";
import { issueCustomerSession } from "../src/customerSession.js";
import { closeInboxFor, inboxFor, type InboxItem } from "../src/inboxStore.js";
import { DESK_JOBS_PER_DAY, offerDeskJobFromChat } from "../src/memoryDesk.js";
import { Runtime } from "../src/runtime.js";
import type { TaskJobDeskHooks } from "../src/taskJobQueue.js";

/**
 * EPIC-14 S3, the memory desk on the server: "Ask the desk" and the Send box start a job that shows
 * in the inbox at once as Working, runs on the tenant's own queue, ends Done with its changes and
 * Undo, or as a plan card for big jobs; WhatsApp only gets "run it?" in the inbox. The engine is a
 * fake: the vault side is tested in packages/core/test/memoryDesk.test.ts.
 */

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zenod-desk-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const PLAN: DeskPlan = {
  title: "Split Boat repair and Cabin decision",
  summary: "Two topics again.",
  search: "cabin",
  changes: [{ op: "root", page: "Projects/Cabin decision.md", name: "Cabin decision", kind: "long-term" }],
};

const DONE: DeskJobResult = {
  status: "done", plan: PLAN,
  edits: [{ kind: "tree_add", line: "- Cabin decision | long-term | [[Projects/Cabin decision]] | Cabin. ^n-1", group: "long-term" }],
  changes: [{ what: "Cabin decision became its own topic", before: "Long-term › Boat and cabin › Cabin decision", after: "Long-term › Cabin decision" }],
  touched: 2,
  search: { query: "cabin", before: ["Boat and cabin · Long-term › Boat and cabin"], after: ["Cabin decision · Long-term › Cabin decision"] },
  revision: { provider: "github", id: "abc123", commitSha: "abc123", urls: ["https://github.com/demo/vault/commit/abc123"] } as never,
  agent: { steps: 3, inputChars: 9_000 },
};

async function setup(engine: Partial<BrainEngine>) {
  const runtimes = new Map<string, Runtime>();
  for (const tenant of ["tenant-a", "tenant-b"]) {
    const runtime = new Runtime(join(dir, tenant), undefined, {
      tenantId: tenant, seedFromEnv: false, platformLlm: { apiKey: "sk-or-v1-test-platform" }, tenantMonthlyAllowanceUsd: 1,
    });
    vi.spyOn(runtime, "getEngine").mockImplementation(async () => engine as BrainEngine);
    runtimes.set(tenant, runtime);
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
  const list = async (user: CustomerPrincipal): Promise<InboxItem[]> => (await (await call("GET", "/api/console/inbox", user)).json()).items;
  const settled = async (user: CustomerPrincipal, id: string, until: (item: InboxItem) => boolean = (item) => item.status !== "working"): Promise<InboxItem> => {
    for (let i = 0; i < 200; i++) {
      const item = (await list(user)).find((candidate) => candidate.id === id);
      if (item && until(item)) return item;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("the desk job did not settle");
  };
  const close = async () => {
    tenants.close();
    for (const runtime of runtimes.values()) {
      closeInboxFor(runtime);
      await runtime.close();
    }
  };
  return { runtimes, ada, bob, call, list, settled, close };
}

describe("memory desk routes (EPIC-14 S3)", { timeout: 30_000 }, () => {
  it("Ask the desk: the job shows at once as Working, runs, ends Done with its changes, and Undo puts it back", async () => {
    const deskJob = vi.fn(async (input: DeskJobInput) => {
      input.onStep?.("Reading your topics");
      return DONE;
    });
    const undoDeskJob = vi.fn(async () => ({ revision: null, undone: 1, skipped: 0 }));
    const t = await setup({ deskJob, undoDeskJob });
    try {
      expect((await t.call("POST", "/api/console/memory-desk/jobs", undefined, { request: "x" })).status).toBe(401);
      expect((await t.call("POST", "/api/console/memory-desk/jobs", t.ada, { request: "  " })).status).toBe(400);
      const started = await t.call("POST", "/api/console/memory-desk/jobs", t.ada, { request: "Boat and cabin are tangled, split them" });
      expect(started.status).toBe(202);
      const { item } = await started.json();
      expect(item).toMatchObject({ kind: "job", from: "Memory desk", status: "working", title: "Boat and cabin are tangled, split them" });
      expect((await t.list(t.bob))).toEqual([]);

      const done = await t.settled(t.ada, item.id);
      expect(done.status).toBe("done");
      expect(done.result).toMatchObject({
        summary: "Two topics again. 2 memories changed place or links, in one change you can undo.",
        changes: [{ what: "Cabin decision became its own topic", after: "Long-term › Cabin decision" }],
        search: { query: "cabin", after: ["Cabin decision · Long-term › Cabin decision"] },
        changesUrl: "https://github.com/demo/vault/commit/abc123",
      });
      expect(deskJob).toHaveBeenCalledTimes(1);
      expect(deskJob.mock.calls[0]![0].request).toBe("Boat and cabin are tangled, split them");
      expect(deskJob.mock.calls[0]![0].plan).toBeUndefined();

      const undone = await t.call("POST", `/api/console/inbox/${item.id}/undo`, t.ada);
      expect(undone.status).toBe(200);
      expect((await undone.json()).item.status).toBe("undone");
      expect(undoDeskJob).toHaveBeenCalledWith({ title: PLAN.title, edits: DONE.status === "done" ? DONE.edits : [] });
      // Bob cannot undo Ada's job.
      expect((await t.call("POST", `/api/console/inbox/${item.id}/undo`, t.bob)).status).toBe(404);
    } finally {
      await t.close();
    }
  });

  it("a big job posts a plan card; Run it carries on the same item with the plan, and is not filed as a note", async () => {
    const deskJob = vi.fn(async (input: DeskJobInput): Promise<DeskJobResult> => input.plan
      ? DONE
      : { status: "needs_go", plan: PLAN, changes: DONE.status === "done" ? DONE.changes : [], touched: 63, agent: { steps: 4, inputChars: 12_000 } });
    const t = await setup({ deskJob });
    try {
      const { item } = await (await t.call("POST", "/api/console/memory-desk/jobs", t.ada, { request: "untangle everything about boats" })).json();
      const waiting = await t.settled(t.ada, item.id, (candidate) => (candidate.step ?? "").startsWith("Waiting for your yes"));
      expect(waiting.status).toBe("working");
      const card = (await t.list(t.ada)).find((candidate) => candidate.kind === "question")!;
      expect(card).toMatchObject({ from: "Memory desk", title: `${PLAN.title}: this would change 63 memories. Run it?`, options: [{ id: "run", label: "Run it" }, { id: "no", label: "Not now" }] });
      expect(card.body).toContain("Cabin decision became its own topic");

      const enqueue = vi.spyOn(t.runtimes.get("tenant-a")!.taskJobQueue, "enqueue");
      const answered = await t.call("POST", `/api/console/inbox/${card.id}/answer`, t.ada, { option: "run" });
      expect(answered.status).toBe(200);
      expect(enqueue.mock.calls.map((c) => c[0])).toEqual(["desk_job"]);
      const done = await t.settled(t.ada, item.id, (candidate) => candidate.status === "done");
      expect(done.result?.changes).toHaveLength(1);
      expect(deskJob).toHaveBeenCalledTimes(2);
      expect(deskJob.mock.calls[1]![0]).toMatchObject({ plan: PLAN, maxTouched: Number.POSITIVE_INFINITY });
      expect((await t.list(t.ada)).filter((candidate) => candidate.kind === "job")).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it("the reply box sends a follow-up to the desk: a new job linked to the first, and on a plan card it replaces the plan", async () => {
    let next: () => Promise<DeskJobResult> = async () => DONE;
    const deskJob = vi.fn(async () => next());
    const t = await setup({ deskJob });
    try {
      const { item } = await (await t.call("POST", "/api/console/memory-desk/jobs", t.ada, { request: "split boat and cabin" })).json();
      await t.settled(t.ada, item.id);
      const sent = await t.call("POST", `/api/console/inbox/${item.id}/reply`, t.ada, { text: "Also move the Yard quotes to Boat repair" });
      expect(sent.status).toBe(200);
      const body = await sent.json();
      expect(body.item.replies).toMatchObject([{ kind: "followup", text: "Also move the Yard quotes to Boat repair", followUpItemId: body.followUp.id }]);
      expect(body.followUp).toMatchObject({ kind: "job", status: "working", title: "Also move the Yard quotes to Boat repair", followUpOf: { id: item.id, title: item.title } });
      await t.settled(t.ada, body.followUp.id);
      expect(deskJob).toHaveBeenCalledTimes(2);
      expect((deskJob.mock.calls[1] as unknown as [DeskJobInput])[0].request).toBe(`Also move the Yard quotes to Boat repair\n\nFollow-up to the job "${item.title}"`);
      expect((await t.call("POST", `/api/console/inbox/${item.id}/reply`, t.bob, { text: "x" })).status).toBe(404);

      next = async () => ({ status: "needs_go", plan: PLAN, changes: [], touched: 80, agent: { steps: 2, inputChars: 1 } });
      const big = (await (await t.call("POST", "/api/console/memory-desk/jobs", t.ada, { request: "move all notes under House" })).json()).item;
      await t.settled(t.ada, big.id, (candidate) => (candidate.step ?? "").startsWith("Waiting for your yes"));
      const card = (await t.list(t.ada)).find((candidate) => candidate.kind === "question")!;
      next = async () => DONE;
      const instead = await (await t.call("POST", `/api/console/inbox/${card.id}/reply`, t.ada, { text: "Only the kitchen notes" })).json();
      expect(instead.item).toMatchObject({ status: "answered", answer: { optionId: "no" }, replies: [{ kind: "followup", text: "Only the kitchen notes" }] });
      expect(await t.settled(t.ada, big.id)).toMatchObject({ status: "failed", step: "Not run: you said not now. Nothing changed." });
      expect(instead.followUp.followUpOf.id).toBe(card.id);
    } finally {
      await t.close();
    }
  });

  it("Not now on a plan card ends the job with nothing changed; refusals and failures say why", async () => {
    let next: () => Promise<DeskJobResult> = async () => ({ status: "needs_go", plan: PLAN, changes: [], touched: 80, agent: { steps: 2, inputChars: 1 } });
    const t = await setup({ deskJob: vi.fn(async () => next()) });
    try {
      const { item } = await (await t.call("POST", "/api/console/memory-desk/jobs", t.ada, { request: "move all notes under House" })).json();
      await t.settled(t.ada, item.id, (candidate) => (candidate.step ?? "").startsWith("Waiting for your yes"));
      const card = (await t.list(t.ada)).find((candidate) => candidate.kind === "question")!;
      await t.call("POST", `/api/console/inbox/${card.id}/answer`, t.ada, { option: "no" });
      expect((await t.settled(t.ada, item.id))).toMatchObject({ status: "failed", step: "Not run: you said not now. Nothing changed." });

      next = async () => ({ status: "refused", reason: "Deleting is always a question in your inbox first.", agent: { steps: 1, inputChars: 1 } });
      const refused = (await (await t.call("POST", "/api/console/memory-desk/jobs", t.ada, { request: "delete my boat notes" })).json()).item;
      expect(await t.settled(t.ada, refused.id)).toMatchObject({ status: "failed", step: "Deleting is always a question in your inbox first." });

      next = async () => { throw new Error("desk_dirty_worktree"); };
      const broken = (await (await t.call("POST", "/api/console/memory-desk/jobs", t.ada, { request: "rename the Garden topic to Allotment" })).json()).item;
      expect(await t.settled(t.ada, broken.id)).toMatchObject({ status: "failed", step: "Your memory was busy finishing an earlier save. Nothing changed. Try again in a minute." });

      next = async () => { throw new Error("OpenRouter 402: Insufficient credits"); };
      const broke = (await (await t.call("POST", "/api/console/memory-desk/jobs", t.ada, { request: "rename the Garden topic to Plot" })).json()).item;
      expect(await t.settled(t.ada, broke.id)).toMatchObject({ status: "failed", step: "Zenod's AI service did not answer just now. Nothing changed. Try again in a while." });

      next = async () => { throw new Error("TypeError: something odd"); };
      const odd = (await (await t.call("POST", "/api/console/memory-desk/jobs", t.ada, { request: "rename the Garden topic to Yard" })).json()).item;
      expect(await t.settled(t.ada, odd.id)).toMatchObject({ status: "failed", step: "The desk stopped before changing anything. Your memory is as it was." });
    } finally {
      await t.close();
    }
  });

  it("Jordi's question is answered in the inbox: Answered with the answer, nothing to undo", async () => {
    const answer = "In the last 7 days you saved 31 notes, filed under 6 topics; Zenod got the most.";
    const deskJob = vi.fn(async (): Promise<DeskJobResult> => ({ status: "answered", answer, agent: { steps: 2, inputChars: 9_000 } }));
    const t = await setup({ deskJob });
    try {
      const { item } = await (await t.call("POST", "/api/console/memory-desk/jobs", t.ada, { request: "How many root memories added to in last 7 days?" })).json();
      const done = await t.settled(t.ada, item.id);
      expect(done).toMatchObject({ status: "done", title: "How many root memories added to in last 7 days?", result: { summary: answer, changes: [], answer: true } });
      expect((await t.call("POST", `/api/console/inbox/${item.id}/undo`, t.ada)).status).not.toBe(200);
    } finally {
      await t.close();
    }
  });

  it("a job behind a backlog says how many are ahead, and the count drains as the queue does", async () => {
    const t = await setup({ deskJob: vi.fn(async () => DONE) });
    try {
      const a = t.runtimes.get("tenant-a")!;
      const queue = a.taskJobQueue;
      // The queue is held (as during the 2026-11-08 outage, when 24 saves waited) so nothing runs.
      const drain = vi.spyOn(queue as unknown as { requestDrains: () => void }, "requestDrains").mockImplementation(() => {});
      const held = [queue.enqueue("store", { content: "a" } as never), queue.enqueue("store", { content: "b" } as never)];
      const { item } = await (await t.call("POST", "/api/console/memory-desk/jobs", t.ada, { request: "split boat and cabin" })).json();
      expect(item.step).toBe("Waiting for its turn: 2 saves and jobs are ahead of it");
      const store = (queue as unknown as { store: { update(id: string, patch: { status: string }): void } }).store;
      store.update(held[0]!.id, { status: "done" });
      expect((await t.list(t.ada)).find((candidate) => candidate.id === item.id)?.step).toBe("Waiting for its turn: 1 save or job is ahead of it");
      drain.mockRestore();
    } finally {
      await t.close();
    }
  });

  it("stops at the AI allowance and at the daily job cap", async () => {
    const deskJob = vi.fn(async () => DONE);
    const t = await setup({ deskJob });
    try {
      const a = t.runtimes.get("tenant-a")!;
      const block = vi.spyOn(a, "featureBlock").mockReturnValue({ message: "The memory desk is paused.", resetsAt: "2026-12-01T00:00:00.000Z", reason: "allowance" });
      expect((await t.call("POST", "/api/console/memory-desk/jobs", t.ada, { request: "split boat and cabin topics" })).status).toBe(429);
      block.mockRestore();
      const inbox = inboxFor(a);
      for (let i = 0; i < DESK_JOBS_PER_DAY; i++) inbox.post({ kind: "job", from: "Memory desk", title: `job ${i}` });
      const capped = await t.call("POST", "/api/console/memory-desk/jobs", t.ada, { request: "split boat and cabin topics" });
      expect(capped.status).toBe(429);
      expect((await capped.json()).message).toMatch(/jobs a day/);
      expect(deskJob).not.toHaveBeenCalled();
    } finally {
      await t.close();
    }
  });

  it("the Send box hands a job to the desk, and only asks when it is unsure", async () => {
    let route = { action: "job", keep: null, question: null, job: "Idealista and Poly-Maker are tangled, split them", by: "model" } as const;
    const deskJob = vi.fn(async () => DONE);
    const routeSend = vi.fn(async () => route);
    const t = await setup({ deskJob, routeSend: routeSend as unknown as BrainEngine["routeSend"] });
    try {
      const sent = await t.call("POST", "/api/console/memory-send/stream", t.ada, { message: route.job });
      const lines = (await sent.text()).trim().split("\n").map((line) => JSON.parse(line));
      expect(lines.map((line) => line.type)).toEqual(["route", "desk", "done"]);
      expect(lines[1].item).toMatchObject({ status: "working", title: "Idealista and Poly-Maker are tangled, split them" });
      await t.settled(t.ada, lines[1].item.id);
      expect(deskJob).toHaveBeenCalledTimes(1);

      route = { ...route, action: "unsure" } as never;
      const unsure = await t.call("POST", "/api/console/memory-send/stream", t.ada, { message: "clean up my notes" });
      expect((await unsure.text()).trim().split("\n").map((line) => JSON.parse(line).type)).toEqual(["route", "done"]);
      expect(deskJob).toHaveBeenCalledTimes(1);
      expect(t.runtimes.get("tenant-a")!.taskJobStore.recentCaptures(10)).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it("a WhatsApp message that reads like a job is kept as always and only shows in the inbox as run it?", async () => {
    const deskJob = vi.fn(async () => DONE);
    const t = await setup({ deskJob });
    try {
      const a = t.runtimes.get("tenant-a")!;
      const hooks = (a.taskJobQueue as unknown as { deskHooks: TaskJobDeskHooks }).deskHooks;
      const capture = (content: string, id: string) => hooks.afterCapture!({ id, kind: "store", input: { content, source: "whatsapp" } } as never);
      capture("Ana's birthday is May 3", "c1");
      capture("Can you move the couch on Saturday", "c2");
      expect(await t.list(t.ada)).toEqual([]);
      capture("Idealista and Poly-Maker are tangled, please split them", "c3");
      capture("Idealista and Poly-Maker are tangled, please split them", "c3");
      const asks = await t.list(t.ada);
      expect(asks).toHaveLength(1);
      expect(asks[0]).toMatchObject({ kind: "question", from: "Memory desk", title: "This message looks like a job on your memory. Run it?", body: "Idealista and Poly-Maker are tangled, please split them" });
      expect(deskJob).not.toHaveBeenCalled();

      await t.call("POST", `/api/console/inbox/${asks[0]!.id}/answer`, t.ada, { option: "run" });
      const job = (await t.list(t.ada)).find((item) => item.kind === "job")!;
      expect(job.from).toBe("Memory desk");
      expect((await t.settled(t.ada, job.id)).status).toBe("done");
      expect(deskJob).toHaveBeenCalledTimes(1);
      expect(offerDeskJobFromChat(inboxFor(a), "c4", "split the bill with Ana", looksLikeDeskJob)).toBeNull();
    } finally {
      await t.close();
    }
  });
});
