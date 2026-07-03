import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * I5-1 — kill the third reply shape.
 *
 * E-1 permits exactly two action-initiating reply shapes: a receipt-rendered success
 * (renderOutboundReceipt / renderForeignRepoDispatchMessage's "Opened" branch) and a
 * receipt-rendered block/failure (renderApproveAffordance / renderNothingPendingToApprove
 * / a FAILED line / the dispatch-only "Dispatched ..." line). A third shape — optimistic
 * post-action narration composed ahead of any receipt, e.g. "Posting the tweet now" or
 * "Ticket opened + run dispatched" — must never exist as a literal string ANYWHERE in
 * source: those lines were never baked into code, they were LLM improvisation, and this
 * guard makes sure nobody "fixes" a UX complaint by hardcoding one back in.
 */

const SRC_DIR = join(__dirname, "..", "src");

// Diagnosed optimistic-narration strings (obsidian-brain iteration-5 audit) that must
// never be emitted by ANY composer — they claim an action is happening/done ahead of a
// verified receipt.
const BANNED_OPTIMISTIC_STRINGS = ["Posting the tweet now", "Ticket opened + run dispatched", "Ticket opened"];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("receipt discipline — the optimistic strings cannot be emitted outside the renderer (I5-1)", () => {
  it("never hardcodes a diagnosed optimistic-narration string anywhere in server source", () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(SRC_DIR)) {
      const text = readFileSync(file, "utf8");
      for (const banned of BANNED_OPTIMISTIC_STRINGS) {
        if (text.includes(banned)) offenders.push(`${file}: "${banned}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the dispatch composer never claims 'Opened'/'created' outside its receipt-gated branch", async () => {
    // Direct source-text check (not just a behavioral test) that the ONLY "Opened "
    // template literal in the foreign-repo journey composer is inside
    // renderForeignRepoDispatchMessage, gated on a verified issue-URL receipt.
    const text = readFileSync(join(SRC_DIR, "createIssueRunJourney.ts"), "utf8");
    const openedOccurrences = text.match(/`Opened /g) ?? [];
    expect(openedOccurrences.length).toBe(1);
    // It must sit behind the ISSUE_URL_RE receipt check, not a free-standing template.
    const fnBody = text.slice(text.indexOf("export function renderForeignRepoDispatchMessage"));
    expect(fnBody.indexOf("ISSUE_URL_RE.test")).toBeLessThan(fnBody.indexOf("`Opened "));
  });
});
