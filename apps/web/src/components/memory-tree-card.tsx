import * as React from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  MoveRightIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { MovePicker, type PlaceTarget } from "@/components/memory-review"

/** E12-S27: Right place (`to` null) or Wrong place, moved under `to`. */
export type PlaceMemory = (
  page: string,
  title: string,
  to: PlaceTarget | null
) => void

/** One node as projected by GET /api/console/memory-tree (EPIC-9 E9-2e). */
export type MemoryTreeNode = {
  id: string
  kind: "group" | "root" | "page"
  memory: "working" | "long-term"
  title: string
  path: string | null
  summary?: string
  provisional?: boolean
  pages: number
  latest: { date: string; title: string; path: string } | null
  url: string | null
  children: MemoryTreeNode[]
}

export type MemoryTree = {
  groups: MemoryTreeNode[]
  roots: number
  placed: number
  unplaced: number
}

export type MemoryTreeState =
  | { status: "ready"; tree: MemoryTree }
  | { status: "empty" }
  | { status: "unavailable" }

/** Same dot language as agent_team's epic tree: one colour per level-0 group. */
const GROUP_DOT: Record<MemoryTreeNode["memory"], string> = {
  working: "bg-primary",
  "long-term": "bg-muted-foreground",
}
const GROUP_RING: Record<MemoryTreeNode["memory"], string> = {
  working: "border-primary",
  "long-term": "border-muted-foreground",
}

const SHORT_TITLE = 48

function shortTitle(title: string): string {
  return title.length > SHORT_TITLE
    ? `${title.slice(0, SHORT_TITLE - 1).trimEnd()}…`
    : title
}

function dateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
}

function MemoryDot({ node }: { node: MemoryTreeNode }) {
  return (
    <span
      data-testid="memory-dot"
      data-memory={node.memory}
      className={cn(
        "mt-1 inline-block h-3 w-3 shrink-0 rounded-full",
        node.kind === "page"
          ? cn("border-2 bg-transparent", GROUP_RING[node.memory])
          : GROUP_DOT[node.memory],
        node.provisional &&
          "ring-2 ring-[var(--zn-warn)] ring-offset-1 ring-offset-background"
      )}
    />
  )
}

function collectIds(nodes: MemoryTreeNode[], into: Set<string>): Set<string> {
  for (const node of nodes) {
    if (node.children.length > 0) into.add(node.id)
    collectIds(node.children, into)
  }
  return into
}

