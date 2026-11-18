import type { MemoryEntry } from "zenod";
import type { InboxLink } from "./inboxStore.js";
import type { PersonaDefinition } from "./personaRunner.js";
import { isProjectWork } from "./helperScope.js";
import { cleanHelperCard, HELPER_CARD_WORDS, namedCard, namedMemories } from "./helperCard.js";
import { soundsClinical, soundsLikeDistress } from "./patterns.js";

/**
 * Make it easier (EPIC-14 S49), the fifth memory persona Jordi approved in E14-A12 (18 Nov). His words
 * (vn_101d2c67): "personas that are kind of dispatched on your memory to look for ... possibilities you
 * haven't thought of or maybe more therapy stuff or more like optimization".
 *
 * Once a week it reads the last 30 days of what the person said, voice notes first, finds ONE effort
 * they keep spending again and again (a chore, a trip, a payment, a way they do something) and names
 * ONE concrete way to spend less time, money or effort on it, with the notes it saw it in, in the
 * helper card's shape (why yes, why not, make your call; S36). It posts to the inbox only.
 *
 * Built like Patterns and ideas (S41): quiet for the whole run when a note sounds hard, no clinical
 * words, never project work, at most one card a week even when run by hand, one cheap model call a
 * run. Off for every account until the person switches it on (no keep-on rule: not even the owner's).
 */

/** What it shares with the other helpers (personaCatalog.ts). */
export interface MakeItEasierWords {
  memoryTitle(entry: MemoryEntry): string;
  memoryWords(content: string): string;
  parseJsonReply(text: string): Record<string, unknown> | null;
  /** How the person knows each memory, like "your voice note of 3 Nov". */
  memoryPhrases(entries: ReadonlyArray<MemoryEntry>): string[];
}

export const MAKE_IT_EASIER_ID = "make-it-easier";
const EASIER_DAYS = 30;
/** It posts at most one card in this many days, even when run by hand. */
export const EASIER_GAP_DAYS = 7;
/** How many of its own earlier days it reads back, so it never names the same thing twice running. */
const EASIER_LOOK_BACK = 35;
const EASIER_MAX_MEMORIES = 100;
const PROMPT_CHARS = 18_000;

/** One repeated effort and one easier way, checked. */
export interface EasierWay {
  /** One sentence said to them: what they keep doing again and again. */
  noticed: string;
  /** The effort in a few of their own words, for the card's picture. */
  effort: string;
  /** The easier way: one concrete sentence that starts with a verb. */
  idea: string;
  /** The easier way in at most 6 words, for the card's picture. */
  short: string;
  /** What it would save: time, money or effort. */
  saves: "time" | "money" | "effort";
  yes: string;
  no: string;
  sources: number[];
}

const SAVES = ["time", "money", "effort"] as const;
const line = (value: unknown, max = 240) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max).trim() : "");

/** The easier way from its reply, or null when anything it needs is missing. */
export function parseEasierWay(reply: Record<string, unknown> | null): EasierWay | null {
  const raw = reply?.easier && typeof reply.easier === "object" ? (reply.easier as Record<string, unknown>) : null;
  if (!raw) return null;
  const saves = SAVES.find((kind) => kind === line(raw.saves, 10).toLowerCase()) ?? "effort";
  const found: EasierWay = {
    noticed: line(raw.noticed),
    effort: line(raw.effort, 90),
    idea: line(raw.idea),
    short: line(raw.short, 60),
    saves,
    yes: line(raw.yes),
    no: line(raw.no),
    sources: (Array.isArray(raw.sources) ? raw.sources : []).filter((n): n is number => Number.isInteger(n) && (n as number) > 0).slice(0, 5),
  };
  return found.noticed && found.effort && found.idea && found.short && found.yes && found.no ? found : null;
}

