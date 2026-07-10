export const DASHBOARD_SECTIONS = Object.freeze([
  { id: "connect", label: "Connect" },
  { id: "vault", label: "Vault" },
  { id: "usage", label: "Usage" },
  { id: "settings", label: "Settings" },
] as const)

export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number]["id"]

export const CANONICAL_MCP_ORIGIN = "https://cloud.zenod.dev"

export function dashboardSectionForTab(
  tab: string | undefined
): DashboardSection {
  if (tab === "vault") return "vault"
  if (tab === "costs") return "usage"
  if (tab === "keys" || tab === "rules" || tab === "skills") return "settings"
  return "connect"
}

export function mcpUrlForToken(
  token: string,
  origin = CANONICAL_MCP_ORIGIN
): string {
  return new URL(`/mcp/${encodeURIComponent(token)}`, `${origin}/`).toString()
}

export function mcpClientSnippets(mcpUrl: string) {
  return {
    claude: `claude mcp add --transport http zenod ${mcpUrl}`,
    codex: `codex mcp add zenod --url ${mcpUrl}`,
  }
}
