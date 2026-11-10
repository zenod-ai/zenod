/**
 * EPIC-14 S36: the one shape of a helper's card, in Jordi's words (voice note 10 Nov 23:08Z): "I'm
 * introducing this new link. It's between these two concepts. That's why I think you should do it.
 * That's why you might not want to do it. Make your call." Every helper card says it the same way: a
 * small picture of the two ideas and what the change does between them, one line why yes, one line
 * why not, and the call is the person's. Later helpers (a clarifying question, something to try)
 * post the same shape, with or without a picture. Only the shape lives here; the web app draws it.
 */

/** What the change does between the two ideas in the picture; the memory desk can do each of these. */
export type HelperCardChange = "link" | "unlink" | "move" | "rename" | "own-place";

export const HELPER_CARD_CHANGES: readonly HelperCardChange[] = ["link", "unlink", "move", "rename", "own-place"];

export interface HelperCardPicture {
  change: HelperCardChange;
  /** The first idea: the page that is linked, moved or renamed, by what it is about. */
  from: string;
  /** The second idea: the page it links to, the place it moves under, or the new name. Null for own-place. */
  to: string | null;
}

export interface HelperCard {
  picture: HelperCardPicture | null;
  /** One line: why the helper thinks you should. */
  yes: string;
  /** One line: why you might not want to. */
  no: string;
}

/** The last words on every helper card. */
export const MAKE_YOUR_CALL = "Make your call.";

const IDEA_MAX = 90;
const LINE_MAX = 240;

const words = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max).trim() : "";

/** A card from untrusted input (a model's reply, a post): null unless it has both reasons. */
export function cleanHelperCard(raw: unknown): HelperCard | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const yes = words(data.yes, LINE_MAX);
  const no = words(data.no, LINE_MAX);
  if (!yes || !no) return null;
  return { picture: cleanPicture(data.picture), yes, no };
}

function cleanPicture(raw: unknown): HelperCardPicture | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const change = HELPER_CARD_CHANGES.find((kind) => kind === data.change);
  const from = words(data.from, IDEA_MAX);
  const to = words(data.to, IDEA_MAX);
  if (!change || !from) return null;
  if (change === "own-place") return { change, from, to: null };
  if (!to || to.toLowerCase() === from.toLowerCase()) return null;
  return { change, from, to };
}

/** The card's first line, said by the helper, from its picture: what it would do, in plain words. */
export function pictureTitle(picture: HelperCardPicture): string {
  const { from, to } = picture;
  switch (picture.change) {
    case "link": return `I'd link "${from}" with "${to}".`;
    case "unlink": return `I'd take the link off between "${from}" and "${to}".`;
    case "move": return `I'd move "${from}" under "${to}".`;
    case "rename": return `I'd rename "${from}" to "${to}".`;
    case "own-place": return `I'd give "${from}" its own place at the top of your memory.`;
  }
}

/**
 * Plain words for what a person reads: a model's "memory 24" or "memories 3 and 7" (its own numbering
 * of what it read) becomes how the person knows that memory, so a card never points at a number.
 * `phrases[n - 1]` says memory n in words, for example `your voice note of 3 Nov`.
 */
export function namedMemories(text: string, phrases: ReadonlyArray<string>): string {
  return text.replace(/\b([Mm])emor(?:y|ies) (\d+)(?: and (\d+))?\b/g, (match, m: string, a: string, b?: string) => {
    const first = phrases[Number(a) - 1];
    const second = b ? phrases[Number(b) - 1] : undefined;
    if (!first || (b && !second)) return match;
    const said = second ? `${first} and ${second}` : first;
    return m === "M" ? said.charAt(0).toUpperCase() + said.slice(1) : said;
  });
}

/** A whole card in plain words: `namedMemories` on every line the person reads. */
export function namedCard(card: HelperCard, phrases: ReadonlyArray<string>): HelperCard {
  const named = (text: string) => namedMemories(text, phrases);
  return {
    picture: card.picture ? { ...card.picture, from: named(card.picture.from), to: card.picture.to ? named(card.picture.to) : null } : null,
    yes: named(card.yes),
    no: named(card.no),
  };
}

/** What a helper's model is told about how its card reads. */
export const HELPER_CARD_WORDS = [
  "Write every line the person reads like a friend talking to them: short, plain, no jargon.",
  "Name a note or place by what it is about, in the person's own words; never by a number, a path, a code or 'under X'.",
].join(" ");

/** The JSON a helper's model fills in for its card, beside the change itself. */
export const HELPER_CARD_ASK =
  '"picture": {"change": "link" or "unlink" or "move" or "rename" or "own-place", "from": "the first idea, a short name of what the note or place is about", "to": "the second idea: the note it links to, the place it moves under or the new name; null for own-place"}, "yes": "one sentence: why you think they should", "no": "one honest sentence: why they might not want to"';
