import * as React from "react"
import { BrainIcon, LogOutIcon } from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage, type SettingsValues } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChatTab } from "@/views/ChatTab"
import { TeamTab } from "@/views/settings/TeamTab"
import { ConnectionsTab } from "@/views/settings/ConnectionsTab"
import { CostsTab } from "@/views/settings/CostsTab"
import { TranscriptionTab } from "@/views/settings/TranscriptionTab"
import { KeysTab } from "@/views/settings/KeysTab"
import { McpConfigTab } from "@/views/settings/McpConfigTab"
import { OperatingRulesTab } from "@/views/settings/OperatingRulesTab"
import { SkillSettingsTab } from "@/views/settings/SkillSettingsTab"
import { TestTab } from "@/views/settings/TestTab"
import { VaultTab } from "@/views/settings/VaultTab"

type SettingsTab =
  | "chat"
  | "team"
  | "vault"
  | "keys"
  | "transcription"
  | "connections"
  | "costs"
  | "rules"
  | "mcp"
  | "skills"
  | "test"

export function Settings({
  initialSettings,
  initialTab,
  onLoggedOut,
}: {
  initialSettings: SettingsValues
  initialTab?: SettingsTab
  onLoggedOut: () => void
}) {
  const [loggingOut, setLoggingOut] = React.useState(false)
  // Source of truth for settings: lives here so it survives tab switches (Radix
  // unmounts inactive TabsContent). KeysTab re-seeds from this on remount.
  const [settings, setSettings] = React.useState(initialSettings)
  const [overview, setOverview] = React.useState<{
    tenant: { id: string; name?: string }
    usage: { units: number } | null
  } | null>(null)
  // Agent identity (title/subtitle) from the backend so the same shell renders
  // per-agent. Defaults to Zenod's values until the fetch resolves.
  const [identity, setIdentity] = React.useState({
    displayName: "Zenod",
    tagline: "Self-hosted memory agent",
    vaultless: false,
    panels: null as SettingsTab[] | null,
  })
  React.useEffect(() => {
    api<{
      displayName: string
      tagline: string
      vaultless?: boolean
      panels?: string[]
    }>("/api/agent")
      .then((r) =>
        setIdentity({
          displayName: r.displayName,
          tagline: r.tagline,
          vaultless: r.vaultless ?? false,
          panels: Array.isArray(r.panels)
            ? r.panels.filter((panel): panel is SettingsTab =>
                [
                  "chat",
                  "team",
                  "vault",
                  "keys",
                  "transcription",
                  "connections",
                  "costs",
                  "rules",
                  "mcp",
                  "skills",
                  "test",
                ].includes(panel)
              )
            : null,
        })
      )
      .catch(() => {})
  }, [])
  React.useEffect(() => {
    api<{
      tenant: { id: string; name?: string }
      usage: { units: number } | null
    }>("/api/overview")
      .then(setOverview)
      .catch(() => {})
  }, [])
  React.useEffect(() => {
    if (initialTab !== "connections" || !window.location.hash) return
    const targetId = window.location.hash.slice(1)
    const scrollToTarget = () => {
      const target = document.getElementById(targetId)
      if (!target) return false
      target.scrollIntoView()
      return true
    }
    if (scrollToTarget()) return
    const observer = new MutationObserver(() => {
      if (scrollToTarget()) observer.disconnect()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [initialTab])
  // Vaultless agents (the Console shell) have no vault, so the vault-specific
  // tabs (Vault, Transcription — which files Drive transcripts into the vault)
  // are hidden. This is the per-capability tab model in miniature.
  const panelSet = identity.panels === null ? null : new Set(identity.panels)
  const showChat = panelSet?.has("chat") ?? true
  const showVault = panelSet?.has("vault") ?? !identity.vaultless
  // The Console (vaultless) is the team manager — it enables the other agents.
  const showTeam = panelSet?.has("team") ?? identity.vaultless
  const showKeys = panelSet?.has("keys") ?? true
  const showTranscription = panelSet?.has("transcription") ?? true
  const showConnections = panelSet?.has("connections") ?? true
  const showCosts = panelSet?.has("costs") ?? true
  const showRules = panelSet?.has("rules") ?? true
  const showMcp = panelSet?.has("mcp") ?? true
  const showSkills = panelSet?.has("skills") ?? true
  const showTest = panelSet?.has("test") ?? true
  const visibleTabs: SettingsTab[] = [
    ...(showChat ? (["chat"] as const) : []),
    ...(showTeam ? (["team"] as const) : []),
    ...(showVault ? (["vault"] as const) : []),
    ...(showRules ? (["rules"] as const) : []),
    ...(showMcp ? (["mcp"] as const) : []),
    ...(showSkills ? (["skills"] as const) : []),
    ...(showKeys ? (["keys"] as const) : []),
    ...(showTranscription ? (["transcription"] as const) : []),
    ...(showConnections ? (["connections"] as const) : []),
    ...(showCosts ? (["costs"] as const) : []),
    ...(showTest ? (["test"] as const) : []),
  ]
  const defaultTab =
    initialTab && visibleTabs.includes(initialTab)
      ? initialTab
      : (visibleTabs[0] ?? "keys")

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await api("/api/auth/logout", { method: "POST" })
      onLoggedOut()
    } catch (err) {
      toast.error("Could not log out", { description: errorMessage(err) })
      setLoggingOut(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <BrainIcon className="size-4.5" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-semibold tracking-tight">
              {identity.displayName}
            </h1>
            <p className="text-sm text-muted-foreground">{identity.tagline}</p>
            {overview && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="tenant-overview"
              >
                {overview.tenant.name ?? overview.tenant.id} ·{" "}
                {overview.usage?.units ?? 0} usage units
              </p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={loggingOut}
          onClick={handleLogout}
        >
          {loggingOut ? <Spinner /> : <LogOutIcon data-icon="inline-start" />}
          Log out
        </Button>
      </header>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          {showChat && <TabsTrigger value="chat">Chat</TabsTrigger>}
          {showTeam && <TabsTrigger value="team">Team</TabsTrigger>}
          {showVault && <TabsTrigger value="vault">Vault</TabsTrigger>}
          {showRules && <TabsTrigger value="rules">Rules</TabsTrigger>}
          {showMcp && <TabsTrigger value="mcp">MCP</TabsTrigger>}
          {showSkills && <TabsTrigger value="skills">Skills</TabsTrigger>}
          {showKeys && (
            <TabsTrigger value="keys">Keys &amp; models</TabsTrigger>
          )}
          {showTranscription && (
            <TabsTrigger value="transcription">Transcription</TabsTrigger>
          )}
          {showConnections && (
            <TabsTrigger value="connections">Connections</TabsTrigger>
          )}
          {showCosts && <TabsTrigger value="costs">Costs</TabsTrigger>}
          {showTest && <TabsTrigger value="test">Test</TabsTrigger>}
        </TabsList>
        {showChat && (
          <TabsContent value="chat" className="mt-4">
            <ChatTab vaultless={identity.vaultless} />
          </TabsContent>
        )}
        {showTeam && (
          <TabsContent value="team" className="mt-4">
            <TeamTab />
          </TabsContent>
        )}
        {showVault && (
          <TabsContent value="vault" className="mt-4">
            <VaultTab />
          </TabsContent>
        )}
        {showRules && (
          <TabsContent value="rules" className="mt-4">
            <OperatingRulesTab />
          </TabsContent>
        )}
        {showMcp && (
          <TabsContent value="mcp" className="mt-4">
            <McpConfigTab />
          </TabsContent>
        )}
        {showSkills && (
          <TabsContent value="skills" className="mt-4">
            <SkillSettingsTab />
          </TabsContent>
        )}
        {showKeys && (
          <TabsContent value="keys" className="mt-4">
            <KeysTab
              initial={settings}
              onSaved={setSettings}
              vaultless={identity.vaultless}
            />
          </TabsContent>
        )}
        {showTranscription && (
          <TabsContent value="transcription" className="mt-4">
            <TranscriptionTab />
          </TabsContent>
        )}
        {showConnections && (
          <TabsContent value="connections" className="mt-4">
            <ConnectionsTab />
          </TabsContent>
        )}
        {showCosts && (
          <TabsContent value="costs" className="mt-4">
            <CostsTab />
          </TabsContent>
        )}
        {showTest && (
          <TabsContent value="test" className="mt-4">
            <TestTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
