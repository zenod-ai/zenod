import * as React from "react"

import {
  isFreePlan,
  type FreeMemoriesView,
  type FreePlanAccount,
} from "@/lib/free-plan"

// EPIC-7 T5: copy for any subscription a 100% code makes free. It is keyed on the
// Stripe discount the server reports, never on who the user is: testers are
// ordinary users and only their price differs.

function longDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

// E26-S29: a tester's offer is their first N memories free, with no time limit. Once they are
// used, the month that is running stays free; after it, €9 a month keeps Zenod saving. Nothing
// they saved is lost either way.
function FreeMemoriesNotice({
  memories,
  freeUntil,
  className,
}: {
  memories: FreeMemoriesView
  freeUntil: string | null
  className: string
}) {
  const used = memories.used >= memories.limit
  return (
    <div
      className={`space-y-2 border border-border bg-muted p-3 text-sm ${className}`}
      data-testid="free-memories"
    >
      <p className="font-medium">
        Your first {memories.limit} memories are free. No card.
      </p>
      <p className="text-muted-foreground">
        You have saved {Math.min(memories.used, memories.limit)} of{" "}
        {memories.limit}
        {used
          ? "."
          : `, ${memories.limit - memories.used} left. No time limit.`}
      </p>
      {used ? (
        <p className="text-muted-foreground">
          You have used your free memories.{" "}
          {freeUntil ? `Zenod stays free until ${longDay(freeUntil)}. ` : ""}
          After that, Hosted is €9 a month if you want to keep going.
          Everything you saved stays in your Drive or GitHub.
        </p>
      ) : (
        <p className="text-muted-foreground">
          Nothing is charged unless you choose to pay.
        </p>
      )}
    </div>
  )
}

export function FreePlanNotice({
  freeUntil,
  freeMemories = null,
  className = "",
}: {
  freeUntil: string | null
  freeMemories?: FreeMemoriesView | null
  className?: string
}) {
  if (freeMemories) {
    return (
      <FreeMemoriesNotice
        memories={freeMemories}
        freeUntil={freeUntil}
        className={className}
      />
    )
  }
  return (
    <div
      className={`space-y-2 border border-border bg-muted p-3 text-sm ${className}`}
    >
      <p className="font-medium">Free: your code covers the full price.</p>
      <p className="text-muted-foreground">
        No card or payment details are needed, and you will not be charged.
      </p>
      {freeUntil ? (
        <p className="text-muted-foreground">
          Your free period runs until {longDay(freeUntil)}. It ends then unless we add another month while the test goes on.
          If we do, this date moves. Nothing is charged unless you choose to
          pay.
        </p>
      ) : (
        <p className="text-muted-foreground">It has no end date.</p>
      )}
    </div>
  )
}

export function useFreePlanAccount(): FreePlanAccount | null {
  const [account, setAccount] = React.useState<FreePlanAccount | null>(null)
  React.useEffect(() => {
    let live = true
    void fetch("/api/console/account")
      .then((response) =>
        response.ok ? (response.json() as Promise<FreePlanAccount>) : null
      )
      .then((next) => {
        if (live) setAccount(next)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return account
}

/** The hosted workspace's welcome line: shown only while the subscription is free. */
export function HostedFreePlanBanner() {
  const account = useFreePlanAccount()
  if (!account || !isFreePlan(account)) return null
  return (
    <FreePlanNotice
      freeUntil={account.free_until ?? null}
      freeMemories={account.free_memories ?? null}
    />
  )
}

/** EPIC-22: the plan line next to the name, "Free pass · 18 days left"; nothing when not free. */
export function HostedPlanLine({ now = Date.now() }: { now?: number } = {}) {
  const account = useFreePlanAccount()
  if (!account || !isFreePlan(account)) return null
  const memories = account.free_memories
  if (memories) {
    return (
      <span className="zl-plan" data-testid="plan-line">
        Free · {Math.max(0, memories.limit - memories.used)} of{" "}
        {memories.limit} free memories left
      </span>
    )
  }
  const until = account.free_until ? Date.parse(account.free_until) : NaN
  const days = Number.isNaN(until) ? null : Math.max(0, Math.ceil((until - now) / 86_400_000))
  return (
    <span className="zl-plan" data-testid="plan-line">
      Free pass{days === null ? "" : ` · ${days} ${days === 1 ? "day" : "days"} left`}
    </span>
  )
}
