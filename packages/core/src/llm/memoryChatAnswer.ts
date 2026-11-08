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
  /** What the note is (E12-S16): the person's own note, an agent's note, or a topic page Zenod wrote. */
  kind?: "voice" | "own" | "note" | "agent" | "page";
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
/** Characters for the notes that match the question best (E12-S16): read whole, so the decision is not cut. */
export const MEMORY_CHAT_WHOLE_CONTEXT_CHARS = 9_000;
const ABOUT_HEADING = "ABOUT";

const SYSTEM = [
  "You answer a person's question from their own memory notes, which are given to you numbered [1], [2], ...",
  "Many notes are their voice notes, transcribed: what they said, in their words.",
  "Rules:",
  "- Use only what the notes say. Never add facts from general knowledge, never guess.",
  `- First decide which note is about exactly what is asked: the same subject, and the same request, decision, event, place or project when the question names one. Write it on the first line: ${ABOUT_HEADING} and its number, like ${ABOUT_HEADING} [3]. Add a second number only for a note about the very same thing (the same request said twice), never for a related one. For a question about a time or over many notes, list every note you answer from.`,
  "- When the question asks what the person said, asked, wanted, felt or decided, the note it is about is one of their own notes (\"your voice note\", \"your note\") whenever one of them speaks of it. Topic pages are summaries Zenod wrote, and agent notes are reports: neither is what the person said.",
  `- Answer only from the notes on the ${ABOUT_HEADING} line. The other notes are nearby: a related subject, another project, place or time. Never mix their points in, even when they look related.`,
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

const KIND_LABEL = { voice: "your voice note", own: "your note", note: "note", agent: "agent note", page: "topic page" } as const;
/** The heading of a captured file ("Voice note "AC8C….ogg" ingeste…"): no words of the note, so the kind says it. */
const CAPTURE_TITLE = /^(?:voice note|audio|screenshot\/image|image|document|pdf|file) "[^"]*"/i;

export function memoryChatPrompt(question: string, memories: readonly MemoryChatContext[], today?: string): MemoryChatPrompt {
  const notes = memories.map((memory) => {
    const label = memory.kind ? KIND_LABEL[memory.kind] : null;
    const title = label && (CAPTURE_TITLE.test(memory.title) || /^your (?:voice )?note$/i.test(memory.title)) ? label : label ? `${label}: ${memory.title}` : memory.title;
    const head = `[${memory.n}] ${title} (${memory.path})${memory.when ? ` captured ${memory.when}` : ""}`;
    const filed = memory.filed?.length ? `\nFiled into: ${memory.filed.join(", ")}` : "";
    return `${head}${filed}\n${memory.text}`;
  }).join("\n\n");
  return { system: SYSTEM, prompt: `${today ? `TODAY\n${today}\n\n` : ""}NOTES\n\n${notes}\n\nQUESTION\n${question}` };
}

/** One note the whole-read pick looks at: its full text (not the excerpt) and whether the person wrote or said it. */
export interface MemoryChatFocusCandidate {
  n: number;
  title: string;
  text: string;
  own: boolean;
}

/** Questions over many notes have no single focus: they are answered from all of them. */
const MANY_NOTES = /\b(?:top|topics?|themes?|everything|all (?:the|my)|most|often|summar(?:y|ise|ize)|overview|list)\b/i;
const FIRST_PERSON = /\b(?:i|i'm|i've|i'd|my|me|mine|we|we're|our|us)\b/i;
const FOCUS_EXTRA_STOP = new Set(["going", "mean", "means", "make", "made", "need", "also", "some", "more", "much", "very", "thing", "things", "about", "kind", "time", "work", "works", "team"]);

/**
 * The notes read whole (E12-S16), picked by the host without a model call: the notes with one
 * passage holding most of the question's telling words (weighted by how few of the read notes hold
 * each, pairs of them side by side counting extra), the person's own notes first when they ask about
 * what they said, then rank. At most two, none when no passage holds half the question or the
 * question spans many notes. Word matching is right about two times in three, so this only decides
 * what is read deeper; the model says which notes the question is about (the ABOUT line).
 */
