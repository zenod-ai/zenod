import * as React from "react"
import {
  BookOpenCheckIcon,
  ExternalLinkIcon,
  ListChecksIcon,
  PlayIcon,
} from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

type Briefing = {
  version: number
  content: {
    theme: string
    objectives: string[]
    tone: string
    replyPolicy: string
  }
  cadenceMinutes: number
  proposalCount: number
  approvedAt: number
}

type BoardItem = {
  id: string
  state: "proposed" | "approved" | "posted" | "rejected"
  text: string
  rationale: string
  memoryCitation: string
  permalink: string | null
}

type WakeReceipt = {
  code: string
  message: string
  completedAt: number
}

type BoardResponse = { items: BoardItem[]; wakes: WakeReceipt[] }
type BriefingResponse = { briefing: Briefing | null }

const STATE_LABEL: Record<BoardItem["state"], string> = {
  proposed: "Proposed",
  approved: "Approved",
  posted: "Posted",
  rejected: "Rejected",
}

export function HeraldLoopPanels() {
  const [briefing, setBriefing] = React.useState<Briefing | null | undefined>()
  const [board, setBoard] = React.useState<BoardResponse | null>(null)
  const [running, setRunning] = React.useState(false)
  const [receipt, setReceipt] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    const [briefingResult, boardResult] = await Promise.all([
      api<BriefingResponse>("/api/herald/briefing"),
      api<BoardResponse>("/api/herald/board"),
    ])
    setBriefing(briefingResult.briefing)
    setBoard(boardResult)
  }, [])

  React.useEffect(() => {
    const initial = window.setTimeout(() => void load().catch(() => {}), 0)
    const timer = window.setInterval(() => void load().catch(() => {}), 5_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [load])

  async function runNow() {
    setRunning(true)
    setReceipt(null)
    try {
      const wake = await api<WakeReceipt>("/api/herald/run-now", {
        method: "POST",
      })
      setReceipt(wake.message)
      toast.success("Herald wake finished", { description: wake.message })
      await load()
      window.dispatchEvent(new CustomEvent("herald:chat-refresh"))
    } catch (error) {
      const message = errorMessage(error)
      setReceipt(message)
      toast.error("Herald refused the wake", { description: message })
      await load().catch(() => {})
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <Card aria-labelledby="herald-board-heading">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <ListChecksIcon className="mb-2 size-5 text-muted-foreground" />
            <CardTitle id="herald-board-heading">Board</CardTitle>
            <CardDescription>
              Proposals, their WHY, cited memory, and authoritative posting
              receipts.
            </CardDescription>
          </div>
          <Button onClick={runNow} disabled={running}>
            <PlayIcon />
            {running ? "Running…" : "Run now"}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {receipt ? (
            <p
              role="status"
              className="rounded-md border bg-muted/40 p-3 text-sm"
            >
              {receipt}
            </p>
          ) : null}
          {board === null ? (
            <Skeleton className="h-32 w-full" />
          ) : board.items.length === 0 ? (
            <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
              No board items yet. Approve the briefing, then run the proposer.
            </p>
          ) : (
            board.items.map((item, index) => (
              <article
                key={item.id}
                className="flex flex-col gap-2 rounded-md border p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    #{index + 1}
                  </span>
                  <Badge
                    variant={item.state === "posted" ? "default" : "secondary"}
                  >
                    {STATE_LABEL[item.state]}
                  </Badge>
                </div>
                <p className="text-sm leading-6 font-medium">{item.text}</p>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">WHY:</span>{" "}
                  {item.rationale}
                </p>
                <a
                  className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
                  href={item.memoryCitation}
                  target="_blank"
                  rel="noreferrer"
                >
                  Memory citation <ExternalLinkIcon className="size-3" />
                </a>
                {item.permalink ? (
                  <a
                    className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2"
                    href={item.permalink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {item.permalink} <ExternalLinkIcon className="size-3" />
                  </a>
                ) : null}
              </article>
            ))
          )}
          {board?.wakes[0] ? (
            <p className="text-xs text-muted-foreground">
              Last wake: {board.wakes[0].message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card aria-labelledby="herald-briefing-heading">
        <CardHeader>
          <BookOpenCheckIcon className="size-5 text-muted-foreground" />
          <CardTitle id="herald-briefing-heading">Briefing</CardTitle>
          <CardDescription>
            The approved contract that gates every wake.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {briefing === undefined ? (
            <Skeleton className="h-28 w-full" />
          ) : briefing === null ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              <p className="font-medium">
                No briefing approved — Herald will not loop.
              </p>
              <p className="mt-1 text-muted-foreground">
                Negotiate it in chat, then reply “✓ approve briefing”.
              </p>
            </div>
          ) : (
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Version</dt>
                <dd className="font-medium">v{briefing.version} · approved</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Theme</dt>
                <dd>{briefing.content.theme}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Objectives</dt>
                <dd>{briefing.content.objectives.join(" · ")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Tone</dt>
                <dd>{briefing.content.tone}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Reply policy</dt>
                <dd>{briefing.content.replyPolicy}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Cadence</dt>
                <dd>
                  Every {briefing.cadenceMinutes} min · {briefing.proposalCount}{" "}
                  proposals
                </dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
