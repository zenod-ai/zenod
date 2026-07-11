import * as React from "react"
import {
  EyeIcon,
  EyeOffIcon,
  FolderGit2Icon,
  PlugZapIcon,
  SquareTerminalIcon,
  TerminalIcon,
  TriangleAlertIcon,
  WalletCardsIcon,
} from "lucide-react"

import { api, errorMessage, type ConnectionsResponse } from "@/lib/api"
import { CodeSnippet, CopyButton } from "@/components/copy-button"
import { GithubConnect } from "@/components/github-connect"
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
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { mcpClientSnippets, resolveMcpAccess } from "@/views/dashboard-navigation"

export type DashboardOverviewData = {
  tenant: { id: string; name?: string }
  unit?: { name: string; version: string }
  usage: { units: number } | null
}

type CustomerAccount = {
  mcp_url?: string | null
  token?: string | null
  balance?: {
    limitUsd: number | null
    usageUsd: number | null
    remainingUsd: number | null
    state: string
  } | null
  ledger?: {
    calls: number
    tokens: number
    costUsd: number
  } | null
}

function usd(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "Unavailable"
    : new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
      }).format(value)
}

function CreditSummary({
  account,
  overview,
}: {
  account: CustomerAccount | null
  overview: DashboardOverviewData | null
}) {
  const balance = account?.balance

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <WalletCardsIcon className="size-5 text-muted-foreground" />
        <CardTitle>Credit &amp; usage</CardTitle>
        <CardDescription>
          {balance
            ? `${usd(balance.remainingUsd)} remaining`
            : `${overview?.usage?.units ?? 0} usage units recorded`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {balance ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground">Credit limit</p>
              <p className="font-medium tabular-nums">
                {usd(balance.limitUsd)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Used</p>
              <p className="font-medium tabular-nums">
                {usd(balance.usageUsd)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Provider credit appears here when the customer account reports a
            balance. Detailed local usage remains available in Usage.
          </p>
        )}
        {account?.ledger && (
          <p className="text-xs text-muted-foreground">
            7 days: {account.ledger.calls.toLocaleString()} calls ·{" "}
            {account.ledger.tokens.toLocaleString()} tokens ·{" "}
            {usd(account.ledger.costUsd)}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function DashboardOverview({
  overview,
}: {
  overview: DashboardOverviewData | null
}) {
  const [connections, setConnections] =
    React.useState<ConnectionsResponse | null>(null)
  const [account, setAccount] = React.useState<CustomerAccount | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [showToken, setShowToken] = React.useState(false)

  const retryConnections = React.useCallback(() => {
    setLoadError(null)
    api<ConnectionsResponse>("/api/connections")
      .then(setConnections)
      .catch((error: unknown) => setLoadError(errorMessage(error)))
  }, [])

  React.useEffect(() => {
    let cancelled = false
    api<ConnectionsResponse>("/api/connections")
      .then((result) => {
        if (!cancelled) setConnections(result)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error))
      })
    api<CustomerAccount>("/api/console/account")
      .then((result) => {
        if (!cancelled) setAccount(result)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (loadError !== null) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Could not load MCP access</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>{loadError}</span>
          <Button variant="outline" size="sm" onClick={retryConnections}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (connections === null) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-72 w-full rounded-lg" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  const mcpAccess = resolveMcpAccess(connections.token, account)
  const mcpUrl = mcpAccess.url
  const snippets = mcpClientSnippets(mcpUrl)

  return (
    <div className="flex flex-col gap-4">
      <Card className="rounded-lg ring-foreground/20">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>
              <PlugZapIcon />
              MCP access
            </Badge>
            <span className="text-xs text-muted-foreground">
              {overview?.tenant.name ?? overview?.tenant.id ?? "Zenod"}
            </span>
          </div>
          <CardTitle className="text-lg">Connect your agent</CardTitle>
          <CardDescription>
            Use this {overview?.unit?.name === "ring" ? "Ring Council" : "Zenod"} endpoint and bearer token from Claude Code, Codex, or any
            HTTP MCP client.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field orientation="vertical">
              <FieldContent>
                <FieldLabel htmlFor="dashboard-mcp-url">MCP URL</FieldLabel>
              </FieldContent>
              <div className="flex gap-2">
                <Input
                  id="dashboard-mcp-url"
                  className="min-w-0 font-mono text-xs"
                  value={mcpUrl}
                  readOnly
                />
                <CopyButton value={mcpUrl} label="Copy" />
              </div>
            </Field>
            <Field orientation="vertical">
              <FieldContent>
                <FieldLabel htmlFor="dashboard-mcp-token">
                  Bearer token
                </FieldLabel>
              </FieldContent>
              <div className="flex gap-2">
                <Input
                  id="dashboard-mcp-token"
                  className="min-w-0 font-mono text-xs"
                  type={showToken ? "text" : "password"}
                  value={mcpAccess.token}
                  readOnly
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => setShowToken((visible) => !visible)}
                  aria-label={
                    showToken ? "Hide bearer token" : "Show bearer token"
                  }
                  title={showToken ? "Hide bearer token" : "Show bearer token"}
                >
                  {showToken ? <EyeOffIcon /> : <EyeIcon />}
                </Button>
                <CopyButton value={mcpAccess.token} label="Copy" />
              </div>
            </Field>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <p className="flex items-center gap-2 text-sm font-medium">
                <TerminalIcon className="size-4" />
                Claude Code
              </p>
              <CodeSnippet code={snippets.claude} className="h-full" />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <p className="flex items-center gap-2 text-sm font-medium">
                <SquareTerminalIcon className="size-4" />
                Codex
              </p>
              <CodeSnippet code={snippets.codex} className="h-full" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-lg">
          <CardHeader>
            <FolderGit2Icon className="size-5 text-muted-foreground" />
            <CardTitle>Connect your vault</CardTitle>
            <CardDescription>
              Authorize the GitHub App and choose any repository it can access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GithubConnect compact />
          </CardContent>
        </Card>
        <CreditSummary account={account} overview={overview} />
      </div>
    </div>
  )
}
