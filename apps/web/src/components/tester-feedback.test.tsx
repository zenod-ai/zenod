// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TesterFeedbackEntry } from "./tester-feedback"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const answer = (body: unknown, ok = true) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body })))

describe("TesterFeedbackEntry (E7-S9)", () => {
  it("shows a tester one entry that opens their own voice feedback link", async () => {
    answer({ url: "https://signup.alpha9.io/api/public/feedback/AbCdEf123456" })
    render(<TesterFeedbackEntry />)
    const link = await screen.findByRole("link", { name: /tell us what you think/i })
    expect(link.getAttribute("href")).toBe("https://signup.alpha9.io/api/public/feedback/AbCdEf123456")
    expect(link.getAttribute("target")).toBe("_blank")
  })

  it("shows a non-tester nothing", async () => {
    answer({ url: null })
    const { container } = render(<TesterFeedbackEntry />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.innerHTML).toBe("")
  })
})
