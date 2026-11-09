// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://cloud.zenod.dev/app"}
import { afterEach, describe, expect, it, vi } from "vitest"

import { countCompletedSignup, SIGNUP_COUNTER_URL } from "./signup-counter"

describe("completed sign-up counter (ZAL-A13)", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/")
  })

  it("counts a first sign-in once and removes the marker from the address", () => {
    window.history.replaceState(null, "", "/app?signed_up=1&tab=home#top")
    const ping = vi.fn()
    expect(countCompletedSignup(ping)).toBe(true)
    expect(ping).toHaveBeenCalledWith(SIGNUP_COUNTER_URL)
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe("/app?tab=home#top")
    expect(countCompletedSignup(ping)).toBe(false)
    expect(ping).toHaveBeenCalledTimes(1)
  })

  it("asks for the shared counter's sign-up image and nothing about the person", () => {
    expect(SIGNUP_COUNTER_URL).toBe("https://signup.alpha9.io/api/public/pv?h=zenod.dev&e=signup")
  })
})
