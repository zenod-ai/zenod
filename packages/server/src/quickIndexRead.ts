import type { QuickIndexCorrection, QuickIndexView } from "./quickIndex.js";

/**
 * Chat reads the quick index (EPIC-14 S29): before Look up, Talk it over, a call's lookup or an MCP
 * answer searches, the vague words in the message ("the flat", "Ana's thing", "that cello thing")
 * are read against the index: the names the person uses for each place, the corrections they made,
 * and place names. No model call. Each reading adds its place's name to the search and keeps the
 * place's own page among the memories the answer reads; the reply shows the readings as one
 * "Read as" line the person can correct. WhatsApp and Telegram never call this (root L-6).
 */

export const READ_AS_MAX = 3;
const WORD_MIN_MEMORIES = 3;
const WORD_MAX_TITLE_WORDS = 6;

export interface ReadAs {
  /** The words in the message, as the person wrote them. */
  phrase: string;
  path: string;
  title: string;
  lineage: string[];
  /** Why: a name the person uses for it, a correction they made, its name, or a "that … thing" word. */
  by: "name" | "correction" | "title" | "word";
}

export type ReadAsIndex = Pick<QuickIndexView, "places"> & { corrections?: Record<string, QuickIndexCorrection> };

/** Lower case, no accents, single spaces, curly apostrophes made straight. */
export function foldPhrase(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Place names too plain to stand for one place when they appear in a question. */
const PLAIN_TITLES = new Set([
  "log", "logs", "note", "notes", "inbox", "ideas", "idea", "people", "person", "work", "health", "projects", "project",
  "areas", "area", "archive", "misc", "other", "others", "general", "tasks", "task", "today", "travel", "family", "home",
  "money", "memory", "memories", "zenod", "index", "tree", "readme", "agents", "personas", "databases", "attachments",
  "learning", "learnings", "plan", "plans", "meeting", "meetings", "call", "calls", "email", "emails", "the", "this", "that",
]);
const THING = "(?:thing|things|stuff|idea|project|plan|business|deal|story|issue|one|bit|topic|matter|cosa|tema|asunto|rollo)";
const WORD_STOP = new Set(["the", "that", "this", "my", "our", "your", "his", "her", "their", "new", "old", "big", "little", "other", "same", "whole", "last", "next", "first"]);

type Candidate = { start: number; end: number; reading: ReadAs; score: number; weight: number };

function boundaryRe(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, "gu");
}

/** Every place of `needle` (already folded) in the folded question, at word edges. */
function findAll(folded: string, needle: string): Array<{ start: number; end: number }> {
  if (!needle) return [];
  const found: Array<{ start: number; end: number }> = [];
  for (const match of folded.matchAll(boundaryRe(needle))) {
    const start = (match.index ?? 0) + match[1]!.length;
    found.push({ start, end: start + needle.length });
  }
  return found;
}

/**
 * The readings for a message: at most three places, longest and surest words first, no two
 * readings over the same words and one reading per place. Exact place names are read too (they
 * keep the place's page in reach) but `shown` drops them: there is nothing to correct when the
 * person said the place's own name.
 */
