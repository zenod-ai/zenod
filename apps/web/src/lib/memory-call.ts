// EPIC-14 S8: the chat's call button, the "library hotline". Audio goes straight from this page to
// OpenAI's realtime voice model over WebRTC, opened with a 1-minute client key Zenod minted for this
// call (the real key stays on the server). The data channel carries the model's events: this engine
// answers its two tools through Zenod (ask the answer engine, pass a job to the memory desk),
// forwards every `usage` it reports to Zenod's cost meter, keeps the captions and the transcript, and
// hangs up on Hang up, the quiet timer, the 10-minute limit or a stop from Zenod (the caps). Nothing
// is kept unless the user presses Keep after the call. Copied and cut down from Epic Team's desk call
// (agent_team console/web/src/voice/engine.ts, E42-S5), no run-time tie.

import { MemoryChatError } from "@/lib/memory-chat"

export type CallLimits = {
  callMaxS: number
  callWarnS: number
  quietHangupS: number
  callCapUsd: number
  monthCapUsd: number
}

export type CallRecord = {
  id: string
  startedAt: string
  endedAt: string | null
  endReason: string | null
  seconds: number
  costUsd: number
  asks: number
  jobs: number
  hasTranscript: boolean
  keptJobId: string | null
}

export type CallState = {
  available: boolean
  code?: "not_switched_on" | "month_cap" | "platform_cap" | "ai_allowance_exhausted"
  message?: string
  limits: CallLimits
  month: { spentUsd: number; capUsd: number }
  active: CallRecord | null
}

export type CallStart = {
  call: CallRecord
  clientSecret: string
  expiresAt: number
  model: string
  limits: CallLimits
  greeting: string
}

export type CallStep = { call: CallRecord; monthUsd: number; stop?: string }

export type CallLine = { who: "you" | "zenod" | "tool"; text: string; at: string }

/** Zenod's call routes (fetch by default; tests fake them). */
export interface CallApi {
  state(): Promise<CallState>
  start(): Promise<CallStart>
  beat(id: string): Promise<CallStep>
  usage(id: string, ev: { eventId: string; kind: "response" | "transcription"; usage: unknown }): Promise<CallStep>
  tool(id: string, name: string, args: unknown): Promise<{ output: Record<string, unknown> }>
  end(id: string, body: { reason: string; transcript: CallLine[] }): Promise<unknown>
  keep(id: string): Promise<{ jobId: string }>
}

/** The media and WebRTC pieces (the browser's by default; tests and the local demo use a recorded session). */
export interface CallMedia {
  microphone(): Promise<MediaStream>
  peer(): RTCPeerConnection
  /** POST the SDP offer to OpenAI with the client key; the SDP answer back. */
  exchange(sdp: string, clientSecret: string, model: string): Promise<string>
  play(stream: MediaStream): void
}

export interface CallClock {
  now(): number
  every(ms: number, fn: () => void): () => void
  after(ms: number, fn: () => void): () => void
}

export type CallPhase = "idle" | "starting" | "connecting" | "live" | "ending" | "ended" | "failed"

export type CallView = {
  phase: CallPhase
  muted: boolean
  callId?: string
  /** What the caller is saying now (partial) and the voice's words so far. */
  hearing: string
  speaking: string
  lines: CallLine[]
  costUsd: number
  elapsedS: number
  /** A tool the voice is waiting on ("Looking in your memory"). */
  busy?: string
  warn?: string
  error?: string
  endReason?: string
  keep: { state: "none" | "keeping" | "kept" | "failed"; jobId?: string; error?: string }
}

export const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls"
export const BEAT_MS = 20_000
export const NOT_SWITCHED_ON = "Calls are not switched on yet."
export const QUIET_WARN_LINE = "Still there? I'll hang up in a few seconds."
const QUIET_WARN_BEFORE_S = 10

/** Why a call ended, in words for the call screen. */
export const END_TEXT: Record<string, string> = {
  hangup: "You hung up.",
  bye: "Call ended.",
  quiet: "The call ended after a minute of quiet.",
  call_limit: "Calls stop at 10 minutes.",
  call_cap: "This call reached its cost limit.",
  month_cap: "This month's calls have reached their limit.",
  platform_cap: "Calls are paused for the rest of this month.",
  ai_allowance_exhausted: "Your AI allowance for this month is used up.",
  line_dropped: "The line dropped.",
  lost: "The line dropped.",
}

