import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { openZenodSqlite } from "./sqlite.js";

/**
 * The inbox (EPIC-14 S2): one place in the web app for what is addressed to the user. Four kinds:
 * a helper's question (decide), a helper's finding (read), a helper's suggestion (S26: one change it
 * proposes, with Do it, Change, Not now and Your feedback; Do it runs it as one memory desk job) and
 * a memory desk job (Working with its current step, then Done with what changed, a before and after
 * search, See the changes and Undo). Helpers were called personas until S25; their code keeps that name.
 * One SQLite file per tenant on the /data volume, beside the tenant's other stores, so an item can
 * never be read across tenants. Answers are not kept here only: the routes file each answer into the
 * user's memory repo through the durable store job (the repo is the truth, this is a copy).
 *
 * Later steps post and update items through this module's own API, in process: the memory desk
 * (S3) posts a job and moves it along, personas (S4) post questions and findings. Nothing here
 * sends anything to WhatsApp or any chat (root L-6).
 */

export type InboxKind = "question" | "finding" | "job" | "suggestion";

/**
 * open: needs the user; answered: a question with an answer; dismissed: a finding or a finished job
 * read and put away; accepted: a suggestion the user pressed Do it on (its desk job carries on);
 * declined: a suggestion put away with Not now.
 */
export type InboxStatus = "open" | "answered" | "dismissed" | "working" | "done" | "failed" | "undone" | "accepted" | "declined";

export interface InboxOption {
  id: string;
  label: string;
}

export interface InboxLink {
  label: string;
  /** A vault path, opened in the app's Memory tab. */
  path: string;
}

export interface InboxChange {
  /** One line: what moved, joined, was relinked or renamed. */
  what: string;
  before?: string;
  after?: string;
}

export interface InboxJobResult {
  /** One or two sentences: what changed. */
  summary: string;
  changes: InboxChange[];
  /** The before and after search: the same query, its top results before and after the job. */
  search?: { query: string; before: string[]; after: string[] };
  /** Where the full change can be read, for example the job's commit. */
  changesUrl?: string;
  /** True when the job was a question: the summary is the answer, nothing changed, nothing to undo. */
  answer?: boolean;
}

/**
 * What the user wrote back on a card (EPIC-14 S2 round 3), like Epic Team's feedback box: an answer
 * in their own words (a question), feedback to the helper (a finding or a suggestion; it reads it on
 * its next run), a follow-up for the desk (a job; it starts a new job linked to this one), or the
 * reason given with Not now on a suggestion (S26; the helper reads it on its next run too).
 */
export interface InboxReply {
  kind: "answer" | "feedback" | "followup" | "notnow";
  text: string;
  at: string;
  /** answer: the store job that filed it into the memory. */
  savedJobId?: string | null;
  /** followup: the new desk job's inbox item. */
  followUpItemId?: string | null;
  /** feedback and notnow: when the helper's run read it. */
  readAt?: string | null;
  /** feedback given as a voice note (S26): its length; the words are its transcript, the audio is not kept. */
  voice?: { seconds: number | null } | null;
}

/** S26: what Do it did on a suggestion: the desk job it started, and the words it ran with. */
export interface InboxSuggestionDone {
  /** The desk job's inbox item; null for an example, which starts nothing. */
  jobItemId: string | null;
  /** The change as it ran: the helper's words, or the user's after Change. */
  action: string;
  /** True when the user changed the words first. */
  changed: boolean;
  at: string;
}

