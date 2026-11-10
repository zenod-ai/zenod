import { createHash } from "node:crypto";
import type { Answer, BrainEngine, SourceRef } from "zenod";
// Subpath, not the "zenod" entry: customerLayer.ts (and so this module) is bundled into Phylax.
import { askNonAnswer } from "zenod/answer-protocol";
import { ruleSendRoute, type SendRoute } from "zenod/send-route";
import type { TaskJobInput } from "./taskJobStore.js";
import { memoryAppPath, rankMemories, type RankedMemories, type RankedMemory } from "./rankedMemory.js";
import { readAsNote, readAsQuery, shownReadings, type ReadAs } from "./quickIndexRead.js";

/**
 * The web app's chat with your memory (EPIC-12 E12-1, row S1). A question is answered from the
 * user's own vault by the read-only ask loop (engine.ask: no store tool, no conversation history),
 * next to the top memories from ranked retrieval (S3a) with their match percentages and links.
 * Nothing is saved by asking. Since EPIC-16 E16-B1 the app has one Send button: Zenod decides from
 * the message what to keep (routeSendMessage) and files it through the same durable store job MCP
 * store_memory uses (E12-A1); a question is never kept. Web app only; the WhatsApp and Telegram chat paths
 * are untouched (root L-6).
 */

export const MEMORY_CHAT_MAX_QUESTION_CHARS = 2_000;
export const MEMORY_KEEP_MAX_CHARS = 8_000;
const MEMORY_CHAT_TOP = 5;
/** Ranked pool the cited memories are looked up in, so a cited memory shows its own percentage (E12-S3c). */
const MEMORY_CHAT_POOL = 20;
/**
 * Memories the fast answer reads (E12-S1b): the five shown plus more it may cite. Round 2 (accuracy):
 * 16, not 8. On Jordi's real questions the note that answers ranked 9th to 16th in about a third
 * of the misses; the engine also adds the person's own best-matching notes after these.
 */
const MEMORY_CHAT_CONTEXT = 16;
/** EPIC-14 S29: the question's own top matches that keep their places when the quick index adds its readings. */
const READ_AS_KEEP = 8;
/**
 * The app chat's relevance floor (E15-S1): a memory under this match is not shown. Picked on Jordi's
 * 45 real questions: the lowest right source shown read 19 %, so 15 % keeps every one of them and
 * drops 7 of the 223 memories shown. A memory the checked answer cites is always shown.
 */
export const MEMORY_CHAT_FLOOR = 15;
/** A private memory (family, people, health, money) shows only from this match up, or when cited (E15-S1). */
export const MEMORY_CHAT_SENSITIVE_FLOOR = 50;

/**
 * A family, people, health or money note: flagged `private` when Zenod filed it, from what the note
 * says and where it sits (E15-S2, core vault/privacy.ts). It replaces E15-S1's word rule on titles and
 * branches, which took a company's tax branch for private money.
 */
export function isSensitiveMemory(memory: Pick<RankedMemory, "private">): boolean {
  return Boolean(memory.private);
}

/** Whether the app chat shows a memory: cited, or over the floor, and a sensitive one only on a strong match (E15-S1). */
function shownInApp(memory: MemoryChatMemory): boolean {
  if (memory.cited) return true;
  if (memory.matchPercent < MEMORY_CHAT_FLOOR) return false;
  return memory.matchPercent >= MEMORY_CHAT_SENSITIVE_FLOOR || !isSensitiveMemory(memory);
}

/**
 * What Zenod is and does today, in its own words (E15-S1): the app chat's answer to a question about
 * Zenod itself, with no memories. Keep it true: every line names something a user can do now.
 */
export const ABOUT_ZENOD = [
  "I'm Zenod, the librarian of your memory. The library is yours: your notes, voice notes and files. I look after it.",
  "",
  "- **Keep**: tell me something here, record a voice note, or send it on WhatsApp. I keep every word and file it on the right page of your memory tree, and say where it went.",
  "- **Look up**: ask me something and I answer from your own notes, with the memories I used, each with how well it matched.",
  "- **Talk it over**: want to think out loud? We talk it through, with me or one of your helpers, using what your memory holds.",
  "- **Job on the memory**: something filed in the wrong place or tangled? I make it a job for the memory desk, and it reports in your Inbox.",
  "- **Browse**: the Memory tab shows your memory at a glance, its tree and its graph. Connect Claude, ChatGPT, Cursor and others at [zenod.dev/connect](https://zenod.dev/connect).",
  "",
  "You never pick. I pick, I say which, and you can tap the label to change it. I only answer from what you have told me, and nothing is saved by asking.",
].join("\n");

