// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://cloud.zenod.dev/app/account"}

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HostedAccount } from "./HostedAccount"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const me = {
  login: "octocat",
  display_name: "Octocat",
  avatar_url: "https://github.com/octocat.png",
  provider: "github",
  providers: ["github"],
}

const unselectedVault = {
  provider: null,
  ready: false,
  memory: {
    store: false,
    search: false,
    get: false,
    ask: false,
    attachments: false,
  },
  githubTasking: false,
  blocker: "vault_not_selected",
}

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
    expect(document.body.textContent).toMatch(/GitHub is not required/i)
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
            vault: unselectedVault,
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
    expect(
      screen
        .getByRole("link", { name: "Finish vault setup" })
        .getAttribute("href")
    ).toBe("/app#vault")
  })

  it("presents a Google-only Drive vault without GitHub account assumptions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input)
        if (path === "/api/me")
          return Response.json({
            login: "Ada",
            display_name: "Ada",
            avatar_url: null,
            provider: "google",
            providers: ["google"],
          })
        if (path === "/api/console/account")
          return Response.json({
            account_id: "user-ada",
            tier: "monthly",
            subscription_status: "active",
            cancel_at_period_end: false,
            current_period_end: null,
            mcp_url: "https://cloud.zenod.dev/mcp/token",
            token: "token",
            token_hint: "oken",
            vault_repo: null,
            vault_repo_url: null,
            vault: {
              ...unselectedVault,
              provider: "google_drive",
              ready: true,
              memory: {
                store: true,
                search: true,
                get: true,
                ask: true,
                attachments: true,
              },
              blocker: null,
            },
            usage: { percentageUsed: 10, state: "normal", resetsAt: null },
          })
        throw new Error(`Unexpected request: ${path}`)
      })
    )

    render(<HostedAccount />)

    expect(await screen.findByText(/signed in with Google/i)).not.toBeNull()
    expect(
      screen.getByText(/Google Drive is the durable authority/i)
    ).not.toBeNull()
    expect(
      screen.getByRole("link", { name: /Open Google Drive/i })
    ).not.toBeNull()
    expect(document.body.textContent).not.toMatch(
      /Connect a repository|bound to this GitHub account/i
    )
  })
})
