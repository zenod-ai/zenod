import { describe, expect, it } from "vitest";
import { questionFactViews, rawAnswerQuotations } from "../src/engine/answerFactScope.js";
import { groundedRawEntries } from "../src/engine/answerGrounding.js";
import type { FactView } from "../src/engine/temporalFacts.js";
const ref = "Log/2026-09-13.md#^e-123abc";
function view(): FactView {
  const fact = (key: string, statement: string, status: "active" | "superseded" | "conflict" = "active") => ({ key, statement, status, id: statement, evidenceRef: ref, evidenceDate: null, origin: "user_report" as const, supersedes: [], unresolvedCorrection: false, effectiveDate: null, effectiveDateQuote: null, correctionQuote: null, supersedesQuotes: [], verificationQuote: null });
  return { path: "Notes/Orchid.md", mode: "current", asOf: "2026-09-13", scope: "selected-note-facts", complete: true, legacy: false, warnings: [], facts: [fact("color", "Orchid color is red.", "superseded"), fact("color", "Orchid color is blue."), fact("capacity", "Orchid capacity is five seats.")] };
}
const quote = (source: string, chosen = source, views: FactView[] = []) => rawAnswerQuotations({ question: "What is the repair claim?", text: `"${chosen}" (${ref})`, views, evidence: [{ ref, text: source }] });
describe("question-scoped temporal answer presentation", () => {
  it("keeps all selected-key versions and conflicts, but not other page predicates", () => {
    const v = view(); v.facts[1]!.status = "conflict";
    const selected = questionFactViews("What is Orchid color currently?", [v]);
    expect(selected[0]!.facts.map(fact => fact.status)).toEqual(["superseded", "conflict"]);
    expect(selected[0]!.facts.some(fact => fact.key === "capacity")).toBe(false);
  });
  it("uses exact verified answer quotations across question/source languages without a synonym table", () => {
    const v = view(); v.facts = [{ ...v.facts[0]!, key: "service", statement: "Orchid no reparará baterías.", status: "active" }];
    expect(questionFactViews("Which work is excluded?", [v], 'Battery restriction: "Orchid no reparará baterías."')[0]!.facts).toEqual(v.facts);
  });
  it("keeps corrected legacy history by evidence association despite different wording", () => {
    const v = view(); v.priorStatements = [{ path: v.path, statement: "The original shade was vermilion.", statementId: "old", contentHash: "hash", provider: "github", revision: "old-revision", supersededByEvidenceRef: ref }];
    expect(questionFactViews("What is Orchid color?", [v])[0]!.priorStatements).toEqual(v.priorStatements);
  });
  it("retains explicit historical scope, legacy and partial warnings", () => {
    const v = { ...view(), key: "color", mode: "historical" as const, complete: false, warnings: ["partial"] };
    expect(questionFactViews("What did it look like?", [v])).toEqual([v]);
    expect(questionFactViews("Is it fixed?", [{ ...v, legacy: true }])[0]!.legacy).toBe(true);
  });
  it.each([
    ["It is false that we repair batteries.", "we repair batteries."],
    ["Rejected claim:\nWe repair batteries.", "We repair batteries."],
    ["It is only a hypothesis that\nWe repair batteries.", "We repair batteries."],
    ["We repair batteries only in a hypothetical example.", "We repair batteries"],
  ])("does not strip surrounding qualification from %s", (source, chosen) => {
    expect(quote(source, chosen)).toBe("");
  });
  it("preserves exact qualified wording and refuses invented or superseded quote claims", () => {
    const qualified = "We might repair batteries; this is only an unverified hypothesis.";
    expect(quote(qualified)).toContain(qualified);
    expect(quote(qualified, "We repair batteries.")).toBe("");
    expect(rawAnswerQuotations({ question: "What color?", text: '"Orchid color is red."', views: [view()], evidence: [{ ref, text: "Orchid color is red." }] })).toBe("");
  });
  it("uses only decoded raw bodies, not title metadata or an unread gap", () => {
    const input = { question: "", text: "", readSpans: [{ path: "Log/2026-09-13.md", text: "## Invented heading ^e-123abc\n- source: test\n> We might repair batteries.\n[unread gap]\n> Later statement." }] };
    const entries = groundedRawEntries(input);
    expect(entries).toEqual([{ ref, text: "We might repair batteries.\n[unread gap]\nLater statement." }]);
    expect(quote(entries[0]!.text, "We might repair batteries.\nLater statement.")).toBe("");
  });
});
