import * as React from "react"
import {
  CheckCircle2Icon,
  CopyIcon,
  ExternalLinkIcon,
  GaugeIcon,
  LogOutIcon,
  ReceiptTextIcon,
  SendIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type Me = { login: string; avatar_url: string }
type Account = {
  mcp_url: string
  token: string
  tier: string | null
  subscription_status: string | null
  ledger: { calls: number; tokens: number; costUsd: number }
}
type XStatus = {
  connected: boolean
  username: string
  credential_suffixes: Record<string, string>
  pin_required: boolean
  authorize_url: string
}
type DashboardStatus = {
  x: XStatus
  throttle: { limit_per_hour: number }
  usage: { usage?: { calls: number | null; sends: number | null; cost_usd: number | null }; source?: string }
  observed_usage?: { calls: number; sends: number; rejected_drafts: number; throttled: number }
  drafts: { available: boolean; records: Array<{ id?: string; text?: string; created_at?: string }>; source?: string }
  receipts: { available: boolean; records: Array<{ id?: string; url?: string; text?: string; created_at?: string }>; source?: string }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `HTTP ${response.status}`)
  return response.json() as Promise<T>
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void navigator.clipboard.writeText(value).then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      })}
    >
      <CopyIcon /> {copied ? "Copied" : label}
    </Button>
  )
}

function ConnectX({ status, reload }: { status: XStatus; reload: () => Promise<void> }) {
  const [values, setValues] = React.useState({
    X_OAUTH_CONSUMER_KEY: "",
    X_OAUTH_CONSUMER_SECRET: "",
    X_BEARER_TOKEN: "",
  })
  const [pin, setPin] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await json<{ authorize_url?: string; pin_required?: boolean }>("/api/callisthenes/x/app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      if (result.authorize_url) window.open(result.authorize_url, "_blank", "noopener,noreferrer")
      await reload()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not start X authorization")
    } finally {
      setBusy(false)
    }
  }

  async function submitPin(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await json("/api/callisthenes/x/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      })
      setPin("")
      await reload()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not finish X authorization")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="rounded-none">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>Connect X</span>
          {status.connected ? <span className="flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2Icon className="size-4" />Connected ✓{status.username ? ` @${status.username}` : ""}</span> : null}
        </CardTitle>
        <CardDescription>Paste the three values from X’s Application Created screen. Posting tokens remain in this tenant’s custody.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form className="grid gap-4" onSubmit={submitCredentials}>
          {[
            ["X_OAUTH_CONSUMER_KEY", "Consumer Key / API Key"],
            ["X_OAUTH_CONSUMER_SECRET", "Secret Key / API Key Secret"],
            ["X_BEARER_TOKEN", "Bearer Token"],
          ].map(([name, label]) => (
            <label key={name} className="grid gap-1.5 text-sm">
              <span>{label}</span>
              <input
                required={!status.connected}
                type={name === "X_OAUTH_CONSUMER_KEY" ? "text" : "password"}
                autoComplete="off"
                value={values[name as keyof typeof values]}
                onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))}
                className="h-10 border border-input bg-background px-3 font-mono text-sm"
              />
            </label>
          ))}
          <Button type="submit" disabled={busy}>{busy ? "Starting…" : status.connected ? "Reconnect / Authorize" : "Authorize on X"}<ExternalLinkIcon /></Button>
        </form>

        {status.pin_required ? (
          <form className="border-t border-border pt-5" onSubmit={submitPin}>
            <p className="mb-3 text-sm">After approving on X, paste the one-time PIN.</p>
            <div className="flex gap-2">
              <input required inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} className="h-10 min-w-0 flex-1 border border-input bg-background px-3 font-mono" placeholder="One-time PIN" />
              <Button type="submit" disabled={busy}>Finish connection</Button>
            </div>
          </form>
        ) : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  )
}

