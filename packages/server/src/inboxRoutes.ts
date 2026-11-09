import type { Context, Hono } from "hono";
import {
  INBOX_REPLY_MAX_CHARS,
  INBOX_VOICE_REPLY_MAX_CHARS,
  InboxError,
  SUGGESTION_ACTION_MAX_CHARS,
  exampleSuggestionJob,
  inboxAnswerContent,
  inboxFor,
  inboxNeedsYou,
  postInboxExamples,
  type InboxItem,
} from "./inboxStore.js";
import { DESK_FROM, DESK_REQUEST_MAX_CHARS, DeskLimitError, startDeskJob, type DeskQueue } from "./memoryDesk.js";

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
  /** The limits model's stop for a feature (limits.ts); the inbox only asks it for the memory desk. */
  featureBlock(feature: "desk"): { message: string; resetsAt: string | null } | null;
  readonly taskJobQueue: { enqueue(kind: "store", input: { content: string; source: "web" }, idempotencyKey?: string): { id: string } } & Partial<DeskQueue>;
}

export type InboxResolve<R extends InboxRuntime = InboxRuntime> = (c: Context) => Promise<{ runtime: R; tenantId: string } | { response: Response }>;

/**
 * S26: a voice note left as feedback on a card becomes words the way Zenod transcribes any voice
 * note (the tenant's own transcription settings, the local fallback included). The caller supplies
 * it so this file stays free of the transcription stack.
 */
export type InboxTranscribe<R extends InboxRuntime = InboxRuntime> = (
  runtime: R,
  audio: Buffer,
  filename: string,
) => Promise<{ success: boolean; transcript?: string; error?: string; noSpeech?: boolean }>;

/** The longest voice feedback (5 minutes at the recorder's 32 kbit/s is about 1.2 MB). */
export const VOICE_FEEDBACK_MAX_SECONDS = 5 * 60;
export const VOICE_FEEDBACK_MAX_BYTES = 4 * 1024 * 1024;
const VOICE_FEEDBACK_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
};

/** Cards that take feedback for the helper that wrote them: a finding or a suggestion, not the desk's. */
const takesFeedback = (item: InboxItem) => (item.kind === "finding" || item.kind === "suggestion") && item.from !== DESK_FROM;

const view = (item: InboxItem) => ({ ...item, needsYou: inboxNeedsYou(item) });

function failure(c: Context, error: unknown) {
  if (error instanceof InboxError) {
    const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400;
    return c.json({ error: error.code, message: error.message }, status);
  }
  console.warn(`[inbox] unavailable: ${error instanceof Error ? error.message : String(error)}`);
  return c.json({ error: "inbox unavailable" }, 503);
}

