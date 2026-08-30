import * as React from "react"
import {
  ArrowLeftIcon,
  BrainIcon,
  FolderGit2Icon,
  GaugeIcon,
  KeyRoundIcon,
  LogOutIcon,
  MessageCircleIcon,
  PlugZapIcon,
  Settings2Icon,
  UserRoundIcon,
  WalletCardsIcon,
} from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage, type SettingsValues } from "@/lib/api"
import { PeerAgents } from "@/components/peer-agents"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DashboardOverview,
  type DashboardOverviewData,
} from "@/views/DashboardOverview"
import {
  PUBLIC_LANDING_URL,
  dashboardSectionsForEdition,
  dashboardSectionForTab,
  type DashboardSection,
} from "@/views/dashboard-navigation"
import { CostsTab } from "@/views/settings/CostsTab"
import { KeysTab } from "@/views/settings/KeysTab"
import { VaultTab } from "@/views/settings/VaultTab"
import { ChatTab } from "@/views/ChatTab"
import { PhylaxTenantSettings } from "@/components/phylax-tenant-settings"
import { HeraldLoopPanels } from "@/components/herald-loop-panels"
import { GoogleDriveConnect } from "@/components/google-drive-connect"
import { TelegramConnect } from "@/components/telegram-connect"
import {
  HostedChannelsPanel,
  HostedUsagePanel,
  ZenodOverview,
} from "@/views/ZenodPortalPanels"
import type { ZenodEdition } from "@/views/zenod-edition"

const SECTION_ICONS = {
  overview: GaugeIcon,
  connect: PlugZapIcon,
  channels: MessageCircleIcon,
  vault: FolderGit2Icon,
  usage: WalletCardsIcon,
  settings: Settings2Icon,
  account: UserRoundIcon,
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
        <h2 className="text-lg font-semibold">AI configuration</h2>
        <p className="text-sm text-muted-foreground">
          Choose the provider credentials and models used by this self-hosted
          Zenod.
        </p>
      </div>
      <div className="flex items-center gap-2 text-sm font-medium">
        <KeyRoundIcon className="size-4" />
        Keys &amp; models
      </div>
      <KeysTab initial={settings} onSaved={onSaved} vaultless={false} />
    </div>
  )
}

