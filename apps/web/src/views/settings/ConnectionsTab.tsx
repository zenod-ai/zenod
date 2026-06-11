import * as React from "react"
import {
  EyeIcon,
  EyeOffIcon,
  GlobeIcon,
  InfoIcon,
  PlugZapIcon,
  RefreshCwIcon,
  RotateCwIcon,
  SquareTerminalIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  type ConnectionsResponse,
} from "@/lib/api"
import { CodeSnippet, CopyButton } from "@/components/copy-button"
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

const CLAUDE_CONNECTORS_URL = "https://claude.ai/settings/connectors"

function timeAgo(epochMs: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - epochMs) / 1000))
  if (seconds < 60) {
    return seconds <= 1 ? "just now" : `${seconds} sec ago`
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `${minutes} min ago`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours} hr${hours === 1 ? "" : "s"} ago`
  }
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

export function ConnectionsTab() {
  const [data, setData] = React.useState<ConnectionsResponse | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [showToken, setShowToken] = React.useState(false)
  const [regenerating, setRegenerating] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    api<ConnectionsResponse>("/api/connections")
      .then((result) => {
        if (!cancelled) {
          setData(result)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(errorMessage(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleRefresh() {
    setRefreshing(true)
    api<ConnectionsResponse>("/api/connections")
      .then((result) => {
        setData(result)
      })
      .catch((err: unknown) => {
        toast.error("Could not refresh clients", {
          description: errorMessage(err),
        })
      })
      .finally(() => {
        setRefreshing(false)
      })
  }

  async function handleRegenerate() {
    setRegenerating(true)
    try {
      const result = await api<{ token: string }>("/api/token/regenerate", {
        method: "POST",
      })
      setData((previous) =>
        previous === null ? previous : { ...previous, token: result.token }
      )
      toast.success("Token regenerated", {
        description: "Update every connected client with the new token.",
      })
    } catch (err) {
      toast.error("Could not regenerate token", {
        description: errorMessage(err),
      })
    } finally {
      setRegenerating(false)
    }
  }

  if (loadError !== null) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Could not load connection details</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    )
  }

  if (data === null) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const mcpUrl = window.location.origin + data.mcpPath
  const claudeCodeCommand = `claude mcp add --transport http zenod ${mcpUrl} --header "Authorization: Bearer ${data.token}"`
  const codexCommand = `export ZENOD_MCP_TOKEN="${data.token}"\ncodex mcp add zenod --url ${mcpUrl} --bearer-token-env-var ZENOD_MCP_TOKEN`

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>MCP endpoint</CardTitle>
          <CardDescription>
            Point any MCP client at this URL with the bearer token below.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Field>
            <FieldLabel htmlFor="connections-url">MCP URL</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="connections-url"
                readOnly
                value={mcpUrl}
                className="font-mono text-xs"
              />
              <CopyButton value={mcpUrl} />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="connections-token">Bearer token</FieldLabel>
            <div className="flex items-center gap-2">
              <InputGroup>
                <InputGroupInput
                  id="connections-token"
                  readOnly
                  type={showToken ? "text" : "password"}
                  value={data.token}
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
              <CopyButton value={data.token} />
            </div>
            <FieldDescription>
              Anyone with this token can read and write your vault.
            </FieldDescription>
          </Field>
        </CardContent>
        <CardFooter>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={regenerating}>
                {regenerating ? (
                  <Spinner />
                ) : (
                  <RotateCwIcon data-icon="inline-start" />
                )}
                Regenerate token
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Regenerate token?</AlertDialogTitle>
                <AlertDialogDescription>
                  Existing connected clients will stop working until
                  reconfigured.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={handleRegenerate}
                >
                  Regenerate
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <TerminalIcon className="size-5 text-muted-foreground" />
          <CardTitle>Claude Code</CardTitle>
          <CardDescription>Add Zenod to Claude Code over MCP.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <CodeSnippet code={claudeCodeCommand} />
          <p className="text-sm text-muted-foreground">
            Then run <span className="font-mono">/mcp</span> inside Claude Code
            to verify the tools are available.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SquareTerminalIcon className="size-5 text-muted-foreground" />
          <CardTitle>Codex</CardTitle>
          <CardDescription>Add Zenod to the OpenAI Codex CLI.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <CodeSnippet code={codexCommand} />
          <p className="text-sm text-muted-foreground">
            Codex reads the token from the env var at runtime.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <GlobeIcon className="size-5 text-muted-foreground" />
          <CardTitle>Claude.ai</CardTitle>
          <CardDescription>
            Add Zenod as a custom connector in Claude.ai (web / desktop /
            mobile).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="claude-ai-url">MCP URL</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="claude-ai-url"
                readOnly
                value={mcpUrl}
                className="font-mono text-xs"
              />
              <CopyButton value={mcpUrl} />
            </div>
          </Field>
          <div>
            <Button asChild>
              <a
                href={CLAUDE_CONNECTORS_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <GlobeIcon data-icon="inline-start" />
                Open Claude connectors
              </a>
            </Button>
          </div>
          <Alert>
            <InfoIcon />
            <AlertTitle>Bearer tokens aren&apos;t supported yet</AlertTitle>
            <AlertDescription>
              Claude.ai connectors require OAuth — pasting a bearer token
              isn&apos;t supported yet. One-click browser sign-in is coming in a
              Zenod update; for now use Claude Code or Codex above.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connected clients</CardTitle>
          <CardDescription>
            MCP clients that have handshaked with this server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.clients.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PlugZapIcon />
                </EmptyMedia>
                <EmptyTitle>No clients yet</EmptyTitle>
                <EmptyDescription>
                  Connect Claude Code or Codex above, then they&apos;ll show up
                  here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {data.clients.map((client, index) => (
                <div
                  key={`${client.name}-${index}`}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{client.name}</span>
                    {client.version !== null && (
                      <span className="truncate text-sm text-muted-foreground">
                        {client.version}
                      </span>
                    )}
                    <Badge variant="secondary">
                      {client.connections}{" "}
                      {client.connections === 1 ? "connect" : "connects"}
                    </Badge>
                  </div>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {timeAgo(client.lastSeen)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <Spinner />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            Refresh
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