export function memoryChatFocus(question: string, candidates: readonly MemoryChatFocusCandidate[]): number[] {
  if (candidates.length < 2 || MANY_NOTES.test(question)) return [];
  const wanted = [...focusWords(question)].filter((word) => !FOCUS_EXTRA_STOP.has(word));
  if (wanted.length === 0) return [];
  const match = (word: string, have: ReadonlySet<string>) => have.has(word) || (word.length >= 5 && [...have].some((w) => w.startsWith(word.slice(0, 5))));
  // Pairs of telling words next to each other in the question ("house decision", "demo videos").
  const tokens = flatWords(question).filter((word) => wanted.includes(word));
  const pairs = tokens.slice(1).map((word, k) => `${tokens[k]!.slice(0, 5)} ${word.slice(0, 5)}`);
  const notes = candidates.map((candidate) => {
    const windows = focusWindows(`${candidate.title}. ${candidate.text}`);
    return windows.map((window) => ({ have: focusWords(window), stems: ` ${flatWords(window).map((w) => w.slice(0, 5)).join(" ")} ` }));
  });
  const weight = new Map(wanted.map((word) => {
    const df = notes.filter((windows) => windows.some((window) => match(word, window.have))).length;
    return [word, df === 0 ? 0 : Math.log(1 + candidates.length / df)];
  }));
  const total = [...weight.values()].reduce((sum, w) => sum + w, 0);
  if (total === 0) return [];
  const personal = FIRST_PERSON.test(question);
  const scored = candidates.map((candidate, i) => {
    let coverage = 0;
    for (const window of notes[i]!) {
      const held = wanted.reduce((sum, word) => sum + (match(word, window.have) ? weight.get(word)! : 0), 0) / total;
      const together = pairs.filter((pair) => window.stems.includes(` ${pair} `)).length;
      coverage = Math.max(coverage, held + 0.25 * together);
    }
    return { n: candidate.n, coverage, score: coverage * (personal && candidate.own ? 1.2 : 1) + 0.05 * (1 - i / candidates.length) };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  if (best.coverage < 0.5) return [];
  return scored.filter((s, k) => k === 0 || (k < 2 && s.coverage >= 0.5 && s.score >= best.score * 0.95)).map((s) => s.n);
}

const flatWords = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];

/** Overlapping windows of about 600 characters, cut at sentence ends: where one passage says it. */
function focusWindows(text: string): string[] {
  const sentences = text.match(/[^.!?\n]+(?:[.!?]+|\n+|$)/g) ?? [text];
  const windows: string[] = [];
  for (let start = 0; start < sentences.length; start++) {
    let window = "";
    for (let end = start; end < sentences.length && window.length < 600; end++) window += sentences[end];
    windows.push(window);
    if (window.length < 600) break;
  }
  return windows.length ? windows : [text];
}

/**
 * Streams only the answer prose: holds back a possible NO_ANSWER and everything from the SOURCES
 * line on. Feed it each model delta; it calls `emit` with the text that is safe to show.
 */
export function memoryChatStreamFilter(emit: (text: string) => void): { push(delta: string): void; end(): string } {
  let full = "";
  let shown = 0;
  /** Where the prose starts: after the ABOUT line (E12-S16), once it is complete; null while it is still arriving. */
  const proseStart = (final: boolean): number | null => {
    const lead = full.length - full.trimStart().length;
    const rest = full.slice(lead).replace(/^[ \t*#]*/, "");
    if (rest.startsWith(ABOUT_HEADING)) {
      const lineEnd = full.indexOf("\n", lead);
      if (lineEnd < 0) return final ? full.length : null;
      return lineEnd + 1 + (full.slice(lineEnd + 1).length - full.slice(lineEnd + 1).trimStart().length);
    }
    return !final && rest.length < ABOUT_HEADING.length && ABOUT_HEADING.startsWith(rest) ? null : 0;
  };
  const visibleEnd = (final: boolean, start: number): number => {
    const lead = full.slice(start).trimStart();
    if (lead.startsWith(MEMORY_CHAT_NO_ANSWER) || (!final && MEMORY_CHAT_NO_ANSWER.startsWith(lead))) return start;
    const heading = full.search(new RegExp(`(^|\\n)[ \\t*#]*${SOURCES_HEADING}\\b`));
    if (heading >= start) return heading;
    // A SOURCES line may be arriving: hold back the last partial line if it could start one.
    if (final) return full.length;
    const lastBreak = full.lastIndexOf("\n");
    const tail = full.slice(lastBreak + 1).replace(/^[ \t*#]*/, "");
    return tail && SOURCES_HEADING.startsWith(tail.slice(0, SOURCES_HEADING.length)) ? Math.max(start, lastBreak + 1) : full.length;
  };
  const flush = (final: boolean) => {
    const start = proseStart(final);
    if (start === null) return;
    shown = Math.max(shown, start);
    const end = visibleEnd(final, start);
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

/**
 * Keep the claims with at least one allowed citation mark, without their other marks. A claim is the
 * text up to its citation marks. A line that cited something and lost every claim goes.
 */
function keepClaims(text: string, allowed: ReadonlySet<number>): { text: string; claims: number; kept: number } {
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
      if (!numbers.some((n) => allowed.has(n))) continue;
      kept++;
      result += claim + (/^\s*/.exec(marks)?.[0] ?? "") + numbers.filter((n) => allowed.has(n)).map((n) => `[${n}]`).join("");
    }
    return /\[\d+\]/.test(line) && !/\[\d+\]/.test(result) ? null : result.replace(/^([-*]\s*)[,;:]\s*/, "$1").replace(/^[,;:]\s*/, "");
  }).filter((line): line is string => line !== null);
  return { text: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), claims, kept };
}

/** Split the model output into prose and quotes, and check every citation against its memory. */
export function checkMemoryChatAnswer(output: string, memories: readonly MemoryChatContext[]): MemoryChatCheck {
  let raw = output.trim();
  // E12-S16: the ABOUT line names the notes the question is about; the answer may only rest on them.
  const about = new RegExp(`^[ \\t*#]*${ABOUT_HEADING}\\b([^\\n]*)(?:\\n|$)`).exec(raw);
  const focus = new Set([...(about?.[1] ?? "").matchAll(/\[?(\d+)\]?/g)].map((match) => Number(match[1])));
  if (about) raw = raw.slice(about[0].length).trim();
  if (!raw) return { checked: false, reason: about ? "no_answer" : "empty", text: "", cited: [] };
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
  let checkedText = text;
  if (verified.length !== cited.length) {
    // E12-S1b round 2: a long answer cites many notes, and one missing or loose quote used to hide all
    // of it. Now only the claims that rest on unchecked citations go. The rest is shown only when at
    // least half the claims survive; otherwise nothing is shown.
    const kept = keepClaims(text, new Set(verified));
    if (verified.length === 0 || kept.kept === 0 || kept.kept * 2 < kept.claims || !kept.text) return { checked: false, reason: "citation_not_found", text, cited: verified };
    checkedText = kept.text;
  }
  // E12-S16: a claim that rests only on a note outside the ABOUT line is a neighbouring note mixed in,
  // and goes. When nothing would be left, the model's ABOUT line is what was wrong: the answer stays.
  const onFocus = focus.size ? keepClaims(checkedText, new Set(verified.filter((n) => focus.has(n)))) : null;
  if (onFocus && onFocus.kept > 0 && onFocus.text) checkedText = onFocus.text;
  const marked = new Set([...checkedText.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])));
  return { checked: true, reason: null, text: checkedText, cited: verified.filter((n) => marked.size === 0 || marked.has(n)).sort((a, b) => a - b) };
}
