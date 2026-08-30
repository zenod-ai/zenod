import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const page = readFileSync(new URL("./src/App.tsx", import.meta.url), "utf8")
const metadata = readFileSync(new URL("./index.html", import.meta.url), "utf8")

describe("public Zenod offer", () => {
  it("presents both approved editions in metadata and the homepage", () => {
    for (const surface of [metadata, page]) {
      const copy = surface.replace(/\s+/g, " ")
      expect(copy).toMatch(/Self-host (?:Zenod )?free/i)
      expect(copy).toMatch(/AI provider and Telegram/i)
      expect(copy).toMatch(/Zenod Hosted/i)
      expect(copy).toMatch(/€9\/month \+ VAT/i)
      expect(copy).toMatch(/managed AI usage and WhatsApp included/i)
    }
  })

  it("does not expose superseded offers or implementation internals", () => {
    expect(`${metadata}\n${page}`).not.toMatch(
      /€5|€50|yearly|annual|\b(?:Phylax|Ring|OpenRouter)\b|provider cost|token budget/i,
    )
  })

  it("qualifies infrastructure and provider-key ownership by edition", () => {
    const copy = page.replace(/\s+/g, " ")
    expect(copy).toMatch(/Self-hosted runs on your server with your AI provider key/i)
    expect(copy).toMatch(/Hosted manages the service for you/i)
    expect(copy).not.toMatch(/your GitHub account, on your server, with your API keys/i)
  })

  it("describes customer-owned GitHub or Drive storage in public copy and metadata", () => {
    for (const surface of [metadata, page]) {
      const copy = surface.replace(/\s+/g, " ")
      expect(copy).toMatch(/GitHub/i)
      expect(copy).toMatch(/Google Drive|Drive vault/i)
      expect(copy).toMatch(/(?:plain|ordinary) Markdown/i)
    }
  })

  it("keeps sign-in and storage claims provider- and edition-aware", () => {
    const copy = page.replace(/\s+/g, " ")
    expect(page).toContain('GOOGLE_SIGN_IN_PATH')
    expect(page).toContain('aria-label="Sign in with GitHub"')
    expect(copy).toMatch(/Self-hosted uses your GitHub vault; Hosted lets you choose/i)
    expect(copy).toMatch(/Hosted: GitHub or Drive · self-hosted: GitHub/i)
  })
})
