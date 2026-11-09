import type { BrainEngine, DeskChangeView, DeskEdit, DeskJobResult, DeskPlan } from "zenod";
import type { InboxChange, InboxItem, InboxJobResult, InboxStore } from "./inboxStore.js";
import type { TaskJob, TaskJobInput } from "./taskJobStore.js";
import { zenodLimits } from "./limits.js";

/**
 * The memory desk on the server (EPIC-14 S3). A job on the memory is a durable `desk_job` on the
 * tenant's own job queue (the serial lane, beside filings and the weekly sweep) and one inbox item:
 * Working with its current step, then Done with what changed, the same search before and after,
 * See the changes and Undo. A big job first posts a plan card ("Run it?") and waits for the yes. A
 * message on WhatsApp or Telegram that reads like a job is kept as always and only shows in the
 * inbox as "run it?"; nothing is ever sent to a chat (root L-6). Types only from "zenod": this file
 * is bundled where the core runtime is not.
 */

export const DESK_FROM = "Memory desk";
/** Jobs one account may start in a day: each is a few model calls, metered in the AI allowance (limits.ts). */
export const DESK_JOBS_PER_DAY = zenodLimits().desk.jobsPerDay;
export const DESK_REQUEST_MAX_CHARS = 600;

/** What a finished desk job leaves as its task result: enough for the inbox and for Undo. */
export interface DeskJobReceipt {
  kind: "desk_job";
  status: DeskJobResult["status"] | "undone";
  title: string;
  reason?: string;
  plan?: DeskPlan;
  edits?: DeskEdit[];
  touched?: number;
  revision?: string | null;
  changesUrl?: string | null;
  steps: number;
  inputChars: number;
}

export interface DeskQueue {
  enqueue(kind: "desk_job", input: TaskJobInput): { id: string };
  get(id: string): TaskJob | null;
  recent(limit?: number): TaskJob[];
}

export class DeskLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeskLimitError";
  }
}

const jobKey = (taskJobId: string) => `desk:${taskJobId}`;
const goKey = (taskJobId: string) => `desk-go:${taskJobId}`;
const askKey = (captureJobId: string) => `desk-ask:${captureJobId}`;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The jobs the queue runs before this one (one serial lane: saves, filings, sweeps, desk jobs). */
export function jobsAhead(queue: DeskQueue, job: TaskJob): number {
  return queue.recent(500).filter((other) => other.id !== job.id && (other.status === "queued" || other.status === "running") && other.createdAt <= job.createdAt).length;
}

/** "Waiting for its turn", and how many jobs are ahead when there are any. */
export function waitingStep(ahead: number, prefix = "Waiting for its turn"): string {
  if (ahead <= 0) return prefix;
  return `${prefix}: ${ahead} ${ahead === 1 ? "save or job is" : "saves and jobs are"} ahead of it`;
}

/** A short job name from the request, until the desk names it. */
export function deskTitle(request: string): string {
  const line = request.trim().split("\n")[0]!.replace(/\s+/g, " ");
  return clip(line.charAt(0).toUpperCase() + line.slice(1), 90);
}

/**
 * Start a desk job: queue it and show it in the inbox at once as Working. `plan` is an approved
 * plan (the yes on a plan card): it is applied as is.
 */
export function startDeskJob(inbox: InboxStore, queue: DeskQueue, request: string, options: { plan?: DeskPlan; itemKey?: string; now?: Date } = {}): InboxItem {
  const text = request.trim().slice(0, DESK_REQUEST_MAX_CHARS);
  if (!text) throw new DeskLimitError("Say in a few words what the desk should do.");
  const day = (options.now ?? new Date()).toISOString().slice(0, 10);
  const today = inbox.list(500).filter((item) => item.kind === "job" && !item.example && item.from === DESK_FROM && item.createdAt.startsWith(day)).length;
  if (today >= DESK_JOBS_PER_DAY) throw new DeskLimitError(`The desk takes ${DESK_JOBS_PER_DAY} jobs a day. Try again tomorrow.`);
  if (options.itemKey) {
    // The yes on a plan card: the same inbox item carries on.
    const existing = inbox.get(findItemId(inbox, options.itemKey));
    if (existing) {
      const again = queue.enqueue("desk_job", { deskRequest: text, deskItemKey: options.itemKey, ...(options.plan ? { deskPlan: options.plan } : {}) });
      const queued = queue.get(again.id);
      return inbox.updateJob(existing.id, { status: "working", step: waitingStep(queued ? jobsAhead(queue, queued) : 0, "You said yes. Waiting for its turn") });
    }
  }
  const job = queue.enqueue("desk_job", { deskRequest: text, ...(options.plan ? { deskPlan: options.plan } : {}) });
  const queued = queue.get(job.id);
  return inbox.post({
    kind: "job", from: DESK_FROM, sourceKey: jobKey(job.id),
    title: options.plan?.title ?? deskTitle(text),
    // The request in full under its title, unless the title already holds all of it.
    ...(options.plan ? { body: `You said yes to the plan. "${clip(text, 300)}"` } : deskTitle(text).endsWith("…") || text.includes("\n") ? { body: `"${clip(text, 300)}"` } : {}),
    step: waitingStep(queued ? jobsAhead(queue, queued) : 0),
  });
}