const realClock: CallClock = {
  now: () => Date.now(),
  every: (ms, fn) => {
    const t = setInterval(fn, ms)
    return () => clearInterval(t)
  },
  after: (ms, fn) => {
    const t = setTimeout(fn, ms)
    return () => clearTimeout(t)
  },
}

const CALL_FRIENDLY: Record<string, string> = {
  not_switched_on: NOT_SWITCHED_ON,
  unauthorized: "Your session ended. Sign in again to call your memory.",
  one_call: "A call is already on. Hang it up first.",
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const data = (await response.json().catch(() => null)) as (T & { error?: string; code?: string; message?: string }) | null
  if (!response.ok) {
    const code = data?.code ?? data?.error
    throw new MemoryChatError(response.status, data?.message ?? (code ? CALL_FRIENDLY[code] : undefined) ?? "The call could not do that just now.", code)
  }
  return data as T
}
const post = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body ?? {}),
})

export const fetchCallApi: CallApi = {
  state: () => request("/api/console/call"),
  start: () => request("/api/console/call/start", post()),
  beat: (id) => request(`/api/console/call/${encodeURIComponent(id)}/beat`, post()),
  usage: (id, ev) => request(`/api/console/call/${encodeURIComponent(id)}/usage`, post(ev)),
  tool: (id, name, args) => request(`/api/console/call/${encodeURIComponent(id)}/tool`, post({ name, arguments: args })),
  end: (id, body) => request(`/api/console/call/${encodeURIComponent(id)}/end`, { ...post(body), keepalive: true }),
  keep: (id) => request(`/api/console/call/${encodeURIComponent(id)}/keep`, post()),
}

export function browserCallMedia(): CallMedia {
  return {
    microphone: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
    peer: () => new RTCPeerConnection(),
    exchange: async (sdp, clientSecret) => {
      const response = await fetch(OPENAI_CALLS_URL, {
        method: "POST",
        body: sdp,
        headers: { authorization: `Bearer ${clientSecret}`, "content-type": "application/sdp" },
      })
      if (!response.ok) throw new Error("The call service did not answer. Try again in a moment.")
      return response.text()
    },
    play: (stream) => {
      const audio = document.createElement("audio")
      audio.autoplay = true
      audio.srcObject = stream
      void audio.play().catch(() => undefined)
    },
  }
}

/** What the tool line says while the voice waits on it. */
export function toolLine(name: string, args: Record<string, unknown>): string {
  if (name === "ask_memory") return `Looking in your memory: “${String(args.question ?? "").slice(0, 120)}”`
  if (name === "desk_job") return `Passed to the memory desk: “${String(args.job ?? "").slice(0, 120)}”`
  return ""
}

type Event = Record<string, any>

export class CallEngine {
  private v: CallView = { phase: "idle", muted: false, hearing: "", speaking: "", lines: [], costUsd: 0, elapsedS: 0, keep: { state: "none" } }
  private listeners = new Set<(view: CallView) => void>()
  private stream?: MediaStream
  private pc?: RTCPeerConnection
  private dc?: RTCDataChannel
  private stops: (() => void)[] = []
  private quietStop?: () => void
  private warnedQuiet = false
  private warnedLimit = false
  private startedAt = 0
  private start?: CallStart
  private hangupAfterSpeech = false
  private readonly api: CallApi
  private readonly media: CallMedia
  private readonly clock: CallClock

  constructor(api: CallApi = fetchCallApi, media: CallMedia = browserCallMedia(), clock: CallClock = realClock) {
    this.api = api
    this.media = media
    this.clock = clock
  }

  view(): CallView {
    return this.v
  }

  subscribe(fn: (view: CallView) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<CallView>) {
    this.v = { ...this.v, ...patch }
    for (const fn of this.listeners) fn(this.v)
  }

  private line(who: CallLine["who"], text: string) {
    const t = text.trim()
    if (!t) return
    this.set({ lines: [...this.v.lines, { who, text: t, at: new Date(this.clock.now()).toISOString() }] })
  }