export interface InboxItem {
  id: string;
  kind: InboxKind;
  status: InboxStatus;
  /** Who it is from: a persona's name or "Memory desk". */
  from: string;
  /** The question, the finding or the job's name, in plain words. */
  title: string;
  /** Optional longer text under the title. */
  body: string | null;
  /** question: two or three choices, the recommended one first. */
  options: InboxOption[];
  recommended: string | null;
  answer: { optionId: string; label: string; at: string; savedJobId: string | null } | null;
  /** finding: the memories behind it. */
  links: InboxLink[];
  /** job: the step it is on while working. */
  step: string | null;
  result: InboxJobResult | null;
  /** What the user wrote back on this card, oldest first. */
  replies: InboxReply[];
  /** job: the earlier job this one follows up. */
  followUpOf: { id: string; title: string } | null;
  /** suggestion (S26): the change in words, as the memory desk would run it. */
  action: string | null;
  /** suggestion: what Do it started, once pressed. */
  done: InboxSuggestionDone | null;
  /** True for the example items the empty inbox can show; they never write to the memory. */
  example: boolean;
  /** The poster's own key, so posting the same thing twice keeps one item. */
  sourceKey: string | null;
  createdAt: string;
  updatedAt: string;
  /** When the user last saw this item; null means it is new to them. */
  seenAt: string | null;
}

export type InboxPost =
  | { kind: "question"; from: string; title: string; body?: string; options: InboxOption[]; recommended?: string; links?: InboxLink[]; sourceKey?: string; example?: boolean }
  | { kind: "finding"; from: string; title: string; body?: string; links?: InboxLink[]; sourceKey?: string; example?: boolean }
  | { kind: "job"; from?: string; title: string; body?: string; step?: string; sourceKey?: string; example?: boolean }
  | { kind: "suggestion"; from: string; title: string; body?: string; action: string; links?: InboxLink[]; sourceKey?: string; example?: boolean };

/** What a desk job reports as it goes: a new step, then done (with its result) or failed. */
export type InboxJobUpdate =
  | { status: "working"; step: string }
  | { status: "done"; result: InboxJobResult }
  | { status: "failed"; step: string }
  | { status: "undone" };

/** Undo for a desk job (set by the memory desk, S3): puts the memory back, for example by reverting the job's commit. */
export type InboxUndo = (item: InboxItem) => Promise<void>;

/**
 * What the memory desk (S3) plugs into a tenant's inbox: Undo for its jobs, the answers it owns
 * (a plan card's yes, "run it?"; true when handled, so the answer is not filed as a note), and a
 * look before listing (a job cut off by a restart is marked failed).
 */
export interface InboxDeskHooks {
  undo: InboxUndo;
  answer(item: InboxItem, optionId: string): boolean;
  refresh?(store: InboxStore): void;
}

export class InboxError extends Error {
  constructor(readonly code: "not_found" | "invalid" | "conflict", message: string) {
    super(message);
    this.name = "InboxError";
  }
}

const MAX_TITLE = 500;
const MAX_BODY = 4_000;
const MAX_OPTIONS = 3;
const MAX_LINKS = 12;
const MAX_CHANGES = 50;

interface Row {
  id: string;
  kind: string;
  status: string;
  data: string;
  example: number;
  source_key: string | null;
  created_at: string;
  updated_at: string;
  seen_at: string | null;
}

type ItemData = Pick<InboxItem, "from" | "title" | "body" | "options" | "recommended" | "answer" | "links" | "step" | "result"> &
  Partial<Pick<InboxItem, "replies" | "followUpOf" | "action" | "done">>;

export const INBOX_REPLY_MAX_CHARS = 1_000;
/** A voice note's words can run longer than a typed reply: about five minutes of speech. */
export const INBOX_VOICE_REPLY_MAX_CHARS = 5_000;
/** A suggestion's change, in words the desk runs: the desk's own request limit. */
export const SUGGESTION_ACTION_MAX_CHARS = 600;
const MAX_REPLIES = 20;

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

function rowToItem(row: Row): InboxItem {
  const data = JSON.parse(row.data) as ItemData;
  return {
    id: row.id,
    kind: row.kind as InboxKind,
    status: row.status as InboxStatus,
    from: data.from,
    title: data.title,
    body: data.body ?? null,
    options: data.options ?? [],
    recommended: data.recommended ?? null,
    answer: data.answer ?? null,
    links: data.links ?? [],
    step: data.step ?? null,
    result: data.result ?? null,
    replies: data.replies ?? [],
    followUpOf: data.followUpOf ?? null,
    action: data.action ?? null,
    done: data.done ?? null,
    example: row.example === 1,
    sourceKey: row.source_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seenAt: row.seen_at,
  };
}

