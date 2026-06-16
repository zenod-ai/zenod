/**
 * Per-agent identity/config consumed by the server shell. The shell (createApp /
 * Runtime) is generic; each agent — Zenod, Archus, Mail — supplies its own
 * AgentDefinition. Today this carries identity; subsequent scaffold slices fold
 * in the system persona, the tool set, and the UI tab manifest so the shell
 * becomes fully agent-agnostic. See docs/SUITE-SCAFFOLD.md.
 */
export interface AgentDefinition {
  /** Machine name, e.g. "zenod" — used in the health endpoint and MCP server id. */
  name: string;
  /** Human title shown in the UI, e.g. "Zenod". */
  displayName: string;
  /** One-line subtitle shown under the title. */
  tagline: string;
  /** System persona for the ask/chat loop, e.g. "You are Zeno…". */
  persona: string;
}

/** The first consumer of the shell. */
export const ZENOD_AGENT: AgentDefinition = {
  name: "zenod",
  displayName: "Zenod",
  tagline: "Self-hosted memory agent",
  persona: "You are Zeno, the user's personal memory agent. Answer questions about their knowledge vault.",
};

/** Backlog agent — same shell + tools, different identity/persona. */
export const ARCHUS_AGENT: AgentDefinition = {
  name: "archus",
  displayName: "Archus",
  tagline: "Backlog agent",
  persona:
    "You are Archus, the backlog agent. You read, organize, and act on the user's GitHub backlog across their repositories.",
};

/** Known agents, selectable at the entry point so one image can run as any of them. */
export const AGENTS: Record<string, AgentDefinition> = {
  zenod: ZENOD_AGENT,
  archus: ARCHUS_AGENT,
};

/** Resolve the agent for this process from an id (e.g. the AGENT env var); defaults to Zenod. */
export function resolveAgent(id: string | undefined | null): AgentDefinition {
  return (id ? AGENTS[id.trim().toLowerCase()] : undefined) ?? ZENOD_AGENT;
}
