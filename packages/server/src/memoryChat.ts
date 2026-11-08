import { createHash } from "node:crypto";
import type { Answer, BrainEngine, SourceRef } from "zenod";
// Subpath, not the "zenod" entry: customerLayer.ts (and so this module) is bundled into Phylax.
import { askNonAnswer } from "zenod/answer-protocol";
import { memoryAppPath, rankMemories, type RankedMemory } from "./rankedMemory.js";

/**
 * The web app's chat with your memory (EPIC-12 E12-1, row S1). A question is answered from the
 * user's own vault by the read-only ask loop (engine.ask: no store tool, no conversation history),
 * next to the top memories from ranked retrieval (S3a) with their match percentages and links.
 * Nothing is saved by asking: only an explicit Keep files something, through the same durable
 * store job MCP store_memory uses (E12-A1). Web app only; the WhatsApp and Telegram chat paths
 * are untouched (root L-6).
 */

export const MEMORY_CHAT_MAX_QUESTION_CHARS = 2_000;
export const MEMORY_KEEP_MAX_CHARS = 8_000;
const MEMORY_CHAT_TOP = 5;
/** Ranked pool the cited memories are looked up in, so a cited memory shows its own percentage (E12-S3c). */
const MEMORY_CHAT_POOL = 20;
/** Memories the fast answer reads (E12-S1b): the five shown plus three more it may cite. */
const MEMORY_CHAT_CONTEXT = 8;

export interface MemoryChatMemory extends RankedMemory {
  /** The answer cites this memory. */
  cited: boolean;
}

export interface MemoryChatSource {
  /** The memory's number in the answer's citations (E12-S1b), when it has one. */
  rank?: number;
  path: string;
  title: string;
  url: string;
  appPath: string;
}

export interface MemoryChatAnswer {
  question: string;
  /** False when Zenod has no checked answer; the app then shows `answer` as a note and offers no Keep. */
  answered: boolean;
  answer: string;
  /** Top memories for the question, in rank order, each with its match percentage and links. */
  memories: MemoryChatMemory[];
  /** Sources the answer cites that are not among the top memories. */
  alsoCited: MemoryChatSource[];
  ms: number;
  /**
   * How the answer was made and checked (E12-S1b): "quoted" when every citation's quote was found in
   * the memory it names, "ask" when the read-only ask loop answered (no streaming chat model).
   */
  checkedBy?: "quoted" | "ask";
}

export interface MemoryChatStreamHandlers {
  /** The top memories, as soon as ranked retrieval has them (before any model call). */
  onMemories?(memories: MemoryChatMemory[]): void;
  /** Answer prose as the model writes it; replaced by the final answer once checked. */
  onText?(delta: string): void;
}

const basePath = (path: string) => path.split("#")[0]!;

const titleOf = (path: string) => basePath(path).split("/").pop()!.replace(/\.md$/i, "");

const NON_ANSWER_TEXT = {
  retry: "Zenod could not put a checked answer together this time. The memories below match your question: open them, or ask again.",
  unverified: "No confident answer: Zenod found no note that answers this directly. The closest memories are below.",
  unchecked: "No confident answer: Zenod could not check its answer against your memories, so it is not shown. The closest memories are below.",
  none: "No memory matches this question yet.",
} as const;

/** One read-only ask; a protocol slip by the model is asked once more before giving up. */
async function askOnce(engine: BrainEngine, question: string): Promise<Answer> {
  const first = await engine.ask(question);
  return askNonAnswer(first.text) === "retry" ? engine.ask(question) : first;
}

/**
 * The chat answer, fast path (E12-S1b): the ranked memories go out at once, then one streamed model
 * call answers from them, citing them by number, and each citation is checked against its memory.
 * An answer that does not pass the check is not shown: the user sees "no confident answer" and the
 * memories. Engines without a streaming chat model fall back to the read-only ask loop (S1).
 */
