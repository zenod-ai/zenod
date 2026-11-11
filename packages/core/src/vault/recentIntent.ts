/**
 * Questions about recent notes (EPIC-12 row S3c, round 2): "what was in my last voice note?",
 * "yesterday's vn", "what did I say about the boat today". Word matching cannot answer them:
 * "last" and "vn" are in no memory, so every page that happens to say "last" tied (Jordi,
 * 2026-11-08: five unrelated tree roots all at 22 %). They are answered by time instead: the
 * latest matching Log entries, then the pages each was filed into (memoryIndex.ts).
 */

/**
 * `range`: every note from `from` to `to` (both days, inclusive): "last week", "the past 3 days",
 * "this month" (E12-S1b round 2: "what are the top five topics I talked about in the last week?").
 */
export type RecentWindow = { kind: "latest" } | { kind: "day"; date: string } | { kind: "range"; from: string; to: string };

export interface RecentIntent {
  window: RecentWindow;
  /** The question names a voice note (vn, audio, voice message), not just any note. */
  voice: boolean;
  /** What is left once the time and note words are gone: "the boat" in "what did I say about the boat today". */
  topic: string;
  /**
   * The question asks for one note ("yesterday's vn"), not everything sent then ("what did I send on
   * November 6?", E12-S35): a day asked as a whole lists its notes, not the newest one and its pages.
   */
  one: boolean;
}

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Whole words only; `\b` is ASCII-only in JavaScript, so "última" would never match. */
const word = (re: RegExp) => new RegExp(`(?<![\\p{L}\\p{N}])${re.source}(?![\\p{L}\\p{N}])`, "u");

const VOICE_RE = word(/(?:voice ?notes?|voice ?messages?|voice ?memos?|vns?|audios?|recordings?|notas? de voz|mensajes? de voz)/);
const NOTE_RE = word(/(?:notes?|messages?|captures?|entries|entry|notas?|mensajes?)/);
const SAID_RE = word(/(?:say|said|told|tell you|sent|send|record(?:ed)?|talk(?:ed)?|talking|discuss(?:ed)?|mention(?:ed)?|spoke|speak|topics?|themes?|dije|dicho|grabe|grabé|envie|envié|mande|mandé|hable|hablé|hablado)/);
const ONE_NOTE_RE = word(/(?:voice ?note|voice ?message|voice ?memo|vn|audio|recording|note|message|capture|entry|nota de voz|nota|mensaje de voz|mensaje|grabacion|grabación)/);
const DAY_BEFORE_RE = word(/(?:(?:the )?day before yesterday|anteayer|antier|antes de ayer)/);
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
  // E12-S1b round 2: periods, dates and "top topics" words say when and how much, not what about.
  "talk", "talked", "talking", "discuss", "discussed", "mention", "mentioned", "spoke", "speak", "topic", "topics", "theme", "themes",
  "top", "main", "biggest", "most", "are", "have", "has", "been", "week", "weeks", "month", "months", "day", "days", "past",
  "previous", "these", "few", "couple", "one", "two", "three", "four", "five", "six", "seven", "ten", "fourteen", "thirty",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "st", "nd", "rd", "th",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "semana", "semanas", "mes", "meses", "dias", "días",
  "hable", "hablé", "hablado", "temas", "tema", "principales", "pasada", "pasado", "ultimas", "últimas", "estos", "los", "las",
  // E12-S35: "the day before yesterday", "3 days ago", "hace 3 días", "el día 6", "1ro de noviembre".
  "before", "ago", "hace", "anteayer", "antier", "antes", "dia", "día",
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
  "lunes", "martes", "miercoles", "miércoles", "jueves", "viernes", "sabado", "sábado", "domingo", "mandaste", "envié", "grabé",
]);

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14, thirty: 30, dos: 2, tres: 3, cinco: 5, siete: 7, diez: 10 };
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAYS_ES = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
/** "6th", "1st", Spanish "1ro" and "1º" (NFKC reads it "1o"), "1er". */
const ORDINAL = "st|nd|rd|th|ro|o|er";
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)";

function monthIndex(name: string): number {
  const key = name.slice(0, 3);
  const en = MONTHS.indexOf(key);
  return en >= 0 ? en : MONTHS_ES.indexOf(key);
}

