// The web app's fast chat answer (EPIC-12 E12-S1b): one streamed model call over the memories that
// ranked retrieval already found, cited by number and checked against them by the host. No imports,
// no I/O: the prompt, the stream filter and the check are plain functions the engine and tests share.

/** One memory given to the model, numbered by its rank. */
export interface MemoryChatContext {
  n: number;
  path: string;
  title: string;
  text: string;
  /** When a Log entry was captured and what it is ("2026-11-07 22:44 UTC, voice note"), E12-S1b round 2. */
  when?: string;
  /** The topic pages a Log entry was filed into, by title. */
  filed?: readonly string[];
}

export interface MemoryChatPrompt {
  system: string;
  prompt: string;
}

/** Why an answer is not shown as checked; null when it is. */
export type MemoryChatUnchecked = "no_answer" | "no_citation" | "citation_not_found" | "empty";

export interface MemoryChatCheck {
  /** True only when every memory the answer cites backs it with a quote found in that memory. */
  checked: boolean;
  reason: MemoryChatUnchecked | null;
  /** The answer prose, without the quotes block. */
  text: string;
  /** Memory numbers the answer cites, each verified. */
  cited: number[];
}

export const MEMORY_CHAT_NO_ANSWER = "NO_ANSWER";
const SOURCES_HEADING = "SOURCES";
/** Characters per memory given to the model: enough for a note, small enough to answer fast. */
export const MEMORY_CHAT_CONTEXT_CHARS = 1_800;
/**
 * Characters for the best three memories (E12-S1b round 2): a voice note runs to thousands of
 * characters and the answer is often past the first window, so the top memories are read deeper.
 */
export const MEMORY_CHAT_TOP_CONTEXT_CHARS = 4_500;

const SYSTEM = [
  "You answer a person's question from their own memory notes, which are given to you numbered [1], [2], ...",
  "Many notes are their voice notes, transcribed: what they said, in their words.",
  "Rules:",
  "- Use only what the notes say. Never add facts from general knowledge, never guess.",
  "- Answer completely: give every main point the notes hold on the question, with its specifics (names, numbers, places, dates), not a vague summary.",
  "- Plain words, in the language of the question. Speak to the person as \"you\". Lead with the direct answer. When there are several points, use a short list, one point per line starting with \"- \". At most about 8 lines.",
  "- Questions about a time (\"today\", \"yesterday\", \"last week\", a date, \"my last voice note\") are about the notes captured then: use each note's capture date and TODAY below, and name the dates you answer from.",
  "- Questions over many notes (\"top topics\", \"what did I talk about\") are answered from all the notes given: group them by subject and lead with the subjects that come up most.",
  "- After each claim, cite the note it comes from by its number in square brackets, like [2] or [1][3].",
  `- Then write a line with only ${SOURCES_HEADING} and, for EVERY note number you cited above, one line: the number in brackets and a short exact quote copied word for word from that note's text (not its title or the lines above it) that supports your answer, in double quotes. A claim whose note has no quote line is removed. Example:`,
  `  ${SOURCES_HEADING}`,
  "  [2] \"the spare key is under the blue pot\"",
  `- If the notes do not answer the question, write only ${MEMORY_CHAT_NO_ANSWER} and nothing else.`,
].join("\n");

/** Ingest lines of a captured file (where the audio is, its hash, who transcribed it): not what was said. */
const INGEST_LINE = /^(?:>\s*)?(?:(?:voice note|audio|screenshot\/image|image|document|pdf|file) "[^"]*" ingested\b|raw artifact(?: url| sha256)?:|media type:|source(?: timestamp)?:|transcribed by\b|extraction artifact:|user context:|- (?:source|source-id|verbatim|content-type|captured-at|filed|filing|receipt|ops)\b)/i;

