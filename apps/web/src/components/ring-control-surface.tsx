import * as React from "react"
import {
  ActivityIcon,
  ArrowRightIcon,
  CircleDollarSignIcon,
  ExternalLinkIcon,
  InboxIcon,
  ListChecksIcon,
  NetworkIcon,
  PlayIcon,
  RadioIcon,
  RouteIcon,
  ServerIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  type TelegramStatus,
  type WhatsAppStatus,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

type Peer = {
  name: string
  url: string
  tool: string
  hasToken: boolean
}

type TeamAgent = {
  name: string
  displayName: string
  role: string
  enabled: boolean
  repo: string | null
}

type SyntheticChatResult = {
  correlationId: string
  status: "ok" | "error"
  text: string
  toolEvents: Array<{ phase: string; tool: string; label: string }>
  error?: string
}

type ProductKey = "zenod" | "herald" | "outbound" | "archus" | "epaminon"

type ProductDefinition = {
  key: ProductKey
  peerName: string
  displayName: string
  job: string
  skillText: string
  relayPolicy: string
}

type SurfaceStatus =
  | "connected"
  | "disconnected"
  | "disabled"
  | "unhealthy"
  | "missing-token"

type Snapshot = {
  peers: Peer[]
  team: TeamAgent[]
  whatsapp: WhatsAppStatus | null
  telegram: TelegramStatus | null
  recentTests: SyntheticChatResult[]
  errors: string[]
}

type TestState = {
  status: "running" | "ok" | "error"
  message: string
  correlationId?: string
}

const PRODUCT_DEFINITIONS: ProductDefinition[] = [
  {
    key: "zenod",
    peerName: "zenod",
    displayName: "Zenod",
    job: "Memory and media ingest",
    skillText:
      "Use when a message, audio note, screenshot, PDF, Drive file, or other artifact should become memory.",
    relayPolicy: "Route memory-bound turns to Zenod; relay receipts and citations.",
  },
  {
    key: "herald",
    peerName: "herald",
    displayName: "Herald",
    job: "Paid briefing and scorecard guy",
    skillText:
      "Use for Herald-specific planning, briefings, practice loops, and scorecard work.",
    relayPolicy: "Named pass-through with attribution; Herald owns deeper settings.",
  },
  {
    key: "outbound",
    peerName: "outbound",
    displayName: "Callisthenes",
    job: "Outbound comms",
    skillText:
      "Use for drafting X, Reddit, and email sends. Never send without explicit approval.",
    relayPolicy: "Verbatim relay for drafts, confirmations, and send receipts.",
  },
  {
    key: "archus",
    peerName: "archus",
    displayName: "Archus",
    job: "Backlog and issue steward",
    skillText:
      "Use for backlog curation, issue reads, issue writes, and planner queue policy.",
    relayPolicy: "Relay issue URLs and receipt text exactly.",
  },
  {
    key: "epaminon",
    peerName: "epaminon",
    displayName: "Epaminon",
    job: "Execution runner",
    skillText:
      "Use for running approved tickets, execution status, branch/PR policy, and completion receipts.",
    relayPolicy: "Relay ticket status and outward outcomes with provenance.",
  },
]

const STATUS_LABELS: Record<SurfaceStatus, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  disabled: "Disabled",
  unhealthy: "Unhealthy",
  "missing-token": "Missing token",
}

function statusBadgeVariant(status: SurfaceStatus) {
  if (status === "connected") return "secondary"
  if (status === "unhealthy" || status === "missing-token") return "destructive"
  return "outline"
}

function settingsUrlForPeer(peer: Peer | undefined): string | null {
  if (!peer?.url) return null
  try {
    const url = new URL(peer.url)
    url.pathname = "/"
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return peer.url.replace(/\/mcp\/?$/, "/")
  }
}

function healthUrlForPeer(peer: Peer | undefined): string | null {
  if (!peer?.url) return null
  try {
    const url = new URL(peer.url)
    url.pathname = "/api/health"
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return peer.url.replace(/\/mcp\/?$/, "/api/health")
  }
}

