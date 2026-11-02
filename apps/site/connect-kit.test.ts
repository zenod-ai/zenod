import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8")

describe("directory listing kit", () => {
  it("ships outlined icons that need no system font", () => {
    for (const file of ["./public/brand/zenod-icon.svg", "./public/favicon.svg"]) {
      const svg = read(file)
      expect(svg).toContain("<path")
      expect(svg).not.toMatch(/<text|font-family/)
    }
  })

  it("gives /connect its own crawlable title and canonical URL", () => {
    const page = read("./connect.html")
    expect(page).toContain('<link rel="canonical" href="https://zenod.dev/connect" />')
    expect(page).toMatch(/<title>Connect Zenod to Claude, ChatGPT, Cursor, VS Code and Gemini CLI<\/title>/)
    expect(page).toContain("https://cloud.zenod.dev/mcp")
  })
})