const focusWords = (value: string) =>
  new Set((value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((word) => !FOCUS_STOP.has(word)));
const FOCUS_STOP = new Set(["what", "when", "where", "which", "that", "this", "with", "have", "about", "from", "your", "they", "them", "there", "were", "would", "could", "should", "said", "tell", "does", "know", "want", "like", "just", "really", "think", "voice", "note", "notes"]);

/**
 * Trim a memory to the model's budget. Ingest lines go first; a long text keeps the passages that
 * hold the most of the focus words (the question, or the search snippet), in their original order,
 * with "…" where text was left out, so the part that answers is read even deep in a long note.
 */
export function memoryChatExcerpt(body: string, focus = "", max = MEMORY_CHAT_CONTEXT_CHARS): string {
  const stripped = body.replace(/^---\n[\s\S]*?\n---\n?/, "").split("\n").filter((line) => !INGEST_LINE.test(line.trim())).map((line) => line.replace(/^>\s?/, "")).join("\n");
  const text = stripped.replace(/\n{3,}/g, "\n\n").trim();
  if (text.length <= max) return text;
  // Passages of about 300 characters, cut at sentence ends.
  const passages: Array<{ at: number; text: string }> = [];
  const sentences = text.match(/[^.!?\n]+(?:[.!?]+|\n+|$)/g) ?? [text];
  let at = 0;
  let current = "";
  let start = 0;
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > 300) {
      passages.push({ at: start, text: current });
      start = at;
      current = "";
    }
    current += sentence;
    at += sentence.length;
  }
  if (current) passages.push({ at: start, text: current });
  const wanted = focusWords(focus);
  const scored = passages.map((passage, i) => {
    const words = focusWords(passage.text);
    const hits = [...wanted].filter((word) => words.has(word) || [...words].some((w) => w.startsWith(word.slice(0, 5)) && word.length >= 5)).length;
    return { i, ...passage, score: hits + (i === 0 ? 0.5 : 0) };
  });
  if (!wanted.size || scored.every((passage) => passage.score <= 0.5)) {
    return `${text.slice(0, max).trim()}…`;
  }
  // The best passages, each with its neighbour after it, until the budget is spent.
  const keep = new Set<number>();
  let used = 0;
  for (const passage of [...scored].sort((a, b) => b.score - a.score || a.i - b.i)) {
    if (passage.score <= 0) break;
    for (const j of [passage.i, passage.i + 1]) {
      const p = scored[j];
      if (!p || keep.has(j) || used + p.text.length > max) continue;
      keep.add(j);
      used += p.text.length;
    }
    if (used >= max * 0.9) break;
  }
  const order = [...keep].sort((a, b) => a - b);
  let out = order[0] === 0 ? "" : "…";
  order.forEach((j, k) => {
    out += (k > 0 && order[k - 1] !== j - 1 ? " … " : "") + scored[j]!.text.trim() + (k < order.length - 1 && order[k + 1] === j + 1 ? " " : "");
  });
  return `${out.trim()}${order.at(-1) === scored.length - 1 ? "" : "…"}`;
}

export function memoryChatPrompt(question: string, memories: readonly MemoryChatContext[], today?: string): MemoryChatPrompt {
  const notes = memories.map((memory) => {
    const head = `[${memory.n}] ${memory.title} (${memory.path})${memory.when ? ` captured ${memory.when}` : ""}`;
    const filed = memory.filed?.length ? `\nFiled into: ${memory.filed.join(", ")}` : "";
    return `${head}${filed}\n${memory.text}`;
  }).join("\n\n");
  return { system: SYSTEM, prompt: `${today ? `TODAY\n${today}\n\n` : ""}NOTES\n\n${notes}\n\nQUESTION\n${question}` };
}

/**
 * Streams only the answer prose: holds back a possible NO_ANSWER and everything from the SOURCES
 * line on. Feed it each model delta; it calls `emit` with the text that is safe to show.
 */
