import type { Hit, MemoryEntry, MemoryEntryQuery, Note, PersonaNotesInput } from "zenod";
import type { InboxItem, InboxLink, InboxOption, InboxStore } from "./inboxStore.js";
import type { PersonaRun, PersonaRunEnd, PersonaStore, PersonaTrigger } from "./personaStore.js";
import { zenodLimits } from "./limits.js";
import { inTreeSweepWindow, treeSweepWeekStart, TREE_SWEEP_WINDOW_START_HOUR_UTC } from "./treeSweepSchedule.js";

/**
 * The persona runner (EPIC-14 S4). A persona is a small agent that wakes on the user's memory on a
 * schedule (nightly by default, in the same 02:00–06:00 UTC off-peak window as the tree sweep),
 * mostly reads, writes only into its own folder of the memory repo (`Personas/<id>/`, one commit
 * per run) and posts its findings and questions to the inbox. It never messages anyone (root L-6).
 *
 * The persona only gets the context below: read the memory, one cheap model call at a time, note
 * into its own folder, post to the inbox. Each of those is a step and the steps are capped. Spend
 * is capped per run, per persona per month and for all personas together ($1 of the tenant's $3
 * monthly AI allowance by default), and every model call also counts in that AI allowance.
 *
 * Shapes copied from Epic Team (agent_team `team/personaRecord.ts`, `cycle/skipUnchanged.ts`): a
 * persona record with a name, a brief, a schedule and its skills, and a no-model check before a
 * scheduled wake that skips it when nothing is new since the last real run. It runs inside Zenod
 * only: no calls to the team console (root L-7).
 */

/** How often a persona wakes: nightly (shown as Daily), weekly, or every N days. The user can change it. */
export type PersonaSchedule = { every: "night" } | { every: "week" } | { every: "days"; days: number };

export const PERSONA_MIN_EVERY_DAYS = 2;
export const PERSONA_MAX_EVERY_DAYS = 30;

/** A valid cadence from user input, or null. */
export function parsePersonaSchedule(value: unknown): PersonaSchedule | null {
  if (!value || typeof value !== "object") return null;
  const { every, days } = value as { every?: unknown; days?: unknown };
  if (every === "night" || every === "week") return { every };
  if (every === "days" && Number.isInteger(days) && (days as number) >= PERSONA_MIN_EVERY_DAYS && (days as number) <= PERSONA_MAX_EVERY_DAYS) {
    return { every: "days", days: days as number };
  }
  return null;
}

export function personaScheduleLabel(schedule: PersonaSchedule): string {
  if (schedule.every === "week") return "Weekly, Sunday night";
  if (schedule.every === "days") return `Every ${schedule.days} days, at night`;
  return "Daily, at night";
}

/**
 * The skills a persona can be given. The runner hands it only the calls for its own skills: a call
 * outside them fails the run, so the list on the settings screen is what it can really do.
 */
export type PersonaSkill = "read" | "search" | "write-own-folder" | "post-inbox" | "ask" | "propose-desk-job";

export const PERSONA_SKILLS: Record<PersonaSkill, string> = {
  read: "Read your memory",
  search: "Search your memory",
  "write-own-folder": "Write only into its own folder",
  "post-inbox": "Post findings to your inbox",
  ask: "Ask you a question",
  "propose-desk-job": "Propose a tidy-up job you run or skip",
};

export class PersonaSkillError extends Error {
  constructor(readonly skill: PersonaSkill) {
    super(`It does not have the skill "${PERSONA_SKILLS[skill]}"`);
    this.name = "PersonaSkillError";
  }
}

export interface PersonaLimits {
  /** Steps per run: each read, model call, note and inbox post is one. */
  maxSteps: number;
  /** USD per run. */
  maxRunUsd: number;
  /** USD per month for this persona. */
  maxMonthUsd: number;
}

export interface PersonaDefinition {
  /** Lower-case slug: its folder is `Personas/<id>/`. */
  id: string;
  /** Shown as the sender of its inbox items. */
  name: string;
  /** One plain line: what it is for, shown in the catalog. */
  purpose: string;
  /** One or two sentences, shown in settings. */
  brief: string;
  /** Its default cadence; the user's choice in settings wins. */
  schedule: PersonaSchedule;
  /** Its pre-loaded skills: the runner gives it these calls and no others. It never messages anyone. */
  skills: PersonaSkill[];
  /** On for a new user, until they switch it off. */
  defaultEnabled: boolean;
  limits: PersonaLimits;
  /**
   * When the persona's behaviour last changed (ISO). A persona revised after its last run wakes once
   * more at once, in its own period, and is not skipped as "nothing new", so a fix reaches users the
   * same day instead of next week.
   */
  revisedAt?: string;
  /**
   * The no-model wake check: what this wake would look at, as a short string. A scheduled wake whose
   * fingerprint equals the last real run's is skipped with no model call. Null: nothing to look at.
   */
  fingerprint(ctx: PersonaReadContext): Promise<string | null>;
  run(ctx: PersonaContext): Promise<{ summary: string }>;
}

