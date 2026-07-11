import * as React from "react"
import { NetworkIcon, Trash2Icon } from "lucide-react"
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

interface Peer {
  name: string
  url: string
  tool: string
  hasToken: boolean
  status: "connected" | "error"
}

/**
 * My Units wallet: downstream agents this Council can delegate to. Each becomes an `ask_<name>`
 * tool in the chat — e.g. the vaultless Console asks Zenod for memory. The token
 * is write-only (never returned by the API); we only show whether one is set.
 */
export function PeerAgents() {
  const [peers, setPeers] = React.useState<Peer[] | null>(null)
  const [name, setName] = React.useState("")
  const [url, setUrl] = React.useState("")
  const [token, setToken] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    api<{ peers: Peer[] }>("/api/peers")
      .then((r) => setPeers(r.peers))
      .catch(() => setPeers([]))
  }, [])

  async function save(next: Array<{ name: string; url: string; token?: string; tool?: string }>) {
    setSaving(true)
    try {
      const r = await api<{ peers: Peer[] }>("/api/peers", { method: "PUT", body: { peers: next } })
      setPeers(r.peers)
      return true
    } catch (err) {
      toast.error("Could not save units", { description: errorMessage(err) })
      return false
    } finally {
      setSaving(false)
    }
  }

  async function addPeer(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !url.trim() || !token.trim()) return
    // Existing peers are sent without their token (the server keeps it by name);
    // the new peer carries its token.
    const next = [
      ...(peers ?? []).map((p) => ({ name: p.name, url: p.url, tool: p.tool })),
      { name: name.trim(), url: url.trim(), token: token.trim(), tool: "ask_brain" },
    ]
    if (await save(next)) {
      setName("")
      setUrl("")
      setToken("")
      toast.success(`Unit "${name.trim()}" connected`, { description: `The Council can now route work to it.` })
    }
  }

  async function removePeer(target: string) {
    const next = (peers ?? [])
      .filter((p) => p.name !== target)
      .map((p) => ({ name: p.name, url: p.url, tool: p.tool }))
    if (await save(next)) toast.success(`Unit "${target}" removed`)
  }

  return (
    <Card>
      <CardHeader>
        <NetworkIcon className="size-5 text-muted-foreground" />
        <CardTitle>My Units</CardTitle>
        <CardDescription>
          Wire the Council to your agents with their MCP URL and downstream token.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {peers === null ? (
          <Spinner />
        ) : peers.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <NetworkIcon />
              </EmptyMedia>
              <EmptyTitle>No units yet</EmptyTitle>
              <EmptyDescription>Add Zenod below to give the Council durable memory.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {peers.map((p) => (
              <div key={p.name} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    <Badge variant="secondary" className="font-mono">ask_{p.name.toLowerCase()}</Badge>
                    {p.hasToken && <Badge variant="outline">token set</Badge>}
                    <Badge variant={p.status === "connected" ? "secondary" : "destructive"}>{p.status}</Badge>
                  </div>
                  <span className="truncate font-mono text-xs text-muted-foreground">{p.url}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={saving}
                  onClick={() => removePeer(p.name)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={addPeer} className="flex flex-col gap-4 border-t pt-5">
          <Field>
            <FieldLabel htmlFor="peer-name">Unit name</FieldLabel>
            <Input id="peer-name" placeholder="zenod" value={name} onChange={(e) => setName(e.target.value)} />
            <FieldDescription>A short label, such as Zenod.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="peer-url">MCP URL</FieldLabel>
            <Input
              id="peer-url"
              placeholder="https://c1.zenod.dev/mcp"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="font-mono text-xs"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="peer-token">Bearer token</FieldLabel>
            <Input
              id="peer-token"
              type="password"
              placeholder="the unit's MCP token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono text-xs"
            />
            <FieldDescription>Stored write-only; never shown again after saving.</FieldDescription>
          </Field>
          <div>
            <Button type="submit" disabled={saving || !name.trim() || !url.trim() || !token.trim()}>
              {saving ? <Spinner /> : <NetworkIcon data-icon="inline-start" />}
              Add unit
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
