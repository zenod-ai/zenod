export type ZenodEdition = "hosted" | "self-hosted"

export type ZenodCapability =
  | "managed-ai"
  | "customer-billing"
  | "hosted-whatsapp"
  | "provider-settings"
  | "raw-usage"
  | "telegram"
  | "vault-sources"
  | "mcp"

export type ZenodPortalSection =
  | "chat"
  | "graph"
  | "inbox"
  | "personas"
  | "overview"
  | "memory"
  | "connect"
  | "subscribers"
  | "channels"
  | "vault"
  | "usage"
  | "settings"
  | "account"

export type ZenodEditionProfile = {
  id: ZenodEdition
  label: string
  capabilities: ReadonlySet<ZenodCapability>
  sections: readonly { id: ZenodPortalSection; label: string }[]
}

// EPIC-22 E22-2: the librarian of your memory has five tabs. Chat (E12-S1) is where you land; Inbox
// (EPIC-14 S2) and Personas (S4) stay; everything else moved, not rewritten, under Memory (At a
// glance, Tree, Graph, Check filings) and Settings (the gear). Old `?tab=` links and #anchors still
// open their panel in its new home (dashboardPlaceForTab).
const HOSTED_SECTIONS = Object.freeze([
  { id: "chat", label: "Chat" },
  { id: "inbox", label: "Inbox" },
  { id: "personas", label: "Personas" },
  { id: "memory", label: "Memory" },
  { id: "settings", label: "Settings" },
] as const)

export type ZenodMemoryView = "glance" | "tree" | "graph" | "check"
export type ZenodSettingsView = "connect" | "channels" | "vault" | "usage" | "account"

export const MEMORY_VIEWS: readonly { id: ZenodMemoryView; label: string }[] = Object.freeze([
  { id: "glance", label: "At a glance" },
  { id: "tree", label: "Tree" },
  { id: "graph", label: "Graph" },
  { id: "check", label: "Check filings" },
])

export const SETTINGS_VIEWS: readonly { id: ZenodSettingsView; label: string }[] = Object.freeze([
  { id: "connect", label: "Connect AI apps" },
  { id: "channels", label: "WhatsApp & Telegram" },
  { id: "vault", label: "Vault & sources" },
  { id: "usage", label: "Usage & plan" },
  { id: "account", label: "Account" },
])

const SELF_HOSTED_SECTIONS = Object.freeze([
  { id: "overview", label: "Overview" },
  { id: "connect", label: "Connect / MCP" },
  { id: "subscribers", label: "Subscribers" },
  { id: "channels", label: "Channels" },
  { id: "vault", label: "Vault & sources" },
  { id: "usage", label: "Usage" },
  { id: "settings", label: "Settings" },
] as const)

export const ZENOD_EDITION_PROFILES: Record<ZenodEdition, ZenodEditionProfile> =
  {
    hosted: {
      id: "hosted",
      label: "Hosted",
      capabilities: new Set<ZenodCapability>([
        "managed-ai",
        "customer-billing",
        "hosted-whatsapp",
        "telegram",
        "vault-sources",
        "mcp",
      ]),
      sections: HOSTED_SECTIONS,
    },
    "self-hosted": {
      id: "self-hosted",
      label: "Self-hosted",
      capabilities: new Set<ZenodCapability>([
        "provider-settings",
        "raw-usage",
        "telegram",
        "vault-sources",
        "mcp",
      ]),
      sections: SELF_HOSTED_SECTIONS,
    },
  }

export function editionProfile(edition: ZenodEdition): ZenodEditionProfile {
  return ZENOD_EDITION_PROFILES[edition]
}

export function editionHas(
  edition: ZenodEdition,
  capability: ZenodCapability
): boolean {
  return editionProfile(edition).capabilities.has(capability)
}
