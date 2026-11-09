import type { BrainEngine, Reply, SourceRef } from "zenod";
import { routeSendMessage, streamAnswerFromMemory, type MemoryChatAnswer } from "./memoryChat.js";
import type { TaskJob } from "./taskJobStore.js";

/**
 * WhatsApp gets the cloud chat's brain (EPIC-20 A1; Jordi's own words, 2026-11-08, root L-6 met).
 * A typed WhatsApp message goes through the same decision as the app's one Send button: keep it,
 * answer it from memory, or both. Answers come from the same checked answer path as the app, cut
 * short for a chat with at most two sources. A job on the memory itself (split, move, re-file...) is
 * never run from WhatsApp: it waits in the inbox as "Run it?" and the reply says so. Types only from
 * "zenod": this file is bundled where the core runtime is not.
 */

/**
 * Measured on Jordi's real questions (EPIC-20 A1): cutting the checked answer at 700 characters
 * turned 4 of 10 correct answers into partial ones, so the whole checked answer goes (the longest
 * seen was 1,371 characters); only an unusually long one is cut, at a sentence.
 */
export const CHANNEL_ANSWER_MAX_CHARS = 1_600;
export const CHANNEL_MAX_SOURCES = 2;
/** How long the reply waits for a kept message's Log entry before it says "saving". */
export const CHANNEL_KEEP_WAIT_MS = 20_000;

export interface ChannelBrainDeps {
  /** Queue the kept words as a store job (durable, idempotent per message). */
  keep(content: string): TaskJob;
  /** The store job's latest state, to say "Saved" only once its Log entry is there. */
  job(id: string): TaskJob | null;
  /**
   * Post "Run it?" in the inbox for a job on the memory. `captureId` names the message (the chat job,
   * or the store job when the words were also kept), so the desk's own look at a kept chat capture
   * finds the same item instead of posting a second one.
   */
  offerJob(captureId: string, request: string): void;
  /** The app's public origin, for the inbox and memory links. */
  appUrl: string;
  wait?(ms: number): Promise<void>;
  keepWaitMs?: number;
}

export type ChannelOutcome = "keep" | "answer" | "both" | "job" | "unsure" | "hello";

export interface ChannelReply extends Reply {
  /** What the brain decided, for the audit and the proof (EPIC-20 E20-3). */
  outcome: ChannelOutcome;
}

const SMALL_TALK = /^(?:hi|hello|hey|hola|buenas|thanks|thank you|thx|ty|gracias|ok|okay|vale|cool|great|nice|perfect|perfecto|genial|bye|adi[oó]s|good (?:morning|night|evening|afternoon)|buenos d[ií]as|buenas noches|👍|🙏|❤️)(?![\p{L}\p{N}])[\s!.?]*$/iu;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A source's name in a chat: a captured entry's raw title ("Voice note \"AC9D….ogg\" ingested…") becomes
 * "Your voice note, 8 Nov"; a page keeps its title.
 */
export function channelSourceTitle(path: string, title: string): string {
  const day = /^Log\/\d{4}-(\d{2})-(\d{2})\.md/.exec(path);
  if (!day) return title;
  const when = `${Number(day[2])} ${MONTHS[Number(day[1]) - 1]}`;
  const kind = /^voice note/i.test(title) || /voice-note/i.test(title) ? "voice note"
    : /^audio/i.test(title) ? "audio"
      : /^screenshot|^image/i.test(title) ? "screenshot"
        : /^(pdf|document)/i.test(title) ? "document"
          : "note";
  return `Your ${kind}, ${when}`;
}

/** A memory's page in the app. */
function memoryLink(appUrl: string, path: string): string {
  return `${appUrl}/#memory?path=${encodeURIComponent(path)}`;
}

/**
 * The checked answer, short enough for WhatsApp: the citation numbers become the first two sources'
 * numbers (others are dropped from the text), cut at a sentence near the limit, then the sources.
 */
