import * as React from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  PencilIcon,
  PinIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

/** One node as projected by GET /api/console/memory-tree (EPIC-9 E9-2e). */
export type MemoryTreeNode = {
  id: string
  kind: "group" | "root" | "page"
  memory: "working" | "long-term"
  title: string
  path: string | null
  summary?: string
  provisional?: boolean
  /** Roots only (E9-5b): stable id, and the person's pin / name. */
  rootId?: string
  pinned?: boolean
  nameLocked?: boolean
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

/** A pin or rename the person asks for on a root (POST /api/console/memory-tree/steer). */
export type MemorySteerRequest =
  | { action: "pin"; root: string }
  | { action: "rename"; root: string; name: string }

/** Resolves when the change is saved; rejects with a message to show. */
export type MemorySteer = (request: MemorySteerRequest) => Promise<void>

export type MemoryTreeState =
  | { status: "ready"; tree: MemoryTree }
  | { status: "empty" }
  | { status: "unavailable" }

/** Same dot language as agent_team's epic tree: one colour per level-0 group. */
const GROUP_DOT: Record<MemoryTreeNode["memory"], string> = {
  working: "bg-sky-500",
  "long-term": "bg-violet-500",
}
const GROUP_RING: Record<MemoryTreeNode["memory"], string> = {
  working: "border-sky-500",
  "long-term": "border-violet-500",
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
          "ring-2 ring-amber-500 ring-offset-1 ring-offset-background"
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

/** Pin and rename on a selected root (E9-5b): each becomes a Keeper note Zenod never undoes. */
function RootSteering({
  node,
  onSteer,
}: {
  node: MemoryTreeNode
  onSteer: MemorySteer
}) {
  const [renaming, setRenaming] = React.useState(false)
  const [name, setName] = React.useState(node.title)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const root = node.rootId ?? node.path ?? node.id
  const run = async (request: MemorySteerRequest) => {
    setBusy(true)
    setError(null)
    try {
      await onSteer(request)
      setRenaming(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-1" data-testid="memory-root-steering">
      {renaming ? (
        <form
          className="flex flex-wrap items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            void run({ action: "rename", root, name: name.trim() })
          }}
        >
          <Input
            aria-label={`New name for ${node.title}`}
            className="h-7 w-56 text-xs"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          <Button
            size="sm"
            type="submit"
            disabled={busy || !name.trim() || name.trim() === node.title}
          >
            Save name
          </Button>
          <Button
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => {
              setRenaming(false)
              setName(node.title)
              setError(null)
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {!node.pinned && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              title="Keep this branch where it is, with this name: Zenod never moves or renames it"
              onClick={() => void run({ action: "pin", root })}
            >
              <PinIcon className="size-3" />
              Pin
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            title="Give this branch your own name: Zenod keeps it"
            onClick={() => setRenaming(true)}
          >
            <PencilIcon className="size-3" />
            Rename
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function TreeRow({
  node,
  depth,
  trail,
  open,
  toggle,
  selected,
  select,
  onSteer,
}: {
  node: MemoryTreeNode
  depth: number
  trail: string[]
  open: Set<string>
  toggle: (id: string) => void
  selected: string | null
  select: (id: string | null) => void
  onSteer?: MemorySteer
}) {
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
              className="font-mono text-xs text-muted-foreground tabular-nums"
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
            {node.pinned && (
              <Badge
                variant="secondary"
                title="You pinned this branch: Zenod never moves or renames it"
              >
                pinned
              </Badge>
            )}
            {node.nameLocked && !node.pinned && (
              <Badge
                variant="secondary"
                title="You named this branch: Zenod keeps your name"
              >
                your name
              </Badge>
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
              {node.kind === "root" && onSteer && (
                <RootSteering key={node.title} node={node} onSteer={onSteer} />
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
              onSteer={onSteer}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function MemoryTreeCard({
  state,
  onSteer,
}: {
  state: MemoryTreeState
  onSteer?: MemorySteer
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
          on its own.
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
                  onSteer={onSteer}
                />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
