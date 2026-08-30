// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ api: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: mocks.api,
}))

import { ZenodOverview } from "./ZenodPortalPanels"

afterEach(() => {
  cleanup()
  mocks.api.mockReset()
})

const overview = {
  tenant: { id: "tenant-1", name: "Memory tenant" },
  usage: { units: 1 },
}

const projection = {
  provider: "google_drive" as const,
  ready: true,
  memory: {
    store: true,
    search: true,
    get: true,
    ask: true,
    attachments: true,
  },
  githubTasking: false,
  blocker: null,
}

describe("Hosted Zenod overview vault authority", () => {
  it("presents a ready Drive vault as authoritative", async () => {
    mocks.api.mockImplementation((path: string) => {
      if (path === "/api/vault/provider") return Promise.resolve(projection)
      if (path === "/api/vault")
        return Promise.resolve({ vaultConfigured: true, repo: null })
      if (path === "/api/customer-usage")
        return Promise.resolve({
          percentageUsed: 0,
          state: "normal",
          resetsAt: null,
        })
      return Promise.reject(new Error(`Unexpected API call: ${path}`))
    })

    render(
      <ZenodOverview
        edition="hosted"
        overview={overview}
        onNavigate={vi.fn()}
      />
    )

    expect(
      await screen.findByText(/Google Drive is the durable authority/i)
    ).not.toBeNull()
    expect(document.body.textContent).not.toMatch(
      /Drive is an optional archive/i
    )
  })

  it("preserves legacy GitHub authority when the projection predates provider binding", async () => {
    mocks.api.mockImplementation((path: string) => {
      if (path === "/api/vault/provider")
        return Promise.resolve({
          ...projection,
          provider: null,
          ready: false,
          blocker: "vault_not_selected",
        })
      if (path === "/api/vault")
        return Promise.resolve({
          vaultConfigured: true,
          repo: "octocat/brain",
        })
      if (path === "/api/customer-usage")
        return Promise.resolve({
          percentageUsed: 0,
          state: "normal",
          resetsAt: null,
        })
      return Promise.reject(new Error(`Unexpected API call: ${path}`))
    })

    render(
      <ZenodOverview
        edition="hosted"
        overview={overview}
        onNavigate={vi.fn()}
      />
    )

    expect(
      await screen.findByText(/GitHub is the durable authority/i)
    ).not.toBeNull()
    expect(document.body.textContent).not.toMatch(
      /Drive is an optional archive/i
    )
  })
})
