import type { InboxItem, InboxLink } from "./inboxStore.js";

/**
 * EPIC-14 S50 (Jordi's E14-A12 yes, 18 Nov: "all five together post at most one card a day and never
 * repeat one"). Two rules for the helpers' inbox cards:
 *
 * 1. One calm card a day. The helpers under the five memory personas (Remind me: Open loops, Weekly
 *    recap, People and follow-ups; Your ideas: Ideas digest; New possibilities: Something to try;
 *    Reflect: Patterns and ideas; Make it easier: Easier ways) put at most one card a day (UTC) in a
 *    user's inbox, all together. A scheduled helper that wakes after today's card has landed does
 *    not read or spend: it waits, its period stays open and it wakes again in the next night's window.
 *    Who goes first: the persona whose last card is oldest (never posted: first), so a nightly helper
 *    cannot crowd out a weekly one. Reflect keeps its own once-in-3-days gap on top. Run now (the user
 *    pressing it) is not held back, and its card counts as the day's card. The Keep my memory tidy
 *    helpers (Clarifier, Topic gardener, Memory health) are outside the five and do not count: they
 *    ask about the memory itself, have their own limits, and are off for testers.
 *
 * 2. Never the same suggestion twice. Every card a helper posts leaves a few small keys in the user's
 *    persona store (bounded, PERSONA_SHOWN_MAX): its change in words, the pair of memories it links,
 *    its title. A later card with any key already shown is left out, by every helper, the tidy ones
 *    included (Topic gardener repeated a link on 10 and 11 Nov, Open loops on 16 and 17 Nov). A card
 *    put away with Not now never comes back; Bring it back on that same card is the only way back.
 */
export const CALM_HELPER_IDS: ReadonlySet<string> = new Set([
  "open-loops",
  "weekly-recap",
  "people-follow-ups",
  "ideas-digest",
  "something-to-try",
  "patterns-and-ideas",
  "make-it-easier",
]);

export const isCalmHelper = (personaId: string) => CALM_HELPER_IDS.has(personaId);

/** Midnight UTC of the day holding `at`, as ISO: the start of the calm-card day. */
export const calmDayStart = (at: Date) => `${at.toISOString().slice(0, 10)}T00:00:00.000Z`;

/** The run-log key a waiting run takes, so a helper waits once a day and wakes again tomorrow. */
export const calmWaitKey = (at: Date) => `waits:${at.toISOString().slice(0, 10)}`;

const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The keys of one card. A pair of memories needs two or more cited memories (the helper's own notes
 * under `Personas/` never count): one memory can hold several loose ends, so one alone is no repeat.
 */
export function suggestionKeys(card: { title: string; action?: string | null; links?: readonly InboxLink[] | null }): string[] {
  const keys: string[] = [];
  const title = words(card.title);
  if (title) keys.push(`title:${title}`);
  const action = card.action ? words(card.action) : "";
  if (action) keys.push(`action:${action}`);
  const paths = [...new Set((card.links ?? []).map((link) => link.path).filter((path) => path && !path.startsWith("Personas/")))].sort();
  if (paths.length >= 2) keys.push(`links:${paths.join("|")}`);
  return keys;
}

/** The keys of the cards a helper posted that are still in the inbox (cards from before S50 count too). */
export function inboxShownKeys(items: readonly InboxItem[]): Set<string> {
  const keys = new Set<string>();
  for (const item of items) {
    if (item.example || item.kind === "job" || !isHelperCard(item)) continue;
    for (const key of suggestionKeys(item)) keys.add(key);
  }
  return keys;
}

const isHelperCard = (item: InboxItem) => Boolean(item.sourceKey && (item.sourceKey.startsWith("persona:") || item.sourceKey.startsWith("desk-ask:persona:")));