  private send(event: Event) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(event))
  }

  async call(): Promise<void> {
    if (this.v.phase === "starting" || this.v.phase === "connecting" || this.v.phase === "live") return
    this.set({ phase: "starting", error: undefined, warn: undefined, endReason: undefined, lines: [], hearing: "", speaking: "", costUsd: 0, elapsedS: 0, callId: undefined, busy: undefined, keep: { state: "none" } })
    this.warnedLimit = false
    this.hangupAfterSpeech = false
    let started: CallStart
    try {
      started = await this.api.start()
    } catch (error) {
      this.set({ phase: "failed", error: error instanceof Error ? error.message : "The call could not start." })
      return
    }
    this.start = started
    this.set({ phase: "connecting", callId: started.call.id })
    try {
      this.stream = await this.media.microphone()
    } catch {
      await this.finish("no_microphone", "Zenod needs your microphone for a call. Allow it in the browser and call again.")
      return
    }
    try {
      const pc = this.media.peer()
      this.pc = pc
      for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream)
      pc.ontrack = (e) => {
        if (e.streams[0]) this.media.play(e.streams[0])
      }
      pc.onconnectionstatechange = () => {
        if ((pc.connectionState === "failed" || pc.connectionState === "disconnected") && this.v.phase === "live") void this.hangup("line_dropped")
      }
      const dc = pc.createDataChannel("oai-events")
      this.dc = dc
      dc.onopen = () => this.opened()
      dc.onmessage = (e) => {
        try {
          void this.onEvent(JSON.parse(String(e.data)) as Event)
        } catch {
          /* not an event */
        }
      }
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const answer = await this.media.exchange(offer.sdp ?? "", started.clientSecret, started.model)
      await pc.setRemoteDescription({ type: "answer", sdp: answer })
    } catch (error) {
      await this.finish("connect_failed", error instanceof Error ? error.message : "The call could not connect.")
    }
  }

  private opened() {
    this.startedAt = this.clock.now()
    this.set({ phase: "live" })
    // The greeting, said once, in a response of its own (agent_team E42-S18).
    this.send({ type: "response.create", response: { instructions: `Say exactly this greeting and nothing else: "${this.start?.greeting ?? "Hi."}"` } })
    this.stops.push(this.clock.every(1000, () => this.tick()))
    this.stops.push(this.clock.every(BEAT_MS, () => void this.beat()))
    this.armQuiet()
  }

  private tick() {
    if (this.v.phase !== "live" || !this.start) return
    const elapsedS = Math.floor((this.clock.now() - this.startedAt) / 1000)
    const { callMaxS, callWarnS } = this.start.limits
    if (elapsedS >= callMaxS) {
      void this.hangup("call_limit")
      return
    }
    if (elapsedS >= callWarnS && !this.warnedLimit) {
      this.warnedLimit = true
      this.set({ warn: "One minute left on this call." })
    }
    this.set({ elapsedS })
  }

  private armQuiet() {
    this.quietStop?.()
    this.warnedQuiet = false
    const s = this.start?.limits.quietHangupS ?? 60
    const warnAt = Math.max(1, s - QUIET_WARN_BEFORE_S)
    const stopWarn = this.clock.after(warnAt * 1000, () => {
      if (this.v.phase !== "live" || this.v.busy) return
      this.warnedQuiet = true
      this.send({ type: "response.create", response: { instructions: `Say exactly: "${QUIET_WARN_LINE}"` } })
    })
    const stopEnd = this.clock.after(s * 1000, () => {
      if (this.v.phase === "live" && !this.v.busy) void this.hangup("quiet")
    })
    this.quietStop = () => {
      stopWarn()
      stopEnd()
    }
  }

  private async beat() {
    if (!this.v.callId || this.v.phase !== "live") return
    try {
      this.step(await this.api.beat(this.v.callId))
    } catch {
      /* the next beat tries again */
    }
  }

  private step(s: CallStep) {
    this.set({ costUsd: s.call.costUsd })
    if (s.stop && this.v.phase === "live") void this.hangup(s.stop)
  }

  private async meter(eventId: string | undefined, kind: "response" | "transcription", usage: unknown) {
    if (!this.v.callId || !eventId || !usage || typeof usage !== "object") return
    try {
      this.step(await this.api.usage(this.v.callId, { eventId, kind, usage }))
    } catch {
      /* a lost usage event is not retried: the server keeps what it got */
    }
  }

  private async onEvent(ev: Event) {
    switch (ev.type) {
      case "input_audio_buffer.speech_started":
        this.armQuiet()
        if (this.warnedQuiet) this.warnedQuiet = false
        return
      case "conversation.item.input_audio_transcription.delta":
        this.set({ hearing: this.v.hearing + String(ev.delta ?? "") })
        return
      case "conversation.item.input_audio_transcription.completed":
        this.set({ hearing: "" })
        this.line("you", String(ev.transcript ?? ""))
        this.armQuiet()
        await this.meter(ev.event_id ?? `${ev.item_id}:tr`, "transcription", ev.usage)
        return
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        this.set({ speaking: this.v.speaking + String(ev.delta ?? "") })
        return
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        this.set({ speaking: "" })
        this.line("zenod", String(ev.transcript ?? ""))
        return
      case "response.function_call_arguments.done":
        await this.onTool(String(ev.name ?? ""), String(ev.call_id ?? ""), String(ev.arguments ?? "{}"))
        return
      case "response.done":
        await this.meter(ev.response?.id ?? ev.event_id, "response", ev.response?.usage)
        if (this.hangupAfterSpeech && this.v.phase === "live") {
          this.clock.after(1200, () => void this.hangup("bye"))
          this.hangupAfterSpeech = false
        }
        return
      case "error":
        if (ev.error?.message) console.warn(`[call] ${String(ev.error.message).slice(0, 200)}`)
        return
      default:
        return
    }
  }

  private async onTool(name: string, callId: string, raw: string) {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(raw) as Record<string, unknown>
    } catch {
      /* the tool says what is missing */
    }
    if (name === "hang_up") {
      this.hangupAfterSpeech = true
      return
    }
    const id = this.v.callId
    if (!id) return
    const busy = toolLine(name, args)
    this.line("tool", busy)
    this.set({ busy })
    this.quietStop?.()
    let output: Record<string, unknown>
    try {
      output = (await this.api.tool(id, name, args)).output
    } catch (error) {
      output = { error: error instanceof Error ? error.message : "Zenod could not do that just now." }
    }
    this.set({ busy: undefined })
    this.armQuiet()
    if (this.v.phase !== "live") return
    this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } })
    this.send({ type: "response.create" })
  }

  toggleMute() {
    const muted = !this.v.muted
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = !muted
    this.set({ muted })
  }

  async hangup(reason = "hangup") {
    if (this.v.phase !== "live" && this.v.phase !== "connecting") return
    await this.finish(reason)
  }

  private async finish(reason: string, error?: string) {
    this.set({ phase: "ending", endReason: reason, busy: undefined })
    for (const stop of this.stops.splice(0)) stop()
    this.quietStop?.()
    try {
      this.dc?.close()
    } catch {
      /* closed */
    }
    try {
      this.pc?.close()
    } catch {
      /* closed */
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.dc = undefined
    this.pc = undefined
    this.stream = undefined
    const lines = this.v.speaking.trim() ? [...this.v.lines, { who: "zenod" as const, text: this.v.speaking.trim(), at: new Date(this.clock.now()).toISOString() }] : this.v.lines
    this.set({ lines, speaking: "", hearing: "" })
    if (this.v.callId) {
      try {
        const ended = (await this.api.end(this.v.callId, { reason, transcript: lines })) as CallStep | undefined
        if (ended?.call) this.set({ costUsd: ended.call.costUsd })
      } catch {
        /* the server closes a call whose page went quiet */
      }
    }
    this.set(error ? { phase: "failed", error } : { phase: "ended" })
  }

  /** Keep the call's transcript as a memory: only on the user's Keep, once. */
  async keep() {
    const id = this.v.callId
    if (!id || this.v.keep.state === "keeping" || this.v.keep.state === "kept") return
    this.set({ keep: { state: "keeping" } })
    try {
      const { jobId } = await this.api.keep(id)
      this.set({ keep: { state: "kept", jobId } })
    } catch (error) {
      this.set({ keep: { state: "failed", error: error instanceof Error ? error.message : "Zenod could not keep the call just now." } })
    }
  }

  /** Close the call screen after a call (back to the button). */
  reset() {
    if (this.v.phase === "ended" || this.v.phase === "failed") this.set({ phase: "idle", lines: [], callId: undefined, error: undefined, endReason: undefined, keep: { state: "none" }, warn: undefined })
  }

  dispose() {
    if (this.v.phase === "live" || this.v.phase === "connecting") void this.hangup("hangup")
  }
}

export function formatCallLength(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
}
