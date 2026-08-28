// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://cloud.zenod.dev/admin"}

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ZenodAdmin } from "./App"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Zenod owner admin", () => {
  it("renders the read-only service and tenant overview without Phylax controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe("/api/admin/overview")
        return Response.json({
          service: {
            status: "ok",
            name: "zenod",
            version: "1.0.0",
            sha: "1234567890abcdef",
          },
          signup: { open: false },
          totals: {
            accounts: 1,
            tenantBound: 1,
            active: 1,
            pastDue: 0,
            paused: 0,
            canceled: 0,
            pending: 0,
          },
          tenants: [
            {
              accountId: "github-42",
              githubLogin: "jordi",
              tenantId: "github-42",
              tier: "monthly",
              subscriptionStatus: "active",
              currentPeriodEnd: "2026-09-01T00:00:00.000Z",
              managedAiStatus: "active",
            },
          ],
          generatedAt: "2026-08-28T00:00:00.000Z",
        })
      })
    )

    render(<ZenodAdmin />)

    expect(
      await screen.findByRole("heading", { name: "Service overview" })
    ).not.toBeNull()
    expect(await screen.findByText("jordi")).not.toBeNull()
    expect(screen.getByText("Closed")).not.toBeNull()
    expect(document.body.textContent).not.toMatch(
      /pair|channel number|phylax admin/i
    )
    expect(document.querySelector("button")).toBeNull()
  })

  it("shows a truthful failure state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("service unavailable")
      })
    )
    render(<ZenodAdmin />)
    expect(await screen.findByText("Cannot load Zenod admin")).not.toBeNull()
  })
})
