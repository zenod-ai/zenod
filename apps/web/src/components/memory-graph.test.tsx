// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

import { MemoryGraph } from "@/components/memory-graph"
import {
  graphHash,
  graphPathFromHash,
  layoutGraph,
  lineageAbove,
  type MemoryGraphNode,
  type MemoryGraphView,
} from "@/lib/memory-graph"

// EPIC-12 E12-S2: your memory as a graph. One neighbourhood at a time; open a dot to read it
// and follow its links; the search box jumps to a memory.

const node = (path: string, title: string, relation: string, extra: Record<string, unknown> = {}) => ({
  path, title, summary: "", treePath: "", kind: "page", relation, links: 0, backlinks: 0, children: 0, degree: 1, hidden: 0, ...extra,
}) as MemoryGraphNode

const OVERVIEW: MemoryGraphView & { status: "ready" } = {
  status: "ready",
  center: "Tree.md",
  nodes: [
    node("Tree.md", "Your memory", "center", { kind: "tree", degree: 2 }),
    node("Areas/Garden.md", "Garden", "child", { kind: "root", treePath: "Working memory › Garden", degree: 3, hidden: 1 }),
    node("Areas/Boat.md", "Boat", "child", { kind: "root", treePath: "Working memory › Boat", degree: 1 }),
    node("Notes/Shed.md", "Shed", "hub", { treePath: "Working memory › Garden › Shed", degree: 2 }),
  ],
  edges: [
    { from: "Tree.md", to: "Areas/Garden.md", kind: "tree" },
    { from: "Tree.md", to: "Areas/Boat.md", kind: "tree" },
    { from: "Areas/Garden.md", to: "Notes/Shed.md", kind: "tree" },
  ],
  more: { parent: 0, child: 0, link: 0, backlink: 0 },
  total: { nodes: 2400, edges: 5100 },
}

const SHED: MemoryGraphView & { status: "ready" } = {
  status: "ready",
  center: "Notes/Shed.md",
  nodes: [
    node("Notes/Shed.md", "Shed", "center", { treePath: "Working memory › Garden › Shed", summary: "The cedar shed.", degree: 3 }),
    node("Areas/Garden.md", "Garden", "parent", { kind: "root", treePath: "Working memory › Garden" }),
    node("Notes/Cedar.md", "Cedar boards", "link"),
    node("Notes/Plan.md", "Weekend plan", "backlink"),
  ],
  edges: [
    { from: "Areas/Garden.md", to: "Notes/Shed.md", kind: "tree" },
    { from: "Notes/Shed.md", to: "Notes/Cedar.md", kind: "link" },
    { from: "Notes/Plan.md", to: "Notes/Shed.md", kind: "link" },
  ],
  more: { parent: 0, child: 0, link: 0, backlink: 7 },
  total: { nodes: 2400, edges: 5100 },
}

function mockFetch(handler: (url: string) => { status?: number; body: unknown }) {
  const calls: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url)
      const result = handler(url)
      return new Response(JSON.stringify(result.body), { status: result.status ?? 200 })
    })
  )
  return calls
}

const graphRoutes = (url: string) => {
  if (url === "/api/console/memory-graph") return { body: OVERVIEW }
  if (url === `/api/console/memory-graph?path=${encodeURIComponent("Notes/Shed.md")}`) return { body: SHED }
  if (url.startsWith("/api/console/memory-note")) {
    return { body: { path: "Notes/Shed.md", body: "---\ntitle: Shed\n---\n# Shed\nOrder the [[Cedar|cedar boards]] before Friday.", url: "https://github.com/o/v/blob/main/Notes/Shed.md", provider: "github" } }
  }
  if (url.startsWith("/api/console/memory-search")) {
    return { body: { query: "shed", tier: "index", ms: 3, results: [
      { rank: 1, path: "Notes/Shed.md", title: "Shed", snippet: "cedar", matchPercent: 100, treePath: "Working memory › Garden › Shed", kind: "page" },
      { rank: 2, path: "Log/2026-11-07.md#^e-abc123", title: "Voice note", snippet: "shed", matchPercent: 48, treePath: "", kind: "log" },
    ] } }
  }
  return { status: 404, body: { error: "not_found" } }
}

