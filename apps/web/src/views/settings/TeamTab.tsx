import * as React from "react"
import { UsersIcon } from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  type GithubAppStatus,
  type GithubRepo,
  type GithubReposResponse,
} from "@/lib/api"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

interface TeamAgent {
  name: string
  displayName: string
  role: string
  needsRepo: boolean
  repoLabel: string
  enabled: boolean
}

/**
 * The dialog that opens when enabling an agent that needs a vault repo: it uses
 * the Console's GitHub connection to list repos and let you pick one — no typing.
 */
function EnableDialog({
  agent,
  busy,
  onClose,
  onEnable,
}: {
  agent: TeamAgent
  busy: boolean
  onClose: () => void
  onEnable: (vaultRepo: string, vaultBranch: string) => void
}) {
  const [connected, setConnected] = React.useState<boolean | null>(null)
  const [repos, setRepos] = React.useState<GithubRepo[] | null>(null)
  const [filter, setFilter] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    api<GithubAppStatus>("/api/github/app/status")
      .then((s) => {
        if (cancelled) return
        setConnected(s.installed)
        if (!s.installed) return
        return api<GithubReposResponse>("/api/github/repos").then((r) => {
          if (!cancelled) setRepos(r.repositories)
        })
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered =
    repos?.filter((r) => r.fullName.toLowerCase().includes(filter.trim().toLowerCase())) ?? []

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enable {agent.displayName}</DialogTitle>
          <DialogDescription>Pick the repo it should use as its {agent.repoLabel}.</DialogDescription>
        </DialogHeader>
        {error !== null && <p className="text-sm text-destructive">{error}</p>}
        {connected === false && (
          <p className="text-sm text-muted-foreground">
            Connect GitHub in the <span className="font-medium">Connections</span> tab first, then
            reopen this.
          </p>
        )}
        {connected === null && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        {connected && (
          <div className="flex flex-col gap-3">
            <Input
              placeholder="Filter repositories…"
              autoComplete="off"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {repos === null ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {repos.length === 0 ? "No repositories granted to the GitHub App." : "No matches."}
              </p>
            ) : (
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {filtered.map((r) => (
                  <button
                    key={r.fullName}
                    type="button"
                    disabled={busy}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    onClick={() => onEnable(r.fullName, r.defaultBranch)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-xs">{r.fullName}</span>
                      {r.private && <Badge variant="outline">private</Badge>}
                    </span>
                    {busy ? (
                      <Spinner className="size-3.5 shrink-0" />
                    ) : (
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.defaultBranch}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The Team tab — the enable surface. Enabling an agent makes the Console MINT its
 * token and provision it (token origination), then connect it so the chat gains
 * `ask_<name>`. Agents that need a vault pick their repo from the GitHub connection.
 */
export function TeamTab() {
  const [agents, setAgents] = React.useState<TeamAgent[] | null>(null)
  const [enabling, setEnabling] = React.useState<TeamAgent | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  const load = React.useCallback(() => {
    api<{ agents: TeamAgent[] }>("/api/team")
      .then((r) => setAgents(r.agents))
      .catch(() => setAgents([]))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  async function doEnable(a: TeamAgent, vaultRepo: string, vaultBranch: string) {
    setBusy(a.name)
    try {
      await api("/api/team/enable", {
        method: "POST",
        body: { name: a.name, vault_repo: vaultRepo, vault_branch: vaultBranch },
      })
      toast.success(`${a.displayName} enabled`, { description: `It came to life — chat can now call ask_${a.name}.` })
      setEnabling(null)
      load()
    } catch (err) {
      toast.error(`Could not enable ${a.displayName}`, { description: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  async function disable(a: TeamAgent) {
    setBusy(a.name)
    try {
      await api("/api/team/disable", { method: "POST", body: { name: a.name } })
      toast.success(`${a.displayName} disabled`)
      load()
    } catch (err) {
      toast.error(`Could not disable ${a.displayName}`, { description: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <UsersIcon className="size-5 text-muted-foreground" />
        <CardTitle>Team</CardTitle>
        <CardDescription>
          Enable suite agents one at a time. Enabling mints the agent&apos;s token, provisions it,
          and connects it — its <span className="font-mono">ask_&lt;name&gt;</span> tool comes to life in the chat.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {agents === null ? (
          <Spinner />
        ) : (
          agents.map((a) => (
            <div key={a.name} className="flex items-center justify-between gap-3 rounded-lg border p-4">
              <div className="flex min-w-0 flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{a.displayName}</span>
                  {a.enabled ? (
                    <Badge variant="secondary" className="font-mono">ask_{a.name} ✓</Badge>
                  ) : (
                    <Badge variant="outline">off</Badge>
                  )}
                </div>
                <span className="text-sm text-muted-foreground">{a.role}</span>
              </div>
              {a.enabled ? (
                <Button variant="ghost" size="sm" disabled={busy === a.name} onClick={() => disable(a)}>
                  {busy === a.name ? <Spinner /> : "Disable"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={busy === a.name}
                  onClick={() => (a.needsRepo ? setEnabling(a) : doEnable(a, "", ""))}
                >
                  {busy === a.name ? <Spinner /> : "Enable"}
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>
      {enabling && (
        <EnableDialog
          agent={enabling}
          busy={busy === enabling.name}
          onClose={() => setEnabling(null)}
          onEnable={(repo, branch) => doEnable(enabling, repo, branch)}
        />
      )}
    </Card>
  )
}
