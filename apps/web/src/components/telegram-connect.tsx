import * as React from "react"
import {
  BotIcon,
  CheckIcon,
  FileCheckIcon,
  EyeIcon,
  EyeOffIcon,
  ListChecksIcon,
  RefreshCwIcon,
  RouteIcon,
  SaveIcon,
  SendIcon,
  TriangleAlertIcon,
  UnplugIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  type HostedChannelsResponse,
  type HostedTelegramConnectResponse,
  type HostedTelegramDisconnectResponse,
  type HostedTelegramTestResponse,
  type TelegramStatus,
} from "@/lib/api"
import {
  clearHostedChannelOperation,
  hostedChannelOperationKey,
} from "@/lib/hosted-channel-operations"
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"

type NotifyReceipt = {
  sent: number
  recipients: string[]
}

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

function statusBadgeVariant(
  status: TelegramStatus | null
): React.ComponentProps<typeof Badge>["variant"] {
  if (!status || !status.enabled) return "outline"
  if (status.state === "connected") return "secondary"
  if (status.state === "error") return "destructive"
  return "outline"
}

function FieldValue({
  label,
  value,
  detail,
}: {
  label: string
  value: React.ReactNode
  detail?: React.ReactNode
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <p className="text-sm text-muted-foreground">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </Field>
  )
}

