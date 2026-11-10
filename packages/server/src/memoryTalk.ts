import type { BrainEngine, MemoryEntry } from "zenod";
import { memoryAppPath, rankMemories } from "./rankedMemory.js";
import { isSensitiveMemory, MEMORY_CHAT_FLOOR, MEMORY_CHAT_MAX_QUESTION_CHARS, MEMORY_CHAT_SENSITIVE_FLOOR, rankWithReadings, type MemoryChatMemory } from "./memoryChat.js";
import { readAsNote, shownReadings, type ReadAs } from "./quickIndexRead.js";
import { BUILT_IN_PERSONAS, memoryTitle, personaById } from "./personaCatalog.js";

/**
 * EPIC-22 E22-2, Talk it over: a read-only talk in the web app's chat with a persona that reads the
 * person's memory. It starts from the box (the Send decision picked "talk"), from a persona card or
 * from an inbox card. Each turn ranks the memories that match, reads them, and the persona answers
 * in one streamed call on the chat model, metered like every call. Nothing is kept or changed, and
 * the talk lives in the app only: the WhatsApp and Telegram paths never reach it (root L-6).
 * The conversation is the app's: it sends the earlier turns back with each message.
 */

/** The librarian itself, when no persona is named. */
export const LIBRARIAN = { id: "zenod", name: "Zenod", focus: "You help the person see what their memory holds about what they bring up." } as const;

const TALK_MEMORIES = 8;
const TALK_MAX_TURNS = 12;
/** An opener reads the newest memories, not a search. */
const OPENER_MEMORIES = 12;

export interface TalkRequest {
  message: string;
  persona: { id: string; name: string; focus: string };
  history: Array<{ role: "person" | "persona"; text: string }>;
  /** A talk started from a persona or inbox card: the persona speaks first. */
  opener: boolean;
}

export interface MemoryTalkReply {
  persona: { id: string; name: string };
  message: string;
  /** False when there is no chat model to talk with; `text` then says so. */
  talked: boolean;
  text: string;
  /** The memories the persona read, the cited ones marked. */
  memories: MemoryChatMemory[];
  ms: number;
  /** EPIC-14 S29: what the message's vague words were read as, from the quick index. */
  readAs?: ReadAs[];
}

/** The persona to talk with: a built-in persona by id or name (an inbox card names its sender), else the librarian. */
export function talkPersona(id: unknown): TalkRequest["persona"] {
  const key = typeof id === "string" ? id.trim() : "";
  const persona = key ? personaById(key) ?? BUILT_IN_PERSONAS.find((p) => p.name.toLowerCase() === key.toLowerCase()) ?? null : null;
  return persona ? { id: persona.id, name: persona.name, focus: `${persona.purpose} ${persona.brief}` } : { ...LIBRARIAN };
}

/** Parse the talk body; null when it carries nothing to talk about. */
export function parseTalkRequest(body: unknown): TalkRequest | null {
  const value = (body ?? {}) as Record<string, unknown>;
  const opener = value.opener === true;
  const message = typeof value.message === "string" ? value.message.trim() : "";
  if (!opener && !message) return null;
  if (message.length > MEMORY_CHAT_MAX_QUESTION_CHARS) return null;
  const history = (Array.isArray(value.history) ? value.history : [])
    .map((turn) => turn as { role?: unknown; text?: unknown })
    .filter((turn) => (turn.role === "person" || turn.role === "persona") && typeof turn.text === "string" && turn.text.trim())
    .slice(-TALK_MAX_TURNS)
    .map((turn) => ({ role: turn.role as "person" | "persona", text: (turn.text as string).trim().slice(0, MEMORY_CHAT_MAX_QUESTION_CHARS) }));
  return { message, persona: talkPersona(value.persona), history, opener };
}

/** What the persona is asked when it opens a talk from its card. */
export function openerMessage(persona: TalkRequest["persona"], about: string): string {
  return about
    ? `Let's talk about this: ${about}`
    : `Open our talk as ${persona.name}: tell me the one thing in my recent memories that stands out for what you look for, then ask me about it.`;
}

const shown = (memory: MemoryChatMemory) =>
  memory.cited || (memory.matchPercent >= MEMORY_CHAT_FLOOR && (memory.matchPercent >= MEMORY_CHAT_SENSITIVE_FLOOR || !isSensitiveMemory(memory)));

async function newestMemories(engine: BrainEngine): Promise<MemoryChatMemory[]> {
  const entries: MemoryEntry[] = await engine.searchEntries({ order: "newest", limit: OPENER_MEMORIES }).catch(() => []);
  return entries.map((entry, i) => ({
    rank: i + 1, path: entry.evidenceRef, title: memoryTitle(entry), snippet: entry.content.slice(0, 200), matchPercent: 0,
    url: entry.url, provider: entry.provider, appPath: memoryAppPath(entry.evidenceRef), treePath: "", kind: "log", cited: false,
  }));
}

export async function streamTalk(
  engine: BrainEngine,
  request: TalkRequest,
  handlers: {
    onMemories?(memories: MemoryChatMemory[]): void;
    onText?(delta: string): void;
    /** EPIC-14 S29: read the message's vague words against the quick index first (Runtime.readAs). */
    readAs?(message: string): Promise<ReadAs[]>;
  } = {},
): Promise<MemoryTalkReply> {
  const started = performance.now();
  const about = request.opener ? request.message : "";
  const message = request.opener ? openerMessage(request.persona, about) : request.message;
  const said = request.opener ? about : request.message;
  const readings = said && handlers.readAs ? await handlers.readAs(said).catch(() => [] as ReadAs[]) : [];
  const query = [...request.history.filter((turn) => turn.role === "person").slice(-1).map((turn) => turn.text), message].join(" ");
  const pool: MemoryChatMemory[] = request.opener && !about
    ? await newestMemories(engine)
    : (readings.length ? await rankWithReadings(engine, query, readings, TALK_MEMORIES, TALK_MEMORIES) : await rankMemories(engine, query, TALK_MEMORIES)).results.map((memory) => ({ ...memory, cited: false }));
  const note = readAsNote(readings);
  const shownAs = shownReadings(readings);
  const readAs = shownAs.length ? { readAs: shownAs } : {};
  const persona = { id: request.persona.id, name: request.persona.name };
  handlers.onMemories?.(pool.filter((memory) => memory.matchPercent === 0 || shown(memory)));
  const reply = engine.talkOverMemories
    ? await engine.talkOverMemories({
      persona: request.persona,
      message: note ? `${message}\n${note}` : message,
      history: request.history,
      memories: pool.map((memory) => ({ n: memory.rank, path: memory.path, title: memory.title, snippet: memory.snippet })),
    }, handlers.onText)
    : null;
  if (!reply || !reply.text) {
    return { persona, message, talked: false, text: "Talk it over needs Zenod's chat model, and it is not available just now. Try again in a moment.", memories: [], ms: Math.round(performance.now() - started), ...readAs };
  }
  const cited = new Set(reply.cited);
  const memories = pool
    .map((memory) => ({ ...memory, cited: cited.has(memory.rank) }))
    .filter((memory) => memory.cited || (memory.matchPercent > 0 && shown(memory)));
  return { persona, message, talked: true, text: reply.text, memories, ms: Math.round(performance.now() - started), ...readAs };
}
