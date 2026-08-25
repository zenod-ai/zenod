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

import type { HostedChannelsResponse } from "@/lib/api"
import { HostedChannelsPanel } from "./ZenodPortalPanels"

const off: HostedChannelsResponse = {
  whatsapp: {
    state: "off",
    senderHint: null,
    sharedNumber: "+34 699 000 111",
    verificationExpiresAt: null,
    lastInboundAt: null,
    lastReceiptAt: null,
  },
  telegram: { state: "connected", identityHint: "@jordi" },
}

afterEach(() => {
  cleanup()
  mocks.api.mockReset()
})

describe("Hosted Zenod channels", () => {
  it("starts one-sender WhatsApp verification with Zenod-only copy", async () => {
    mocks.api.mockImplementation(
      (path: string, request?: { method?: string }) => {
        if (path === "/api/channels" && !request) return Promise.resolve(off)
        if (
          path === "/api/channels/whatsapp/challenge" &&
          request?.method === "POST"
        ) {
          return Promise.resolve({
            channels: {
              ...off,
              whatsapp: {
                ...off.whatsapp,
                state: "awaiting_code",
                senderHint: "••••1111",
                verificationExpiresAt: Date.now() + 600_000,
              },
            },
            challenge: {
              code: "42-otter",
              sharedNumber: "+34 699 000 111",
              expiresAt: Date.now() + 600_000,
            },
            mutation: {
              operationId: "challenge-1",
              operation: "whatsapp.challenge",
              outcome: "succeeded",
              at: Date.now(),
            },
          })
        }
        return Promise.reject(new Error(`Unexpected API call: ${path}`))
      }
    )

    const { container } = render(<HostedChannelsPanel />)
    expect(
      await screen.findByText(
        "Included with Zenod Hosted for one verified sender."
      )
    ).not.toBeNull()
    expect(screen.getByText("Linked identity @jordi.")).not.toBeNull()
    fireEvent.change(screen.getByLabelText("Your WhatsApp sender number"), {
      target: { value: "+34 611 111 111" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Create one-time code" })
    )
    expect(await screen.findByText("42-otter")).not.toBeNull()
    expect(screen.getByText("+34 699 000 111")).not.toBeNull()
    expect(mocks.api).toHaveBeenCalledWith("/api/channels/whatsapp/challenge", {
      method: "POST",
      body: { sender: "+34 611 111 111" },
    })
    expect(container.textContent).not.toMatch(
      /Phylax|Ring|provider|OpenRouter|downstream|operationId/i
    )
    expect(container.querySelector(".md\\:grid-cols-2")).not.toBeNull()
  })

  it("shows verified test and disconnect controls without exposing transport controls", async () => {
    const verified: HostedChannelsResponse = {
      ...off,
      whatsapp: {
        ...off.whatsapp,
        state: "verified",
        senderHint: "••••1111",
        lastInboundAt: Date.now(),
      },
    }
    mocks.api.mockImplementation(
      (path: string, request?: { method?: string }) => {
        if (path === "/api/channels" && !request)
          return Promise.resolve(verified)
        if (path === "/api/channels/whatsapp/test") {
          return Promise.resolve({
            channels: verified,
            receipt: { deliveredAt: Date.now() },
            mutation: {
              operationId: "test-1",
              operation: "whatsapp.test",
              outcome: "succeeded",
              at: Date.now(),
            },
          })
        }
        return Promise.reject(
          new Error(`Unexpected API call: ${path} ${request?.method}`)
        )
      }
    )

    const { container } = render(<HostedChannelsPanel />)
    expect(await screen.findByText("••••1111")).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Send test" }))
    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith("/api/channels/whatsapp/test", {
        method: "POST",
      })
    })
    expect(screen.getByRole("button", { name: "Disconnect" })).not.toBeNull()
    expect(container.textContent).not.toMatch(
      /Reset session|Pair number|Allowed senders|Accept every sender/i
    )
  })

  it("keeps typed customer-safe errors customer-safe", async () => {
    mocks.api.mockRejectedValue(
      new Error("WhatsApp is temporarily unavailable. Try again shortly.")
    )
    const { container } = render(<HostedChannelsPanel />)
    expect(
      await screen.findByText(
        "WhatsApp is temporarily unavailable. Try again shortly."
      )
    ).not.toBeNull()
    expect(container.textContent).not.toMatch(
      /private-channels|stack|ECONN|token/i
    )
  })
})
