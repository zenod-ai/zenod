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
})
