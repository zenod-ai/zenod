// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://cloud.zenod.dev/app/account"}

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HostedAccount } from "./HostedAccount"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const me = { login: "octocat", avatar_url: "https://github.com/octocat.png" }

describe("Hosted account plan contract", () => {
  it("offers one €9 monthly plan with managed usage and WhatsApp included", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input)
        if (path === "/api/me") return Response.json(me)
        if (path === "/api/console/account")
          return Response.json({ error: "no_account" }, { status: 404 })
        throw new Error(`Unexpected request: ${path}`)
      })
    )

    render(<HostedAccount />)

    expect(
      await screen.findByRole("heading", { name: "Choose your Zenod plan" })
    ).not.toBeNull()
    const subscribe = screen.getByRole("link", {
      name: "Subscribe for €9/month + VAT",
    })
    expect(subscribe.getAttribute("href")).toBe("/buy?tier=monthly")
    expect(
      screen.getByText(/managed AI usage and WhatsApp included/i)
    ).not.toBeNull()
    expect(document.body.textContent).not.toMatch(
      /subscribe yearly|annual plan|€5|€50/i
    )
  })

  it("keeps a historical yearly subscription visible and manageable without offering it anew", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input)
        if (path === "/api/me") return Response.json(me)
        if (path === "/api/console/account") {
          return Response.json({
            account_id: "github-42",
            tier: "yearly",
            subscription_status: "active",
            cancel_at_period_end: false,
            current_period_end: "2027-08-26T00:00:00.000Z",
            mcp_url: null,
            token: null,
            token_hint: null,
            vault_repo: null,
            vault_repo_url: null,
            usage: {
              percentageUsed: 10,
              state: "normal",
              resetsAt: "2026-09-01T00:00:00.000Z",
            },
          })
        }
        throw new Error(`Unexpected request: ${path}`)
      })
    )

    render(<HostedAccount />)

    expect(await screen.findByText("Legacy yearly subscription")).not.toBeNull()
    expect(
      screen.getByRole("button", { name: /Manage billing/i })
    ).not.toBeNull()
    expect(screen.queryByRole("link", { name: /Subscribe yearly/i })).toBeNull()
  })
})
