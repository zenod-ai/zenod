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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  mcpClientSnippets,
  resolveMcpAccess,
} from "@/views/dashboard-navigation"

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
  showSupportCards = true,
  hosted = false,
}: {
  overview: DashboardOverviewData | null
  showSupportCards?: boolean
  hosted?: boolean
}) {
  const [showAdvanced, setShowAdvanced] = React.useState(false)
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

  const mcpAccess = resolveMcpAccess(connections.token, account, hosted)
  const mcpUrl = mcpAccess.url
  const isRing = overview?.unit?.name === "ring"
  const isHerald = overview?.unit?.name === "herald"
  const isCouncilUnit = isRing || isHerald
  const snippets = mcpClientSnippets(
    mcpUrl,
    isHerald ? "herald" : isRing ? "ring" : "zenod",
    hosted
  )

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
          <CardTitle className="text-lg">
            {isHerald ? "Connect to Herald" : "Connect your agent"}
          </CardTitle>
          <CardDescription>
            {hosted ? (
              "Add this URL in your agent, sign in to Zenod if needed, and click Allow. No token copying required."
            ) : (
              <>
                {isHerald ? (
                  "Use Herald's"
                ) : (
                  <>Use this {isRing ? "Ring Council" : "Zenod"}</>
                )}{" "}
                endpoint and bearer token from Claude Code, Codex, or any HTTP
                MCP client.
              </>
            )}
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
                  Access token (manual setup)
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
                    showToken ? "Hide access token" : "Show access token"
                  }
                  title={showToken ? "Hide access token" : "Show access token"}
                >
                  {showToken ? <EyeOffIcon /> : <EyeIcon />}
                </Button>
                <CopyButton value={mcpAccess.token} label="Copy token" />
              </div>
              <FieldDescription>
                Also called a bearer token or tenant token. Use it only when
                your agent asks for a token; browser sign-in does not need it.
              </FieldDescription>
            </Field>
          </div>

          {hosted && (
            <div className="flex flex-col items-start gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-expanded={showAdvanced}
                aria-controls="dashboard-manual-instructions"
                onClick={() => setShowAdvanced((visible) => !visible)}
              >
                {showAdvanced
                  ? "Hide manual token instructions"
                  : "Manual token instructions"}
              </Button>
              {showAdvanced && (
                <div
                  id="dashboard-manual-instructions"
                  className="flex w-full flex-col gap-3"
                >
                  <p className="text-sm text-muted-foreground">
                    For clients without browser sign-in, copy the access token
                    above and replace YOUR_ACCESS_TOKEN below. Use the same MCP
                    URL.
                  </p>
                  <p className="text-sm font-medium">Codex with a token</p>
                  <CodeSnippet
                    code={`export ZENOD_MCP_TOKEN='YOUR_ACCESS_TOKEN'\ncodex mcp add zenod --url ${mcpUrl} --bearer-token-env-var ZENOD_MCP_TOKEN`}
                  />
                  <p className="text-sm font-medium">
                    Claude Code with a token
                  </p>
                  <CodeSnippet
                    code={`claude mcp add --transport http zenod ${mcpUrl} --header "Authorization: Bearer YOUR_ACCESS_TOKEN"`}
                  />
                  <p className="text-sm font-medium">Any HTTP MCP client</p>
                  <CodeSnippet code="Authorization: Bearer YOUR_ACCESS_TOKEN" />
                </div>
              )}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-2">
              <p className="flex items-center gap-2 text-sm font-medium">
                <TerminalIcon className="size-4" />
                Claude / Claude Code
              </p>
              {hosted && (
                <p className="text-sm text-muted-foreground">
                  In Claude, add a custom connector using the MCP URL above and
                  approve in your browser. For Claude Code, run:
                </p>
              )}
              <CodeSnippet code={snippets.claude} className="h-full" />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <p className="flex items-center gap-2 text-sm font-medium">
                <SquareTerminalIcon className="size-4" />
                Codex
              </p>
              {hosted && (
                <p className="text-sm text-muted-foreground">
                  Add the MCP URL in the app and follow browser sign-in, or use
                  these CLI commands:
                </p>
              )}
              <CodeSnippet code={snippets.codex} className="h-full" />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <p className="flex items-center gap-2 text-sm font-medium">
                <PlugZapIcon className="size-4" />
                Any MCP agent
              </p>
              <p className="text-sm text-muted-foreground">
                Add an HTTP MCP server named Zenod with the URL above.{" "}
                {hosted
                  ? "Choose OAuth or browser sign-in, then click Allow in Zenod. Client registration is automatic."
                  : "Use the access token above when authentication is requested."}
              </p>
              <CodeSnippet
                code={`Connect to Zenod using ${mcpUrl}${hosted ? " and browser sign-in." : "."}`}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {showSupportCards && (
        <div
          className={isCouncilUnit ? "grid gap-4" : "grid gap-4 md:grid-cols-2"}
        >
          {!isCouncilUnit && (
            <Card className="rounded-lg">
              <CardHeader>
                <FolderGit2Icon className="size-5 text-muted-foreground" />
                <CardTitle>Connect your vault</CardTitle>
                <CardDescription>
                  Authorize the GitHub App and choose any repository it can
                  access.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <GithubConnect compact />
              </CardContent>
            </Card>
          )}
          <CreditSummary account={account} overview={overview} />
        </div>
      )}
    </div>
  )
}
