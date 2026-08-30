// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://cloud.zenod.dev/app"}

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ api: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: mocks.api,
}))

vi.mock("@/views/settings/VaultTab", () => ({
  VaultTab: () => <div>Authoritative vault chooser</div>,
}))

vi.mock("@/components/google-drive-connect", () => ({
  GoogleDriveConnect: () => <div>Drive imports and archive</div>,
}))

vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }))

import { App } from "./App"

afterEach(() => {
  cleanup()
  mocks.api.mockReset()
  vi.unstubAllGlobals()
})

describe("Hosted vault onboarding boot", () => {
  it("opens vault selection for a paid Google user whose authoritative vault is not ready", async () => {
    mocks.api.mockImplementation((path: string) => {
      if (path === "/api/auth/status")
        return Promise.resolve({
          needsSetup: false,
          configured: true,
          hostedMode: null,
          customerAuth: true,
          authMethod: "github",
          signInMethods: ["google", "github"],
        })
      if (path === "/api/settings")
        return Promise.resolve({ settings: { provider: "openrouter" } })
      if (path === "/api/overview")
        return Promise.resolve({
          unit: { name: "zenod" },
          tenant: { id: "tenant-1", name: "Ada's memory" },
          usage: null,
        })
      return Promise.reject(new Error(`Unexpected API call: ${path}`))
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input)
        if (path === "/api/me")
          return Response.json({ provider: "google", providers: ["google"] })
        if (path === "/api/console/account")
          return Response.json({ account_id: "account-1" })
        if (path === "/api/vault/provider")
          return Response.json({
            ready: false,
            provider: null,
            blocker: "vault_not_selected",
          })
        throw new Error(`Unexpected fetch: ${path}`)
      })
    )

    render(<App />)

    const vaultTab = await screen.findByRole("tab", { name: "Vault & sources" })
    expect(vaultTab.getAttribute("data-state")).toBe("active")
    expect(screen.getByText("Authoritative vault chooser")).not.toBeNull()
  })
})
