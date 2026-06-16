import { describe, expect, it } from "vitest";
import { resolveAgent, ZENOD_AGENT, ARCHUS_AGENT, OUTBOUND_AGENT } from "../src/agent.js";

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
    expect(resolveAgent("outbound")).toBe(OUTBOUND_AGENT);
    expect(resolveAgent("  OUTBOUND  ")).toBe(OUTBOUND_AGENT);
  });
});

describe("OUTBOUND_AGENT (outbound comms)", () => {
  it("is the vaultless, repo-less guardian of sending", () => {
    expect(OUTBOUND_AGENT.name).toBe("outbound");
    expect(OUTBOUND_AGENT.vaultless).toBe(true);
    expect(OUTBOUND_AGENT.outbound).toBe(true);
    // It owns no GitHub home — it sends, it does not curate or execute tickets.
    expect(OUTBOUND_AGENT.backlog).toBeUndefined();
  });

  it("its persona encodes the confirm-before-send guardrail and no-spam rule", () => {
    const persona = OUTBOUND_AGENT.persona.toLowerCase();
    // The overriding rule: never publish/send without explicit confirmation.
    expect(persona).toContain("confirm");
    expect(persona).toContain("never publish or send");
    // Match the user's voice and refuse spam/mass sends.
    expect(persona).toContain("voice");
    expect(persona).toContain("spam");
    // Its three channels.
    expect(persona).toContain("x (twitter)");
    expect(persona).toContain("reddit");
    expect(persona).toContain("email");
  });
});
