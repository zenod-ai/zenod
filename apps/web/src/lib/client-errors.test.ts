// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"

import {
  errorClass,
  reportClientError,
  resetClientErrorReports,
} from "@/lib/client-errors"

// EPIC-24 M2: the app tells the server it broke, with the error class and routes only.
describe("client error reports", () => {
  beforeEach(() => resetClientErrorReports())

  it("sends the class, the page and the API route, never a message", () => {
    const bodies: string[] = []
    window.history.replaceState(null, "", "/app/chat")
    reportClientError({ kind: "api", name: "ApiError", api: "/api/chat/stream", status: 502 }, (b) => bodies.push(b))
    expect(JSON.parse(bodies[0]!)).toEqual({
      kind: "api",
      name: "ApiError",
      api: "/api/chat/stream",
      status: 502,
      page: "/app/chat",
    })
  })

  it("sends each distinct failure once and at most 10 per page load", () => {
    const bodies: string[] = []
    const send = (b: string) => bodies.push(b)
    expect(reportClientError({ kind: "error", name: "TypeError" }, send)).toBe(true)
    expect(reportClientError({ kind: "error", name: "TypeError" }, send)).toBe(false)
    for (let i = 0; i < 20; i++) reportClientError({ kind: "api", api: "/api/x", status: 500 + i }, send)
    expect(bodies).toHaveLength(10)
  })

  it("never reports its own report call", () => {
    expect(reportClientError({ kind: "network", api: "/api/public/client-error" }, () => undefined)).toBe(false)
  })

  it("names what was thrown by class only", () => {
    expect(errorClass(new TypeError("secret words"))).toBe("TypeError")
    expect(errorClass("secret words")).toBe("string")
  })
})
