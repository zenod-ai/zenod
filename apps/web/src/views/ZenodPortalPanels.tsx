import * as React from "react"
import {
  FolderGit2Icon,
  MessageCircleIcon,
  PlugZapIcon,
  TriangleAlertIcon,
  WalletCardsIcon,
} from "lucide-react"

import { api, errorMessage, type HostedChannelsResponse } from "@/lib/api"
import { HostedChannelsConnections } from "@/views/settings/ConnectionsTab"
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
import type { DashboardOverviewData } from "@/views/DashboardOverview"
import type { ZenodEdition, ZenodPortalSection } from "@/views/zenod-edition"

type CustomerUsageAccount = {
  balance?: {
    limitUsd: number | null
    usageUsd: number | null
    state: "ok" | "warn" | "blocked"
  } | null
}

function usageProjection(account: CustomerUsageAccount | null): {
  percent: number
  state: "normal" | "warn" | "paused"
} | null {
  const limit = account?.balance?.limitUsd
  const used = account?.balance?.usageUsd
  if (typeof limit !== "number" || limit <= 0 || typeof used !== "number") {
    return null
  }
  const percent = Math.min(100, Math.max(0, Math.round((used / limit) * 100)))
  const state =
    account?.balance?.state === "blocked" || percent >= 100
      ? "paused"
      : account?.balance?.state === "warn" || percent >= 80
        ? "warn"
        : "normal"
  return { percent, state }
}

export function HostedUsagePanel({ compact = false }: { compact?: boolean }) {
  const [account, setAccount] = React.useState<CustomerUsageAccount | null>(
    null
  )
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    api<CustomerUsageAccount>("/api/console/account")
      .then((result) => {
        if (!cancelled) setAccount(result)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!loaded)
    return <Skeleton className={compact ? "h-32 w-full" : "h-48 w-full"} />

  const projection = usageProjection(account)
  if (!projection) {
    return (
      <Alert>
        <TriangleAlertIcon />
        <AlertTitle>Included usage is temporarily unavailable</AlertTitle>
        <AlertDescription>
          Your plan remains active. Zenod is not showing a guessed balance while
          the managed usage projection is unavailable.
        </AlertDescription>
      </Alert>
    )
  }

  const title =
    projection.state === "paused"
      ? "Processing paused"
      : projection.state === "warn"
        ? "Approaching this month’s limit"
        : "Plenty available"

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <WalletCardsIcon className="size-5 text-muted-foreground" />
          <Badge
            variant={
              projection.state === "paused" ? "destructive" : "secondary"
            }
          >
            {projection.state}
          </Badge>
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {projection.percent}% of included usage used this month.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Included usage"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={projection.percent}
        >
          <div
            className="h-full bg-primary"
            style={{ width: `${projection.percent}%` }}
          />
        </div>
        {!compact && (
          <p className="text-sm text-muted-foreground">
            Text, answers, images, and voice transcription are included. There
            is no automatic overage billing. Provider, model, token, and cost
            details stay in the owner console.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function HostedChannelsPanel() {
  const [channels, setChannels] = React.useState<HostedChannelsResponse | null>(
    null
  )
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(() => {
    return api<HostedChannelsResponse>("/api/channels")
      .then((result) => {
        setChannels(result)
        setError(null)
      })
      .catch((err: unknown) => setError(errorMessage(err)))
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Channels</h2>
        <p className="text-sm text-muted-foreground">
          Talk to this Zenod memory from WhatsApp and Telegram.
        </p>
      </div>
      {error && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Channels are temporarily unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div>
        {channels === null && !error ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <HostedChannelsConnections
            channels={channels}
            onChanged={setChannels}
          />
        )}
      </div>
    </div>
  )
}

export function ZenodOverview({
  edition,
  overview,
  onNavigate,
}: {
  edition: ZenodEdition
  overview: DashboardOverviewData
  onNavigate: (section: ZenodPortalSection) => void
}) {
  const hosted = edition === "hosted"
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          {hosted ? "Hosted customer" : "Self-hosted operator"}
        </p>
        <h2 className="text-2xl font-semibold">Your Zenod</h2>
        <p className="text-sm text-muted-foreground">
          {overview.tenant.name ?? overview.tenant.id} · one memory through MCP
          and supported channels.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <PlugZapIcon className="size-5 text-muted-foreground" />
            <CardTitle>MCP</CardTitle>
            <CardDescription>
              Your existing Zenod endpoint and token.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => onNavigate("connect")}>
              Open connection
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <FolderGit2Icon className="size-5 text-muted-foreground" />
            <CardTitle>Vault &amp; sources</CardTitle>
            <CardDescription>
              GitHub memory plus optional Google Drive.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => onNavigate("vault")}>
              Open storage
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <MessageCircleIcon className="size-5 text-muted-foreground" />
            <CardTitle>Channels</CardTitle>
            <CardDescription>
              {hosted
                ? "Telegram and included WhatsApp."
                : "Telegram using a bot token you own."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => onNavigate("channels")}>
              Open channels
            </Button>
          </CardContent>
        </Card>
      </div>
      {hosted ? (
        <HostedUsagePanel compact />
      ) : (
        <Card>
          <CardHeader>
            <WalletCardsIcon className="size-5 text-muted-foreground" />
            <CardTitle>Provider usage</CardTitle>
            <CardDescription>
              {overview.usage?.units ?? 0} local usage units recorded. Raw
              diagnostics remain available because you operate the provider.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => onNavigate("usage")}>
              Open usage
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
