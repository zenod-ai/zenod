export const SIGN_IN_PATH = "/auth/signin"
export const DASHBOARD_URL = "/app"
export const CHECKOUT_PATH = "/create-checkout-session"
export const SELF_HOST_URL =
  "https://github.com/zenod-ai/zenod/blob/main/units/phylax/docker-compose.phylax.yml"

export type PaidTier = "monthly" | "yearly"

export const PRICING_OPTIONS: ReadonlyArray<{
  name: "Self-hosted" | "Monthly" | "Yearly"
  price: string
  cadence: string
  description: string
  tier: PaidTier | null
}> = [
  {
    name: "Self-hosted",
    price: "Free",
    cadence: "forever",
    description: "Run Phylax on your own infrastructure with your own WhatsApp and Telegram channels.",
    tier: null,
  },
  {
    name: "Monthly",
    price: "€5",
    cadence: "per month",
    description: "Hosted Phylax with tenant-scoped channels, transcription, and delivery receipts.",
    tier: "monthly",
  },
  {
    name: "Yearly",
    price: "€50",
    cadence: "per year",
    description: "The same hosted Phylax with two months included in the annual price.",
    tier: "yearly",
  },
]

export interface CustomerSession {
  login: string
  avatarUrl: string | null
}

export class SignInRequiredError extends Error {
  constructor() {
    super("Sign in before subscribing")
    this.name = "SignInRequiredError"
  }
}

export async function readCustomerSession(
  fetcher: typeof fetch = fetch,
): Promise<CustomerSession | null> {
  const response = await fetcher("/api/me", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  })

  if (response.status === 401) return null
  if (!response.ok) throw new Error("Could not read your Phylax session")

  const payload = (await response.json()) as {
    login?: unknown
    avatar_url?: unknown
  }
  if (typeof payload.login !== "string" || payload.login.length === 0) {
    throw new Error("Phylax returned an invalid session")
  }

  return {
    login: payload.login,
    avatarUrl: typeof payload.avatar_url === "string" ? payload.avatar_url : null,
  }
}

export async function createHostedCheckout(
  tier: PaidTier,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher(CHECKOUT_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ product: "phylax", unit: "phylax", tier }),
  })

  if (response.status === 401) throw new SignInRequiredError()
  if (!response.ok) throw new Error("Could not start checkout")

  const payload = (await response.json()) as { url?: unknown }
  if (typeof payload.url !== "string" || payload.url.length === 0) {
    throw new Error("Checkout did not return a destination")
  }

  return payload.url
}
