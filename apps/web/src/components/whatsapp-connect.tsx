import * as React from "react"
import * as QRCode from "qrcode"
import {
  CheckIcon,
  QrCodeIcon,
  RefreshCwIcon,
  SaveIcon,
  SmartphoneIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UnplugIcon,
} from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage, type WhatsAppStatus } from "@/lib/api"
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
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"

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
      <canvas ref={canvasRef} className="size-[220px]" aria-label="WhatsApp pairing QR code" />
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
    if (!status?.enabled || status.state === "connected" || status.state === "disabled") return
    const timer = window.setInterval(() => void loadStatus(), 2000)
    return () => window.clearInterval(timer)
  }, [loadStatus, status?.enabled, status?.state])

  async function saveSettings(enabled = status?.enabled ?? false) {
    setSaving(true)
    try {
      const result = await api<WhatsAppStatus>("/api/whatsapp/settings", {
        method: "PUT",
        body: {
          enabled,
          allowedSenders: parseAllowlist(allowlist),
          acceptAll,
          groupsEnabled,
        },
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
      await saveSettings(true)
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

  const connected = status?.state === "connected"
  const pairingActive = status?.state === "pairing" && status.qr

  return (
    <Card>
      <CardHeader>
        <SmartphoneIcon className="size-5 text-muted-foreground" />
        <CardTitle className="flex items-center gap-2">
          WhatsApp
          <Badge variant={connected ? "secondary" : "outline"}>
            {connected && <CheckIcon />}
            {statusLabel(status)}
          </Badge>
        </CardTitle>
        <CardDescription>
          Link a dedicated WhatsApp or WhatsApp Business number with a local
          Baileys session. Only allowlisted senders can trigger Zeno replies.
          Baileys is an unofficial WhatsApp Web adapter.
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel>Linked number</FieldLabel>
            <p className="text-sm text-muted-foreground">
              {status?.linkedNumber ?? "not linked"}
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
            One phone number per line. Zenod normalizes punctuation and country
            prefixes before matching.
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
        <Button type="button" onClick={() => void handlePair()} disabled={pairing}>
          {pairing ? <Spinner /> : <QrCodeIcon data-icon="inline-start" />}
          {connected ? "Re-pair" : "Pair number"}
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

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={resetting}
            >
              {resetting ? <Spinner /> : <Trash2Icon data-icon="inline-start" />}
              Reset session
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset WhatsApp session?</AlertDialogTitle>
              <AlertDialogDescription>
                Zenod deletes the local linked-device session. You will need to
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
