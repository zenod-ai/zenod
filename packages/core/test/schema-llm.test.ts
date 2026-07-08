import { describe, expect, it } from "vitest";
import { classificationSchema, repairStructuredJson } from "../src/llm/aisdk.js";

/**
 * OpenAI's strict structured outputs require the JSON `required` array to list
 * every property key — an `.optional()` field there is a 400. So no field in a
 * schema we hand to generateObject may be optional; "absent" must be modeled as
 * `.nullable()`. This guards against a regression that only surfaces at runtime
 * against the OpenAI provider.
 */
describe("classificationSchema (OpenAI-strict compatibility)", () => {
  it("has no optional fields — optionality is expressed as nullable", () => {
    const shape = classificationSchema.shape;
    const optionalKeys = Object.entries(shape)
      .filter(([, field]) => field.isOptional())
      .map(([key]) => key);
    expect(optionalKeys).toEqual([]);
  });

  it("still allows question to be null", () => {
    const parsed = classificationSchema.parse({
      confidence: 0.9,
      summary: "x",
      tags: [],
      pages: [{ path: "Areas/X.md", action: "update", title: "X" }],
      question: null,
    });
    expect(parsed.question).toBeNull();
  });
});

/**
 * Z-8: deepseek/deepseek-chat (the OpenRouter classify default) returns valid JSON
 * wrapped in ```json fences or with prose — generateObject's strict parser then
 * rejects it and the store rolls back. repairStructuredJson is the fence-stripping
 * hook that recovers it. This locks the recovery against the exact shapes observed
 * live (raw traces from the Z-8 reproduction).
 */
describe("repairStructuredJson (Z-8 fence recovery)", () => {
  const obj = {
    confidence: 0.8,
    summary: "s",
    tags: ["work"],
    pages: [{ path: "Areas/X.md", action: "update", title: "X" }],
    question: null,
  };

  it("strips a ```json fence and yields parseable JSON matching the schema", () => {
    const fenced = "```json\n" + JSON.stringify(obj, null, 2) + "\n```";
    const repaired = repairStructuredJson(fenced);
    expect(() => classificationSchema.parse(JSON.parse(repaired))).not.toThrow();
  });

  it("strips a bare ``` fence", () => {
    const fenced = "```\n" + JSON.stringify(obj) + "\n```";
    expect(JSON.parse(repairStructuredJson(fenced))).toMatchObject({ summary: "s" });
  });

  it("extracts the object when the model adds prose around it", () => {
    const prosed = `Here is the classification you requested:\n\n${JSON.stringify(obj)}\n\nLet me know if you need more.`;
    expect(JSON.parse(repairStructuredJson(prosed))).toMatchObject({ confidence: 0.8 });
  });

  it("leaves already-clean JSON untouched (parses)", () => {
    const clean = JSON.stringify(obj);
    expect(JSON.parse(repairStructuredJson(clean))).toMatchObject({ tags: ["work"] });
  });
});
