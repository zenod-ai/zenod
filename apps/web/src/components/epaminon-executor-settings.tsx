import * as React from "react"
import {
  CheckCircle2Icon,
  EyeIcon,
  EyeOffIcon,
  GitBranchIcon,
  KeyRoundIcon,
  ListPlusIcon,
  PlusIcon,
  SaveIcon,
  ServerCogIcon,
  SquareTerminalIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  PROVIDER_LABELS,
  type ExecutorCliProvider,
  type ExecutorEffort,
  type ExecutorMcpServer,
  type ExecutorSettingsResponse,
} from "@/lib/api"
import { CodeSnippet, CopyButton } from "@/components/copy-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"

type EditableMcpServer = ExecutorMcpServer & {
  token?: string
}

type Draft = {
  defaultEffort: ExecutorEffort
  workerInstructions: string
  cliProvider: ExecutorCliProvider
  mcpServers: EditableMcpServer[]
  skillsText: string
}

function draftFromSettings(settings: ExecutorSettingsResponse): Draft {
  return {
    defaultEffort: settings.defaultEffort,
    workerInstructions: settings.workerInstructions,
    cliProvider: settings.cliProvider,
    mcpServers: settings.mcpServers,
    skillsText: settings.skills.join("\n"),
  }
}

function statusBadge(status: "configured" | "missing") {
  return (
    <Badge variant={status === "configured" ? "secondary" : "destructive"}>
      {status === "configured" ? "Configured" : "Missing"}
    </Badge>
  )
}

function StatusTile({
  icon,
  title,
  status,
  detail,
}: {
  icon: React.ReactNode
  title: string
  status: "configured" | "missing"
  detail: string
}) {
  return (
    <div className="flex min-w-0 gap-3 rounded-lg border p-3">
      <div className="mt-0.5 shrink-0 text-muted-foreground">{icon}</div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{title}</span>
          {statusBadge(status)}
        </div>
        <span className="text-sm text-muted-foreground">{detail}</span>
      </div>
    </div>
  )
}

