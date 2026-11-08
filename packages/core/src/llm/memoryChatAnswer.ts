// The web app's fast chat answer (EPIC-12 E12-S1b): one streamed model call over the memories that
// ranked retrieval already found, cited by number and checked against them by the host. No imports,
// no I/O: the prompt, the stream filter and the check are plain functions the engine and tests share.

/** One memory given to the model, numbered by its rank. */
export interface MemoryChatContext {
  n: number;
  path: string;
  title: string;
  text: string;
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

const SYSTEM = [
  "You answer a person's question from their own memory notes, which are given to you numbered [1], [2], ...",
  "Rules:",
  "- Use only what the notes say. Never add facts from general knowledge, never guess.",
  "- Answer in one to four short sentences, plain words, in the language of the question. Speak to the person as \"you\".",
  "- After each claim, cite the note it comes from by its number in square brackets, like [2] or [1][3].",
  `- Then write a line with only ${SOURCES_HEADING} and, for each note you cited, one line: the number in brackets and a short exact quote copied word for word from that note that supports your answer, in double quotes. Example:`,
  `  ${SOURCES_HEADING}`,
  "  [2] \"the spare key is under the blue pot\"",
  `- If the notes do not answer the question, write only ${MEMORY_CHAT_NO_ANSWER} and nothing else.`,
].join("\n");

/** Trim a memory to the model's budget, keeping the part around the search snippet when it is long. */
export function memoryChatExcerpt(body: string, snippet = "", max = MEMORY_CHAT_CONTEXT_CHARS): string {
  const text = body.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length <= max) return text;
  const probe = snippet.replace(/[*_`>#]/g, "").trim().slice(0, 40);
  const at = probe ? text.toLowerCase().indexOf(probe.toLowerCase()) : -1;
  const start = at > max / 2 ? Math.min(at - Math.floor(max / 3), text.length - max) : 0;
  return `${start > 0 ? "…" : ""}${text.slice(start, start + max).trim()}…`;
}

export function memoryChatPrompt(question: string, memories: readonly MemoryChatContext[]): MemoryChatPrompt {
  const notes = memories.map((memory) => `[${memory.n}] ${memory.title} (${memory.path})\n${memory.text}`).join("\n\n");
  return { system: SYSTEM, prompt: `NOTES\n\n${notes}\n\nQUESTION\n${question}` };
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
  if (verified.length !== cited.length) return { checked: false, reason: "citation_not_found", text, cited: verified };
  return { checked: true, reason: null, text, cited: verified.sort((a, b) => a - b) };
}
