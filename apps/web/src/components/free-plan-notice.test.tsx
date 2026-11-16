// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HostedFreePlanBanner, HostedPlanLine } from "./free-plan-notice"

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
    expect(document.body.textContent).toMatch(/unless we add another month/)
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

describe("E26-S29: a tester's free memories", () => {
  it("shows the offer and the count while memories are left", async () => {
    stubAccount(
      Response.json({
        subscription_status: "active",
        fully_discounted: true,
        free_until: "2026-12-01T12:00:00.000Z",
        free_memories: { used: 12, limit: 30 },
      })
    )
    render(<HostedFreePlanBanner />)
    expect(await screen.findByText("Your first 30 memories are free. No card.")).not.toBeNull()
    expect(document.body.textContent).toMatch(/You have saved 12 of 30, 18 left\. No time limit\./)
    expect(document.body.textContent).not.toMatch(/another month/)
  })

  it("at the cap says until when Zenod stays free and that nothing saved is lost", async () => {
    stubAccount(
      Response.json({
        subscription_status: "active",
        fully_discounted: true,
        free_until: "2026-12-01T12:00:00.000Z",
        free_memories: { used: 33, limit: 30 },
      })
    )
    render(<HostedFreePlanBanner />)
    expect(await screen.findByText(/You have used your free memories/)).not.toBeNull()
    expect(document.body.textContent).toMatch(/You have saved 30 of 30\./)
    expect(document.body.textContent).toMatch(/€9 a month if you want to keep going/)
    expect(document.body.textContent).toMatch(/Everything you saved stays in your Drive or GitHub/)
  })

  it("E26-S30: the plan line says how many free memories are left", async () => {
    stubAccount(
      Response.json({
        subscription_status: "active",
        fully_discounted: true,
        free_until: "2026-12-01T12:00:00.000Z",
        free_memories: { used: 12, limit: 30 },
      })
    )
    render(<HostedPlanLine />)
    expect((await screen.findByTestId("plan-line")).textContent).toBe("Free · 18 of 30 free memories left")
  })
})
