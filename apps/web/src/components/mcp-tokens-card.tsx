import * as React from "react"
import { CopyIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type McpToken = {
  id: string
  label: string
  preview: string
  created_at: number
  last_used_at: number | null
  revoked_at: number | null
}

type CreatedToken = McpToken & { token: string; mcp_url: string }

function formatWhen(epochMs: number | null): string {
  return epochMs === null ? "never" : new Date(epochMs).toLocaleString()
}

/**
 * Static MCP tokens for headless clients and shared configs. The plaintext is
 * returned once at creation and is never retrievable again.
 */
export function McpTokensCard({ mcpUrl }: { mcpUrl: string }) {
  const [tokens, setTokens] = React.useState<McpToken[]>([])
  const [label, setLabel] = React.useState("")
  const [created, setCreated] = React.useState<CreatedToken | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    const response = await fetch("/api/account/mcp-tokens")
    if (!response.ok) throw new Error("Could not load MCP tokens")
    const body = (await response.json()) as { tokens: McpToken[] }
    setTokens(body.tokens)
  }, [])

  React.useEffect(() => {
    load().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "Could not load MCP tokens")
    )
  }, [load])

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!label.trim()) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/account/mcp-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
      })
      if (!response.ok) throw new Error("Could not create the token")
      setCreated((await response.json()) as CreatedToken)
      setCopied(false)
      setLabel("")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the token")
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    setError(null)
    const response = await fetch(`/api/account/mcp-tokens/${id}`, {
      method: "DELETE",
    })
    if (!response.ok) {
      setError("Could not revoke the token")
      return
    }
    if (created?.id === id) setCreated(null)
    await load()
  }

  return (
    <Card className="rounded-none">
      <CardHeader>
        <CardTitle>MCP tokens</CardTitle>
        <CardDescription>
          For headless clients or a shared config that cannot sign in with
          OAuth. Send as <code>Authorization: Bearer &lt;token&gt;</code> to{" "}
          <code>{mcpUrl}</code>. Each token has full access to your Zenod;
          revoke any you no longer use.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="flex gap-2" onSubmit={(e) => void create(e)}>
          <Input
            aria-label="Token label"
            placeholder="Label, e.g. Work laptop"
            value={label}
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button type="submit" disabled={busy || !label.trim()}>
            Create token
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {created && (
          <div className="border border-border p-3 text-sm">
            <p className="font-medium">
              Copy this token now. It will not be shown again.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto bg-muted p-2 text-xs">
                {created.token}
              </code>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Copy token"
                onClick={() => {
                  void navigator.clipboard.writeText(created.token).then(() => {
                    setCopied(true)
                  })
                }}
              >
                <CopyIcon />
                <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setCreated(null)}
            >
              I have saved it
            </Button>
          </div>
        )}
        {tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">No MCP tokens yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {tokens.map((token) => (
              <li
                key={token.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {token.label}{" "}
                    <code className="text-xs text-muted-foreground">
                      {token.preview}
                    </code>
                    {token.revoked_at !== null && (
                      <span className="ml-2 text-xs text-destructive">
                        revoked
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created {formatWhen(token.created_at)} · Last used{" "}
                    {formatWhen(token.last_used_at)}
                  </p>
                </div>
                {token.revoked_at === null && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => void revoke(token.id)}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