/** What a persona may read: the memory, never written through this. */
export interface PersonaReadContext {
  readonly today: string;
  /**
   * What the user wrote back on this persona's cards since its last run (EPIC-14 S2 round 3), oldest
   * first. Every model call also gets it in its system words, so no persona can miss it.
   */
  readonly feedback: ReadonlyArray<{ about: string; text: string; at: string }>;
  /** The memories captured in the last `days` days, newest first. One step. */
  recentMemories(options: { days: number; limit?: number }): Promise<MemoryEntry[]>;
  /** Search the memory (no model). One step. */
  search(query: string): Promise<Hit[]>;
  /** Read one note. One step. */
  read(path: string): Promise<Note>;
}

export interface PersonaContext extends PersonaReadContext {
  /** One model call on the cheap model. One step; refused once a spend cap is reached. */
  think(input: { system: string; prompt: string }): Promise<string>;
  /** A note in its own folder; all of a run's notes are one commit at the end. One step. */
  writeNote(name: string, content: string): void;
  /** A finding for the user's inbox. One step. */
  postFinding(input: { title: string; body?: string; links?: InboxLink[] }): InboxItem;
  /** A question for the user's inbox, the recommended choice first. One step. */
  postQuestion(input: { title: string; body?: string; options: InboxOption[]; recommended?: string; links?: InboxLink[] }): InboxItem;
  /**
   * Propose a job on the memory to the memory desk: an inbox card "Run it?". Nothing changes and
   * nothing is spent unless the user says Run it; then the desk runs it, with Undo. One step.
   */
  proposeDeskJob(input: { request: string; why: string }): InboxItem;
  /**
   * S26: a suggestion card: one change in words (`action`, as the desk would run it) with Do it,
   * Change, Not now and Your feedback. Nothing changes unless the user presses Do it. One step.
   */
  postSuggestion(input: { title: string; body?: string; action: string; links?: InboxLink[] }): InboxItem;
}

/** The memory a persona reads (the tenant's engine). */
export interface PersonaMemory {
  searchEntries(query?: MemoryEntryQuery): Promise<MemoryEntry[]>;
  search(query: string): Promise<Hit[]>;
  get(path: string): Promise<Note>;
}

/** One model call and what it cost. */
export interface PersonaModelResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface PersonaModel {
  complete(input: { system: string; prompt: string }): Promise<PersonaModelResult>;
}

export interface PersonaRunnerDeps {
  memory: PersonaMemory;
  /** Opened per run, so its usage is this run's alone. */
  model: () => PersonaModel;
  inbox: InboxStore;
  store: PersonaStore;
  writeNotes(input: PersonaNotesInput): Promise<{ id: string } | null>;
  /** The tenant's AI allowance stop: when set, no persona starts. */
  aiAllowanceBlock?: () => { message: string } | null;
  now?: () => Date;
  /** USD per month for all personas together. */
  totalMonthUsd?: number;
}

/** $1 of the tenant's $3 monthly AI allowance (E7-A2), for all personas together (limits.ts). */
export const PERSONA_TOTAL_MONTH_USD = zenodLimits().personas.monthUsd;
export const PERSONA_MAX_NOTES_PER_RUN = 5;
export const PERSONA_MAX_POSTS_PER_RUN = 3;
const MAX_NOTE_CHARS = 20_000;

export class PersonaCapError extends Error {
  constructor(readonly cap: "steps" | "spend" | "posts" | "notes", message: string) {
    super(message);
    this.name = "PersonaCapError";
  }
}

/** The tenant's AI allowance ran out mid-run (core's LlmAllowanceExceededError, matched by its code so this file stays type-only on core and out of the Phylax bundle's runtime imports). */
const isAllowanceError = (error: unknown) => error instanceof Error && (error as { code?: unknown }).code === "llm_allowance_exceeded";

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const monthStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();

/**
 * The schedule period a wake at `now` belongs to: the night's date, or the week's Sunday. Every
 * period runs at most once (the run log's unique period key), in the first off-peak window the
 * tenant is awake, so a restart never runs a night twice and never runs at peak time.
 */
