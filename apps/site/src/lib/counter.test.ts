import { describe, expect, it } from "vitest"

import { pageViewUrl, signupUrl } from "./counter"

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

describe("alpha9 visits and sign-ups counter (ZAL-A13)", () => {
  it("asks for one page view with the host, path, campaign and referring host only", () => {
    const storage = memoryStorage()
    const url = new URL(
      pageViewUrl({ pathname: "/testers", search: "?s=P-0144&utm=x", hostname: "zenod.dev" }, "https://www.reddit.com/r/x/comments/1?q=secret", storage),
    )
    expect(`${url.origin}${url.pathname}`).toBe("https://signup.alpha9.io/api/public/pv")
    expect(Object.fromEntries(url.searchParams)).toEqual({ h: "zenod.dev", p: "/testers", s: "P-0144", r: "www.reddit.com" })
  })

  it("leaves out its own host as a referrer and keeps the campaign for the sign-up", () => {
    const storage = memoryStorage()
    pageViewUrl({ pathname: "/", search: "?s=P-0145", hostname: "zenod.dev" }, "", storage)
    const next = new URL(pageViewUrl({ pathname: "/pricing", search: "", hostname: "zenod.dev" }, "https://zenod.dev/", storage))
    expect(next.searchParams.get("r")).toBeNull()
    expect(next.searchParams.get("s")).toBe("P-0145")
    expect(Object.fromEntries(new URL(signupUrl(storage)).searchParams)).toEqual({ h: "zenod.dev", e: "signup", s: "P-0145" })
    expect(Object.fromEntries(new URL(signupUrl(null)).searchParams)).toEqual({ h: "zenod.dev", e: "signup" })
  })
})
