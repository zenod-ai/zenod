import * as React from "react"
import {
  ArrowLeftIcon,
  BotIcon,
  InboxIcon,
  LogOutIcon,
  MessagesSquareIcon,
  NetworkIcon,
  SettingsIcon,
  UserRoundIcon,
} from "lucide-react"

import { ZenodLogo } from "@/components/zenod-logo"
import { HostedFreePlanBanner, HostedPlanLine } from "@/components/free-plan-notice"
import { HostedEndOfTestOffer } from "@/components/end-of-test-offer"
import { QuickStartCard, QuickStartPill, QuickStartRestore } from "@/components/quick-start"
import { UsageByFeaturePanel } from "@/components/usage-by-feature"
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
import { ThemeToggle } from "@/components/theme-toggle"
import { MemoryChat } from "@/components/memory-chat"
import { MemoryGlanceView } from "@/components/memory-glance"
import { MemoryGraph } from "@/components/memory-graph"
import { MemoryInbox } from "@/components/memory-inbox"
import { MemoryPersonas } from "@/components/memory-personas"
import { MemoryNoteViewer } from "@/components/memory-note-viewer"
import { GoogleDriveConnect } from "@/components/google-drive-connect"
import { SubscribersPanel } from "@/components/subscribers-panel"
import { useInboxCount } from "@/lib/inbox"
import { memoryPathFromHash } from "@/lib/memory-chat"
import { useSubscribersAvailability } from "@/lib/subscribers"
import {
  DashboardOverview,
  type DashboardOverviewData,
} from "@/views/DashboardOverview"
import {
  PUBLIC_LANDING_URL,
  dashboardPlaceForHash,
  dashboardPlaceForTab,
  type DashboardPlace,
  type DashboardSection,
} from "@/views/dashboard-navigation"
import { VaultTab } from "@/views/settings/VaultTab"
import {
  HostedChannelsPanel,
  HostedUsagePanel,
  MemoryTreePanel,
} from "@/views/ZenodPortalPanels"
import {
  MEMORY_VIEWS,
  SETTINGS_VIEWS,
  type ZenodMemoryView,
  type ZenodSettingsView,
} from "@/views/zenod-edition"

// EPIC-22 E22-2: the hosted app as the librarian of your memory. "Zenod" leads the header and the
// tagline sits under it, small and quiet; five tabs: Chat, Inbox, Personas, Memory and the Settings
// gear. Every panel of the twelve-tab app moved here as it was: Graph, Memory and Overview's recent
// saves under Memory; Connect, Channels, Subscribers, Vault, Usage and Account under Settings.

const SECTION_ICONS = {
  chat: MessagesSquareIcon,
  inbox: InboxIcon,
  personas: BotIcon,
  memory: NetworkIcon,
  settings: SettingsIcon,
} as const