export function personaPeriodKey(persona: Pick<PersonaDefinition, "schedule" | "revisedAt">, now: Date, schedule: PersonaSchedule = persona.schedule): string {
  const base = schedule.every === "week"
    ? `week:${isoDay(new Date(treeSweepWeekStart(now.getTime())))}`
    : schedule.every === "days"
      ? `days${schedule.days}:${isoDay(new Date(everyDaysStart(now.getTime(), schedule.days)))}`
      : `night:${isoDay(now)}`;
  return persona.revisedAt ? `${base}@${persona.revisedAt}` : base;
}

const DAY_MS = 24 * 3_600_000;

/** The start (midnight UTC) of the N-day period holding `t`, counted from 1970-01-01. */
function everyDaysStart(t: number, days: number): number {
  return Math.floor(t / DAY_MS / days) * days * DAY_MS;
}

/** Never ran, or last ran before its latest revision: wakes at once, at any hour. */
function wantsFirstWake(store: PersonaStore, persona: PersonaDefinition): boolean {
  const last = store.runs(persona.id, 1)[0];
  return !last || (persona.revisedAt !== undefined && last.startedAt < persona.revisedAt);
}

/** When a scheduled persona next wakes: the next off-peak window whose period has not run. */
export function nextPersonaWakeAt(schedule: PersonaSchedule, now: Date, ranThisPeriod: boolean): Date {
  const day = 24 * 3_600_000;
  const t = now.getTime();
  if (!ranThisPeriod && inTreeSweepWindow(t)) return now;
  if (schedule.every === "week") {
    const start = treeSweepWeekStart(t);
    if (!ranThisPeriod) {
      const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + TREE_SWEEP_WINDOW_START_HOUR_UTC * 3_600_000;
      return new Date(today > t ? today : today + day);
    }
    return new Date(start + 7 * day);
  }
  if (schedule.every === "days" && ranThisPeriod) {
    return new Date(everyDaysStart(t, schedule.days) + schedule.days * day + TREE_SWEEP_WINDOW_START_HOUR_UTC * 3_600_000);
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + TREE_SWEEP_WINDOW_START_HOUR_UTC * 3_600_000;
  return new Date(today > t ? today : today + day);
}

export function personaEnabled(store: PersonaStore, persona: PersonaDefinition): boolean {
  return store.enabled(persona.id) ?? persona.defaultEnabled;
}

/** Its cadence: the user's choice, else its default. */
export function personaSchedule(store: PersonaStore, persona: PersonaDefinition): PersonaSchedule {
  return parsePersonaSchedule(store.cadence(persona.id)) ?? persona.schedule;
}

/** Month-to-date spend against the caps: this persona's and all personas'. */
export function personaBudget(store: PersonaStore, persona: PersonaDefinition, now: Date, totalMonthUsd = PERSONA_TOTAL_MONTH_USD) {
  const since = monthStart(now);
  return {
    personaUsd: store.spendSince(since, persona.id),
    personaCapUsd: persona.limits.maxMonthUsd,
    totalUsd: store.spendSince(since),
    totalCapUsd: totalMonthUsd,
  };
}

/**
 * Run one persona once: check the caps and the wake gate, give it its context, log the run.
 * Returns null when a scheduled period already has its run. Never throws for a persona's own
 * failure: the run is logged as failed instead.
 */
export async function runPersona(
  persona: PersonaDefinition,
  deps: PersonaRunnerDeps,
  trigger: PersonaTrigger,
): Promise<PersonaRun | null> {
  const now = deps.now ?? (() => new Date());
  const started = now();
  const periodKey = trigger === "schedule" ? personaPeriodKey(persona, started, personaSchedule(deps.store, persona)) : null;
  const run = deps.store.start(persona.id, trigger, periodKey);
  if (!run) return null;

  const tally: PersonaRunEnd = {
    status: "done", steps: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0,
    summary: "", inboxItemIds: [], revision: null, fingerprint: null,
  };
  const end = (status: PersonaRunEnd["status"], summary: string) => deps.store.finish(run.id, { ...tally, status, summary });

  const blocked = deps.aiAllowanceBlock?.();
  // Paused at the allowance or its reserve (limits.ts): quietly, the run log says why.
  if (blocked) return end("skipped", blocked.message || "The AI allowance for this month is used up");
  const budget = personaBudget(deps.store, persona, started, deps.totalMonthUsd);
  if (budget.totalUsd >= budget.totalCapUsd) return end("capped", "The helpers' monthly budget is used up");
  if (budget.personaUsd >= budget.personaCapUsd) return end("capped", `${persona.name}'s monthly budget is used up`);

  const skilled = (skill: PersonaSkill) => {
    if (!persona.skills.includes(skill)) throw new PersonaSkillError(skill);
  };
  const step = () => {
    if (tally.steps >= persona.limits.maxSteps) throw new PersonaCapError("steps", `Stopped at its ${persona.limits.maxSteps} steps`);
    tally.steps += 1;
  };
  const unread = deps.inbox.unreadFeedback(persona.name);
  // A Not now reason (S26) reads as one: the helper stops suggesting that kind of thing.
  const feedback = unread.map((entry) => ({ about: entry.title, text: entry.reply.kind === "notnow" ? `Not now: ${entry.reply.text}` : entry.reply.text, at: entry.reply.at }));
  const feedbackWords = feedback.length
    ? `\n\nThe user wrote back on your earlier inbox cards. Take it into account in this run:\n${feedback
        .map((entry) => `- On "${entry.about.slice(0, 200)}": ${entry.text}`)
        .join("\n")}`
    : "";
  const read: PersonaReadContext = {
    today: isoDay(started),
    feedback,
    // Spread over the days, newest first within each, so a busy day cannot crowd out the rest of the week.
    async recentMemories({ days, limit = 40 }) {
      skilled("read");
      step();
      const span = Math.max(1, Math.min(days, 31));
      const max = Math.min(limit, 100);
      const after = new Date(started.getTime() - span * 24 * 3_600_000).toISOString();
      // One scan of the window (no model), then an even share per day.
      const all = await deps.memory.searchEntries({ capturedAfter: after, order: "newest", limit: null });
      const byDay = new Map<string, MemoryEntry[]>();
      for (const entry of all) {
        const day = entry.capturedAt.slice(0, 10);
        byDay.set(day, [...(byDay.get(day) ?? []), entry]);
      }
      const perDay = Math.max(1, Math.ceil(max / Math.max(1, byDay.size)));
      return [...byDay.values()].flatMap((entries) => entries.slice(0, perDay))
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
        .slice(0, max);
    },
    async search(query) {
      skilled("search");
      step();
      return deps.memory.search(query);
    },
    async read(path) {
      skilled("read");
      step();
      return deps.memory.get(path);
    },
  };

  const notes: Array<{ name: string; content: string }> = [];
  let model: PersonaModel | null = null;
  const sourceKey = () => `persona:${persona.id}:${run.id}:${tally.inboxItemIds.length}`;
  const posted = (item: InboxItem) => {
    tally.inboxItemIds.push(item.id);
    return item;
  };
  const beforePost = () => {
    if (tally.inboxItemIds.length >= PERSONA_MAX_POSTS_PER_RUN) throw new PersonaCapError("posts", `Stopped at ${PERSONA_MAX_POSTS_PER_RUN} inbox posts`);
    step();
  };
  const ctx: PersonaContext = {
    ...read,
    async think(input) {
      step();
      const spent = personaBudget(deps.store, persona, started, deps.totalMonthUsd);
      if (tally.costUsd >= persona.limits.maxRunUsd) throw new PersonaCapError("spend", "Stopped at its spend cap for one run");
      if (spent.personaUsd + tally.costUsd >= spent.personaCapUsd) throw new PersonaCapError("spend", `Stopped at ${persona.name}'s monthly budget`);
      if (spent.totalUsd + tally.costUsd >= spent.totalCapUsd) throw new PersonaCapError("spend", "Stopped at the helpers' monthly budget");
      model ??= deps.model();
      const result = await model.complete(feedbackWords ? { ...input, system: `${input.system}${feedbackWords}` } : input);
      tally.modelCalls += 1;
      tally.inputTokens += result.inputTokens;
      tally.outputTokens += result.outputTokens;
      tally.costUsd += result.costUsd;
      // An empty answer is a failed call, never "nothing found" (EPIC-14 S5: three runs wrote "nothing" that way).
      if (!result.text.trim()) throw new Error("The model gave no answer");
      return result.text;
    },
    writeNote(name, content) {
      skilled("write-own-folder");
      if (notes.length >= PERSONA_MAX_NOTES_PER_RUN) throw new PersonaCapError("notes", `Stopped at ${PERSONA_MAX_NOTES_PER_RUN} notes`);
      step();
      notes.push({ name, content: content.slice(0, MAX_NOTE_CHARS) });
    },
    postFinding(input) {
      skilled("post-inbox");
      beforePost();
      return posted(deps.inbox.post({ kind: "finding", from: persona.name, sourceKey: sourceKey(), ...input }));
    },
    postQuestion(input) {
      skilled("ask");
      beforePost();
      return posted(deps.inbox.post({ kind: "question", from: persona.name, sourceKey: sourceKey(), ...input }));
    },
    postSuggestion(input) {
      // S26: one change the helper proposes; the user does it (one undoable desk job), changes it first or says not now.
      skilled("propose-desk-job");
      beforePost();
      return posted(deps.inbox.post({ kind: "suggestion", from: persona.name, sourceKey: sourceKey(), ...input }));
    },
    proposeDeskJob({ request, why }) {
      skilled("propose-desk-job");
      beforePost();
      // The desk owns a `desk-ask:` card: Run it starts the job with the card's body as its request.
      return posted(deps.inbox.post({
        kind: "question", from: persona.name, sourceKey: `desk-ask:${sourceKey()}`,
        title: `${why.trim().slice(0, 300)} Run it?`,
        body: request.trim().slice(0, 600),
        options: [{ id: "run", label: "Run it" }, { id: "no", label: "Not now" }],
      }));
    },
  };

  try {
    const seen = await persona.fingerprint(read);
    if (seen === null) return end("skipped", "Nothing to read yet");
    tally.fingerprint = persona.revisedAt ? `${persona.revisedAt}|${seen}` : seen;
    // New feedback is something new: the next scheduled wake runs, so the persona reads it.
    const lastFeedback = deps.inbox.lastFeedbackAt(persona.name);
    if (lastFeedback) tally.fingerprint += `|feedback:${lastFeedback}`;
    if (trigger === "schedule" && deps.store.lastRealRun(persona.id)?.fingerprint === tally.fingerprint) {
      return end("skipped", "Nothing new since the last run");
    }
    const outcome = await persona.run(ctx);
    tally.revision = await commitNotes(persona, deps, notes, started);
    if (tally.modelCalls > 0) deps.inbox.markFeedbackRead(unread);
    return end("done", outcome.summary);
  } catch (error) {
    // What it wrote before a cap is still its work: keep it, and say why it stopped.
    const capped = error instanceof PersonaCapError || isAllowanceError(error);
    try {
      if (capped) tally.revision = await commitNotes(persona, deps, notes, started);
    } catch (commitError) {
      console.warn(`[persona] ${persona.id} notes not saved: ${(commitError as Error).message}`);
    }
    if (capped) return end("capped", isAllowanceError(error) ? "The AI allowance for this month is used up" : (error as Error).message);
    console.warn(`[persona] ${persona.id} run ${run.id} failed: ${(error as Error).message}`);
    return end("failed", `Failed: ${(error as Error).message.slice(0, 200)}`);
  }
}

async function commitNotes(persona: PersonaDefinition, deps: PersonaRunnerDeps, notes: Array<{ name: string; content: string }>, at: Date): Promise<string | null> {
  if (notes.length === 0) return null;
  const revision = await deps.writeNotes({ personaId: persona.id, files: notes, message: `persona: ${persona.name} run ${isoDay(at)}` });
  return revision?.id ?? null;
}

/**
 * The personas due now: switched on and their period has no run yet, in the off-peak window. A
 * persona that is on and has never run (or was revised since its last run) wakes at once, at any
 * hour, so a new user (or one who just switched it on) sees what it does the same day.
 */
export function duePersonas(personas: readonly PersonaDefinition[], store: PersonaStore, now: Date): PersonaDefinition[] {
  const inWindow = inTreeSweepWindow(now.getTime());
  return personas.filter((persona) => {
    if (!personaEnabled(store, persona) || store.hasRunForPeriod(persona.id, personaPeriodKey(persona, now, personaSchedule(store, persona)))) return false;
    return inWindow || wantsFirstWake(store, persona);
  });
}

/** What the settings screen shows for one persona. */
export function personaView(persona: PersonaDefinition, store: PersonaStore, now: Date, totalMonthUsd = PERSONA_TOTAL_MONTH_USD) {
  const enabled = personaEnabled(store, persona);
  const runs = store.runs(persona.id, 5);
  const cadence = personaSchedule(store, persona);
  return {
    id: persona.id,
    name: persona.name,
    purpose: persona.purpose,
    brief: persona.brief,
    cadence,
    defaultCadence: persona.schedule,
    schedule: personaScheduleLabel(cadence),
    skills: persona.skills.map((id) => ({ id, label: PERSONA_SKILLS[id] })),
    enabled,
    limits: persona.limits,
    budget: personaBudget(store, persona, now, totalMonthUsd),
    nextWakeAt: enabled ? nextPersonaWakeAt(cadence, now, store.hasRunForPeriod(persona.id, personaPeriodKey(persona, now, cadence))).toISOString() : null,
    lastRun: runs[0] ?? null,
    runs,
  };
}