export function registerInboxRoutes<R extends InboxRuntime>(app: Hono<any>, resolve: InboxResolve<R>, options: { transcribe?: InboxTranscribe<R> } = {}): void {
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
        // Keeping the answer is filing, which the AI allowance never stops (EPIC-14 S10).
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

  // EPIC-14 S2 round 3: the reply box on every card, like Epic Team's feedback box. A persona's
  // question: an answer in your own words, filed into the memory like a button's. A finding:
  // feedback kept on the card, read by that persona on its next run. A desk job, or one of the
  // desk's own questions: a follow-up, which starts a new desk job linked to this one (a desk
  // question is first answered "Not now", so its plan does not also run).
  app.post("/api/console/inbox/:id/reply", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const body = await c.req.json<{ text?: unknown }>().catch(() => ({}) as { text?: unknown });
    const words = typeof body.text === "string" ? body.text.trim() : "";
    if (!words) return c.json({ error: "invalid", message: "Write a few words first." }, 400);
    if (words.length > INBOX_REPLY_MAX_CHARS) return c.json({ error: "invalid", message: `Keep it under ${INBOX_REPLY_MAX_CHARS} characters.` }, 400);
    const inbox = inboxFor(found.runtime);
    const done = (id: string) => c.json({ item: view(inbox.get(id)!), needsYou: inbox.needsYouCount() });
    try {
      const item = inbox.get(c.req.param("id"));
      if (!item) throw new InboxError("not_found", "no such inbox item");
      if (takesFeedback(item)) {
        inbox.addReply(item.id, { kind: "feedback", text: words, readAt: null });
        return done(item.id);
      }
      const toDesk = item.kind === "job" || item.from === DESK_FROM;
      if (item.kind === "question" && item.status !== "open") throw new InboxError("conflict", "this question is already answered");
      if (!toDesk) {
        let savedJobId: string | null = null;
        if (!item.example) {
          savedJobId = found.runtime.taskJobQueue.enqueue(
            "store",
            { content: inboxAnswerContent(item, words), source: "web" },
            `${found.tenantId}:inbox-answer:${item.id}`,
          ).id;
        }
        inbox.answerInWords(item.id, words, savedJobId);
        return done(item.id);
      }
      // To the desk. Examples start nothing: the words are kept on the card only.
      if (item.example) {
        if (item.kind === "question") inbox.answerInWords(item.id, words);
        else inbox.addReply(item.id, { kind: "followup", text: words, followUpItemId: null });
        return done(item.id);
      }
      const block = found.runtime.featureBlock("desk");
      if (block) return c.json({ error: "ai_allowance_exhausted", code: "ai_allowance_exhausted", message: block.message, resetsAt: block.resetsAt }, 429);
      const queue = found.runtime.taskJobQueue;
      if (!queue.get || !queue.recent) return c.json({ error: "desk_unavailable", message: "The memory desk is not available here." }, 409);
      const about = item.kind === "job" ? `Follow-up to the job "${item.title}"` : `Instead of: "${item.body ?? item.title}"`;
      const request = `${words}\n\n${about}`.slice(0, DESK_REQUEST_MAX_CHARS);
      const next = startDeskJob(inbox, queue as DeskQueue, request);
      inbox.linkFollowUp(next.id, item);
      if (item.kind === "question" && inbox.answerByDesk(item, "no")) inbox.answer(item.id, "no", null);
      inbox.addReply(item.id, { kind: "followup", text: words, followUpItemId: next.id });
      return c.json({ item: view(inbox.get(item.id)!), followUp: view(inbox.get(next.id)!), needsYou: inbox.needsYouCount() });
    } catch (error) {
      if (error instanceof DeskLimitError) return c.json({ error: "desk_limit", message: error.message }, 429);
      return failure(c, error);
    }
  });

  // EPIC-14 S26: Do it on a suggestion, or Change then "Do it like this" (the body's `action` is the
  // user's edited words). It runs as one memory desk job with Undo, linked to the suggestion; an
  // example starts nothing and shows a made-up finished job instead.
  app.post("/api/console/inbox/:id/do", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const body = await c.req.json<{ action?: unknown }>().catch(() => ({}) as { action?: unknown });
    const inbox = inboxFor(found.runtime);
    try {
      const item = inbox.get(c.req.param("id"));
      if (!item || item.kind !== "suggestion") throw new InboxError("not_found", "no such suggestion in the inbox");
      if (item.status !== "open") throw new InboxError("conflict", "this suggestion is already settled");
      const edited = typeof body.action === "string" ? body.action.trim() : "";
      if (edited.length > SUGGESTION_ACTION_MAX_CHARS) return c.json({ error: "invalid", message: `Keep it under ${SUGGESTION_ACTION_MAX_CHARS} characters.` }, 400);
      const action = edited || item.action || item.title;
      if (item.example) {
        const job = exampleSuggestionJob(inbox, item, action);
        return c.json({ item: view(inbox.acceptSuggestion(item.id, action, job.id)), followUp: view(job), needsYou: inbox.needsYouCount() });
      }
      const block = found.runtime.featureBlock("desk");
      if (block) return c.json({ error: "ai_allowance_exhausted", code: "ai_allowance_exhausted", message: block.message, resetsAt: block.resetsAt }, 429);
      const queue = found.runtime.taskJobQueue;
      if (!queue.get || !queue.recent) return c.json({ error: "desk_unavailable", message: "The memory desk is not available here." }, 409);
      const job = startDeskJob(inbox, queue as DeskQueue, `${action}\n\nSuggested by ${item.from}: "${item.title}"`.slice(0, DESK_REQUEST_MAX_CHARS));
      const linked = inbox.linkFollowUp(job.id, item);
      return c.json({ item: view(inbox.acceptSuggestion(item.id, action, job.id)), followUp: view(linked), needsYou: inbox.needsYouCount() });
    } catch (error) {
      if (error instanceof DeskLimitError) return c.json({ error: "desk_limit", message: error.message }, 429);
      return failure(c, error);
    }
  });

  // EPIC-14 S26: Not now on a suggestion, with an optional reason the helper reads on its next run.
  app.post("/api/console/inbox/:id/not-now", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const body = await c.req.json<{ reason?: unknown }>().catch(() => ({}) as { reason?: unknown });
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length > INBOX_REPLY_MAX_CHARS) return c.json({ error: "invalid", message: `Keep it under ${INBOX_REPLY_MAX_CHARS} characters.` }, 400);
    const inbox = inboxFor(found.runtime);
    try {
      const item = inbox.get(c.req.param("id"));
      if (!item || item.kind !== "suggestion") throw new InboxError("not_found", "no such suggestion in the inbox");
      return c.json({ item: view(inbox.declineSuggestion(item.id, reason)), needsYou: inbox.needsYouCount() });
    } catch (error) {
      return failure(c, error);
    }
  });

  // EPIC-14 S26: Your feedback as a voice note. The body is the audio; `?typed=` carries what was
  // already typed in the box, which goes before the spoken words. The note is transcribed as Zenod
  // transcribes any voice note and kept as feedback on the card, which the helper reads on its next
  // run (like Epic Team's card feedback). Only the words are kept; the audio is not stored.
  app.post("/api/console/inbox/:id/voice-feedback", async (c) => {
    const found = await resolve(c);
    if ("response" in found) return found.response;
    const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const extension = VOICE_FEEDBACK_EXTENSIONS[type];
    if (!extension) return c.json({ error: "unsupported_audio", message: "That recording format is not supported." }, 415);
    const inbox = inboxFor(found.runtime);
    const item = inbox.get(c.req.param("id"));
    if (!item || !takesFeedback(item)) return c.json({ error: "not_found", message: "This card does not take feedback." }, 404);
    if (!options.transcribe) return c.json({ error: "unavailable", message: "Voice notes are not available here." }, 409);
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > VOICE_FEEDBACK_MAX_BYTES) return c.json({ error: "too_large", message: "That voice note is too long. Keep it under 5 minutes." }, 413);
    const audio = Buffer.from(await c.req.arrayBuffer().catch(() => new ArrayBuffer(0)));
    if (audio.length === 0) return c.json({ error: "empty", message: "Nothing was recorded." }, 400);
    if (audio.length > VOICE_FEEDBACK_MAX_BYTES) return c.json({ error: "too_large", message: "That voice note is too long. Keep it under 5 minutes." }, 413);
    const seconds = Number(c.req.header("x-seconds"));
    const duration = Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.round(seconds), VOICE_FEEDBACK_MAX_SECONDS) : null;
    const typed = (c.req.query("typed") ?? "").trim().slice(0, INBOX_REPLY_MAX_CHARS);
    let heard: string;
    try {
      const result = await options.transcribe(found.runtime, audio, `zenod-app-feedback-${item.id}.${extension}`);
      if (!result.success || !result.transcript?.trim()) {
        return c.json({ error: "no_words", message: result.noSpeech ? "No words were heard in that voice note." : "The voice note could not be turned into words. Try again, or type it." }, 422);
      }
      heard = result.transcript.trim();
    } catch (error) {
      console.warn(`[inbox] voice feedback transcription failed: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: "no_words", message: "The voice note could not be turned into words. Try again, or type it." }, 422);
    }
    try {
      const words = (typed ? `${typed}\n\n${heard}` : heard).slice(0, INBOX_VOICE_REPLY_MAX_CHARS);
      inbox.addReply(item.id, { kind: "feedback", text: words, readAt: null, voice: { seconds: duration } });
      return c.json({ item: view(inbox.get(item.id)!), needsYou: inbox.needsYouCount() });
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
    const block = found.runtime.featureBlock("desk");
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
