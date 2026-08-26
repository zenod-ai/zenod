/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ api: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: mocks.api,
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { GoogleDriveConnect } from "./google-drive-connect"

const driveStatus = {
  configured: false,
  authMode: null,
  clientEmail: null,
  oauthEmail: null,
  oauthClientConfigured: false,
  oauthClientId: null,
  folderId: null,
  archiveConfigured: false,
  archiveReason: null,
  transcriptionProvider: "private/provider-model",
}

afterEach(() => {
  cleanup()
  mocks.api.mockReset()
})

describe("GoogleDriveConnect edition projection", () => {
  it("shows only managed OAuth and folder controls to Hosted customers", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/drive/status") return driveStatus
      throw new Error(`unexpected Hosted request: ${path}`)
    })

    render(<GoogleDriveConnect edition="hosted" />)

    await screen.findByLabelText("Zenod Drive folder ID")
    expect(
      screen.getByRole("button", { name: "Connect with Google" })
    ).not.toBeNull()
    expect(
      screen.getByText(
        /Hosted credentials and managed processing stay private/i
      )
    ).not.toBeNull()

    const copy = document.body.textContent ?? ""
    expect(copy).not.toMatch(
      /OAuth client ID|OAuth client secret|service account|private\/provider-model|whisper\.cpp|large-v3-turbo|API key|per-minute cost/i
    )
    expect(mocks.api).not.toHaveBeenCalledWith("/api/transcription/status")
  })

  it("preserves the existing self-hosted credential and transcription controls", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/drive/status") return driveStatus
      if (path === "/api/transcription/status") {
        return {
          ready: true,
          model: "large-v3-turbo",
          downloading: false,
          error: null,
        }
      }
      throw new Error(`unexpected self-hosted request: ${path}`)
    })

    render(<GoogleDriveConnect edition="self-hosted" />)

    await screen.findByLabelText("OAuth client ID")
    expect(screen.getByLabelText("OAuth client secret")).not.toBeNull()
    expect(screen.getByLabelText("Service account key (JSON)")).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Connect with Google" })
    ).not.toBeNull()
    expect(screen.getByRole("button", { name: "Test" })).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Connect Google Drive" })
    ).not.toBeNull()
    expect(document.body.textContent).toMatch(
      /whisper\.cpp.*no API key.*no per-minute cost/is
    )
    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith("/api/transcription/status")
    })
  })
})
