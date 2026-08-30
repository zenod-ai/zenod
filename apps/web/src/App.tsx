import * as React from "react"
import { TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  isUnauthorized,
  type AuthStatus,
  type SettingsResponse,
  type SettingsValues,
} from "@/lib/api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Toaster } from "@/components/ui/sonner"
import { Login } from "@/views/Login"
import { HostedAccount } from "@/views/HostedAccount"
import { HostedLogin } from "@/views/HostedLogin"
import { Settings } from "@/views/Settings"
import { SetupWizard } from "@/views/SetupWizard"
import type { ZenodEdition } from "@/views/zenod-edition"

type View =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "login" }
  | { kind: "hosted-login"; methods: Array<"github" | "google"> }
  | { kind: "hosted-account" }
  | { kind: "settings"; settings: SettingsValues; edition: ZenodEdition }
  | { kind: "error"; message: string }

function consumeGithubReturn(): boolean {
  const params = new URLSearchParams(window.location.search)
  if (params.get("github") !== "connected") {
    return false
  }
  params.delete("github")
  const query = params.toString()
  window.history.replaceState(
    null,
    "",
    window.location.pathname + (query.length > 0 ? `?${query}` : "")
  )
  return true
}

function initialTabFromHash(): "channels" | "vault" | "account" | undefined {
  if (
    window.location.hash === "#ring-router-products" ||
    window.location.hash === "#phylax-channels"
  ) {
    return "channels"
  }
  if (window.location.hash === "#vault") return "vault"
  if (window.location.hash === "#account") return "account"
  return undefined
}

function CustomerApp() {
  const [view, setView] = React.useState<View>({ kind: "loading" })
  const [githubReturn] = React.useState(consumeGithubReturn)

  React.useEffect(() => {
    if (githubReturn) {
      toast.success("GitHub connected")
    }
  }, [githubReturn])

  const [hostedInitialTab, setHostedInitialTab] = React.useState<
    "vault" | undefined
  >()

  const loadSettings = React.useCallback(
    (
      edition: ZenodEdition = "self-hosted",
      initialTab?: "vault",
      hostedMethods: Array<"github" | "google"> = ["github"]
    ) => {
      setHostedInitialTab(initialTab)
      api<SettingsResponse>("/api/settings")
        .then((result) => {
          setView({ kind: "settings", settings: result.settings, edition })
        })
        .catch((err: unknown) => {
          if (isUnauthorized(err)) {
            setView(
              edition === "hosted"
                ? { kind: "hosted-login", methods: hostedMethods }
                : { kind: "login" }
            )
          } else {
            setView({ kind: "error", message: errorMessage(err) })
          }
        })
    },
    []
  )

  const boot = React.useCallback(() => {
    api<AuthStatus>("/api/auth/status")
      .then(async (status) => {
        if (status.customerAuth) {
          const signInMethods =
            status.signInMethods ??
            (status.authMethod === "google" ? ["google"] : ["github"])
          const me = await fetch("/api/me")
          if (me.status === 401) {
            setView({
              kind: "hosted-login",
              methods: signInMethods,
            })
            return
          }
          const account = await fetch("/api/console/account")
          if (
            window.location.pathname === "/account" ||
            account.status === 404
          ) {
            setView({ kind: "hosted-account" })
            return
          }
          const accountProjection = account.ok
            ? ((await account.json()) as { vault_repo?: string | null })
            : null
          const vault = await fetch("/api/vault/provider")
          const vaultProjection = vault.ok
            ? ((await vault.json()) as { ready?: boolean })
            : null
          const legacyGithubVault = Boolean(accountProjection?.vault_repo)
          loadSettings(
            "hosted",
            vaultProjection?.ready || legacyGithubVault ? undefined : "vault",
            signInMethods
          )
          return
        }
        if (status.needsSetup) {
          setView({ kind: "setup" })
        } else {
          loadSettings("self-hosted")
        }
      })
      .catch((err: unknown) => {
        setView({ kind: "error", message: errorMessage(err) })
      })
  }, [loadSettings])

  React.useEffect(() => {
    boot()
  }, [boot])

  return (
    <>
      {view.kind === "loading" && (
        <div className="flex min-h-svh items-center justify-center">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      )}
      {view.kind === "error" && (
        <div className="flex min-h-svh items-center justify-center p-6">
          <div className="flex w-full max-w-sm flex-col gap-4">
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Cannot reach the Zenod server</AlertTitle>
              <AlertDescription>{view.message}</AlertDescription>
            </Alert>
            <Button
              variant="outline"
              onClick={() => {
                setView({ kind: "loading" })
                boot()
              }}
            >
              Retry
            </Button>
          </div>
        </div>
      )}
      {view.kind === "setup" && (
        <SetupWizard onComplete={() => loadSettings("self-hosted")} />
      )}
      {view.kind === "login" && (
        <Login onSuccess={() => loadSettings("self-hosted")} />
      )}
      {view.kind === "hosted-login" && <HostedLogin methods={view.methods} />}
      {view.kind === "hosted-account" && <HostedAccount />}
      {view.kind === "settings" && (
        <Settings
          initialSettings={view.settings}
          edition={view.edition}
          initialTab={
            initialTabFromHash() ??
            hostedInitialTab ??
            (githubReturn &&
            (view.settings.provider === "openai"
              ? view.settings.openai_api_key
              : view.settings.anthropic_api_key) === null
              ? "keys"
              : undefined)
          }
          onLoggedOut={() => window.location.assign("/")}
        />
      )}
      <Toaster />
    </>
  )
}

