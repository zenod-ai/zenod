import { describe, expect, it } from "vitest";
import { classificationSchema } from "../src/llm/aisdk.js";

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
