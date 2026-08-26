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
import { reconcileHostedChannelOperations } from "@/lib/hosted-channel-operations"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  HostedUsageCard,
  type HostedCustomerUsage,
} from "@/components/hosted-usage-card"
import type { DashboardOverviewData } from "@/views/DashboardOverview"
import type { ZenodEdition, ZenodPortalSection } from "@/views/zenod-edition"

export function HostedUsagePanel({ compact = false }: { compact?: boolean }) {
  const [usage, setUsage] = React.useState<HostedCustomerUsage | null>(null)
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    api<HostedCustomerUsage>("/api/customer-usage")
      .then((result) => {
        if (!cancelled) setUsage(result)
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
  return (
    <HostedUsageCard
      usage={
        usage ?? { percentageUsed: null, state: "unavailable", resetsAt: null }
      }
      compact={compact}
    />
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

  React.useEffect(() => {
    if (channels) reconcileHostedChannelOperations(channels)
  }, [channels])

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
              {hosted
                ? "GitHub is the source; Drive is an optional archive/export destination."
                : "GitHub memory plus optional Google Drive."}
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
