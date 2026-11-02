// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { MemoryTreeCard, type MemoryTree, type MemoryTreeNode } from "./memory-tree-card"

afterEach(cleanup)

const row = (id: string) => document.querySelector<HTMLElement>(`[data-node="${id}"]`)!

const page = (
  path: string,
  title: string,
  date: string | null,
  children: MemoryTreeNode[] = [],
  extra: Partial<MemoryTreeNode> = {}
): MemoryTreeNode => ({
  id: path,
  kind: "page",
  memory: "working",
  title,
  path,
  pages: 1 + children.reduce((sum, child) => sum + child.pages, 0),
  latest: date ? { date, title, path } : null,
  url: `https://github.com/acme/brain/blob/main/${path}`,
  children,
  ...extra,
})

const quotes = page("Notes/Barcelona quotes.md", "Barcelona quotes 2023", "2026-10-31")
const clinics = page("Notes/Turkey clinics.md", "Turkey clinics in Istanbul and their price lists for 2026", "2026-11-01", [], { provisional: true })
const hair: MemoryTreeNode = {
  ...page("Projects/Hair transplant.md", "Hair transplant", null, [clinics, quotes]),
  kind: "root",
  summary: "Deciding on a hair transplant.",
  latest: clinics.latest,
}
const ventures: MemoryTreeNode = {
  ...page("Areas/Ventures.md", "Ventures and work", "2026-09-01"),
  kind: "root",
  memory: "long-term",
  summary: "The businesses over time.",
  url: null,
}
const TREE: MemoryTree = {
  roots: 2,
  placed: 4,
  unplaced: 7,
  groups: [
    { id: "working", kind: "group", memory: "working", title: "Working memory", path: null, pages: 3, latest: clinics.latest, url: null, children: [hair] },
    { id: "long-term", kind: "group", memory: "long-term", title: "Long-term memory", path: null, pages: 1, latest: ventures.latest, url: null, children: [ventures] },
  ],
}

describe("MemoryTreeCard", () => {
  it("opens levels 0–1 with page counts and the latest capture per node", () => {
    render(<MemoryTreeCard state={{ status: "ready", tree: TREE }} />)
    expect(screen.getByTestId("memory-tree-summary").textContent).toBe("2 branches · 4 pages placed · 7 older pages not placed yet")
    const working = row("working")
    expect(working.getAttribute("aria-expanded")).toBe("true")
    const hairRow = row("Projects/Hair transplant.md")
    expect(hairRow.getAttribute("aria-expanded")).toBe("false")
    expect(within(hairRow).getAllByTestId("memory-count")[0]!.textContent).toBe("3 pages")
    const latest = within(hairRow).getAllByTestId("memory-latest")[0]!
    expect(latest.querySelector("time")?.getAttribute("dateTime")).toBe("2026-11-01")
    expect(latest.textContent).toContain("· Turkey clinics in Istanbul and their price list…")
    expect(screen.getByText("Deciding on a hair transplant.")).not.toBeNull()
    expect(row("Areas/Ventures.md")).not.toBeNull()
    // Deeper levels stay folded until asked for.
    expect(screen.queryByText("Barcelona quotes 2023")).toBeNull()
    const dots = screen.getAllByTestId("memory-dot").map((dot) => dot.getAttribute("data-memory"))
    expect(dots).toEqual(["working", "working", "long-term", "long-term"])
  })

  it("expands deeper levels and shows a page's lineage and vault link on click", async () => {
    render(<MemoryTreeCard state={{ status: "ready", tree: TREE }} />)
    await userEvent.click(screen.getByRole("button", { name: "Expand Hair transplant" }))
    expect(screen.getByText("provisional")).not.toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Barcelona quotes 2023" }))
    const detail = screen.getByTestId("memory-node-detail")
    expect(detail.textContent).toContain("Working memory › Hair transplant › Barcelona quotes 2023")
    expect(within(detail).getByRole("link", { name: /Open in your vault/ }).getAttribute("href")).toBe(
      "https://github.com/acme/brain/blob/main/Notes/Barcelona quotes.md"
    )
    // A node without a provider link shows its path instead.
    await userEvent.click(screen.getByRole("button", { name: "Ventures and work" }))
    expect(screen.getByTestId("memory-node-detail").textContent).toContain("Areas/Ventures.md")
    await userEvent.click(screen.getByRole("button", { name: "Collapse" }))
    expect(screen.queryByText("Barcelona quotes 2023")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Expand all" }))
    expect(screen.getByText("Barcelona quotes 2023")).not.toBeNull()
  })

  it("shows the empty state for a vault without a tree, and a soft note when unavailable", () => {
    render(<MemoryTreeCard state={{ status: "empty" }} />)
    expect(screen.getByText("Your memory tree appears as Zenod files your captures.")).not.toBeNull()
    expect(screen.queryByRole("tree")).toBeNull()
    cleanup()
    render(<MemoryTreeCard state={{ status: "unavailable" }} />)
    expect(screen.getByText(/temporarily unavailable/)).not.toBeNull()
  })
})
