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
import { Spinner } from "@/components/ui/spinner"
import { Toaster } from "@/components/ui/sonner"
import { Login } from "@/views/Login"
import { HostedAccount } from "@/views/HostedAccount"
import { HostedLogin } from "@/views/HostedLogin"
import { Settings } from "@/views/Settings"
import { SetupWizard } from "@/views/SetupWizard"

type View =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "login" }
  | { kind: "hosted-login" }
  | { kind: "hosted-account" }
  | { kind: "settings"; settings: SettingsValues }
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

function initialTabFromHash(): "connections" | undefined {
  return window.location.hash === "#ring-router-products" ||
    window.location.hash === "#phylax-channels"
    ? "connections"
    : undefined
}

export function App() {
  const [view, setView] = React.useState<View>({ kind: "loading" })
  const [githubReturn] = React.useState(consumeGithubReturn)

  React.useEffect(() => {
    if (githubReturn) {
      toast.success("GitHub connected")
    }
  }, [githubReturn])

  const loadSettings = React.useCallback(() => {
    api<SettingsResponse>("/api/settings")
      .then((result) => {
        setView({ kind: "settings", settings: result.settings })
      })
      .catch((err: unknown) => {
        if (isUnauthorized(err)) {
          setView({ kind: "login" })
        } else {
          setView({ kind: "error", message: errorMessage(err) })
        }
      })
  }, [])

  const boot = React.useCallback(() => {
    api<AuthStatus>("/api/auth/status")
      .then(async (status) => {
        if (status.customerAuth) {
          const me = await fetch("/api/me")
          if (me.status === 401) {
            setView({ kind: "hosted-login" })
            return
          }
          const account = await fetch("/api/console/account")
          if (window.location.pathname === "/account" || account.status === 404) {
            setView({ kind: "hosted-account" })
            return
          }
          loadSettings()
          return
        }
        if (status.needsSetup) {
          setView({ kind: "setup" })
        } else {
          loadSettings()
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
      {view.kind === "setup" && <SetupWizard onComplete={loadSettings} />}
      {view.kind === "login" && <Login onSuccess={loadSettings} />}
      {view.kind === "hosted-login" && <HostedLogin />}
      {view.kind === "hosted-account" && <HostedAccount />}
      {view.kind === "settings" && (
        <Settings
          initialSettings={view.settings}
          initialTab={
            initialTabFromHash() ??
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

export default App
