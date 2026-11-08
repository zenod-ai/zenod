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
  /** E12-S13: a memory the answer used, and a page between two of them. */
  | "lit"
  | "bridge"

export type MemoryGraphNode = {
  path: string
  title: string
  summary: string
  treePath: string
  /** note: a Log entry the answer used (lit views only). */
  kind: "tree" | "root" | "page" | "note"
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
  /** filed: a lit Log entry to a page it was filed into. */
  kind: "link" | "tree" | "filed"
  /** On the way between memories the answer used (E12-S13). */
  lit?: boolean
  /** 0 to 1 once links carry a strength (EPIC-18). */
  strength?: number
}

export type MemoryGraphView = {
  center: string | null
  nodes: MemoryGraphNode[]
  edges: MemoryGraphEdge[]
  more: { parent: number; child: number; link: number; backlink: number }
  total: { nodes: number; edges: number }
  /** Lit views: each asked memory and what it resolved to (null: not drawn). */
  lit?: Array<{ ref: string; path: string | null }>
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

/** The memories an answer used, lit up with the pages between them (E12-S13). */
export function readLitGraph(paths: string[]): Promise<MemoryGraphResponse> {
  const query = paths.map((path) => `lit=${encodeURIComponent(path)}`).join("&")
  return request(`/api/console/memory-graph?${query}`)
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

/** Most memories one answer lights up (the server's cap). */
export const LIT_MAX = 12

/** One memory an answer used, as the chat handed it over. */
export type LitMemory = { path: string; title: string; matchPercent: number | null }

/** An answer's memories lit up in the graph (`#graph?q=…&m=…`): from the chat's "Show in graph". */
export type LitAnswer = { question: string; memories: LitMemory[] }

/** `#graph?q=<question>&m=<percent>:<path>|<title>…`, best first; a memory without a percent has `-`. */
export function litHash(answer: LitAnswer): string {
  const params = new URLSearchParams()
  if (answer.question) params.set("q", answer.question.slice(0, 200))
  for (const memory of answer.memories.slice(0, LIT_MAX)) {
    const pct = memory.matchPercent == null ? "-" : String(Math.round(memory.matchPercent))
    params.append("m", `${pct}:${memory.path}|${memory.title.replace(/\|/g, " ").slice(0, 80)}`)
  }
  return `#graph?${params.toString()}`
}

export function litFromHash(hash: string): LitAnswer | null {
  if (!hash.startsWith("#graph?")) return null
  const params = new URLSearchParams(hash.slice("#graph?".length))
  const memories = params
    .getAll("m")
    .map((value): LitMemory | null => {
      const colon = value.indexOf(":")
      if (colon < 1) return null
      const rest = value.slice(colon + 1)
      const bar = rest.lastIndexOf("|")
      const path = (bar >= 0 ? rest.slice(0, bar) : rest).trim()
      if (!path) return null
      const pct = Number(value.slice(0, colon))
      return {
        path,
        title: (bar >= 0 ? rest.slice(bar + 1) : "").trim() || path,
        matchPercent: Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null,
      }
    })
    .filter((memory): memory is LitMemory => memory !== null)
    .slice(0, LIT_MAX)
  return memories.length ? { question: params.get("q") ?? "", memories } : null
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
  lit: 5,
  bridge: 6,
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

/**
 * A lit answer (E12-S13), like the deck's retrieval scene: the best memory in the middle, the
 * other lit memories on an inner ring in rank order, and the pages between them on an outer
 * ring, each turned towards the lit memories it connects. Deterministic.
 */
export function layoutLit(
  view: MemoryGraphView,
  options: { compact?: boolean } = {}
): PlacedNode[] {
  const CX = graphWidth(options.compact) / 2
  const lit = view.nodes.filter((node) => node.relation === "lit")
  const rest = view.nodes.filter((node) => node.relation !== "lit")
  const placed = new Map<string, PlacedNode>()
  const sideOf = (angle: number): PlacedNode["side"] => {
    const cos = Math.cos(angle)
    if (Math.abs(cos) >= 0.6) return cos > 0 ? "right" : "left"
    return Math.sin(angle) < 0 ? "top" : "bottom"
  }
  const [first, ...others] = lit
  if (first) placed.set(first.path, { ...first, x: CX, y: CY, side: "bottom" })
  const inner = options.compact ? { rx: 120, ry: 140 } : { rx: 200, ry: 135 }
  others.forEach((node, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / others.length
    placed.set(node.path, {
      ...node,
      x: CX + Math.cos(angle) * inner.rx,
      y: CY + Math.sin(angle) * inner.ry,
      side: sideOf(angle),
    })
  })
  // Each outer page sits towards the lit memories it touches, then they are spread evenly in that order.
  const angleOf = (path: string) => {
    const at = placed.get(path)
    return at ? Math.atan2(at.y - CY, at.x - CX) : null
  }
  const wanted = rest.map((node, index) => {
    const near = view.edges
      .filter((edge) => edge.from === node.path || edge.to === node.path)
      .map((edge) => angleOf(edge.from === node.path ? edge.to : edge.from))
      .filter((angle): angle is number => angle !== null)
    const x = near.reduce((sum, a) => sum + Math.cos(a), 0)
    const y = near.reduce((sum, a) => sum + Math.sin(a), 0)
    const angle = near.length && (x || y) ? Math.atan2(y, x) : -Math.PI / 2 + index
    return { node, angle: (angle + 2.5 * Math.PI) % (2 * Math.PI) }
  })
  wanted.sort((a, b) => a.angle - b.angle || a.node.path.localeCompare(b.node.path))
  const outer = options.compact ? { rx: 170, ry: 245 } : { rx: 340, ry: 235 }
  const offset = wanted.length ? wanted[0]!.angle : 0
  wanted.forEach(({ node, angle }, i) => {
    // Evenly spaced, but no further than half a step from where it wants to be.
    const even = offset + (2 * Math.PI * i) / wanted.length
    const step = (2 * Math.PI) / Math.max(1, wanted.length)
    const at = Math.max(even - step / 2, Math.min(even + step / 2, angle)) - Math.PI / 2
    placed.set(node.path, {
      ...node,
      x: CX + Math.cos(at) * outer.rx,
      y: CY + Math.sin(at) * outer.ry,
      side: sideOf(at),
    })
  })
  return view.nodes.map((node) => placed.get(node.path)!).filter(Boolean)
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