function TreeRow({
  node,
  depth,
  trail,
  open,
  toggle,
  selected,
  select,
  place,
}: {
  node: MemoryTreeNode
  depth: number
  trail: string[]
  open: Set<string>
  toggle: (id: string) => void
  selected: string | null
  select: (id: string | null) => void
  place?: { groups: MemoryTreeNode[]; busy: boolean; onPlace: PlaceMemory }
}) {
  const [moving, setMoving] = React.useState(false)
  const hasKids = node.children.length > 0
  const expanded = hasKids && open.has(node.id)
  const lineage = [...trail, node.title]
  const isSelected = selected === node.id
  const pageLabel = `${node.pages} ${node.pages === 1 ? "page" : "pages"}`
  return (
    <li
      role="treeitem"
      aria-expanded={hasKids ? expanded : undefined}
      aria-selected={isSelected}
      data-node={node.id}
    >
      <div
        className={cn(
          "flex items-start gap-2 rounded-md py-1 pr-2 text-sm hover:bg-accent/50",
          isSelected && "bg-accent"
        )}
        style={{ paddingLeft: depth * 20 + 4 }}
      >
        <button
          type="button"
          aria-label={
            hasKids
              ? `${expanded ? "Collapse" : "Expand"} ${node.title}`
              : undefined
          }
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground",
            !hasKids && "invisible"
          )}
          onClick={() => toggle(node.id)}
          tabIndex={hasKids ? 0 : -1}
        >
          {expanded ? (
            <ChevronDownIcon className="h-4 w-4" />
          ) : (
            <ChevronRightIcon className="h-4 w-4" />
          )}
        </button>
        <MemoryDot node={node} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {node.path ? (
              <button
                type="button"
                className={cn(
                  "min-w-0 text-left break-words hover:underline",
                  node.kind === "root" && "font-medium"
                )}
                onClick={() => select(isSelected ? null : node.id)}
              >
                {node.title}
              </button>
            ) : (
              <span className="font-semibold">{node.title}</span>
            )}
            <span
              className="text-xs text-muted-foreground tabular-nums"
              data-testid="memory-count"
            >
              {pageLabel}
            </span>
            {node.latest && (
              <span
                className="text-xs text-muted-foreground"
                data-testid="memory-latest"
                title={node.latest.title}
              >
                latest{" "}
                <time dateTime={node.latest.date}>
                  {dateLabel(node.latest.date)}
                </time>
                {node.latest.path !== node.path &&
                  ` · ${shortTitle(node.latest.title)}`}
              </span>
            )}
            {node.provisional && (
              <Badge
                variant="outline"
                title="Placed here because nothing fitted better; the weekly sweep reviews it"
              >
                provisional
              </Badge>
            )}
          </div>
          {node.summary && (depth <= 1 || isSelected) && (
            <p className="text-xs text-muted-foreground">{node.summary}</p>
          )}
          {isSelected && (
            <div
              className="mt-1 flex flex-col gap-1 rounded-md border bg-background px-3 py-2 text-xs"
              data-testid="memory-node-detail"
            >
              <p>
                <span className="text-muted-foreground">Where it sits: </span>
                {lineage.join(" › ")}
              </p>
              {node.url ? (
                <a
                  className="inline-flex w-fit items-center gap-1 underline underline-offset-4"
                  href={node.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in your vault
                  <ExternalLinkIcon className="size-3" />
                </a>
              ) : (
                <p className="text-muted-foreground">{node.path}</p>
              )}
              {place && node.path && node.kind !== "group" && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {node.provisional && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={place.busy}
                      onClick={() => place.onPlace(node.path!, node.title, null)}
                    >
                      <CheckIcon /> Right place
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={place.busy}
                    onClick={() => setMoving((value) => !value)}
                  >
                    <MoveRightIcon /> Wrong place
                  </Button>
                </div>
              )}
              {place && moving && node.path && (
                <MovePicker
                  groups={place.groups}
                  page={node.path}
                  title={node.title}
                  busy={place.busy}
                  onCancel={() => setMoving(false)}
                  onPick={(to) => {
                    setMoving(false)
                    place.onPlace(node.path!, node.title, to)
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
      {expanded && (
        <ul role="group" className="grid gap-0.5">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              trail={lineage}
              open={open}
              toggle={toggle}
              selected={selected}
              select={select}
              place={place}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function MemoryTreeCard({
  state,
  busy = false,
  onPlace,
}: {
  state: MemoryTreeState
  busy?: boolean
  /** E12-S27: shows Right place and Wrong place on an opened page. */
  onPlace?: PlaceMemory
}) {
  const groups = state.status === "ready" ? state.tree.groups : []
  // Levels 0–1 open on load: each group shows its roots; deeper levels on demand.
  const [open, setOpen] = React.useState<Set<string>>(
    () => new Set(groups.map((group) => group.id))
  )
  const [selected, setSelected] = React.useState<string | null>(null)
  const toggle = React.useCallback((id: string) => {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <Card className="rounded-none" data-testid="memory-tree-card">
      <CardHeader>
        <CardTitle>Your memory</CardTitle>
        <CardDescription>
          Working memory is what is ongoing now; long-term memory is what
          lasts. Zenod files every capture under a branch, so the tree grows
          on its own. Open any page to say it is in the wrong place.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state.status === "unavailable" ? (
          <p className="text-sm text-muted-foreground">
            Your memory tree is temporarily unavailable. Your notes are safe
            in your vault.
          </p>
        ) : state.status === "empty" || groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Your memory tree appears as Zenod files your captures.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p
                className="text-xs text-muted-foreground tabular-nums"
                data-testid="memory-tree-summary"
              >
                {state.tree.roots} branches · {state.tree.placed} pages placed
                {state.tree.unplaced > 0 &&
                  ` · ${state.tree.unplaced} older pages not placed yet`}
              </p>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setOpen(collectIds(groups, new Set()))}
                >
                  Expand all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setOpen(new Set(groups.map((group) => group.id)))
                  }
                >
                  Collapse
                </Button>
              </div>
            </div>
            <ul role="tree" aria-label="Memory tree" className="grid gap-0.5">
              {groups.map((group) => (
                <TreeRow
                  key={group.id}
                  node={group}
                  depth={0}
                  trail={[]}
                  open={open}
                  toggle={toggle}
                  selected={selected}
                  select={setSelected}
                  place={onPlace ? { groups, busy, onPlace } : undefined}
                />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