const ABOUT_ZENOD_QUESTIONS: readonly RegExp[] = [
  /^(who|what) (are|r) (you|u)( really| exactly)?$/,
  /^(who|what) is (zenod|this|this app)$/,
  /^what (can|do|could) (you|zenod) do( for me)?$/,
  /^what are you (for|able to do|good for)$/,
  /^how (can|do|could) (you|zenod) help( me)?$/,
  /^how do(es)? (you|zenod|this|this app) work$/,
  /^how (do|can|should) i (use|start|talk to|connect|reach) (you|zenod|this|this app|my memory)\b.*$/,
  /^how (do|can|should) i (add|save|keep|record|send|store|find|search|see|browse|delete|remove|edit|fix|move|share|export|ask)\b.*\b(memory|memories|zenod|voice notes?|the tree|memory tree|this app|the app|inbox)$/,
  /^(qui[eé]n|qu[eé]) eres( t[uú])?$/,
  /^qu[eé] es (zenod|esto|esta app)$/,
  /^qu[eé] (puedes|sabes) hacer$/,
  /^c[oó]mo (funcionas|te uso|funciona (zenod|esto|esta app))$/,
];

/**
 * A question about Zenod itself ("who are you?", "what can you do?", "how do I add a memory?"):
 * the whole question, not a mention, so "what did I say about Zenod's pricing" still searches.
 */
