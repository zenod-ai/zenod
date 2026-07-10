import * as React from "react"
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  FileTextIcon,
  RefreshCwIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  isActiveTaskJob,
  isMediaIngestTaskJob,
  type MediaIngestTaskJob,
  type TaskJobsResponse,
} from "@/lib/api"
import { formatMediaIngestTranscription } from "@/lib/media-ingest-receipt"
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

const STATUS_LABEL: Record<MediaIngestTaskJob["status"], string> = {
  queued: "Queued",
  running: "Processing",
  done: "Done",
  error: "Failed",
  interrupted: "Interrupted",
}

function StatusBadge({ job }: { job: MediaIngestTaskJob }) {
  const failed =
    job.status === "error" ||
    job.status === "interrupted" ||
    job.result?.status === "error"

  if (job.status === "done" && !failed) {
    return (
      <Badge variant="secondary">
        <CheckCircle2Icon className="text-emerald-500" />
        Done
      </Badge>
    )
  }
  if (failed) {
    return (
      <Badge variant="outline" className="text-destructive">
        <CircleAlertIcon />
        {job.result?.status === "error" ? "Failed" : STATUS_LABEL[job.status]}
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

function jobLabel(job: MediaIngestTaskJob): string {
  return (
    job.input.filename ??
    job.input.sourceHint ??
    job.input.artifactUrl ??
    job.input.bytesRef ??
    `${job.input.mediaType ?? "Media"} ingest`
  )
}

function JobRow({ job }: { job: MediaIngestTaskJob }) {
  const result = job.result
  const transcriptionLabel = formatMediaIngestTranscription(
    result?.transcription
  )

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-xs">
          {jobLabel(job)}
        </span>
        <StatusBadge job={job} />
      </div>

      {job.status === "done" && result?.status === "done" ? (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <p>
            Filed to{" "}
            {result.digest.pagesTouched.length > 0
              ? result.digest.pagesTouched.join(", ")
              : "the Inbox"}
            {result.digest.commitSha
              ? ` · ${result.digest.commitSha.slice(0, 7)}`
              : ""}
          </p>
          {transcriptionLabel && (
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <FileTextIcon className="size-3.5" />
              {transcriptionLabel}
            </p>
          )}
        </div>
      ) : result?.status === "error" ? (
        <p className="text-xs text-destructive">{result.message}</p>
      ) : job.error ? (
        <p className="text-xs text-destructive">{job.error}</p>
      ) : isActiveTaskJob(job.status) ? (
        <p className="text-xs text-muted-foreground">
          {job.status === "queued" ? "Waiting to process" : "Processing media"}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Live view of background media-ingest jobs. Because the work runs in a
 * server-side queue (not the chat request), this panel reflects the true
 * state from any tab and survives navigation, refresh, and redeploys — the
 * answer to "is it still running / did it finish?".
 */
export function TranscriptionPanel() {
  const [jobs, setJobs] = React.useState<MediaIngestTaskJob[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)

  const load = React.useCallback(async () => {
    const result = await api<TaskJobsResponse>("/api/tasks/jobs")
    const mediaIngestJobs = result.jobs.filter(isMediaIngestTaskJob)
    setJobs(mediaIngestJobs)
    setLoadError(null)
    return mediaIngestJobs
  }, [])

  // Poll fast while anything is active, slowly when idle.
  React.useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      load()
        .then((current) => {
          if (cancelled) return
          const active = current.some((job) => isActiveTaskJob(job.status))
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

  const activeCount =
    jobs?.filter((job) => isActiveTaskJob(job.status)).length ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Media ingest
          {activeCount > 0 && (
            <Badge variant="secondary">
              <Spinner className="size-3" />
              {activeCount} running
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Audio, images, and documents being archived and filed in the
          background. This runs on the server, so it keeps going if you switch
          tabs or close this page.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loadError !== null && (
          <p className="text-sm text-destructive">{loadError}</p>
        )}

        {jobs !== null && jobs.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RefreshCwIcon />
              </EmptyMedia>
              <EmptyTitle>No media ingests yet</EmptyTitle>
              <EmptyDescription>
                Media sent to Zenod for archiving and filing will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div
            className={cn("flex flex-col gap-2", jobs === null && "opacity-50")}
          >
            {(jobs ?? []).map((job) => (
              <JobRow key={job.id} job={job} />
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
            {refreshing ? (
              <Spinner />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
