import {
  editionProfile,
  type ZenodEdition,
  type ZenodPortalSection,
} from "@/views/zenod-edition"

// Kept as the self-hosted alias for callers that have not yet adopted an
// explicit edition. The portal itself always uses dashboardSectionsForEdition.
export const DASHBOARD_SECTIONS = editionProfile("self-hosted").sections

export type DashboardSection = ZenodPortalSection

export const PUBLIC_LANDING_URL = "https://zenod.dev/"
export const CANONICAL_MCP_ORIGIN = "https://cloud.zenod.dev"

export function dashboardSectionForTab(
  tab: string | undefined,
  edition: ZenodEdition = "self-hosted"
): DashboardSection {
  const available = new Set(
    editionProfile(edition).sections.map(({ id }) => id)
  )
  if (tab === "overview" && available.has("overview")) return "overview"
  if (tab === "connect" && available.has("connect")) return "connect"
  if (tab === "connections" && available.has("connect")) return "connect"
  if (tab === "channels" && available.has("channels")) return "channels"
  if (tab === "vault") return "vault"
  if (tab === "costs") return "usage"
  if (tab === "usage") return "usage"
  if (
    (tab === "keys" ||
      tab === "rules" ||
      tab === "skills" ||
      tab === "settings") &&
    available.has("settings")
  ) {
    return "settings"
  }
  if (tab === "account" && available.has("account")) return "account"
  return "overview"
}

export function dashboardSectionsForEdition(edition: ZenodEdition) {
  return editionProfile(edition).sections
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
