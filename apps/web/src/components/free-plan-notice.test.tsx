// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HostedFreePlanBanner } from "./free-plan-notice"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubAccount(response: Response) {
  const fetchMock = vi.fn(async () => response)
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

describe("HostedFreePlanBanner (EPIC-7 T5 welcome)", () => {
  it("welcomes a fully discounted subscriber with the no-card, not-charged wording", async () => {
    stubAccount(
      Response.json({
        subscription_status: "active",
        fully_discounted: true,
        free_until: "2026-12-01T12:00:00.000Z",
      })
    )
    render(<HostedFreePlanBanner />)

    expect(
      await screen.findByText("Free: your code covers the full price.")
    ).not.toBeNull()
    expect(document.body.textContent).toMatch(
      /No card or payment details are needed, and you will not be charged/
    )
    expect(document.body.textContent).toMatch(/we extend it month by month/)
  })

  it.each([
    [
      "a paying subscriber",
      Response.json({ subscription_status: "active", fully_discounted: false }),
    ],
    [
      "a past-due subscriber",
      Response.json({
        subscription_status: "past_due",
        fully_discounted: true,
      }),
    ],
    ["no account", Response.json({ error: "no_account" }, { status: 404 })],
  ])("shows nothing for %s", async (_label, response) => {
    const fetchMock = stubAccount(response)
    const { container } = render(<HostedFreePlanBanner />)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/console/account")
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.textContent).toBe("")
  })
})
