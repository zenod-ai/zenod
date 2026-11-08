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

export interface MemoryChatMemory extends RankedMemory {
  /** The answer cites this memory. */
  cited: boolean;
}

export interface MemoryChatSource {
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
}

const basePath = (path: string) => path.split("#")[0]!;

const titleOf = (path: string) => basePath(path).split("/").pop()!.replace(/\.md$/i, "");

const NON_ANSWER_TEXT = {
  retry: "Zenod could not put a checked answer together this time. The memories below match your question: open them, or ask again.",
  unverified: "Zenod found no note that answers this directly. The closest memories are below.",
} as const;

/** One read-only ask; a protocol slip by the model is asked once more before giving up. */
async function askOnce(engine: BrainEngine, question: string): Promise<Answer> {
  const first = await engine.ask(question);
  return askNonAnswer(first.text) === "retry" ? engine.ask(question) : first;
}

export async function answerFromMemory(engine: BrainEngine, question: string): Promise<MemoryChatAnswer> {
  const started = performance.now();
  // Retrieval is deterministic (no LLM); the answer is a read-only ask over the same vault.
  const [ranked, answer] = await Promise.all([
    rankMemories(engine, question, MEMORY_CHAT_POOL),
    askOnce(engine, question),
  ]);
  const nonAnswer = askNonAnswer(answer.text);
  const cited = new Set(answer.sources.map((source) => basePath(source.path)));
  // The top 5, plus any memory the answer cites that ranked lower, each with its own percentage.
  const memories = ranked.results
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
