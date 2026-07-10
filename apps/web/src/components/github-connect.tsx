import * as React from "react"
import { CheckIcon, ExternalLinkIcon, FolderGitIcon } from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  type GithubAppStatus,
  type GithubRepo,
  type GithubReposResponse,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

/**
 * GitHub mark. lucide-react no longer ships brand icons, so this is the
 * octocat path inlined with the same props surface as a lucide icon.
 */
function GithubMarkIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

// Exported for the focused redirect-safety test; this module's runtime export remains stable.
// eslint-disable-next-line react-refresh/only-export-components
export function githubAppInstallationUrl(start: unknown): string {
  if (typeof start !== "object" || start === null) {
    throw new Error("GitHub did not return a repository connection URL")
  }

  const payload = start as Record<string, unknown>
  const candidate = [payload.url, payload.installationUrl, payload.action].find(
    (value): value is string => typeof value === "string" && value.length > 0
  )
  if (candidate === undefined) {
    throw new Error("GitHub did not return a repository connection URL")
  }

  const url = new URL(candidate)
  const isInstallationUrl =
    url.protocol === "https:" &&
    url.hostname === "github.com" &&
    /^\/apps\/[^/]+\/installations\/new\/?$/.test(url.pathname)
  if (!isInstallationUrl) {
    throw new Error("GitHub returned an invalid repository connection URL")
  }

  return url.toString()
}

function RepoPickerDialog({
  onOpenChange,
  onPicked,
}: {
  onOpenChange: (open: boolean) => void
  onPicked?: (repo: string, branch: string) => void
}) {
  const [repos, setRepos] = React.useState<GithubRepo[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState("")
  const [savingRepo, setSavingRepo] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    api<GithubReposResponse>("/api/github/repos")
      .then((result) => {
        if (!cancelled) {
          setRepos(result.repositories)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(errorMessage(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handlePick(repo: GithubRepo) {
    setSavingRepo(repo.fullName)
    try {
      await api("/api/settings", {
        method: "PUT",
        body: {
          vault_repo: repo.fullName,
          vault_branch: repo.defaultBranch,
        },
      })
      toast.success("Vault repo saved", {
        description: `${repo.fullName} on ${repo.defaultBranch}`,
      })
      onOpenChange(false)
      onPicked?.(repo.fullName, repo.defaultBranch)
    } catch (err) {
      toast.error("Could not save vault repo", {
        description: errorMessage(err),
      })
    } finally {
      setSavingRepo(null)
    }
  }

  const filtered =
    repos === null
      ? []
      : repos.filter((repo) =>
          repo.fullName.toLowerCase().includes(filter.trim().toLowerCase())
        )

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select repository</DialogTitle>
          <DialogDescription>
            Repositories you granted the Zenod GitHub App access to.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            placeholder="Filter repositories…"
            autoComplete="off"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          {loadError !== null && (
            <p className="text-sm text-destructive">{loadError}</p>
          )}
          {repos === null && loadError === null && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}
          {repos !== null && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {repos.length === 0
                ? "No repositories granted. Use “Manage on GitHub” to grant access first."
                : "No repositories match."}
            </p>
          )}
          {filtered.length > 0 && (
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {filtered.map((repo) => (
                <button
                  key={repo.fullName}
                  type="button"
                  disabled={savingRepo !== null}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => handlePick(repo)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-xs">
                      {repo.fullName}
                    </span>
                    {repo.private && <Badge variant="outline">private</Badge>}
                  </span>
                  {savingRepo === repo.fullName ? (
                    <Spinner className="size-3.5 shrink-0" />
                  ) : (
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {repo.defaultBranch}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function GithubConnect({
  onRepoPicked,
  onStatusChange,
  compact = false,
  connectOnly = false,
}: {
  onRepoPicked?: (repo: string, branch: string) => void
  onStatusChange?: (status: GithubAppStatus) => void
  compact?: boolean
  /** Connect/disconnect only — no "Choose vault repo" picker (for the Console). */
  connectOnly?: boolean
}) {
  const [status, setStatus] = React.useState<GithubAppStatus | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [starting, setStarting] = React.useState(false)
  const [disconnecting, setDisconnecting] = React.useState(false)
  const [pickerOpen, setPickerOpen] = React.useState(false)

  const onStatusChangeRef = React.useRef(onStatusChange)
  React.useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  })

  const loadStatus = React.useCallback(() => {
    return api<GithubAppStatus>("/api/github/app/status")
      .then((result) => {
        setStatus(result)
        setLoadError(null)
        onStatusChangeRef.current?.(result)
      })
      .catch((err: unknown) => {
        setLoadError(errorMessage(err))
      })
  }, [])

  React.useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  async function handleStart() {
    setStarting(true)
    try {
      const start = await api<unknown>("/api/github/app/start")
      window.location.href = githubAppInstallationUrl(start)
      // Navigation leaves this page, so keep the button pending until then.
    } catch (err) {
      toast.error("Could not start GitHub setup", {
        description: errorMessage(err),
      })
      setStarting(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      await api("/api/github/app/disconnect", { method: "POST" })
      toast.success("GitHub disconnected")
      await loadStatus()
    } catch (err) {
      toast.error("Could not disconnect", { description: errorMessage(err) })
    } finally {
      setDisconnecting(false)
    }
  }

  if (loadError !== null) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-sm text-destructive">{loadError}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void loadStatus()}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (status === null) {
    return <Skeleton className={cn("w-44", compact ? "h-7" : "h-8")} />
  }

  if (!status.installed) {
    return (
      <div className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2")}>
        <div>
          <Button
            type="button"
            size={compact ? "sm" : "default"}
            disabled={starting}
            onClick={handleStart}
          >
            {starting ? (
              <Spinner />
            ) : (
              <GithubMarkIcon data-icon="inline-start" />
            )}
            Connect repository
          </Button>
        </div>
        <p
          className={cn(
            "text-muted-foreground",
            compact ? "text-xs" : "text-sm"
          )}
        >
          Select which repositories Zenod can access through the existing Zenod
          GitHub App.
        </p>
      </div>
    )
  }

  const manageUrl =
    status.slug === null
      ? null
      : `https://github.com/apps/${status.slug}/installations/new`

  return (
    <div className={cn("flex flex-col", compact ? "gap-2" : "gap-3")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">
          <CheckIcon />
          GitHub connected
        </Badge>
        {status.slug !== null && (
          <span className="font-mono text-xs text-muted-foreground">
            {status.slug}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!connectOnly && (
          <Button
            type="button"
            variant="outline"
            size={compact ? "sm" : "default"}
            onClick={() => setPickerOpen(true)}
          >
            <FolderGitIcon data-icon="inline-start" />
            Select repository
          </Button>
        )}
        {manageUrl !== null && (
          <Button asChild variant="link" size={compact ? "sm" : "default"}>
            <a href={manageUrl}>
              Manage on GitHub
              <ExternalLinkIcon data-icon="inline-end" />
            </a>
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size={compact ? "sm" : "default"}
              className="text-destructive hover:text-destructive"
              disabled={disconnecting}
            >
              {disconnecting ? <Spinner /> : null}
              Disconnect
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect GitHub?</AlertDialogTitle>
              <AlertDialogDescription>
                Zenod will stop using this GitHub installation to access your
                repository. You can manage the app&apos;s repository access on
                GitHub.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => void handleDisconnect()}
              >
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {pickerOpen && (
        <RepoPickerDialog
          onOpenChange={setPickerOpen}
          onPicked={onRepoPicked}
        />
      )}
    </div>
  )
}
