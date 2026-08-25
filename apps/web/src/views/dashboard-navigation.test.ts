import { describe, expect, it } from "vitest"

import {
  DASHBOARD_SECTIONS,
  PUBLIC_LANDING_URL,
  dashboardSectionsForEdition,
  dashboardSectionForTab,
  mcpClientSnippets,
  mcpUrlForToken,
  resolveMcpAccess,
} from "./dashboard-navigation"

describe("Zenod dashboard navigation", () => {
  it("keeps the legacy alias on the self-hosted customer-facing sections", () => {
    expect(DASHBOARD_SECTIONS.map(({ id }) => id)).toEqual([
      "overview",
      "connect",
      "channels",
      "vault",
      "usage",
      "settings",
    ])
  })

  it("uses one capability-driven profile for both approved editions", () => {
    expect(dashboardSectionsForEdition("hosted").map(({ id }) => id)).toEqual([
      "overview",
      "connect",
      "channels",
      "vault",
      "usage",
      "account",
    ])
    expect(
      dashboardSectionsForEdition("self-hosted").map(({ id }) => id)
    ).toEqual(["overview", "connect", "channels", "vault", "usage", "settings"])
  })

  it("does not expose product or transport internals as navigation", () => {
    const labels = [
      ...dashboardSectionsForEdition("hosted"),
      ...dashboardSectionsForEdition("self-hosted"),
    ].map(({ label }) => label.toLowerCase())

    expect(labels).not.toContain("transcription")
    expect(labels).not.toContain("whatsapp")
    expect(labels).not.toContain("telegram")
    expect(labels).not.toContain("ring")
    expect(labels).not.toContain("phylax")

    for (const tab of [
      "transcription",
      "whatsapp",
      "telegram",
      "ring",
      "phylax",
    ]) {
      expect(dashboardSectionForTab(tab)).toBe("overview")
    }
  })

  it("cannot deep-link into a section unavailable in the active edition", () => {
    expect(dashboardSectionForTab("settings", "hosted")).toBe("overview")
    expect(dashboardSectionForTab("account", "self-hosted")).toBe("overview")
    expect(dashboardSectionForTab("account", "hosted")).toBe("account")
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

  it("names Ring client snippets for the Ring", () => {
    const snippets = mcpClientSnippets(
      "https://ring.zenod.dev/mcp/token",
      "ring"
    )

    expect(snippets.claude).toContain(
      "http ring https://ring.zenod.dev/mcp/token"
    )
    expect(snippets.codex).toContain(
      "add ring --url https://ring.zenod.dev/mcp/token"
    )
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
