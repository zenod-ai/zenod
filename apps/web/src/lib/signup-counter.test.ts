// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://cloud.zenod.dev/app"}
import { afterEach, describe, expect, it, vi } from "vitest"

import { countCompletedSignup, countStep, SIGNUP_COUNTER_URL, stepUrl } from "./signup-counter"

describe("completed sign-up counter (ZAL-A13)", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/")
  })

  it("counts a first sign-in once and removes the marker from the address", () => {
    window.history.replaceState(null, "", "/app?signed_up=1&tab=home#top")
    const ping = vi.fn()
    expect(countCompletedSignup(ping)).toBe(true)
    expect(ping).toHaveBeenCalledWith(SIGNUP_COUNTER_URL)
    expect(ping).toHaveBeenCalledWith("https://signup.alpha9.io/api/public/pv?e=step&h=cloud.zenod.dev&k=signup_sent")
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe("/app?tab=home#top")
    expect(countCompletedSignup(ping)).toBe(false)
    expect(ping).toHaveBeenCalledTimes(2)
  })

  it("asks for the shared counter's sign-up image and nothing about the person", () => {
    expect(SIGNUP_COUNTER_URL).toBe("https://signup.alpha9.io/api/public/pv?h=zenod.dev&e=signup")
  })

  it("tells a sign-up step with its name and this host only (E7-S7)", () => {
    const ping = vi.fn()
    countStep("signin_open", ping)
    expect(ping).toHaveBeenCalledWith("https://signup.alpha9.io/api/public/pv?e=step&h=cloud.zenod.dev&k=signin_open")
    expect(Object.fromEntries(new URL(stepUrl("oauth_google")).searchParams)).toEqual({ e: "step", h: "cloud.zenod.dev", k: "oauth_google" })
  })
})
