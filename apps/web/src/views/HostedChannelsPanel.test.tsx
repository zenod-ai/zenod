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

import { ApiError, type HostedChannelsResponse } from "@/lib/api"
import {
  hostedChannelOperationKey,
  reconcileHostedChannelOperations,
} from "@/lib/hosted-channel-operations"
import { HostedChannelsPanel } from "./ZenodPortalPanels"

const off: HostedChannelsResponse = {
  whatsapp: {
    state: "off",
    senderHint: null,
    sharedNumber: "+34 699 000 111",
    verificationExpiresAt: null,
    lastInboundAt: null,
    lastReceiptAt: null,
    revision: "wa-off-1",
  },
  telegram: {
    state: "connected",
    identityHint: "@jordi",
    verificationExpiresAt: null,
    revision: "tg-connected-1",
  },
}

afterEach(() => {
  cleanup()
  mocks.api.mockReset()
  window.localStorage.clear()
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
      body: {
        operationId: expect.any(String),
        sender: "+34 611 111 111",
      },
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
    fireEvent.click(screen.getAllByRole("button", { name: "Send test" })[0]!)
    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith("/api/channels/whatsapp/test", {
        method: "POST",
        body: { operationId: expect.any(String) },
      })
    })
    expect(screen.getAllByRole("button", { name: "Disconnect" })).toHaveLength(
      2
    )
    expect(container.textContent).not.toMatch(
      /Reset session|Pair number|Allowed senders|Accept every sender/i
    )
  })

  it("requires confirmation before disconnecting Hosted Telegram", async () => {
    mocks.api.mockImplementation(
      (path: string, request?: { method?: string }) => {
        if (path === "/api/channels" && !request) return Promise.resolve(off)
        return Promise.reject(new Error(`Unexpected API call: ${path}`))
      }
    )
    render(<HostedChannelsPanel />)

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }))
    expect(
      await screen.findByRole("heading", { name: "Disconnect Telegram?" })
    ).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Keep connected" })
    ).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Disconnect Telegram" })
    ).not.toBeNull()
    expect(mocks.api).toHaveBeenCalledTimes(1)
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

  it("recovers awaiting verification after reload without exposing a stored code", async () => {
    const awaiting: HostedChannelsResponse = {
      ...off,
      whatsapp: {
        ...off.whatsapp,
        state: "awaiting_code",
        senderHint: "••••1111",
        verificationExpiresAt: Date.now() + 60_000,
      },
    }
    window.localStorage.setItem(
      "zenod.hosted-channel.operation.whatsapp.challenge",
      "reload-safe-operation"
    )
    mocks.api.mockImplementation(
      (path: string, request?: { method?: string }) => {
        if (path === "/api/channels" && !request)
          return Promise.resolve(awaiting)
        if (path === "/api/channels/whatsapp/challenge") {
          return Promise.resolve({
            channels: awaiting,
            challenge: {
              code: "42-otter",
              sharedNumber: "+34 699 000 111",
              expiresAt: Date.now() + 60_000,
            },
            mutation: {
              operationId: "reload-safe-operation",
              operation: "whatsapp.challenge",
              outcome: "succeeded",
              at: Date.now(),
            },
          })
        }
        return Promise.reject(new Error(`Unexpected API call: ${path}`))
      }
    )
    render(<HostedChannelsPanel />)
    expect(
      await screen.findByText("Verification is still waiting")
    ).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show code again" }))
    expect(await screen.findByText("42-otter")).not.toBeNull()
    expect(mocks.api).toHaveBeenCalledWith("/api/channels/whatsapp/challenge", {
      method: "POST",
      body: { operationId: "reload-safe-operation" },
    })
    expect(
      screen.getByRole("button", { name: "Issue new code" })
    ).not.toBeNull()
    expect(screen.getByRole("button", { name: "Cancel setup" })).not.toBeNull()
  })

  it("preserves a degraded binding instead of rendering a new sender form", async () => {
    const degraded: HostedChannelsResponse = {
      ...off,
      whatsapp: {
        ...off.whatsapp,
        state: "degraded",
        senderHint: "••••1111",
      },
    }
    mocks.api.mockResolvedValue(degraded)
    render(<HostedChannelsPanel />)
    expect(
      await screen.findByText("Your sender is still connected")
    ).not.toBeNull()
    expect(screen.queryByLabelText("Your WhatsApp sender number")).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Create one-time code" })
    ).toBeNull()
  })

  it("connects the Hosted Telegram tenant binding through the existing Channels card", async () => {
    const allOff: HostedChannelsResponse = {
      ...off,
      telegram: {
        state: "off",
        identityHint: null,
        verificationExpiresAt: null,
        revision: "tg-off-1",
      },
    }
    const awaiting: HostedChannelsResponse = {
      ...allOff,
      telegram: {
        state: "awaiting_code",
        identityHint: "@jordi_test",
        verificationExpiresAt: Date.now() + 60_000,
        revision: "tg-awaiting-2",
      },
    }
    mocks.api.mockImplementation(
      (path: string, request?: { method?: string }) => {
        if (path === "/api/channels" && !request) return Promise.resolve(allOff)
        if (path === "/api/channels/telegram/connect") {
          return Promise.resolve({
            channels: awaiting,
            challenge: { code: "42-otter", expiresAt: Date.now() + 60_000 },
            mutation: {
              operationId: "telegram-connect-operation",
              operation: "telegram.connect",
              outcome: "succeeded",
              at: Date.now(),
            },
          })
        }
        return Promise.reject(new Error(`Unexpected API call: ${path}`))
      }
    )
    render(<HostedChannelsPanel />)
    fireEvent.change(
      await screen.findByLabelText("Your Telegram username or chat ID"),
      { target: { value: "@jordi_test" } }
    )
    fireEvent.click(screen.getByRole("button", { name: "Connect Telegram" }))
    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith("/api/channels/telegram/connect", {
        method: "POST",
        body: {
          identity: "@jordi_test",
          operationId: expect.any(String),
        },
      })
    })
    expect(await screen.findByText("42-otter")).not.toBeNull()
    expect(screen.getByText("Pending identity @jordi_test.")).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Show code again" })
    ).not.toBeNull()
    expect(screen.getByRole("button", { name: "Cancel setup" })).not.toBeNull()
  })

  it("rotates the WhatsApp operation after a typed collision before the corrected target", async () => {
    const operationIds: string[] = []
    mocks.api.mockImplementation(
      (path: string, request?: { method?: string; body?: unknown }) => {
        if (path === "/api/channels" && !request) return Promise.resolve(off)
        if (path === "/api/channels/whatsapp/challenge") {
          const body = request?.body as { operationId: string }
          operationIds.push(body.operationId)
          if (operationIds.length === 1) {
            return Promise.reject(
              new ApiError(
                409,
                "That sender is already connected to another Zenod account.",
                "sender_in_use"
              )
            )
          }
          return Promise.resolve({
            channels: {
              ...off,
              whatsapp: {
                ...off.whatsapp,
                state: "awaiting_code",
                senderHint: "••••2222",
                verificationExpiresAt: Date.now() + 60_000,
                revision: "wa-awaiting-corrected",
              },
            },
            challenge: {
              code: "42-otter",
              sharedNumber: "+34 699 000 111",
              expiresAt: Date.now() + 60_000,
            },
            mutation: {
              operationId: body.operationId,
              operation: "whatsapp.challenge",
              outcome: "succeeded",
              at: Date.now(),
            },
          })
        }
        return Promise.reject(new Error(`Unexpected API call: ${path}`))
      }
    )
    render(<HostedChannelsPanel />)
    const input = await screen.findByLabelText("Your WhatsApp sender number")
    fireEvent.change(input, { target: { value: "+34 611 111 111" } })
    fireEvent.click(
      screen.getByRole("button", { name: "Create one-time code" })
    )
    expect(
      await screen.findByText(
        "That sender is already connected to another Zenod account."
      )
    ).not.toBeNull()
    fireEvent.change(input, { target: { value: "+34 622 222 222" } })
    fireEvent.click(
      screen.getByRole("button", { name: "Create one-time code" })
    )
    expect(await screen.findByText("42-otter")).not.toBeNull()
    expect(operationIds).toHaveLength(2)
    expect(operationIds[1]).not.toBe(operationIds[0])
  })

  it("rotates the Telegram operation after a typed collision before the corrected target", async () => {
    const allOff: HostedChannelsResponse = {
      ...off,
      telegram: {
        state: "off",
        identityHint: null,
        verificationExpiresAt: null,
        revision: "tg-off-correction",
      },
    }
    const operationIds: string[] = []
    mocks.api.mockImplementation(
      (path: string, request?: { body?: unknown }) => {
        if (path === "/api/channels" && !request) return Promise.resolve(allOff)
        if (path === "/api/channels/telegram/connect") {
          const body = request?.body as { operationId: string }
          operationIds.push(body.operationId)
          if (operationIds.length === 1) {
            return Promise.reject(
              new ApiError(
                409,
                "That Telegram identity is already connected to another Zenod account.",
                "identity_in_use"
              )
            )
          }
          return Promise.resolve({
            channels: {
              ...allOff,
              telegram: {
                state: "awaiting_code",
                identityHint: "@corrected_owner",
                verificationExpiresAt: Date.now() + 60_000,
                revision: "tg-awaiting-corrected",
              },
            },
            challenge: { code: "55-raven", expiresAt: Date.now() + 60_000 },
            mutation: {
              operationId: body.operationId,
              operation: "telegram.connect",
              outcome: "succeeded",
              at: Date.now(),
            },
          })
        }
        return Promise.reject(new Error(`Unexpected API call: ${path}`))
      }
    )
    render(<HostedChannelsPanel />)
    const input = await screen.findByLabelText(
      "Your Telegram username or chat ID"
    )
    fireEvent.change(input, { target: { value: "@occupied_owner" } })
    fireEvent.click(screen.getByRole("button", { name: "Connect Telegram" }))
    expect(
      await screen.findByText(
        "That Telegram identity is already connected to another Zenod account."
      )
    ).not.toBeNull()
    fireEvent.change(input, { target: { value: "@corrected_owner" } })
    fireEvent.click(screen.getByRole("button", { name: "Connect Telegram" }))
    expect(await screen.findByText("55-raven")).not.toBeNull()
    expect(operationIds).toHaveLength(2)
    expect(operationIds[1]).not.toBe(operationIds[0])
  })

  it("rotates authoritative terminal failures but retains proxy and network-lost WhatsApp keys", async () => {
    const run = async (firstError: Error) => {
      const operationIds: string[] = []
      mocks.api.mockImplementation(
        (path: string, request?: { body?: unknown }) => {
          if (path === "/api/channels" && !request) return Promise.resolve(off)
          if (path === "/api/channels/whatsapp/challenge") {
            const body = request?.body as { operationId: string }
            operationIds.push(body.operationId)
            if (operationIds.length === 1) return Promise.reject(firstError)
            return Promise.resolve({
              channels: {
                ...off,
                whatsapp: {
                  ...off.whatsapp,
                  state: "awaiting_code",
                  senderHint: "••••1111",
                  verificationExpiresAt: Date.now() + 60_000,
                  revision: "wa-awaiting-retry",
                },
              },
              challenge: {
                code: "66-panda",
                sharedNumber: "+34 699 000 111",
                expiresAt: Date.now() + 60_000,
              },
              mutation: {
                operationId: body.operationId,
                operation: "whatsapp.challenge",
                outcome: "succeeded",
                at: Date.now(),
              },
            })
          }
          return Promise.reject(new Error(`Unexpected API call: ${path}`))
        }
      )
      render(<HostedChannelsPanel />)
      fireEvent.change(
        await screen.findByLabelText("Your WhatsApp sender number"),
        { target: { value: "+34 611 111 111" } }
      )
      fireEvent.click(
        screen.getByRole("button", { name: "Create one-time code" })
      )
      expect(await screen.findByText(firstError.message)).not.toBeNull()
      fireEvent.click(
        screen.getByRole("button", { name: "Create one-time code" })
      )
      expect(await screen.findByText("66-panda")).not.toBeNull()
      return operationIds
    }

    const typed = await run(
      new ApiError(
        503,
        "Channels are temporarily unavailable. Try again shortly.",
        "channels_unavailable",
        "retry_new_operation"
      )
    )
    expect(typed[1]).not.toBe(typed[0])

    cleanup()
    mocks.api.mockReset()
    window.localStorage.clear()
    const proxyLost = await run(
      new ApiError(
        503,
        "Channels are temporarily unavailable. Try again shortly.",
        "channels_unavailable",
        "retry_same_operation"
      )
    )
    expect(proxyLost[1]).toBe(proxyLost[0])

    cleanup()
    mocks.api.mockReset()
    window.localStorage.clear()
    const networkLost = await run(new Error("Network response was lost"))
    expect(networkLost[1]).toBe(networkLost[0])
  })

  it("retains the Telegram operation across an ambiguous proxy 503 and replays it", async () => {
    const allOff: HostedChannelsResponse = {
      ...off,
      telegram: {
        state: "off",
        identityHint: null,
        verificationExpiresAt: null,
        revision: "tg-proxy-off",
      },
    }
    const operationIds: string[] = []
    mocks.api.mockImplementation(
      (path: string, request?: { body?: unknown }) => {
        if (path === "/api/channels" && !request) return Promise.resolve(allOff)
        if (path === "/api/channels/telegram/connect") {
          const body = request?.body as { operationId: string }
          operationIds.push(body.operationId)
          if (operationIds.length === 1) {
            return Promise.reject(
              new ApiError(
                503,
                "Channels are temporarily unavailable. Try again shortly.",
                "channels_unavailable",
                "retry_same_operation"
              )
            )
          }
          return Promise.resolve({
            channels: {
              ...allOff,
              telegram: {
                state: "awaiting_code",
                identityHint: "@proxy_owner",
                verificationExpiresAt: Date.now() + 60_000,
                revision: "tg-proxy-awaiting",
              },
            },
            challenge: { code: "77-otter", expiresAt: Date.now() + 60_000 },
            mutation: {
              operationId: body.operationId,
              operation: "telegram.connect",
              outcome: "succeeded",
              at: Date.now(),
            },
          })
        }
        return Promise.reject(new Error(`Unexpected API call: ${path}`))
      }
    )
    render(<HostedChannelsPanel />)
    fireEvent.change(
      await screen.findByLabelText("Your Telegram username or chat ID"),
      { target: { value: "@proxy_owner" } }
    )
    fireEvent.click(screen.getByRole("button", { name: "Connect Telegram" }))
    expect(
      await screen.findByText(
        "Channels are temporarily unavailable. Try again shortly."
      )
    ).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Connect Telegram" }))
    expect(await screen.findByText("77-otter")).not.toBeNull()
    expect(operationIds).toHaveLength(2)
    expect(operationIds[1]).toBe(operationIds[0])
  })

  it("retires stale browser operation keys across both lifecycle directions without phone PII", async () => {
    window.localStorage.setItem(
      "zenod.hosted-channel.operation.whatsapp.sender",
      "+34 611 111 111"
    )
    const disconnect = await hostedChannelOperationKey(
      "whatsapp.disconnect",
      "wa-connected-1"
    )
    reconcileHostedChannelOperations({
      whatsapp: { state: "off", revision: "wa-off-2" },
      telegram: { state: "connected", revision: "tg-connected-1" },
    })
    expect(
      await hostedChannelOperationKey("whatsapp.disconnect", "wa-off-2")
    ).toBe(disconnect)
    reconcileHostedChannelOperations({
      whatsapp: { state: "awaiting_code", revision: "wa-awaiting-3" },
      telegram: { state: "connected", revision: "tg-connected-1" },
    })
    expect(
      await hostedChannelOperationKey("whatsapp.disconnect", "wa-awaiting-3")
    ).not.toBe(disconnect)

    const connect = await hostedChannelOperationKey(
      "telegram.connect",
      "tg-off-1"
    )
    reconcileHostedChannelOperations({
      whatsapp: { state: "awaiting_code", revision: "wa-awaiting-3" },
      telegram: { state: "awaiting_code", revision: "tg-awaiting-2" },
    })
    expect(
      await hostedChannelOperationKey("telegram.connect", "tg-awaiting-2")
    ).toBe(connect)
    reconcileHostedChannelOperations({
      whatsapp: { state: "awaiting_code", revision: "wa-awaiting-3" },
      telegram: { state: "off", revision: "tg-off-3" },
    })
    expect(
      await hostedChannelOperationKey("telegram.connect", "tg-off-3")
    ).not.toBe(connect)
    const firstTarget = await hostedChannelOperationKey(
      "telegram.connect",
      "tg-same-revision",
      "@first_owner",
      true
    )
    const editedTarget = await hostedChannelOperationKey(
      "telegram.connect",
      "tg-same-revision",
      "@second_owner"
    )
    expect(editedTarget).not.toBe(firstTarget)
    const storedValues = Array.from(
      { length: window.localStorage.length },
      (_, index) => window.localStorage.getItem(window.localStorage.key(index)!)
    ).join("\n")
    expect(storedValues).not.toContain("+34 611")
    expect(storedValues).not.toContain("first_owner")
    expect(storedValues).not.toContain("second_owner")
    expect(
      window.localStorage.getItem(
        "zenod.hosted-channel.operation.whatsapp.sender"
      )
    ).toBeNull()
  })
})
