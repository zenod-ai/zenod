import * as React from "react"
import {
  CircleCheckIcon,
  ExternalLinkIcon,
  FolderIcon,
  RefreshCwIcon,
  SearchCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  isNotConfigured,
  providerLabel,
  type LintResult,
  type VaultCapabilityProjection,
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
import type { ZenodEdition } from "@/views/zenod-edition"

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

export function VaultTab({
  allowReclone = true,
  edition = "self-hosted",
}: {
  allowReclone?: boolean
  edition?: ZenodEdition
}) {
  const [status, setStatus] = React.useState<VaultStatus | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [notConfigured, setNotConfigured] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [syncing, setSyncing] = React.useState(false)
  const [recloning, setRecloning] = React.useState(false)
  const [linting, setLinting] = React.useState(false)
  const [lintResult, setLintResult] = React.useState<LintResult | null>(null)
  const [vault, setVault] = React.useState<VaultCapabilityProjection | null>(
    null
  )
  const [identityProviders, setIdentityProviders] = React.useState<
    Array<"github" | "google">
  >([])
  const [vaultBusy, setVaultBusy] = React.useState<
    "drive" | "recover" | "disconnect" | "github" | null
  >(null)

  const load = React.useCallback(() => {
    const hostedProjection =
      edition === "hosted"
        ? Promise.all([
            api<VaultCapabilityProjection>("/api/vault/provider"),
            api<{ providers?: Array<"github" | "google"> }>("/api/me"),
          ])
        : Promise.resolve(null)
    Promise.all([api<VaultStatus>("/api/vault"), hostedProjection])
      .then(([result, hosted]) => {
        setStatus(result)
        setNotConfigured(edition === "hosted" ? false : !result.vaultConfigured)
        if (hosted) {
          setVault(hosted[0])
          setIdentityProviders(hosted[1].providers ?? [])
        }
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
  }, [edition])

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

  function trustedProviderUrl(
    payload: unknown,
    provider: "google" | "github"
  ): string {
    const candidate =
      typeof payload === "object" && payload !== null
        ? (payload as { url?: unknown }).url
        : null
    if (typeof candidate !== "string")
      throw new Error("Authorization did not return a destination")
    const url = new URL(candidate)
    const valid =
      provider === "google"
        ? url.protocol === "https:" &&
          url.hostname === "accounts.google.com" &&
          url.pathname === "/o/oauth2/v2/auth"
        : url.protocol === "https:" &&
          url.hostname === "github.com" &&
          url.pathname === "/login/oauth/authorize"
    if (!valid) throw new Error("Authorization returned an invalid destination")
    return url.toString()
  }

  async function startDriveVault() {
    setVaultBusy("drive")
    try {
      const result = await api<unknown>("/api/vault/drive/oauth/start", {
        method: "POST",
        body: { intent: "connect_drive_vault" },
      })
      window.location.assign(trustedProviderUrl(result, "google"))
    } catch (err) {
      toast.error("Could not start Google Drive setup", {
        description: errorMessage(err),
      })
      setVaultBusy(null)
    }
  }

  async function recoverDriveVault() {
    setVaultBusy("recover")
    try {
      await api("/api/vault/drive/recover", { method: "POST" })
      toast.success("Drive vault recovered")
      reload()
    } catch (err) {
      toast.error("Drive vault still needs attention", {
        description: errorMessage(err),
      })
    } finally {
      setVaultBusy(null)
    }
  }

  async function disconnectDriveVault() {
    setVaultBusy("disconnect")
    try {
      await api("/api/vault/drive/disconnect", { method: "POST" })
      toast.success("Drive permission disconnected", {
        description:
          "Your files remain in Google Drive. Reconnect to use this vault again.",
      })
      reload()
    } catch (err) {
      toast.error("Could not finish disconnecting Drive", {
        description: errorMessage(err),
      })
    } finally {
      setVaultBusy(null)
    }
  }

  async function linkGithubIdentity() {
    setVaultBusy("github")
    try {
      const result = await api<unknown>("/api/auth/providers/github/link", {
        method: "POST",
        body: { intent: "link_identity" },
      })
      window.location.assign(trustedProviderUrl(result, "github"))
    } catch (err) {
      toast.error("Could not start GitHub connection", {
        description: errorMessage(err),
      })
      setVaultBusy(null)
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

  if (edition === "hosted" && vault !== null) {
    const drive = vault.provider === "google_drive"
    const legacyGithub =
      vault.provider === null && Boolean(status?.vaultConfigured && status.repo)
    const github = vault.provider === "github" || legacyGithub
    const repositoryVerified = Boolean(status?.cloned && !status.cloneError)
    const ready = Boolean((vault.ready || legacyGithub) && repositoryVerified)
    const providerName = drive ? "Google Drive" : github ? "GitHub" : null
    const blocker =
      vault.ready && !repositoryVerified ? "vault_error" : vault.blocker
    const blockerCopy =
      blocker === "vault_authorization_required"
        ? drive
          ? "Google Drive permission is missing or expired. Reconnect the same vault to restore access."
          : "GitHub permission is missing or expired. Reconnect the GitHub App and repository to restore access."
        : blocker === "vault_recovering"
          ? drive
            ? "Zenod is rebuilding and verifying the vault from Drive. Memory stays unavailable until recovery finishes."
            : "Zenod is cloning and verifying the GitHub repository. Memory stays unavailable until verification finishes."
          : blocker === "vault_conflict"
            ? drive
              ? "A Drive edit overlapped a Zenod save. Review the preserved files in Drive, then retry recovery."
              : "The GitHub repository state needs review before Zenod can safely continue. Review the repository, then reconnect it."
            : blocker === "vault_error"
              ? drive
                ? `Zenod could not verify the durable Drive vault${status?.cloneError ? `: ${status.cloneError}` : "."} Retry recovery or reconnect Drive permission.`
                : `Zenod could not verify the durable GitHub vault${status?.cloneError ? `: ${status.cloneError}` : "."} Reconnect the GitHub App or repository.`
              : null

    const callbackStatus = new URLSearchParams(window.location.search).get(
      "vault"
    )
    const driveAuthorizationDenied = callbackStatus === "drive_denied"
    const driveAuthorizationExpired =
      callbackStatus === "drive_expired" || callbackStatus === "drive_session"
    const driveAuthorizationFailed =
      callbackStatus === "drive_tenant" ||
      callbackStatus === "drive_config" ||
      callbackStatus === "drive_exchange" ||
      callbackStatus === "drive_bootstrap"

    return (
      <div className="flex flex-col gap-4">
        {driveAuthorizationDenied ? (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>Google Drive permission was not granted</AlertTitle>
            <AlertDescription>
              Nothing changed. Use Google Drive or reconnect Drive below to try
              again.
            </AlertDescription>
          </Alert>
        ) : null}
        {driveAuthorizationExpired ? (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>Google Drive setup link expired</AlertTitle>
            <AlertDescription>
              Return here after signing in, then use Google Drive or reconnect
              Drive below to start a fresh, secure setup.
            </AlertDescription>
          </Alert>
        ) : null}
        {driveAuthorizationFailed ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Google Drive setup needs attention</AlertTitle>
            <AlertDescription>
              Your secure setup did not finish. Use the recovery or reconnect
              action below; your existing Drive files remain unchanged.
            </AlertDescription>
          </Alert>
        ) : null}
        {vault.provider === null && !legacyGithub ? (
          <Alert>
            <FolderIcon />
            <AlertTitle>Choose where Zenod keeps your vault</AlertTitle>
            <AlertDescription>
              This choice is authoritative and cannot be switched automatically
              later. Both options keep the same Markdown memory experience.
            </AlertDescription>
          </Alert>
        ) : null}

        {blockerCopy ? (
          <Alert
            variant={
              blocker === "vault_conflict" || blocker === "vault_error"
                ? "destructive"
                : "default"
            }
          >
            <TriangleAlertIcon />
            <AlertTitle>
              {blocker === "vault_conflict"
                ? drive
                  ? "Drive conflict needs review"
                  : "GitHub vault conflict needs review"
                : blocker === "vault_recovering"
                  ? drive
                    ? "Recovering your Drive vault"
                    : "Preparing your GitHub vault"
                  : blocker === "vault_error"
                    ? drive
                      ? "Drive vault needs recovery"
                      : "GitHub vault needs attention"
                    : drive
                      ? "Reconnect Google Drive"
                      : "Reconnect GitHub"}
            </AlertTitle>
            <AlertDescription>{blockerCopy}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          {(vault.provider === null && !legacyGithub) || drive ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Google Drive
                  {drive ? (
                    <Badge variant={ready ? "secondary" : "outline"}>
                      {ready ? "Ready" : "Needs attention"}
                    </Badge>
                  ) : null}
                </CardTitle>
                <CardDescription>
                  Ordinary Markdown files in a private Zenod Vault folder you
                  own, with real Git history stored in its repository bundle.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Zenod requests Drive access separately and can access only
                  files and folders it creates or you explicitly select.
                </p>
                {drive && status?.headSha ? (
                  <p>
                    Git HEAD{" "}
                    <span className="font-mono text-xs text-foreground">
                      {status.headSha.slice(0, 10)}
                    </span>
                  </p>
                ) : null}
              </CardContent>
              <CardFooter className="flex-wrap gap-2">
                {vault.provider === null ||
                blocker === "vault_authorization_required" ||
                blocker === "vault_error" ? (
                  <Button
                    disabled={vaultBusy !== null}
                    onClick={() => void startDriveVault()}
                  >
                    {vaultBusy === "drive" ? <Spinner /> : null}
                    {drive ? "Reconnect Drive" : "Use Google Drive"}
                  </Button>
                ) : null}
                {drive &&
                (blocker === "vault_recovering" ||
                  blocker === "vault_conflict" ||
                  blocker === "vault_error") ? (
                  <Button
                    variant="outline"
                    disabled={vaultBusy !== null}
                    onClick={() => void recoverDriveVault()}
                  >
                    {vaultBusy === "recover" ? (
                      <Spinner />
                    ) : (
                      <RefreshCwIcon data-icon="inline-start" />
                    )}
                    Retry recovery
                  </Button>
                ) : null}
                {drive && ready ? (
                  <Button
                    variant="outline"
                    disabled={syncing}
                    onClick={handleSync}
                  >
                    {syncing ? (
                      <Spinner />
                    ) : (
                      <RefreshCwIcon data-icon="inline-start" />
                    )}
                    Refresh from Drive
                  </Button>
                ) : null}
                {drive || (vault.provider === null && !legacyGithub) ? (
                  <Button asChild variant="link">
                    <a
                      href="https://drive.google.com/drive/my-drive"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Google Drive
                      <ExternalLinkIcon data-icon="inline-end" />
                    </a>
                  </Button>
                ) : null}
              </CardFooter>
            </Card>
          ) : null}

          {vault.provider === null || github ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  GitHub
                  {github ? (
                    <Badge variant={ready ? "secondary" : "outline"}>
                      {ready ? "Ready" : "Setup needed"}
                    </Badge>
                  ) : null}
                </CardTitle>
                <CardDescription>
                  Keep the existing repository, branch, commit, and GitHub App
                  workflow.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {identityProviders.includes("github") ? (
                  <GithubConnect onRepoPicked={() => reload()} />
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Connect a GitHub sign-in identity first, then choose a
                      repository. Your Google sign-in remains available.
                    </p>
                    <Button
                      variant="outline"
                      disabled={vaultBusy !== null}
                      onClick={() => void linkGithubIdentity()}
                    >
                      {vaultBusy === "github" ? <Spinner /> : null}
                      Connect GitHub identity
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        {drive ? (
          <Card>
            <CardHeader>
              <CardTitle>Drive permission</CardTitle>
              <CardDescription>
                Disconnecting stops Zenod access but never deletes your Drive
                files.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={vaultBusy !== null}>
                    Disconnect Drive permission
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Disconnect Google Drive?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Zenod memory will stop until you reconnect. Your Markdown
                      files and Git bundle stay in your Google Drive.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => void disconnectDriveVault()}
                    >
                      Disconnect permission
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardFooter>
          </Card>
        ) : null}

        {ready ? (
          <Card>
            <CardHeader>
              <CardTitle>Memory readiness</CardTitle>
              <CardDescription>
                {providerName} is the durable authority for this vault.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {Object.entries(vault.memory).map(([capability, ready]) => (
                <Badge
                  key={capability}
                  variant={ready ? "secondary" : "outline"}
                >
                  {capability}
                </Badge>
              ))}
            </CardContent>
            <CardFooter>
              <Button variant="outline" disabled={linting} onClick={handleLint}>
                {linting ? (
                  <Spinner />
                ) : (
                  <SearchCheckIcon data-icon="inline-start" />
                )}
                Run lint
              </Button>
            </CardFooter>
          </Card>
        ) : null}

        {lintResult !== null ? (
          <Alert variant={lintResult.ok ? "default" : "destructive"}>
            {lintResult.ok ? <CircleCheckIcon /> : <TriangleAlertIcon />}
            <AlertTitle>
              {lintResult.ok ? "Vault is clean" : "Vault lint found issues"}
            </AlertTitle>
            <AlertDescription>
              Checked {lintResult.checkedFiles}{" "}
              {lintResult.checkedFiles === 1 ? "file" : "files"}.
            </AlertDescription>
          </Alert>
        ) : null}
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
            {edition === "hosted"
              ? "Connect GitHub below and choose the repository Zenod will use as your durable vault."
              : "Connect GitHub below and pick a vault repository, or add a GitHub token and repository in Settings."}
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
      {!status.llmReady && (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>
            {edition === "hosted"
              ? "Managed AI needs attention"
              : `Add your ${providerLabel(status.provider)} API key`}
          </AlertTitle>
          <AlertDescription>
            {edition === "hosted"
              ? "The vault is connected, but managed processing is not ready. No provider credentials are required from you."
              : `The vault is connected, but storing and asking need your ${providerLabel(status.provider)} API key. Add it in Settings to finish setup.`}
          </AlertDescription>
        </Alert>
      )}
      {status.cloneError !== null && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Could not reach the vault repository</AlertTitle>
          <AlertDescription>{status.cloneError}</AlertDescription>
        </Alert>
      )}
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
          {allowReclone && (
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
                    This deletes the local working copy and clones the
                    repository again from GitHub. Any unpushed local state is
                    lost.
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
          )}
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GitHub connection</CardTitle>
          <CardDescription>
            The GitHub App Zenod uses to reach this repository. Disconnect to
            re-pair — e.g. to grant new permissions like managing issues.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GithubConnect onRepoPicked={() => reload()} />
        </CardContent>
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