export function readAs(message: string, index: ReadAsIndex | null): ReadAs[] {
  if (!index || index.places.length === 0) return [];
  // Folding keeps lengths for Latin text, so spans map back to the message for the person's own words.
  const folded = foldPhrase(message.replace(/\s/g, " "));
  const original = message.replace(/\s/g, " ").normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
  const sameLength = original.length === folded.length;
  const words = (start: number, end: number) => (sameLength ? original.slice(start, end) : folded.slice(start, end));
  const byPath = new Map(index.places.map((place) => [place.path, place]));
  const candidates: Candidate[] = [];
  const add = (start: number, end: number, path: string, by: ReadAs["by"], score: number) => {
    const place = byPath.get(path);
    if (!place) return;
    candidates.push({ start, end, score: score + (end - start), weight: place.memories, reading: { phrase: words(start, end), path, title: place.title, lineage: place.lineage, by } });
  };
  const blocked = new Set<string>();
  for (const [key, correction] of Object.entries(index.corrections ?? {})) {
    const phrase = foldPhrase(key);
    if (correction.path === null) {
      blocked.add(phrase);
      continue;
    }
    for (const at of findAll(folded, phrase)) add(at.start, at.end, correction.path, "correction", 300);
  }
  const corrected = new Set(Object.keys(index.corrections ?? {}).map(foldPhrase));
  for (const place of index.places) {
    for (const name of place.names) {
      const phrase = foldPhrase(name);
      if (phrase.length < 3 || blocked.has(phrase) || corrected.has(phrase)) continue;
      for (const at of findAll(folded, phrase)) {
        // "the flat" is one name with "flat"; a leading article in the message is part of the words.
        const lead = /(?:^|\s)((?:the|my|our|that|this|el|la|mi) )$/.exec(folded.slice(0, at.start))?.[1] ?? "";
        add(at.start - lead.length, at.end, place.path, "name", 200);
      }
    }
    const title = foldPhrase(place.title);
    if (title.length >= 3 && !PLAIN_TITLES.has(title) && !blocked.has(title) && !corrected.has(title)) {
      for (const at of findAll(folded, title)) {
        // A three-letter name only as a name: "Ana's" or written with a capital.
        const possessive = folded.slice(at.end, at.end + 2) === "'s";
        if (title.length < 4 && !possessive && !(sameLength && /^\p{Lu}/u.test(original.slice(at.start, at.end)))) continue;
        // "Ana's thing", "Ana's birthday stuff": the vague words are part of what was read.
        const tail = possessive ? new RegExp(`^'s(?: [\\p{L}-]+)? ${THING}\\b`, "u").exec(folded.slice(at.end))?.[0] ?? "" : "";
        add(at.start, at.end + tail.length, place.path, tail ? "name" : "title", tail ? 150 : 100);
      }
    }
  }
  // "that cello thing", "the Ruzafa stuff": the word before the vague noun, found in one place's name.
  const vague = new RegExp(`(^|[^\\p{L}\\p{N}])(?:that|the|this|my|our|his|her|their|[\\p{L}]+'s) ((?:[\\p{L}\\p{N}-]{3,} ){1,2})${THING}\\b`, "gu");
  for (const match of folded.matchAll(vague)) {
    const keyWords = match[2]!.trim().split(" ").filter((word) => !WORD_STOP.has(word));
    if (keyWords.length === 0) continue;
    const start = (match.index ?? 0) + match[1]!.length;
    const end = (match.index ?? 0) + match[0].length;
    // A guess from one word only for a place the person keeps adding to, with a short name.
    const owners = index.places.filter((place) => place.memories >= WORD_MIN_MEMORIES && place.title.split(/\s+/).length <= WORD_MAX_TITLE_WORDS).filter((place) => {
      const haystack = [place.title, ...place.names].map(foldPhrase);
      return keyWords.every((word) => haystack.some((name) => findAll(name, word).length > 0));
    });
    // Only when the word points at one place, or one place holds clearly more of the person's notes.
    owners.sort((a, b) => b.memories - a.memories);
    const [top, next] = owners;
    if (top && (!next || top.memories >= 2 * Math.max(1, next.memories))) add(start, end, top.path, "word", 50);
  }
  candidates.sort((a, b) => b.score - a.score || b.weight - a.weight || a.start - b.start);
  const taken: Array<{ start: number; end: number }> = [];
  const places = new Set<string>();
  const out: Array<ReadAs & { start: number }> = [];
  for (const candidate of candidates) {
    if (out.length >= READ_AS_MAX) break;
    if (places.has(candidate.reading.path)) continue;
    if (taken.some((span) => candidate.start < span.end && span.start < candidate.end)) continue;
    taken.push({ start: candidate.start, end: candidate.end });
    places.add(candidate.reading.path);
    out.push({ ...candidate.reading, start: candidate.start });
  }
  return out.sort((a, b) => a.start - b.start).map(({ start: _start, ...reading }) => reading);
}

/** The readings worth a "Read as" line: not the ones where the person said the place's own name. */
export function shownReadings(readings: readonly ReadAs[]): ReadAs[] {
  return readings.filter((reading) => reading.by !== "title");
}

/** The search words for a message with its readings: the message, then each place's name not already in it. */
export function readAsQuery(message: string, readings: readonly ReadAs[]): string {
  const folded = foldPhrase(message);
  const extra = readings.map((reading) => reading.title).filter((title) => !folded.includes(foldPhrase(title)));
  return extra.length ? `${message} ${extra.join(" ")}` : message;
}

/** The note for the answer model: what the person's words were read as. */
export function readAsNote(readings: readonly ReadAs[]): string {
  const shown = shownReadings(readings);
  if (shown.length === 0) return "";
  return `(In this person's memory, ${shown.map((reading) => `"${reading.phrase}" means ${reading.lineage.join(" › ")}`).join("; ")}.)`;
}

/** One line: `"the flat" → Moving to Valencia · "Ana's thing" → People › Ana`. */
export function readAsLine(readings: readonly ReadAs[]): string {
  return shownReadings(readings).map((reading) => `"${reading.phrase}" → ${reading.lineage.join(" › ")}`).join(" · ");
}
