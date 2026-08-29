import * as React from "react"
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  RefreshCwIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  isActiveIngest,
  type IngestJob,
  type IngestJobsResponse,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"

const STATUS_LABEL: Record<IngestJob["status"], string> = {
  queued: "Queued",
  downloading: "Downloading",
  transcribing: "Transcribing",
  filing: "Filing",
  done: "Done",
  error: "Failed",
  interrupted: "Interrupted",
}

function StatusBadge({ job }: { job: IngestJob }) {
  if (job.status === "done") {
    return (
      <Badge variant="secondary">
        <CheckCircle2Icon className="text-emerald-500" />
        Done
      </Badge>
    )
  }
  if (job.status === "error" || job.status === "interrupted") {
    return (
      <Badge variant="outline" className="text-destructive">
        <CircleAlertIcon />
        {STATUS_LABEL[job.status]}
      </Badge>
    )
  }
  return (
    <Badge variant="outline">
      <Spinner className="size-3" />
      {STATUS_LABEL[job.status]}
    </Badge>
  )
}

function JobRow({
  job,
  onRetry,
  onCancel,
}: {
  job: IngestJob
  onRetry: (id: string) => void
  onCancel: (id: string) => void
}) {
  const showBar = job.status === "transcribing"
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-xs">{job.fileName}</span>
        <StatusBadge job={job} />
      </div>

      {showBar && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${job.progress}%` }}
            />
          </div>
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {job.progress}%
          </span>
        </div>
      )}

      {job.status === "done" ? (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <p>
            Filed to {job.pages.length > 0 ? job.pages.join(", ") : "the Inbox"}
            {job.archived ? " · archived in Drive" : ""}
            {job.revision
              ? ` · ${job.revision.provider === "google_drive" ? "Drive" : "GitHub"} ${job.revision.id}${job.revision.provider === "google_drive" && job.commitSha ? ` · git ${job.commitSha.slice(0, 7)}` : ""}`
              : job.commitSha
                ? ` · ${job.commitSha.slice(0, 7)}`
                : ""}
          </p>
          {job.backlog && (
            <div className="flex flex-col gap-1 rounded-md bg-muted/60 p-2">
              <p className="font-medium text-foreground">
                Backlog digest: {job.backlog.candidates.length} proposed
                {job.backlog.written.length > 0 ? ` · ${job.backlog.written.length} written` : ""}
              </p>
              {job.backlog.written.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {job.backlog.written.map((item) => (
                    item.url ? (
                      <a
                        key={item.path}
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded bg-background px-1.5 py-0.5 underline underline-offset-2"
                      >
                        {item.title}
                      </a>
                    ) : (
                      <span key={item.path} className="rounded bg-background px-1.5 py-0.5">
                        {item.title}
                      </span>
                    )
                  ))}
                </div>
              )}
              {job.backlog.candidates.slice(0, 3).map((candidate) => (
                <p key={candidate.title}>
                  {candidate.priority} · {candidate.title}
                </p>
              ))}
            </div>
          )}
        </div>
      ) : job.error ? (
        <p className="text-xs text-destructive">{job.error}</p>
      ) : job.step ? (
        <p className="text-xs text-muted-foreground">
          {job.step}
          {job.cached ? " · transcript cached" : ""}
        </p>
      ) : null}

      {(job.status === "error" || job.status === "interrupted") && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onRetry(job.id)}
          >
            <RotateCwIcon className="size-3.5" />
            Retry
          </Button>
        </div>
      )}

      {isActiveIngest(job.status) && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => onCancel(job.id)}
          >
            <XIcon className="size-3.5" />
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Live view of background Drive transcription jobs. Because the work runs in a
 * server-side queue (not the chat request), this panel reflects the true
 * state from any tab and survives navigation, refresh, and redeploys — the
 * answer to "is it still running / did it finish?".
 */
export function TranscriptionPanel() {
  const [jobs, setJobs] = React.useState<IngestJob[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)

  const load = React.useCallback(async () => {
    const result = await api<IngestJobsResponse>("/api/ingest/jobs")
    setJobs(result.jobs)
    setLoadError(null)
    return result.jobs
  }, [])

  // Poll fast while anything is active, slowly when idle.
  React.useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      load()
        .then((current) => {
          if (cancelled) return
          const active = current.some((j) => isActiveIngest(j.status))
          timer = setTimeout(tick, active ? 2000 : 10000)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setLoadError(errorMessage(err))
          timer = setTimeout(tick, 10000)
        })
    }
    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [load])

  async function handleRetry(id: string) {
    try {
      await api(`/api/ingest/jobs/${id}/retry`, { method: "POST" })
      await load()
      toast.success("Re-queued")
    } catch (err) {
      toast.error("Could not retry", { description: errorMessage(err) })
    }
  }

  async function handleCancel(id: string) {
    try {
      await api(`/api/ingest/jobs/${id}/cancel`, { method: "POST" })
      await load()
      toast.success("Cancelled")
    } catch (err) {
      toast.error("Could not cancel", { description: errorMessage(err) })
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await load()
    } catch (err) {
      toast.error("Could not refresh", { description: errorMessage(err) })
    } finally {
      setRefreshing(false)
    }
  }

  const activeCount = jobs?.filter((j) => isActiveIngest(j.status)).length ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Transcription
          {activeCount > 0 && (
            <Badge variant="secondary">
              <Spinner className="size-3" />
              {activeCount} running
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Drive files being transcribed and filed in the background. This runs
          on the server, so it keeps going if you switch tabs or close this
          page.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loadError !== null && <p className="text-sm text-destructive">{loadError}</p>}

        {jobs !== null && jobs.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RefreshCwIcon />
              </EmptyMedia>
              <EmptyTitle>No transcriptions yet</EmptyTitle>
              <EmptyDescription>
                Ask Zeno in chat to transcribe your Drive voice notes — they&apos;ll
                appear here with live progress.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className={cn("flex flex-col gap-2", jobs === null && "opacity-50")}>
            {(jobs ?? []).map((job) => (
              <JobRow key={job.id} job={job} onRetry={handleRetry} onCancel={handleCancel} />
            ))}
          </div>
        )}

        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
