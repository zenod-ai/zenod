import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"
import {
  plainWikilinks,
  readMemoryNote,
  vaultLabel,
  type MemoryNote,
} from "@/lib/memory-chat"
import {
  GRAPH_HEIGHT,
  graphHash,
  graphPathFromHash,
  graphWidth,
  layoutGraph,
  layoutLit,
  lineageAbove,
  litFromHash,
  readLitGraph,
  readMemoryGraph,
  searchMemories,
  shortTitle,
  type LitAnswer,
  type MemoryGraphNode,
  type MemoryGraphView,
  type MemorySearchResult,
  type PlacedNode,
} from "@/lib/memory-graph"

// EPIC-12 E12-S2: your memory as a graph. Each memory a dot, its links the lines, the tree
// (Tree.md roots and each page's parent) as solid ink. One memory and its neighbours at a
// time, so a vault of thousands of notes stays quick; open a dot to read it and follow its
// links, or jump with the search box (S3a ranked retrieval). Styled after the product deck's
// graph (docs/epic12/DESIGN-LANGUAGE.md): ink tree lines, dashed links, one accent on the focus.
// E12-S13: an answer's memories light up here too (`#graph?q=…&m=…`, the chat's "Show in graph"),
// one after another with their match percentages, and the links between them in green.

/** The last answer, for the center it was asked for: a newer center shows it dimmed until its own arrives. */
type GraphState = { for: string | null | undefined } & (
  | { kind: "loading"; view: null }
  | { kind: "ready"; view: MemoryGraphView }
  | { kind: "empty" }
  | { kind: "error"; message: string; view: MemoryGraphView | null }
)

const SEARCH_DELAY_MS = 250
/** Below this width (px) the graph uses its narrow layout. */
const COMPACT_BELOW = 440

/** True while the element is narrower than COMPACT_BELOW. */
function useCompact(ref: React.RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = React.useState(false)
  React.useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) =>
      setCompact((entry?.contentRect.width ?? COMPACT_BELOW) < COMPACT_BELOW)
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return compact
}

function useGraphCenter(): [
  string | null,
  (path: string | null) => void,
  LitAnswer | null,
] {
  const [center, setCenter] = React.useState<string | null>(() =>
    graphPathFromHash(window.location.hash)
  )
  const [lit, setLit] = React.useState<LitAnswer | null>(() =>
    litFromHash(window.location.hash)
  )
  React.useEffect(() => {
    const onHash = () => {
      if (window.location.hash.startsWith("#graph")) {
        setCenter(graphPathFromHash(window.location.hash))
        setLit(litFromHash(window.location.hash))
      }
    }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])
  // Each step is a history entry, so Back retraces the walk through the graph.
  const go = React.useCallback((path: string | null) => {
    const hash = graphHash(path)
    if (window.location.hash === hash) return
    window.location.hash = hash
    setCenter(path)
    setLit(null)
  }, [])
  return [center, go, lit]
}

export function MemoryGraph() {
  const [center, go, lit] = useGraphCenter()
  if (lit) return <LitGraph answer={lit} onOpen={go} />
  return <WholeGraph center={center} go={go} />
}