const SYSTEM = [
  "You are Make it easier, a practical, friendly helper that reads what a person said in their own notes over the last month, mostly their voice notes.",
  "Look for ONE thing in their everyday life they spend time, money or effort on again and again: a chore, an errand, a trip, a payment, a way they do something by hand, something they keep looking up or redoing.",
  "Name it plainly in one sentence said to them, never a judgement. Then offer ONE concrete, doable way to spend less time, money or effort on it: batch it, automate it, set it up once, buy or cancel something, hand it off, or drop a step. Say exactly what to do, not a general tip.",
  "Pick the one with the biggest saving that they could start this week. Only name tools, services or prices you are sure exist; never invent them.",
  "You are not a project manager: never suggest a task, a ticket, a release or work for a team or an agent. The effort can show up in their work; the easier way is for the person.",
  "Never use medical or clinical words. If any note sounds like real distress or crisis, reply with null.",
  "Use only what the notes say. Never invent facts, names or dates. When no effort clearly repeats across at least two notes, reply with null.",
  HELPER_CARD_WORDS,
].join(" ");

/** Its earlier note for a day, if any: the easier way it named. */
function earlierWay(body: string): string | null {
  const found = /^## Easier\n\n(.+)$/m.exec(body);
  return found ? found[1]!.trim() : null;
}

