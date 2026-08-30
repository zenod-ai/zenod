import * as React from "react"
import {
  CopyIcon,
  ExternalLinkIcon,
  LogOutIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  HostedUsageCard,
  type HostedCustomerUsage,
} from "@/components/hosted-usage-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import type { VaultCapabilityProjection, VaultStatus } from "@/lib/api"

// Transplanted from zenod-ai/cloud services/console/src/App.tsx and api.ts @ 6bdb318.

type Me = {
  login: string
  display_name: string
  avatar_url: string | null
  provider: "github" | "google"
  providers: Array<"github" | "google">
}

type Account = {
  account_id: string
  tier: string | null
  subscription_status:
    | "checkout_pending"
    | "active"
    | "past_due"
    | "paused"
    | "canceled"
    | null
  cancel_at_period_end: boolean
  current_period_end: string | null
  mcp_url: string | null
  token: string | null
  token_hint: string | null
  vault_repo: string | null
  vault_repo_url: string | null
  usage: HostedCustomerUsage
}

class AccountRequestError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`${status}`)
    this.status = status
  }
}

async function optionalJson<T>(path: string): Promise<T | null> {
  const response = await fetch(path)
  if (response.status === 404) return null
  if (!response.ok) throw new AccountRequestError(response.status)
  return response.json() as Promise<T>
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      title="Copy"
      aria-label="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      <CopyIcon />
      <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
    </Button>
  )
}

function subscriptionLabel(tier: string | null): string {
  if (tier === "yearly") return "Legacy yearly subscription"
  if (tier === "monthly") return "Zenod Hosted monthly subscription"
  return "Plan pending"
}

