/**
 * Questions about recent notes (EPIC-12 row S3c, round 2): "what was in my last voice note?",
 * "yesterday's vn", "what did I say about the boat today". Word matching cannot answer them:
 * "last" and "vn" are in no memory, so every page that happens to say "last" tied (Jordi,
 * 2026-11-08: five unrelated tree roots all at 22 %). They are answered by time instead: the
 * latest matching Log entries, then the pages each was filed into (memoryIndex.ts).
 */

export type RecentWindow = { kind: "latest" } | { kind: "day"; date: string };

export interface RecentIntent {
  window: RecentWindow;
  /** The question names a voice note (vn, audio, voice message), not just any note. */
  voice: boolean;
  /** What is left once the time and note words are gone: "the boat" in "what did I say about the boat today". */
  topic: string;
}

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Whole words only; `\b` is ASCII-only in JavaScript, so "última" would never match. */
const word = (re: RegExp) => new RegExp(`(?<![\\p{L}\\p{N}])${re.source}(?![\\p{L}\\p{N}])`, "u");

const VOICE_RE = word(/(?:voice ?notes?|voice ?messages?|voice ?memos?|vns?|audios?|recordings?|notas? de voz|mensajes? de voz)/);
const NOTE_RE = word(/(?:notes?|messages?|captures?|entries|entry|notas?|mensajes?)/);
const SAID_RE = word(/(?:say|said|told|tell you|sent|send|record(?:ed)?|dije|dicho|grabe|grabé|envie|envié|mande|mandé)/);
const YESTERDAY_RE = word(/(?:yesterday|ayer)/);
const TODAY_RE = word(/(?:today|tonight|this morning|this afternoon|this evening|earlier today|hoy|esta manana|esta mañana|esta tarde|esta noche)/);
const LATEST_RE = word(/(?:last|latest|most recent|newest|recent|just now|ultimo|última|ultima|último|ultimos|últimos|reciente|recientes)/);

/** Words that only say "recent note": removed before what is left is searched as the topic. */
const INTENT_WORDS = new Set([
  "last", "latest", "most", "recent", "newest", "just", "now", "yesterday", "yesterday s", "today", "tonight", "this", "morning",
  "afternoon", "evening", "earlier", "voice", "vn", "vns", "voicenote", "voicenotes", "memo", "memos", "message", "messages",
  "audio", "audios", "recording", "recordings", "note", "notes", "capture", "captures", "entry", "entries", "say", "said", "told",
  "tell", "sent", "send", "record", "recorded", "in", "what", "was", "were", "is", "my", "me", "i", "the", "a", "an", "s", "did", "do",
  "about", "on", "of", "from", "that", "you", "summarise", "summarize", "summary", "recap",
  "ultimo", "ultima", "último", "última", "ultimos", "últimos", "reciente", "recientes", "ayer", "hoy", "esta", "manana", "mañana",
  "tarde", "noche", "nota", "notas", "de", "voz", "mensaje", "mensajes", "dije", "dicho", "grabe", "grabé", "envie", "envié", "mande",
  "mandé", "que", "qué", "mi", "mis", "en", "el", "la", "sobre",
]);

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The recent-note intent of a question, or null when it asks about a subject, not a time. */
export function recentIntent(question: string, now: number = Date.now()): RecentIntent | null {
  const text = ` ${normalize(question)} `;
  const voice = VOICE_RE.test(text);
  const names = voice || NOTE_RE.test(text) || SAID_RE.test(text);
  const yesterday = YESTERDAY_RE.test(text);
  const today = TODAY_RE.test(text);
  // "last week", "last time", "last year" name a period or an occasion, not the latest note.
  const latest = LATEST_RE.test(text.replace(/ last (?:week|weekend|month|year|time|night|summer|winter|spring|autumn|fall)(?= )/g, " "));
  if (!names || !(yesterday || today || latest)) return null;
  // "my last vn" and "yesterday's vn" are about the note; "last time we spoke about notes" is not a note word next to a time word.
  const window: RecentWindow = yesterday ? { kind: "day", date: dayOf(now - 86_400_000) } : today ? { kind: "day", date: dayOf(now) } : { kind: "latest" };
  const topic = normalize(question).split(" ").filter((word) => word && !INTENT_WORDS.has(word)).join(" ");
  return { window, voice, topic };
}

/** A Log entry that is a voice note: recorded as one, or an older entry whose words say so. */
export function isVoiceCapture(contentType: string | null | undefined, title: string, content: string): boolean {
  const type = (contentType ?? "").toLowerCase();
  if (type) return type === "voice_note" || type.startsWith("audio");
  return /^voice note\b/i.test(title) || /^voice note\b/i.test(content.trimStart());
}
