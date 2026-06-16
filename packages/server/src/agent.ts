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
  /**
   * When true, this agent runs WITHOUT a vault — the engine boots with no repo,
   * no vault briefing, and no vault tools (just the chat loop + connections +
   * gateways). This is the "Console shell" of the suite split: the base minus
   * the vault capability. See docs/SUITE-SCAFFOLD.md (the spike, #154).
   */
  vaultless?: boolean;
  /**
   * When true, this agent is a BACKLOG agent (Archus): vaultless, but it DOES get
   * the GitHub tasking tools (create/edit/label/query issues, etc.) pointed at a
   * central backlog repo. No markdown vault — its home is a GitHub repo.
   */
  backlog?: boolean;
}

/** The first consumer of the shell. */
export const ZENOD_AGENT: AgentDefinition = {
  name: "zenod",
  displayName: "Zenod",
  tagline: "Self-hosted memory agent",
  persona: "You are Zeno, the user's personal memory agent. Answer questions about their knowledge vault.",
};

/** Backlog agent — vaultless, owns the GitHub issue backlog across the user's repos. */
export const ARCHUS_AGENT: AgentDefinition = {
  name: "archus",
  displayName: "Archus",
  tagline: "Backlog agent",
  persona:
    "You are Archus, the backlog agent. You own the user's GitHub issue backlog across their repositories — you create, edit, label, comment on, close, query, and triage issues, with qualified IDs (owner/repo#N). Issues live in their home repo (one-ticket-per-home, no central duplicate); when a ticket has no specific code repo, file it in the central backlog repo. You present a single aggregated view across repos. Be direct and concise.",
  vaultless: true,
  backlog: true,
};

/**
 * The Console shell — the suite's shared front-end (UI + chat + connections +
 * gateways) running WITHOUT a vault. It is the base minus the vault capability;
 * the spike (#154) stands it up on z2 to prove the engine separates from the
 * vault cleanly. In uni mode you chat with it directly; later it routes to
 * enabled agents.
 */
export const CONSOLE_AGENT: AgentDefinition = {
  name: "console",
  displayName: "Console",
  tagline: "The suite shell — chat, connections, gateways",
  persona:
    "You are the Zenod Console, the shared front-end of a personal agent suite. You have no vault of your own yet; you chat with the user and will route to enabled agents. Be direct and concise.",
  vaultless: true,
};

/** Known agents, selectable at the entry point so one image can run as any of them. */
export const AGENTS: Record<string, AgentDefinition> = {
  zenod: ZENOD_AGENT,
  archus: ARCHUS_AGENT,
  console: CONSOLE_AGENT,
};

/** Resolve the agent for this process from an id (e.g. the AGENT env var); defaults to Zenod. */
export function resolveAgent(id: string | undefined | null): AgentDefinition {
  return (id ? AGENTS[id.trim().toLowerCase()] : undefined) ?? ZENOD_AGENT;
}
