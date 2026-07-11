import { afterEach, describe, expect, it, vi } from "vitest"

import { chatStream } from "./api"

describe("chatStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("reports the authoritative final text even when streamed deltas contain a draft", async () => {
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

    expect(streamed).toBe("Draft answer.")
    expect(completed).toBe("Verified receipt: abc123")
  })
})
