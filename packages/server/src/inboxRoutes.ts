import type { Context, Hono } from "hono";
import {
  InboxError,
  inboxAnswerContent,
  inboxFor,
  inboxNeedsYou,
  postInboxExamples,
  type InboxItem,
} from "./inboxStore.js";
import { DESK_REQUEST_MAX_CHARS, DeskLimitError, startDeskJob, type DeskQueue } from "./memoryDesk.js";

/**
 * The inbox's web routes (EPIC-14 S2). The tenant comes from the signed-in session only: the
 * caller passes `resolve`, which reads the session and returns that account's runtime, or a
 * Response to send instead. Item ids are looked up in that tenant's own inbox file, so another
 * tenant's id is simply not found.
 */

/** What the routes need of a tenant runtime: its data directory and the durable store queue. */
export interface InboxRuntime {
  readonly dataDir: string;
  readonly inboxDeskHooks?: import("./inboxStore.js").InboxDeskHooks;
  readonly tenantId?: string;
  aiAllowanceBlock(): { message: string; resetsAt: string | null } | null;
  readonly taskJobQueue: { enqueue(kind: "store", input: { content: string; source: "web" }, idempotencyKey?: string): { id: string } } & Partial<DeskQueue>;
}

export type InboxResolve = (c: Context) => Promise<{ runtime: InboxRuntime; tenantId: string } | { response: Response }>;

const view = (item: InboxItem) => ({ ...item, needsYou: inboxNeedsYou(item) });

function failure(c: Context, error: unknown) {
  if (error instanceof InboxError) {
    const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400;
    return c.json({ error: error.code, message: error.message }, status);
  }
  console.warn(`[inbox] unavailable: ${error instanceof Error ? error.message : String(error)}`);
  return c.json({ error: "inbox unavailable" }, 503);
}

export function registerInboxRoutes(app: Hono<any>, resolve: InboxResolve): void {
  app.get("/api/console/inbox", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const inbox = inboxFor(found.runtime);
    inbox.refresh();
    const items = inbox.list();
    return c.json({ items: items.map(view), needsYou: items.filter(inboxNeedsYou).length });
  });

  // The tab's count, polled by the app.
  app.get("/api/console/inbox/count", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    return c.json({ needsYou: inboxFor(found.runtime).needsYouCount() });
  });

  // The user opened the inbox: the items it showed are now seen.
  app.post("/api/console/inbox/seen", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const body = await c.req.json<{ ids?: unknown }>().catch(() => ({}) as { ids?: unknown });
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string").slice(0, 500) : undefined;
    const inbox = inboxFor(found.runtime);
    inbox.markSeen(ids);
    return c.json({ needsYou: inbox.needsYouCount() });
  });

  // Answer a question: the answer is filed into the memory repo (the same durable store job the
  // chat's Keep uses), then recorded on the item. Example questions save nothing.
  app.post("/api/console/inbox/:id/answer", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const body = await c.req.json<{ option?: unknown }>().catch(() => ({}) as { option?: unknown });
    const optionId = typeof body.option === "string" ? body.option : "";
    const inbox = inboxFor(found.runtime);
    try {
      const item = inbox.get(c.req.param("id"));
      if (!item || item.kind !== "question") throw new InboxError("not_found", "no such question in the inbox");
      if (item.status !== "open") throw new InboxError("conflict", "this question is already answered");
      const option = item.options.find((candidate) => candidate.id === optionId);
      if (!option) throw new InboxError("invalid", "not one of the choices");
      let savedJobId: string | null = null;
      // The memory desk's own questions (a plan card, "run it?") start or cancel a job instead.
      if (!item.example && inbox.answerByDesk(item, option.id)) {
        return c.json({ item: view(inbox.answer(item.id, option.id, null)), needsYou: inbox.needsYouCount() });
      }
      if (!item.example) {
        const block = found.runtime.aiAllowanceBlock();
        if (block) return c.json({ error: "ai_allowance_exhausted", code: "ai_allowance_exhausted", message: block.message, resetsAt: block.resetsAt }, 429);
        const job = found.runtime.taskJobQueue.enqueue(
          "store",
          { content: inboxAnswerContent(item, option.label), source: "web" },
          `${found.tenantId}:inbox-answer:${item.id}`,
        );
        savedJobId = job.id;
      }
      return c.json({ item: view(inbox.answer(item.id, option.id, savedJobId)), needsYou: inbox.needsYouCount() });
    } catch (error) {
      return failure(c, error);
    }
  });

  // "Got it" on a finding, "Good" on a finished job.
  app.post("/api/console/inbox/:id/dismiss", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const inbox = inboxFor(found.runtime);
    try {
      return c.json({ item: view(inbox.dismiss(c.req.param("id"))), needsYou: inbox.needsYouCount() });
    } catch (error) {
      return failure(c, error);
    }
  });

  // Undo a finished desk job: the memory desk puts the memory back, then the item says so.
  app.post("/api/console/inbox/:id/undo", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const inbox = inboxFor(found.runtime);
    try {
      return c.json({ item: view(await inbox.undoJob(c.req.param("id"))), needsYou: inbox.needsYouCount() });
    } catch (error) {
      return failure(c, error);
    }
  });

  // EPIC-14 S3: "Ask the desk". Starts a memory desk job from a short description; the job shows
  // in the inbox at once as Working and reports there. The Send box starts the same job when it
  // reads a message as a job on the memory.
  app.post("/api/console/memory-desk/jobs", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const body = await c.req.json<{ request?: unknown }>().catch(() => ({}) as { request?: unknown });
    const request = typeof body.request === "string" ? body.request.trim() : "";
    if (!request) return c.json({ error: "invalid", message: "Say in a few words what the desk should do." }, 400);
    if (request.length > DESK_REQUEST_MAX_CHARS) return c.json({ error: "invalid", message: `Keep it under ${DESK_REQUEST_MAX_CHARS} characters.` }, 400);
    const block = found.runtime.aiAllowanceBlock();
    if (block) return c.json({ error: "ai_allowance_exhausted", code: "ai_allowance_exhausted", message: block.message, resetsAt: block.resetsAt }, 429);
    const queue = found.runtime.taskJobQueue;
    if (!queue.get || !queue.recent) return c.json({ error: "desk_unavailable", message: "The memory desk is not available here." }, 409);
    const inbox = inboxFor(found.runtime);
    try {
      const item = startDeskJob(inbox, queue as DeskQueue, request);
      return c.json({ item: view(item), needsYou: inbox.needsYouCount() }, 202);
    } catch (error) {
      if (error instanceof DeskLimitError) return c.json({ error: "desk_limit", message: error.message }, 429);
      return failure(c, error);
    }
  });

  // The empty inbox's "Show examples" and "Clear examples": demo items of each kind.
  app.post("/api/console/inbox/examples", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const inbox = inboxFor(found.runtime);
    postInboxExamples(inbox);
    return c.json({ items: inbox.list().map(view), needsYou: inbox.needsYouCount() });
  });

  app.delete("/api/console/inbox/examples", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const inbox = inboxFor(found.runtime);
    inbox.clearExamples();
    return c.json({ items: inbox.list().map(view), needsYou: inbox.needsYouCount() });
  });
}