function peerStatus(peer: Peer | undefined, teamAgent: TeamAgent | undefined): SurfaceStatus {
  if (peer && !peer.hasToken) return "missing-token"
  if (peer) return "connected"
  if (teamAgent?.enabled) return "disconnected"
  return "disabled"
}

function channelStatus(
  enabled: boolean,
  state: "disabled" | "disconnected" | "pairing" | "connected" | "error" | undefined,
  hasError: boolean
): SurfaceStatus {
  if (!enabled || state === "disabled") return "disabled"
  if (hasError || state === "error") return "unhealthy"
  if (state === "connected") return "connected"
  return "disconnected"
}

function statusTone(status: SurfaceStatus): string {
  if (status === "connected") return "text-foreground"
  if (status === "unhealthy" || status === "missing-token") return "text-destructive"
  return "text-muted-foreground"
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-muted/20 p-3">
      <span className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </span>
      <span className="truncate text-xl font-semibold tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: SurfaceStatus }) {
  return (
    <Badge variant={statusBadgeVariant(status)}>
      {STATUS_LABELS[status]}
    </Badge>
  )
}

function StatusLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      {(["connected", "disconnected", "disabled", "unhealthy", "missing-token"] as const).map(
        (status) => (
          <StatusBadge key={status} status={status} />
        )
      )}
    </div>
  )
}

