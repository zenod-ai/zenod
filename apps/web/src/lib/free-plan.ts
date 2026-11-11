// EPIC-7 T5: a subscription is free when the server reports a 100% Stripe discount.

export type FreePlanAccount = {
  subscription_status?: string | null
  fully_discounted?: boolean
  free_until?: string | null
  /** EPIC-26 S13: set while a tester's free month is ending or has ended without a month added. */
  end_of_test_offer?: EndOfTestOfferView | null
}

export type EndOfTestOfferView = {
  phase: "before" | "after"
  free_ends_at: string
  pay_url: string
}

export function isFreePlan(account: FreePlanAccount | null): boolean {
  return Boolean(
    account?.fully_discounted && account.subscription_status === "active"
  )
}
