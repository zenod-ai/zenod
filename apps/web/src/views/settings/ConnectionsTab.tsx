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
import { GoogleDriveConnect } from "@/components/google-drive-connect"
import { WhatsAppConnect } from "@/components/whatsapp-connect"
import { TelegramConnect } from "@/components/telegram-connect"
import { PeerAgents } from "@/components/peer-agents"
import { RingControlSurface } from "@/components/ring-control-surface"
import { GithubConnect } from "@/components/github-connect"
import { ComposioConnect } from "@/components/composio-connect"
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
  const [ringMode, setRingMode] = React.useState(false)

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

  React.useEffect(() => {
    let cancelled = false
    api<{ vaultless?: boolean }>("/api/agent")
      .then((result) => {
        if (!cancelled) setRingMode(Boolean(result.vaultless))
      })
      .catch(() => {})
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
  const claudeCodeOauthCommand = `claude mcp add --transport http zenod ${mcpUrl}\n# then: /mcp  →  Authenticate`
  const codexCommand = `codex mcp add zenod --url ${mcpUrl}\ncodex mcp login zenod   # opens a browser to approve`
  const codexTokenCommand = `export ZENOD_MCP_TOKEN="${data.token}"\ncodex mcp add zenod --url ${mcpUrl} --bearer-token-env-var ZENOD_MCP_TOKEN`
  const codexDesktopUrl = mcpUrl
  const codexDesktopEnvVar = "ZENOD_MCP_TOKEN"

  async function handleRevoke(clientId: string) {
    try {
      await api("/api/connections/revoke", { method: "POST", body: { clientId } })
      setData((previous) =>
        previous === null
          ? previous
          : { ...previous, grants: previous.grants.filter((g) => g.clientId !== clientId) }
      )
      toast.success("Access revoked")
    } catch (err) {
      toast.error("Could not revoke access", { description: errorMessage(err) })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <RingControlSurface enabled={ringMode} />

      <Card>
        <CardHeader>
          <CardTitle>GitHub</CardTitle>
          <CardDescription>
            Connect GitHub once here. The Console uses it to provision the agents it enables
            (so they can reach their repos) — connect-once, the shared-connection model.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GithubConnect connectOnly />
        </CardContent>
      </Card>

      <div id="phylax-channels" className="scroll-mt-4">
        <div className="flex flex-col gap-6">
          <WhatsAppConnect />
          <TelegramConnect />
        </div>
      </div>
      {!ringMode && <GoogleDriveConnect />}
      <ComposioConnect />
      <PeerAgents />

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
            to verify the tools are available. Or connect without a token and
            approve in the browser:
          </p>
          <CodeSnippet code={claudeCodeOauthCommand} />
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
            The <span className="font-mono">login</span> command opens a browser
            — approve with your admin password, no token needed. Or use a token
            instead:
          </p>
          <CodeSnippet code={codexTokenCommand} />
          <p className="text-sm text-muted-foreground">
            In Codex Desktop, paste the MCP URL in the MCP server settings URL
            field, then set the bearer token env var field to{" "}
            <span className="font-mono">{codexDesktopEnvVar}</span>. That field
            is the variable name, not the token value.
          </p>
          <CodeSnippet
            code={`URL: ${codexDesktopUrl}\nBearer token env var: ${codexDesktopEnvVar}`}
          />
          <p className="text-sm text-muted-foreground">
            The actual token must be set in the environment of the Codex
            process before Codex starts. A shell{" "}
            <span className="font-mono">export</span> only lasts for that shell
            session and child processes.
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
            <AlertTitle>Paste the URL, then approve in the browser</AlertTitle>
            <AlertDescription>
              In Claude.ai → Settings → Connectors → Add custom connector, paste
              the URL above. Claude opens a Zenod sign-in page — approve with
              your admin password and it&apos;s connected. No token to copy.
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

      <Card>
        <CardHeader>
          <CardTitle>Authorized apps</CardTitle>
          <CardDescription>
            Apps you signed into Zenod via the browser (OAuth). Revoking
            disconnects them immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.grants.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <GlobeIcon />
                </EmptyMedia>
                <EmptyTitle>No authorized apps</EmptyTitle>
                <EmptyDescription>
                  When you connect Claude.ai (or Claude Code via browser
                  sign-in), it appears here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {data.grants.map((grant) => (
                <div
                  key={grant.clientId}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {grant.clientName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      authorized {timeAgo(grant.createdAt)}
                    </span>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                      >
                        Revoke
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Revoke {grant.clientName}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          It will lose access to your vault immediately and need
                          to sign in again to reconnect.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleRevoke(grant.clientId)}
                        >
                          Revoke
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