interface ZenodAdminOverview {
  service: { status: string; name: string; version: string; sha: string }
  signup: { open: boolean }
  totals: {
    accounts: number
    tenantBound: number
    active: number
    pastDue: number
    paused: number
    canceled: number
    pending: number
  }
  tenants: Array<{
    accountId: string
    githubLogin: string
    tenantId: string | null
    tier: string | null
    subscriptionStatus: string | null
    currentPeriodEnd: string | null
    managedAiStatus: string
  }>
  generatedAt: string
}

export function ZenodAdmin() {
  const [overview, setOverview] = React.useState<ZenodAdminOverview | null>(
    null
  )
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    api<ZenodAdminOverview>("/api/admin/overview")
      .then(setOverview)
      .catch((cause: unknown) => setError(errorMessage(cause)))
  }, [])

  return (
    <>
      <main className="mx-auto flex min-h-svh max-w-5xl flex-col gap-6 p-6 lg:p-10">
        <header className="flex flex-col gap-2 border-b pb-5">
          <p className="text-sm font-medium text-muted-foreground">
            Zenod admin
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Service overview
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Read-only production health and tenant state. Customer controls and
            Phylax operations remain on their own surfaces.
          </p>
        </header>
        {!overview && !error && (
          <div className="flex min-h-48 items-center justify-center">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Cannot load Zenod admin</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {overview && (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader>
                  <CardDescription>Service</CardDescription>
                  <CardTitle className="flex items-center gap-2">
                    Zenod{" "}
                    <Badge variant="secondary">{overview.service.status}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  {overview.service.sha.slice(0, 8)} ·{" "}
                  {overview.service.version}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Signup</CardDescription>
                  <CardTitle>
                    {overview.signup.open ? "Open" : "Closed"}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Accounts</CardDescription>
                  <CardTitle>{overview.totals.accounts}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Tenant bound</CardDescription>
                  <CardTitle>{overview.totals.tenantBound}</CardTitle>
                </CardHeader>
              </Card>
            </section>
            <Card>
              <CardHeader>
                <CardTitle>Tenants</CardTitle>
                <CardDescription>
                  {overview.totals.active} active · {overview.totals.pastDue}{" "}
                  past due · {overview.totals.paused} paused ·{" "}
                  {overview.totals.canceled} canceled ·{" "}
                  {overview.totals.pending} pending
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="border-b text-muted-foreground">
                    <tr>
                      <th className="py-3 pr-4 font-medium">GitHub</th>
                      <th className="py-3 pr-4 font-medium">Tenant</th>
                      <th className="py-3 pr-4 font-medium">Plan</th>
                      <th className="py-3 pr-4 font-medium">Subscription</th>
                      <th className="py-3 font-medium">AI state</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.tenants.map((tenant) => (
                      <tr
                        key={tenant.accountId}
                        className="border-b last:border-0"
                      >
                        <td className="py-3 pr-4 font-medium">
                          {tenant.githubLogin}
                        </td>
                        <td className="py-3 pr-4 font-mono text-xs">
                          {tenant.tenantId ?? "—"}
                        </td>
                        <td className="py-3 pr-4">{tenant.tier ?? "—"}</td>
                        <td className="py-3 pr-4">
                          {tenant.subscriptionStatus ?? "pending"}
                        </td>
                        <td className="py-3">{tenant.managedAiStatus}</td>
                      </tr>
                    ))}
                    {overview.tenants.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="py-8 text-center text-muted-foreground"
                        >
                          No customer accounts yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </>
  )
}

export function App() {
  return window.location.pathname === "/admin" ? (
    <ZenodAdmin />
  ) : (
    <CustomerApp />
  )
}

export default App