function HostedAccountLink() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Account</h2>
        <p className="text-sm text-muted-foreground">
          Sign-in identities, subscription state, vault access, and billing
          management.
        </p>
      </div>
      <Card>
        <CardHeader>
          <UserRoundIcon className="size-5 text-muted-foreground" />
          <CardTitle>Zenod Hosted account</CardTitle>
          <CardDescription>
            The existing account surface remains the source of truth for your
            subscription and billing access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/account">Open account and billing</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export function Settings({
  initialSettings,
  initialTab,
  onLoggedOut,
  edition = "self-hosted",
}: {
  initialSettings: SettingsValues
  initialTab?: string
  onLoggedOut: () => void
  edition?: ZenodEdition
}) {
  const [loggingOut, setLoggingOut] = React.useState(false)
  const [settings, setSettings] = React.useState(initialSettings)
  const [overview, setOverview] = React.useState<DashboardOverviewData | null>(
    null
  )
  const [section, setSection] = React.useState<DashboardSection>(() =>
    dashboardSectionForTab(initialTab, edition)
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

  if (!overview) {
    const product =
      window.location.hostname === "herald.zenod.dev"
        ? "Herald"
        : window.location.hostname === "ring.zenod.dev"
          ? "The Ring"
          : window.location.hostname === "phylax.zenod.dev"
            ? "Phylax"
            : "dashboard"
    return (
      <div
        aria-label={`Loading ${product}`}
        className="flex min-h-svh flex-col items-center justify-center gap-3"
      >
        <Spinner className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading {product}…</p>
      </div>
    )
  }

  async function handleLogout() {
    setLoggingOut(true)
    try {
      if (edition === "hosted") {
        const response = await fetch("/auth/signout", { method: "POST" })
        if (!response.ok) throw new Error("Could not log out")
      } else {
        await api("/api/auth/logout", { method: "POST" })
      }
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
            <h1 className="text-xl font-semibold">
              {isRing
                ? "The Ring"
                : isHerald
                  ? "Herald"
                  : isPhylax
                    ? "Phylax"
                    : "Zenod"}
            </h1>
            <p className="truncate text-sm text-muted-foreground">
              {overview
                ? isRing || isHerald || isPhylax
                  ? `${overview.tenant.name ?? overview.tenant.id} · ${overview.usage?.units ?? 0} usage units`
                  : `${overview.tenant.name ?? overview.tenant.id} · ${edition === "hosted" ? "Hosted" : "Self-hosted"}`
                : isRing
                  ? "Your council — one chat, wired to all your agents"
                  : isHerald
                    ? "Your project's voice, on a loop"
                    : "Your memory through MCP"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <a
              href={
                isRing
                  ? "https://ring.zenod.dev/"
                  : isHerald
                    ? "https://herald.zenod.dev/"
                    : isPhylax
                      ? "https://phylax.zenod.dev/"
                      : PUBLIC_LANDING_URL
              }
            >
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

      {isPhylax ? (
        <main>
          <PhylaxTenantSettings />
        </main>
      ) : isCouncilUnit ? (
        <main className="flex flex-col gap-6">
          <section
            aria-labelledby="council-chat-heading"
            className="flex flex-col gap-2"
          >
            <div>
              <h2 id="council-chat-heading" className="text-lg font-semibold">
                {isHerald ? "Herald chat" : "Council chat"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {isHerald
                  ? "Herald keeps this conversation, the approved Briefing, and the Board in one shared state."
                  : "One conversation with the council wired to your units."}
              </p>
            </div>
            <ChatTab vaultless product={isHerald ? "herald" : "default"} />
          </section>
          <section aria-label={isHerald ? "Herald capabilities" : "My Units"}>
            <PeerAgents product={isHerald ? "herald" : "ring"} />
          </section>
          {isHerald ? <HeraldLoopPanels /> : null}
          <div className="grid gap-6 lg:grid-cols-2">
            <DashboardOverview overview={overview} />
            <section
              aria-labelledby="ring-keys-heading"
              className="flex flex-col gap-2"
            >
              <div>
                <h2 id="ring-keys-heading" className="text-lg font-semibold">
                  Keys
                </h2>
                <p className="text-sm text-muted-foreground">
                  {isHerald
                    ? "The tenant-scoped model key Herald uses for chat and loop work."
                    : "Your tenant-scoped Council model key."}
                </p>
              </div>
              <KeysTab
                initial={settings}
                onSaved={setSettings}
                vaultless
                unitLabel={isHerald ? "Herald" : "Ring Council"}
              />
            </section>
          </div>
        </main>
      ) : (
        <Tabs
          value={section}
          onValueChange={(value) => setSection(value as DashboardSection)}
        >
          <TabsList className="max-w-full overflow-x-auto">
            {dashboardSectionsForEdition(edition).map(({ id, label }) => {
              const Icon = SECTION_ICONS[id]
              return (
                <TabsTrigger key={id} value={id}>
                  <Icon />
                  {label}
                </TabsTrigger>
              )
            })}
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <ZenodOverview
              edition={edition}
              overview={overview}
              onNavigate={setSection}
            />
          </TabsContent>
          <TabsContent value="connect" className="mt-4">
            <DashboardOverview overview={overview} showSupportCards={false} />
          </TabsContent>
          <TabsContent value="channels" className="mt-4">
            {edition === "hosted" ? (
              <HostedChannelsPanel />
            ) : (
              <TelegramConnect presentation="zenod-self-hosted" />
            )}
          </TabsContent>
          <TabsContent value="vault" className="mt-4">
            <div className="flex flex-col gap-6">
              <VaultTab
                allowReclone={edition === "self-hosted"}
                edition={edition}
              />
              <GoogleDriveConnect edition={edition} />
            </div>
          </TabsContent>
          <TabsContent value="usage" className="mt-4">
            {edition === "hosted" ? <HostedUsagePanel /> : <CostsTab />}
          </TabsContent>
          <TabsContent value="settings" className="mt-4">
            <SettingsPanel settings={settings} onSaved={setSettings} />
          </TabsContent>
          <TabsContent value="account" className="mt-4">
            <HostedAccountLink />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
