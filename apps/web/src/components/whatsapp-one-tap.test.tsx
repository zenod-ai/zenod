// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ api: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: mocks.api,
}))
vi.mock("qrcode", () => ({ toCanvas: vi.fn(() => Promise.resolve()) }))

import type { HostedChannelsResponse } from "@/lib/api"
import { WhatsAppOneTap, whatsappLinkUrl } from "./whatsapp-one-tap"

const EXPIRES = Date.now() + 30 * 60_000

function channels(state: HostedChannelsResponse["whatsapp"]["state"], extra: Partial<HostedChannelsResponse["whatsapp"]> = {}): HostedChannelsResponse {
  return {
    whatsapp: {
      state,
      senderHint: null,
      sharedNumber: "+34 699 000 111",
      verificationExpiresAt: null,
      lastInboundAt: null,
      lastReceiptAt: null,
      revision: "wa-1",
      ...extra,
    },
    telegram: { state: "off", identityHint: null, verificationExpiresAt: null, revision: "tg-0" },
  }
}

const challenge = {
  channels: channels("awaiting_code", { verificationExpiresAt: EXPIRES, revision: "wa-2" }),
  challenge: { code: "ZEN-7K3F9QXM", sharedNumber: "+34 699 000 111", expiresAt: EXPIRES },
  mutation: { operationId: "x", operation: "whatsapp.challenge", outcome: "succeeded", at: Date.now() },
}

afterEach(() => {
  cleanup()
  mocks.api.mockReset()
  window.localStorage.clear()
})

describe("E7-S16 one-tap WhatsApp link", () => {
  it("opens a chat with Zenod's number and the code already typed", () => {
    expect(whatsappLinkUrl({ code: "ZEN-7K3F9QXM", sharedNumber: "+34 699 000 111" })).toBe(
      "https://wa.me/34699000111?text=Link%20my%20WhatsApp%20to%20Zenod%3A%20ZEN-7K3F9QXM"
    )
  })

  it("on the first screen makes the link by itself, asking for a code with no number", async () => {
    mocks.api.mockImplementation((path: string, request?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === "/api/channels" && !request) return Promise.resolve(channels("off"))
      if (path === "/api/channels/whatsapp/challenge" && request?.method === "POST") return Promise.resolve(challenge)
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    render(<WhatsAppOneTap />)
    const open = await screen.findByTestId("whatsapp-open-link")
    expect(open.getAttribute("href")).toBe(
      "https://wa.me/34699000111?text=Link%20my%20WhatsApp%20to%20Zenod%3A%20ZEN-7K3F9QXM"
    )
    expect(open.textContent).toContain("Open WhatsApp")
    const post = mocks.api.mock.calls.find(([path]) => path === "/api/channels/whatsapp/challenge")!
    expect(post[1].body).toMatchObject({ link: true })
    expect(post[1].body).not.toHaveProperty("sender")
    expect(screen.getByText(/just press send/)).not.toBeNull()
  })

  it("reuses the link it already made instead of replacing it on the next visit", async () => {
    window.localStorage.setItem(
      "zenod.whatsapp-link",
      JSON.stringify({ code: "ZEN-7K3F9QXM", sharedNumber: "+34 699 000 111", expiresAt: EXPIRES })
    )
    mocks.api.mockImplementation((path: string, request?: unknown) => {
      if (path === "/api/channels" && !request)
        return Promise.resolve(channels("awaiting_code", { verificationExpiresAt: EXPIRES }))
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    render(<WhatsAppOneTap />)
    expect((await screen.findByTestId("whatsapp-open-link")).getAttribute("href")).toContain("ZEN-7K3F9QXM")
    expect(mocks.api.mock.calls.some(([path]) => path === "/api/channels/whatsapp/challenge")).toBe(false)
  })

  it("in Settings makes the link only when tapped", async () => {
    mocks.api.mockImplementation((path: string, request?: { method?: string }) => {
      if (path === "/api/channels/whatsapp/challenge" && request?.method === "POST") return Promise.resolve(challenge)
      return Promise.reject(new Error(`unexpected ${path}`))
    })
    const changed = vi.fn()
    render(<WhatsAppOneTap channels={channels("off")} onChanged={changed} autoStart={false} />)
    expect(mocks.api).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: /Open WhatsApp/ }))
    await waitFor(() => expect(changed).toHaveBeenCalledWith(challenge.channels))
  })

  it("says WhatsApp is linked once the code arrived", async () => {
    mocks.api.mockResolvedValue(channels("verified", { senderHint: "••••3333" }))
    render(<WhatsAppOneTap />)
    await waitFor(() => expect(screen.getByTestId("whatsapp-one-tap").getAttribute("data-state")).toBe("linked"))
    expect(screen.getByText(/answers “Saved”/)).not.toBeNull()
  })
})
