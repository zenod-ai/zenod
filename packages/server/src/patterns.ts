import type { MemoryEntry } from "zenod";
import type { InboxLink } from "./inboxStore.js";
import type { PersonaDefinition } from "./personaRunner.js";
import { isProjectWork } from "./helperScope.js";
import { cleanHelperCard, HELPER_CARD_WORDS, namedCard, namedMemories } from "./helperCard.js";

/**
 * Patterns and ideas (EPIC-14 S41). Jordi, 2026-11-10 23:08Z: "Can you hire a therapist on your
 * memory? … it's like a person that is looking at your thoughts, but it's looking at that perspective
 * of what are kind of cognitive behaviors or mindset that maybe there is research that points to
 * things to try."
 *
 * Every few days it reads the last 14 days of what the person said, voice notes first, and when it
 * sees a pattern in how they think or work (a worry that keeps coming back, a habit, a loop) it names
 * it gently and offers ONE idea to try that well-known research supports, with a one-line source and
 * the notes it came from, in the helper card's shape (why yes, why not, make your call; S36).
 *
 * Gentle by design: never a diagnosis, never clinical words, never alarming. When a note sounds like
 * real distress it says nothing at all that run, rather than advise. At most one card every few days,
 * even when run by hand. Built like Something to try (S38): off for new accounts, on for the accounts
 * that used helpers before (personaStore keepOnIfUsedBefore), one cheap model call a run.
 *
 * The catalog builds it (createPatterns) with its own word helpers, so this file never imports the
 * catalog and the two cannot load in a circle.
 */

/** What it shares with the other helpers (personaCatalog.ts). */
export interface PatternsWords {
  memoryOnly: string;
  memoryTitle(entry: MemoryEntry): string;
  memoryWords(content: string): string;
  parseJsonReply(text: string): Record<string, unknown> | null;
  /** How the person knows each memory, like "your voice note of 3 Nov". */
  memoryPhrases(entries: ReadonlyArray<MemoryEntry>): string[];
}

export const PATTERNS_ID = "patterns-and-ideas";
const PATTERNS_DAYS = 14;
/** It posts at most one card in this many days, even when run by hand. */
export const PATTERNS_GAP_DAYS = 3;
/** How many of its own earlier days it reads back, so it never names the same idea twice running. */
const PATTERNS_LOOK_BACK = 21;
const PATTERNS_MAX_MEMORIES = 80;
const PROMPT_CHARS = 14_000;

/**
 * Words that sound like real distress. When a note in the window has them the helper says nothing that
 * run: not about that note, not about anything else. Kept narrow on purpose.
 */
const DISTRESS = /\b(suicid\w*|kill (?:my ?self|myself)|end (?:it all|my life)|(?:want|wanted|wanting) to die|self[- ]harm\w*|hurt(?:ing)? myself|no reason to live|can'?t go on|cannot go on|hopeless(?:ness)?|panic attacks?|abused|abusive)\b/i;

/** Clinical or alarming words a card never uses. A reply with any of them is left out. */
const CLINICAL = /\b(diagnos\w*|disorders?|depress\w*|anxiety|therap\w*|clinical\w*|patholog\w*|symptoms?|medicat\w*|psychiatr\w*|psycholog\w*|mental (?:illness|health)|ADHD|OCD|PTSD|bipolar|trauma\w*|narcissis\w*|addict\w*|dangerous|alarming|warning sign\w*)\b/i;

export function soundsLikeDistress(text: string): boolean {
  return DISTRESS.test(text);
}

export function soundsClinical(...texts: Array<string | null | undefined>): boolean {
  return CLINICAL.test(texts.filter(Boolean).join("\n"));
}

/** One pattern and one idea, checked. */
export interface PatternIdea {
  /** One gentle sentence that names the pattern, said to the person. */
  noticed: string;
  /** The pattern in a few of their own words, for the card's picture. */
  topic: string;
  /** The idea to try: one sentence that starts with a verb. */
  idea: string;
  /** The idea's plain, well-known name, like "a worry window". */
  known: string;
  /** One line: who studied it and when. */
  source: string;
  yes: string;
  no: string;
  sources: number[];
}

const line = (value: unknown, max = 240) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max).trim() : "");

