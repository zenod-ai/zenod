// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: mocks.api,
}))

import { cents, QuickIndexPanel, type QuickIndexPlace } from "./quick-index"

afterEach(cleanup)

const place = (title: string, extra: Partial<QuickIndexPlace> = {}): QuickIndexPlace => ({
  path: `Projects/${title}.md`, title, lineage: [title], summary: `${title} summary`, names: [], pages: 1, memories: 2, week: 0, lastTouched: "2026-10-01", ...extra,
})

describe("QuickIndexPanel (E14-S28)", () => {
  it("shows this week, each place with the names you use, and what it cost", async () => {
    const places = [
      place("Boat", { names: ["the Laia"], lastTouched: "2026-11-05" }),
      place("Moving to Valencia", { names: ["The move", "the flat"], week: 3, memories: 23, lastTouched: "2026-11-08", lineage: ["Home", "Moving to Valencia"] }),
      ...Array.from({ length: 14 }, (_, i) => place(`Quiet ${i}`)),
    ]
    mocks.api.mockResolvedValue({
      status: "ready",
      builtAt: "2026-11-09T12:00:00Z",
      places,
      thisWeek: [{ path: "Projects/Moving to Valencia.md", title: "Moving to Valencia", week: 3, lastTouched: "2026-11-08" }],
      totals: { places: 16, named: 2, names: 3, thisWeek: 1 },
      cost: { todayUsd: 0.0016, perDayUsd: [{ day: "2026-11-09", usd: 0.0016, calls: 4 }], firstBuildUsd: 0.021, calls: 4 },
    })
    render(<QuickIndexPanel />)
    expect(await screen.findByText("What Zenod knows you mean")).toBeTruthy()
    expect(screen.getByTestId("quick-index-week").textContent).toBe("Past 7 days Moving to Valencia")
    const rows = screen.getByTestId("quick-index-places").querySelectorAll("li")
    expect(rows).toHaveLength(12)
    expect(rows[0]!.textContent).toContain("Moving to Valencia")
    expect(rows[0]!.textContent).toMatch(/· Home · also “The move”, “the flat” · 23 notes · last (8 Nov|Nov 8)/)
    expect(rows[1]!.textContent).toContain("“the Laia”")
    expect(screen.getByText(/Keeping it cost 0.16 cent today and 0.16 cent in the past 7 days, 2.1 cents to build/)).toBeTruthy()

    fireEvent.click(screen.getByText("Show all 16 places"))
    expect(screen.getByTestId("quick-index-places").querySelectorAll("li")).toHaveLength(16)
    fireEvent.change(screen.getByLabelText("Find a place or a name"), { target: { value: "laia" } })
    const found = screen.getByTestId("quick-index-places").querySelectorAll("li")
    expect(found).toHaveLength(1)
    expect(found[0]!.textContent).toContain("Boat")
  })

  it("says so when there is nothing yet", async () => {
    mocks.api.mockResolvedValue({ status: "empty" })
    render(<QuickIndexPanel />)
    expect(await screen.findByText(/Zenod builds this once your memory has places/)).toBeTruthy()
  })

  it("writes money as cents", () => {
    expect(cents(0)).toBe("nothing")
    expect(cents(0.00003)).toBe("under 0.01 cent")
    expect(cents(0.003)).toBe("0.30 cent")
    expect(cents(0.0125)).toBe("1.3 cents")
  })
})
