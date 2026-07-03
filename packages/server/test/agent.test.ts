import { describe, expect, it } from "vitest";
import { resolveAgent, ZENOD_AGENT, ARCHUS_AGENT, EPAMINON_AGENT, OUTBOUND_AGENT, PHYLAX_AGENT } from "../src/agent.js";

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
    expect(resolveAgent("epaminon")).toBe(EPAMINON_AGENT);
    expect(resolveAgent("  EPAMINON  ")).toBe(EPAMINON_AGENT);
    expect(resolveAgent("outbound")).toBe(OUTBOUND_AGENT);
    expect(resolveAgent("  OUTBOUND  ")).toBe(OUTBOUND_AGENT);
    expect(resolveAgent("phylax")).toBe(PHYLAX_AGENT);
    expect(resolveAgent("  PHYLAX  ")).toBe(PHYLAX_AGENT);
  });
});

describe("EPAMINON_AGENT (executor)", () => {
  it("is the vaultless, GitHub-backed executor — not a backlog curator", () => {
    expect(EPAMINON_AGENT.name).toBe("epaminon");
    expect(EPAMINON_AGENT.vaultless).toBe(true);
    expect(EPAMINON_AGENT.executor).toBe(true);
    // It must NOT be a backlog agent — it executes tickets, Archus curates them.
    expect(EPAMINON_AGENT.backlog).toBeUndefined();
  });

  it("its persona encodes the execution guardrails (honest state, qualified ids, run-only-approved)", () => {
    const persona = EPAMINON_AGENT.persona.toLowerCase();
    expect(persona).toContain("owner/repo#n");
    expect(persona).toContain("queue");
    // Honesty rule: never claim queued/running unless confirmed.
    expect(persona).toContain("never say a ticket is queued");
    // Stays out of Archus's lane.
    expect(persona).toContain("archus");
  });
});

describe("ARCHUS_AGENT (backlog guardian)", () => {
  it("its persona keeps execution tickets in the configured central backlog", () => {
    const persona = ARCHUS_AGENT.persona.toLowerCase();
    expect(persona).toContain("configured central execution backlog");
    expect(persona).toContain("leave queue_execution.repo null");
    expect(persona).toContain("never invent a repo like owner/backlog");
  });
});

describe("PHYLAX_AGENT (notification gatekeeper)", () => {
  it("is the vaultless, repo-less guardian of inbound attention", () => {
    expect(PHYLAX_AGENT.name).toBe("phylax");
    expect(PHYLAX_AGENT.vaultless).toBe(true);
    expect(PHYLAX_AGENT.notifier).toBe(true);
    expect(PHYLAX_AGENT.backlog).toBeUndefined();
  });

  it("its persona treats inbound requests as events, not final messages", () => {
    const persona = PHYLAX_AGENT.persona.toLowerCase();
    expect(persona).toContain("attention");
    expect(persona).toContain("event/fact");
    expect(persona).toContain("quiet hours");
    expect(persona).toContain("deliver_to_principal");
    expect(persona).toContain("read_notification_ledger");
    expect(persona).toContain("searched scope");
    expect(persona).toContain("never answer audit questions from policy guesses");
  });
});

describe("OUTBOUND_AGENT (marketing/outbound comms)", () => {
  it("is the vaultless, repo-less guardian of sending", () => {
    expect(OUTBOUND_AGENT.name).toBe("outbound");
    expect(OUTBOUND_AGENT.displayName).toBe("Callistheness");
    expect(OUTBOUND_AGENT.tagline).toBe("Marketing agent");
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

  // I5-1: a bare "approve"/"yes" of a standing draft must route through approve_send
  // (a real write verb), never stand in for narration composed by the model itself.
  it("its persona makes a bare approve/yes a valid write verb, never model narration (I5-1)", () => {
    const persona = OUTBOUND_AGENT.persona.toLowerCase();
    expect(persona).toContain("bare 'approve'");
    expect(persona).toContain("always call approve_send");
    expect(persona).toContain("nothing pending to approve");
  });
});
