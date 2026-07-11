import { describe, expect, it } from "vitest"

import type { Peer } from "./peer-agents-model"
import { ringPeerStatus } from "./ring-control-surface-model"

const peer = (overrides: Partial<Peer> = {}): Peer => ({
  name: "Calli",
  url: "https://calli.example/mcp",
  hasToken: true,
  transportStatus: "connected",
  toolsStatus: "ready",
  toolCount: 1,
  tools: [{ name: "calli__send", mcpName: "send" }],
  skill: null,
  ...overrides,
})

describe("Ring control surface peer status", () => {
  it("does not label or route-test a ready zero-tool catalog as connected", () => {
    expect(ringPeerStatus(peer({ toolCount: 0, tools: [] }), true)).toBe(
      "unhealthy"
    )
  })

  it("requires transport, tools, token, and a usable tool", () => {
    expect(ringPeerStatus(peer(), true)).toBe("connected")
    expect(ringPeerStatus(peer({ transportStatus: "error" }), true)).toBe(
      "unhealthy"
    )
    expect(ringPeerStatus(peer({ toolsStatus: "error" }), true)).toBe(
      "unhealthy"
    )
    expect(ringPeerStatus(peer({ hasToken: false }), true)).toBe(
      "missing-token"
    )
  })

  it("distinguishes enabled disconnected products from disabled products", () => {
    expect(ringPeerStatus(undefined, true)).toBe("disconnected")
    expect(ringPeerStatus(undefined, false)).toBe("disabled")
  })
})
