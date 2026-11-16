// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://zenod.dev/testers?s=P-0301"}
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// E7-S7: public/pv.js asks for the page view from the first HTML, with the fields pageViewUrl tests pin.
describe("first-HTML page view (public/pv.js)", () => {
  it("asks once with the host, page path and campaign, keeps the campaign for the visit, sends nothing else", () => {
    const asked: string[] = []
    const RealImage = window.Image
    // Capture the image the script makes instead of loading it.
    window.Image = class {
      referrerPolicy = ""
      set src(value: string) {
        asked.push(value)
      }
    } as unknown as typeof Image
    try {
      new Function(readFileSync(join(__dirname, "public/pv.js"), "utf8"))()
    } finally {
      window.Image = RealImage
    }
    expect(asked).toHaveLength(1)
    const url = new URL(asked[0]!)
    expect(`${url.origin}${url.pathname}`).toBe("https://signup.alpha9.io/api/public/pv")
    expect(Object.fromEntries(url.searchParams)).toEqual({ h: "zenod.dev", p: "/testers", s: "P-0301" })
    expect(window.sessionStorage.getItem("zenod.campaign")).toBe("P-0301")
  })
})
