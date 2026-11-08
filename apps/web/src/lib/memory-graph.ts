// EPIC-12 E12-S2: your memory as a graph (hosted). The server sends one memory's
// neighbourhood at a time (packages/core/src/vault/memoryGraph.ts); this file fetches it,
// keeps the opened memory in the URL hash and lays the view out on rings around it.

import { MemoryChatError } from "@/lib/memory-chat"

export type MemoryGraphRelation =
  | "center"
  | "parent"
  | "child"
  | "link"
  | "backlink"
  | "hub"

export type MemoryGraphNode = {
  path: string
  title: string
  summary: string
  treePath: string
  kind: "tree" | "root" | "page"
  relation: MemoryGraphRelation
  links: number
  backlinks: number
  children: number
  degree: number
  hidden: number
}

export type MemoryGraphEdge = {
  from: string
  to: string
  kind: "link" | "tree"
}

export type MemoryGraphView = {
  center: string | null
  nodes: MemoryGraphNode[]
  edges: MemoryGraphEdge[]
  more: { parent: number; child: number; link: number; backlink: number }
  total: { nodes: number; edges: number }
}

export type MemoryGraphResponse =
  | ({ status: "ready" } & MemoryGraphView)
  | { status: "empty" }

export type MemorySearchResult = {
  rank: number
  path: string
  title: string
  snippet: string
  matchPercent: number
  treePath: string
  kind: "page" | "log" | "root" | "note"
}

const FRIENDLY: Record<string, string> = {
  unauthorized: "Your session ended. Sign in again to see your memory.",
  no_account: "Your Zenod account is not active yet.",
  "tenant unavailable": "Your workspace is starting. Try again in a moment.",
  "memory graph unavailable":
    "Zenod could not draw your memory just now. Try again in a moment.",
  "memory search unavailable":
    "Zenod could not search just now. Try again in a moment.",
  not_found: "That memory is not in your graph.",
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path)
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string; code?: string; message?: string })
    | null
  if (!response.ok) {
    const code = data?.code ?? data?.error
    throw new MemoryChatError(
      response.status,
      data?.message ??
        (code ? FRIENDLY[code] : undefined) ??
        "Something went wrong. Try again.",
      code
    )
  }
  return data as T
}

export function readMemoryGraph(
  path: string | null
): Promise<MemoryGraphResponse> {
  return request(
    `/api/console/memory-graph${path ? `?path=${encodeURIComponent(path)}` : ""}`
  )
}

export async function searchMemories(
  query: string
): Promise<MemorySearchResult[]> {
  const result = await request<{ results: MemorySearchResult[] }>(
    `/api/console/memory-search?q=${encodeURIComponent(query)}&limit=8`
  )
  return result.results
}

/** The memory opened in the graph (`#graph?path=…`), or null for the overview. */
export function graphPathFromHash(hash: string): string | null {
  if (!hash.startsWith("#graph?")) return null
  const path = new URLSearchParams(hash.slice("#graph?".length)).get("path")
  return path?.trim() ? path.trim() : null
}

export function graphHash(path: string | null): string {
  return path ? `#graph?path=${encodeURIComponent(path)}` : "#graph"
}

export type PlacedNode = MemoryGraphNode & {
  x: number
  y: number
  /** Where the label sits relative to the dot. */
  side: "left" | "right" | "top" | "bottom"
}

export const GRAPH_HEIGHT = 560
/** Viewbox width: wide on a desktop, narrow on a phone so labels keep a readable size. */
export function graphWidth(compact = false): number {
  return compact ? 520 : 800
}
const CY = GRAPH_HEIGHT / 2

/** Clockwise from the top: parent above, links to the right, children below, backlinks to the left. */
const SECTOR_ORDER: Record<MemoryGraphRelation, number> = {
  center: -1,
  parent: 0,
  link: 1,
  child: 2,
  backlink: 3,
  hub: 4,
}

/**
 * The opened memory in the middle and its neighbours on one ring around it, clockwise from the
 * top: parent, links, children, backlinks. The overview draws the tree and its roots only (the
 * busiest pages are listed beside it); a vault without a tree draws its busiest pages. Labels
 * sit outside the dot; near the top and bottom they alternate above and below so neighbours
 * do not overprint. Deterministic.
 */
export function layoutGraph(
  view: MemoryGraphView,
  options: { compact?: boolean } = {}
): PlacedNode[] {
  const CX = graphWidth(options.compact) / 2
  const center = view.nodes.find((node) => node.relation === "center")
  const rest = view.nodes
    .filter((node) => node !== center)
    .map((node, index) => ({ node, index }))
    .sort(
      (a, b) =>
        SECTOR_ORDER[a.node.relation] - SECTOR_ORDER[b.node.relation] ||
        a.index - b.index
    )
    .map(({ node }) => node)
  const placed: PlacedNode[] = []
  if (center) placed.push({ ...center, x: CX, y: CY, side: "bottom" })
  const hubs = rest.filter((node) => node.relation === "hub")
  const near = rest.filter((node) => node.relation !== "hub")
  const ring = (
    nodes: MemoryGraphNode[],
    rx: number,
    ry: number,
    turn: number
  ) => {
    nodes.forEach((node, i) => {
      // Spread dots wider near the top and bottom (labels sit side by side there) and closer
      // at the sides (labels stack). The first dot, the parent, stays at the top.
      const step = (2 * Math.PI * i) / nodes.length
      const angle =
        -Math.PI / 2 +
        turn +
        step +
        (nodes.length > 8 ? 0.3 * Math.sin(2 * step) : 0)
      const cos = Math.cos(angle)
      const side: PlacedNode["side"] =
        Math.abs(cos) < 0.7
          ? nodes.length > 8 && i % 2 === 1
            ? Math.sin(angle) < 0
              ? "bottom"
              : "top"
            : Math.sin(angle) < 0
              ? "top"
              : "bottom"
          : cos > 0
            ? "right"
            : "left"
      placed.push({
        ...node,
        x: CX + cos * rx,
        y: CY + Math.sin(angle) * ry,
        side,
      })
    })
  }
  ring(near.length ? near : hubs, options.compact ? 135 : 290, 215, 0)
  return placed
}

/** "Working memory › House › Visits" without the last step (the node itself). */
export function lineageAbove(treePath: string): string[] {
  const parts = treePath
    .split("›")
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.slice(0, -1)
}

export function shortTitle(title: string, max = 24): string {
  return title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title
}
