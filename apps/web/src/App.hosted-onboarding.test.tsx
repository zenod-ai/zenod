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
import { ApiError } from "@/lib/api"

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
        if (path === "/api/vault")
          return Response.json({ cloned: false, cloneError: null })
        throw new Error(`Unexpected fetch: ${path}`)
      })
    )

    render(<App />)

    const vaultTab = await screen.findByRole("tab", { name: "Vault & sources" })
    expect(vaultTab.getAttribute("data-state")).toBe("active")
    expect(screen.getByText("Authoritative vault chooser")).not.toBeNull()
  })

  it("returns an expired Hosted session to configured customer sign-in choices", async () => {
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
        return Promise.reject(new ApiError(401, "session expired"))
      return Promise.reject(new Error(`Unexpected API call: ${path}`))
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input)
        if (path === "/api/me")
          return Response.json({ provider: "google", providers: ["google"] })
        if (path === "/api/console/account")
          return Response.json({ account_id: "account-1", vault_repo: null })
        if (path === "/api/vault/provider")
          return Response.json({ ready: false, provider: null })
        if (path === "/api/vault")
          return Response.json({ cloned: false, cloneError: null })
        throw new Error(`Unexpected fetch: ${path}`)
      })
    )

    render(<App />)

    expect(
      await screen.findByRole("link", { name: "Continue with Google" })
    ).not.toBeNull()
    expect(
      screen.getByRole("link", { name: "Continue with GitHub" })
    ).not.toBeNull()
    expect(document.body.textContent).not.toMatch(/admin password/i)
  })

  it.each(["/api/console/account", "/api/vault/provider", "/api/vault"])(
    "returns a customer %s 401 to configured sign-in choices",
    async (unauthorizedPath) => {
      mocks.api.mockImplementation((path: string) => {
        if (path === "/api/auth/status")
          return Promise.resolve({
            needsSetup: false,
            configured: true,
            hostedMode: null,
            customerAuth: true,
            authMethod: "google",
            signInMethods: ["google", "github"],
          })
        return Promise.reject(new Error(`Unexpected API call: ${path}`))
      })
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const path = String(input)
          if (path === unauthorizedPath)
            return Response.json({ error: "unauthorized" }, { status: 401 })
          if (path === "/api/me")
            return Response.json({ provider: "google", providers: ["google"] })
          if (path === "/api/console/account")
            return Response.json({ account_id: "account-1", vault_repo: null })
          if (path === "/api/vault/provider")
            return Response.json({ ready: false, provider: null })
          if (path === "/api/vault")
            return Response.json({ cloned: false, cloneError: null })
          throw new Error(`Unexpected fetch: ${path}`)
        })
      )

      render(<App />)

      expect(
        await screen.findByRole("link", { name: "Continue with Google" })
      ).not.toBeNull()
      expect(
        screen.getByRole("link", { name: "Continue with GitHub" })
      ).not.toBeNull()
    }
  )

  it.each([
    {
      name: "provider-ready while repository verification fails",
      providerResponse: Response.json({
        ready: true,
        provider: "google_drive",
        blocker: null,
      }),
      vaultResponse: Response.json({
        cloned: false,
        cloneError: "Drive bundle is corrupt",
      }),
    },
    {
      name: "missing authoritative provider projection",
      providerResponse: Response.json(
        { error: "authority missing" },
        { status: 500 }
      ),
      vaultResponse: Response.json({ cloned: true, cloneError: null }),
    },
  ])(
    "keeps $name in Vault instead of showing a false-ready overview",
    async ({ providerResponse, vaultResponse }) => {
      mocks.api.mockImplementation((path: string) => {
        if (path === "/api/auth/status")
          return Promise.resolve({
            needsSetup: false,
            configured: true,
            hostedMode: null,
            customerAuth: true,
            authMethod: "google",
            signInMethods: ["google"],
          })
        if (path === "/api/settings")
          return Promise.resolve({ settings: { provider: "openrouter" } })
        if (path === "/api/overview")
          return Promise.resolve({
            unit: { name: "zenod" },
            tenant: { id: "tenant-1" },
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
            return Response.json({ account_id: "account-1", vault_repo: null })
          if (path === "/api/vault/provider") return providerResponse.clone()
          if (path === "/api/vault") return vaultResponse.clone()
          throw new Error(`Unexpected fetch: ${path}`)
        })
      )

      render(<App />)

      const vaultTab = await screen.findByRole("tab", {
        name: "Vault & sources",
      })
      expect(vaultTab.getAttribute("data-state")).toBe("active")
      expect(screen.getByText("Authoritative vault chooser")).not.toBeNull()
    }
  )
})