/** The pattern from its reply, or null when anything it needs is missing. */
export function parsePattern(reply: Record<string, unknown> | null): PatternIdea | null {
  const raw = reply?.pattern && typeof reply.pattern === "object" ? (reply.pattern as Record<string, unknown>) : null;
  if (!raw) return null;
  const found: PatternIdea = {
    noticed: line(raw.noticed),
    topic: line(raw.topic, 90),
    idea: line(raw.idea),
    known: line(raw.known, 80),
    source: line(raw.source, 160),
    yes: line(raw.yes),
    no: line(raw.no),
    sources: (Array.isArray(raw.sources) ? raw.sources : []).filter((n): n is number => Number.isInteger(n) && (n as number) > 0).slice(0, 5),
  };
  return found.noticed && found.idea && found.known && found.source && found.yes && found.no ? found : null;
}

const SYSTEM = [
  "You are Patterns and ideas, a kind, quiet helper that reads what a person said in their own notes over the last two weeks, mostly their voice notes.",
  "Look for ONE pattern in how they think or work that keeps coming back: a worry that returns, a habit, a loop they get stuck in, a way they talk to themselves, how they plan or put things off.",
  "Name it gently, in one sentence said to them, the way a thoughtful friend would: what you noticed, never a judgement.",
  "Then offer ONE small idea to try that well-known research supports, a known habit or way of thinking, and give its plain name and one line of where it comes from (who studied it and roughly when). Only name research you are sure exists.",
  "Never diagnose, never label the person, never use medical or clinical words, never alarm. No words like disorder, therapy, symptom, anxiety or depression: describe what they do in everyday words.",
  "If any note sounds like real distress or crisis, reply with null and say nothing about it.",
  "You are not a project manager: never suggest a task, a ticket, a release or work for a team or an agent. The pattern can show up in their work; the idea is for the person.",
  "Use only what the notes say. Never invent facts, names or dates. When no pattern clearly repeats across several notes, reply with null.",
  HELPER_CARD_WORDS,
].join(" ");

/** Its earlier note for a day, if any: the idea it named, and whether it posted. */
function earlierIdea(body: string): string | null {
  const found = /^## Idea\n\n(.+)$/m.exec(body);
  return found ? found[1]!.trim() : null;
}

