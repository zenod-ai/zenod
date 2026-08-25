import * as React from "react"
import {
  BotIcon,
  FolderGit2Icon,
  MessageCircleIcon,
  PlugZapIcon,
  WalletCardsIcon,
} from "lucide-react"

import { api } from "@/lib/api"
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
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Channels</h2>
        <p className="text-sm text-muted-foreground">
          Every hosted channel reaches this Zenod memory directly.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <MessageCircleIcon className="size-5 text-muted-foreground" />
            <CardTitle className="flex items-center gap-2">
              WhatsApp <Badge variant="outline">Setup required</Badge>
            </CardTitle>
            <CardDescription>
              Included with Zenod Hosted for one verified sender.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Activation status is temporarily unavailable. No device-session,
              QR-pairing, or transport-provider controls are exposed here.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <BotIcon className="size-5 text-muted-foreground" />
            <CardTitle>Telegram</CardTitle>
            <CardDescription>
              Managed access to the same tenant memory.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Connection status is temporarily unavailable. Zenod does not ask
              hosted customers for provider credentials on this screen.
            </p>
          </CardContent>
        </Card>
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
