// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryReviewCard, placeTargets } from "./memory-review"
import { MemoryTreeCard, type MemoryTreeNode } from "./memory-tree-card"
import type { PlacementReview } from "@/lib/memory-review"

// EPIC-12 E12-S27: check where Zenod filed things, on the tree: least sure first, Right place,
// Wrong place with where it belongs, Undo.

afterEach(cleanup)

const node = (path: string, title: string, children: MemoryTreeNode[] = [], extra: Partial<MemoryTreeNode> = {}): MemoryTreeNode => ({
  id: path, kind: "page", memory: "working", title, path, pages: 1, latest: null, url: null, children, ...extra,
})
const potatoes = node("Notes/Seed potatoes.md", "Seed potatoes", [], { provisional: true })
const beds = node("Notes/Raised beds.md", "Raised beds")
const garden = node("Projects/Garden.md", "Garden", [beds], { kind: "root" })
const quotes = node("Projects/Hull quotes.md", "Hull quotes")
const boat = node("Projects/Boat repair.md", "Boat repair", [quotes, potatoes], { kind: "root", memory: "long-term" })
const GROUPS: MemoryTreeNode[] = [
  { id: "working", kind: "group", memory: "working", title: "Working memory", path: null, pages: 2, latest: null, url: null, children: [garden] },
  { id: "long-term", kind: "group", memory: "long-term", title: "Long-term memory", path: null, pages: 3, latest: null, url: null, children: [boat] },
]
const REVIEW: PlacementReview = {
  items: [
    { path: "Notes/Seed potatoes.md", title: "Seed potatoes", place: "Long-term › Boat repair › Seed potatoes", confidence: 23, provisional: true, evidenceRef: "Log/2026-11-05.md#^e-555555", date: "2026-11-05" },
    { path: "Projects/Hull quotes.md", title: "Hull quotes", place: "Long-term › Boat repair › Hull quotes", confidence: 81, provisional: false, evidenceRef: "Log/2026-11-06.md#^e-666666", date: "2026-11-06" },
    { path: "Notes/Old one.md", title: "Old one", place: "Working › Garden › Old one", confidence: null, provisional: true, evidenceRef: null, date: null },
  ],
  total: 3, scored: 2, low: 1, checked: { confirmed: 0, moved: 1 },
  recent: [{ id: "c-123456abcdef", ts: "2026-11-09T06:00:00Z", title: "Raised beds", from: "Boat repair", to: "Garden", undone: false }],
}

describe("E12-S27 memory review", () => {
  it("offers every branch and page except the page itself and what hangs below it", () => {
    expect(placeTargets(GROUPS, "Projects/Boat repair.md").map((t) => t.title)).toEqual(["Garden", "Raised beds"])
    // A provisional page is no place to file under.
    expect(placeTargets(GROUPS, "Notes/Raised beds.md").map((t) => t.lineage)).toEqual([
      "Working memory › Garden", "Long-term memory › Boat repair", "Long-term memory › Boat repair › Hull quotes",
    ])
  })

  it("lists the least sure first with its confidence; Right place, Wrong place and Undo call back", async () => {
    const onPlace = vi.fn()
    const onUndo = vi.fn()
    render(<MemoryReviewCard review={REVIEW} groups={GROUPS} busy={false} onPlace={onPlace} onUndo={onUndo} />)
    expect(screen.getByTestId("memory-review-summary").textContent).toBe("3 to check · 1 under 60% sure · 1 older ones Zenod marked unsure · you checked 1, moved 1")
    // Only the unsure ones until you ask for the rest.
    expect(screen.getAllByTestId("review-item").map((item) => within(item).getByTestId("confidence").textContent)).toEqual(["23% sure", "not scored"])
    await userEvent.click(screen.getByRole("button", { name: "Show the 1 Zenod was surer of" }))
    const items = screen.getAllByTestId("review-item")
    expect(items.map((item) => within(item).getByTestId("confidence").textContent)).toEqual(["23% sure", "81% sure", "not scored"])

    await userEvent.click(within(items[1]!).getByRole("button", { name: /Right place/ }))
    expect(onPlace).toHaveBeenLastCalledWith("Projects/Hull quotes.md", "Hull quotes", null)

    await userEvent.click(within(items[0]!).getByRole("button", { name: /Wrong place/ }))
    const picker = screen.getByTestId("move-picker")
    await userEvent.type(within(picker).getByRole("textbox"), "gard")
    expect(within(picker).getAllByRole("button").map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Garden")]))
    await userEvent.click(within(picker).getAllByRole("button")[0]!)
    expect(onPlace).toHaveBeenLastCalledWith("Notes/Seed potatoes.md", "Seed potatoes", { path: "Projects/Garden.md", title: "Garden", lineage: "Working memory › Garden" })

    await userEvent.click(screen.getByRole("button", { name: /Undo/ }))
    expect(onUndo).toHaveBeenCalledWith("c-123456abcdef")
  })

  it("on the tree, an opened page says Wrong place and a provisional one also Right place", async () => {
    const onPlace = vi.fn()
    render(<MemoryTreeCard state={{ status: "ready", tree: { groups: GROUPS, roots: 2, placed: 5, unplaced: 0 } }} onPlace={onPlace} />)
    await userEvent.click(screen.getByRole("button", { name: "Expand Boat repair" }))
    await userEvent.click(screen.getByRole("button", { name: "Seed potatoes" }))
    await userEvent.click(screen.getByRole("button", { name: /Right place/ }))
    expect(onPlace).toHaveBeenLastCalledWith("Notes/Seed potatoes.md", "Seed potatoes", null)
    await userEvent.click(screen.getByRole("button", { name: /Wrong place/ }))
    await userEvent.type(within(screen.getByTestId("move-picker")).getByRole("textbox"), "raised{Enter}")
    expect(onPlace).toHaveBeenLastCalledWith("Notes/Seed potatoes.md", "Seed potatoes", { path: "Notes/Raised beds.md", title: "Raised beds", lineage: "Working memory › Garden › Raised beds" })
  })
})
