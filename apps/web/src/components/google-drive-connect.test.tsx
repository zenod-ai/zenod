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

const selfHostedDriveStatus = {
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

const hostedDriveStatus = {
  configured: false,
  oauthAvailable: true,
  oauthClientConfigured: false,
  accountEmail: null,
  folderId: null,
  archiveConfigured: false,
  archiveReason: "Add this tenant's Google OAuth client ID and client secret to connect Google Drive.",
}

afterEach(() => {
  cleanup()
  mocks.api.mockReset()
})

describe("GoogleDriveConnect edition projection", () => {
  it("shows tenant-owned OAuth and an automatically managed folder to Hosted customers", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/drive/status") return hostedDriveStatus
      throw new Error(`unexpected Hosted request: ${path}`)
    })

    render(<GoogleDriveConnect edition="hosted" />)

    await screen.findByRole("button", { name: "Connect with Google" })
    expect(
      screen.getByRole("button", { name: "Connect with Google" })
    ).not.toBeNull()
    expect(
      screen.getByText(
        /creates or recovers one private archive folder automatically/i
      )
    ).not.toBeNull()
    expect(screen.queryByLabelText("Zenod Drive folder ID")).toBeNull()
    expect(document.body.textContent).toMatch(
      /does not use Google Drive as an inbox or memory source/i
    )
    expect(document.body.textContent).toMatch(/There is no folder to select/i)
    expect(screen.getByLabelText("OAuth client ID")).not.toBeNull()
    expect(screen.getByLabelText("OAuth client secret")).not.toBeNull()
    expect(document.body.textContent).toMatch(/Stored only for this Zenod tenant/i)

    const copy = document.body.textContent ?? ""
    expect(copy).not.toMatch(
      /service account|private\/provider-model|whisper\.cpp|large-v3-turbo|per-minute cost|list or transcribe/i
    )
    expect(mocks.api).not.toHaveBeenCalledWith("/api/transcription/status")
  })

  it("shows truthful tenant health without exposing internal settings", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/drive/status") {
        return {
          ...hostedDriveStatus,
          oauthAvailable: false,
          archiveReason: "Google Drive connection is unavailable.",
          oauthClientId: "must-never-render",
          clientEmail: "internal-service-account@example.invalid",
          transcriptionProvider: "private/provider-model",
        }
      }
      throw new Error(`unexpected Hosted request: ${path}`)
    })

    render(<GoogleDriveConnect edition="hosted" />)

    const connect = await screen.findByRole("button", {
      name: "Connect with Google",
    })
    expect(connect.hasAttribute("disabled")).toBe(true)
    expect(screen.getByLabelText("OAuth client ID")).not.toBeNull()
    expect(screen.getByLabelText("OAuth client secret")).not.toBeNull()
    expect(document.body.textContent).not.toMatch(/operator/i)
    expect(document.body.textContent).toMatch(/Google Drive connection is unavailable for this tenant/i)
    expect(document.body.textContent).not.toMatch(
      /must-never-render|internal-service-account|private\/provider-model/i
    )
  })

  it("shows only a saved-secret placeholder for an existing tenant OAuth pair", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/drive/status") {
        return {
          ...hostedDriveStatus,
          oauthAvailable: true,
          oauthClientConfigured: true,
          oauthClientId: "must-never-render",
          oauthClientSecret: "must-never-render-secret",
        }
      }
      throw new Error(`unexpected Hosted request: ${path}`)
    })

    render(<GoogleDriveConnect edition="hosted" />)

    const secret = await screen.findByLabelText("OAuth client secret")
    expect(secret.getAttribute("placeholder")).toBe("saved; leave blank to keep it")
    expect((secret as HTMLInputElement).value).toBe("")
    expect(document.body.textContent).not.toMatch(/must-never-render/i)
  })

  it("preserves the existing self-hosted credential and transcription controls", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/drive/status") return selfHostedDriveStatus
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
