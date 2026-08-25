import * as React from "react"
import * as QRCode from "qrcode"
import {
  CheckIcon,
  CloudIcon,
  FileCheckIcon,
  ListChecksIcon,
  QrCodeIcon,
  RefreshCwIcon,
  RouteIcon,
  SaveIcon,
  SendIcon,
  ServerIcon,
  SmartphoneIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UnplugIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  type HostedChannelsResponse,
  type HostedWhatsAppChallengeResponse,
  type HostedWhatsAppDisconnectResponse,
  type HostedWhatsAppTestResponse,
  type WhatsAppStatus,
} from "@/lib/api"
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
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  clearHostedChannelOperation,
  clearHostedWhatsAppRecovery,
  hostedChannelOperationKey,
} from "@/lib/hosted-channel-operations"

type NotifyReceipt = {
  sent: number
  recipients: string[]
}

function statusLabel(status: WhatsAppStatus | null): string {
  if (!status) return "Loading"
  if (!status.enabled) return "Disabled"
  if (status.state === "connected") return "Connected"
  if (status.state === "pairing") return "Pairing"
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

function diagnosticText(status: WhatsAppStatus | null): string {
  if (!status) return "loading"
  const diag = status.diagnostics
  if (diag.store.lastInbound) {
    const inbound = diag.store.lastInbound
    return `last inbound ${timeAgo(inbound.at)} from ${inbound.sender ?? "unknown"} (${inbound.status})`
  }
  if (diag.lastIgnoredReason) {
    return `last event ${timeAgo(diag.lastIgnoredAt)} ignored: ${diag.lastIgnoredReason}`
  }
  if (diag.lastUpsertAt) {
    return `last event ${timeAgo(diag.lastUpsertAt)} (${diag.lastUpsertType ?? "unknown"})`
  }
  return "no WhatsApp messages seen yet"
}

function statusBadgeVariant(
  status: WhatsAppStatus | null
): React.ComponentProps<typeof Badge>["variant"] {
  if (!status || !status.enabled) return "outline"
  if (status.state === "connected") return "secondary"
  if (status.state === "error") return "destructive"
  return "outline"
}

function lastOutboundText(status: WhatsAppStatus | null): string {
  const outbound = status?.diagnostics.store.lastOutbound
  if (!outbound) return "no delivery receipt yet"
  return `${outbound.status} ${timeAgo(outbound.at)}`
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

function ModeTile({
  icon,
  title,
  badge,
  active = false,
  children,
}: {
  icon: React.ReactNode
  title: string
  badge: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex min-h-32 flex-col gap-2 rounded-lg border p-3",
        active && "border-primary/30 bg-primary/5"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          {icon}
          {title}
        </div>
        <Badge variant={active ? "secondary" : "outline"}>{badge}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

function PairingQr({ value }: { value: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)

  React.useEffect(() => {
    if (!canvasRef.current) return
    void QRCode.toCanvas(canvasRef.current, value, {
      margin: 1,
      width: 220,
      errorCorrectionLevel: "M",
    })
  }, [value])

  return (
    <div className="flex justify-center rounded-md border bg-white p-3">
      <canvas
        ref={canvasRef}
        className="size-[220px]"
        aria-label="WhatsApp pairing QR code"
      />
    </div>
  )
}

export function WhatsAppConnect() {
  const [status, setStatus] = React.useState<WhatsAppStatus | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [allowlist, setAllowlist] = React.useState("")
  const [acceptAll, setAcceptAll] = React.useState(false)
  const [groupsEnabled, setGroupsEnabled] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [pairing, setPairing] = React.useState(false)
  const [disconnecting, setDisconnecting] = React.useState(false)
  const [resetting, setResetting] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testReceipt, setTestReceipt] = React.useState<NotifyReceipt | null>(
    null
  )

  const loadStatus = React.useCallback(() => {
    return api<WhatsAppStatus>("/api/whatsapp/status")
      .then((result) => {
        setStatus(result)
        setLoadError(null)
        setAllowlist(result.allowedSenders.join("\n"))
        setAcceptAll(result.acceptAll)
        setGroupsEnabled(result.groupsEnabled)
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

  async function saveSettings(
    enabled: boolean | null = status?.enabled ?? false
  ) {
    setSaving(true)
    try {
      const body: {
        enabled?: boolean
        allowedSenders: string[]
        acceptAll: boolean
        groupsEnabled: boolean
      } = {
        allowedSenders: parseAllowlist(allowlist),
        acceptAll,
        groupsEnabled,
      }
      if (enabled !== null) body.enabled = enabled
      const result = await api<WhatsAppStatus>("/api/whatsapp/settings", {
        method: "PUT",
        body,
      })
      setStatus(result)
      toast.success("WhatsApp settings saved")
      return result
    } catch (err) {
      toast.error("Could not save WhatsApp settings", {
        description: errorMessage(err),
      })
      return null
    } finally {
      setSaving(false)
    }
  }

  async function handlePair() {
    setPairing(true)
    try {
      await saveSettings(null)
      const result = await api<WhatsAppStatus>("/api/whatsapp/pair", {
        method: "POST",
      })
      setStatus(result)
      toast.success("WhatsApp pairing started")
    } catch (err) {
      toast.error("Could not start WhatsApp pairing", {
        description: errorMessage(err),
      })
    } finally {
      setPairing(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      const result = await api<WhatsAppStatus>("/api/whatsapp/disconnect", {
        method: "POST",
      })
      setStatus(result)
      toast.success("WhatsApp disconnected")
    } catch (err) {
      toast.error("Could not disconnect WhatsApp", {
        description: errorMessage(err),
      })
    } finally {
      setDisconnecting(false)
    }
  }

  async function handleReset() {
    setResetting(true)
    try {
      const result = await api<WhatsAppStatus>("/api/whatsapp/reset-session", {
        method: "POST",
        body: { confirm: "RESET" },
      })
      setStatus(result)
      toast.success("WhatsApp session reset")
    } catch (err) {
      toast.error("Could not reset WhatsApp session", {
        description: errorMessage(err),
      })
    } finally {
      setResetting(false)
    }
  }

  async function handleTestMessage() {
    setTesting(true)
    try {
      const result = await api<NotifyReceipt>("/api/notify", {
        method: "POST",
        body: {
          surface: "whatsapp",
          eventType: "phylax.channel_test",
          severity: "info",
          text: "Phylax WhatsApp channel test: Ring outbound delivery path is reachable.",
        },
      })
      setTestReceipt(result)
      toast.success("WhatsApp test sent", {
        description:
          result.sent > 0
            ? `Delivered to ${result.sent} recipient${result.sent === 1 ? "" : "s"}.`
            : "No WhatsApp recipient was available.",
      })
      void loadStatus()
    } catch (err) {
      toast.error("Could not send WhatsApp test", {
        description: errorMessage(err),
      })
    } finally {
      setTesting(false)
    }
  }

  const connected = status?.state === "connected"
  const pairingActive = status?.state === "pairing" && status.qr

  return (
    <Card>
      <CardHeader>
        <SmartphoneIcon className="size-5 text-muted-foreground" />
        <CardTitle className="flex items-center gap-2">
          WhatsApp
          <Badge variant={statusBadgeVariant(status)}>
            {connected && <CheckIcon />}
            {statusLabel(status)}
          </Badge>
        </CardTitle>
        <CardDescription>
          Phylax handles WhatsApp transport for the Ring: inbound messages go to
          Ring, outbound responses come from Ring. It does not decide, remember,
          transcribe, archive, or digest.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {loadError !== null && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Could not load WhatsApp status</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {status?.lastError && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>WhatsApp needs attention</AlertTitle>
            <AlertDescription>{status.lastError}</AlertDescription>
          </Alert>
        )}

        {pairingActive && <PairingQr value={status.qr!} />}

        <div className="grid gap-3 sm:grid-cols-2">
          <ModeTile
            icon={<CloudIcon className="size-4 text-muted-foreground" />}
            title="Managed cloud"
            badge="Cloud"
          >
            Provider number and webhook delivery belong here when the hosted
            WhatsApp provider is wired. No QR pairing is required for a cloud
            tenant.
          </ModeTile>
          <ModeTile
            icon={<ServerIcon className="size-4 text-muted-foreground" />}
            title="Self-host/dev QR"
            badge="Current"
            active
          >
            This build uses a local Baileys WhatsApp Web session with isolated
            session state. QR pairing is kept for dogfood and self-hosting.
          </ModeTile>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FieldValue
            label="Provider"
            value="Baileys Web session"
            detail="unofficial WhatsApp Web adapter"
          />
          <FieldValue
            label="Linked number"
            value={status?.linkedNumber ?? "not linked"}
          />
          <FieldValue
            label="Session health"
            value={statusLabel(status)}
            detail={diagnosticText(status)}
          />
          <FieldValue
            label="Last activity"
            value={timeAgo(status?.lastActivity ?? null)}
            detail={`alias refresh ${timeAgo(status?.diagnostics.lastAliasRefreshAt ?? null)}`}
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <RouteIcon className="size-4 text-muted-foreground" />
              Ring handoff
            </div>
            <p className="text-sm text-muted-foreground">
              Inbound WhatsApp turns are handed to Ring. Ring replies through
              Phylax using the same channel and chat provenance.
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <FileCheckIcon className="size-4 text-muted-foreground" />
              Media handoff
            </div>
            <p className="text-sm text-muted-foreground">
              Phylax exposes media handles to Ring. Zenod owns ingest, archive,
              transcription, OCR, digest, filing, and receipts.
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <ListChecksIcon className="size-4 text-muted-foreground" />
              Delivery log
            </div>
            <p className="text-sm text-muted-foreground">
              {lastOutboundText(status)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {status?.diagnostics.store.outboundAudits ?? 0} outbound audit
              rows; {status?.diagnostics.store.inboundMessages ?? 0} inbound
              rows.
            </p>
            {testReceipt && (
              <p className="mt-1 text-xs text-muted-foreground">
                Last test sent to {testReceipt.sent} recipient
                {testReceipt.sent === 1 ? "" : "s"}.
              </p>
            )}
          </div>
        </div>

        <Field>
          <FieldLabel htmlFor="whatsapp-allowlist">Allowed senders</FieldLabel>
          <Textarea
            id="whatsapp-allowlist"
            rows={3}
            placeholder="+34652029134&#10;+15551234567"
            value={allowlist}
            onChange={(event) => setAllowlist(event.target.value)}
            disabled={acceptAll}
          />
          <FieldDescription>
            One phone number per line. Phylax normalizes punctuation and country
            prefixes before matching; Ring receives only allowed turns.
          </FieldDescription>
        </Field>

        <div className="flex flex-col gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={acceptAll}
              onChange={(event) => setAcceptAll(event.target.checked)}
            />
            Accept every sender
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={groupsEnabled}
              onChange={(event) => setGroupsEnabled(event.target.checked)}
            />
            Allow group chats
          </label>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void saveSettings()}
          disabled={saving}
        >
          {saving ? <Spinner /> : <SaveIcon data-icon="inline-start" />}
          Save settings
        </Button>
        <Button
          type="button"
          onClick={() => void handlePair()}
          disabled={pairing}
        >
          {pairing ? <Spinner /> : <QrCodeIcon data-icon="inline-start" />}
          {connected ? "Re-pair" : "Pair number"}
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

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={resetting}
            >
              {resetting ? (
                <Spinner />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
              Reset session
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset WhatsApp session?</AlertDialogTitle>
              <AlertDialogDescription>
                Phylax deletes the local linked-device session. You will need to
                pair the WhatsApp number again. The allowlist is kept.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => void handleReset()}
              >
                Reset session
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  )
}

function hostedStatusLabel(
  status: HostedChannelsResponse["whatsapp"]["state"] | null
): string {
  if (!status) return "Loading"
  if (status === "awaiting_code") return "Awaiting code"
  if (status === "verified") return "Connected"
  if (status === "degraded") return "Needs attention"
  if (status === "paused") return "Paused"
  return "Not connected"
}

function hostedBadgeVariant(
  status: HostedChannelsResponse["whatsapp"]["state"] | null
): React.ComponentProps<typeof Badge>["variant"] {
  if (status === "verified") return "secondary"
  if (status === "degraded" || status === "paused") return "destructive"
  return "outline"
}

/** Customer-safe adapter over the existing tenant sender verification store. */
export function HostedWhatsAppConnect({
  initial,
  onChanged,
}: {
  initial: HostedChannelsResponse | null
  onChanged: (channels: HostedChannelsResponse) => void
}) {
  const [sender, setSender] = React.useState("")
  const [challenge, setChallenge] = React.useState<
    HostedWhatsAppChallengeResponse["challenge"] | null
  >(null)
  const [busy, setBusy] = React.useState<
    "challenge" | "test" | "disconnect" | null
  >(null)
  const [error, setError] = React.useState<string | null>(null)

  const publish = React.useCallback(
    (next: HostedChannelsResponse) => {
      onChanged(next)
    },
    [onChanged]
  )

  React.useEffect(() => {
    if (initial?.whatsapp.state !== "awaiting_code") return
    const timer = window.setInterval(() => {
      void api<HostedChannelsResponse>("/api/channels")
        .then((next) => {
          publish(next)
          if (next.whatsapp.state === "verified") {
            setChallenge(null)
            clearHostedWhatsAppRecovery()
            toast.success("WhatsApp connected to Zenod")
          }
        })
        .catch(() => {})
    }, 3000)
    return () => window.clearInterval(timer)
  }, [initial?.whatsapp.state, publish])

  async function createChallenge(resetOperation = false) {
    setBusy("challenge")
    setError(null)
    try {
      const result = await api<HostedWhatsAppChallengeResponse>(
        "/api/channels/whatsapp/challenge",
        {
          method: "POST",
          body: {
            operationId: hostedChannelOperationKey(
              "whatsapp.challenge",
              initial?.whatsapp.revision ?? "0",
              resetOperation
            ),
            ...(sender.trim() ? { sender } : {}),
          },
        }
      )
      publish(result.channels)
      setChallenge(result.challenge)
      toast.success("WhatsApp verification started")
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
      const result = await api<HostedWhatsAppTestResponse>(
        "/api/channels/whatsapp/test",
        {
          method: "POST",
          body: {
            operationId: hostedChannelOperationKey(
              "whatsapp.test",
              initial?.whatsapp.revision ?? "0"
            ),
          },
        }
      )
      publish(result.channels)
      clearHostedChannelOperation("whatsapp.test")
      toast.success("Zenod test delivered")
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
      const result = await api<HostedWhatsAppDisconnectResponse>(
        "/api/channels/whatsapp/disconnect",
        {
          method: "POST",
          body: {
            operationId: hostedChannelOperationKey(
              "whatsapp.disconnect",
              initial?.whatsapp.revision ?? "0"
            ),
          },
        }
      )
      publish(result.channels)
      clearHostedChannelOperation("whatsapp.disconnect")
      clearHostedWhatsAppRecovery()
      setChallenge(null)
      setSender("")
      toast.success("WhatsApp disconnected")
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const status = initial?.whatsapp ?? null
  const connected = status?.state === "verified"
  const awaiting = status?.state === "awaiting_code"
  const preservedBinding =
    connected || status?.state === "degraded" || status?.state === "paused"

  return (
    <Card>
      <CardHeader>
        <SmartphoneIcon className="size-5 text-muted-foreground" />
        <CardTitle className="flex items-center gap-2">
          WhatsApp
          <Badge variant={hostedBadgeVariant(status?.state ?? null)}>
            {connected && <CheckIcon />}
            {hostedStatusLabel(status?.state ?? null)}
          </Badge>
        </CardTitle>
        <CardDescription>
          Included with Zenod Hosted for one verified sender.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>WhatsApp needs attention</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {awaiting && challenge && (
          <Alert>
            <SendIcon />
            <AlertTitle>Send this code from your WhatsApp</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>
                Message <strong>{challenge.code}</strong> to{" "}
                <strong>{challenge.sharedNumber}</strong>.
              </span>
              <span>
                Keep this page open. Zenod will confirm the sender
                automatically.
              </span>
            </AlertDescription>
          </Alert>
        )}

        {awaiting && !challenge && (
          <Alert>
            <SendIcon />
            <AlertTitle>Verification is still waiting</AlertTitle>
            <AlertDescription>
              For safety, Zenod does not store the one-time code. Show the same
              code again, issue a new one, or cancel this setup.
            </AlertDescription>
          </Alert>
        )}

        {status?.state === "degraded" && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Your sender is still connected</AlertTitle>
            <AlertDescription>
              Delivery needs attention. Refresh or send a test; Zenod will not
              replace the verified sender.
            </AlertDescription>
          </Alert>
        )}

        {status?.state === "paused" && (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>Your sender is connected but paused</AlertTitle>
            <AlertDescription>
              The verified sender is preserved. Send a test after service
              resumes; no new verification is required.
            </AlertDescription>
          </Alert>
        )}

        {status?.senderHint && (
          <FieldValue
            label="Verified sender"
            value={status.senderHint}
            detail={
              preservedBinding
                ? `Last message ${timeAgo(status.lastInboundAt)}`
                : "Verification is not complete yet"
            }
          />
        )}

        {!preservedBinding && !awaiting && (
          <Field>
            <FieldLabel htmlFor="hosted-whatsapp-sender">
              Your WhatsApp sender number
            </FieldLabel>
            <Input
              id="hosted-whatsapp-sender"
              type="tel"
              autoComplete="tel"
              placeholder="+34 600 000 000"
              value={sender}
              onChange={(event) => setSender(event.target.value)}
            />
            <FieldDescription>
              Zenod verifies only this sender. It never asks for a QR code or
              reads your other chats.
            </FieldDescription>
          </Field>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {!preservedBinding && !awaiting && (
          <Button
            type="button"
            onClick={() => void createChallenge()}
            disabled={!sender.trim() || busy !== null}
          >
            {busy === "challenge" ? <Spinner /> : <SendIcon />}
            Create one-time code
          </Button>
        )}
        {awaiting && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => void createChallenge(false)}
              disabled={busy !== null}
            >
              {busy === "challenge" ? <Spinner /> : <RefreshCwIcon />}
              Show code again
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void createChallenge(true)}
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
        )}
        {preservedBinding && (
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
                  <AlertDialogTitle>Disconnect WhatsApp?</AlertDialogTitle>
                  <AlertDialogDescription>
                    New WhatsApp messages will no longer reach this Zenod.
                    Existing memories stay in your vault.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep connected</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => void disconnect()}
                  >
                    Disconnect
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
