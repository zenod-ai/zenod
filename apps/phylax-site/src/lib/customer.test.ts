import { describe, expect, it, vi } from "vitest"

import {
  createHostedCheckout,
  PRICING_OPTIONS,
  readCustomerSession,
  SELF_HOST_URL,
  SignInRequiredError,
} from "./customer"

describe("customer route contracts", () => {
  it("exposes exactly the approved pricing options", () => {
    expect(PRICING_OPTIONS.map(({ name }) => name)).toEqual(["Self-hosted", "Monthly", "Yearly"])
  })

  it("sends the Self-hosted click to the full customer unit, never the protected legacy compose", () => {
    expect(SELF_HOST_URL).toBe(
      "https://github.com/zenod-ai/zenod/blob/main/units/phylax/docker-compose.phylax.yml",
    )
    expect(SELF_HOST_URL).not.toMatch(/\/blob\/main\/docker-compose\.phylax\.yml$/)
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

  it("posts an account-bound paid tier to the checkout route", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ url: "https://checkout.stripe.test/session" }))

    await expect(createHostedCheckout("yearly", fetcher)).resolves.toBe(
      "https://checkout.stripe.test/session",
    )
    expect(fetcher).toHaveBeenCalledWith(
      "/create-checkout-session",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          product: "phylax",
          unit: "phylax",
          tier: "yearly",
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
})