export function HostedAccount() {
  const [me, setMe] = React.useState<Me | null>(null)
  const [account, setAccount] = React.useState<Account | null>(null)
  const [vault, setVault] = React.useState<VaultCapabilityProjection | null>(
    null
  )
  const [vaultStatus, setVaultStatus] = React.useState<VaultStatus | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [sessionExpired, setSessionExpired] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [billingBusy, setBillingBusy] = React.useState(false)
  const [billingError, setBillingError] = React.useState<string | null>(null)

  React.useEffect(() => {
    Promise.all([
      optionalJson<Me>("/api/me"),
      optionalJson<Account>("/api/console/account"),
      optionalJson<VaultCapabilityProjection>("/api/vault/provider"),
      optionalJson<VaultStatus>("/api/vault"),
    ])
      .then(([nextMe, nextAccount, nextVault, nextVaultStatus]) => {
        setMe(nextMe)
        setAccount(nextAccount)
        setVault(nextVault)
        setVaultStatus(nextVaultStatus)
      })
      .catch((error: unknown) => {
        if (error instanceof AccountRequestError && error.status === 401) {
          setSessionExpired(true)
          return
        }
        setLoadError(
          "Could not load your Zenod account. Check your connection and try again."
        )
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading your Zenod account…
      </div>
    )
  }

  if (sessionExpired || (!me && !loadError)) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-xl items-center p-6">
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>Your session has expired</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>Sign in again with any method available for this Zenod.</span>
            <Button asChild>
              <a href="/">Continue to sign in</a>
            </Button>
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-xl items-center p-6">
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Could not load your account</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{loadError}</span>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  if (!me) return null

  const endpoint = account?.mcp_url ?? ""
  const token = account?.token ?? "<your token>"
  const codex = endpoint
    ? `codex mcp add zenod --url ${endpoint} --bearer ${token}`
    : ""
  const claude = endpoint
    ? `claude mcp add --transport http zenod ${endpoint} --header "Authorization: Bearer ${token}"`
    : ""
  const legacyGithubVault = Boolean(
    vault?.provider === null && account?.vault_repo
  )
  const vaultReady = Boolean(
    (vault?.ready || legacyGithubVault) &&
    vaultStatus?.cloned &&
    !vaultStatus.cloneError
  )

  async function openBillingPortal() {
    setBillingBusy(true)
    setBillingError(null)
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" })
      if (!response.ok)
        throw new Error("Billing management is temporarily unavailable")
      const payload = (await response.json()) as { url?: unknown }
      if (typeof payload.url !== "string")
        throw new Error("Billing management returned an invalid destination")
      window.location.assign(payload.url)
    } catch (error) {
      setBillingError(
        error instanceof Error
          ? error.message
          : "Could not open billing management"
      )
      setBillingBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-5 p-6">
      <header className="flex items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src="/plates/zenod-plate-charcoal.jpg"
            alt=""
            className="size-10 border border-border object-cover"
          />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">Zenod account</h1>
            <p className="truncate text-sm text-muted-foreground">
              {me.display_name || me.login} · signed in with{" "}
              {me.provider === "google" ? "Google" : "GitHub"}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            void fetch("/auth/signout", { method: "POST" }).then(() =>
              window.location.assign("/")
            )
          }}
        >
          <LogOutIcon data-icon="inline-start" />
          Log out
        </Button>
      </header>

      {!account ? (
        <section className="border border-border p-8 text-center">
          <h2 className="text-lg font-semibold">Choose your Zenod plan</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Zenod Hosted is €9/month plus VAT, with managed AI usage and
            WhatsApp included. Checkout stays bound to this Zenod account;
            GitHub is not required.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild className="rounded-none">
              <a href="/buy?tier=monthly">Subscribe for €9/month + VAT</a>
            </Button>
          </div>
        </section>
      ) : (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            <Card className="rounded-none">
              <CardHeader>
                <CardTitle>Subscription</CardTitle>
                <CardDescription>
                  {subscriptionLabel(account.tier)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-medium capitalize">
                  {account.subscription_status?.replace("_", " ") ?? "Pending"}
                </p>
                {account.cancel_at_period_end && account.current_period_end ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Access remains active until{" "}
                    {new Date(account.current_period_end).toLocaleDateString()}.
                  </p>
                ) : null}
                {account.subscription_status === "past_due" ? (
                  <p className="mt-2 text-sm text-destructive">
                    Payment needs attention. Update your payment method to avoid
                    interruption.
                  </p>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 rounded-none"
                  disabled={billingBusy}
                  onClick={() => void openBillingPortal()}
                >
                  {billingBusy ? "Opening…" : "Manage billing"}
                  <ExternalLinkIcon data-icon="inline-end" />
                </Button>
                {billingError ? (
                  <p className="mt-2 text-sm text-destructive">
                    {billingError}
                  </p>
                ) : null}
              </CardContent>
            </Card>
            <HostedUsageCard usage={account.usage} productName="Zenod" />
          </div>

          {endpoint && (
            <Card className="rounded-none">
              <CardHeader>
                <CardTitle>Your MCP endpoint</CardTitle>
                <CardDescription>Owner-only account session</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto border border-border bg-muted p-3 text-xs">
                    {endpoint}
                  </code>
                  <CopyButton value={endpoint} />
                </div>
                {[
                  { label: "Claude", value: claude },
                  { label: "Codex", value: codex },
                ].map((snippet) => (
                  <div key={snippet.label}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                      <span>{snippet.label}</span>
                      <CopyButton value={snippet.value} />
                    </div>
                    <code className="block overflow-x-auto border border-border bg-muted p-3 text-xs">
                      {snippet.value}
                    </code>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card className="rounded-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Your memory vault
                {vaultReady ? (
                  <Badge variant="secondary">Ready</Badge>
                ) : (
                  <Badge variant="outline">Setup needed</Badge>
                )}
              </CardTitle>
              <CardDescription>
                {vault?.provider === "google_drive"
                  ? "Google Drive is the durable authority for your Markdown files and bundled Git history."
                  : vault?.provider === "github" || legacyGithubVault
                    ? "GitHub is the durable authority for your repository and commit history."
                    : "Choose Google Drive or GitHub as the one durable authority for this vault."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              {(vault?.provider === "github" || legacyGithubVault) &&
              account.vault_repo ? (
                <a
                  className="inline-flex items-center gap-2 text-sm underline"
                  href={account.vault_repo_url ?? undefined}
                >
                  {account.vault_repo}
                  <ExternalLinkIcon className="size-3.5" />
                </a>
              ) : null}
              {vault?.provider === "google_drive" ? (
                <Button asChild variant="link" className="rounded-none">
                  <a
                    href="https://drive.google.com/drive/my-drive"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open Google Drive
                    <ExternalLinkIcon data-icon="inline-end" />
                  </a>
                </Button>
              ) : null}
              <Button
                asChild
                variant={vaultReady ? "outline" : "default"}
                className="rounded-none"
              >
                <a href="/app#vault">
                  {vaultReady ? "Manage vault" : "Finish vault setup"}
                </a>
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  )
}
