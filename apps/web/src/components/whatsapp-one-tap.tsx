import * as React from "react"
import * as QRCode from "qrcode"
import { CheckIcon, MessageCircleIcon, RefreshCwIcon } from "lucide-react"

import {
  api,
  errorMessage,
  type HostedChannelsResponse,
  type HostedWhatsAppChallengeResponse,
} from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { hostedChannelOperationKey } from "@/lib/hosted-channel-operations"

// E7-S16 (Jordi 18 Nov: "What can we do to activate this guy?"): sign-up to the first Saved reply on
// WhatsApp in one tap. One button opens a WhatsApp chat with Zenod's number and the one-time code already
// typed in; sending it links the number it came from, so nobody types their number or copies a code.
// On a laptop the same link shows as a QR for the phone's camera. The typed-number path stays in Settings.

const STORE_KEY = "zenod.whatsapp-link"
const LINKED = new Set(["verified", "degraded", "paused"])

export type WhatsAppLink = { code: string; sharedNumber: string; expiresAt: number }

export function whatsappLinkMessage(code: string): string {
  return `Link my WhatsApp to Zenod: ${code}`
}

/** https://wa.me/<digits>?text=<the message with the code>: opens the chat with the message typed in. */
export function whatsappLinkUrl(link: Pick<WhatsAppLink, "code" | "sharedNumber">): string {
  const digits = link.sharedNumber.replace(/\D/g, "")
  return `https://wa.me/${digits}?text=${encodeURIComponent(whatsappLinkMessage(link.code))}`
}

function readStored(): WhatsAppLink | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<WhatsAppLink>
    return typeof value.code === "string" &&
      typeof value.sharedNumber === "string" &&
      typeof value.expiresAt === "number"
      ? (value as WhatsAppLink)
      : null
  } catch {
    return null
  }
}

function writeStored(link: WhatsAppLink | null) {
  try {
    if (link) window.localStorage.setItem(STORE_KEY, JSON.stringify(link))
    else window.localStorage.removeItem(STORE_KEY)
  } catch {
    // private mode: the link still works for this view
  }
}

/** A link this browser made that the server still waits for (same expiry, no typed number pending). */
function usableStored(channels: HostedChannelsResponse, now: number): WhatsAppLink | null {
  const stored = readStored()
  const wa = channels.whatsapp
  if (
    stored &&
    wa.state === "awaiting_code" &&
    !wa.senderHint &&
    wa.verificationExpiresAt === stored.expiresAt &&
    stored.expiresAt > now + 60_000
  )
    return stored
  return null
}

function useWide(): boolean {
  const query = "(min-width: 768px) and (pointer: fine)"
  const [wide, setWide] = React.useState(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches)
  )
  React.useEffect(() => {
    const media = window.matchMedia?.(query)
    if (!media) return
    const change = () => setWide(media.matches)
    media.addEventListener?.("change", change)
    return () => media.removeEventListener?.("change", change)
  }, [])
  return wide
}

