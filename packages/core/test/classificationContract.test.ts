import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Classification } from "../src/llm/types.js";
import { checkTopicDestinations, ClassificationDestinationError, checkTopicSourceAddresses, ClassificationSourceAddressError, checkAssignedPassageCoverage, ClassificationSourceCoverageError } from "../src/engine/classificationContract.js";
const recorded = JSON.parse(readFileSync(new URL("./fixtures/classification-empty-topic-pages.json", import.meta.url), "utf8")) as Classification;

describe("topic-owned destination contract", () => {
  it("rejects the actual five empty routed topics despite two legacy aggregate pages", () => {
    expect(recorded.pages).toHaveLength(2);
    expect(() => checkTopicDestinations(recorded)).toThrow(ClassificationDestinationError);
    const pending = checkTopicDestinations(recorded, true);
    expect(pending.topics!.filter(topic => topic.classificationFailed)).toHaveLength(5);
    expect(pending.topics!.every(topic => topic.pages.length === 0)).toBe(true);
    expect(pending.topics![5]).toEqual(recorded.topics![5]);
    expect(recorded.topics![0]!.disposition).toBe("append_compact_note");
  });
  it("keeps independently valid siblings and legacy/no-meaning/unknown decisions", () => {
    const valid = { ...recorded.topics![0]!, pages: [recorded.pages[0]!] };
    const mixed = { ...recorded, topics: [valid, recorded.topics![1]!, { ...recorded.topics![2]!, disposition: "evidence_only" as const }] };
    const pending = checkTopicDestinations(mixed, true);
    expect(pending.topics![0]).toBe(valid);
    expect(pending.topics![1]!.classificationFailed).toBe(true);
    expect(pending.topics![2]).toBe(mixed.topics[2]);
    const legacy = { ...recorded, topics: undefined };
    expect(checkTopicDestinations(legacy)).toBe(legacy);
  });
});


describe("classifier source address retry contract", () => {
  const content = "First idea.\nSecond idea.\nThird idea.";
  const host = { sourceRange: { start: 0, end: content.length }, sourcePassages: [
    { id: "one", start: 0, end: 12, text: content.slice(0, 12) },
    { id: "two", start: 12, end: 25, text: content.slice(12, 25) },
    { id: "three", start: 25, end: content.length, text: content.slice(25) },
  ] };
  const result = (quote = "First idea.", passageId = "one"): Classification => ({ ...recorded, topics: [
    { ...recorded.topics![0]!, evidenceAssignments: [{ quote, passageId, occurrence: 0 }] },
    { ...recorded.topics![0]!, evidenceAssignments: [{ quote: "Third idea.", passageId: "three", occurrence: 0 }] },
  ] });
  it.each(["two", "missing"])("rejects wrong address %s and keeps the valid sibling pending only the invalid topic", passageId => {
    const original = result("First idea.", passageId);
    expect(() => checkTopicSourceAddresses(original, content, host)).toThrow(ClassificationSourceAddressError);
    const final = checkTopicSourceAddresses(original, content, host, true);
    expect(final.topics![0]!.classificationFailed).toBe(true);
    expect(final.topics![1]).toBe(original.topics![1]);
    expect(original.topics![0]!.classificationFailed).toBeUndefined();
  });
  it("accepts exact and unique whitespace-only contiguous quotes without mutation", () => {
    for (const quote of ["First idea.", "First idea. Second idea."]) {
      const original = result(quote);
      expect(checkTopicSourceAddresses(original, content, host)).toBe(original);
      expect(original.topics![0]!.evidenceAssignments![0]!.quote).toBe(quote);
    }
  });
  it("uses host ownership, rejects paraphrases and never falls back to a model-provided passage table", () => {
    const original = result("First idea.", "wrong");
    original.topics![0]!.sourcePassages = [{ id: "wrong", start: 0, end: content.length, text: content }];
    expect(() => checkTopicSourceAddresses(original, content, host)).toThrow(ClassificationSourceAddressError);
    expect(() => checkTopicSourceAddresses(result("First thought."), content, host)).toThrow(ClassificationSourceAddressError);
  });
  it("keeps valid neighbor-only topics for the existing ownership filter and preserves legacy validation", () => {
    const original = result();
    expect(checkTopicSourceAddresses(original, content, { ...host, sourceRange: { start: 25, end: content.length } })).toBe(original);
    const legacy = { ...recorded, topics: [{ ...recorded.topics![0]!, evidenceQuotes: ["not present"] }] };
    expect(checkTopicSourceAddresses(legacy, content, host)).toBe(legacy);
  });
});


describe("assigned passage coverage retry contract", () => {
  const content = "Neighbor idea. Owned idea.";
  const host = { sourceRange: { start: 15, end: content.length }, sourcePassages: [
    { id: "neighbor", start: 0, end: 15, text: content.slice(0, 15) },
    { id: "owned", start: 15, end: content.length, text: content.slice(15) },
  ] };
  const topic = { ...recorded.topics![0]!, evidenceQuotes: [], evidenceAssignments: [
    { passageId: "neighbor", quote: "Neighbor idea.", occurrence: 0 },
  ] };
  const classification: Classification = { ...recorded, topics: [topic], passageReviews: [
    { passageId: "neighbor", status: "assigned" }, { passageId: "owned", status: "assigned" },
  ] };
  it("rejects the measured neighbor-only false owned-coverage claim without changing exhausted output", () => {
    expect(() => checkAssignedPassageCoverage(classification, content, host)).toThrow(ClassificationSourceCoverageError);
    expect(checkAssignedPassageCoverage(classification, content, host, true)).toBe(classification);
    expect(classification.topics![0]).toBe(topic);
  });
  it.each([[], undefined])("rejects assigned coverage with empty/missing topics (%s)", topics => {
    const empty = { ...classification, topics: topics ?? [{ ...topic, evidenceAssignments: [], evidenceQuotes: [] }] };
    expect(() => checkAssignedPassageCoverage(empty, content, host)).toThrow(ClassificationSourceCoverageError);
  });
  it("accepts real owned support and retains valid neighbor topics without requiring them to own the window", () => {
    const valid = { ...classification, topics: [topic, { ...topic, evidenceAssignments: [
      { passageId: "owned", quote: "Owned idea.", occurrence: 0 },
    ] }] };
    expect(checkAssignedPassageCoverage(valid, content, host)).toBe(valid);
  });
  it("does not retry a neighbor-only topic without a false owned assigned claim or a legacy response", () => {
    const honest = { ...classification, passageReviews: [{ passageId: "owned", status: "evidence_only" as const }] };
    expect(checkAssignedPassageCoverage(honest, content, host)).toBe(honest);
    const { passageReviews, ...legacy } = classification;
    expect(checkAssignedPassageCoverage(legacy, content, host)).toBe(legacy);
  });
});
