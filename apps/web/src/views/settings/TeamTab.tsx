import * as React from "react"
import { UsersIcon } from "lucide-react"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

interface TeamAgent {
  name: string
  displayName: string
  role: string
  needsVaultRepo: boolean
  enabled: boolean
}

/**
 * The Team tab — the enable surface. Enabling an agent makes the Console MINT its
 * token and provision it (token origination), then connect as a peer so the chat
 * gains `ask_<name>`. Agents come to life one at a time.
 */
export function TeamTab() {
  const [agents, setAgents] = React.useState<TeamAgent[] | null>(null)
  const [vaultRepo, setVaultRepo] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState<string | null>(null)

  const load = React.useCallback(() => {
    api<{ agents: TeamAgent[] }>("/api/team")
      .then((r) => setAgents(r.agents))
      .catch(() => setAgents([]))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  async function enable(a: TeamAgent) {
    setBusy(a.name)
    try {
      await api("/api/team/enable", {
        method: "POST",
        body: { name: a.name, vault_repo: vaultRepo[a.name] ?? "" },
      })
      toast.success(`${a.displayName} enabled`, { description: `It came to life — chat can now call ask_${a.name}.` })
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
            <div key={a.name} className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
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
                  <Button size="sm" disabled={busy === a.name} onClick={() => enable(a)}>
                    {busy === a.name ? <Spinner /> : "Enable"}
                  </Button>
                )}
              </div>
              {!a.enabled && a.needsVaultRepo && (
                <Field>
                  <FieldLabel htmlFor={`vault-${a.name}`}>Vault repo</FieldLabel>
                  <Input
                    id={`vault-${a.name}`}
                    placeholder="owner/repo"
                    value={vaultRepo[a.name] ?? ""}
                    onChange={(e) => setVaultRepo((prev) => ({ ...prev, [a.name]: e.target.value }))}
                    className="font-mono text-xs"
                  />
                </Field>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