function WholeGraph({
  center,
  go,
}: {
  center: string | null
  go: (path: string | null) => void
}) {
  const [state, setState] = React.useState<GraphState>({
    for: undefined, // nothing answered yet
    kind: "loading",
    view: null,
  })

  React.useEffect(() => {
    let live = true
    readMemoryGraph(center)
      .then((result) => {
        if (!live) return
        setState(
          result.status === "ready"
            ? { for: center, kind: "ready", view: result }
            : { for: center, kind: "empty" }
        )
      })
      .catch((error: unknown) => {
        if (!live) return
        setState((prior) => ({
          for: center,
          kind: "error",
          message: error instanceof Error ? error.message : "Not found.",
          view: "view" in prior ? prior.view : null,
        }))
      })
    return () => {
      live = false
    }
  }, [center])

  const busy = state.for !== center
  const view = "view" in state ? state.view : null
  return (
    <section className="zp zp-graph" aria-label="Your memory as a graph">
      <div className="zp-head zp-graphhead">
        <div>
          <h2>Your memory, as a graph.</h2>
          <p className="zp-lede">
            Each memory is a dot and each link a line. Open one to read it and
            follow where it leads.
          </p>
        </div>
        <GraphSearch onOpen={go} />
      </div>
      {state.kind === "empty" && !busy ? (
        <div className="zp-stage">
          <div className="zp-screen zp-graphscreen">
            <p className="zp-empty">
              Your graph appears once your vault has memories. Send Zenod a note
              or connect your vault, then come back.
            </p>
          </div>
        </div>
      ) : (
        <div className="zp-graphgrid">
          <div className="zp-stage">
            <div className="zp-screen zp-graphscreen">
              <Crumbs view={view} onOpen={go} />
              {view ? (
                <GraphCanvas view={view} onOpen={go} busy={busy} />
              ) : (
                <p className="zp-empty">Drawing your memory…</p>
              )}
              {state.kind === "error" && !busy ? (
                <p className="zp-hint zp-warn" role="alert">
                  {state.message}
                </p>
              ) : null}
              {view ? <Legend view={view} /> : null}
            </div>
          </div>
          {view ? (
            <GraphPanel key={view.center ?? ""} view={view} onOpen={go} />
          ) : null}
        </div>
      )}
    </section>
  )
}

function Crumbs({
  view,
  onOpen,
}: {
  view: MemoryGraphView | null
  onOpen: (path: string | null) => void
}) {
  const node = view?.nodes.find((n) => n.relation === "center")
  const above = node ? lineageAbove(node.treePath) : []
  return (
    <nav className="zp-crumbs" aria-label="Where this memory sits">
      <button
        type="button"
        className="zp-crumb"
        onClick={() => onOpen(null)}
        disabled={!view?.center || node?.kind === "tree"}
      >
        Your memory
      </button>
      {above.map((step, i) => (
        <span key={`${step}-${i}`} className="zp-crumbstep">
          {step}
        </span>
      ))}
      {node && node.kind !== "tree" ? (
        <span className="zp-crumbstep zp-crumbhere">{node.title}</span>
      ) : null}
    </nav>
  )
}

function GraphCanvas({
  view,
  onOpen,
  busy,
  percents,
}: {
  view: MemoryGraphView
  onOpen: (path: string) => void
  busy: boolean
  /** A lit answer (E12-S13): each lit memory's match percentage, in rank order. */
  percents?: Map<string, number | null>
}) {
  const box = React.useRef<HTMLDivElement>(null)
  const compact = useCompact(box)
  const placed = React.useMemo(
    () => (percents ? layoutLit : layoutGraph)(view, { compact }),
    [view, compact, percents]
  )
  const order = React.useMemo(
    () => new Map([...(percents?.keys() ?? [])].map((path, i) => [path, i])),
    [percents]
  )
  const at = React.useMemo(
    () => new Map(placed.map((node) => [node.path, node])),
    [placed]
  )
  return (
    <div ref={box}>
      <svg
        className={cn("zp-g", busy && "zp-gbusy", compact && "zp-gcompact")}
        viewBox={`0 0 ${graphWidth(compact)} ${GRAPH_HEIGHT}`}
        role="group"
        aria-label={`Memory graph: ${placed.length} memories shown of ${view.total.nodes}`}
        data-shown={placed.length}
      >
        <g>
          {view.edges.map((edge) => {
            const a = at.get(edge.from)
            const b = at.get(edge.to)
            if (!a || !b) return null
            const focus =
              !percents &&
              (edge.from === view.center || edge.to === view.center)
            // A lit link shows once both its ends are lit.
            const step = Math.max(
              order.get(edge.from) ?? 0,
              order.get(edge.to) ?? 0
            )
            return (
              <line
                key={`${view.center}|${edge.from}|${edge.to}|${edge.kind}`}
                className={cn(
                  "zp-gedge",
                  edge.lit ? "zp-glitedge" : `zp-g${edge.kind}`,
                  focus && "zp-gfocus"
                )}
                style={
                  edge.lit
                    ? ({
                        "--d": `${litDelay(step) + 250}ms`,
                        ...(edge.strength !== undefined
                          ? { strokeWidth: 1 + 3 * edge.strength }
                          : {}),
                      } as React.CSSProperties)
                    : undefined
                }
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                pathLength={edge.kind === "tree" ? 1 : undefined}
              >
                {edge.strength !== undefined ? (
                  <title>{`strength ${Math.round(edge.strength * 100)}%`}</title>
                ) : null}
              </line>
            )
          })}
        </g>
        {placed.map((node) => (
          <GraphNode
            key={node.path}
            node={node}
            onOpen={onOpen}
            maxTitle={
              node.relation === "center"
                ? 28
                : percents && order.get(node.path) === 0
                  ? compact
                    ? 20
                    : 28
                  : compact
                  ? 12
                  : 18
            }
            percent={percents?.get(node.path)}
            step={order.get(node.path)}
          />
        ))}
      </svg>
    </div>
  )
}

