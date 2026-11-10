import type { MemoryEntry } from "zenod";
import type { InboxLink, InboxOption } from "./inboxStore.js";
import type { PersonaContext, PersonaDefinition, PersonaEarlierQuestion } from "./personaRunner.js";
import type { PersonaStore } from "./personaStore.js";
import type { SubscriberStore } from "./subscribers.js";
import { isProjectWork } from "./helperScope.js";
import { teamAskSubscription } from "./teamAsk.js";

/**
 * The Clarifier (EPIC-14 S37). Jordi, 2026-11-10: "we could have like a disambiguator or something.
 * And there is like, if something is like, feels like a bit confusing, maybe this guy can ask me to
 * clarify a clarifying question to set the memory … Let's just experiment."
 *
 * Each night it reads what the person said in the last few days next to the places in their memory,
 * and when a memory could mean two things (two people, places or projects with the same name, a word
 * that matches several places, a "there" or "she" it cannot place) it asks ONE short question in the
 * inbox, with the possible meanings as buttons. Their answer is filed like any note they send (the
 * inbox's answer path), so the filing rules do not change. It never speaks in a chat (root L-6).
 *
 * Capped: at most two questions a night, none while two of its questions still wait, never the same
 * memory twice. Off for everyone by default (testers start with helpers off, E23-A2); switched on
 * once for the account that owns the team (switchOnClarifierForOwner).
 *
 * The catalog builds it (createClarifier) with its own word helpers, so this file never imports the
 * catalog and the two cannot load in a circle.
 */

/** What it shares with the other helpers (personaCatalog.ts). */
export interface ClarifierWords {
  memoryOnly: string;
  memoryTitle(entry: MemoryEntry): string;
  memoryWords(content: string): string;
  parseJsonReply(text: string): Record<string, unknown> | null;
}

