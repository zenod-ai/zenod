import { describe, expect, it } from "vitest";
import { filingInputFingerprint, filingReceiptPath, freezeFilingClassification, parseFilingReceipt, renderFilingReceipt, sealFilingReceipt, unfinishedFilingTopics, verifyPreparedFilingChanges, type FilingReceipt, type FrozenTopic } from "../src/engine/filingReceipt.js";
import { publicationContentHash as hash } from "../src/vault/publicationGuard.js";
import type { EnrichEvidenceInput } from "../src/types.js";
const input: EnrichEvidenceInput = { evidenceRef: "Log/2026-09-13.md#^e-fixture", source: "selftest", content: "  Two ideas.\r\n", sourceId: "fixture" };
function fixture(): FilingReceipt {
  const topic: FrozenTopic = { ideaId: "idea-1", topic: "first", evidenceQuotes: ["Two ideas."], confidence: 0.9, disposition: "integrate_page", summary: "first", pages: [{ path: "Notes/A.md", action: "update", title: "A" }, { path: "Notes/B.md", action: "update", title: "B" }] };
  return sealFilingReceipt({ version: 1, evidenceRef: input.evidenceRef, inputFingerprint: filingInputFingerprint(input), baseRevision: { provider: "github", id: "base", committedAt: "2026-09-13T00:00:00Z", urls: [] }, phase: "prepared",
    classification: { confidence: 0.9, summary: "two ideas", tags: [], pages: [], topics: [topic, { ...topic, ideaId: "idea-2", topic: "second" }] },
    outcomes: [{ ideaId: "idea-1", topic: "first", evidenceRef: input.evidenceRef, sourceSpans: [{ start: 2, end: 12, passageId: "same-passage" }], confidence: 0.9, disposition: "integrate_page", pages: ["Notes/A.md", "Notes/B.md"], filedPages: ["Notes/A.md"], status: "pending", appliedOperationIds: ["op-first-a"] }],
    files: { "Notes/A.md": { beforeHash: hash("old\r\n"), after: "approved exact bytes\r\n", afterHash: hash("approved exact bytes\r\n") } } });
}
describe("durable filing plan", () => {
  it("binds plan to exact source/context and detects tampering without conflating prepared with durable", () => {
    const receipt = fixture(); const text = renderFilingReceipt(receipt);
    expect(parseFilingReceipt(text, input)).toEqual(receipt);
    expect(parseFilingReceipt(text, { ...input, content: input.content.trim() })).toBeNull();
    expect(parseFilingReceipt(text, { ...input, hints: ["different routing"] })).toBeNull();
    expect(parseFilingReceipt(text.replace("approved exact bytes", "unapproved paraphrase"), input)).toBeNull();
    expect(text).toContain('"phase": "prepared"');
    expect(filingReceiptPath(input.evidenceRef)).toBe("Inbox/filing-2026-09-13-e-fixture.md");
    expect(() => filingReceiptPath("Log/../secret#^e-x")).toThrow();
  });
  it.each([".github/workflows/run.yml", "package.json", "Notes/run.sh", "Log/2026-09-13.md", "Notes/../config.md"])("rejects a resealed edited plan targeting %s", path => {
    const original = fixture(); const { filingRevision: _old, ...payload } = original;
    const edited = sealFilingReceipt({ ...payload, files: { [path]: { beforeHash: null, after: "untrusted instructions", afterHash: hash("untrusted instructions") } } });
    expect(parseFilingReceipt(renderFilingReceipt(edited), input)).toBeNull();
  });

  it("only recognizes exact known edits and preserves CRLF; unrelated edits cannot be recovered", () => {
    const receipt = fixture(); const path = filingReceiptPath(input.evidenceRef);
    const changes = [{ path, before: null, after: renderFilingReceipt(receipt) }, { path: "Notes/A.md", before: "old\r\n", after: "approved exact bytes\r\n" }];
    expect(verifyPreparedFilingChanges(receipt, changes, path)).toBe(true);
    expect(verifyPreparedFilingChanges(receipt, [...changes, { path: "Notes/Other.md", before: null, after: "unrelated" }], path)).toBe(false);
    expect(verifyPreparedFilingChanges(receipt, [{ ...changes[1]!, after: "approved exact bytes\n" }], path)).toBe(false);
    expect(verifyPreparedFilingChanges(receipt, [{ ...changes[1]!, before: "different base" }], path)).toBe(false);
  });
  it("resumes only unfinished destinations while retaining distinct ideas in the same passage", () => {
    const receipt = fixture(); const pending = unfinishedFilingTopics(receipt);
    expect(pending.map(topic => topic.ideaId)).toEqual(["idea-1", "idea-2"]);
    expect(pending[0]!.pages.map(page => page.path)).toEqual(["Notes/B.md"]);
    expect(pending[1]!.pages).toHaveLength(2);
    receipt.outcomes[0]!.status = "filed";
    expect(unfinishedFilingTopics(receipt).map(topic => topic.ideaId)).toEqual(["idea-2"]);
    receipt.outcomes[0]!.status = "uncertain";
    expect(unfinishedFilingTopics(receipt).map(topic => topic.ideaId)).toEqual(["idea-2"]);
  });
  it("does not duplicate runtime passage tables into the persistent plan", () => {
    const receipt = fixture(); receipt.classification.topics[0]!.sourcePassages = [{ id: "p-fixture", start: 0, end: 1, text: "x" }];
    const frozen = freezeFilingClassification(receipt.classification);
    expect(frozen.topics[0]!.sourcePassages).toBeUndefined();
    expect(receipt.classification.topics[0]!.sourcePassages).toHaveLength(1);
  });
});
