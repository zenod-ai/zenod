import * as React from "react"
import { CheckIcon, MoveRightIcon, Undo2Icon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { MemoryTreeNode } from "@/components/memory-tree-card"
import {
  confidenceLabel,
  LOW_CONFIDENCE,
  type PlacementReview,
} from "@/lib/memory-review"
import { cn } from "@/lib/utils"

// EPIC-12 E12-S27: where Zenod filed things, checked by you on your own tree.

/** One place a page can move to: a branch or a page in the tree, with its lineage. */
export type PlaceTarget = { path: string; title: string; lineage: string }

/** Every branch and page of the tree, except `page` and the pages below it (a page never goes under itself). */
export function placeTargets(
  groups: MemoryTreeNode[],
  page: string | null
): PlaceTarget[] {
  const out: PlaceTarget[] = []
  const walk = (node: MemoryTreeNode, trail: string[]) => {
    if (node.path && node.path === page) return
    const lineage = [...trail, node.title]
    if (node.path && !node.provisional)
      out.push({ path: node.path, title: node.title, lineage: lineage.join(" › ") })
    for (const child of node.children) walk(child, lineage)
  }
  for (const group of groups) walk(group, [])
  return out
}

const PICK_SHOWN = 8

/** "Where does it belong?": type a few letters, pick the branch or page. */
export function MovePicker({
  groups,
  page,
  title,
  busy,
  onPick,
  onCancel,
}: {
  groups: MemoryTreeNode[]
  page: string
  title: string
  busy: boolean
  onPick: (to: PlaceTarget) => void
  onCancel: () => void
}) {
  const [query, setQuery] = React.useState("")
  const targets = React.useMemo(() => placeTargets(groups, page), [groups, page])
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (
    words.length
      ? targets.filter((target) =>
          words.every((word) => target.lineage.toLowerCase().includes(word))
        )
      : targets.filter((target) => target.lineage.split(" › ").length <= 2)
  ).slice(0, PICK_SHOWN)
  return (
    <div
      className="mt-1 flex flex-col gap-2 rounded-md border bg-background px-3 py-2 text-xs"
      data-testid="move-picker"
    >
      <p>
        Where does <span className="font-medium">{title}</span> belong?
      </p>
      <Input
        autoFocus
        aria-label="Find the branch or page it belongs under"
        placeholder="Type a branch or page"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel()
          if (event.key === "Enter" && matches[0] && !busy) onPick(matches[0])
        }}
      />
      <ul className="grid gap-0.5" aria-label="Places">
        {matches.map((target) => (
          <li key={target.path}>
            <button
              type="button"
              disabled={busy}
              className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left hover:bg-accent disabled:opacity-50"
              onClick={() => onPick(target)}
            >
              <MoveRightIcon className="size-3 shrink-0 self-center text-muted-foreground" />
              <span className="font-medium">{target.title}</span>
              <span className="truncate text-muted-foreground">
                {target.lineage}
              </span>
            </button>
          </li>
        ))}
        {matches.length === 0 && (
          <li className="px-1.5 py-1 text-muted-foreground">
            No branch or page matches.
          </li>
        )}
      </ul>
      <div>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** Where a page hangs: its place without its own name at the end. */
export function hangsUnder(place: string, title: string): string {
  const tail = ` › ${title}`
  return place.endsWith(tail) ? `in ${place.slice(0, -tail.length)}` : place
}

export function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  const low = confidence === null || confidence < LOW_CONFIDENCE
  return (
    <Badge
      variant="outline"
      data-testid="confidence"
      className={cn("tabular-nums", low && "border-[var(--zn-warn)]")}
      title={
        confidence === null
          ? "Filed before Zenod kept a confidence; it marked this one unsure"
          : "How sure Zenod was of this place when it filed it"
      }
    >
      {confidenceLabel(confidence)}
    </Badge>
  )
}

/** The filings to check, Zenod's least sure first: Right place or Wrong place, then Undo if needed. */
export function MemoryReviewCard({
  review,
  groups,
  busy,
  onPlace,
  onUndo,
}: {
  review: PlacementReview
  groups: MemoryTreeNode[]
  busy: boolean
  onPlace: (page: string, title: string, to: PlaceTarget | null) => void
  onUndo: (id: string) => void
}) {
  const [moving, setMoving] = React.useState<string | null>(null)
  const [showAll, setShowAll] = React.useState(false)
  const recent = review.recent.filter((move) => !move.undone).slice(0, 3)
  // The unsure ones first and only, until you ask for the ones Zenod was surer of.
  const unsure = review.items.filter(
    (item) => item.confidence === null || item.confidence < LOW_CONFIDENCE
  )
  const shown = showAll || unsure.length === 0 ? review.items : unsure
  const hidden = review.items.length - shown.length
  return (
    <Card className="rounded-none" data-testid="memory-review-card">
      <CardHeader>
        <CardTitle>Check where Zenod filed these</CardTitle>
        <CardDescription>
          Each filing records how sure Zenod was of its place. The least sure
          come first: say it is in the right place, or move it where it
          belongs.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p
          className="text-xs text-muted-foreground tabular-nums"
          data-testid="memory-review-summary"
        >
          {review.total === 0
            ? "Nothing to check right now."
            : `${review.total} to check · ${review.low} under ${LOW_CONFIDENCE}% sure · ${review.total - review.scored} older ones Zenod marked unsure`}
          {review.checked.confirmed + review.checked.moved > 0 &&
            ` · you checked ${review.checked.confirmed + review.checked.moved}, moved ${review.checked.moved}`}
        </p>
        {recent.length > 0 && (
          <ul className="grid gap-1 text-xs" aria-label="Your latest moves">
            {recent.map((move) => (
              <li key={move.id} className="flex flex-wrap items-center gap-2">
                <span>
                  You moved <span className="font-medium">{move.title}</span>{" "}
                  from {move.from ?? "the root"} to {move.to}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onUndo(move.id)}
                >
                  <Undo2Icon /> Undo
                </Button>
              </li>
            ))}
          </ul>
        )}
        <ul className="grid" aria-label="Filings to check">
          {shown.map((item) => (
            <li
              key={item.path}
              className="flex flex-col gap-1 border-t py-1.5 text-sm first:border-t-0"
              data-testid="review-item"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <ConfidenceBadge confidence={item.confidence} />
                <div className="min-w-0 flex-1">
                  <span className="font-medium break-words">{item.title}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {hangsUnder(item.place, item.title)}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onPlace(item.path, item.title, null)}
                  >
                    <CheckIcon /> Right place
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      setMoving(moving === item.path ? null : item.path)
                    }
                  >
                    <MoveRightIcon /> Wrong place
                  </Button>
                </div>
              </div>
              {moving === item.path && (
                <MovePicker
                  groups={groups}
                  page={item.path}
                  title={item.title}
                  busy={busy}
                  onCancel={() => setMoving(null)}
                  onPick={(to) => {
                    setMoving(null)
                    onPlace(item.path, item.title, to)
                  }}
                />
              )}
            </li>
          ))}
        </ul>
        {hidden > 0 && (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
              Show the {hidden} Zenod was surer of
            </Button>
          </div>
        )}
        {review.total > review.items.length && (
          <p className="text-xs text-muted-foreground">
            {review.total - review.items.length} more after these.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
