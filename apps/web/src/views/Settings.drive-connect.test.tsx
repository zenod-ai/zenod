// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://cloud.zenod.dev/app"}

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ api: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: mocks.api,
}))

vi.mock("@/views/DashboardOverview", () => ({
  DashboardOverview: () => <div>Overview</div>,
}))

vi.mock("@/components/google-drive-connect", () => ({
  GoogleDriveConnect: () => <div>Google Drive connector</div>,
}))

import type { SettingsValues } from "@/lib/api"
import { Settings } from "./Settings"

afterEach(() => {
  cleanup()
  mocks.api.mockReset()
})

describe("Zenod Connect dashboard", () => {
  it("renders the Google Drive connector for a memory tenant", async () => {
    mocks.api.mockResolvedValue({
      unit: { name: "zenod" },
      tenant: { id: "tenant-1", name: "Memory tenant" },
      usage: { units: 0 },
    })

    render(
      <Settings
        initialSettings={{ provider: "openrouter" } as SettingsValues}
        onLoggedOut={() => undefined}
      />
    )

    await waitFor(() => {
      expect(screen.getByText("Google Drive connector")).not.toBeNull()
    })
  })
})