const cleanLinks = (links: InboxLink[] | undefined): InboxLink[] =>
  (links ?? [])
    .map((link) => ({ label: text(link.label, 200), path: text(link.path, 500) }))
    .filter((link) => link.label && link.path && !link.path.startsWith("/") && !link.path.split("/").includes(".."))
    .slice(0, MAX_LINKS);

function cleanResult(result: InboxJobResult): InboxJobResult {
  const summary = text(result.summary, MAX_BODY);
  if (!summary) throw new InboxError("invalid", "a done job needs a summary");
  const list = (values: unknown) => (Array.isArray(values) ? values.map((value) => text(value, 300)).filter(Boolean).slice(0, 10) : []);
  return {
    summary,
    changes: (result.changes ?? [])
      .map((change) => ({ what: text(change.what, 300), ...(change.before ? { before: text(change.before, 300) } : {}), ...(change.after ? { after: text(change.after, 300) } : {}) }))
      .filter((change) => change.what)
      .slice(0, MAX_CHANGES),
    ...(result.search && text(result.search.query, 300)
      ? { search: { query: text(result.search.query, 300), before: list(result.search.before), after: list(result.search.after) } }
      : {}),
    ...(result.changesUrl && /^https?:\/\//.test(result.changesUrl) ? { changesUrl: result.changesUrl } : {}),
    ...(result.answer === true ? { answer: true } : {}),
  };
}

/** True when the item needs the user: an open question, or anything new they have not seen yet. */
export function inboxNeedsYou(item: InboxItem): boolean {
  if (item.kind === "question" || item.kind === "suggestion") return item.status === "open";
  return item.seenAt === null && item.status !== "dismissed";
}

export class InboxStore {
  private readonly db: DatabaseSync;
  private closed = false;
  private undo: InboxUndo | null = null;
  private deskAnswer: InboxDeskHooks["answer"] | null = null;
  private deskRefresh: InboxDeskHooks["refresh"] | null = null;

  constructor(path: string, private readonly now: () => Date = () => new Date()) {
    this.db = openZenodSqlite(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inbox_items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        data TEXT NOT NULL,
        example INTEGER NOT NULL DEFAULT 0,
        source_key TEXT UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        seen_at TEXT
      );
      CREATE INDEX IF NOT EXISTS inbox_items_updated ON inbox_items(updated_at);
    `);
  }

  /** Post an item. Posting with a sourceKey already used returns the existing item unchanged. */
  post(input: InboxPost): InboxItem {
    const sourceKey = input.sourceKey ? text(input.sourceKey, 300) : null;
    if (sourceKey) {
      const existing = this.db.prepare(`SELECT * FROM inbox_items WHERE source_key=?`).get(sourceKey) as Row | undefined;
      if (existing) return rowToItem(existing);
    }
    const title = text(input.title, MAX_TITLE);
    if (!title) throw new InboxError("invalid", "an inbox item needs a title");
    const from = text(input.kind === "job" ? input.from ?? "Memory desk" : input.from, 100);
    if (!from) throw new InboxError("invalid", "an inbox item needs a sender");
    const data: ItemData = {
      from, title, body: text(input.body, MAX_BODY) || null,
      options: [], recommended: null, answer: null, links: [], step: null, result: null,
    };
    let status: InboxStatus = "open";
    if (input.kind === "question") {
      const seen = new Set<string>();
      data.options = (input.options ?? [])
        .map((option) => ({ id: text(option.id, 60), label: text(option.label, 120) }))
        .filter((option) => option.id && option.label && !seen.has(option.id) && seen.add(option.id))
        .slice(0, MAX_OPTIONS);
      if (data.options.length < 2) throw new InboxError("invalid", "a question needs two or three choices");
      data.recommended = data.options.some((option) => option.id === input.recommended) ? input.recommended! : null;
      // The recommendation leads (Epic Team's ask shape): it is the first button.
      if (data.recommended) data.options.sort((a, b) => Number(b.id === data.recommended) - Number(a.id === data.recommended));
      data.links = cleanLinks(input.links);
    } else if (input.kind === "finding") {
      data.links = cleanLinks(input.links);
    } else if (input.kind === "suggestion") {
      data.action = text(input.action, SUGGESTION_ACTION_MAX_CHARS);
      if (!data.action) throw new InboxError("invalid", "a suggestion needs the change it proposes");
      data.links = cleanLinks(input.links);
    } else {
      status = "working";
      data.step = text(input.step, 300) || "Starting";
    }
    const at = this.now().toISOString();
    const id = randomUUID();
    this.db
      .prepare(`INSERT INTO inbox_items (id, kind, status, data, example, source_key, created_at, updated_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
      .run(id, input.kind, status, JSON.stringify(data), input.example ? 1 : 0, sourceKey, at, at);
    return this.get(id)!;
  }

  get(id: string): InboxItem | null {
    const row = this.db.prepare(`SELECT * FROM inbox_items WHERE id=?`).get(id) as Row | undefined;
    return row ? rowToItem(row) : null;
  }

  /** Newest first by last change, so a job that just finished comes to the top. */
  list(limit = 100): InboxItem[] {
    const rows = this.db.prepare(`SELECT * FROM inbox_items ORDER BY updated_at DESC, created_at DESC LIMIT ?`).all(limit) as unknown as Row[];
    return rows.map(rowToItem);
  }

  /** The tab's count: open questions and anything new. */
  needsYouCount(): number {
    return this.list(500).filter(inboxNeedsYou).length;
  }

  /** The user opened the inbox: everything shown is now seen (open questions still count until answered). */
  markSeen(ids?: string[]): number {
    const at = this.now().toISOString();
    if (!ids) return Number(this.db.prepare(`UPDATE inbox_items SET seen_at=? WHERE seen_at IS NULL`).run(at).changes);
    let changed = 0;
    for (const id of ids) changed += Number(this.db.prepare(`UPDATE inbox_items SET seen_at=? WHERE id=? AND seen_at IS NULL`).run(at, id).changes);
    return changed;
  }

  /** Record the user's answer to a question. The caller files it into the memory and passes the job id. */
  answer(id: string, optionId: string, savedJobId: string | null = null): InboxItem {
    const item = this.require(id, "question");
    if (item.status !== "open") throw new InboxError("conflict", "this question is already answered");
    const option = item.options.find((candidate) => candidate.id === optionId);
    if (!option) throw new InboxError("invalid", "not one of the choices");
    return this.write(item, "answered", { answer: { optionId: option.id, label: option.label, at: this.now().toISOString(), savedJobId } }, true);
  }

  /** A question answered in the user's own words instead of a button. */
  answerInWords(id: string, words: string, savedJobId: string | null = null): InboxItem {
    const item = this.require(id, "question");
    if (item.status !== "open") throw new InboxError("conflict", "this question is already answered");
    const label = text(words, INBOX_REPLY_MAX_CHARS);
    if (!label) throw new InboxError("invalid", "write a few words first");
    const at = this.now().toISOString();
    return this.write(item, "answered", {
      answer: { optionId: "words", label, at, savedJobId },
      replies: [...item.replies, { kind: "answer" as const, text: label, at, savedJobId }].slice(-MAX_REPLIES),
    }, true);
  }

  /** Keep what the user wrote back on a card (feedback to a persona, a follow-up for the desk). */
  addReply(id: string, reply: Omit<InboxReply, "at">): InboxItem {
    const item = this.get(id);
    if (!item) throw new InboxError("not_found", "no such inbox item");
    const words = text(reply.text, reply.voice ? INBOX_VOICE_REPLY_MAX_CHARS : INBOX_REPLY_MAX_CHARS);
    if (!words) throw new InboxError("invalid", "write a few words first");
    const replies = [...item.replies, { ...reply, text: words, at: this.now().toISOString() }].slice(-MAX_REPLIES);
    // Writing back is reading: the card is seen, and keeps its place.
    return this.write(item, item.status, { replies }, true);
  }

  /** A follow-up job names the job it follows. */
  linkFollowUp(id: string, original: InboxItem): InboxItem {
    const item = this.require(id, "job");
    return this.write(item, item.status, { followUpOf: { id: original.id, title: original.title } }, item.seenAt !== null);
  }

  /**
   * S26: Do it on a suggestion. The caller starts the desk job (none for an example) and passes its
   * inbox item; `action` is what ran, the helper's words or the user's after Change.
   */
  acceptSuggestion(id: string, action: string, jobItemId: string | null): InboxItem {
    const item = this.require(id, "suggestion");
    if (item.status !== "open") throw new InboxError("conflict", "this suggestion is already settled");
    const words = text(action, SUGGESTION_ACTION_MAX_CHARS);
    if (!words) throw new InboxError("invalid", "say what the desk should do");
    return this.write(item, "accepted", { done: { jobItemId, action: words, changed: words !== item.action, at: this.now().toISOString() } }, true);
  }

  /** S26: Not now on a suggestion, with an optional reason the helper reads on its next run. */
  declineSuggestion(id: string, reason?: string): InboxItem {
    const item = this.require(id, "suggestion");
    if (item.status !== "open") throw new InboxError("conflict", "this suggestion is already settled");
    const why = text(reason, INBOX_REPLY_MAX_CHARS);
    const at = this.now().toISOString();
    const replies = why ? [...item.replies, { kind: "notnow" as const, text: why, at, readAt: null }].slice(-MAX_REPLIES) : item.replies;
    return this.write(item, "declined", { replies }, true);
  }

  /**
   * The feedback a persona has not read yet, from the cards it posted, oldest first. Example cards
   * never reach a persona.
   */
  unreadFeedback(from: string): Array<{ itemId: string; title: string; reply: InboxReply; index: number }> {
    const out: Array<{ itemId: string; title: string; reply: InboxReply; index: number }> = [];
    for (const item of this.list(500)) {
      if (item.from !== from || item.example || item.kind === "job") continue;
      item.replies.forEach((reply, index) => {
        if ((reply.kind === "feedback" || reply.kind === "notnow") && !reply.readAt) out.push({ itemId: item.id, title: item.title, reply, index });
      });
    }
    return out.sort((a, b) => a.reply.at.localeCompare(b.reply.at));
  }

  /** When the user last wrote feedback to this persona, read or not (its wake check). */
  lastFeedbackAt(from: string): string | null {
    let last: string | null = null;
    for (const item of this.list(500)) {
      if (item.from !== from || item.example) continue;
      for (const reply of item.replies) if ((reply.kind === "feedback" || reply.kind === "notnow") && (!last || reply.at > last)) last = reply.at;
    }
    return last;
  }

  /** The persona's run read this feedback; the card says so. Does not move the card. */
  markFeedbackRead(entries: Array<{ itemId: string; index: number }>): void {
    const at = this.now().toISOString();
    for (const { itemId, index } of entries) {
      const item = this.get(itemId);
      const reply = item?.replies[index];
      if (!item || !reply || reply.readAt) continue;
      const replies = item.replies.map((candidate, i) => (i === index ? { ...candidate, readAt: at } : candidate));
      const data: ItemData = { ...this.dataOf(item), replies };
      this.db.prepare(`UPDATE inbox_items SET data=? WHERE id=?`).run(JSON.stringify(data), item.id);
    }
  }

  /** "Got it" on a finding, or "Good" on a finished job. */
  dismiss(id: string): InboxItem {
    const item = this.get(id);
    if (!item) throw new InboxError("not_found", "no such inbox item");
    if (item.kind === "question") throw new InboxError("invalid", "a question is answered, not dismissed");
    if (item.kind === "suggestion") throw new InboxError("invalid", "a suggestion is done or put away with Not now");
    if (item.kind === "job" && item.status === "working") throw new InboxError("conflict", "the job is still working");
    return this.write(item, item.kind === "finding" || item.status === "done" ? "dismissed" : item.status, {}, true);
  }

  /**
   * Move a desk job along (S3). A new step keeps it working and quiet; done or failed brings it back
   * to the top as new, so the user sees the result.
   */
  updateJob(id: string, update: InboxJobUpdate): InboxItem {
    const item = this.require(id, "job");
    if (item.status === "undone" || ((item.status === "done" || item.status === "dismissed") && update.status !== "undone")) {
      throw new InboxError("conflict", `the job is already ${item.status}`);
    }
    if (update.status === "working") return this.write(item, "working", { step: text(update.step, 300) || item.step }, item.seenAt !== null);
    if (update.status === "failed") return this.write(item, "failed", { step: text(update.step, 300) || item.step }, false);
    if (update.status === "undone") return this.write(item, "undone", {}, true);
    return this.write(item, "done", { result: cleanResult(update.result), step: null }, false);
  }

  /** The memory desk (S3) sets how a job is undone; until then only example jobs can be. */
  setUndo(undo: InboxUndo | null): void {
    this.undo = undo;
  }

  /** The memory desk's hooks (S3): Undo, the answers it owns, and a look before listing. */
  setDeskHooks(hooks: InboxDeskHooks | null): void {
    this.undo = hooks?.undo ?? null;
    this.deskAnswer = hooks?.answer ?? null;
    this.deskRefresh = hooks?.refresh ?? null;
  }

  /** True when the desk took this answer (it starts or cancels a job) instead of filing it. */
  answerByDesk(item: InboxItem, optionId: string): boolean {
    return this.deskAnswer ? this.deskAnswer(item, optionId) : false;
  }

  /** Let the desk settle its items before the inbox is shown. */
  refresh(): void {
    try { this.deskRefresh?.(this); } catch (error) { console.warn(`[inbox] desk refresh failed: ${error instanceof Error ? error.message : String(error)}`); }
  }

  /** Undo a finished job: puts the memory back, then marks the item undone. */
  async undoJob(id: string): Promise<InboxItem> {
    const item = this.require(id, "job");
    if (item.status !== "done" && item.status !== "dismissed") throw new InboxError("conflict", "only a finished job can be undone");
    if (!item.example) {
      if (!this.undo) throw new InboxError("conflict", "undo is not available for this job");
      await this.undo(item);
    }
    return this.updateJob(id, { status: "undone" });
  }

  /** Remove the example items (the user's "Clear examples"). Real items are never deleted. */
  clearExamples(): number {
    return Number(this.db.prepare(`DELETE FROM inbox_items WHERE example=1`).run().changes);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private require(id: string, kind: InboxKind): InboxItem {
    const item = this.get(id);
    if (!item || item.kind !== kind) throw new InboxError("not_found", `no such ${kind} in the inbox`);
    return item;
  }

  private dataOf(item: InboxItem): ItemData {
    return {
      from: item.from, title: item.title, body: item.body, options: item.options, recommended: item.recommended,
      answer: item.answer, links: item.links, step: item.step, result: item.result,
      ...(item.replies.length ? { replies: item.replies } : {}),
      ...(item.followUpOf ? { followUpOf: item.followUpOf } : {}),
      ...(item.action ? { action: item.action } : {}),
      ...(item.done ? { done: item.done } : {}),
    };
  }

  private write(item: InboxItem, status: InboxStatus, patch: Partial<ItemData>, seen: boolean): InboxItem {
    const at = this.now().toISOString();
    const data: ItemData = { ...this.dataOf(item), ...patch };
    this.db
      .prepare(`UPDATE inbox_items SET status=?, data=?, updated_at=?, seen_at=? WHERE id=?`)
      .run(status, JSON.stringify(data), at, seen ? item.seenAt ?? at : null, item.id);
    return this.get(item.id)!;
  }
}

const stores = new Map<string, InboxStore>();

/**
 * The tenant's inbox, opened once per data directory. This is the internal API later steps call:
 * `inboxFor(runtime).post({ kind: "question", ... })`, `.updateJob(id, { status: "done", result })`.
 */
export function inboxFor(runtime: { readonly dataDir: string; readonly inboxDeskHooks?: InboxDeskHooks }): InboxStore {
  let store = stores.get(runtime.dataDir);
  if (!store) {
    store = new InboxStore(join(runtime.dataDir, "inbox.sqlite"));
    if (runtime.inboxDeskHooks) store.setDeskHooks(runtime.inboxDeskHooks);
    stores.set(runtime.dataDir, store);
  }
  return store;
}

/** Close a tenant's inbox (runtime shutdown, tests). */
export function closeInboxFor(runtime: { readonly dataDir: string }): void {
  stores.get(runtime.dataDir)?.close();
  stores.delete(runtime.dataDir);
}

/** The words an answer files into the memory: the question leads, so the Log names it. */
export function inboxAnswerContent(item: InboxItem, label: string): string {
  return `${item.title}\n\nMy answer: ${label}\n\n(Answered in the Zenod inbox, asked by ${item.from}.)`;
}

/**
 * Do it on an example suggestion: a made-up desk job, already done, so Undo can be tried. It never
 * touches the memory.
 */
export function exampleSuggestionJob(store: InboxStore, suggestion: InboxItem, action: string): InboxItem {
  const job = store.post({ kind: "job", example: true, sourceKey: `example:suggestion-job:${suggestion.id}`, title: action, step: "Starting" });
  if (job.status !== "working") return job;
  const done = store.updateJob(job.id, {
    status: "done",
    result: { summary: "An example: a real job makes this change on your memory, lists what moved and can be undone. Nothing in your memory changed.", changes: [] },
  });
  return store.linkFollowUp(done.id, suggestion);
}

/**
 * The example items the empty inbox can show, one of each kind (demo data, made up). They are
 * marked as examples, never write to the memory, and "Clear examples" removes them.
 */
export function postInboxExamples(store: InboxStore): InboxItem[] {
  const job = store.post({
    kind: "job", example: true, sourceKey: "example:job-done",
    title: "Split Boat repair and Cabin decision",
    body: "You said these two topics were tangled.",
    step: "Found 23 memories under one shared topic, sorting them",
  });
  if (job.status === "working") {
    store.updateJob(job.id, {
      status: "done",
      result: {
        summary: "Two topics again. 15 memories moved to Boat repair, 8 to Cabin decision, 6 links fixed.",
        changes: [
          { what: "Hull quotes March moved", before: "Boat and cabin", after: "Boat repair" },
          { what: "Oakmere survey moved", before: "Boat and cabin", after: "Cabin decision" },
          { what: "Link from Yard quotes to Financing removed" },
        ],
        search: { query: "boat repair", before: ["Boat and cabin", "Oakmere survey", "Hull quotes March"], after: ["Boat repair", "Hull quotes March", "Yard quotes"] },
      },
    });
  }
  return [
    store.post({
      kind: "suggestion", example: true, sourceKey: "example:suggestion",
      from: "Topic gardener", title: "Join \"Flat hunt\" into \"Moving to Valencia\": they are the same thing.",
      body: "14 notes in Flat hunt and 9 in Moving to Valencia talk about the same three flats. One place would make \"what did the agent say\" find all of them.",
      action: "Join the topic \"Flat hunt\" into \"Moving to Valencia\".",
      links: [{ label: "Flat hunt", path: "Areas/Flat hunt.md" }, { label: "Moving to Valencia", path: "Areas/Moving to Valencia.md" }],
    }),
    store.post({
      kind: "question", example: true, sourceKey: "example:question",
      from: "Librarian", title: "\"Flat\" and \"Apartment\" look like the same place. Join them under Flat?",
      options: [{ id: "join", label: "Yes, join" }, { id: "keep", label: "No, keep both" }], recommended: "join",
      links: [{ label: "Flat", path: "Areas/Flat.md" }, { label: "Apartment", path: "Areas/Apartment.md" }],
    }),
    store.post({
      kind: "finding", example: true, sourceKey: "example:finding",
      from: "Night reader", title: "You mentioned the dentist three times in two weeks and never booked.",
      links: [{ label: "Health", path: "Areas/Health.md" }],
    }),
    store.post({
      kind: "job", example: true, sourceKey: "example:job-working",
      title: "Clean up the Travel topic", step: "Reading 41 memories under Travel",
    }),
    store.get(job.id)!,
  ];
}
