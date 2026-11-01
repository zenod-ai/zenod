// EPIC-7 T5: a subscription is free when the server reports a 100% Stripe discount.

export type FreePlanAccount = {
  subscription_status?: string | null
  fully_discounted?: boolean
  free_until?: string | null
}

export function isFreePlan(account: FreePlanAccount | null): boolean {
  return Boolean(
    account?.fully_discounted && account.subscription_status === "active"
  )
}
