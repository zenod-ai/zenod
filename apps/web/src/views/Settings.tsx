import * as React from "react"
import {
  ArrowLeftIcon,
  BrainIcon,
  FolderGit2Icon,
  KeyRoundIcon,
  LogOutIcon,
  PlugZapIcon,
  ScrollTextIcon,
  Settings2Icon,
  SparklesIcon,
  WalletCardsIcon,
} from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage, type SettingsValues } from "@/lib/api"
import { PeerAgents } from "@/components/peer-agents"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DashboardOverview,
  type DashboardOverviewData,
} from "@/views/DashboardOverview"
import {
  DASHBOARD_SECTIONS,
  PUBLIC_LANDING_URL,
  dashboardSectionForTab,
  type DashboardSection,
} from "@/views/dashboard-navigation"
import { CostsTab } from "@/views/settings/CostsTab"
import { KeysTab } from "@/views/settings/KeysTab"
import { OperatingRulesTab } from "@/views/settings/OperatingRulesTab"
import { SkillSettingsTab } from "@/views/settings/SkillSettingsTab"
import { VaultTab } from "@/views/settings/VaultTab"
import { ChatTab } from "@/views/ChatTab"
import { PhylaxTenantSettings } from "@/components/phylax-tenant-settings"

const SECTION_ICONS = {
  connect: PlugZapIcon,
  vault: FolderGit2Icon,
  usage: WalletCardsIcon,
  settings: Settings2Icon,
} satisfies Record<
  DashboardSection,
  React.ComponentType<{ className?: string }>
>

function SettingsPanel({
  settings,
  onSaved,
}: {
  settings: SettingsValues
  onSaved: (settings: SettingsValues) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure models, operating rules, and installed skills.
        </p>
      </div>
      <Tabs defaultValue="keys">
        <TabsList variant="line" className="max-w-full overflow-x-auto">
          <TabsTrigger value="keys">
            <KeyRoundIcon />
            Keys &amp; models
          </TabsTrigger>
          <TabsTrigger value="rules">
            <ScrollTextIcon />
            Rules
          </TabsTrigger>
          <TabsTrigger value="skills">
            <SparklesIcon />
            Skills
          </TabsTrigger>
        </TabsList>
        <TabsContent value="keys" className="mt-4">
          <KeysTab initial={settings} onSaved={onSaved} vaultless={false} />
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <OperatingRulesTab />
        </TabsContent>
        <TabsContent value="skills" className="mt-4">
          <SkillSettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function Settings({
  initialSettings,
  initialTab,
  onLoggedOut,
}: {
  initialSettings: SettingsValues
  initialTab?: string
  onLoggedOut: () => void
}) {
  const [loggingOut, setLoggingOut] = React.useState(false)
  const [settings, setSettings] = React.useState(initialSettings)
  const [overview, setOverview] = React.useState<DashboardOverviewData | null>(
    null
  )
  const isRing = overview?.unit?.name === "ring"
  const isHerald = overview?.unit?.name === "herald"
  const isCouncilUnit = isRing || isHerald
  const isPhylax = overview?.unit?.name === "phylax"

  React.useEffect(() => {
    api<DashboardOverviewData>("/api/overview")
      .then(setOverview)
      .catch(() => {})
  }, [])

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
    <div className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <BrainIcon className="size-4.5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{isRing ? "The Ring" : isHerald ? "Herald" : isPhylax ? "Phylax" : "Zenod"}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {overview
                ? `${overview.tenant.name ?? overview.tenant.id} · ${overview.usage?.units ?? 0} usage units`
                : isRing ? "Your council — one chat, wired to all your agents" : isHerald ? "Your project's voice, on a loop" : "Your memory through MCP"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <a href={isRing ? "https://ring.zenod.dev/" : isHerald ? "https://herald.zenod.dev/" : isPhylax ? "https://phylax.zenod.dev/" : PUBLIC_LANDING_URL}>
              <ArrowLeftIcon data-icon="inline-start" />
              Landing
            </a>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={loggingOut}
            onClick={handleLogout}
          >
            {loggingOut ? <Spinner /> : <LogOutIcon data-icon="inline-start" />}
            Log out
          </Button>
        </div>
      </header>

      {isPhylax ? <main><PhylaxTenantSettings /></main> : isCouncilUnit ? (
        <main className="flex flex-col gap-6">
          <section aria-labelledby="council-chat-heading" className="flex flex-col gap-2">
            <div>
              <h2 id="council-chat-heading" className="text-lg font-semibold">{isHerald ? "Herald chat" : "Council chat"}</h2>
              <p className="text-sm text-muted-foreground">{isHerald ? "Brief, approve, and follow every publishing receipt in one conversation." : "One conversation with the council wired to your units."}</p>
            </div>
            <ChatTab vaultless />
          </section>
          <section aria-label="My Units">
            <PeerAgents />
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            <DashboardOverview overview={overview} />
            <section aria-labelledby="ring-keys-heading" className="flex flex-col gap-2">
              <div>
                <h2 id="ring-keys-heading" className="text-lg font-semibold">Keys</h2>
                <p className="text-sm text-muted-foreground">Your tenant-scoped Council model key.</p>
              </div>
              <KeysTab initial={settings} onSaved={setSettings} vaultless unitLabel={isHerald ? "Herald" : "Ring Council"} />
            </section>
          </div>
        </main>
      ) : <Tabs defaultValue={dashboardSectionForTab(initialTab)}>
        <TabsList className="max-w-full overflow-x-auto">
          {DASHBOARD_SECTIONS.map(({ id, label }) => {
            const Icon = SECTION_ICONS[id]
            return (
              <TabsTrigger key={id} value={id}>
                <Icon />
                {label}
              </TabsTrigger>
            )
          })}
        </TabsList>
        <TabsContent value="connect" className="mt-4">
          <DashboardOverview overview={overview} />
        </TabsContent>
        <TabsContent value="vault" className="mt-4">
          <VaultTab />
        </TabsContent>
        <TabsContent value="usage" className="mt-4">
          <CostsTab />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsPanel settings={settings} onSaved={setSettings} />
        </TabsContent>
      </Tabs>}
    </div>
  )
}
