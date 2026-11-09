import * as React from "react"

import { api } from "@/lib/api"
import { usd } from "@/lib/usage"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/** GET /api/console/usage (EPIC-14 S10): this month's AI spend by feature under the limits model. */
export type UsageFeatureId = "filing" | "chat" | "personas" | "desk" | "calls"

export type UsageFeatureView = {
  id: UsageFeatureId
  label: string
  spentUsd: number
  shareUsd: number | null
  stopsAtUsd: number | null
  state: "ok" | "near" | "paused"
  message: string | null
  costs: string
  atCap: string
}

export type UsageView = {
  allowanceUsd: number | null
  spentUsd: number
  percentageUsed: number | null
  resetsAt: string
  reserveUsd: number
  features: UsageFeatureView[]
}

const FEATURE_COLORS: Record<UsageFeatureId, string> = {
  filing: "#1f4d3a",
  chat: "#4f7f6a",
  personas: "#a0703a",
  desk: "#6b6f8f",
  calls: "#b0544a",
}


function limitLine(feature: UsageFeatureView, allowanceUsd: number | null): string {
  const parts: string[] = []
  if (feature.shareUsd !== null) parts.push(`its own ${usd(feature.shareUsd)} a month`)
  if (allowanceUsd !== null && feature.stopsAtUsd !== null) {
    if (feature.id === "filing") parts.push("keeps going past the allowance")
    else if (feature.id === "chat") parts.push(`until the ${usd(allowanceUsd)} allowance is used`)
    else parts.push(`pauses when less than ${usd(allowanceUsd - feature.stopsAtUsd)} is left`)
  }
  return parts.join(", ")
}

const STATE_WORDS: Record<UsageFeatureView["state"], string> = {
  ok: "On",
  near: "Nearly at its limit",
  paused: "Paused",
}

export function UsageByFeatureCard({ usage }: { usage: UsageView }) {
  const allowance = usage.allowanceUsd
  const scale = Math.max(allowance ?? 0, usage.spentUsd, 0.01)
  const resets = new Date(usage.resetsAt)
  return (
    <Card className="rounded-none" data-testid="usage-by-feature">
      <CardHeader>
        <CardTitle>Where your AI allowance goes</CardTitle>
        <CardDescription>
          {allowance !== null
            ? `${usd(usage.spentUsd)} of ${usd(allowance)} used this month`
            : `${usd(usage.spentUsd)} spent this month`}
          {Number.isNaN(resets.getTime())
            ? ""
            : `, resets ${resets.toLocaleDateString(undefined, { day: "numeric", month: "long", timeZone: "UTC" })}`}
          . Your notes are always kept, even when the allowance runs out.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          role="img"
          aria-label={`This month's spend by feature${allowance !== null ? ` against the ${usd(allowance)} allowance` : ""}`}
          className="flex h-3 overflow-hidden bg-muted"
        >
          {usage.features
            .filter((feature) => feature.spentUsd > 0)
            .map((feature) => (
              <div
                key={feature.id}
                title={`${feature.label}: ${usd(feature.spentUsd)}`}
                style={{
                  width: `${Math.min(100, (feature.spentUsd / scale) * 100)}%`,
                  background: FEATURE_COLORS[feature.id],
                }}
              />
            ))}
        </div>
        <ul className="divide-y text-sm">
          {usage.features.map((feature) => (
            <li key={feature.id} className="flex flex-col gap-1 py-3" data-testid={`usage-feature-${feature.id}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  <span
                    aria-hidden
                    className="inline-block size-2.5"
                    style={{ background: FEATURE_COLORS[feature.id] }}
                  />
                  {feature.label}
                </span>
                <span className="tabular-nums">
                  {usd(feature.spentUsd)}
                  <span
                    className={
                      feature.state === "paused"
                        ? "ml-2 text-xs font-semibold text-destructive"
                        : feature.state === "near"
                          ? "ml-2 text-xs font-semibold text-amber-700 dark:text-amber-400"
                          : "ml-2 text-xs text-muted-foreground"
                    }
                  >
                    {STATE_WORDS[feature.state]}
                  </span>
                </span>
              </div>
              {feature.message ? <p className="text-sm">{feature.message}</p> : null}
              <p className="text-muted-foreground">{feature.costs}</p>
              <p className="text-muted-foreground">
                {feature.atCap}
                {limitLine(feature, allowance) ? ` Limit: ${limitLine(feature, allowance)}.` : ""}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export function UsageByFeaturePanel() {
  const [usage, setUsage] = React.useState<UsageView | null>(null)
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    api<UsageView>("/api/console/usage")
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

  if (!loaded) return <Skeleton className="h-64 w-full" />
  if (!usage) return null
  return <UsageByFeatureCard usage={usage} />
}
