// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ api: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: mocks.api,
}))

import { PhylaxTenantSettings } from "./phylax-tenant-settings"

const settings = {
  phoneNumber: "34600000000",
  verified: true,
  numberId: "primary",
  downstreamUrl: "https://ring.zenod.dev/mcp/tenant",
  downstreamTokenConfigured: true,
  downstreamCredentialStatus: "healthy" as const,
  downstreamCredentialCheckedAt: null,
  transcriptionEnabled: true,
  transcriptionProvider: "local" as "local" | "groq" | "openai" | "openrouter",
  transcriptionModel: null as string | null,
  transcriptionKeyConfigured: false,
  transcriptionKeysConfigured: {
    groq: false,
    openai: false,
    openrouter: false,
  },
  telegramBinding: null,
  notificationPrefs: { whatsapp: true, telegram: false },
}

const options = {
  defaults: {
    local: "base",
    groq: "whisper-large-v3-turbo",
    openai: "whisper-1",
    openrouter: "openai/whisper-large-v3-turbo",
  },
  localModels: [
    { id: "base", label: "Base", note: "Fastest", sizeMb: 142 },
    { id: "small", label: "Small", note: "Balanced", sizeMb: 466 },
  ],
  openrouterModels: [
    {
      id: "openai/gpt-4o-mini-transcribe",
      name: "OpenAI: GPT-4o Mini Transcribe",
      popularityRank: 1,
      costLabel: "$1.25/1M in",
    },
    {
      id: "openai/whisper-large-v3-turbo",
      name: "OpenAI: Whisper Large V3 Turbo",
      popularityRank: 2,
      costLabel: "$0.04/min",
    },
  ],
  openrouterCatalog: { cached: false, fallback: false },
}

function mockApi(overrides: Partial<typeof settings> = {}) {
  const current = { ...settings, ...overrides }
  mocks.api.mockImplementation(
    (path: string, request?: { method?: string; body?: unknown }) => {
      if (path === "/api/phylax/settings" && request?.method === "PUT") {
        return Promise.resolve({
          settings: { ...current, ...(request.body as object) },
        })
      }
      if (path === "/api/phylax/settings") {
        return Promise.resolve({
          settings: current,
          phylaxNumber: "+34000000000",
          mcp: null,
        })
      }
      if (path === "/api/phylax/transcription/options")
        return Promise.resolve(options)
      if (
        path === "/api/phylax/transcription/key" &&
        request?.method === "DELETE"
      ) {
        return Promise.resolve({
          settings: {
            ...current,
            transcriptionEnabled: false,
            transcriptionKeyConfigured: false,
            transcriptionKeysConfigured: {
              ...current.transcriptionKeysConfigured,
              openrouter: false,
            },
          },
        })
      }
      if (path === "/api/phylax/transcription/check") {
        return Promise.resolve({
          ok: true,
          provider: "openrouter",
          model: "openai/whisper-large-v3-turbo",
          message: "openrouter accepted the tenant-scoped key",
        })
      }
      return Promise.reject(new Error(`Unexpected API call: ${path}`))
    }
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  mocks.api.mockReset()
})

describe("Phylax tenant transcription settings", () => {
  it("shows validated local models and the OpenRouter transcription catalog", async () => {
    mockApi()
    render(<PhylaxTenantSettings />)

    const provider = await screen.findByLabelText("Preferred provider")
    expect(
      (screen.getByLabelText("Local Whisper model") as HTMLSelectElement).value
    ).toBe("base")
    expect(
      screen.getByRole("option", { name: /Small — Balanced/ })
    ).not.toBeNull()

    fireEvent.change(provider, { target: { value: "openrouter" } })
    const model = screen.getByLabelText("OpenRouter transcription model")
    expect((model as HTMLSelectElement).value).toBe(
      "openai/whisper-large-v3-turbo"
    )
    expect(
      screen.getByRole("option", {
        name: /GPT-4o Mini Transcribe.*popularity #1/,
      })
    ).not.toBeNull()
    expect(screen.queryByPlaceholderText("Provider default")).toBeNull()
  })

  it("requires a matching cloud key, tests it ephemerally, and saves the selected model", async () => {
    mockApi()
    render(<PhylaxTenantSettings />)

    fireEvent.change(await screen.findByLabelText("Preferred provider"), {
      target: { value: "openrouter" },
    })
    expect(
      (
        screen.getByRole("button", {
          name: "Save settings",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      screen.getByText(
        "Enter the OpenRouter provider key before testing or saving."
      )
    ).not.toBeNull()

    fireEvent.change(screen.getByLabelText("OpenRouter provider key"), {
      target: { value: " sk-or-new " },
    })
    fireEvent.change(screen.getByLabelText("OpenRouter transcription model"), {
      target: { value: "openai/gpt-4o-mini-transcribe" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Test provider" }))
    await screen.findByText("openrouter accepted the tenant-scoped key")
    const checkCall = mocks.api.mock.calls.find(
      ([path]) => path === "/api/phylax/transcription/check"
    )
    expect(checkCall?.[1]?.body).toMatchObject({
      provider: "openrouter",
      model: "openai/gpt-4o-mini-transcribe",
      key: "sk-or-new",
    })

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }))
    await waitFor(() => {
      const saveCall = mocks.api.mock.calls.find(
        ([path, request]) =>
          path === "/api/phylax/settings" && request?.method === "PUT"
      )
      expect(saveCall?.[1]?.body).toMatchObject({
        transcriptionProvider: "openrouter",
        transcriptionModel: "openai/gpt-4o-mini-transcribe",
        transcriptionKey: "sk-or-new",
      })
    })
  })

  it("does not reuse a saved OpenRouter key after switching to Groq", async () => {
    mockApi({
      transcriptionProvider: "openrouter",
      transcriptionModel: "openai/whisper-large-v3-turbo",
      transcriptionKeyConfigured: true,
      transcriptionKeysConfigured: {
        groq: false,
        openai: false,
        openrouter: true,
      },
    })
    render(<PhylaxTenantSettings />)

    const provider = await screen.findByLabelText("Preferred provider")
    expect(
      screen
        .getByLabelText("OpenRouter provider key")
        .getAttribute("placeholder")
    ).toBe("Saved — enter to replace")
    fireEvent.change(provider, { target: { value: "groq" } })
    expect(
      screen.getByLabelText("Groq provider key").getAttribute("placeholder")
    ).toBe("Required")
    expect(
      (
        screen.getByRole("button", {
          name: "Save settings",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      (screen.getByLabelText("groq transcription model") as HTMLInputElement)
        .value
    ).toBe("whisper-large-v3-turbo")
  })

  it("removes a saved provider key and reflects the safe transcription disable", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    mockApi({
      transcriptionProvider: "openrouter",
      transcriptionModel: "openai/whisper-large-v3-turbo",
      transcriptionKeyConfigured: true,
      transcriptionKeysConfigured: {
        groq: false,
        openai: false,
        openrouter: true,
      },
    })
    render(<PhylaxTenantSettings />)

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove saved key" })
    )
    await waitFor(() => {
      expect(
        mocks.api.mock.calls.some(
          ([path, request]) =>
            path === "/api/phylax/transcription/key" &&
            request?.method === "DELETE"
        )
      ).toBe(true)
    })
    expect(
      (screen.getByLabelText("Transcribe voice notes") as HTMLInputElement)
        .checked
    ).toBe(false)
  })
})
