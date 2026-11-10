import type { MemoryEntry } from "zenod";
import type { InboxStore } from "./inboxStore.js";

/**
 * EPIC-14 S27 round 2: the helpers work on the person's memory only, never on their projects.
 *
 * Jordi, 2026-11-10: "His job should be to work on the memory, and the memory is not the repos,
 * it's my memory." Many captures in a busy account are work-tracking records an agent saved over
 * MCP (rows, asks, run ids, repos), and the helpers read them as the person's own to-dos. Here:
 * which memories are such records (the helpers leave them out), which words are project work (a
 * helper's card or list line with them is dropped), and the one-time put-away of the cards the
 * helpers already posted about project work, as Not now with a reason, which Bring it back undoes.
 */

/** A work-tracking code: EPIC-14, E14-S27, ZAL-A13, E0-A1, run_0f4a8b75, a branch wt/…, PR #1573. */
const WORK_CODE = /\bEPIC-\d+|\b[A-Z]{1,4}\d{0,3}-[A-Z]{1,2}\d+\b|\brun_[0-9a-f]{6,}|\bwt\/[a-z0-9-]+|\bPR ?#\d+|\bagent_team\b/;

/** Project-management words a memory helper never uses about what to do next. */
const WORK_WORDS = /\b(?:tickets?|pull requests?|repos?|repositor(?:y|ies)|dispatch\w*|deploy\w*|backlog|sprints?|delivery manager|roadmap|stand-?up)\b/i;

/** "epic" as a word, lower case: "Epic Social" is a name, "the epic" is project work. */
const EPIC_WORD = /\bepics?\b/;

/** The words of a capture an agent saved: its title and the start of what it says. */
const head = (entry: Pick<MemoryEntry, "title" | "content">) => `${entry.title}\n${entry.content.slice(0, 600)}`;

/**
 * A work-tracking record an agent saved, not something the person said: typed in over MCP or the
 * CLI (never a voice note, a chat message or a file) and naming work codes. The helpers leave
 * these out, so a project's status never reads as the person's loose end.
 */
export function isTeamRecord(entry: Pick<MemoryEntry, "title" | "content" | "source" | "contentType">): boolean {
  if (entry.source !== "mcp" && entry.source !== "cli") return false;
  if (entry.contentType && entry.contentType !== "text") return false;
  return WORK_CODE.test(head(entry));
}

/** A work code in any of these words. Page names can hold any word, so a change's words are checked for codes only. */
export function hasWorkCode(...texts: Array<string | null | undefined>): boolean {
  return WORK_CODE.test(texts.filter(Boolean).join("\n"));
}

/** Words that are project work: a work code anywhere, or project-management words. */
export function isProjectWork(...texts: Array<string | null | undefined>): boolean {
  const words = texts.filter(Boolean).join("\n");
  return WORK_CODE.test(words) || WORK_WORDS.test(words) || EPIC_WORD.test(words);
}

/** The reason left on a card put away as project work, which its helper reads on its next run. */
export const OUT_OF_SCOPE_REASON = "out of scope: project work";

/** Cards posted before the helpers kept to the memory are the ones put away once. */
export const MEMORY_ONLY_SINCE = "2026-11-10T04:15:00.000Z";

/**
 * Put away, once, the open suggestions the helpers posted about project work before they kept to
 * the memory: Not now with the reason above, so the inbox shows only memory suggestions. A card
 * already put away and brought back (it keeps that reason) is left alone. Returns how many.
 */
export function putAwayProjectSuggestions(inbox: Pick<InboxStore, "list" | "declineSuggestion">, helpers: readonly string[], since = MEMORY_ONLY_SINCE): number {
  let count = 0;
  for (const item of inbox.list(500)) {
    if (item.kind !== "suggestion" || item.status !== "open" || item.example || !helpers.includes(item.from)) continue;
    if (item.createdAt >= since) continue;
    if (item.replies.some((reply) => reply.kind === "notnow" && reply.text === OUT_OF_SCOPE_REASON)) continue;
    if (!isProjectWork(item.title, item.body, item.action)) continue;
    inbox.declineSuggestion(item.id, OUT_OF_SCOPE_REASON);
    count += 1;
  }
  return count;
}