function toInboxResult(result: Extract<DeskJobResult, { status: "done" }>, changesUrl: string | null): InboxJobResult {
  const changes: InboxChange[] = result.changes.map((change: DeskChangeView) => ({ what: change.what, ...(change.before ? { before: change.before } : {}), ...(change.after ? { after: change.after } : {}) }));
  const memories = `${result.touched} ${result.touched === 1 ? "memory" : "memories"}`;
  return {
    summary: `${result.plan.summary} ${memories} changed place or links, in one change you can undo.`.trim(),
    changes,
    search: result.search,
    ...(changesUrl ? { changesUrl } : {}),
  };
}

const failStep = (reason: string) => clip(reason.replace(/\s+/g, " "), 280);

/** Run one desk job (the queue's durable lane calls this) and move its inbox item along. */
export async function runDeskJob(job: TaskJob, engine: BrainEngine, inbox: InboxStore, assertActive?: () => void): Promise<DeskJobReceipt> {
  const request = job.input.deskRequest ?? "";
  const key = itemKeyOf(job);
  const item = inbox.get(findItemId(inbox, key)) ?? inbox.post({ kind: "job", from: DESK_FROM, sourceKey: key, title: deskTitle(request), step: "Starting" });
  const step = (text: string) => {
    try { inbox.updateJob(item.id, { status: "working", step: text }); } catch { /* the item may have been put away */ }
  };
  if (!engine.deskJob) {
    inbox.updateJob(item.id, { status: "failed", step: "The memory desk is not available for this memory." });
    return { kind: "desk_job", status: "refused", title: item.title, reason: "no desk", steps: 0, inputChars: 0 };
  }
  step(job.input.deskPlan ? "Making the changes you said yes to" : "Reading your memory");
  const result = await engine.deskJob({
    request,
    ...(job.input.deskPlan ? { plan: job.input.deskPlan, maxTouched: Number.POSITIVE_INFINITY } : {}),
    onStep: step,
    ...(assertActive ? { assertActive } : {}),
  });
  const use = { steps: result.agent.steps, inputChars: result.agent.inputChars };
  if (result.status === "answered") {
    // A question about the memory: the answer is the result, nothing changed, nothing to undo.
    inbox.updateJob(item.id, { status: "done", result: { summary: result.answer, changes: [], answer: true } });
    return { kind: "desk_job", status: "answered", title: item.title, reason: result.answer, ...use };
  }
  if (result.status === "refused" || result.status === "nothing") {
    inbox.updateJob(item.id, { status: "failed", step: failStep(result.reason) });
    return { kind: "desk_job", status: result.status, title: item.title, reason: result.reason, ...use };
  }
  if (result.status === "needs_go") {
    step(`Waiting for your yes: this job would change ${result.touched} memories`);
    inbox.post({
      kind: "question", from: DESK_FROM, sourceKey: goKey(job.id),
      title: `${result.plan.title}: this would change ${result.touched} memories. Run it?`,
      body: [result.plan.summary, ...result.changes.slice(0, 8).map((change) => `· ${change.what}${change.after ? ` → ${change.after}` : ""}`), result.changes.length > 8 ? `· and ${result.changes.length - 8} more` : ""].filter(Boolean).join("\n"),
      options: [{ id: "run", label: "Run it" }, { id: "no", label: "Not now" }],
    });
    return { kind: "desk_job", status: "needs_go", title: result.plan.title, plan: result.plan, touched: result.touched, ...use };
  }
  const done = result as Extract<DeskJobResult, { status: "done" }>;
  const revision = done.revision.commitSha ?? done.revision.id;
  const changesUrl = done.revision.urls?.[0] ?? null;
  inbox.updateJob(item.id, { status: "done", result: toInboxResult(done, changesUrl && /^https?:\/\//.test(changesUrl) ? changesUrl : null) });
  return {
    kind: "desk_job", status: "done", title: done.plan.title, plan: done.plan, edits: done.edits, touched: done.touched,
    revision, changesUrl, ...use,
  };
}

const itemKeyOf = (job: TaskJob) => job.input.deskItemKey ?? jobKey(job.id);

function findItemId(inbox: InboxStore, sourceKey: string): string {
  return inbox.list(500).find((candidate) => candidate.sourceKey === sourceKey)?.id ?? "";
}

/** A desk job that failed or was cut off by a restart: its inbox item says so instead of working forever. */
export function deskJobFailed(inbox: InboxStore, job: TaskJob, error: string): void {
  const id = findItemId(inbox, itemKeyOf(job));
  const item = id ? inbox.get(id) : null;
  if (!item || item.status !== "working") return;
  const reason = /allowance/i.test(error) ? error : /^The desk|^Undo|is not a page|cannot go|no link line|already a topic|cited only|changed since/.test(error)
    ? error
    : /\b402\b|credit|insufficient|quota|rate.?limit|\b429\b/i.test(error)
      ? "Zenod's AI service did not answer just now. Nothing changed. Try again in a while."
      : /filing_recovery_pending|desk_dirty_worktree/.test(error)
        ? "Your memory was busy finishing an earlier save. Nothing changed. Try again in a minute."
        : "The desk stopped before changing anything. Your memory is as it was.";
  inbox.updateJob(id, { status: "failed", step: failStep(reason) });
}

/** On opening the inbox: working desk items whose job ended without a result are marked failed. */
export function settleDeskItems(inbox: InboxStore, queue: DeskQueue): void {
  for (const item of inbox.list(200)) {
    if (item.kind !== "job" || item.status !== "working" || !item.sourceKey?.startsWith("desk:")) continue;
    const jobs = deskJobsFor(item, queue);
    const job = jobs[0];
    if (job && (job.status === "error" || job.status === "interrupted")) deskJobFailed(inbox, job, job.error ?? "interrupted");
    else if (job?.status === "queued" && item.step?.includes("Waiting for its turn")) {
      // Keep "how many are ahead" true while the queue drains (after an outage it can be dozens).
      const prefix = item.step.startsWith("You said yes") ? "You said yes. Waiting for its turn" : "Waiting for its turn";
      const step = waitingStep(jobsAhead(queue, job), prefix);
      if (step !== item.step) inbox.updateJob(item.id, { status: "working", step });
    }
  }
}

/** Undo for a desk job's inbox item: its edits put back, as one more commit. */
/** The desk jobs behind one inbox item, newest first: the job itself, then a yes on its plan card. */
function deskJobsFor(item: InboxItem, queue: DeskQueue): TaskJob[] {
  const key = item.sourceKey ?? "";
  if (!key.startsWith("desk:")) return [];
  const first = queue.get(key.slice("desk:".length));
  const later = queue.recent(500).filter((job) => job.kind === "desk_job" && job.input.deskItemKey === key);
  return [...later.sort((a, b) => b.createdAt - a.createdAt), ...(first ? [first] : [])];
}

export async function undoDeskItem(item: InboxItem, engine: BrainEngine, queue: DeskQueue): Promise<void> {
  const job = deskJobsFor(item, queue).find((candidate) => (candidate.result as DeskJobReceipt | null)?.status === "done");
  const receipt = job?.result as DeskJobReceipt | null | undefined;
  if (!receipt || receipt.kind !== "desk_job" || receipt.status !== "done" || !receipt.edits?.length) throw new Error("this job has nothing to undo");
  if (!engine.undoDeskJob) throw new Error("undo is not available for this memory");
  await engine.undoDeskJob({ title: receipt.title, edits: receipt.edits });
}

/**
 * Answers the desk owns (not filed into the memory as notes): the yes on a plan card, and "run it?"
 * on a job asked over WhatsApp. Returns false for any other question.
 */
export function answerDeskQuestion(item: InboxItem, optionId: string, inbox: InboxStore, queue: DeskQueue): boolean {
  const key = item.sourceKey ?? "";
  if (key.startsWith("desk-go:")) {
    const job = queue.get(key.slice("desk-go:".length));
    const receipt = job?.result as DeskJobReceipt | null | undefined;
    const itemKey = job ? itemKeyOf(job) : jobKey(key.slice("desk-go:".length));
    if (optionId === "run" && receipt?.plan && job) {
      startDeskJob(inbox, queue, job.input.deskRequest ?? receipt.title, { plan: receipt.plan, itemKey });
    } else {
      const jobItemId = findItemId(inbox, itemKey);
      try {
        if (jobItemId) inbox.updateJob(jobItemId, { status: "failed", step: "Not run: you said not now. Nothing changed." });
      } catch { /* already settled */ }
    }
    return true;
  }
  if (key.startsWith("desk-ask:")) {
    if (optionId === "run") startDeskJob(inbox, queue, item.body ?? item.title);
    return true;
  }
  return false;
}

/**
 * Root L-6: a WhatsApp or Telegram message is kept and answered exactly as before. When the plain
 * rules read it as a job on the memory, it also shows in the inbox as "run it?" (no model call).
 */
export function offerDeskJobFromChat(inbox: InboxStore, captureJobId: string, content: string, looksLikeJob: (text: string) => boolean): InboxItem | null {
  const text = content.trim();
  if (!text || text.length > DESK_REQUEST_MAX_CHARS || !looksLikeJob(text)) return null;
  return inbox.post({
    kind: "question", from: DESK_FROM, sourceKey: askKey(captureJobId),
    title: "This message looks like a job on your memory. Run it?",
    body: text,
    options: [{ id: "run", label: "Run it" }, { id: "no", label: "No, it was a note" }],
  });
}
