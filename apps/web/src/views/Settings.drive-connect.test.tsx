// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://cloud.zenod.dev/app"}

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ api: vi.fn(), drive: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: mocks.api,
}))

vi.mock("@/views/DashboardOverview", () => ({
  DashboardOverview: () => <div>Overview</div>,
}))

vi.mock("@/components/google-drive-connect", () => ({
  GoogleDriveConnect: (props: { edition?: string }) => {
    mocks.drive(props)
    return <div>Google Drive connector</div>
  },
}))

vi.mock("@/views/settings/VaultTab", () => ({
  VaultTab: () => <div>Vault status</div>,
}))

import type { SettingsValues } from "@/lib/api"
import { Settings } from "./Settings"

afterEach(() => {
  cleanup()
  mocks.api.mockReset()
  mocks.drive.mockReset()
})

describe("Zenod vault and sources", () => {
  it("renders the existing Google Drive connector under Vault and sources", async () => {
    mocks.api.mockResolvedValue({
      unit: { name: "zenod" },
      tenant: { id: "tenant-1", name: "Memory tenant" },
      usage: { units: 0 },
    })

    render(
      <Settings
        initialSettings={{ provider: "openrouter" } as SettingsValues}
        initialTab="vault"
        onLoggedOut={() => undefined}
      />
    )

    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: /Vault & sources/ })
      ).not.toBeNull()
    })

    expect(screen.getByText("Google Drive connector")).not.toBeNull()
    expect(mocks.drive).toHaveBeenCalledWith({ edition: "self-hosted" })
  })

  it("passes the Hosted edition into the existing Drive connector", async () => {
    mocks.api.mockResolvedValue({
      unit: { name: "zenod" },
      tenant: { id: "tenant-1", name: "Memory tenant" },
      usage: null,
    })

    render(
      <Settings
        initialSettings={{ provider: "openrouter" } as SettingsValues}
        initialTab="vault"
        edition="hosted"
        onLoggedOut={() => undefined}
      />
    )

    await waitFor(() => {
      expect(mocks.drive).toHaveBeenCalledWith({ edition: "hosted" })
    })
  })
})
