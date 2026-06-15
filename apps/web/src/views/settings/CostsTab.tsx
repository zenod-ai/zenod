import * as React from "react"
import { RefreshCwIcon, TriangleAlertIcon, WalletIcon } from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage, type UsageBucket, type UsageResponse, type UsageSummary } from "@/lib/api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

type Window = "today" | "last7d"

const WINDOW_LABELS: Record<Window, string> = {
  today: "Last 24h",
  last7d: "Last 7 days",
}

/** Friendlier names for the engine's internal operation keys. */
const OPERATION_LABELS: Record<string, string> = {
  classify: "Classify",
  compose: "Compose",
  answer: "Answer",
  work: "Agentic work",
  extractBacklog: "Backlog extract",
}

function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00"
  if (usd < 0.01) return "<$0.01"
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatInt(n: number): string {
  return n.toLocaleString()
}

function operationLabel(key: string): string {
  return OPERATION_LABELS[key] ?? key
}

function StatBlock({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {hint !== undefined && (
        <span className="text-xs text-muted-foreground">{hint}</span>
      )}
    </div>
  )
}

/** A cost breakdown table with a relative bar per row, sorted by cost. */
function Breakdown({
  title,
  description,
  buckets,
  label,
}: {
  title: string
  description: string
  buckets: UsageBucket[]
  label: (key: string) => string
}) {
  const maxCost = buckets.reduce((m, b) => Math.max(m, b.costUsd), 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {buckets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity in this window.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {buckets.map((bucket) => (
              <div key={bucket.key} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium">{label(bucket.key)}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatUsd(bucket.costUsd)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: maxCost > 0 ? `${(bucket.costUsd / maxCost) * 100}%` : "0%" }}
                  />
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatInt(bucket.calls)} {bucket.calls === 1 ? "call" : "calls"} ·{" "}
                  {formatTokens(bucket.inputTokens)} in · {formatTokens(bucket.outputTokens)} out
                  {bucket.cachedInputTokens > 0 && (
                    <> · {formatTokens(bucket.cachedInputTokens)} cached</>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Summary({ summary }: { summary: UsageSummary }) {
  const totalInput =
    summary.inputTokens + summary.cachedInputTokens + summary.cacheCreationInputTokens
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Spend</CardTitle>
          <CardDescription>
            Real provider-billed cost, estimated from token counts at list prices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <StatBlock label="Total cost" value={formatUsd(summary.costUsd)} />
            <StatBlock label="LLM calls" value={formatInt(summary.calls)} />
            <StatBlock
              label="Input"
              value={formatTokens(totalInput)}
              hint={
                summary.cachedInputTokens > 0
                  ? `${formatTokens(summary.cachedInputTokens)} from cache`
                  : "tokens"
              }
            />
            <StatBlock
              label="Output"
              value={formatTokens(summary.outputTokens)}
              hint="tokens"
            />
          </div>
        </CardContent>
      </Card>

      <Breakdown
        title="By operation"
        description="Where the tokens go across the engine's stages."
        buckets={summary.byOperation}
        label={operationLabel}
      />
      <Breakdown
        title="By model"
        description="Cost split across the models in use."
        buckets={summary.byModel}
        label={(key) => key}
      />
    </div>
  )
}

export function CostsTab() {
  const [data, setData] = React.useState<UsageResponse | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [window, setWindow] = React.useState<Window>("last7d")

  React.useEffect(() => {
    let cancelled = false
    api<UsageResponse>("/api/usage")
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleRefresh() {
    setRefreshing(true)
    api<UsageResponse>("/api/usage")
      .then((result) => setData(result))
      .catch((err: unknown) => {
        toast.error("Could not refresh usage", { description: errorMessage(err) })
      })
      .finally(() => setRefreshing(false))
  }

  if (loadError !== null) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Could not load usage</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    )
  }

  if (data === null) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const summary = data[window]
  const hasAnyActivity = data.today.calls > 0 || data.last7d.calls > 0

  if (!hasAnyActivity) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WalletIcon />
          </EmptyMedia>
          <EmptyTitle>No usage yet</EmptyTitle>
          <EmptyDescription>
            Once the engine starts answering and filing, LLM token cost shows up
            here — broken down by operation and model.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-muted p-0.5">
          {(["today", "last7d"] as Window[]).map((value) => (
            <Button
              key={value}
              variant={window === value ? "default" : "ghost"}
              size="sm"
              className={window === value ? "" : "text-muted-foreground"}
              onClick={() => setWindow(value)}
            >
              {WINDOW_LABELS[value]}
            </Button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
          Refresh
        </Button>
      </div>

      <Summary summary={summary} />

      <p className="text-center text-xs text-muted-foreground">
        Cost is estimated from token counts at provider list prices — actual
        invoices may differ. Unknown models are counted but priced at $0.
      </p>
    </div>
  )
}
