import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { subscribersCall } from "@/lib/subscribers"

// agent_team E42-S22: Subscribers (push). Connect / MCP is pull (your agent
// calls Zenod); this tab lists the apps Zenod calls when a new voice note
// lands: agent teams connected with Sign in with Zenod and webhooks added by
// hand. API: GET/POST /api/subscribers, PATCH/DELETE /api/subscribers/:id,
// POST /api/subscribers/:id/test.

export type SubscriberDelivery = {
  id: string
  event_id: string
  type: string
  test: boolean
  at: string
  ok: boolean
  status: "delivering" | "retrying" | "delivered" | "failed"
  http_status: number | null
  duration_ms: number | null
  attempts: number
  error: string | null
}

export type Subscriber = {
  id: string
  name: string
  kind: "agent_team" | "webhook"
  product: string | null
  url: string
  event: string
  enabled: boolean
  created_at: string
  created_by: { name: string | null; email: string | null }
  via: "oauth" | "manual"
  last_delivery: Omit<SubscriberDelivery, "id" | "event_id" | "type" | "status"> | null
  retries_24h: number
  deliveries: SubscriberDelivery[]
}

// EPIC-21 V1: apps allowed to forward their own voice notes into Zenod.
export type Forwarder = {
  grant_id: string
  name: string
  scope: string
  account: { name: string | null; email: string | null }
  created_at: string
}

type CreatedWebhook = {
  subscription: Subscriber
  signing_secret: string
  test_delivery: SubscriberDelivery
}

