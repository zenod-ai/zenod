// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://herald.zenod.dev/app"}

import { cleanup, render, screen } from "@testing-library/react"
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

describe("Settings product identity while overview loads", () => {
  it("holds the Herald shell instead of rendering the generic Zenod dashboard", () => {
    mocks.api.mockReturnValue(new Promise(() => undefined))

    render(
      <Settings
        initialSettings={{ provider: "openrouter" } as SettingsValues}
        onLoggedOut={() => undefined}
      />,
    )

    expect(screen.getByLabelText("Loading Herald")).not.toBeNull()
    expect(screen.getByText("Loading Herald…")).not.toBeNull()
    expect(screen.queryByRole("heading", { name: "Zenod" })).toBeNull()
    expect(screen.queryByRole("tab", { name: "Connect" })).toBeNull()
  })
})