/**
 * A named day: "November 6", "6 de noviembre", "1ro de noviembre", "2026-11-06", "3 days ago", "hace 3 días",
 * "on the 6th", "el día 6", "on Friday", "el viernes" (the latest such day before today).
 */
function namedDay(text: string, now: number): string | null {
  const iso = /(?<![\p{N}])(\d{4}) (\d{2}) (\d{2})(?![\p{N}])/u.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const year = new Date(now).getUTCFullYear();
  const at = (month: number, day: number) => {
    if (month < 0 || day < 1 || day > 31) return null;
    // A date later than today means last year's.
    const ms = Date.UTC(year, month, day);
    return dayOf(ms > now ? Date.UTC(year - 1, month, day) : ms);
  };
  const monthFirst = new RegExp(`(?<![\\p{L}])${MONTH_RE} (\\d{1,2})(?:${ORDINAL})?(?![\\p{N}])`, "u").exec(text);
  if (monthFirst) return at(monthIndex(monthFirst[1]!), Number(monthFirst[2]));
  const dayFirst = new RegExp(`(?<![\\p{N}])(\\d{1,2})(?:${ORDINAL})? (?:of |de )?${MONTH_RE}(?![\\p{L}])`, "u").exec(text);
  if (dayFirst) return at(monthIndex(dayFirst[2]!), Number(dayFirst[1]));
  // "3 days ago", "hace 3 días".
  const ago = new RegExp(`(?:(\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")}) days? ago|hace (\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")}) d[ií]as)(?![\\p{L}])`, "u").exec(text);
  if (ago) {
    const n = ago[1] ?? ago[2]!;
    return dayOf(now - (/^\d+$/.test(n) ? Number(n) : NUMBER_WORDS[n]!) * DAY_MS);
  }
  // A day of this month without its name: "on the 6th", "el día 6" (last month's when later than today).
  const bare = new RegExp(`(?:on the (\\d{1,2})(?:${ORDINAL})|(?:el )?d[ií]a (\\d{1,2}))(?![\\p{N}\\p{L}])`, "u").exec(text);
  if (bare) {
    const day = Number(bare[1] ?? bare[2]);
    const today = new Date(now);
    const month = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), day) > now ? today.getUTCMonth() - 1 : today.getUTCMonth();
    if (day >= 1 && day <= 31) return dayOf(Date.UTC(today.getUTCFullYear(), month, day));
  }
  const weekday = new RegExp(`(?<![\\p{L}])(?:on |last |el |este )?(${[...WEEKDAYS, ...WEEKDAYS_ES].join("|")})(?![\\p{L}])`, "u").exec(text.normalize("NFD").replace(/\p{M}+/gu, ""));
  if (weekday) {
    const target = Math.max(WEEKDAYS.indexOf(weekday[1]!), WEEKDAYS_ES.indexOf(weekday[1]!));
    const today = new Date(now).getUTCDay();
    const back = (today - target + 7) % 7 || 7;
    return dayOf(now - back * DAY_MS);
  }
  return null;
}