/** When the n-th memory of a lit answer lights up, after the graph has drawn. */
function litDelay(step: number): number {
  return 450 + step * 260
}

function GraphNode({
  node,
  onOpen,
  maxTitle,
  percent,
  step,
}: {
  node: PlacedNode
  onOpen: (path: string) => void
  maxTitle: number
  percent?: number | null
  step?: number
}) {
  const isCenter = node.relation === "center"
  const isLit = node.relation === "lit"
  const radius = isCenter
    ? 11
    : isLit
      ? step === 0
        ? 11
        : 8.5
      : node.kind === "page" || node.kind === "note"
        ? 6.5
        : 8.5
  const label = shortTitle(node.title, maxTitle)
  const dx =
    node.side === "right" ? radius + 8 : node.side === "left" ? -radius - 8 : 0
  const dy =
    node.side === "top"
      ? -radius - 10
      : node.side === "bottom"
        ? radius + 20
        : 5
  const anchor =
    node.side === "right" ? "start" : node.side === "left" ? "end" : "middle"
  return (
    <g
      className={cn(
        "zp-gnode",
        isCenter && "zp-gcenter",
        (node.kind === "root" || node.kind === "tree") && "zp-gtopic",
        node.kind === "note" && "zp-glog",
        isLit && "zp-glit",
        isLit && step === 0 && "zp-glittop",
        node.relation === "bridge" && "zp-gbridge"
      )}
      style={
        {
          transform: `translate(${node.x}px, ${node.y}px)`,
          ...(isLit ? { "--d": `${litDelay(step ?? 0)}ms` } : {}),
        } as React.CSSProperties
      }
      role="button"
      tabIndex={0}
      aria-label={`${node.title}${isCenter ? ", open" : ""}${isLit && percent != null ? `, ${percent}% match` : ""}: ${node.degree} connections`}
      onClick={() => onOpen(node.path)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen(node.path)
        }
      }}
    >
      <title>
        {node.treePath || node.title}
        {node.summary ? ` — ${node.summary}` : ""}
      </title>
      {isCenter || isLit ? (
        <circle className="zp-ghalo" r={isLit && step !== 0 ? 19 : 26} />
      ) : null}
      <circle className="zp-ghit" r={radius + 9} />
      <circle className="zp-gdot" r={radius} />
      <text x={dx} y={dy} textAnchor={anchor}>
        {label}
        {isLit && percent != null ? (
          <tspan className="zp-gpct" dx={6}>
            {percent}%
          </tspan>
        ) : node.hidden > 0 && !isCenter && !isLit ? (
          <tspan className="zp-gmore" dx={5}>
            +{node.hidden}
          </tspan>
        ) : null}
      </text>
    </g>
  )
}

function Legend({ view }: { view: MemoryGraphView }) {
  const shown = React.useMemo(() => layoutGraph(view).length, [view])
  return (
    <div className="zp-legend">
      <span>
        <i className="zp-ltree" /> part of
      </span>
      <span>
        <i className="zp-llink" /> links to
      </span>
      <span className="zp-time">
        {shown} of {view.total.nodes.toLocaleString()} memories ·{" "}
        {view.total.edges.toLocaleString()} links in all
      </span>
    </div>
  )
}

