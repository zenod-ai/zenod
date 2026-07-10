import { describe, expect, it } from "vitest"

import {
  DASHBOARD_SECTIONS,
  PUBLIC_LANDING_URL,
  dashboardSectionForTab,
  mcpClientSnippets,
  mcpUrlForToken,
  resolveMcpAccess,
} from "./dashboard-navigation"

describe("Zenod dashboard navigation", () => {
  it("uses a fixed customer-facing section list", () => {
    expect(DASHBOARD_SECTIONS.map(({ id }) => id)).toEqual([
      "connect",
      "vault",
      "usage",
      "settings",
    ])
  })

  it("cannot expose removed product surfaces", () => {
    const labels = DASHBOARD_SECTIONS.map(({ label }) => label.toLowerCase())

    expect(labels).not.toContain("transcription")
    expect(labels).not.toContain("whatsapp")
    expect(labels).not.toContain("telegram")
    expect(labels).not.toContain("ring")

    for (const tab of ["transcription", "whatsapp", "telegram", "ring"]) {
      expect(dashboardSectionForTab(tab)).toBe("connect")
    }
  })

  it("links back to the canonical public landing", () => {
    expect(PUBLIC_LANDING_URL).toBe("https://zenod.dev/")
  })
})

describe("MCP access details", () => {
  it("builds a tokened endpoint on the canonical customer host", () => {
    expect(mcpUrlForToken("acme-token")).toBe(
      "https://cloud.zenod.dev/mcp/acme-token"
    )
  })

  it("builds copyable Claude and Codex tokened-URL commands", () => {
    const snippets = mcpClientSnippets("https://cloud.zenod.dev/mcp/secret")

    expect(snippets.claude).toContain("https://cloud.zenod.dev/mcp/secret")
    expect(snippets.codex).toContain("https://cloud.zenod.dev/mcp/secret")
    expect(snippets.claude).not.toContain("Authorization")
  })

  it("uses the hosted account token instead of the self-host runtime token", () => {
    expect(
      resolveMcpAccess("", {
        token: "hosted-token",
        mcp_url: "https://cloud.zenod.dev/mcp/hosted-token",
      })
    ).toEqual({
      token: "hosted-token",
      url: "https://cloud.zenod.dev/mcp/hosted-token",
    })
  })
})
