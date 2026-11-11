// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { EndOfTestOffer, HostedEndOfTestOffer } from "./end-of-test-offer"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("EndOfTestOffer (EPIC-26 S13)", () => {
  it("before the end: what they keep, what €9 gives, one button, nothing charged before the end", () => {
    render(
      <EndOfTestOffer
        offer={{ phase: "before", free_ends_at: "2026-12-03T12:00:00.000Z", pay_url: "/keep-zenod" }}
      />
    )
    const day = new Date("2026-12-03T12:00:00.000Z").toLocaleDateString(undefined, { day: "numeric", month: "long" })
    expect(screen.getByRole("heading").textContent).toBe(`Your free month ends on ${day}.`)
    expect(screen.getByText(/Your notes stay yours/).textContent).toContain("Google Drive or GitHub")
    expect(screen.getByText(/Hosted is €9 a month plus VAT/)).toBeTruthy()
    const button = screen.getByRole("link", { name: "Keep Zenod for €9 a month" })
    expect(button.getAttribute("href")).toBe("/keep-zenod")
    expect(screen.getByText(/If you do not pay, nothing breaks/).textContent).toContain(`Nothing is charged before ${day}.`)
  })

  it("after the end: says it ended and that Zenod is paused", () => {
    render(
      <EndOfTestOffer
        offer={{ phase: "after", free_ends_at: "2026-12-03T12:00:00.000Z", pay_url: "/keep-zenod" }}
      />
    )
    expect(screen.getByRole("heading").textContent).toMatch(/^Your free month ended on/)
    expect(screen.getByText(/Zenod is paused/)).toBeTruthy()
  })

  it("shows nothing unless the server sends an offer", async () => {
    const fetchMock = vi.fn(async () => Response.json({ subscription_status: "active", end_of_test_offer: null }))
    vi.stubGlobal("fetch", fetchMock)
    const { container } = render(<HostedEndOfTestOffer />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.textContent).toBe("")
  })
})