export function HostedAccountLink() {
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

function SubNav<T extends string>({
  label,
  views,
  value,
  onChange,
}: {
  label: string
  views: readonly { id: T; label: string }[]
  value: T
  onChange: (view: T) => void
}) {
  return (
    <nav className="zl-sub" aria-label={label}>
      {views.map((view) => (
        <button
          key={view.id}
          type="button"
          aria-current={view.id === value ? "true" : undefined}
          onClick={() => onChange(view.id)}
        >
          {view.label}
        </button>
      ))}
    </nav>
  )
}

export function HostedApp({
  overview,
  initialTab,
  loggingOut,
  onLogout,
}: {
  overview: DashboardOverviewData
  initialTab?: string
  loggingOut: boolean
  onLogout: () => void
}) {
  const [place, setPlace] = React.useState<Required<DashboardPlace>>(() => {
    // Old links: #anchors first, then `?tab=` (e.g. ?tab=graph), then the place the app was asked to open.
    const tab = new URLSearchParams(window.location.search).get("tab") ?? undefined
    const first =
      dashboardPlaceForHash(window.location.hash) ??
      (tab ? dashboardPlaceForTab(tab, "hosted") : dashboardPlaceForTab(initialTab, "hosted"))
    return { section: first.section, memory: first.memory ?? "glance", settings: first.settings ?? "connect" }
  })
  const go = React.useCallback((next: DashboardPlace) => {
    setPlace((was) => ({
      section: next.section,
      memory: next.memory ?? was.memory,
      settings: next.settings ?? was.settings,
    }))
  }, [])
  // E12-S1: a memory link from the chat (`#memory?path=…`) opens that memory in Memory › Tree.
  const [memoryPath, setMemoryPath] = React.useState<string | null>(() =>
    memoryPathFromHash(window.location.hash)
  )
  React.useEffect(() => {
    const onHash = () => {
      const path = memoryPathFromHash(window.location.hash)
      if (path) {
        setMemoryPath(path)
        go({ section: "memory", memory: "tree" })
        window.scrollTo?.({ top: 0 })
        return
      }
      const next = dashboardPlaceForHash(window.location.hash)
      if (!next) return
      go(next)
      // E12-S13: "Show in graph" from deep in the chat lands at the top of the graph.
      if (next.memory === "graph" && window.location.hash.includes("m=")) window.scrollTo?.({ top: 0 })
    }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [go])
  const closeMemory = React.useCallback(() => {
    setMemoryPath(null)
    go({ section: "chat" })
    window.history.replaceState(null, "", window.location.pathname + window.location.search)
  }, [go])
  const subscribersAvailability = useSubscribersAvailability()
  const inboxCount = useInboxCount(true)
  const sections: { id: DashboardSection; label: string }[] = [
    { id: "chat", label: "Chat" },
    { id: "inbox", label: "Inbox" },
    { id: "personas", label: "Helpers" },
    { id: "memory", label: "Memory" },
  ]

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <header className="zl-head">
        <div className="zl-brand">
          <ZenodLogo />
          <div className="min-w-0">
            <h1 className="zl-name">Zenod</h1>
            <p className="zl-tagline">the librarian of your memory</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QuickStartPill onOpen={() => { go({ section: "chat" }); window.scrollTo?.({ top: 0 }) }} />
          <HostedPlanLine />
        </div>
      </header>
      <HostedEndOfTestOffer />

      <Tabs
        className="zl-tabs"
        value={place.section}
        onValueChange={(value) => go({ section: value as DashboardSection })}
      >
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {sections.map(({ id, label }) => {
            const Icon = SECTION_ICONS[id as keyof typeof SECTION_ICONS]
            return (
              <TabsTrigger key={id} value={id}>
                <Icon />
                {label}
                {id === "inbox" && inboxCount > 0 ? (
                  <span
                    className="ml-0.5 rounded-full bg-[#1f4d3a] px-1.5 text-[11px] leading-[18px] font-semibold text-[#f6f2e9] tabular-nums dark:bg-[#2d6a4e]"
                    aria-label={`${inboxCount} need you`}
                  >
                    {inboxCount}
                  </span>
                ) : null}
              </TabsTrigger>
            )
          })}
          <TabsTrigger value="settings" className="zl-gear" aria-label="Settings">
            <SettingsIcon />
            <span className="zl-gear-word">Settings</span>
          </TabsTrigger>
        </TabsList>
        {/* The chat stays mounted: a talk or an answer is still there after a look at Memory. */}
        <TabsContent value="chat" forceMount className="mt-4 data-[state=inactive]:hidden">
          {/* EPIC-26 S15: the tester quick start, above Chat until hidden or done. */}
          <div className="mb-4 empty:hidden">
            <QuickStartCard go={go} />
          </div>
          <MemoryChat />
        </TabsContent>
        <TabsContent value="inbox" className="mt-4">
          <MemoryInbox active={place.section === "inbox"} />
        </TabsContent>
        <TabsContent value="personas" className="mt-4">
          <MemoryPersonas active={place.section === "personas"} />
        </TabsContent>
        <TabsContent value="memory" className="mt-4">
          <SubNav<ZenodMemoryView>
            label="Memory"
            views={MEMORY_VIEWS}
            value={place.memory}
            onChange={(memory) => go({ section: "memory", memory })}
          />
          {place.memory === "glance" ? (
            <MemoryGlanceView onOpenTree={() => go({ section: "memory", memory: "tree" })} />
          ) : place.memory === "graph" ? (
            <MemoryGraph />
          ) : place.memory === "check" ? (
            <div className="flex flex-col gap-6">
              <MemoryTreePanel view="check" />
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {memoryPath ? (
                <MemoryNoteViewer key={memoryPath} path={memoryPath} onClose={closeMemory} />
              ) : null}
              <MemoryTreePanel view="tree" />
            </div>
          )}
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SubNav<ZenodSettingsView>
            label="Settings"
            views={SETTINGS_VIEWS}
            value={place.settings}
            onChange={(settings) => go({ section: "settings", settings })}
          />
          {place.settings === "connect" ? (
            <DashboardOverview overview={overview} showSupportCards={false} hosted />
          ) : place.settings === "channels" ? (
            <div className="flex flex-col gap-6">
              <HostedChannelsPanel />
              {subscribersAvailability === "on" ? <SubscribersPanel /> : null}
            </div>
          ) : place.settings === "vault" ? (
            <div className="flex flex-col gap-6">
              <VaultTab allowReclone={false} edition="hosted" />
              <GoogleDriveConnect edition="hosted" />
            </div>
          ) : place.settings === "usage" ? (
            <div className="flex flex-col gap-6">
              <HostedFreePlanBanner />
              <HostedUsagePanel />
              <UsageByFeaturePanel />
              <p className="text-sm text-muted-foreground">
                Plan and billing: <a className="underline" href="/account">open account and billing</a>.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <HostedAccountLink />
              <div className="flex flex-wrap items-center gap-2">
                <QuickStartRestore go={go} />
                <ThemeToggle />
                <Button asChild variant="outline" size="sm">
                  <a href={PUBLIC_LANDING_URL}>
                    <ArrowLeftIcon data-icon="inline-start" />
                    Landing
                  </a>
                </Button>
                <Button variant="outline" size="sm" disabled={loggingOut} onClick={onLogout}>
                  {loggingOut ? <Spinner /> : <LogOutIcon data-icon="inline-start" />}
                  Log out
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
