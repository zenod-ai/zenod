import * as React from "react"
import {
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  RefreshCwIcon,
  SaveIcon,
  SendIcon,
  TriangleAlertIcon,
  UnplugIcon,
} from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage, type TelegramStatus } from "@/lib/api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"

function statusLabel(status: TelegramStatus | null): string {
  if (!status) return "Loading"
  if (!status.enabled) return "Disabled"
  if (status.state === "connected") return "Connected"
  if (status.state === "error") return "Needs attention"
  return "Disconnected"
}

function parseAllowlist(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function timeAgo(epochMs: number | null): string {
  if (!epochMs) return "never"
  const seconds = Math.max(0, Math.round((Date.now() - epochMs) / 1000))
  if (seconds < 60) return seconds <= 1 ? "just now" : `${seconds} sec ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

export function TelegramConnect() {
  const [status, setStatus] = React.useState<TelegramStatus | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [handle, setHandle] = React.useState("")
  const [botToken, setBotToken] = React.useState("")
  const [showToken, setShowToken] = React.useState(false)
  const [rich, setRich] = React.useState(true)
  const [acceptAll, setAcceptAll] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [disconnecting, setDisconnecting] = React.useState(false)

  const loadStatus = React.useCallback(() => {
    return api<TelegramStatus>("/api/telegram/status")
      .then((result) => {
        setStatus(result)
        setLoadError(null)
        setHandle(result.allowedUsers.join("\n"))
        setRich(result.rich)
        setAcceptAll(result.acceptAll)
      })
      .catch((err: unknown) => setLoadError(errorMessage(err)))
  }, [])

  React.useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  React.useEffect(() => {
    if (!status?.enabled || status.state === "disabled") return
    const timer = window.setInterval(() => void loadStatus(), 3000)
    return () => window.clearInterval(timer)
  }, [loadStatus, status?.enabled, status?.state])

  async function saveSettings(enabled: boolean) {
    setSaving(true)
    try {
      const body: {
        enabled: boolean
        botToken?: string
        allowedUsers: string[]
        acceptAll: boolean
        rich: boolean
      } = {
        enabled,
        allowedUsers: parseAllowlist(handle),
        acceptAll,
        rich,
      }
      if (botToken.trim()) body.botToken = botToken.trim()
      const result = await api<TelegramStatus>("/api/telegram/settings", {
        method: "PUT",
        body,
      })
      setStatus(result)
      setBotToken("")
      toast.success(enabled ? "Telegram connected" : "Telegram settings saved")
      return result
    } catch (err) {
      toast.error("Could not save Telegram settings", {
        description: errorMessage(err),
      })
      return null
    } finally {
      setSaving(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      await saveSettings(false)
    } finally {
      setDisconnecting(false)
    }
  }

  const connected = status?.state === "connected"
  const canConnect = handle.trim().length > 0 && (status?.hasToken || botToken.trim().length > 0)

  return (
    <Card>
      <CardHeader>
        <SendIcon className="size-5 text-muted-foreground" />
        <CardTitle className="flex items-center gap-2">
          Telegram
          <Badge variant={connected ? "secondary" : "outline"}>
            {connected && <CheckIcon />}
            {statusLabel(status)}
          </Badge>
        </CardTitle>
        <CardDescription>
          Talk to Zeno from a Telegram bot. Create one with{" "}
          <span className="font-mono">@BotFather</span>, paste its token below,
          and add your handle so only you can message it. Replies use Telegram&apos;s
          rich formatting (tables, lists, headings).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {loadError !== null && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Could not load Telegram status</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {status?.lastError && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Telegram needs attention</AlertTitle>
            <AlertDescription>{status.lastError}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel>Bot</FieldLabel>
            <p className="text-sm text-muted-foreground">
              {status?.botUsername ? `@${status.botUsername}` : "not connected"}
            </p>
          </Field>
          <Field>
            <FieldLabel>Last activity</FieldLabel>
            <p className="text-sm text-muted-foreground">
              {timeAgo(status?.lastActivity ?? null)}
            </p>
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="telegram-token">Bot token</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="telegram-token"
              type={showToken ? "text" : "password"}
              placeholder={
                status?.hasToken ? "•••• saved — paste a new token to replace" : "123456789:ABCdef…"
              }
              value={botToken}
              onChange={(event) => setBotToken(event.target.value)}
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
          <FieldDescription>
            From <span className="font-mono">@BotFather</span> → <span className="font-mono">/newbot</span>.
            Stored encrypted; never shown again after saving.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="telegram-handle">Allowed handle</FieldLabel>
          <Input
            id="telegram-handle"
            placeholder="@alfablok"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            disabled={acceptAll}
          />
          <FieldDescription>
            Your Telegram @handle (or numeric ID). One per line for more than one.
            Only these can trigger Zeno.
          </FieldDescription>
        </Field>

        <div className="flex flex-col gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={rich}
              onChange={(event) => setRich(event.target.checked)}
            />
            Rich message formatting (tables, lists, headings)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={acceptAll}
              onChange={(event) => setAcceptAll(event.target.checked)}
            />
            Accept every sender
          </label>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => void saveSettings(true)}
          disabled={saving || !canConnect}
        >
          {saving ? <Spinner /> : <SaveIcon data-icon="inline-start" />}
          {connected ? "Save & reconnect" : "Save & connect"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => void loadStatus()}>
          <RefreshCwIcon data-icon="inline-start" />
          Refresh
        </Button>

        {status?.enabled && (
          <Button
            type="button"
            variant="ghost"
            disabled={disconnecting}
            onClick={() => void handleDisconnect()}
          >
            {disconnecting ? <Spinner /> : <UnplugIcon data-icon="inline-start" />}
            Disconnect
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