/** The note without its frontmatter, and without a first heading that only repeats the title. */
function noteText(body: string, title: string): string {
  const text = body.replace(/^---\n[\s\S]*?\n---\n?/, "").trimStart()
  const heading = /^# +(.+)\n?/.exec(text)
  return heading && heading[1]!.trim() === title.trim()
    ? text.slice(heading[0].length)
    : text
}

const RELATION_LISTS: Array<{
  relation: MemoryGraphNode["relation"]
  label: string
  more: keyof MemoryGraphView["more"] | null
}> = [
  { relation: "parent", label: "Part of", more: null },
  { relation: "child", label: "Inside it", more: "child" },
  { relation: "link", label: "Links to", more: "link" },
  { relation: "backlink", label: "Linked from", more: "backlink" },
  { relation: "hub", label: "Most connected", more: null },
]

function GraphPanel({
  view,
  onOpen,
}: {
  view: MemoryGraphView
  onOpen: (path: string) => void
}) {
  const node = view.nodes.find((n) => n.relation === "center")
  const [note, setNote] = React.useState<
    { kind: "loading" } | { kind: "ready"; note: MemoryNote } | { kind: "none" }
  >({ kind: node && node.kind !== "tree" ? "loading" : "none" })

  const notePath = node && node.kind !== "tree" ? node.path : null
  React.useEffect(() => {
    // Keyed by center in its parent: one fetch per opened memory.
    if (!notePath) return
    let live = true
    readMemoryNote(notePath)
      .then((value) => live && setNote({ kind: "ready", note: value }))
      .catch(() => live && setNote({ kind: "none" }))
    return () => {
      live = false
    }
  }, [notePath])

  const lists = RELATION_LISTS.map((list) => ({
    ...list,
    nodes: view.nodes.filter((n) => n.relation === list.relation),
  }))
  const title = node ? node.title : "Your memory"
  return (
    <aside className="zp-gpanel" aria-label={`About ${title}`}>
      <h3>{node?.kind === "tree" || !node ? "Your memory" : title}</h3>
      {node && node.kind !== "tree" && node.treePath ? (
        <p className="zp-path">{node.treePath}</p>
      ) : null}
      {node?.kind === "tree" || !node ? (
        <p className="zp-gsummary">
          {view.total.nodes.toLocaleString()} memories and{" "}
          {view.total.edges.toLocaleString()} links. The topics below hold
          everything else; open one to walk in.
        </p>
      ) : node.summary && note.kind !== "ready" ? (
        // The note itself says it once it is open.
        <p className="zp-gsummary">{node.summary}</p>
      ) : null}
      {note.kind === "loading" ? <p className="zp-hint">Opening…</p> : null}
      {note.kind === "ready" ? (
        <>
          <div className="zp-notebody zp-gnote">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {plainWikilinks(noteText(note.note.body, title))}
            </ReactMarkdown>
          </div>
          {note.note.url ? (
            <p className="zp-hint">
              <a href={note.note.url} target="_blank" rel="noreferrer">
                Open in {vaultLabel(note.note.provider)}
              </a>
            </p>
          ) : null}
        </>
      ) : null}
      {lists.map((list) =>
        list.nodes.length ? (
          <div key={list.relation} className="zp-glist">
            <h4>
              {node?.kind === "tree" && list.relation === "child"
                ? "Your topics"
                : list.label}
            </h4>
            <ul>
              {list.nodes.map((n) => (
                <li key={n.path}>
                  <button type="button" onClick={() => onOpen(n.path)}>
                    {n.title}
                  </button>
                  <span className="zp-gcount">{n.degree}</span>
                </li>
              ))}
            </ul>
            {list.more && view.more[list.more] > 0 ? (
              <p className="zp-hint">
                and {view.more[list.more]} more, not drawn
              </p>
            ) : null}
          </div>
        ) : null
      )}
    </aside>
  )
}

