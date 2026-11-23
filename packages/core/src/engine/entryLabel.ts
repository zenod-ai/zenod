import { isVoiceCapture } from "../vault/recentIntent.js";

/**
 * EPIC-21 V9: where a voice note was spoken, in a plain label, and a real title for it.
 * Read only from what an entry stores (the `Source app:` line the media seam writes into its
 * body, and its content type), so old notes are labelled too and no note text is ever rewritten.
 */

/** Notes spoken straight to Zenod: WhatsApp, the web app, a call. */
export const SPOKEN_TO_ZENOD = "Spoken to Zenod";

export type EntryOrigin = "app" | "zenod";

interface LabelInput {
  content: string;
  contentType?: string | null;
  title?: string;
  /** Set when the app is known from a capture receipt before the vault entry holds the `Source app:` line. */
  sourceApp?: string;
}

const HEADER_LINE = /^Source app:[ \t]*(.+)$/m;

/** The app named by the entry's `Source app:` line, read from its header lines only (before the first blank line). */
export function sourceAppOf(content: string): string | null {
  const header = content.split(/\r?\n\r?\n/, 1)[0] ?? "";
  const match = HEADER_LINE.exec(header);
  const app = match?.[1]?.trim();
  return app ? app : null;
}

/** `EpicTeam Chat` → `From EpicTeam Chat`; `EpicTeam card answer` → `From an EpicTeam card answer`. */
export function fromAppLabel(sourceApp: string): string {
  const app = sourceApp.trim();
  return /\bcard answer$/i.test(app) ? `From an ${app}` : `From ${app}`;
}

/** The label an entry shows: from its app, spoken to Zenod, or null for anything that is not a voice note. */
export function originLabel(entry: LabelInput): string | null {
  const app = entry.sourceApp?.trim() || sourceAppOf(entry.content);
  if (app) return fromAppLabel(app);
  return isVoiceCapture(entry.contentType, entry.title ?? "", entry.content) ? SPOKEN_TO_ZENOD : null;
}

export function originOf(label: string | null): EntryOrigin | null {
  if (!label) return null;
  return label === SPOKEN_TO_ZENOD ? "zenod" : "app";
}

const INGEST_TITLE = /^(?:Voice note|Audio) "/;
const TITLE_WORDS = 8;
const TITLE_CHARS = 60;

/** The person's words of an ingested note: what follows the ingest header block. */
function transcriptOf(content: string): string {
  const blank = content.search(/\r?\n\r?\n/);
  return blank < 0 ? "" : content.slice(blank).trim();
}

/**
 * A readable title for an ingested voice note: its first words, not the raw file name
 * (`Voice note "epicteam-chat-voice-note-….webm" ingeste…`). Other entries keep their title.
 */
export function readableTitle(entry: LabelInput & { title: string; capturedAt?: string }): string {
  if (!INGEST_TITLE.test(entry.title) && !INGEST_TITLE.test(entry.content.trimStart())) return entry.title;
  return wordsTitle(transcriptOf(entry.content))
    || (entry.capturedAt ? `Voice note, ${entry.capturedAt.slice(0, 10)}` : "Voice note");
}

/** The first words of a transcript as a title ("" when there are none). */
export function wordsTitle(text: string): string {
  const words = text.split(/\s+/).filter(Boolean).slice(0, TITLE_WORDS).join(" ");
  return words.length > TITLE_CHARS ? `${words.slice(0, TITLE_CHARS - 1).trimEnd()}…` : words;
}

/** The label filters of search: an exact label (any case), or `origin` app / zenod. */
export function matchesOriginFilter(entry: LabelInput, filter: { label?: string; origin?: EntryOrigin }): boolean {
  if (!filter.label && !filter.origin) return true;
  const label = originLabel(entry);
  if (filter.origin && originOf(label) !== filter.origin) return false;
  if (filter.label && label?.toLowerCase() !== filter.label.trim().toLowerCase()) return false;
  return true;
}