export function TelegramConnect({
  presentation = "transport-admin",
}: {
  presentation?: "transport-admin" | "zenod-self-hosted"
}) {
  const [status, setStatus] = React.useState<TelegramStatus | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [handle, setHandle] = React.useState("")
  const [botToken, setBotToken] = React.useState("")
  const [showToken, setShowToken] = React.useState(false)
  const [rich, setRich] = React.useState(true)
  const [acceptAll, setAcceptAll] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [disconnecting, setDisconnecting] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testReceipt, setTestReceipt] = React.useState<NotifyReceipt | null>(
    null
  )

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

  async function handleTestMessage() {
    setTesting(true)
    try {
      const result = await api<NotifyReceipt>("/api/notify", {
        method: "POST",
        body: {
          surface: "telegram",
          eventType: "phylax.channel_test",
          severity: "info",
          text:
            presentation === "zenod-self-hosted"
              ? "Zenod Telegram channel test: outbound delivery is reachable."
              : "Phylax Telegram channel test: Ring outbound delivery path is reachable.",
        },
      })
      setTestReceipt(result)
      toast.success("Telegram test sent", {
        description:
          result.sent > 0
            ? `Delivered to ${result.sent} recipient${result.sent === 1 ? "" : "s"}.`
            : "No Telegram recipient was available.",
      })
      void loadStatus()
    } catch (err) {
      toast.error("Could not send Telegram test", {
        description: errorMessage(err),
      })
    } finally {
      setTesting(false)
    }
  }

  const connected = status?.state === "connected"
  const zenodSelfHosted = presentation === "zenod-self-hosted"
  const canConnect =
    handle.trim().length > 0 && (status?.hasToken || botToken.trim().length > 0)

  return (
    <Card>
      <CardHeader>
        <SendIcon className="size-5 text-muted-foreground" />
        <CardTitle className="flex items-center gap-2">
          Telegram
          <Badge variant={statusBadgeVariant(status)}>
            {connected && <CheckIcon />}
            {statusLabel(status)}
          </Badge>
        </CardTitle>
        <CardDescription>
          {zenodSelfHosted
            ? "Use a Telegram bot token you own to talk directly to this Zenod."
            : "Phylax handles Telegram transport for the Ring: inbound bot updates go to Ring, outbound responses come from Ring. It does not decide, remember, transcribe, archive, or digest."}
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

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FieldValue
            label="Provider"
            value="Telegram Bot API"
            detail={
              zenodSelfHosted
                ? "bot token stored by this Zenod"
                : "bot token held by Phylax"
            }
          />
          <FieldValue
            label="Bot"
            value={
              status?.botUsername ? `@${status.botUsername}` : "not connected"
            }
          />
          <FieldValue
            label="Session health"
            value={statusLabel(status)}
            detail={status?.rich ? "rich replies enabled" : "plain replies"}
          />
          <FieldValue
            label="Last activity"
            value={timeAgo(status?.lastActivity ?? null)}
            detail={status?.hasToken ? "token saved" : "no token saved"}
          />
        </div>

        {!zenodSelfHosted && (
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2 font-medium">
                <RouteIcon className="size-4 text-muted-foreground" />
                Ring handoff
              </div>
              <p className="text-sm text-muted-foreground">
                Telegram updates are handed to Ring. Ring replies through Phylax
                using the same channel and chat provenance.
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2 font-medium">
                <FileCheckIcon className="size-4 text-muted-foreground" />
                Media handoff
              </div>
              <p className="text-sm text-muted-foreground">
                Phylax exposes Telegram file handles to Ring. Zenod owns ingest,
                archive, transcription, OCR, digest, filing, and receipts.
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2 font-medium">
                <ListChecksIcon className="size-4 text-muted-foreground" />
                Delivery log
              </div>
              <p className="text-sm text-muted-foreground">
                Telegram delivery receipts are not exposed as a live feed yet.
              </p>
              {testReceipt ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Last test sent to {testReceipt.sent} recipient
                  {testReceipt.sent === 1 ? "" : "s"}.
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Use Send test after the bot has seen an allowed numeric chat.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <BotIcon className="size-4 text-muted-foreground" />
            Telegram setup shell
          </div>
          <p className="text-sm text-muted-foreground">
            Create a bot with <span className="font-mono">@BotFather</span>,
            paste its token below, and add allowed handles or numeric IDs so
            {zenodSelfHosted
              ? " Zenod accepts only approved senders."
              : " Phylax can accept only approved senders."}
          </p>
        </div>

        <Field>
          <FieldLabel htmlFor="telegram-token">Bot token</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="telegram-token"
              type={showToken ? "text" : "password"}
              placeholder={
                status?.hasToken
                  ? "•••• saved — paste a new token to replace"
                  : "123456789:ABCdef…"
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
            From <span className="font-mono">@BotFather</span> →{" "}
            <span className="font-mono">/newbot</span>. Stored encrypted; never
            shown again after saving.
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
            Your Telegram @handle (or numeric ID). One per line for more than
            one. Only these can message{" "}
            {zenodSelfHosted ? "Zenod" : "Phylax and Ring"}.
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
        <Button
          type="button"
          variant="ghost"
          disabled={!connected || testing}
          onClick={() => void handleTestMessage()}
        >
          {testing ? <Spinner /> : <SendIcon data-icon="inline-start" />}
          Send test
        </Button>

        {status?.enabled && (
          <Button
            type="button"
            variant="ghost"
            disabled={disconnecting}
            onClick={() => void handleDisconnect()}
          >
            {disconnecting ? (
              <Spinner />
            ) : (
              <UnplugIcon data-icon="inline-start" />
            )}
            Disconnect
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

/** Hosted customers see only their tenant binding, never bot/provider custody. */
export function HostedTelegramConnect({
  channels,
  onChanged,
}: {
  channels: HostedChannelsResponse | null
  onChanged: (channels: HostedChannelsResponse) => void
}) {
  const [identity, setIdentity] = React.useState("")
  const [challenge, setChallenge] = React.useState<
    HostedTelegramConnectResponse["challenge"] | null
  >(null)
  const [busy, setBusy] = React.useState<
    "connect" | "test" | "disconnect" | null
  >(null)
  const [error, setError] = React.useState<string | null>(null)
  const state = channels?.telegram.state ?? null
  const label =
    state === "connected"
      ? "Connected"
      : state === "degraded"
        ? "Needs attention"
        : state === "awaiting_code"
          ? "Awaiting code"
          : state === "off"
            ? "Not connected"
            : "Loading"

  React.useEffect(() => {
    if (state !== "awaiting_code") return
    const timer = window.setInterval(() => {
      void api<HostedChannelsResponse>("/api/channels")
        .then((next) => {
          onChanged(next)
          if (next.telegram.state === "connected") {
            setChallenge(null)
            clearHostedChannelOperation("telegram.connect")
            toast.success("Telegram connected to Zenod")
          }
        })
        .catch(() => {})
    }, 3000)
    return () => window.clearInterval(timer)
  }, [onChanged, state])

  async function connect(resetOperation = false) {
    setBusy("connect")
    setError(null)
    try {
      const result = await api<HostedTelegramConnectResponse>(
        "/api/channels/telegram/connect",
        {
          method: "POST",
          body: {
            ...(identity.trim() ? { identity } : {}),
            operationId: hostedChannelOperationKey(
              "telegram.connect",
              channels?.telegram.revision ?? "0",
              resetOperation
            ),
          },
        }
      )
      onChanged(result.channels)
      setChallenge(result.challenge)
      toast.success("Telegram verification started")
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function sendTest() {
    setBusy("test")
    setError(null)
    try {
      const result = await api<HostedTelegramTestResponse>(
        "/api/channels/telegram/test",
        {
          method: "POST",
          body: {
            operationId: hostedChannelOperationKey(
              "telegram.test",
              channels?.telegram.revision ?? "0"
            ),
          },
        }
      )
      onChanged(result.channels)
      clearHostedChannelOperation("telegram.test")
      toast.success("Telegram test delivered")
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function disconnect() {
    setBusy("disconnect")
    setError(null)
    try {
      const result = await api<HostedTelegramDisconnectResponse>(
        "/api/channels/telegram/disconnect",
        {
          method: "POST",
          body: {
            operationId: hostedChannelOperationKey(
              "telegram.disconnect",
              channels?.telegram.revision ?? "0"
            ),
          },
        }
      )
      onChanged(result.channels)
      clearHostedChannelOperation("telegram.disconnect")
      clearHostedChannelOperation("telegram.connect")
      setChallenge(null)
      setIdentity("")
      toast.success("Telegram disconnected")
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <SendIcon className="size-5 text-muted-foreground" />
        <CardTitle className="flex items-center gap-2">
          Telegram
          <Badge
            variant={
              state === "degraded"
                ? "destructive"
                : state === "connected"
                  ? "secondary"
                  : "outline"
            }
          >
            {state === "connected" && <CheckIcon />}
            {label}
          </Badge>
        </CardTitle>
        <CardDescription>
          Telegram reaches the same Zenod memory directly.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Telegram needs attention</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {state === "degraded" && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Your identity is still connected</AlertTitle>
            <AlertDescription>
              Delivery needs attention. The tenant binding is preserved; send a
              test after the shared Telegram service recovers.
            </AlertDescription>
          </Alert>
        )}
        {state === "awaiting_code" && challenge && (
          <Alert>
            <SendIcon />
            <AlertTitle>Send this code from your Telegram identity</AlertTitle>
            <AlertDescription>
              Message <strong>{challenge.code}</strong> to the Zenod Telegram
              bot from {channels?.telegram.identityHint ?? "that identity"}.
              Zenod activates only after that exact identity replies.
            </AlertDescription>
          </Alert>
        )}
        {state === "awaiting_code" && !challenge && (
          <Alert>
            <SendIcon />
            <AlertTitle>Telegram verification is still waiting</AlertTitle>
            <AlertDescription>
              Show the same code again, issue a new one, or cancel setup. Zenod
              has not activated this identity yet.
            </AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">
          {channels?.telegram.identityHint
            ? state === "awaiting_code"
              ? `Pending identity ${channels.telegram.identityHint}.`
              : `Linked identity ${channels.telegram.identityHint}.`
            : "No Telegram identity is linked to this account yet."}
        </p>
        {state === "off" && (
          <Field>
            <FieldLabel htmlFor="hosted-telegram-identity">
              Your Telegram username or chat ID
            </FieldLabel>
            <Input
              id="hosted-telegram-identity"
              value={identity}
              placeholder="@your_username"
              onChange={(event) => setIdentity(event.target.value)}
            />
            <FieldDescription>
              This identity is linked only to your Zenod tenant.
            </FieldDescription>
          </Field>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {state === "off" ? (
          <Button
            type="button"
            onClick={() => void connect(false)}
            disabled={!identity.trim() || busy !== null}
          >
            {busy === "connect" ? <Spinner /> : <SendIcon />}
            Connect Telegram
          </Button>
        ) : state === "awaiting_code" ? (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => void connect(false)}
              disabled={busy !== null}
            >
              {busy === "connect" ? <Spinner /> : <RefreshCwIcon />}
              Show code again
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void connect(true)}
              disabled={busy !== null}
            >
              Issue new code
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void disconnect()}
              disabled={busy !== null}
            >
              Cancel setup
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => void sendTest()}
              disabled={busy !== null}
            >
              {busy === "test" ? <Spinner /> : <SendIcon />}
              Send test
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" disabled={busy !== null}>
                  <UnplugIcon />
                  Disconnect
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect Telegram?</AlertDialogTitle>
                  <AlertDialogDescription>
                    New Telegram messages will no longer reach this Zenod.
                    Existing memories remain in your vault.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep connected</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => void disconnect()}
                  >
                    Disconnect Telegram
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </CardFooter>
    </Card>
  )
}