export default function App() {
  const [me, setMe] = React.useState<Me | null>(null)
  const [account, setAccount] = React.useState<Account | null>(null)
  const [status, setStatus] = React.useState<DashboardStatus | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const reload = React.useCallback(async () => {
    const [nextMe, nextAccount, nextStatus] = await Promise.all([
      json<Me>("/api/me"),
      json<Account>("/api/console/account"),
      json<DashboardStatus>("/api/callisthenes/status"),
    ])
    setMe(nextMe)
    setAccount(nextAccount)
    setStatus(nextStatus)
  }, [])

  React.useEffect(() => {
    void reload().catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Dashboard unavailable")).finally(() => setLoading(false))
  }, [reload])

  if (loading) return <main className="grid min-h-svh place-items-center text-sm text-muted-foreground">Loading…</main>
  if (!me || !account || !status) return <main className="grid min-h-svh place-items-center p-6 text-sm">{error || "Your Callisthenes subscription is not active."}</main>

  const codex = `codex mcp add callisthenes --url ${account.mcp_url} --bearer ${account.token}`
  const claude = `claude mcp add --transport http callisthenes ${account.mcp_url} --header "Authorization: Bearer ${account.token}"`
  const usage = status.usage.usage

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-5 p-5 sm:p-8">
      <header className="flex items-center justify-between gap-4 border-b border-border pb-4">
        <div><a href="/" className="text-sm text-muted-foreground hover:text-foreground">← Callisthenes landing</a><h1 className="mt-1 text-2xl font-semibold">One mouth for your agents</h1><p className="text-sm text-muted-foreground">@{me.login}</p></div>
        <Button variant="ghost" onClick={() => window.location.assign("/auth/signout")}><LogOutIcon />Log out</Button>
      </header>

      <Card className="rounded-none border-2">
        <CardHeader><CardTitle>MCP connection</CardTitle><CardDescription>Give this tenant-scoped credential only to agents allowed to draft and request sends.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2"><span className="text-xs uppercase tracking-wider text-muted-foreground">MCP URL</span><div className="flex gap-2"><code className="min-w-0 flex-1 overflow-x-auto border bg-muted p-3 text-xs">{account.mcp_url}</code><CopyButton value={account.mcp_url} label="Copy URL" /></div></div>
          <div className="grid gap-2"><span className="text-xs uppercase tracking-wider text-muted-foreground">Token</span><div className="flex gap-2"><code className="min-w-0 flex-1 overflow-x-auto border bg-muted p-3 text-xs">{account.token}</code><CopyButton value={account.token} label="Copy token" /></div></div>
          {[{ label: "Codex", value: codex }, { label: "Claude", value: claude }].map((snippet) => <div key={snippet.label} className="grid gap-2"><span className="text-xs uppercase tracking-wider text-muted-foreground">{snippet.label}</span><div className="flex gap-2"><code className="min-w-0 flex-1 overflow-x-auto border bg-muted p-3 text-xs">{snippet.value}</code><CopyButton value={snippet.value} label="Copy" /></div></div>)}
        </CardContent>
      </Card>

      <ConnectX status={status.x} reload={reload} />

      <div className="grid gap-5 md:grid-cols-2">
        <Card className="rounded-none"><CardHeader><CardTitle className="flex items-center gap-2"><GaugeIcon />Throttle & usage</CardTitle><CardDescription>Tenant-scoped send control and ledger.</CardDescription></CardHeader><CardContent className="grid grid-cols-2 gap-4 text-sm"><div><p className="text-muted-foreground">Hourly cap</p><p className="text-2xl font-semibold">{status.throttle.limit_per_hour}</p></div><div><p className="text-muted-foreground">Approved sends</p><p className="text-2xl font-semibold">{status.observed_usage?.sends ?? usage?.sends ?? "—"}</p></div><div><p className="text-muted-foreground">Calls</p><p>{status.observed_usage?.calls ?? usage?.calls ?? account.ledger.calls}</p></div><div><p className="text-muted-foreground">Throttled</p><p>{status.observed_usage?.throttled ?? 0}</p></div><div><p className="text-muted-foreground">Cost</p><p>{usage?.cost_usd == null ? "Not measured" : `$${usage.cost_usd.toFixed(4)}`}</p></div></CardContent></Card>
        <Card className="rounded-none"><CardHeader><CardTitle className="flex items-center gap-2"><SendIcon />Drafts</CardTitle><CardDescription>Read-only. Approve sends through MCP `approve_send`.</CardDescription></CardHeader><CardContent>{status.drafts.records.length ? status.drafts.records.map((draft, index) => <article key={draft.id ?? index} className="border-t py-3 text-sm">{draft.text}</article>) : <p className="text-sm text-muted-foreground">{status.drafts.available ? "No held drafts yet." : "Draft history is not persisted by the current engine."}</p>}</CardContent></Card>
      </div>

      <Card className="rounded-none"><CardHeader><CardTitle className="flex items-center gap-2"><ReceiptTextIcon />Receipts</CardTitle><CardDescription>Canonical permalinks returned after approved sends.</CardDescription></CardHeader><CardContent>{status.receipts.records.length ? status.receipts.records.map((receipt, index) => <article key={receipt.id ?? index} className="border-t py-3 text-sm">{receipt.url ? <a href={receipt.url} className="underline" target="_blank" rel="noreferrer">{receipt.url}</a> : receipt.text}</article>) : <p className="text-sm text-muted-foreground">{status.receipts.available ? "No send receipts yet." : "Receipt history is not persisted by the current engine."}</p>}</CardContent></Card>
    </main>
  )
}
