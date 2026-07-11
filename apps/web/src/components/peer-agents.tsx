import * as React from "react"
import {
  DownloadIcon,
  NetworkIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
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
import {
  isCurrentOperation,
  nextOperationGeneration,
  peerFromResponse,
  replacePeer,
  setPeerSkill,
  skillFilesFromSelection,
  type Peer,
  type PeerSkill,
} from "@/components/peer-agents-model"

/**
 * My Units wallet: downstream agents this Council can delegate to. Transport
 * connectivity and an authenticated MCP tool catalog are deliberately separate.
 * The token is write-only (never returned by the API); we only show whether one is set.
 */
export function PeerAgents() {
  const [peers, setPeers] = React.useState<Peer[] | null>(null)
  const [name, setName] = React.useState("")
  const [url, setUrl] = React.useState("")
  const [token, setToken] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [peerActivity, setPeerActivity] = React.useState<
    Record<string, string>
  >({})
  const operationGenerations = React.useRef(new Map<string, number>())
  const skillInputs = React.useRef(new Map<string, HTMLInputElement>())
  const hasPeerActivity = Object.keys(peerActivity).length > 0

  React.useEffect(() => {
    api<{ peers: Peer[] }>("/api/peers")
      .then((r) => setPeers(r.peers))
      .catch(() => setPeers([]))
  }, [])

  async function save(
    next: Array<{ name: string; url: string; token?: string }>
  ) {
    setSaving(true)
    try {
      const r = await api<{ peers: Peer[] }>("/api/peers", {
        method: "PUT",
        body: { peers: next },
      })
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
      ...(peers ?? []).map((p) => ({ name: p.name, url: p.url })),
      { name: name.trim(), url: url.trim(), token: token.trim() },
    ]
    if (await save(next)) {
      setName("")
      setUrl("")
      setToken("")
      toast.success(`Unit "${name.trim()}" connected`, {
        description: `The Council can now route work to it.`,
      })
    }
  }

  async function removePeer(target: string) {
    const next = (peers ?? [])
      .filter((p) => p.name !== target)
      .map((p) => ({ name: p.name, url: p.url }))
    if (await save(next)) toast.success(`Unit "${target}" removed`)
  }

  function beginPeerOperation(peerName: string, label: string) {
    const generation = nextOperationGeneration(
      operationGenerations.current,
      peerName
    )
    setPeerActivity((current) => ({ ...current, [peerName]: label }))
    return generation
  }

  function finishPeerOperation(peerName: string, generation: number) {
    if (!isCurrentOperation(operationGenerations.current, peerName, generation))
      return
    setPeerActivity((current) => {
      const next = { ...current }
      delete next[peerName]
      return next
    })
  }

  function acceptPeerResponse(
    peerName: string,
    generation: number,
    responsePeers: Peer[]
  ) {
    if (!isCurrentOperation(operationGenerations.current, peerName, generation))
      return
    const updated = peerFromResponse(responsePeers, peerName)
    if (updated)
      setPeers((current) => (current ? replacePeer(current, updated) : current))
  }

  async function refreshPeer(peerName: string) {
    const generation = beginPeerOperation(peerName, "Refreshing tools")
    try {
      const response = await api<{ peers: Peer[] }>("/api/peers/refresh", {
        method: "POST",
        body: { name: peerName },
      })
      acceptPeerResponse(peerName, generation, response.peers)
      if (
        isCurrentOperation(operationGenerations.current, peerName, generation)
      ) {
        const refreshed = peerFromResponse(response.peers, peerName)
        if (refreshed?.toolsStatus === "ready")
          toast.success(`Tools refreshed for ${peerName}`)
      }
    } catch (err) {
      if (
        isCurrentOperation(operationGenerations.current, peerName, generation)
      ) {
        toast.error(`Could not refresh tools for ${peerName}`, {
          description: errorMessage(err),
        })
      }
    } finally {
      finishPeerOperation(peerName, generation)
    }
  }

  async function attachSkill(peerName: string, selected: FileList | null) {
    const files = selected ? Array.from(selected) : []
    if (files.length === 0) return
    const generation = beginPeerOperation(peerName, "Attaching skill")
    try {
      const body = { files: await skillFilesFromSelection(files) }
      const response = await api<{ attachment: PeerSkill }>(
        `/api/peers/${encodeURIComponent(peerName)}/skill`,
        { method: "PUT", body }
      )
      if (
        isCurrentOperation(operationGenerations.current, peerName, generation)
      ) {
        setPeers((current) =>
          current
            ? setPeerSkill(current, peerName, response.attachment)
            : current
        )
        toast.success(
          `Skill ${response.attachment.version} attached to ${peerName}`
        )
      }
    } catch (err) {
      if (
        isCurrentOperation(operationGenerations.current, peerName, generation)
      ) {
        toast.error(`Could not attach skill to ${peerName}`, {
          description: errorMessage(err),
        })
      }
    } finally {
      const input = skillInputs.current.get(peerName)
      if (input) input.value = ""
      finishPeerOperation(peerName, generation)
    }
  }

  async function detachSkill(peerName: string) {
    const generation = beginPeerOperation(peerName, "Detaching skill")
    try {
      await api<{ attachment: null }>(
        `/api/peers/${encodeURIComponent(peerName)}/skill`,
        { method: "DELETE" }
      )
      if (
        isCurrentOperation(operationGenerations.current, peerName, generation)
      ) {
        setPeers((current) =>
          current ? setPeerSkill(current, peerName, null) : current
        )
        toast.success(`Skill detached from ${peerName}`)
      }
    } catch (err) {
      if (
        isCurrentOperation(operationGenerations.current, peerName, generation)
      ) {
        toast.error(`Could not detach skill from ${peerName}`, {
          description: errorMessage(err),
        })
      }
    } finally {
      finishPeerOperation(peerName, generation)
    }
  }

  async function downloadSkill(peerName: string) {
    const generation = beginPeerOperation(peerName, "Downloading skill")
    try {
      const response = await fetch(
        `/api/peers/${encodeURIComponent(peerName)}/skill/download`
      )
      if (!response.ok) throw new Error(`Download failed (${response.status}).`)
      const blob = await response.blob()
      if (
        !isCurrentOperation(operationGenerations.current, peerName, generation)
      )
        return
      const disposition = response.headers.get("content-disposition")
      const filename =
        disposition?.match(/filename="([^"]+)"/)?.[1] ??
        `${peerName}.skill.json`
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = href
      anchor.download = decodeURIComponent(filename)
      anchor.click()
      URL.revokeObjectURL(href)
    } catch (err) {
      if (
        isCurrentOperation(operationGenerations.current, peerName, generation)
      ) {
        toast.error(`Could not download skill from ${peerName}`, {
          description: errorMessage(err),
        })
      }
    } finally {
      finishPeerOperation(peerName, generation)
    }
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
              <div
                key={p.name}
                className="flex items-start justify-between gap-3 rounded-lg border p-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    {p.hasToken && <Badge variant="outline">token set</Badge>}
                    <Badge
                      variant={
                        p.transportStatus === "connected"
                          ? "secondary"
                          : "destructive"
                      }
                    >
                      transport {p.transportStatus}
                    </Badge>
                    <Badge
                      variant={
                        p.toolsStatus === "ready" ? "secondary" : "destructive"
                      }
                    >
                      {p.toolsStatus === "ready"
                        ? `tools ready · ${p.toolCount}`
                        : "tools unavailable"}
                    </Badge>
                  </div>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {p.url}
                  </span>
                  {p.toolsError && (
                    <p className="text-xs text-destructive">{p.toolsError}</p>
                  )}
                  {p.toolsStatus === "ready" && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer">
                        {p.toolCount === 0
                          ? "No tools advertised"
                          : "Discovered tools"}
                      </summary>
                      {p.tools.length > 0 && (
                        <ul className="mt-1 list-inside list-disc font-mono">
                          {p.tools.map((tool) => (
                            <li key={tool.name}>
                              {tool.name}
                              {tool.mcpName !== tool.name && ` → ${tool.mcpName}`}
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                  )}
                  <div className="rounded-md bg-muted/40 p-2 text-xs">
                    {p.skill ? (
                      <div className="flex flex-col gap-1">
                        <div>
                          <span className="font-medium">{p.skill.name}</span>{" "}
                          <Badge variant="outline">v{p.skill.version}</Badge>
                        </div>
                        <p className="text-muted-foreground">
                          {p.skill.description}
                        </p>
                        <p className="text-muted-foreground">
                          {p.skill.files.length} files · scripts stored inert
                        </p>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        No Agent Skill attached
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={saving || Boolean(peerActivity[p.name])}
                      onClick={() => refreshPeer(p.name)}
                    >
                      <RefreshCwIcon /> Refresh tools
                    </Button>
                    <input
                      ref={(element) => {
                        if (element) skillInputs.current.set(p.name, element)
                      }}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      aria-label={`Choose Agent Skill for ${p.name}`}
                      onChange={(event) =>
                        attachSkill(p.name, event.target.files)
                      }
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={saving || Boolean(peerActivity[p.name])}
                      onClick={() => skillInputs.current.get(p.name)?.click()}
                    >
                      <UploadIcon />{" "}
                      {p.skill ? "Replace skill" : "Attach skill"}
                    </Button>
                    {p.skill && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={saving || Boolean(peerActivity[p.name])}
                          onClick={() => downloadSkill(p.name)}
                        >
                          <DownloadIcon /> Download
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={saving || Boolean(peerActivity[p.name])}
                          onClick={() => detachSkill(p.name)}
                        >
                          <Trash2Icon /> Detach
                        </Button>
                      </>
                    )}
                    {peerActivity[p.name] && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Spinner /> {peerActivity[p.name]}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Attach a downloaded{" "}
                    <span className="font-mono">.skill.json</span> bundle.
                    Replacing it does not reconnect the unit.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={saving || hasPeerActivity}
                  onClick={() => removePeer(p.name)}
                  aria-label={`Remove ${p.name}`}
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
            <Button type="submit" disabled={saving || hasPeerActivity || peers === null || !name.trim() || !url.trim() || !token.trim()}>
              {saving ? <Spinner /> : <NetworkIcon data-icon="inline-start" />}
              Add unit
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