function LinkQr({ value }: { value: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  React.useEffect(() => {
    if (!canvasRef.current) return
    void QRCode.toCanvas(canvasRef.current, value, {
      margin: 1,
      width: 176,
      errorCorrectionLevel: "M",
    }).catch(() => undefined)
  }, [value])
  return (
    <canvas
      ref={canvasRef}
      className="size-[176px] rounded-md border bg-white p-1"
      aria-label="QR code that opens WhatsApp with your code typed in"
      data-testid="whatsapp-link-qr"
    />
  )
}

/**
 * The one-tap WhatsApp link. Pass `channels` (and `onChanged`) when the parent already loads and polls
 * /api/channels (Settings); without them it loads and polls by itself (the quick start after sign-up).
 */
export function WhatsAppOneTap({
  channels: given,
  onChanged,
  fallback,
  autoStart = true,
}: {
  channels?: HostedChannelsResponse | null
  onChanged?: (channels: HostedChannelsResponse) => void
  /** Shown when hosted channels are not available here (self-hosted, or the call failed). */
  fallback?: React.ReactNode
  /** Make the link as soon as the panel shows (the first screen). Off: the tap makes it, then opens WhatsApp. */
  autoStart?: boolean
}) {
  const managed = given !== undefined
  const [own, setOwn] = React.useState<HostedChannelsResponse | null>(null)
  const [unavailable, setUnavailable] = React.useState(false)
  const channels = managed ? given : own
  const [link, setLink] = React.useState<WhatsAppLink | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [now, setNow] = React.useState(() => Date.now())
  const minted = React.useRef(false)
  const wide = useWide()

  const publish = React.useCallback(
    (next: HostedChannelsResponse) => {
      if (managed) onChanged?.(next)
      else setOwn(next)
    },
    [managed, onChanged]
  )

  // Self-managed: load once, then poll while a code waits so the panel turns to linked by itself.
  React.useEffect(() => {
    if (managed) return
    let live = true
    api<HostedChannelsResponse>("/api/channels")
      .then((next) => live && setOwn(next))
      .catch(() => live && setUnavailable(true))
    return () => {
      live = false
    }
  }, [managed])
  const waiting = channels?.whatsapp.state === "awaiting_code"
  React.useEffect(() => {
    if (managed || !waiting) return
    const timer = window.setInterval(() => {
      void api<HostedChannelsResponse>("/api/channels")
        .then((next) => setOwn(next))
        .catch(() => undefined)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [managed, waiting])

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  const mint = React.useCallback(
    async (fresh: boolean, open = false) => {
      if (!channels) return
      setBusy(true)
      setError(null)
      try {
        const result = await api<HostedWhatsAppChallengeResponse>(
          "/api/channels/whatsapp/challenge",
          {
            method: "POST",
            body: {
              operationId: await hostedChannelOperationKey(
                "whatsapp.link",
                channels.whatsapp.revision,
                undefined,
                fresh
              ),
              link: true,
            },
          }
        )
        const next = {
          code: result.challenge.code,
          sharedNumber: result.challenge.sharedNumber,
          expiresAt: result.challenge.expiresAt,
        }
        writeStored(next)
        setLink(next)
        setNow(Date.now())
        publish(result.channels)
        // A phone goes straight to WhatsApp; a laptop shows the QR and the button.
        if (open && !wide) window.location.assign(whatsappLinkUrl(next))
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        setBusy(false)
      }
    },
    [channels, publish, wide]
  )

  const state = channels?.whatsapp.state
  const linked = state ? LINKED.has(state) : false
  const typedPending = state === "awaiting_code" && Boolean(channels?.whatsapp.senderHint)

  // Ready the link as soon as the panel shows, so the first tap opens WhatsApp. A code someone started
  // by typing their number is left alone until they ask for the link instead.
  React.useEffect(() => {
    if (!channels || linked || typedPending || minted.current) return
    const stored = usableStored(channels, Date.now())
    minted.current = true
    if (stored) setLink(stored)
    else if (autoStart) void mint(false)
  }, [channels, linked, typedPending, mint, autoStart])

  React.useEffect(() => {
    if (linked) writeStored(null)
  }, [linked])

  if (!managed && unavailable) return <>{fallback ?? null}</>
  if (!channels) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="whatsapp-one-tap">
        Getting your WhatsApp link…
      </p>
    )
  }

  if (linked) {
    return (
      <div className="flex items-start gap-2 text-sm" data-testid="whatsapp-one-tap" data-state="linked">
        <CheckIcon className="mt-0.5 size-4 text-emerald-700" aria-hidden="true" />
        <span>
          <b>WhatsApp is linked.</b> Send Zenod a voice note there and it answers “Saved”.
        </span>
      </div>
    )
  }

  // Ran out, or replaced since (a link made on another device, a typed number, a disconnect).
  const current =
    link !== null &&
    state === "awaiting_code" &&
    !channels.whatsapp.senderHint &&
    channels.whatsapp.verificationExpiresAt === link.expiresAt
  const expired = link !== null && (link.expiresAt <= now || !current)
  const url = link && !expired ? whatsappLinkUrl(link) : null

  return (
    <div className="flex flex-col gap-3" data-testid="whatsapp-one-tap" data-state={url ? "ready" : "preparing"}>
      <div className="flex flex-wrap items-center gap-4">
        {url ? (
          <Button asChild size="lg">
            <a href={url} target="_blank" rel="noopener noreferrer" data-testid="whatsapp-open-link">
              <MessageCircleIcon />
              Open WhatsApp
            </a>
          </Button>
        ) : (
          <Button
            type="button"
            size="lg"
            disabled={busy || (autoStart && !expired && !typedPending && !error)}
            onClick={() => void mint(true, true)}
          >
            {busy ? <Spinner /> : expired || error ? <RefreshCwIcon /> : <MessageCircleIcon />}
            {expired ? "Get a new link" : error ? "Try again" : busy ? "Getting your link" : "Open WhatsApp"}
          </Button>
        )}
        {url && wide ? (
          <div className="flex items-center gap-3">
            <LinkQr value={url} />
            <span className="max-w-[12rem] text-sm text-muted-foreground">
              Or point your phone’s camera here. WhatsApp opens on your phone.
            </span>
          </div>
        ) : null}
      </div>
      {url ? (
        <p className="text-sm text-muted-foreground">
          The message is already typed: just press send. Zenod links the number it comes from, so there is
          nothing to type. The link works for 30 minutes.
        </p>
      ) : null}
      {typedPending && !url ? (
        <p className="text-sm text-muted-foreground">
          You started with your number typed in. Press Open WhatsApp to use the one-tap link instead.
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
