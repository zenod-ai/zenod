import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8")

describe("Callisthenes dashboard contract", () => {
  it("keeps MCP credentials and both client snippets on the dashboard", () => {
    expect(source).toContain("MCP URL")
    expect(source).toContain("Token")
    expect(source).toContain("codex mcp add callisthenes")
    expect(source).toContain("claude mcp add --transport http callisthenes")
  })

  it("ports exactly the three X app inputs and PIN completion", () => {
    expect(source.match(/X_OAUTH_CONSUMER_KEY/g)?.length).toBeGreaterThan(1)
    expect(source.match(/X_OAUTH_CONSUMER_SECRET/g)?.length).toBeGreaterThan(1)
    expect(source.match(/X_BEARER_TOKEN/g)?.length).toBeGreaterThan(1)
    expect(source).toContain("One-time PIN")
    expect(source).toContain("Connected ✓")
  })

  it("is read-only for drafts and receipts with no dashboard approve control", () => {
    expect(source).toContain("Drafts")
    expect(source).toContain("Receipts")
    expect(source).toContain("Approve sends through MCP `approve_send`")
    expect(source).not.toMatch(/>\s*Approve\s*</)
    for (const foreignPanel of ["Vault", "Transcription", "WhatsApp", "Telegram", "Ring"]) {
      expect(source).not.toContain(foreignPanel)
    }
  })
})
