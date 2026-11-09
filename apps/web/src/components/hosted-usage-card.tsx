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
  breakdown?: {
    ai: {
      spendUsd: number | null
      allowanceUsd: number | null
      percentageUsed: number | null
      paused: boolean
    }
    channel: {
      usedUnits: number
      allowanceUnits: number
      percentageUsed: number
      paused: boolean
    } | null
  }
}

function aiLine(ai: NonNullable<HostedCustomerUsage["breakdown"]>["ai"]): string | null {
  if (ai.paused) return "AI processing: this month's allowance is used up"
  if (ai.percentageUsed === null) return null
  return `AI processing: ${ai.percentageUsed}% of this month's allowance`
}

function channelLine(
  channel: NonNullable<HostedCustomerUsage["breakdown"]>["channel"],
): string | null {
  if (!channel) return null
  if (channel.paused) return "Messages and voice: this month's allowance is used up"
  return `Messages and voice: ${channel.percentageUsed}% of this month's allowance`
}

function usageHeading(usage: HostedCustomerUsage): string {
  // EPIC-14 S10: at the AI allowance only answers stop; notes are still kept and filed.
  if (usage.state === "paused" && usage.breakdown?.ai.paused) return "Answers paused, notes still kept"
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
        {usage.breakdown ? (
          <ul className="space-y-1 text-sm" data-testid="hosted-usage-breakdown">
            {[aiLine(usage.breakdown.ai), channelLine(usage.breakdown.channel)]
              .filter((line): line is string => Boolean(line))
              .map((line) => (
                <li key={line}>{line}</li>
              ))}
          </ul>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {resetLabel(usage.resetsAt)}
        </p>
        {usage.state === "paused" && !compact ? (
          <p className="text-sm text-muted-foreground">
            {usage.breakdown?.ai.paused
              ? "You have used this month's AI allowance, so Zenod stops answering questions until the reset and tells you so in WhatsApp. Everything you send is still kept and filed."
              : usage.resetsAt
                ? "Your raw evidence remains safe. Paid AI processing resumes after the reset."
                : "Your raw evidence remains safe. Processing resumes when managed access is restored."}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
