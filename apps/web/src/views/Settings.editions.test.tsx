// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://cloud.zenod.dev/app"}

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ api: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: mocks.api,
}))

import type { SettingsValues } from "@/lib/api"
import { Settings } from "./Settings"

afterEach(() => {
  cleanup()
  mocks.api.mockReset()
})

function overview() {
  return {
    unit: { name: "zenod" },
    tenant: { id: "tenant-1", name: "Memory tenant" },
    usage: { units: 12 },
  }
}

describe("Zenod edition portal", () => {
  it("renders only the approved Hosted sections", async () => {
    mocks.api.mockResolvedValue(overview())

    render(
      <Settings
        edition="hosted"
        initialTab="account"
        initialSettings={{ provider: "openrouter" } as SettingsValues}
        onLoggedOut={() => undefined}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Overview" })).not.toBeNull()
    })
    expect(screen.getByRole("tab", { name: "Connect / MCP" })).not.toBeNull()
    expect(screen.getByRole("tab", { name: "Channels" })).not.toBeNull()
    expect(screen.getByRole("tab", { name: "Vault & sources" })).not.toBeNull()
    expect(screen.getByRole("tab", { name: "Usage" })).not.toBeNull()
    expect(screen.getByRole("tab", { name: "Account" })).not.toBeNull()
    expect(screen.queryByRole("tab", { name: "Settings" })).toBeNull()
    expect(
      screen.getByRole("link", { name: "Open account and billing" })
    ).not.toBeNull()
  })

  it("renders self-hosted Settings but no customer Account section", async () => {
    mocks.api.mockResolvedValue(overview())

    render(
      <Settings
        edition="self-hosted"
        initialTab="settings"
        initialSettings={{ provider: "openrouter" } as SettingsValues}
        onLoggedOut={() => undefined}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Settings" })).not.toBeNull()
    })
    expect(screen.queryByRole("tab", { name: "Account" })).toBeNull()
    expect(
      screen.getByRole("heading", { name: "AI configuration" })
    ).not.toBeNull()
    expect(screen.queryByText("Operating rules")).toBeNull()
    expect(screen.queryByText("Installed skills")).toBeNull()
  })
})
