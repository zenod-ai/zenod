import * as React from "react"
import {
  CircleCheckIcon,
  RefreshCwIcon,
  SearchCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  isNotConfigured,
  type LintResult,
  type VaultStatus,
} from "@/lib/api"
import { GithubConnect } from "@/components/github-connect"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

function StatusRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center text-sm">{children}</span>
    </div>
  )
}

export function VaultTab() {
  const [status, setStatus] = React.useState<VaultStatus | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [notConfigured, setNotConfigured] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [syncing, setSyncing] = React.useState(false)
  const [recloning, setRecloning] = React.useState(false)
  const [linting, setLinting] = React.useState(false)
  const [lintResult, setLintResult] = React.useState<LintResult | null>(null)

  const load = React.useCallback(() => {
    api<VaultStatus>("/api/vault")
      .then((result) => {
        setStatus(result)
        setNotConfigured(!result.configured)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (isNotConfigured(err)) {
          setNotConfigured(true)
        } else {
          setLoadError(errorMessage(err))
        }
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  function reload() {
    setLoading(true)
    setNotConfigured(false)
    setLoadError(null)
    load()
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const result = await api<{ ok: boolean; headSha: string }>(
        "/api/vault/sync",
        { method: "POST" }
      )
      setStatus((previous) =>
        previous === null
          ? previous
          : { ...previous, cloned: true, headSha: result.headSha }
      )
      toast.success("Vault synced", {
        description: `HEAD is now ${result.headSha.slice(0, 10)}`,
      })
    } catch (err) {
      if (isNotConfigured(err)) {
        setNotConfigured(true)
      } else {
        toast.error("Sync failed", { description: errorMessage(err) })
      }
    } finally {
      setSyncing(false)
    }
  }

  async function handleReclone() {
    setRecloning(true)
    try {
      const result = await api<{ ok: boolean; headSha: string }>(
        "/api/vault/reclone",
        { method: "POST" }
      )
      setStatus((previous) =>
        previous === null
          ? previous
          : { ...previous, cloned: true, headSha: result.headSha }
      )
      toast.success("Vault re-cloned", {
        description: `HEAD is now ${result.headSha.slice(0, 10)}`,
      })
    } catch (err) {
      toast.error("Re-clone failed", { description: errorMessage(err) })
    } finally {
      setRecloning(false)
    }
  }

  async function handleLint() {
    setLinting(true)
    setLintResult(null)
    try {
      const result = await api<LintResult>("/api/vault/lint")
      setLintResult(result)
    } catch (err) {
      toast.error("Lint failed", { description: errorMessage(err) })
    } finally {
      setLinting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  if (notConfigured) {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>Vault not configured</AlertTitle>
          <AlertDescription>
            Connect GitHub below and pick a vault repository, or add a GitHub
            token and repository in the Keys &amp; models tab.
          </AlertDescription>
        </Alert>
        <GithubConnect onRepoPicked={() => reload()} />
      </div>
    )
  }

  if (loadError !== null || status === null) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Could not load vault status</AlertTitle>
        <AlertDescription>{loadError ?? "Unknown error"}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Vault</CardTitle>
          <CardDescription>
            The git repository where Zenod stores its memory.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <StatusRow label="Repository">
            <span className="truncate font-mono text-xs">
              {status.repo ?? "—"}
            </span>
          </StatusRow>
          <Separator />
          <StatusRow label="Branch">
            <span className="font-mono text-xs">{status.branch ?? "—"}</span>
          </StatusRow>
          <Separator />
          <StatusRow label="Status">
            <Badge variant={status.cloned ? "secondary" : "outline"}>
              {status.cloned ? "Cloned" : "Not cloned"}
            </Badge>
          </StatusRow>
          <Separator />
          <StatusRow label="HEAD">
            <span className="truncate font-mono text-xs">
              {status.headSha === null ? "—" : status.headSha.slice(0, 10)}
            </span>
          </StatusRow>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button disabled={syncing} onClick={handleSync}>
            {syncing ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
            Sync now
          </Button>
          <Button variant="outline" disabled={linting} onClick={handleLint}>
            {linting ? (
              <Spinner />
            ) : (
              <SearchCheckIcon data-icon="inline-start" />
            )}
            Run lint
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={recloning}>
                {recloning ? <Spinner /> : null}
                Re-clone
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Re-clone the vault?</AlertDialogTitle>
                <AlertDialogDescription>
                  This deletes the local working copy and clones the repository
                  again from GitHub. Any unpushed local state is lost.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={handleReclone}
                >
                  Re-clone
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      </Card>

      {lintResult !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Lint results</CardTitle>
            <CardDescription>
              Checked {lintResult.checkedFiles}{" "}
              {lintResult.checkedFiles === 1 ? "file" : "files"}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {lintResult.ok ? (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CircleCheckIcon />
                  </EmptyMedia>
                  <EmptyTitle>Vault is clean</EmptyTitle>
                  <EmptyDescription>No schema issues found.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex flex-col gap-3">
                {lintResult.errors.map((issue, index) => (
                  <div key={index} className="flex flex-col gap-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">
                        {issue.path}
                        {issue.line !== undefined ? `:${issue.line}` : ""}
                      </span>
                      <Badge variant="outline">{issue.rule}</Badge>
                    </div>
                    <p className="text-muted-foreground">{issue.message}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