export const CLARIFIER_ID = "clarifier";
/** Questions it may post in one night. */
export const CLARIFIER_MAX_QUESTIONS = 2;
/** It stays quiet while this many of its questions wait for an answer. */
export const CLARIFIER_MAX_WAITING = 2;
const CLARIFIER_DAYS = 3;
const CLARIFIER_MAX_MEMORIES = 40;
const PROMPT_CHARS = 12_000;
/** Its release: a Team connection made before it marks the account that owns the team. */
const CLARIFIER_SINCE = "2026-11-10T23:00:00.000Z";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""}`.trim();
const words = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** One question the model found, checked. */
export interface Clarification {
  /** The confusing words, as the person said them. */
  quote: string;
  /** The question, without the memory's name and day (the card adds them). */
  question: string;
  /** What it could mean: two or three short answers. */
  options: string[];
  /** One sentence: why it is unclear. */
  why: string;
  /** The memory it is about (1-based, as numbered in the prompt). */
  source: number;
}

/** The model's questions, checked: a real memory, two or three different meanings, no project work. */
export function parseClarifications(reply: Record<string, unknown> | null, memories: number): Clarification[] {
  const raw = Array.isArray(reply?.questions) ? reply.questions : [];
  const out: Clarification[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const question = words(value.question, 200);
    const source = Number.isInteger(value.source) ? (value.source as number) : 0;
    const seen = new Set<string>();
    const options = (Array.isArray(value.options) ? value.options : [])
      .map((option) => words(option, 60))
      .filter((option) => option && !seen.has(option.toLowerCase()) && seen.add(option.toLowerCase()))
      .slice(0, 3);
    if (!question || options.length < 2 || source < 1 || source > memories) continue;
    const why = words(value.why, 240);
    if (isProjectWork(question, why)) continue;
    out.push({ quote: words(value.quote, 120), question, options, why, source });
  }
  return out;
}

/** What the memory was, in the card's words: "voice note" for a voice note, else "note". */
export function memoryKind(title: string): string {
  return /^(Voice note|Audio|Image|Screenshot|PDF|Document|Link)$/.test(title) ? title.toLowerCase().replace(/^pdf$/, "PDF") : "note";
}

/**
 * The card it posts, in one place (S36 is rewriting every helper card in plain words; this is the
 * only spot to change). The title carries the memory, its day and the words, because the answer is
 * filed with the title as its first line: 'In your voice note of 10 Nov you said "the flat": which
 * flat did you mean?'.
 */
export function clarifierCard(c: Clarification, kind: string, capturedAt: string): { title: string; body: string; options: InboxOption[] } {
  const said = `In your ${kind} of ${shortDay(capturedAt)}`;
  return {
    title: c.quote ? `${said} you said "${c.quote}": ${c.question}` : `${said}: ${c.question}`,
    body: [c.why, "Pick one, or answer in your own words."].filter(Boolean).join(" "),
    options: c.options.map((label, index) => ({ id: `m${index + 1}`, label })),
  };
}

const SYSTEM = [
  "You are the Clarifier, a quiet helper that reads a person's own memory.",
  "Your one job: find a memory that is confusing, where you cannot tell what it means, and ask the person one short clarifying question so their memory is kept right.",
  "Confusing means: a name that could be two different people, places or projects in their memories or places; a word that matches several of their places; a \"there\", \"he\", \"she\" or \"it\" you cannot place. Never ask about something the memories already make clear, never ask for facts they did not mention, never ask what they should do.",
].join(" ");

function prompt(w: ClarifierWords, entries: MemoryEntry[], places: string[], earlier: ReadonlyArray<PersonaEarlierQuestion>): string {
  const lines: string[] = [];
  let used = 0;
  entries.forEach((entry, index) => {
    const line = `[${index + 1}] ${entry.capturedAt.slice(0, 10)} ${w.memoryTitle(entry)}: ${w.memoryWords(entry.content).slice(0, 400)}`;
    if (used + line.length > PROMPT_CHARS) return;
    used += line.length;
    lines.push(line);
  });
  return [
    `These are the memories the person saved in the last ${CLARIFIER_DAYS} days, newest first:`,
    "",
    ...lines,
    ...(places.length ? ["", "The places in their memory:", ...places] : []),
    ...(earlier.length ? ["", "You asked these before. Never ask them again:", ...earlier.map((q) => `- ${q.title.slice(0, 200)}${q.answer ? ` (answer: ${q.answer.slice(0, 100)})` : ""}`)] : []),
    "",
    `Reply with JSON only: {"questions": [{"source": number of the memory, "quote": "the confusing words exactly as said, at most 12 words", "question": "one short question in plain words, like: which flat did you mean?", "options": ["2 or 3 short possible meanings, each from their memories or places"], "why": "one sentence: why it could mean either"}]} with at most ${CLARIFIER_MAX_QUESTIONS} questions, the most confusing first, or {"questions": []} when nothing is confusing.`,
  ].join("\n");
}

export function createClarifier(w: ClarifierWords): PersonaDefinition {
  return {
  id: CLARIFIER_ID,
  name: "Clarifier",
  purpose: "Asks you one short question when something you said could mean two things.",
  brief: "Every night it reads what you said in the last 3 days. When a note could mean two people, places or things, it asks you in your inbox which one you meant, at most two questions a night. Your answer is saved to your memory like any note. It never asks in a chat.",
  schedule: { every: "night" },
  skills: ["read", "write-own-folder", "ask"],
  defaultEnabled: false,
  limits: { maxSteps: 8, maxRunUsd: 0.02, maxMonthUsd: 0.1 },

  async fingerprint(ctx) {
    const entries = await ctx.recentMemories({ days: CLARIFIER_DAYS, limit: CLARIFIER_MAX_MEMORIES });
    return entries.length ? `${entries.length}:${entries[0]!.evidenceRef}` : null;
  },

  async run(ctx: PersonaContext) {
    const waiting = ctx.earlierQuestions.filter((q) => q.status === "open").length;
    if (waiting >= CLARIFIER_MAX_WAITING) return { summary: `${waiting} of its questions still wait for you, so it asked nothing` };
    const asked = new Set(ctx.earlierQuestions.map((q) => q.about).filter((about): about is string => !!about));
    const entries = (await ctx.recentMemories({ days: CLARIFIER_DAYS, limit: CLARIFIER_MAX_MEMORIES })).filter((entry) => !asked.has(entry.evidenceRef));
    if (!entries.length) return { summary: "Nothing new to read" };
    const places = await ctx.places();
    const found = parseClarifications(w.parseJsonReply(await ctx.think({ system: [SYSTEM, w.memoryOnly, "Use only what the memories say. Plain words."].join(" "), prompt: prompt(w, entries, places?.lines ?? [], ctx.earlierQuestions) })), entries.length);
    const room = Math.min(CLARIFIER_MAX_QUESTIONS, CLARIFIER_MAX_WAITING - waiting);
    const posted: Array<{ c: Clarification; entry: MemoryEntry }> = [];
    for (const c of found) {
      if (posted.length >= room) break;
      const entry = entries[c.source - 1]!;
      if (posted.some((p) => p.entry.evidenceRef === entry.evidenceRef)) continue;
      const card = clarifierCard(c, memoryKind(w.memoryTitle(entry)), entry.capturedAt);
      const links: InboxLink[] = [{ label: `Your ${memoryKind(w.memoryTitle(entry))} of ${shortDay(entry.capturedAt)}`, path: entry.path }];
      ctx.postQuestion({ ...card, links, about: entry.evidenceRef });
      posted.push({ c, entry });
    }
    ctx.writeNote(`${ctx.today}.md`, [
      "---", `title: Clarifier ${ctx.today}`, "type: persona-note", `persona: ${CLARIFIER_ID}`, `created: ${ctx.today}`, `memories_read: ${entries.length}`, "---", "",
      `# Clarifier ${ctx.today}`, "",
      ...(posted.length ? posted.map(({ c, entry }) => `- Asked about [[${entry.evidenceRef.replace(/\.md(?=#)/, "")}|${w.memoryTitle(entry)} ${entry.capturedAt.slice(0, 10)}]]: ${c.question} (${c.options.join(" / ")})`) : ["- Nothing looked confusing."]),
      "",
    ].join("\n"));
    return { summary: posted.length ? `Read ${entries.length} memories and asked ${posted.length} clarifying ${posted.length === 1 ? "question" : "questions"}` : `Read ${entries.length} memories, nothing confusing` };
  },
  };
}

/**
 * Once, for the account that owns the team (its Team connection was made before the Clarifier came):
 * switch the Clarifier on, unless the person already chose. Testers have no Team connection, so it
 * stays off for them (E23-A2). Returns true when it switched it on.
 */
export function switchOnClarifierForOwner(personas: PersonaStore, subscribers: SubscriberStore | null, since = CLARIFIER_SINCE): boolean {
  const sub = subscribers ? teamAskSubscription(subscribers) : null;
  if (!sub || sub.createdAt >= since || personas.enabled(CLARIFIER_ID) !== null) return false;
  personas.setEnabled(CLARIFIER_ID, true);
  return true;
}