function seconds(ms: number | null): string {
  return ms === null ? "" : `${(ms / 1000).toFixed(1)} s`
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

function day(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

function when(iso: string, now = Date.now()): string {
  const at = new Date(iso).getTime()
  if (now - at < 60_000) return "just now"
  const today = new Date(now).toDateString() === new Date(at).toDateString()
  return today ? `today ${clock(iso)}` : `${day(iso)} ${clock(iso)}`
}

function result(d: { ok: boolean; http_status: number | null; error: string | null }): string {
  if (d.http_status !== null) return d.ok ? `${d.http_status} OK` : `failed, ${d.http_status}`
  return `failed, ${d.error ?? "no answer"}`
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function Toggle({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean
  label: string
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="inline-flex items-center gap-2 text-sm disabled:opacity-60"
    >
      <span
        className={`relative inline-flex h-5 w-8 shrink-0 items-center rounded-full border transition-colors ${on ? "border-primary bg-primary" : "border-input bg-muted"}`}
      >
        <span
          className={`absolute size-3.5 rounded-full bg-background ring-1 ring-border transition-transform ${on ? "translate-x-3.5" : "translate-x-0.5"}`}
        />
      </span>
      {on ? "On" : "Off"}
    </button>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function SubscriberRow({
  sub,
  onChanged,
  onRemoved,
}: {
  sub: Subscriber
  onChanged: (sub: Subscriber) => void
  onRemoved: (id: string) => void
}) {
  const [busy, setBusy] = React.useState<"toggle" | "test" | "remove" | null>(null)
  const [confirming, setConfirming] = React.useState(false)
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null)
  const last = sub.last_delivery
  const team = sub.kind === "agent_team"

  async function toggle(next: boolean) {
    setBusy("toggle")
    setNotice(null)
    try {
      const body = await subscribersCall<{ subscription: Subscriber }>(`/api/subscribers/${sub.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: next }),
      })
      onChanged({ ...sub, ...body.subscription, deliveries: sub.deliveries })
    } catch (error) {
      setNotice({ ok: false, text: (error as Error).message })
    } finally {
      setBusy(null)
    }
  }

  async function test() {
    setBusy("test")
    setNotice(null)
    try {
      const body = await subscribersCall<{ delivery: SubscriberDelivery; subscription: Subscriber }>(
        `/api/subscribers/${sub.id}/test`,
        { method: "POST" }
      )
      const d = body.delivery
      setNotice({
        ok: d.ok,
        text: d.ok
          ? `Delivered to ${sub.name}: ${result(d)} in ${seconds(d.duration_ms)}`
          : `Not delivered to ${sub.name}: ${result(d)}`,
      })
      onChanged({ ...sub, ...body.subscription, deliveries: [d, ...sub.deliveries] })
    } catch (error) {
      setNotice({ ok: false, text: (error as Error).message })
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy("remove")
    try {
      await subscribersCall(`/api/subscribers/${sub.id}`, { method: "DELETE" })
      onRemoved(sub.id)
    } catch (error) {
      setNotice({ ok: false, text: (error as Error).message })
      setBusy(null)
    }
  }

  const meta = team
    ? `${hostOf(sub.url)} · connected by ${sub.created_by.name ?? sub.created_by.email ?? "you"} with Sign in with Zenod, ${day(sub.created_at)} · reads new voice notes only`
    : `${sub.url} · added ${day(sub.created_at)}${sub.created_by.name ? ` by ${sub.created_by.name}` : ""}`

  return (
    <li className="flex flex-col gap-3 border-t py-5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{sub.name}</h3>
            <Badge variant="secondary" className="font-normal">
              {team ? `agent team${sub.product ? ` · ${sub.product}` : ""}` : "webhook"}
            </Badge>
          </div>
          <p className="break-words text-sm text-muted-foreground">{meta}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={busy !== null} onClick={test}>
            {busy === "test" ? <Spinner /> : null}
            Send test
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={busy !== null}
            onClick={() => setConfirming(true)}
          >
            Remove
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Fact label="Event">Voice note captured</Fact>
        <Fact label="Status">
          <Toggle
            on={sub.enabled}
            label={`${sub.name} on or off`}
            disabled={busy !== null}
            onChange={toggle}
          />
        </Fact>
        <Fact label="Last delivery">
          {last ? (
            <span>
              {when(last.at)}
              {last.test ? " · test" : ""} ·{" "}
              <span className={last.ok ? "text-[var(--zn-link)]" : "text-destructive"}>
                {result(last)}
              </span>
              {last.duration_ms !== null ? ` · ${seconds(last.duration_ms)}` : ""}
            </span>
          ) : (
            <span className="text-muted-foreground">none yet</span>
          )}
        </Fact>
        <Fact label="Retries, last 24 h">{sub.retries_24h}</Fact>
      </div>
      {sub.deliveries.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer select-none">
            Delivery log, last 7 days ({sub.deliveries.length})
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full max-w-2xl text-left text-sm">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-4 font-normal">Time</th>
                  <th className="py-2 pr-4 font-normal">Event</th>
                  <th className="py-2 pr-4 font-normal">Result</th>
                  <th className="py-2 pr-4 text-right font-normal">Took</th>
                  <th className="py-2 text-right font-normal">Tries</th>
                </tr>
              </thead>
              <tbody>
                {sub.deliveries.map((d) => (
                  <tr key={d.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-4 tabular-nums">
                      {day(d.at) === day(new Date().toISOString()) ? clock(d.at) : `${day(d.at)} ${clock(d.at)}`}
                    </td>
                    <td className="py-2 pr-4">{d.test ? "test" : "voice note"}</td>
                    <td className="py-2 pr-4">
                      {d.status === "retrying" ? "retrying" : result(d)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{seconds(d.duration_ms)}</td>
                    <td className="py-2 text-right tabular-nums">{d.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
      {notice ? (
        <p
          role="status"
          className={`text-sm ${notice.ok ? "text-[var(--zn-link)]" : "text-destructive"}`}
        >
          {notice.text}
        </p>
      ) : null}
      {confirming ? (
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
          <span>
            Remove {sub.name}? It stops getting voice notes
            {team ? " and loses its read access" : ""}.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={busy !== null}
            onClick={remove}
          >
            {busy === "remove" ? <Spinner /> : null}
            Remove {sub.name}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </div>
      ) : null}
    </li>
  )
}

const SAMPLE_EVENT = `POST https://hooks.example.com/zenod
X-Zenod-Signature: t=1793635200,v1=5f2c…   (HMAC-SHA256 of "t.body" with your secret)

{ "id": "evt_8Kq2…", "type": "voice_note.captured", "test": false,
  "created_at": "2026-11-02T16:10:05Z", "subscription_id": "sub_…",
  "note": { "id": "Log/2026-11-02.md#^e-41c9…", "source": "whatsapp",
            "content_type": "voice_note", "captured_at": "2026-11-02T16:10:04Z",
            "url": "https://cloud.zenod.dev/api/subscribers/v1/notes?id=…" } }`

function AddWebhook({ onCreated }: { onCreated: (sub: Subscriber) => void }) {
  const [url, setUrl] = React.useState("")
  const [name, setName] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [created, setCreated] = React.useState<CreatedWebhook | null>(null)
  const [copied, setCopied] = React.useState(false)

  async function create(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = await subscribersCall<CreatedWebhook>("/api/subscribers", {
        method: "POST",
        body: JSON.stringify({ url: url.trim(), event: "voice_note.captured", name: name.trim() || undefined }),
      })
      setCreated(body)
      setCopied(false)
      onCreated({ ...body.subscription, deliveries: [body.test_delivery] })
      setUrl("")
      setName("")
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!created) return
    await navigator.clipboard?.writeText(created.signing_secret).catch(() => undefined)
    setCopied(true)
  }

  const test = created?.test_delivery
  return (
    <Card className="rounded-lg">
      <CardContent className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Add a webhook by hand</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            For developers: send Zenod's events to your own server. An agent team
            on EpicSpine connects itself from its Connections page, so it never
            needs this form.
          </p>
        </div>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={create} noValidate>
          <label className="flex flex-col gap-2 text-sm font-medium sm:col-span-2">
            Endpoint URL
            <Input
              type="url"
              required
              placeholder="https://hooks.example.com/zenod"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-describedby="webhook-limits"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Event
            <select
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm font-normal"
              value="voice_note.captured"
              onChange={() => undefined}
            >
              <option value="voice_note.captured">Voice note captured</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Name
            <Input
              placeholder="My n8n flow"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={busy || !url.trim()}>
              {busy ? <Spinner /> : null}
              Create webhook
            </Button>
            <span id="webhook-limits" className="text-sm text-muted-foreground">
              Public HTTPS address only. Zenod sends a test event as soon as it is created.
            </span>
          </div>
        </form>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {created ? (
          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <p className="text-sm">Your signing secret. Zenod shows it only this once.</p>
            <code className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
              {created.signing_secret}
            </code>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
                I have saved it
              </Button>
              <span className="text-sm text-muted-foreground">
                Lost it? Remove the webhook and add it again for a new secret.
              </span>
            </div>
            {test ? (
              <p
                role="status"
                className={`text-sm ${test.ok ? "text-[var(--zn-link)]" : "text-destructive"}`}
              >
                {test.ok
                  ? `Test event sent: ${created.subscription.url} answered ${result(test)} in ${seconds(test.duration_ms)}.`
                  : `Test event sent: ${created.subscription.url} did not accept it (${result(test)}). The webhook is saved; fix your server and press Send test.`}
              </p>
            ) : null}
          </div>
        ) : null}
        <details className="text-sm">
          <summary className="cursor-pointer select-none font-medium">What Zenod sends</summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
            {SAMPLE_EVENT}
          </pre>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            A pointer only: fetch the note with your own Zenod access
            (get_memory with note.id). Check the signature and refuse anything
            older than 5 minutes. Answer with a 2xx within 5 s; otherwise Zenod
            retries after 2 s and 10 s and logs each try.
          </p>
        </details>
      </CardContent>
    </Card>
  )
}

function Forwarders({ list, onRemoved }: { list: Forwarder[]; onRemoved: (id: string) => void }) {
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function remove(id: string) {
    setBusy(id)
    setError(null)
    try {
      await subscribersCall(`/api/subscribers/forwarders/${id}`, { method: "DELETE" })
      onRemoved(id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="rounded-lg">
      <CardContent className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Apps that forward voice notes</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Voice notes you record in these apps land in your Zenod, tagged with
            the app. They can add notes only; they cannot read or change your
            memory. Remove one to cut it off.
          </p>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <ul className="flex flex-col border-t pt-5">
          {list.map((app) => (
            <li
              key={app.grant_id}
              className="flex flex-wrap items-center justify-between gap-3 border-t py-4 first:border-t-0 first:pt-0"
            >
              <div className="min-w-0">
                <h3 className="font-semibold">{app.name}</h3>
                <p className="text-sm text-muted-foreground">
                  connected by {app.account.name ?? app.account.email ?? "you"} with Sign in with Zenod, {day(app.created_at)}
                </p>
              </div>
              <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => remove(app.grant_id)}>
                {busy === app.grant_id ? <Spinner /> : null}
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export function SubscribersPanel() {
  const [subs, setSubs] = React.useState<Subscriber[] | null>(null)
  const [forwarders, setForwarders] = React.useState<Forwarder[]>([])
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    subscribersCall<{ subscribers: Subscriber[]; forwarders?: Forwarder[] }>("/api/subscribers")
      .then((body) => {
        setSubs(body.subscribers)
        setForwarders(body.forwarders ?? [])
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  const replace = (next: Subscriber) =>
    setSubs((list) => (list ?? []).map((s) => (s.id === next.id ? next : s)))
  const remove = (id: string) => setSubs((list) => (list ?? []).filter((s) => s.id !== id))
  const add = (sub: Subscriber) => setSubs((list) => [...(list ?? []), sub])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3 border-l-4 border-primary bg-muted/60 px-4 py-3 text-sm">
        <b className="shrink-0">Push.</b>
        <span>
          Zenod calls these apps the moment a new voice note lands; they do not
          have to ask. This is the only place connected teams and webhooks appear.
        </span>
      </div>
      <Card className="rounded-lg">
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Subscribers</h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Apps Zenod tells when a new voice note lands. Zenod sends a signed
                pointer, never the words, and each app reads only that note with
                the access you gave it. Turn one off to pause it; remove it to cut
                it off.
              </p>
            </div>
            {subs ? (
              <span className="text-sm whitespace-nowrap">
                {subs.length} {subs.length === 1 ? "subscriber" : "subscribers"}
              </span>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : subs === null ? (
            <Skeleton className="h-24 w-full" />
          ) : subs.length === 0 ? (
            <p className="border-t pt-4 text-sm text-muted-foreground">
              Nothing is subscribed yet. An agent team appears here when you
              press Connect Zenod on its Connections page and allow it; a
              webhook appears when you add one below.
            </p>
          ) : (
            <ul className="flex flex-col border-t pt-5">
              {subs.map((sub) => (
                <SubscriberRow key={sub.id} sub={sub} onChanged={replace} onRemoved={remove} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {forwarders.length > 0 ? (
        <Forwarders
          list={forwarders}
          onRemoved={(id) => setForwarders((list) => list.filter((f) => f.grant_id !== id))}
        />
      ) : null}
      <AddWebhook onCreated={add} />
    </div>
  )
}
