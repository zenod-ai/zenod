import * as React from "react"

import { api, errorMessage, type GithubAppStatus } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

/**
 * Minimal diagnostics tab: one OAuth button that authorizes the existing
 * GitHub App on another account/repo. After authorizing, cross-repo access is
 * verified offline (create a probe issue in two repos). Intentionally simple —
 * it reuses the install URL the Connections tab already uses.
 */
export function TestTab() {
  const [status, setStatus] = React.useState<GithubAppStatus | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    api<GithubAppStatus>("/api/github/app/status")
      .then((result) => {
        if (!cancelled) setStatus(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const installUrl =
    status?.slug != null
      ? `https://github.com/apps/${status.slug}/installations/new`
      : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">
          GitHub access test
        </h2>
        <p className="text-sm text-muted-foreground">
          Authorize the GitHub App on another account or repo via OAuth, then
          cross-repo access is verified offline.
        </p>
      </div>

      {error !== null && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
        <span>app: {status?.slug ?? "…"}</span>
        <span>installed: {status ? (status.installed ? "yes" : "no") : "…"}</span>
        <span>installation_id: {status?.installationId ?? "—"}</span>
      </div>

      <div>
        <Button
          type="button"
          disabled={installUrl === null}
          onClick={() => {
            if (installUrl !== null) window.location.href = installUrl
          }}
        >
          {status === null ? <Spinner /> : null}
          Authorize on GitHub (OAuth)
        </Button>
      </div>
    </div>
  )
}
