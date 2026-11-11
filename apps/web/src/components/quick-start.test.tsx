// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { QuickStartCard, QuickStartPill, QuickStartView } from "./quick-start"
import { resetQuickStartForTests, type QuickStart, type QuickStartStepId } from "@/lib/quick-start"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetQuickStartForTests()
})

const IDS: QuickStartStepId[] = ["whatsapp", "assistant", "keep", "found", "helper"]

function quick(done: QuickStartStepId[], extra: Partial<QuickStart> = {}): QuickStart {
  const helpersOpen = extra.helpersOpen ?? true
  const total = helpersOpen ? 5 : 4
  const score = done.filter((id) => helpersOpen || id !== "helper").length
  return {
    steps: IDS.map((id) => ({ id, done: done.includes(id), at: done.includes(id) ? "2026-11-11T10:00:00.000Z" : null })),
    score,
    total,
    helpersOpen,
    complete: score === total,
    hidden: false,
    assistantName: null,
    helperName: null,
    ...extra,
  } as QuickStart
}

describe("Quick start (EPIC-26 S15)", () => {
  it("a new tester sees 0 of 5 with the first step open and the WhatsApp settings one click away", () => {
    const go = vi.fn()
    render(<QuickStartView quick={quick([])} go={go} onHide={() => undefined} />)
    expect(screen.getByTestId("quick-start-score").textContent).toContain("0 of 5")
    expect(screen.getByText("Five things, and Zenod is yours")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Open WhatsApp settings" }))
    expect(go).toHaveBeenCalledWith({ section: "settings", settings: "channels" })
  })

  it("ticks done steps, marks the next one, and opens it", () => {
    render(<QuickStartView quick={quick(["whatsapp", "assistant"])} go={() => undefined} onHide={() => undefined} />)
    expect(screen.getByTestId("quick-start-score").textContent).toContain("2 of 5")
    const keep = document.querySelector('[data-step="keep"]')!
    expect(keep.className).toContain("next")
    expect(keep.className).toContain("open")
    expect(document.querySelector('[data-step="whatsapp"]')!.className).toContain("done")
  })

  it("while helpers are still building, step 5 is coming soon and the score is out of four", () => {
    render(<QuickStartView quick={quick(["whatsapp"], { helpersOpen: false })} go={() => undefined} onHide={() => undefined} />)
    expect(screen.getByTestId("quick-start-score").textContent).toContain("1 of 4")
    expect(screen.getByText("Four things, and Zenod is yours")).toBeTruthy()
    expect(screen.getByText("Coming soon")).toBeTruthy()
  })

  it("at 5 of 5 it says all set, with the assistant and helper by name", () => {
    render(
      <QuickStartView
        quick={quick(IDS, { assistantName: "Codex", helperName: "Weekly recap" })}
        go={() => undefined}
        onHide={() => undefined}
      />
    )
    expect(screen.getByText("5 of 5. You’re all set.")).toBeTruthy()
    expect(screen.getByText("Codex reads and saves through Zenod")).toBeTruthy()
    expect(screen.getByText("Weekly recap is on")).toBeTruthy()
  })

  it("reads the server's state, shows the header score, and hides on request", async () => {
    let hidden = false
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/console/quick-start/hide") {
        hidden = JSON.parse(String(init?.body)).hidden
        return new Response(JSON.stringify({ hidden }), { status: 200 })
      }
      if (path === "/api/console/quick-start") {
        return new Response(JSON.stringify({ ...quick(["keep"]), hidden }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${path}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    render(
      <>
        <QuickStartPill />
        <QuickStartCard go={() => undefined} />
      </>
    )
    await waitFor(() => expect(screen.getByTestId("quick-start-pill").textContent).toContain("Quick start 1 of 5"))
    fireEvent.click(screen.getByRole("button", { name: "Hide quick start" }))
    await waitFor(() => expect(screen.queryByTestId("quick-start")).toBeNull())
    expect(hidden).toBe(true)
  })
})