beforeEach(() => {
  window.history.replaceState(null, "", "/")
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("MemoryGraph (E12-S2)", () => {
  it("opens on the tree and its roots, with the totals of the whole graph", async () => {
    const calls = mockFetch(graphRoutes)
    render(<MemoryGraph />)
    // The tree and its roots are drawn; the busiest pages are listed beside it.
    const graph = await screen.findByRole("group", { name: /Memory graph: 3 memories shown of 2400/ })
    expect(within(graph).getByRole("button", { name: /Garden: 3 connections/ })).toBeTruthy()
    expect(within(graph).queryByRole("button", { name: /Shed/ })).toBeNull()
    // The deck's styling hooks: the opened memory carries the accent, topics are ink dots.
    expect(within(graph).getByRole("button", { name: /Your memory, open/ }).getAttribute("class")).toBe("zp-gnode zp-gcenter zp-gtopic")
    expect(within(graph).getByRole("button", { name: /Garden/ }).getAttribute("class")).toBe("zp-gnode zp-gtopic")
    expect(graph.getAttribute("class")).toBe("zp-g")
    expect(screen.getByText(/3 of 2,400 memories/)).toBeTruthy()
    const panel = screen.getByLabelText("About Your memory")
    expect(panel.textContent).toContain("Your topics")
    expect(panel.textContent).toContain("Most connected")
    // The tree itself is not a note to fetch, and no model is involved.
    expect(calls).toEqual(["/api/console/memory-graph"])
  })

  it("opens a memory: its neighbourhood, where it sits, what it says, and its links to follow", async () => {
    mockFetch(graphRoutes)
    render(<MemoryGraph />)
    await screen.findByRole("group", { name: /Memory graph/ })
    fireEvent.click(within(screen.getByLabelText("About Your memory")).getByRole("button", { name: "Shed" }))
    await screen.findByRole("group", { name: /Memory graph: 4 memories shown/ })
    expect(window.location.hash).toBe(graphHash("Notes/Shed.md"))
    const panel = await screen.findByLabelText("About Shed")
    expect(panel.textContent).toContain("Working memory › Garden › Shed")
    expect(panel.textContent).toContain("Part of")
    expect(panel.textContent).toContain("Links to")
    expect(panel.textContent).toContain("Linked from")
    expect(panel.textContent).toContain("and 7 more, not drawn")
    await waitFor(() => expect(panel.textContent).toContain("Order the cedar boards before Friday."))
    expect(within(panel).getByRole("link", { name: "Open in GitHub" })).toBeTruthy()
    const crumbs = screen.getByRole("navigation", { name: "Where this memory sits" })
    expect(crumbs.textContent).toContain("Working memory")
    expect(crumbs.textContent).toContain("Garden")
    // Back to the whole memory from the crumb.
    fireEvent.click(within(crumbs).getByRole("button", { name: "Your memory" }))
    await waitFor(() => expect(window.location.hash).toBe("#graph"))
  })

  it("jumps to a memory from the search box, and sends a raw voice note to the Memory tab", async () => {
    const calls = mockFetch(graphRoutes)
    render(<MemoryGraph />)
    await screen.findByRole("group", { name: /Memory graph/ })
    fireEvent.change(screen.getByPlaceholderText("Find a memory…"), { target: { value: "shed" } })
    const results = await screen.findByRole("list", { name: "Matching memories" })
    expect(results.textContent).toContain("100%")
    expect(calls).toContain("/api/console/memory-search?q=shed&limit=8")
    fireEvent.click(within(results).getByRole("button", { name: /Shed/ }))
    await screen.findByLabelText("About Shed")
    expect(window.location.hash).toBe(graphHash("Notes/Shed.md"))

    fireEvent.change(screen.getByPlaceholderText("Find a memory…"), { target: { value: "shed" } })
    const again = await screen.findByRole("list", { name: "Matching memories" })
    fireEvent.click(within(again).getByRole("button", { name: /Voice note/ }))
    expect(window.location.hash).toBe(`#memory?path=${encodeURIComponent("Log/2026-11-07.md#^e-abc123")}`)
  })

  it("says plainly when there is nothing to draw yet", async () => {
    mockFetch(() => ({ body: { status: "empty" } }))
    render(<MemoryGraph />)
    expect(await screen.findByText(/Your graph appears once your vault has memories/)).toBeTruthy()
  })
})

describe("memory graph layout (E12-S2)", () => {
  it("puts the opened memory in the middle, its parent above, links right, backlinks left", () => {
    const placed = layoutGraph(SHED)
    const at = (path: string) => placed.find((n) => n.path === path)!
    expect(at("Notes/Shed.md")).toMatchObject({ x: 400, y: 280 })
    expect(at("Areas/Garden.md").y).toBeLessThan(280)
    expect(at("Notes/Cedar.md").x).toBeGreaterThan(400)
    expect(at("Notes/Plan.md").x).toBeLessThan(400)
    // Deterministic: the same view lands the same way.
    expect(layoutGraph(SHED)).toEqual(placed)
  })

  it("reads the opened memory from the hash and keeps lineage above it", () => {
    expect(graphPathFromHash("#graph?path=Notes%2FShed.md")).toBe("Notes/Shed.md")
    expect(graphPathFromHash("#graph")).toBeNull()
    expect(graphPathFromHash("#memory?path=x.md")).toBeNull()
    expect(lineageAbove("Working memory › Garden › Shed")).toEqual(["Working memory", "Garden"])
  })
})
