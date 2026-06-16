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
}

/** The first consumer of the shell. */
export const ZENOD_AGENT: AgentDefinition = {
  name: "zenod",
  displayName: "Zenod",
  tagline: "Self-hosted memory agent",
};
