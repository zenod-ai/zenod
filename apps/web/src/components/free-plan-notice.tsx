import * as React from "react"

import { isFreePlan, type FreePlanAccount } from "@/lib/free-plan"

// EPIC-7 T5: copy for any subscription a 100% code makes free. It is keyed on the
// Stripe discount the server reports, never on who the user is: testers are
// ordinary users and only their price differs.

export function FreePlanNotice({
  freeUntil,
  className = "",
}: {
  freeUntil: string | null
  className?: string
}) {
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
          Your free period runs until{" "}
          {new Date(freeUntil).toLocaleDateString(undefined, {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          . While you're using Zenod and telling us how it goes, we extend it
          month by month. If it ever ends, we'll tell you before your access
          stops, and nothing is charged unless you add a card yourself.
        </p>
      ) : (
        <p className="text-muted-foreground">It has no end date.</p>
      )}
    </div>
  )
}

/** The hosted workspace's welcome line: shown only while the subscription is free. */
export function HostedFreePlanBanner() {
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
  if (!account || !isFreePlan(account)) return null
  return <FreePlanNotice freeUntil={account.free_until ?? null} />
}