export function EpaminonExecutorSettings({
  mcpUrl,
  token,
}: {
  mcpUrl: string
  token: string
}) {
  const [settings, setSettings] = React.useState<ExecutorSettingsResponse | null>(null)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [showToken, setShowToken] = React.useState(false)
  const [serverName, setServerName] = React.useState("")
  const [serverUrl, setServerUrl] = React.useState("")
  const [serverToken, setServerToken] = React.useState("")

  React.useEffect(() => {
    let cancelled = false
    api<ExecutorSettingsResponse>("/api/executor/settings")
      .then((result) => {
        if (cancelled) return
        setSettings(result)
        setDraft(draftFromSettings(result))
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function save() {
    if (draft === null) return
    setSaving(true)
    try {
      const next = await api<ExecutorSettingsResponse>("/api/executor/settings", {
        method: "PUT",
        body: {
          defaultEffort: draft.defaultEffort,
          workerInstructions: draft.workerInstructions,
          cliProvider: draft.cliProvider,
          mcpServers: draft.mcpServers.map((server) => ({
            name: server.name,
            url: server.url,
            enabled: server.enabled,
            token: server.token ?? "",
          })),
          skills: draft.skillsText,
        },
      })
      setSettings(next)
      setDraft(draftFromSettings(next))
      toast.success("Executor settings saved")
    } catch (err) {
      toast.error("Could not save executor settings", {
        description: errorMessage(err),
      })
    } finally {
      setSaving(false)
    }
  }

  function addServer(e: React.FormEvent) {
    e.preventDefault()
    const name = serverName.trim()
    const url = serverUrl.trim()
    if (!name || !url || draft === null) return
    setDraft({
      ...draft,
      mcpServers: [
        ...draft.mcpServers.filter((server) => server.name !== name),
        {
          name,
          url,
          enabled: true,
          token: serverToken.trim(),
          hasToken: Boolean(serverToken.trim()),
        },
      ],
    })
    setServerName("")
    setServerUrl("")
    setServerToken("")
  }

  function removeServer(name: string) {
    if (draft === null) return
    setDraft({
      ...draft,
      mcpServers: draft.mcpServers.filter((server) => server.name !== name),
    })
  }

  function updateServer(name: string, patch: Partial<EditableMcpServer>) {
    if (draft === null) return
    setDraft({
      ...draft,
      mcpServers: draft.mcpServers.map((server) =>
        server.name === name ? { ...server, ...patch } : server
      ),
    })
  }

  const claudeCommand = `claude mcp add --transport http epaminon ${mcpUrl} --header "Authorization: Bearer ${token}"`
  const codexCommand = `codex mcp add epaminon --url ${mcpUrl}\ncodex mcp login epaminon`
  const codexTokenCommand = `export EPAMINON_MCP_TOKEN="${token}"\ncodex mcp add epaminon --url ${mcpUrl} --bearer-token-env-var EPAMINON_MCP_TOKEN`

  if (loadError !== null) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Could not load Epaminon settings</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    )
  }

  if (settings === null || draft === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Epaminon executor</CardTitle>
          <CardDescription>Loading executor connection and worker defaults.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-36 w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <ServerCogIcon className="size-5 text-muted-foreground" />
        <CardTitle>Epaminon executor</CardTitle>
        <CardDescription>
          Cloud worker connection, auth readiness, and default run context.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid gap-3 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="epaminon-mcp-url">MCP URL</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="epaminon-mcp-url"
                readOnly
                value={mcpUrl}
                className="font-mono text-xs"
              />
              <CopyButton value={mcpUrl} />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="epaminon-token">Bearer token</FieldLabel>
            <div className="flex items-center gap-2">
              <InputGroup>
                <InputGroupInput
                  id="epaminon-token"
                  readOnly
                  type={showToken ? "text" : "password"}
                  value={token}
                  className="font-mono text-xs"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    aria-label={showToken ? "Hide token" : "Show token"}
                    onClick={() => setShowToken((previous) => !previous)}
                  >
                    {showToken ? <EyeOffIcon /> : <EyeIcon />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <CopyButton value={token} />
            </div>
            <FieldDescription>
              This token grants access to dispatch and status tools on this instance.
            </FieldDescription>
          </Field>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <CodeSnippet code={claudeCommand} />
          <CodeSnippet code={codexCommand} />
          <div className="md:col-span-2">
            <CodeSnippet code={codexTokenCommand} />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <StatusTile
            icon={<GitBranchIcon className="size-4" />}
            title="GitHub auth"
            status={settings.status.githubAuth}
            detail={
              settings.status.hasGithubApp
                ? "GitHub App installed"
                : settings.status.hasGithubToken
                  ? "Personal token stored"
                  : "Connect GitHub or provision a token"
            }
          />
          <StatusTile
            icon={<KeyRoundIcon className="size-4" />}
            title="Provider auth"
            status={settings.status.providerAuth}
            detail={`${PROVIDER_LABELS[settings.status.provider]} ${
              settings.status.hasProviderKey ? "key is stored" : "key is missing"
            }`}
          />
          <StatusTile
            icon={<SquareTerminalIcon className="size-4" />}
            title="CLI auth"
            status={settings.status.cliAuth}
            detail={[
              settings.status.hasCodexCliAuth ? "Codex ready" : "Codex missing",
              settings.status.hasClaudeCliAuth ? "Claude ready" : "Claude missing",
            ].join(", ")}
          />
          <StatusTile
            icon={<CheckCircle2Icon className="size-4" />}
            title="Execution lane"
            status={settings.status.executionLaneConfigured ? "configured" : "missing"}
            detail={
              settings.status.archusPeerUrl ??
              "Lane secret or Archus peer URL has not been provisioned"
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="epaminon-effort">Default effort</FieldLabel>
            <Select
              value={draft.defaultEffort}
              onValueChange={(value) =>
                setDraft({ ...draft, defaultEffort: value as ExecutorEffort })
              }
            >
              <SelectTrigger id="epaminon-effort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="epaminon-cli-provider">Preferred worker CLI</FieldLabel>
            <Select
              value={draft.cliProvider}
              onValueChange={(value) =>
                setDraft({ ...draft, cliProvider: value as ExecutorCliProvider })
              }
            >
              <SelectTrigger id="epaminon-cli-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="codex">Codex</SelectItem>
                <SelectItem value="claude">Claude</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="epaminon-worker-instructions">
            Worker instructions
          </FieldLabel>
          <Textarea
            id="epaminon-worker-instructions"
            value={draft.workerInstructions}
            onChange={(event) =>
              setDraft({ ...draft, workerInstructions: event.target.value })
            }
            className="min-h-28 font-mono text-xs"
            placeholder="Apply repo instructions, leave evidence, and stop for approval before irreversible changes."
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="epaminon-skills">Skills</FieldLabel>
          <Textarea
            id="epaminon-skills"
            value={draft.skillsText}
            onChange={(event) => setDraft({ ...draft, skillsText: event.target.value })}
            className="min-h-24 font-mono text-xs"
            placeholder="github:gh-fix-ci&#10;workers-best-practices&#10;pdf"
          />
          <FieldDescription>One skill per line.</FieldDescription>
        </Field>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <ListPlusIcon className="size-4 text-muted-foreground" />
            <span className="font-medium">Prewired MCP servers</span>
          </div>
          {draft.mcpServers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No prewired MCP servers.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {draft.mcpServers.map((server) => (
                <div
                  key={server.name}
                  className="grid gap-2 rounded-lg border p-3 md:grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.6fr)_minmax(7rem,0.9fr)_auto]"
                >
                  <Input
                    value={server.name}
                    onChange={(event) =>
                      updateServer(server.name, { name: event.target.value })
                    }
                    className="font-mono text-xs"
                    aria-label={`${server.name} MCP server name`}
                  />
                  <Input
                    value={server.url}
                    onChange={(event) =>
                      updateServer(server.name, { url: event.target.value })
                    }
                    className="font-mono text-xs"
                    aria-label={`${server.name} MCP server URL`}
                  />
                  <Input
                    type="password"
                    value={server.token ?? ""}
                    placeholder={server.hasToken ? "token set" : "optional token"}
                    onChange={(event) =>
                      updateServer(server.name, {
                        token: event.target.value,
                        hasToken: Boolean(event.target.value) || server.hasToken,
                      })
                    }
                    className="font-mono text-xs"
                    aria-label={`${server.name} MCP server token`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeServer(server.name)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={addServer} className="grid gap-2 md:grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.6fr)_minmax(7rem,0.9fr)_auto]">
            <Input
              value={serverName}
              onChange={(event) => setServerName(event.target.value)}
              placeholder="zenod"
              className="font-mono text-xs"
            />
            <Input
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="https://example.com/mcp"
              className="font-mono text-xs"
            />
            <Input
              type="password"
              value={serverToken}
              onChange={(event) => setServerToken(event.target.value)}
              placeholder="token"
              className="font-mono text-xs"
            />
            <Button type="submit" variant="outline" disabled={!serverName.trim() || !serverUrl.trim()}>
              <PlusIcon />
            </Button>
          </form>
        </div>

        <div>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? <Spinner /> : <SaveIcon data-icon="inline-start" />}
            Save executor settings
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
