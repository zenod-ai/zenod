// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ api: vi.fn(), quick: { value: null as unknown } }))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: mocks.api,
}))
vi.mock("@/lib/quick-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/quick-start")>()),
  useQuickStart: () => mocks.quick.value,
}))
vi.mock("qrcode", () => ({ toCanvas: vi.fn(() => Promise.resolve()) }))

import type { HostedChannelsResponse } from "@/lib/api"
import { FIRST_NOTE_EXAMPLE } from "./first-note"
import { WhatsAppOneTap } from "./whatsapp-one-tap"
import { HostedWhatsAppConnect } from "./whatsapp-connect"

// E7-S49: the app's WhatsApp screens suggest the same first note the WhatsApp welcome asks for (PR #1776).
const WELCOME_EXAMPLE = "This week I'm working on..."

function channels(state: HostedChannelsResponse["whatsapp"]["state"]): HostedChannelsResponse {
  return {
    whatsapp: {
      state,
      senderHint: state === "verified" ? "••••3333" : null,
      sharedNumber: "+34 699 000 111",
      verificationExpiresAt: null,
      lastInboundAt: state === "verified" ? Date.now() : null,
      lastReceiptAt: null,
      revision: "wa-1",
    },
    telegram: { state: "off", identityHint: null, verificationExpiresAt: null, revision: "tg-0" },
  }
}

function quickStart(keepDone: boolean) {
  return {
    steps: [
      { id: "whatsapp", done: true, at: null },
      { id: "keep", done: keepDone, at: null },
    ],
    score: 1,
    total: 4,
    helpersOpen: false,
    complete: false,
    hidden: false,
    assistantName: null,
    helperName: null,
  }
}

afterEach(() => {
  cleanup()
  mocks.api.mockReset()
  mocks.quick.value = null
  window.localStorage.clear()
})

describe("E7-S49 suggested first note", () => {
  it("uses the WhatsApp welcome's own example, word for word", () => {
    expect(FIRST_NOTE_EXAMPLE).toBe(WELCOME_EXAMPLE)
  })

  it("on the setup screen, before linking, says what to send once linked", () => {
    render(<WhatsAppOneTap channels={channels("off")} onChanged={vi.fn()} autoStart={false} />)
    const tip = screen.getByTestId("first-note-suggestion")
    expect(tip.getAttribute("data-when")).toBe("before")
    expect(tip.id).toBe("first-note")
    expect(tip.textContent).toContain(WELCOME_EXAMPLE)
    expect(tip.textContent).toContain("Then send your first voice note.")
    expect(screen.getAllByTestId("first-note-suggestion")).toHaveLength(1)
  })

  it("right after linking, asks for the first voice note now", async () => {
    mocks.quick.value = quickStart(false)
    mocks.api.mockResolvedValue(channels("verified"))
    render(<WhatsAppOneTap />)
    await waitFor(() => expect(screen.getByTestId("whatsapp-one-tap").getAttribute("data-state")).toBe("linked"))
    const tip = screen.getByTestId("first-note-suggestion")
    expect(tip.getAttribute("data-when")).toBe("after")
    expect(tip.textContent).toContain("Send your first voice note now.")
    expect(tip.textContent).toContain(WELCOME_EXAMPLE)
  })

  it("steps aside once a first memory is filed, or when it cannot tell", async () => {
    mocks.quick.value = quickStart(true)
    mocks.api.mockResolvedValue(channels("verified"))
    const { unmount } = render(<WhatsAppOneTap />)
    await waitFor(() => expect(screen.getByTestId("whatsapp-one-tap").getAttribute("data-state")).toBe("linked"))
    expect(screen.queryByTestId("first-note-suggestion")).toBeNull()
    unmount()
    mocks.quick.value = null
    render(<WhatsAppOneTap />)
    await waitFor(() => expect(screen.getByTestId("whatsapp-one-tap").getAttribute("data-state")).toBe("linked"))
    expect(screen.queryByTestId("first-note-suggestion")).toBeNull()
  })

  it("in Settings, the WhatsApp card shows the setup suggestion before linking", () => {
    render(<HostedWhatsAppConnect initial={channels("off")} onChanged={vi.fn()} />)
    const tips = screen.getAllByTestId("first-note-suggestion")
    expect(tips).toHaveLength(1)
    expect(tips[0]!.getAttribute("data-when")).toBe("before")
  })

  it("in Settings, the linked WhatsApp card suggests the first note until one is filed", () => {
    mocks.quick.value = quickStart(false)
    const { unmount } = render(<HostedWhatsAppConnect initial={channels("verified")} onChanged={vi.fn()} />)
    const tips = screen.getAllByTestId("first-note-suggestion")
    expect(tips).toHaveLength(1)
    expect(tips[0]!.getAttribute("data-when")).toBe("after")
    expect(tips[0]!.textContent).toContain(WELCOME_EXAMPLE)
    unmount()
    mocks.quick.value = quickStart(true)
    render(<HostedWhatsAppConnect initial={channels("verified")} onChanged={vi.fn()} />)
    expect(screen.queryByTestId("first-note-suggestion")).toBeNull()
  })
})
