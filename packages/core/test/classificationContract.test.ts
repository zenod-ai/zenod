import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Classification } from "../src/llm/types.js";
import { checkTopicDestinations, ClassificationDestinationError } from "../src/engine/classificationContract.js";
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