function GraphSearch({ onOpen }: { onOpen: (path: string) => void }) {
  const [query, setQuery] = React.useState("")
  // Each answer remembers its query: a stale one (the box changed since) is never shown.
  const [found, setFound] = React.useState<{
    q: string
    results: MemorySearchResult[] | null
    error: string | null
  }>({ q: "", results: null, error: null })
  const q = query.trim()

  React.useEffect(() => {
    if (q.length < 2) return
    let live = true
    const timer = window.setTimeout(() => {
      searchMemories(q)
        .then((results) => live && setFound({ q, results, error: null }))
        .catch(
          (err: unknown) =>
            live &&
            setFound({
              q,
              results: null,
              error: err instanceof Error ? err.message : "Search failed.",
            })
        )
    }, SEARCH_DELAY_MS)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [q])

  const current = q.length >= 2 && found.q === q ? found : null
  const results = current?.results ?? null
  const error = current?.error ?? null

  const open = (result: MemorySearchResult) => {
    setQuery("")
    // A raw Log entry is evidence, not a dot in the graph: open it in the Memory tab.
    if (result.kind === "log") {
      window.location.hash = `#memory?path=${encodeURIComponent(result.path)}`
      return
    }
    onOpen(result.path.split("#")[0]!)
  }

  return (
    <div className="zp-gsearch">
      <label className="zp-compose">
        <span className="sr-only">Find a memory</span>
        <input
          type="search"
          value={query}
          placeholder="Find a memory…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("")
            if (event.key === "Enter" && results?.[0]) open(results[0])
          }}
        />
      </label>
      {error ? (
        <p className="zp-hint zp-warn" role="alert">
          {error}
        </p>
      ) : null}
      {results ? (
        <ol className="zp-gresults" aria-label="Matching memories">
          {results.length === 0 ? (
            <li className="zp-hint">Nothing matches that yet.</li>
          ) : (
            results.map((result) => (
              <li key={result.path}>
                <button type="button" onClick={() => open(result)}>
                  <span className="zp-title">{result.title}</span>
                  <span className="zp-bar" aria-hidden="true">
                    <i style={{ width: `${result.matchPercent}%` }} />
                  </span>
                  <span className="zp-pct">{result.matchPercent}%</span>
                  {result.treePath ? (
                    <span className="zp-meta">{result.treePath}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ol>
      ) : null}
    </div>
  )
}

/** Open a memory from a lit answer: a page in the graph, a Log entry in the Memory tab. */
function openMemory(path: string, kind: MemoryGraphNode["kind"] | "log", go: (path: string) => void) {
  if (kind === "note" || kind === "log") {
    window.location.hash = `#memory?path=${encodeURIComponent(path)}`
    return
  }
  go(path)
}

/**
 * E12-S13: the memories one answer used, lit up in the graph like the deck's retrieval scene:
 * the best one in the middle, the rest around it lighting up in rank order with their match
 * percentages, the pages between them, and the links on the way in green. Each opens.
 */
function LitGraph({
  answer,
  onOpen,
}: {
  answer: LitAnswer
  onOpen: (path: string | null) => void
}) {
  const paths = answer.memories.map((memory) => memory.path)
  const key = paths.join("\n")
  const [state, setState] = React.useState<
    | { for: string; kind: "ready"; view: MemoryGraphView }
    | { for: string; kind: "empty" }
    | { for: string; kind: "error"; message: string }
    | null
  >(null)

  React.useEffect(() => {
    let live = true
    readLitGraph(key.split("\n"))
      .then(
        (result) =>
          live &&
          setState(
            result.status === "ready"
              ? { for: key, kind: "ready", view: result }
              : { for: key, kind: "empty" }
          )
      )
      .catch(
        (error: unknown) =>
          live &&
          setState({
            for: key,
            kind: "error",
            message:
              error instanceof Error ? error.message : "Something went wrong.",
          })
      )
    return () => {
      live = false
    }
  }, [key])

  const current = state?.for === key ? state : null
  const view = current?.kind === "ready" ? current.view : null
  // Each lit memory's percentage, in rank order, keyed by the path it resolved to.
  const percents = React.useMemo(() => {
    if (!view) return undefined
    const map = new Map<string, number | null>()
    view.lit?.forEach((item, i) => {
      if (item.path && !map.has(item.path))
        map.set(item.path, answer.memories[i]?.matchPercent ?? null)
    })
    return map
  }, [view, answer])
  const drawn = new Map(
    (view?.lit ?? []).map((item) => [item.ref, item.path] as const)
  )
  const kindOf = (path: string | null) =>
    view?.nodes.find((node) => node.path === path)?.kind
  const litEdges = view?.edges.filter((edge) => edge.lit).length ?? 0

  return (
    <section className="zp zp-graph" aria-label="An answer lit up in your memory">
      <div className="zp-head zp-graphhead">
        <div>
          <h2>Where the answer came from.</h2>
          <p className="zp-lede">
            The memories Zenod used light up with how well each matched, and the
            links between them turn green. Open any of them.
          </p>
        </div>
        <GraphSearch onOpen={onOpen} />
      </div>
      <div className="zp-graphgrid">
        <div className="zp-stage">
          <div className="zp-screen zp-graphscreen">
            <nav className="zp-crumbs" aria-label="Where you are">
              <button type="button" className="zp-crumb" onClick={() => onOpen(null)}>
                Your memory
              </button>
              <span className="zp-crumbstep zp-crumbhere">This answer</span>
            </nav>
            {answer.question ? (
              <p className="zp-litq" data-testid="lit-question">
                {answer.question}
              </p>
            ) : null}
            {view && percents ? (
              <GraphCanvas
                key={key}
                view={view}
                onOpen={(path) => openMemory(path, kindOf(path) ?? "page", onOpen)}
                busy={false}
                percents={percents}
              />
            ) : current?.kind === "empty" ? (
              <p className="zp-empty">
                Your graph appears once your vault has memories.
              </p>
            ) : current?.kind === "error" ? (
              <p className="zp-hint zp-warn" role="alert">
                {current.message}
              </p>
            ) : (
              <p className="zp-empty">Lighting up the answer…</p>
            )}
            {view ? (
              <div className="zp-legend">
                <span>
                  <i className="zp-llit" /> used by the answer
                </span>
                <span>
                  <i className="zp-ltree" /> part of
                </span>
                <span>
                  <i className="zp-llink" /> links to
                </span>
                <span className="zp-time">
                  {percents?.size ?? 0} memories lit · {litEdges}{" "}
                  {litEdges === 1 ? "link" : "links"} between them
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <aside className="zp-gpanel" aria-label="Memories the answer used">
          <h3>Memories used</h3>
          <ol className="zp-litlist">
            {answer.memories.map((memory, i) => {
              const path = view ? (drawn.get(memory.path) ?? null) : memory.path
              const isLog = memory.path.includes("#^") || memory.path.startsWith("Log/")
              return (
                <li key={`${memory.path}-${i}`}>
                  <span className="zp-litrank">{i + 1}</span>
                  <button
                    type="button"
                    className="zp-title"
                    onClick={() =>
                      openMemory(path ?? memory.path, path ? (kindOf(path) ?? "page") : isLog ? "log" : "page", onOpen)
                    }
                  >
                    {memory.title}
                  </button>
                  <span className="zp-bar" aria-hidden="true">
                    <i style={{ width: `${memory.matchPercent ?? 0}%` }} />
                  </span>
                  <span className="zp-pct">
                    {memory.matchPercent == null ? "·" : `${memory.matchPercent}%`}
                  </span>
                  {view && !path ? (
                    <span className="zp-meta">not in the graph yet</span>
                  ) : null}
                </li>
              )
            })}
          </ol>
          {view ? (
            <p className="zp-hint">
              Green dots are the memories used, the best one in the middle. The
              grey ones connect them.
            </p>
          ) : null}
        </aside>
      </div>
    </section>
  )
}