/** A period: "last week", "this week", "the past 3 days", "last month", "esta semana". */
function namedRange(text: string, now: number): { from: string; to: string } | null {
  const span = /(?:last|past|previous|these|ultimos|últimos|ultimas|últimas) (\d{1,2}|two|three|four|five|six|seven|ten|fourteen|thirty|dos|tres|cinco|siete|diez) (days?|weeks?|months?|dias|días|semanas?|mes(?:es)?)/u.exec(text);
  if (span) {
    const n = /^\d+$/.test(span[1]!) ? Number(span[1]) : NUMBER_WORDS[span[1]!] ?? 1;
    const unit = /^(?:day|dia|día)/u.test(span[2]!) ? 1 : /^(?:week|semana)/u.test(span[2]!) ? 7 : 30;
    return { from: dayOf(now - (n * unit - 1) * DAY_MS), to: dayOf(now) };
  }
  if (/(?:last|past|previous|this) (?:week|7 days)|(?:esta|la ultima|la última|la pasada) semana|semana pasada/u.test(text)) return { from: dayOf(now - 6 * DAY_MS), to: dayOf(now) };
  if (/(?:last|past|previous|this) month|(?:este|el ultimo|el último) mes|mes pasado/u.test(text)) return { from: dayOf(now - 29 * DAY_MS), to: dayOf(now) };
  if (/(?:last|past) (?:few|couple of) days|(?:estos|los ultimos|los últimos) (?:dias|días)/u.test(text)) return { from: dayOf(now - 2 * DAY_MS), to: dayOf(now) };
  return null;
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * E12-S38: how far a time zone's clock is ahead of UTC at `ms` (Mexico City: minus 6 hours). An
 * unknown, empty or invalid zone is UTC, the day every question was read in before.
 */
export function zoneOffsetMs(ms: number, timeZone?: string | null): number {
  if (!timeZone || timeZone === "UTC") return 0;
  try {
    let format = zoneFormats.get(timeZone);
    if (!format) {
      format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
      zoneFormats.set(timeZone, format);
    }
    const part = Object.fromEntries(format.formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]));
    return Date.UTC(part.year!, part.month! - 1, part.day!, part.hour!, part.minute!, part.second!) - Math.floor(ms / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** An IANA time zone the runtime knows ("America/Mexico_City"), in its own spelling, or null. */
export function validTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 64) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** The UTC moment a day (YYYY-MM-DD) starts in a time zone: 6:00 UTC for a Mexico City day. */
export function zoneDayStartMs(date: string, timeZone?: string | null): number {
  const midnight = Date.parse(`${date}T00:00:00Z`);
  return midnight - zoneOffsetMs(midnight - zoneOffsetMs(midnight, timeZone), timeZone);
}

/** The day (YYYY-MM-DD) it is at `ms` in a time zone. */
export function zoneDayOf(ms: number, timeZone?: string | null): string {
  return dayOf(ms + zoneOffsetMs(ms, timeZone));
}

/**
 * The recent-note intent of a question, or null when it asks about a subject, not a time. Its days
 * are the person's own (E12-S38): "yesterday" at 19:00 in Mexico City is the day before that
 * evening's date there, though UTC is already the next day. Without a zone, the days are UTC's.
 */
export function recentIntent(question: string, at: number = Date.now(), timeZone?: string | null): RecentIntent | null {
  // Every day below is read on the person's wall clock: the UTC getters of a shifted moment.
  const now = at + zoneOffsetMs(at, timeZone);
  const text = ` ${normalize(question)} `;
  const voice = VOICE_RE.test(text);
  const names = voice || NOTE_RE.test(text) || SAID_RE.test(text);
  const dayBefore = DAY_BEFORE_RE.test(text);
  const yesterday = !dayBefore && YESTERDAY_RE.test(text);
  const today = TODAY_RE.test(text);
  const range = namedRange(text, now);
  const day = range ? null : namedDay(text, now);
  // "last week", "last time", "last year" name a period or an occasion, not the latest note.
  const latest = LATEST_RE.test(text.replace(/ (?:last|past|previous|these|ultimos|últimos|ultimas|últimas) (?:\d{1,2} |two |three |four |five |six |seven |ten |fourteen |thirty |few |couple of )?(?:weeks?|weekend|months?|years?|time|night|days?|summer|winter|spring|autumn|fall|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?= )/g, " "));
  if (!names || !(dayBefore || yesterday || today || latest || range || day)) return null;
  // "my last vn" and "yesterday's vn" are about the note; "last time we spoke about notes" is not a note word next to a time word.
  const window: RecentWindow = dayBefore ? { kind: "day", date: dayOf(now - 2 * DAY_MS) }
    : yesterday ? { kind: "day", date: dayOf(now - DAY_MS) }
    : today ? { kind: "day", date: dayOf(now) }
    : range ? { kind: "range", ...range }
    : day ? { kind: "day", date: day }
    : { kind: "latest" };
  const topic = normalize(question).split(" ").filter((word) => word && !INTENT_WORDS.has(word) && !new RegExp(`^\\d+(?:${ORDINAL})?$`).test(word)).join(" ");
  return { window, voice, topic, one: ONE_NOTE_RE.test(text) };
}

/** A Log entry that is a voice note: recorded as one, or an older entry whose words say so. */
export function isVoiceCapture(contentType: string | null | undefined, title: string, content: string): boolean {
  const type = (contentType ?? "").toLowerCase();
  if (type) return type === "voice_note" || type.startsWith("audio");
  return /^voice note\b/i.test(title) || /^voice note\b/i.test(content.trimStart());
}
