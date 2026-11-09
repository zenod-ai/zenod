import {
  editionProfile,
  type ZenodEdition,
  type ZenodMemoryView,
  type ZenodPortalSection,
  type ZenodSettingsView,
} from "@/views/zenod-edition"

// Kept as the self-hosted alias for callers that have not yet adopted an
// explicit edition. The portal itself always uses dashboardSectionsForEdition.
export const DASHBOARD_SECTIONS = editionProfile("self-hosted").sections

export type DashboardSection = ZenodPortalSection

export const PUBLIC_LANDING_URL = "https://zenod.dev/"
export const CANONICAL_MCP_ORIGIN = "https://cloud.zenod.dev"

/** Where a panel lives: a tab, and for Memory and Settings (hosted, EPIC-22) the view inside it. */
export type DashboardPlace = {
  section: DashboardSection
  memory?: ZenodMemoryView
  settings?: ZenodSettingsView
}

// EPIC-22 E22-2: every old hosted tab, and the new view names, to their home in the five tabs.
const HOSTED_PLACES: Record<string, Omit<DashboardPlace, "section"> & { section: DashboardSection }> = {
  chat: { section: "chat" },
  inbox: { section: "inbox" },
  personas: { section: "personas" },
  // EPIC-14 S25: personas are called helpers now; old #personas links still open the tab.
  helpers: { section: "personas" },
  memory: { section: "memory", memory: "tree" },
  tree: { section: "memory", memory: "tree" },
  glance: { section: "memory", memory: "glance" },
  overview: { section: "memory", memory: "glance" },
  graph: { section: "memory", memory: "graph" },
  check: { section: "memory", memory: "check" },
  settings: { section: "settings", settings: "connect" },
  connect: { section: "settings", settings: "connect" },
  connections: { section: "settings", settings: "connect" },
  channels: { section: "settings", settings: "channels" },
  subscribers: { section: "settings", settings: "channels" },
  vault: { section: "settings", settings: "vault" },
  usage: { section: "settings", settings: "usage" },
  costs: { section: "settings", settings: "usage" },
  account: { section: "settings", settings: "account" },
}

/** The hosted app's place for a `?tab=` value or #anchor name; the chat when it names nothing known. */
export function dashboardPlaceForTab(
  tab: string | undefined,
  edition: ZenodEdition = "self-hosted"
): DashboardPlace {
  if (edition === "hosted") return HOSTED_PLACES[tab ?? ""] ?? { section: "chat" }
  return { section: dashboardSectionForTab(tab, edition) }
}

/** The place an in-app #anchor opens (hosted): `#graph?…`, `#memory?path=…`, `#chat?talk=…`, `#settings/usage`. */
export function dashboardPlaceForHash(hash: string): DashboardPlace | null {
  const name = hash.replace(/^#/, "").split(/[?]/)[0]!.split("/")
  const [first = "", second] = name
  if (!first) return null
  if (first === "memory" && hash.startsWith("#memory?")) return { section: "memory", memory: "tree" }
  if ((first === "memory" || first === "settings") && second) {
    const place = HOSTED_PLACES[second]
    if (place?.section === first) return place
  }
  if (first === "ring-router-products" || first === "phylax-channels") return HOSTED_PLACES.channels!
  return HOSTED_PLACES[first] ?? null
}

export function dashboardSectionForTab(
  tab: string | undefined,
  edition: ZenodEdition = "self-hosted"
): DashboardSection {
  if (edition === "hosted") return dashboardPlaceForTab(tab, edition).section
  const available = new Set(
    editionProfile(edition).sections.map(({ id }) => id)
  )
  if (tab === "chat" && available.has("chat")) return "chat"
  if (tab === "graph" && available.has("graph")) return "graph"
  if (tab === "inbox" && available.has("inbox")) return "inbox"
  if ((tab === "personas" || tab === "helpers") && available.has("personas")) return "personas"
  if (tab === "overview" && available.has("overview")) return "overview"
  if (tab === "memory" && available.has("memory")) return "memory"
  if (tab === "connect" && available.has("connect")) return "connect"
  if (tab === "connections" && available.has("connect")) return "connect"
  if (tab === "subscribers" && available.has("subscribers")) return "subscribers"
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
  // E12-S1: the hosted app opens on its chat.
  return available.has("chat") ? "chat" : "overview"
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
  account?: { token?: string | null; mcp_url?: string | null } | null,
  hosted = false
): { token: string; url: string } {
  const token = account?.token || connectionToken
  return {
    token,
    url: hosted
      ? new URL("/mcp", account?.mcp_url || CANONICAL_MCP_ORIGIN).toString()
      : account?.mcp_url || mcpUrlForToken(token),
  }
}

export function mcpClientSnippets(
  mcpUrl: string,
  name = "zenod",
  oauth = false
) {
  return {
    claude: `claude mcp add --transport http ${name} ${mcpUrl}${oauth ? "\n# In Claude Code: /mcp → Authenticate" : ""}`,
    codex: `codex mcp add ${name} --url ${mcpUrl}${oauth ? `\ncodex mcp login ${name}` : ""}`,
  }
}