export function createPatterns(words: PatternsWords): PersonaDefinition {
  const { memoryTitle, memoryWords, parseJsonReply, memoryPhrases } = words;
  const label = (entry: MemoryEntry) => `${memoryTitle(entry)} ${entry.capturedAt.slice(0, 10)}`;

  const recent = async (ctx: { recentMemories(input: { days: number; limit: number }): Promise<MemoryEntry[]> }) => {
    const all = await ctx.recentMemories({ days: PATTERNS_DAYS, limit: PATTERNS_MAX_MEMORIES });
    const voice = all.filter((entry) => entry.contentType === "voice_note" || entry.contentType === "audio" || /^(Voice note|Audio) "/.test(entry.title));
    return voice.length >= 3 ? voice : all;
  };

  return {
    id: PATTERNS_ID,
    name: "Patterns and ideas",
    purpose: "Every few days, one pattern in how you think or work, and one idea research supports.",
    brief: "Every 3 days it reads what you said in the last 2 weeks, your voice notes first. When something keeps coming back, like a worry, a habit or a loop, it names it gently and offers one idea to try that research supports, with where the idea comes from and the notes it noticed it in. It never diagnoses and stays quiet when a note sounds hard.",
    schedule: { every: "days", days: PATTERNS_GAP_DAYS },
    skills: ["read", "write-own-folder", "post-inbox"],
    defaultEnabled: false,
    // One cheap call every few days, plus reading its own earlier notes back.
    limits: { maxSteps: 40, maxRunUsd: 0.02, maxMonthUsd: 0.1 },

    async fingerprint(ctx) {
      const entries = await recent(ctx);
      return entries.length ? `${entries.length}:${entries[0]!.evidenceRef}` : null;
    },

    async run(ctx) {
      const entries = await recent(ctx);
      if (entries.length < 3) return { summary: `Read ${entries.length} notes, too few to see a pattern` };
      // What it said before: a card in the last few days means it waits; ideas it named are not repeated.
      const earlier: string[] = [];
      const today = Date.parse(`${ctx.today}T00:00:00Z`);
      for (let back = 1; back <= PATTERNS_LOOK_BACK; back += 1) {
        const day = new Date(today - back * 24 * 3_600_000).toISOString().slice(0, 10);
        try {
          const idea = earlierIdea((await ctx.read(`Personas/${PATTERNS_ID}/${day}.md`)).body);
          if (!idea) continue;
          if (back < PATTERNS_GAP_DAYS) return { summary: `Posted a card ${back} day${back === 1 ? "" : "s"} ago, waits` };
          earlier.push(idea);
        } catch {
          // no note that day
        }
      }
      // Real distress: say nothing about it, and nothing else this run. No model call, no note words.
      if (entries.some((entry) => soundsLikeDistress(memoryWords(entry.content)))) {
        ctx.writeNote(`${ctx.today}.md`, note(ctx.today, entries.length, ["- Nothing this time."]));
        return { summary: `Read ${entries.length} notes, stayed quiet` };
      }
      const lines: string[] = [];
      let used = 0;
      entries.forEach((entry, index) => {
        const text = `[${index + 1}] ${entry.capturedAt.slice(0, 10)} ${memoryTitle(entry)}: ${memoryWords(entry.content).slice(0, 400)}`;
        if (used + text.length > PROMPT_CHARS) return;
        used += text.length;
        lines.push(text);
      });
      const prompt = [
        `These are the notes the person saved in the last ${PATTERNS_DAYS} days, newest first:`,
        "",
        ...lines,
        ...(earlier.length ? ["", "Ideas you offered before. Offer a different one:", ...earlier.map((idea) => `- ${idea}`)] : []),
        "",
        'Reply with JSON only: {"pattern": {"noticed": "one gentle sentence to them naming the pattern you saw", "topic": "the pattern in at most 6 of their own words", "idea": "the idea to try, one sentence that starts with a verb", "known": "the idea\'s plain well-known name", "source": "one line: who studied it and roughly when", "yes": "one sentence: why it might help them", "no": "one honest sentence: why it might not fit them", "sources": [numbers of the notes it shows in]}} or {"pattern": null}',
      ].join("\n");
      const parsed = parsePattern(parseJsonReply(await ctx.think({ system: SYSTEM, prompt })));
      // S36: notes named the way the person knows them, never by the model's numbers.
      const said = memoryPhrases(entries);
      const found = parsed ? { ...parsed, noticed: namedMemories(parsed.noticed, said), yes: namedMemories(parsed.yes, said), no: namedMemories(parsed.no, said) } : null;
      const sources = (found?.sources ?? []).map((n) => entries[n - 1]).filter((entry): entry is MemoryEntry => entry !== undefined);
      const why = !found ? null
        : isProjectWork(found.noticed, found.idea) ? "the idea was project work"
        : soundsClinical(found.noticed, found.topic, found.idea, found.known, found.source, found.yes, found.no) ? "the words were too clinical"
        : sources.length < 2 ? "it showed in fewer than two notes"
        : null;
      if (!found || why) {
        ctx.writeNote(`${ctx.today}.md`, note(ctx.today, entries.length, [why ? `- Nothing this time: ${why}, left out.` : "- Nothing this time."]));
        return { summary: `Read ${entries.length} notes, no pattern${why ? `; left out one because ${why}` : ""}` };
      }
      const notePath = `Personas/${PATTERNS_ID}/${ctx.today}.md`;
      ctx.writeNote(`${ctx.today}.md`, note(ctx.today, entries.length, [
        "## Noticed", "", found.noticed, "",
        "## Idea", "", found.idea, "",
        `Known as ${found.known}. ${found.source}`, "",
        "## From", "", ...sources.map((entry) => `- [[${entry.evidenceRef.replace(/\.md(?=#)/, "")}|${label(entry)}]]`),
      ]));
      const links: InboxLink[] = [...sources.map((entry) => ({ label: label(entry), path: entry.path })), { label: "Its notes", path: notePath }];
      ctx.postFinding({
        title: found.idea,
        body: `${found.noticed}\n\nKnown as ${found.known}. ${found.source}`,
        links,
        // S36's card: what keeps coming back, to the idea by its name; why yes, why not.
        card: namedCard(cleanHelperCard({ picture: { change: "try", from: found.topic, to: found.known }, yes: found.yes, no: found.no }) ?? { picture: null, yes: found.yes, no: found.no }, said),
      });
      return { summary: `Read ${entries.length} notes and offered one idea` };
    },
  };
}

function note(today: string, read: number, body: string[]): string {
  return ["---", `title: Patterns and ideas ${today}`, "type: persona-note", `persona: ${PATTERNS_ID}`, `created: ${today}`, `memories_read: ${read}`, "---", "", `# Patterns and ideas ${today}`, "", ...body, ""].join("\n");
}