export function memoryChatStreamFilter(emit: (text: string) => void): { push(delta: string): void; end(): string } {
  let full = "";
  let shown = 0;
  const visibleEnd = (final: boolean): number => {
    const lead = full.trimStart();
    if (lead.startsWith(MEMORY_CHAT_NO_ANSWER) || (!final && MEMORY_CHAT_NO_ANSWER.startsWith(lead))) return 0;
    const heading = full.search(new RegExp(`(^|\\n)[ \\t*#]*${SOURCES_HEADING}\\b`));
    if (heading >= 0) return heading;
    // A SOURCES line may be arriving: hold back the last partial line if it could start one.
    if (final) return full.length;
    const lastBreak = full.lastIndexOf("\n");
    const tail = full.slice(lastBreak + 1).replace(/^[ \t*#]*/, "");
    return tail && SOURCES_HEADING.startsWith(tail.slice(0, SOURCES_HEADING.length)) ? lastBreak + 1 : full.length;
  };
  const flush = (final: boolean) => {
    const end = visibleEnd(final);
    if (end > shown) {
      emit(full.slice(shown, end));
      shown = end;
    }
  };
  return {
    push(delta: string) {
      full += delta;
      flush(false);
    },
    end() {
      flush(true);
      return full;
    },
  };
}

const words = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];

/** A quote is found when its words appear in the memory in order, or nearly all of them do. */
export function quoteFound(quote: string, memoryText: string): boolean {
  const q = words(quote);
  if (q.length < 2) return false;
  const m = words(memoryText);
  if (` ${m.join(" ")} `.includes(` ${q.join(" ")} `)) return true;
  const have = new Set(m);
  const content = q.filter((word) => word.length > 2 || /\d/.test(word));
  if (content.length < 3) return false;
  return content.filter((word) => have.has(word)).length / content.length >= 0.9;
}

/** Split the model output into prose and quotes, and check every citation against its memory. */
export function checkMemoryChatAnswer(output: string, memories: readonly MemoryChatContext[]): MemoryChatCheck {
  const raw = output.trim();
  if (!raw) return { checked: false, reason: "empty", text: "", cited: [] };
  if (raw.startsWith(MEMORY_CHAT_NO_ANSWER)) return { checked: false, reason: "no_answer", text: "", cited: [] };
  const heading = raw.search(new RegExp(`(^|\\n)[ \\t*#]*${SOURCES_HEADING}\\b`));
  const text = (heading >= 0 ? raw.slice(0, heading) : raw).trim();
  const quotesBlock = heading >= 0 ? raw.slice(heading) : "";
  if (!text) return { checked: false, reason: "empty", text: "", cited: [] };
  const byNumber = new Map(memories.map((memory) => [memory.n, memory]));
  const quotes = new Map<number, string[]>();
  for (const match of quotesBlock.matchAll(/\[(\d+)\][^"“”\n]*["“]([^"”\n]+)["”]/g)) {
    const n = Number(match[1]);
    quotes.set(n, [...(quotes.get(n) ?? []), match[2]!]);
  }
  const inText = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])))];
  const cited = inText.length ? inText : [...quotes.keys()];
  if (cited.length === 0) return { checked: false, reason: "no_citation", text, cited: [] };
  const verified = cited.filter((n) => {
    const memory = byNumber.get(n);
    return Boolean(memory && (quotes.get(n) ?? []).some((quote) => quoteFound(quote, memory.text)));
  });
  if (verified.length === cited.length) return { checked: true, reason: null, text, cited: verified.sort((a, b) => a - b) };
  // E12-S1b round 2: a long answer cites many notes, and one missing or loose quote used to hide all
  // of it. Now only the claims that rest on unchecked citations go: a claim is the text up to its
  // citation marks, kept when one of its marks is checked (its unchecked marks removed). The rest is
  // shown only when at least half the claims survive; otherwise nothing is shown.
  const ok = new Set(verified);
  let claims = 0;
  let kept = 0;
  const out = text.split("\n").map((line) => {
    const parts = line.split(/((?:\s*\[\d+\])+)/);
    let result = "";
    for (let i = 0; i < parts.length; i += 2) {
      const claim = parts[i] ?? "";
      const marks = parts[i + 1];
      if (marks === undefined) {
        result += claim;
        continue;
      }
      claims++;
      const numbers = [...marks.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
      if (!numbers.some((n) => ok.has(n))) continue;
      kept++;
      result += claim + marks.replace(/\s*\[(\d+)\]/g, (mark, n: string) => (ok.has(Number(n)) ? mark : ""));
    }
    // A line that cited something and lost every claim goes, with what was left of it.
    return /\[\d+\]/.test(line) && !/\[\d+\]/.test(result) ? null : result.replace(/^([-*]\s*)[,;:]\s*/, "$1").replace(/^[,;:]\s*/, "");
  }).filter((line): line is string => line !== null);
  const trimmed = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (verified.length === 0 || kept === 0 || kept * 2 < claims || !trimmed) return { checked: false, reason: "citation_not_found", text, cited: verified };
  return { checked: true, reason: null, text: trimmed, cited: verified.sort((a, b) => a - b) };
}