export function formatChannelAnswer(answer: MemoryChatAnswer, appUrl: string): { text: string; sources: SourceRef[] } {
  const cited = answer.memories.filter((memory) => memory.cited);
  if (!answer.answered) {
    const near = answer.memories.slice(0, CHANNEL_MAX_SOURCES);
    const text = near.length
      ? `I found no note that answers this directly. Closest:\n${near.map((memory) => `· ${memory.title}`).join("\n")}`
      : "Nothing in your memory matches this yet.";
    return { text, sources: [] };
  }
  // Number the sources in the order the answer first cites them.
  const order: number[] = [];
  for (const match of answer.answer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    if (!order.includes(n)) order.push(n);
  }
  const byRank = new Map(cited.map((memory) => [memory.rank, memory]));
  const kept = order.filter((n) => byRank.has(n)).slice(0, CHANNEL_MAX_SOURCES);
  const renumber = new Map(kept.map((n, i) => [n, i + 1]));
  let text = answer.answer
    .replace(/\s*\[(\d+)\]/g, (_, n: string) => (renumber.has(Number(n)) ? ` [${renumber.get(Number(n))}]` : ""))
    .replace(/(\[\d\])(?:\s*\1)+/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > CHANNEL_ANSWER_MAX_CHARS) {
    const cut = text.slice(0, CHANNEL_ANSWER_MAX_CHARS);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"), cut.lastIndexOf("\n"));
    text = (end > CHANNEL_ANSWER_MAX_CHARS / 2 ? cut.slice(0, end + 1) : clip(text, CHANNEL_ANSWER_MAX_CHARS)).trimEnd();
  }
  const sources = kept.map((n) => byRank.get(n)!);
  const lines = sources.map((memory, i) => `[${i + 1}] ${channelSourceTitle(memory.path, memory.title)} ${memoryLink(appUrl, memory.path)}`);
  return {
    text: lines.length ? `${text}\n\n${lines.join("\n")}` : text,
    sources: sources.map((memory) => ({ path: memory.path, url: memory.url, provider: memory.provider } as SourceRef)),
  };
}

async function keepAndConfirm(deps: ChannelBrainDeps, content: string): Promise<{ jobId: string; reply: string }> {
  const job = deps.keep(content);
  const reply = await savedReply(deps, job);
  return { jobId: job.id, reply };
}

async function savedReply(deps: ChannelBrainDeps, job: TaskJob): Promise<string> {
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.()));
  const deadline = Date.now() + (deps.keepWaitMs ?? CHANNEL_KEEP_WAIT_MS);
  for (;;) {
    const now = deps.job(job.id) ?? job;
    if (now.status === "done") return "Saved ✓";
    if (now.status === "error" || now.status === "interrupted") return "⚠️ I could not save that just now. Send it again in a minute.";
    if (Date.now() >= deadline) return "Saving it now ✓";
    await wait(500);
  }
}

/** One typed WhatsApp message, decided and answered like the cloud chat's one Send. */
export async function channelTurn(engine: BrainEngine, message: string, chatJobId: string, deps: ChannelBrainDeps): Promise<ChannelReply> {
  const text = message.trim();
  if (!text || SMALL_TALK.test(text)) {
    return { outcome: "hello", sources: [], text: "Hi! Send me anything to remember, or ask me something about your memory." };
  }
  const route = await routeSendMessage(engine, text);
  const inbox = `${deps.appUrl}/#inbox`;
  // A job on the memory is never run from a chat (EPIC-14 S3): it waits in the inbox for a yes.
  if (route.action === "job" && route.job) {
    deps.offerJob(chatJobId, route.job);
    return { outcome: "job", sources: [], text: `That is a job on your memory, so I did not run it from WhatsApp. It is in your inbox as "Run it?": ${inbox}` };
  }
  if (route.action === "unsure" && route.job) {
    // Kept as a note as always; the inbox asks whether it was meant as a job.
    const saved = await keepAndConfirm(deps, route.job);
    deps.offerJob(saved.jobId, route.job);
    return { outcome: "unsure", sources: [], text: `${saved.reply} If you meant it as a job on your memory, it is in your inbox as "Run it?": ${inbox}` };
  }
  const parts: string[] = [];
  const sources: SourceRef[] = [];
  if (route.keep) parts.push((await keepAndConfirm(deps, route.keep)).reply);
  if (route.question) {
    const answer = formatChannelAnswer(await streamAnswerFromMemory(engine, route.question), deps.appUrl);
    parts.push(answer.text);
    sources.push(...answer.sources);
  }
  return { outcome: route.action === "both" ? "both" : route.keep ? "keep" : "answer", sources, text: parts.join("\n\n") };
}