export async function streamAnswerFromMemory(
  engine: BrainEngine,
  question: string,
  handlers: MemoryChatStreamHandlers = {},
): Promise<MemoryChatAnswer> {
  const started = performance.now();
  const ranked = await rankMemories(engine, question, MEMORY_CHAT_POOL);
  // The top 5, plus any memory the answer cites that ranked lower, each with its own percentage (E12-S3c).
  const shownMemories = (cited: ReadonlySet<string>) =>
    ranked.results
      .map((memory) => ({ ...memory, cited: cited.has(memory.path) }))
      .filter((memory) => memory.rank <= MEMORY_CHAT_TOP || memory.cited);
  handlers.onMemories?.(shownMemories(new Set()));
  if (!engine.answerFromMemories) return askAnswer(engine, question, started, ranked.results);
  if (ranked.results.length === 0) {
    return { question, answered: false, answer: NON_ANSWER_TEXT.none, memories: [], alsoCited: [], ms: Math.round(performance.now() - started), checkedBy: "quoted" };
  }
  const check = await engine.answerFromMemories(
    question,
    ranked.results.slice(0, MEMORY_CHAT_CONTEXT).map((memory) => ({ n: memory.rank, path: memory.path, title: memory.title, snippet: memory.snippet })),
    handlers.onText,
  );
  if (!check) return askAnswer(engine, question, started, ranked.results);
  const citedPaths = new Set(ranked.results.filter((memory) => check.cited.includes(memory.rank)).map((memory) => memory.path));
  const memories = shownMemories(check.checked ? citedPaths : new Set());
  return {
    question,
    answered: check.checked,
    answer: check.checked ? check.text : check.reason === "no_answer" ? NON_ANSWER_TEXT.unverified : NON_ANSWER_TEXT.unchecked,
    memories,
    alsoCited: [],
    ms: Math.round(performance.now() - started),
    checkedBy: "quoted",
  };
}

export function answerFromMemory(engine: BrainEngine, question: string): Promise<MemoryChatAnswer> {
  return streamAnswerFromMemory(engine, question);
}

/** S1's answer: the read-only ask loop next to the ranked memories (engines without a chat model). */
async function askAnswer(engine: BrainEngine, question: string, started: number, ranked: RankedMemory[]): Promise<MemoryChatAnswer> {
  const answer = await askOnce(engine, question);
  return { ...fromAsk(question, answer, ranked, started), checkedBy: "ask" };
}

function fromAsk(question: string, answer: Answer, ranked: RankedMemory[], started: number): MemoryChatAnswer {
  const nonAnswer = askNonAnswer(answer.text);
  const cited = new Set(answer.sources.map((source) => basePath(source.path)));
  // The top 5, plus any memory the answer cites that ranked lower, each with its own percentage.
  const memories = ranked
    .map((memory) => ({ ...memory, cited: cited.has(basePath(memory.path)) }))
    .filter((memory) => memory.rank <= MEMORY_CHAT_TOP || memory.cited);
  const shown = new Set(memories.map((memory) => basePath(memory.path)));
  const alsoCited: MemoryChatSource[] = [];
  for (const source of answer.sources as SourceRef[]) {
    const path = basePath(source.path);
    if (shown.has(path)) continue;
    shown.add(path);
    alsoCited.push({ path, title: titleOf(path), url: source.url, appPath: memoryAppPath(path) });
  }
  return {
    question,
    answered: nonAnswer === null,
    answer: nonAnswer ? NON_ANSWER_TEXT[nonAnswer] : answer.text,
    memories,
    alsoCited,
    ms: Math.round(performance.now() - started),
  };
}

export type MemoryKeepInput =
  | { kind: "note"; content: string }
  | { kind: "answer"; question: string; answer: string };

/** Parse a Keep request; null when it carries nothing to keep or is too long. */
export function parseMemoryKeep(body: unknown): MemoryKeepInput | null {
  const value = (body ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string).trim() : "");
  if (value.kind === "answer") {
    const question = text("question");
    const answer = text("answer");
    if (!question || !answer || question.length + answer.length > MEMORY_KEEP_MAX_CHARS) return null;
    return { kind: "answer", question, answer };
  }
  const content = text("content");
  if (!content || content.length > MEMORY_KEEP_MAX_CHARS) return null;
  return { kind: "note", content };
}

/**
 * The words a Keep files: a note as typed, an answer under the question it answered (the first
 * line names the entry in the Log, so the question leads).
 */
export function memoryKeepContent(input: MemoryKeepInput): string {
  if (input.kind === "note") return input.content;
  return `${input.question}\n\n${input.answer}\n\n(Answer kept from a chat in the Zenod app.)`;
}

/** One Keep per content: a double tap or a retry files it once. */
export function memoryKeepIdempotencyKey(tenantId: string, content: string): string {
  return `${tenantId}:web-keep:${createHash("sha256").update(content).digest("hex").slice(0, 32)}`;
}

export function isMemoryKeepJobKey(tenantId: string, key: string | null): boolean {
  return Boolean(key?.startsWith(`${tenantId}:web-keep:`));
}
