import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export type HostedCustomerUsage = {
  percentageUsed: number | null
  state: "normal" | "warn" | "paused" | "unavailable"
  resetsAt: string | null
}

function usageHeading(usage: HostedCustomerUsage): string {
  if (usage.state === "paused") return "Managed processing paused"
  if (usage.state === "warn") return "Nearly used"
  if (usage.state === "unavailable") return "Usage temporarily unavailable"
  return "Plenty available"
}

function resetLabel(value: string | null): string {
  if (!value) return "Reset date unavailable"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "Reset date unavailable"
    : `Resets ${date.toLocaleDateString()}`
}

export function HostedUsageCard({
  usage,
  compact = false,
  productName,
}: {
  usage: HostedCustomerUsage
  compact?: boolean
  productName: string
}) {
  const percentage =
    usage.percentageUsed === null
      ? null
      : Math.min(100, Math.max(0, Math.round(usage.percentageUsed)))

  return (
    <Card className="rounded-none" data-testid="hosted-usage-card">
      <CardHeader>
        <CardTitle>Included usage</CardTitle>
        <CardDescription>{usageHeading(usage)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {percentage === null ? (
          <p className="text-sm text-muted-foreground">
            {productName} cannot verify your included usage right now. New
            managed processing waits safely until usage can be verified.
          </p>
        ) : (
          <>
            <div
              role="progressbar"
              aria-label="Included usage used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percentage}
              className="h-2 overflow-hidden bg-muted"
            >
              <div
                className="h-full bg-primary"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <p className="text-sm font-medium">{percentage}% used</p>
          </>
        )}
        <p className="text-sm text-muted-foreground">
          {resetLabel(usage.resetsAt)}
        </p>
        {usage.state === "paused" && !compact ? (
          <p className="text-sm text-muted-foreground">
            {usage.resetsAt
              ? "Your raw evidence remains safe. Paid AI processing resumes after the reset."
              : "Your raw evidence remains safe. Processing resumes when managed access is restored."}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
