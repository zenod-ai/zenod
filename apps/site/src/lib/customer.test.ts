import { readFile } from "node:fs/promises"
import { describe, expect, it, vi } from "vitest"

import {
  consumePendingHostedTier,
  createHostedCheckout,
  PRICING_OPTIONS,
  readCustomerSession,
  readProductionReadiness,
  SignInRequiredError,
} from "./customer"

describe("customer route contracts", () => {
  it("exposes exactly the approved pricing options", () => {
    expect(PRICING_OPTIONS).toEqual([
      expect.objectContaining({ name: "Self-hosted", price: "Free", tier: null }),
      expect.objectContaining({
        name: "Hosted",
        price: "€9",
        cadence: "per month + VAT",
        tier: "monthly",
      }),
    ])
    expect(JSON.stringify(PRICING_OPTIONS)).not.toMatch(/€5|€50|yearly|annual|OpenRouter|token|dollar/i)
    expect(JSON.stringify(PRICING_OPTIONS)).toMatch(/managed AI usage and WhatsApp included/i)
  })

  it("consumes only the monthly pending checkout and discards stale yearly state", () => {
    const pending = new Map<string, string>([["checkout", "yearly"]])
    const storage = {
      getItem: (key: string) => pending.get(key) ?? null,
      removeItem: (key: string) => pending.delete(key),
    }
    expect(consumePendingHostedTier(storage, "checkout")).toBeNull()
    expect(pending.has("checkout")).toBe(false)

    pending.set("checkout", "monthly")
    expect(consumePendingHostedTier(storage, "checkout")).toBe("monthly")
    expect(pending.has("checkout")).toBe(false)
  })

  it("treats an unauthorized session response as logged out", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
      }),
    )

    await expect(readCustomerSession(fetcher)).resolves.toBeNull()
  })

  it("maps the cloud customer session contract", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        login: "alex",
        avatar_url: "https://github.com/alex.png",
      }),
    )

    await expect(readCustomerSession(fetcher)).resolves.toEqual({
      login: "alex",
      avatarUrl: "https://github.com/alex.png",
    })
  })

  it("fails paid signup closed unless the server reports every production gate green", async () => {
    const ready = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ ready: true, publicPaidSignup: true }),
    )
    await expect(readProductionReadiness(ready)).resolves.toEqual({
      ready: true,
      publicPaidSignup: true,
    })

    const blocked = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ ready: false, publicPaidSignup: true }, { status: 503 }),
    )
    await expect(readProductionReadiness(blocked)).resolves.toEqual({
      ready: false,
      publicPaidSignup: true,
    })
  })

  it("posts an account-bound paid tier to the checkout route", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ url: "https://checkout.stripe.test/session" }))

    await expect(createHostedCheckout("monthly", fetcher)).resolves.toBe(
      "https://checkout.stripe.test/session",
    )
    expect(fetcher).toHaveBeenCalledWith(
      "/create-checkout-session",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          product: "zenod",
          unit: "zenod",
          tier: "monthly",
        }),
      }),
    )
  })

  it("surfaces the sign-in gate without inventing a second auth flow", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: "sign in before subscribing" }, { status: 401 }))

    await expect(createHostedCheckout("monthly", fetcher)).rejects.toBeInstanceOf(
      SignInRequiredError,
    )
  })

  it("pins the current one-plan Terms and legal version", async () => {
    const terms = await readFile(new URL("../../public/legal/terms.html", import.meta.url), "utf8")
    expect(terms).toContain("Version 2026-08-26")
    expect(terms).toContain("€9 per month plus applicable VAT")
    expect(terms).toContain("managed AI usage and WhatsApp access")
    expect(terms).not.toMatch(/€5|€50|monthly and yearly|annual plan/i)
  })
})