export function isAboutZenod(question: string): boolean {
  const q = question
    .toLowerCase()
    .replace(/[¿¡?!.,;:"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(hey |hi |hello |hola |ok |so )?(zenod )?/, "")
    .trim();
  return ABOUT_ZENOD_QUESTIONS.some((pattern) => pattern.test(q));
}

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
  /** Sources the answer cites that are not among the top memories (only when the engine cannot score them). */
  alsoCited: MemoryChatSource[];
  /**
   * A recent-note question (E12-S3c): how many of the person's voice notes are tied to a topic page,
   * so a note shown "not yet linked to topics" is put in proportion. Absent for other questions.
   */
  noteLinks?: { voiceNotes: number; unlinked: number };
  ms: number;
  /**
   * How the answer was made and checked (E12-S1b): "quoted" when every citation's quote was found in
   * the memory it names, "ask" when the read-only ask loop answered (no streaming chat model).
   */
  checkedBy?: "quoted" | "ask";
  /** "zenod" when the question was about Zenod itself and `answer` is its own description (E15-S1). */
  about?: "zenod";
  /** EPIC-14 S29: what the question's vague words were read as, from the quick index; the app shows it as "Read as". */
  readAs?: ReadAs[];
}

export interface MemoryChatStreamHandlers {
  /** The top memories, as soon as ranked retrieval has them (before any model call). */
  onMemories?(memories: MemoryChatMemory[]): void;
  /** Answer prose as the model writes it; replaced by the final answer once checked. */
  onText?(delta: string): void;
  /**
   * The web app's chat (E15-S1): questions about Zenod get its own description, memories under the
   * relevance floor and sensitive ones on a weak match are not shown. WhatsApp, Telegram and calls leave it off.
   */
  appChat?: boolean;
  /**
   * EPIC-14 S29: read the question's vague words against the quick index first (Runtime.readAs). The
   * app chat, calls and MCP answers pass it; WhatsApp and Telegram never do (root L-6).
   */
  readAs?: (question: string) => Promise<ReadAs[]>;
}

const basePath = (path: string) => path.split("#")[0]!;

const titleOf = (path: string) => basePath(path).split("/").pop()!.replace(/\.md$/i, "");

const NON_ANSWER_TEXT = {
  retry: "Zenod could not put a checked answer together this time. The memories below match your question: open them, or ask again.",
  unverified: "No confident answer: Zenod found no note that answers this directly. The closest memories are below.",
  unchecked: "No confident answer: Zenod could not check its answer against your memories, so it is not shown. The closest memories are below.",
  none: "No memory matches this question yet.",
  // The app chat, when no memory clears the relevance floor (E15-S1).
  unverifiedNone: "No confident answer: Zenod found no note that answers this directly, and none matches it closely enough to show.",
  uncheckedNone: "No confident answer: Zenod could not check its answer against your memories, so it is not shown.",
  retryNone: "Zenod could not put a checked answer together this time. Ask again in a moment.",
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
  if (handlers.appChat === true && isAboutZenod(question)) {
    handlers.onMemories?.([]);
    return { question, answered: true, answer: ABOUT_ZENOD, memories: [], alsoCited: [], ms: Math.round(performance.now() - started), about: "zenod" };
  }
  const readings = handlers.readAs ? await handlers.readAs(question).catch(() => [] as ReadAs[]) : [];
  const answer = await answerWithReadings(engine, question, handlers, readings, started);
  const shown = shownReadings(readings);
  return shown.length ? { ...answer, readAs: shown } : answer;
}

/**
 * EPIC-14 S29: ranked retrieval with the quick index's readings. The question's own top matches
 * keep their places; after them the search with each place's name is mixed in, and each place's own
 * page is kept among the memories the answer reads, so "the flat" reaches the flat's page even when
 * the words never match it, and a question the words already answer is not pushed down.
 */
export async function rankWithReadings(engine: BrainEngine, question: string, readings: readonly ReadAs[], pool: number, reach: number): Promise<RankedMemories> {
  const query = readAsQuery(question, readings);
  const [plain, read] = await Promise.all([
    rankMemories(engine, question, pool),
    query === question ? null : rankMemories(engine, query, pool),
  ]);
  const keep = Math.min(READ_AS_KEEP, plain.results.length);
  const results: RankedMemory[] = plain.results.slice(0, keep);
  const has = (path: string) => results.some((memory) => memory.path === path);
  const rest = plain.results.slice(keep);
  const extra = read?.results ?? [];
  for (let i = 0; i < Math.max(rest.length, extra.length); i++) {
    for (const memory of [rest[i], extra[i]]) if (memory && !has(memory.path)) results.push(memory);
  }
  const missing = readings.filter((reading) => !results.slice(0, reach).some((memory) => memory.path === reading.path));
  if (missing.length) {
    const percents = engine.matchPercentsFor ? await engine.matchPercentsFor(query, missing.map((reading) => reading.path)).catch(() => ({} as Record<string, number>)) : {};
    const pinned = missing.map((reading): RankedMemory => {
      const found = results.find((memory) => memory.path === reading.path);
      return found ?? {
        rank: 0, path: reading.path, title: reading.title, snippet: "", matchPercent: percents[reading.path] ?? 1,
        url: "", provider: "github", appPath: memoryAppPath(reading.path), treePath: reading.lineage.join(" › "), kind: "page",
      };
    });
    const others = results.filter((memory) => !missing.some((reading) => reading.path === memory.path));
    // After the top three, so the best word matches still lead.
    others.splice(Math.min(3, others.length), 0, ...pinned);
    results.splice(0, results.length, ...others);
  }
  return { ...plain, query, results: results.slice(0, Math.max(pool, reach)).map((memory, i) => ({ ...memory, rank: i + 1 })) };
}

async function answerWithReadings(
  engine: BrainEngine,
  question: string,
  handlers: MemoryChatStreamHandlers,
  readings: readonly ReadAs[],
  started: number,
): Promise<MemoryChatAnswer> {
  const appChat = handlers.appChat === true;
  const note = readAsNote(readings);
  const ranked = readings.length ? await rankWithReadings(engine, question, readings, MEMORY_CHAT_POOL, MEMORY_CHAT_CONTEXT) : await rankMemories(engine, question, MEMORY_CHAT_POOL);
  // The top 5, plus any memory the answer cites that ranked lower, each with its own percentage (E12-S3c).
  const shownMemories = (cited: ReadonlySet<string>) =>
    ranked.results
      .map((memory) => ({ ...memory, cited: cited.has(memory.path) }))
      .filter((memory) => memory.rank <= MEMORY_CHAT_TOP || memory.cited)
      .filter((memory) => !appChat || shownInApp(memory));
  handlers.onMemories?.(shownMemories(new Set()));
  const noteLinks = await noteLinksFor(engine, ranked.results);
  if (!engine.answerFromMemories) return { ...(await askAnswer(engine, question, started, ranked.results, appChat)), ...noteLinks };
  if (ranked.results.length === 0) {
    return { question, answered: false, answer: NON_ANSWER_TEXT.none, memories: [], alsoCited: [], ms: Math.round(performance.now() - started), checkedBy: "quoted" };
  }
  const check = await engine.answerFromMemories(
    note ? `${question}\n${note}` : question,
    ranked.results.slice(0, MEMORY_CHAT_CONTEXT).map((memory) => ({ n: memory.rank, path: memory.path, title: memory.title, snippet: memory.snippet })),
    handlers.onText,
  );
  if (!check) return { ...(await askAnswer(engine, question, started, ranked.results, appChat)), ...noteLinks };
  const citedPaths = new Set(ranked.results.filter((memory) => check.cited.includes(memory.rank)).map((memory) => memory.path));
  const memories: MemoryChatMemory[] = shownMemories(check.checked ? citedPaths : new Set());
  // A cited note the engine added beside the ranked list (E12-S1b round 2) shows too, with its own percentage.
  const added = check.checked ? (check.context ?? []).filter((memory) => check.cited.includes(memory.n) && !ranked.results.some((r) => r.path === memory.path)) : [];
  if (added.length) {
    const percents = engine.matchPercentsFor ? await engine.matchPercentsFor(question, added.map((memory) => memory.path)).catch(() => ({} as Record<string, number>)) : {};
    for (const memory of added) {
      memories.push({
        rank: memory.n, path: memory.path, title: memory.title, snippet: "", matchPercent: percents[memory.path] ?? 1,
        url: memory.url, provider: memory.provider, appPath: memoryAppPath(memory.path), treePath: "",
        kind: memory.path.startsWith("Log/") ? "log" : "page", cited: true,
      });
    }
  }
  return {
    question,
    answered: check.checked,
    answer: check.checked ? check.text : nonAnswerText(check.reason === "no_answer" ? "unverified" : "unchecked", memories.length > 0),
    memories,
    alsoCited: [],
    ms: Math.round(performance.now() - started),
    checkedBy: "quoted",
    ...noteLinks,
  };
}

/** The voice-note link count, only when the list shows a note ranked by time (E12-S3c). */
async function noteLinksFor(engine: BrainEngine, ranked: readonly RankedMemory[]): Promise<{ noteLinks?: { voiceNotes: number; unlinked: number } }> {
  if (!engine.memoryNoteLinks || !ranked.some((memory) => memory.relation === "note")) return {};
  const links = await engine.memoryNoteLinks().catch(() => null);
  return links ? { noteLinks: { voiceNotes: links.voiceNotes, unlinked: links.unlinked } } : {};
}

export function answerFromMemory(engine: BrainEngine, question: string, options: Pick<MemoryChatStreamHandlers, "appChat" | "readAs"> = {}): Promise<MemoryChatAnswer> {
  return streamAnswerFromMemory(engine, question, options);
}

/** A non-answer's note; in the app chat, one that points at memories below only when some are shown (E15-S1). */
function nonAnswerText(kind: "retry" | "unverified" | "unchecked" | "none", anyShown: boolean): string {
  if (anyShown) return NON_ANSWER_TEXT[kind];
  if (kind === "unverified") return NON_ANSWER_TEXT.unverifiedNone;
  if (kind === "unchecked") return NON_ANSWER_TEXT.uncheckedNone;
  if (kind === "retry") return NON_ANSWER_TEXT.retryNone;
  return NON_ANSWER_TEXT.none;
}

/** S1's answer: the read-only ask loop next to the ranked memories (engines without a chat model). */
async function askAnswer(engine: BrainEngine, question: string, started: number, ranked: RankedMemory[], appChat = false): Promise<MemoryChatAnswer> {
  const answer = await askOnce(engine, question);
  return { ...(await fromAsk(engine, question, answer, ranked, started, appChat)), checkedBy: "ask" };
}

async function fromAsk(engine: BrainEngine, question: string, answer: Answer, ranked: RankedMemory[], started: number, appChat = false): Promise<MemoryChatAnswer> {
  const nonAnswer = askNonAnswer(answer.text);
  const cited = new Set(answer.sources.map((source) => basePath(source.path)));
  // The top 5, plus any memory the answer cites that ranked lower, each with its own percentage.
  const memories = ranked
    .map((memory) => ({ ...memory, cited: cited.has(basePath(memory.path)) }))
    .filter((memory) => memory.rank <= MEMORY_CHAT_TOP || memory.cited);
  const shown = new Set(memories.map((memory) => basePath(memory.path)));
  const alsoCited: MemoryChatSource[] = [];
  const unranked: SourceRef[] = [];
  for (const source of answer.sources as SourceRef[]) {
    const path = basePath(source.path);
    if (shown.has(path)) continue;
    shown.add(path);
    unranked.push(source);
  }
  // A cited memory the ranked list did not reach still shows its own percentage, in rank order (E12-S3c).
  const percents = unranked.length && engine.matchPercentsFor
    ? await engine.matchPercentsFor(question, unranked.map((source) => source.path)).catch(() => ({} as Record<string, number>))
    : {};
  for (const source of unranked) {
    const path = basePath(source.path);
    const percent = percents[source.path] ?? percents[path];
    if (percent === undefined) {
      alsoCited.push({ path, title: titleOf(path), url: source.url, appPath: memoryAppPath(path) });
      continue;
    }
    memories.push({
      rank: ranked.length + memories.length + 1, path: source.path, title: titleOf(path), snippet: "", matchPercent: percent,
      url: source.url, provider: source.provider, appPath: memoryAppPath(source.path), treePath: "",
      kind: path.startsWith("Log/") ? "log" : "page", cited: true,
    });
  }
  memories.sort((a, b) => b.matchPercent - a.matchPercent || a.rank - b.rank);
  const shownMemories = appChat ? memories.filter(shownInApp) : memories;
  return {
    question,
    answered: nonAnswer === null,
    answer: nonAnswer ? (appChat ? nonAnswerText(nonAnswer, shownMemories.length > 0 || alsoCited.length > 0) : NON_ANSWER_TEXT[nonAnswer]) : answer.text,
    memories: shownMemories,
    alsoCited,
    ms: Math.round(performance.now() - started),
  };
}

/**
 * The one Send button (EPIC-16 E16-B1): what a message is for. The engine's small model call decides,
 * guarded so a question is never kept; the plain rules decide when there is no model or it fails.
 * A cap hit is not a model failure: it stops the send with its own reason.
 */
export async function routeSendMessage(engine: BrainEngine, message: string): Promise<SendRoute> {
  if (!engine.routeSend) return ruleSendRoute(message);
  try {
    return await engine.routeSend(message);
  } catch (error) {
    if ((error as Error | null)?.name === "LlmAllowanceExceededError") throw error;
    console.warn(`[memory-send] route fell back to rules: ${error instanceof Error ? error.message : String(error)}`);
    return ruleSendRoute(message);
  }
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

// EPIC-14 E14-S1: a voice note recorded in the web app's chat goes into the same media seam a
// WhatsApp voice note uses (media_ingest: archive, transcribe, Log entry, filing).
/** The longest note the chat records (the app stops and sends at this length). */
export const VOICE_NOTE_MAX_SECONDS = 10 * 60;
/** Ten minutes of speech at the recorder's 32 kbit/s is about 2.4 MB; this leaves room for other formats. */
export const VOICE_NOTE_MAX_BYTES = 8 * 1024 * 1024;
const VOICE_NOTE_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

/** The recorder's format without codec parameters, or null when it is not a format the chat records. */
export function voiceNoteMediaType(contentType: string | undefined): string | null {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  return VOICE_NOTE_EXTENSIONS[type] ? type : null;
}

/** The media_ingest input for one recorded note: the audio itself rides as a data URL. */
export function voiceNoteIngestInput(audio: Buffer, mediaType: string, seconds: number | null, at: Date): TaskJobInput {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  return {
    mediaType: "audio",
    contentType: "voice_note",
    bytesRef: `data:${mediaType};base64,${audio.toString("base64")}`,
    filename: `zenod-app-voice-note-${stamp}.${VOICE_NOTE_EXTENSIONS[mediaType]}`,
    sourceHint: "Zenod app voice note",
    senderTimestamp: at.toISOString(),
    source: "web",
    ...(seconds !== null ? { audioDurationSeconds: seconds } : {}),
  };
}

/** One filing per recording: a retried upload of the same audio files it once. */
export function voiceNoteIdempotencyKey(tenantId: string, audio: Buffer): string {
  return `${tenantId}:web-voice:${createHash("sha256").update(audio).digest("hex").slice(0, 32)}`;
}

export function isVoiceNoteJobKey(tenantId: string, key: string | null): boolean {
  return Boolean(key?.startsWith(`${tenantId}:web-voice:`));
}