function ProductRow({
  product,
  peer,
  teamAgent,
  test,
  onTest,
}: {
  product: ProductDefinition
  peer: Peer | undefined
  teamAgent: TeamAgent | undefined
  test: TestState | undefined
  onTest: (product: ProductDefinition) => void
}) {
  const status = test?.status === "error" ? "unhealthy" : peerStatus(peer, teamAgent)
  const settingsUrl = settingsUrlForPeer(peer)
  const healthUrl = healthUrlForPeer(peer)
  const canTest = status === "connected" || status === "missing-token"

  return (
    <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{product.displayName}</span>
          <StatusBadge status={status} />
          <Badge variant="outline" className="font-mono">
            {peer?.tool ?? `ask_${product.peerName}`}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{product.job}</p>
        <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          <div>
            <span className="font-medium text-foreground">Skill: </span>
            {product.skillText}
          </div>
          <div>
            <span className="font-medium text-foreground">Relay: </span>
            {product.relayPolicy}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          <span className="truncate font-mono">
            Endpoint: {peer?.url ?? "not connected"}
          </span>
          <span className={cn("truncate", statusTone(status))}>
            Health: {test?.message ?? (healthUrl ? "Health URL available" : "No route test run yet")}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-2 sm:justify-end">
        {settingsUrl !== null ? (
          <Button asChild variant="outline" size="sm">
            <a href={settingsUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon data-icon="inline-start" />
              Settings
            </a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Settings
          </Button>
        )}
        {healthUrl !== null ? (
          <Button asChild variant="ghost" size="sm">
            <a href={healthUrl} target="_blank" rel="noopener noreferrer">
              <ActivityIcon data-icon="inline-start" />
              Health
            </a>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canTest || test?.status === "running"}
          onClick={() => onTest(product)}
        >
          {test?.status === "running" ? (
            <Spinner />
          ) : (
            <PlayIcon data-icon="inline-start" />
          )}
          Test route
        </Button>
      </div>
    </div>
  )
}

function ChannelRow({
  name,
  detail,
  status,
  settingsHref,
}: {
  name: string
  detail: string
  status: SurfaceStatus
  settingsHref: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{name}</span>
          <StatusBadge status={status} />
        </div>
        <span className="text-sm text-muted-foreground">{detail}</span>
      </div>
      <Button asChild variant="ghost" size="sm">
        <a href={settingsHref}>
          <ArrowRightIcon data-icon="inline-start" />
          Settings
        </a>
      </Button>
    </div>
  )
}

export function RingControlSurface({ enabled }: { enabled: boolean }) {
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null)
  const [tests, setTests] = React.useState<Record<string, TestState>>({})

  const load = React.useCallback(() => {
    if (!enabled) return
    let cancelled = false
    void Promise.allSettled([
      api<{ peers: Peer[] }>("/api/peers"),
      api<{ agents: TeamAgent[] }>("/api/team"),
      api<WhatsAppStatus>("/api/whatsapp/status"),
      api<TelegramStatus>("/api/telegram/status"),
      api<{ runs: SyntheticChatResult[] }>("/api/test/chat?limit=5"),
    ]).then((results) => {
      if (cancelled) return
      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => errorMessage(result.reason))
      setSnapshot({
        peers:
          results[0].status === "fulfilled" ? results[0].value.peers : [],
        team:
          results[1].status === "fulfilled" ? results[1].value.agents : [],
        whatsapp: results[2].status === "fulfilled" ? results[2].value : null,
        telegram: results[3].status === "fulfilled" ? results[3].value : null,
        recentTests:
          results[4].status === "fulfilled" ? results[4].value.runs : [],
        errors,
      })
    })
    return () => {
      cancelled = true
    }
  }, [enabled])

  React.useEffect(() => load(), [load])

  async function runRouteTest(product: ProductDefinition) {
    setTests((previous) => ({
      ...previous,
      [product.key]: { status: "running", message: "Running synthetic route test..." },
    }))
    try {
      const result = await api<SyntheticChatResult>("/api/test/chat", {
        method: "POST",
        body: {
          message:
            product.key === "zenod"
              ? "Ring route test: remember that memory and media ingest belongs to Zenod."
              : `For ${product.displayName}: Ring route health check. Return a receipt if this reaches you.`,
          surface: "web",
          conversationKey: `ring-control-${product.key}`,
          testRunId: "ring-control-surface",
        },
      })
      setTests((previous) => ({
        ...previous,
        [product.key]: {
          status: result.status,
          message:
            result.status === "ok"
              ? `${result.toolEvents.length} tool event(s), ${result.correlationId}`
              : result.error ?? "Route test failed",
          correlationId: result.correlationId,
        },
      }))
      toast.success(`${product.displayName} route test complete`, {
        description: result.correlationId,
      })
      load()
    } catch (err) {
      setTests((previous) => ({
        ...previous,
        [product.key]: {
          status: "error",
          message: errorMessage(err),
        },
      }))
      toast.error(`${product.displayName} route test failed`, {
        description: errorMessage(err),
      })
    }
  }

  if (!enabled) return null

  if (snapshot === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ring control surface</CardTitle>
          <CardDescription>Loading router, channel, and product status.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </CardContent>
      </Card>
    )
  }

  const peersByName = new Map(snapshot.peers.map((peer) => [peer.name, peer]))
  const teamByName = new Map(snapshot.team.map((agent) => [agent.name, agent]))
  const productRows = PRODUCT_DEFINITIONS.map((product) => ({
    product,
    peer: peersByName.get(product.peerName),
    teamAgent: teamByName.get(product.peerName),
  }))
  const connectedProducts = productRows.filter(({ peer }) => peer?.hasToken).length
  const whatsappStatus = channelStatus(
    snapshot.whatsapp?.enabled ?? false,
    snapshot.whatsapp?.state,
    Boolean(snapshot.whatsapp?.lastError)
  )
  const telegramStatus = channelStatus(
    snapshot.telegram?.enabled ?? false,
    snapshot.telegram?.state,
    Boolean(snapshot.telegram?.lastError)
  )
  const connectedChannels =
    1 +
    (whatsappStatus === "connected" ? 1 : 0) +
    (telegramStatus === "connected" ? 1 : 0)

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <RouteIcon className="size-5 text-muted-foreground" />
          <CardTitle>Ring control surface</CardTitle>
          <CardDescription>
            Router overview for channels, connected products, default routing,
            relay policy, logs, and outward settings links.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {snapshot.errors.length > 0 && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Some Ring status calls failed</AlertTitle>
              <AlertDescription>{snapshot.errors.join(" ")}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Channels"
              value={`${connectedChannels}/3`}
              hint="Web chat plus Phylax channels"
            />
            <Stat
              label="Products"
              value={`${connectedProducts}/${PRODUCT_DEFINITIONS.length}`}
              hint="Connected MCP servers with tokens"
            />
            <Stat
              label="Default route"
              value="General"
              hint="Ambiguous turns use the configured fallback"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="flex gap-3 rounded-lg border p-3">
              <RouteIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <span className="font-medium">Routing</span>
                <span className="text-sm text-muted-foreground">
                  Explicit names pass through to that product. Memory and media
                  intents route to Zenod.
                </span>
              </div>
            </div>
            <div className="flex gap-3 rounded-lg border p-3">
              <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <span className="font-medium">Relay policy</span>
                <span className="text-sm text-muted-foreground">
                  Product answers are attributed and relayed with provenance;
                  Ring does not own deep product settings.
                </span>
              </div>
            </div>
            <div className="flex gap-3 rounded-lg border p-3">
              <CircleDollarSignIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <span className="font-medium">Billing</span>
                <span className="text-sm text-muted-foreground">
                  Spend and model activity remain in the Costs tab until the
                  hosted billing API lands.
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              Status states
            </span>
            <StatusLegend />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <RadioIcon className="size-5 text-muted-foreground" />
          <CardTitle>Channels</CardTitle>
          <CardDescription>
            Phylax transports WhatsApp and Telegram. Web chat enters Ring
            directly. Drive archive and transcription are not Ring channel
            settings; they belong under Zenod.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ChannelRow
            name="Web chat"
            status="connected"
            detail="Browser turns enter the same Ring mailbox with channel=web provenance."
            settingsHref="#ring-router-products"
          />
          <ChannelRow
            name="WhatsApp via Phylax"
            status={whatsappStatus}
            detail={
              snapshot.whatsapp?.linkedNumber
                ? `Linked number ${snapshot.whatsapp.linkedNumber}`
                : "Inbound to Ring, outbound from Ring; Phylax owns pairing and delivery."
            }
            settingsHref="#phylax-channels"
          />
          <ChannelRow
            name="Telegram via Phylax"
            status={telegramStatus}
            detail={
              snapshot.telegram?.botUsername
                ? `Bot @${snapshot.telegram.botUsername}`
                : "Bot transport only; routing and replies stay in Ring."
            }
            settingsHref="#phylax-channels"
          />
        </CardContent>
      </Card>

      <Card id="ring-router-products">
        <CardHeader>
          <ServerIcon className="size-5 text-muted-foreground" />
          <CardTitle>Connected products</CardTitle>
          <CardDescription>
            Ring owns endpoint, token status, enabled state, skill text, relay
            policy, health/test calls, and the settings link. Each product owns
            its own configuration page.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {productRows.map(({ product, peer, teamAgent }) => (
            <ProductRow
              key={product.key}
              product={product}
              peer={peer}
              teamAgent={teamAgent}
              test={tests[product.key]}
              onTest={runRouteTest}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <InboxIcon className="size-5 text-muted-foreground" />
          <CardTitle>Inbox and route logs</CardTitle>
          <CardDescription>
            The Ring mailbox needs one row per inbound turn: channel,
            provenance, selected route, relay target, and receipt.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {snapshot.recentTests.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No synthetic route tests yet. Use Test route on a connected
              product to create a receipt here.
            </div>
          ) : (
            snapshot.recentTests.map((run) => (
              <div
                key={run.correlationId}
                className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={run.status === "ok" ? "secondary" : "destructive"}>
                      {run.status}
                    </Badge>
                    <span className="truncate font-mono text-xs">
                      {run.correlationId}
                    </span>
                  </div>
                  <span className="line-clamp-2 text-sm text-muted-foreground">
                    {run.text || run.error || "No reply text captured"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ListChecksIcon className="size-3.5" />
                  {run.toolEvents.length} tool event(s)
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <NetworkIcon className="size-5 text-muted-foreground" />
          <CardTitle>Zenod boundary</CardTitle>
          <CardDescription>
            Zenod owns memory plus media ingest: raw evidence archive,
            transcription, OCR/extraction, digest, filing, and citations. Ring
            only routes memory-bound inputs there and relays receipts.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
