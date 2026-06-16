import { describe, expect, it } from "vitest";
import { resolveAgent, ZENOD_AGENT, ARCHUS_AGENT } from "../src/agent.js";

describe("resolveAgent", () => {
  it("defaults to Zenod when unset or unknown", () => {
    expect(resolveAgent(undefined)).toBe(ZENOD_AGENT);
    expect(resolveAgent(null)).toBe(ZENOD_AGENT);
    expect(resolveAgent("nope")).toBe(ZENOD_AGENT);
  });

  it("selects a known agent by id, case-insensitively", () => {
    expect(resolveAgent("archus")).toBe(ARCHUS_AGENT);
    expect(resolveAgent("  ARCHUS  ")).toBe(ARCHUS_AGENT);
    expect(resolveAgent("zenod")).toBe(ZENOD_AGENT);
  });
});