export function createMakeItEasier(words: MakeItEasierWords): PersonaDefinition {
  const { memoryTitle, memoryWords, parseJsonReply, memoryPhrases } = words;
  const label = (entry: MemoryEntry) => `${memoryTitle(entry)} ${entry.capturedAt.slice(0, 10)}`;

  const recent = async (ctx: { recentMemories(input: { days: number; limit: number }): Promise<MemoryEntry[]> }) => {
    const all = await ctx.recentMemories({ days: EASIER_DAYS, limit: EASIER_MAX_MEMORIES });
    const voice = all.filter((entry) => entry.contentType === "voice_note" || entry.contentType === "audio" || /^(Voice note|Audio) "/.test(entry.title));
    return voice.length >= 3 ? voice : all;
  };

  return {
    id: MAKE_IT_EASIER_ID,
    name: "Make it easier",
    purpose: "Once a week, one thing you do again and again, and one way to spend less time, money or effort on it.",
    brief: "Once a week it reads what you said in the last 30 days, your voice notes first. When you keep spending time, money or effort on the same thing, like an errand, a payment or a job you do by hand, it names it and offers one concrete way to make it easier, with the notes it saw it in. It stays quiet when a note sounds hard and never gives you project work.",
    schedule: { every: "week" },
    skills: ["read", "write-own-folder", "post-inbox"],
    defaultEnabled: false,
    // One cheap call a week, plus reading its own earlier notes back.
    limits: { maxSteps: 50, maxRunUsd: 0.02, maxMonthUsd: 0.1 },

    async fingerprint(ctx) {
      const entries = await recent(ctx);
      return entries.length ? `${entries.length}:${entries[0]!.evidenceRef}` : null;
    },

    async run(ctx) {
      const entries = await recent(ctx);
      if (entries.length < 3) return { summary: `Read ${entries.length} notes, too few to see a repeated effort` };
      // What it said before: a card in the last week means it waits; ways it named are not repeated.
      const earlier: string[] = [];
      const today = Date.parse(`${ctx.today}T00:00:00Z`);
      for (let back = 1; back <= EASIER_LOOK_BACK; back += 1) {
        const day = new Date(today - back * 24 * 3_600_000).toISOString().slice(0, 10);
        try {
          const way = earlierWay((await ctx.read(`Personas/${MAKE_IT_EASIER_ID}/${day}.md`)).body);
          if (!way) continue;
          if (back < EASIER_GAP_DAYS) return { summary: `Posted a card ${back} day${back === 1 ? "" : "s"} ago, waits` };
          earlier.push(way);
        } catch {
          // no note that day
        }
      }
      // A note that sounds hard: say nothing that run. No model call, no note words.
      if (entries.some((entry) => soundsLikeDistress(memoryWords(entry.content)))) {
        ctx.writeNote(`${ctx.today}.md`, note(ctx.today, entries.length, ["- Nothing this time."]));
        return { summary: `Read ${entries.length} notes, stayed quiet` };
      }
      const lines: string[] = [];
      let used = 0;
      entries.forEach((entry, index) => {
        const text = `[${index + 1}] ${entry.capturedAt.slice(0, 10)} ${memoryTitle(entry)}: ${memoryWords(entry.content).slice(0, 300)}`;
        if (used + text.length > PROMPT_CHARS) return;
        used += text.length;
        lines.push(text);
      });
      const prompt = [
        `These are the notes the person saved in the last ${EASIER_DAYS} days, newest first:`,
        "",
        ...lines,
        ...(earlier.length ? ["", "Easier ways you offered before. Offer a different one:", ...earlier.map((way) => `- ${way}`)] : []),
        "",
        'Reply with JSON only: {"easier": {"noticed": "one sentence to them naming what they keep doing again and again", "effort": "that effort in at most 6 of their own words", "idea": "the easier way: one concrete sentence that starts with a verb", "short": "the easier way in at most 6 words", "saves": "time" or "money" or "effort", "yes": "one sentence: what it would save them", "no": "one honest sentence: why it might not fit them", "sources": [numbers of the notes it shows in]}} or {"easier": null}',
      ].join("\n");
      const parsed = parseEasierWay(parseJsonReply(await ctx.think({ system: SYSTEM, prompt })));
      // S36: notes named the way the person knows them, never by the model's numbers.
      const said = memoryPhrases(entries);
      const found = parsed ? { ...parsed, noticed: namedMemories(parsed.noticed, said), yes: namedMemories(parsed.yes, said), no: namedMemories(parsed.no, said) } : null;
      const sources = (found?.sources ?? []).map((n) => entries[n - 1]).filter((entry): entry is MemoryEntry => entry !== undefined);
      const why = !found ? null
        : isProjectWork(found.noticed, found.effort, found.idea, found.short) ? "the idea was project work"
        : soundsClinical(found.noticed, found.effort, found.idea, found.short, found.yes, found.no) ? "the words were too clinical"
        : sources.length < 2 ? "it showed in fewer than two notes"
        : null;
      if (!found || why) {
        ctx.writeNote(`${ctx.today}.md`, note(ctx.today, entries.length, [why ? `- Nothing this time: ${why}, left out.` : "- Nothing this time."]));
        return { summary: `Read ${entries.length} notes, nothing to make easier${why ? `; left out one because ${why}` : ""}` };
      }
      const notePath = `Personas/${MAKE_IT_EASIER_ID}/${ctx.today}.md`;
      ctx.writeNote(`${ctx.today}.md`, note(ctx.today, entries.length, [
        "## Noticed", "", found.noticed, "",
        "## Easier", "", found.idea, "",
        `Saves ${found.saves}.`, "",
        "## From", "", ...sources.map((entry) => `- [[${entry.evidenceRef.replace(/\.md(?=#)/, "")}|${label(entry)}]]`),
      ]));
      const links: InboxLink[] = [...sources.map((entry) => ({ label: label(entry), path: entry.path })), { label: "Its notes", path: notePath }];
      ctx.postFinding({
        title: found.idea,
        body: `${found.noticed}\n\nSaves ${found.saves}.`,
        links,
        // S36's card: the effort that repeats, to the easier way; why yes, why not.
        card: namedCard(cleanHelperCard({ picture: { change: "try", from: found.effort, to: found.short }, yes: found.yes, no: found.no }) ?? { picture: null, yes: found.yes, no: found.no }, said),
      });
      return { summary: `Read ${entries.length} notes and offered one easier way` };
    },
  };
}

function note(today: string, read: number, body: string[]): string {
  return ["---", `title: Make it easier ${today}`, "type: persona-note", `persona: ${MAKE_IT_EASIER_ID}`, `created: ${today}`, `memories_read: ${read}`, "---", "", `# Make it easier ${today}`, "", ...body, ""].join("\n");
}
