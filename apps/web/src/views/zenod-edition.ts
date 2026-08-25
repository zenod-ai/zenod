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
  | "overview"
  | "connect"
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

const HOSTED_SECTIONS = Object.freeze([
  { id: "overview", label: "Overview" },
  { id: "connect", label: "Connect / MCP" },
  { id: "channels", label: "Channels" },
  { id: "vault", label: "Vault & sources" },
  { id: "usage", label: "Usage" },
  { id: "account", label: "Account" },
] as const)

const SELF_HOSTED_SECTIONS = Object.freeze([
  { id: "overview", label: "Overview" },
  { id: "connect", label: "Connect / MCP" },
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
