// CI-visible regression for the production memory batch scorer. The 2026-09-18
// create-page defects produced receipts with no page and every topic at the
// canned 0.69 clarification; a decision-only score called those "correct".
import assert from "node:assert/strict";
import test from "node:test";
import { scoreCase } from "./memory-eval/production-score.mjs";

const newPageCase = {
  id: "P11",
  category: "new-page-multi-topic",
  expectPage: "Notes/EVAL-TEST New Page Filing Invariant.md",
  expectOutcome: { page: "Notes/EVAL-TEST New Page Filing Invariant.md", minFiledTopics: 3 },
};
const cannedBreakdown = Array.from({ length: 5 }, () => ({
  disposition: "needs_clarification", confidence: 0.69, status: "uncertain",
  reason: "Branch discovery is incomplete or the destination is uncertain; confirm it before creating a page.",
  pages: [], filedPages: [],
}));

test("a canned clarification with no written page fails the outcome assertion", () => {
  const score = scoreCase(newPageCase, { pagesTouched: ["Inbox/filing-2026-09-18-e-deadbe.md"], filing: "uncertain", topics: cannedBreakdown });
  assert.equal(score.correct, false);
  assert.equal(score.outcomeChecks.pageWritten, false);
  assert.equal(score.outcomeChecks.filedEnough, false);
  assert.equal(score.outcomeChecks.noCannedClarification, false);
  assert.equal(score.canned.length, 5);
});

test("a written page with filed topics passes", () => {
  const topics = Array.from({ length: 5 }, () => ({
    disposition: "integrate_page", confidence: 0.99, status: "filed",
    pages: ["Notes/EVAL-TEST New Page Filing Invariant.md"], filedPages: ["Notes/EVAL-TEST New Page Filing Invariant.md"],
  }));
  const score = scoreCase(newPageCase, { pagesTouched: ["Notes/EVAL-TEST New Page Filing Invariant.md", "Inbox/filing-2026-09-18-e-deadbe.md"], filing: "filed", topics });
  assert.equal(score.correct, true);
  assert.equal(score.outcomeChecks.pageWritten, true);
  assert.equal(score.outcomeChecks.filedEnough, true);
  assert.equal(score.filedTopics, 5);
});

test("a page routed to an existing page instead of the new one fails the outcome assertion", () => {
  const topics = [{ disposition: "append_compact_note", confidence: 0.95, status: "filed", pages: ["Projects/Zenod.md"], filedPages: ["Projects/Zenod.md"] }];
  const score = scoreCase(newPageCase, { pagesTouched: ["Projects/Zenod.md"], filing: "filed", topics });
  assert.equal(score.correct, false);
  assert.equal(score.outcomeChecks.pageWritten, false);
});

test("decision-only cases keep their existing page and disposition scoring", () => {
  const entry = { id: "P01", expectPage: "Areas/Alpha9 Tax and AEAT.md", expectDisposition: "append_compact_note" };
  const topics = [{ disposition: "append_compact_note", confidence: 0.98, status: "filed", pages: ["Areas/Alpha9 Tax and AEAT.md"], filedPages: ["Areas/Alpha9 Tax and AEAT.md"] }];
  assert.equal(scoreCase(entry, { topics }).correct, true);
  assert.equal(scoreCase(entry, { topics: [{ ...topics[0], pages: ["Notes/Other.md"], filedPages: ["Notes/Other.md"] }] }).correct, false);
  assert.equal(scoreCase(entry, { topics: [{ ...topics[0], disposition: "evidence_only" }] }).correct, false);
});
