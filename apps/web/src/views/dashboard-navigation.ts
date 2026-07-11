export const DASHBOARD_SECTIONS = Object.freeze([
  { id: "connect", label: "Connect" },
  { id: "vault", label: "Vault" },
  { id: "usage", label: "Usage" },
  { id: "settings", label: "Settings" },
] as const)

export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number]["id"]

export const PUBLIC_LANDING_URL = "https://zenod.dev/"
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

export function resolveMcpAccess(
  connectionToken: string,
  account?: { token?: string | null; mcp_url?: string | null } | null
): { token: string; url: string } {
  const token = account?.token || connectionToken
  return {
    token,
    url: account?.mcp_url || mcpUrlForToken(token),
  }
}

export function mcpClientSnippets(mcpUrl: string, name = "zenod") {
  return {
    claude: `claude mcp add --transport http ${name} ${mcpUrl}`,
    codex: `codex mcp add ${name} --url ${mcpUrl}`,
  }
}
