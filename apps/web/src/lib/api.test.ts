import { afterEach, describe, expect, it, vi } from "vitest"

import { api, chatStream } from "./api"

describe("api", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("preserves typed customer-safe channel errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "channels_unavailable",
              message: "WhatsApp is temporarily unavailable. Try again shortly.",
            },
          },
          { status: 503 }
        )
      )
    )

    await expect(api("/api/channels")).rejects.toMatchObject({
      status: 503,
      code: "channels_unavailable",
      message: "WhatsApp is temporarily unavailable. Try again shortly.",
    })
  })
})

describe("chatStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("never emits unverified streamed prose when the authoritative final gate replaces it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            [
              JSON.stringify({ type: "delta", text: "Draft answer." }),
              JSON.stringify({
                type: "done",
                text: "Verified receipt: abc123",
                sources: [],
              }),
              "",
            ].join("\n"),
            { status: 200 }
          )
      )
    )

    let streamed = ""
    let completed = ""
    await chatStream("remember this", {
      onDelta: (text) => {
        streamed += text
      },
      onDone: ({ text }) => {
        completed = text
      },
    })

    expect(streamed).toBe("Verified receipt: abc123")
    expect(completed).toBe("Verified receipt: abc123")
  })

  it("preserves a safe structured stream error without exposing provider internals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `${JSON.stringify({
            type: "error",
            code: "model_budget_exhausted",
            message: "The Council model key reached its provider spending limit. No connected tool ran.",
          })}\n`,
          { status: 200 }
        )
      )
    )

    await expect(
      chatStream("hi", { onDelta: () => {}, onDone: () => {} })
    ).rejects.toMatchObject({
      status: 503,
      code: "model_budget_exhausted",
      message: expect.not.stringContaining("openrouter.ai/workspaces"),
    })
  })
})
