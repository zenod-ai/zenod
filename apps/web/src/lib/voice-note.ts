// EPIC-14 E14-S1: the chat's voice note recorder. Tap the microphone to start, tap Send to stop and
// send; the audio goes into Zenod's media seam like a WhatsApp voice note (transcription, Log entry,
// filing) and the chat shows the usual receipt. Adapted from Epic Team's voice note recorder
// (agent_team console/web/src/voice/noteEngine.ts @ 546b15bb, copied, no run-time tie): the same
// formats, microphone handling, level meter and locked-phone pause, as one recording per note
// because Zenod's media seam takes one file.

import { MemoryChatError, type MemoryKeepReceipt } from "@/lib/memory-chat"

/** The app stops and sends a note at this length (the server's cap is the same). */
export const VOICE_NOTE_MAX_SECONDS = 10 * 60
/** A note shorter than this has no words in it: it is not sent. */
export const VOICE_NOTE_MIN_SECONDS = 1

export type VoicePhase = "idle" | "starting" | "recording" | "paused" | "sending" | "failed"

export type VoiceView<R = MemoryKeepReceipt> = {
  phase: VoicePhase
  /** Seconds recorded (paused time not counted). */
  elapsedS: number
  /** Input level 0..1 for the meter. */
  level: number
  error?: string
  info?: string
  /** A failed send still holds the recording: Send tries again. */
  retry?: boolean
  /** The last note sent, with its receipt (a new object per note). */
  sent?: { receipt: R; seconds: number }
}

/** The part of MediaRecorder this engine uses. */
export interface RecorderLike {
  readonly mimeType: string
  readonly state?: string
  start(timesliceMs?: number): void
  stop(): void
  ondataavailable: ((e: { data: Blob }) => void) | null
  onstop: (() => void) | null
}

export interface VoiceMedia {
  microphone(): Promise<MediaStream>
  recorder(stream: MediaStream): RecorderLike
  level?(stream: MediaStream): { read(): number; close(): void } | undefined
  wakeLock?(): Promise<{ release(): Promise<void> } | undefined>
}

export interface VoiceClock {
  now(): number
  every(ms: number, fn: () => void): () => void
}

/** Where a note goes: the chat's media seam (a Keep receipt), or elsewhere (S26: feedback on an inbox card). */
export type VoiceUpload<R = MemoryKeepReceipt> = (audio: Blob, seconds: number) => Promise<R>

export const INTERRUPTED_TEXT =
  "Recording stopped: the screen locked or another app took the microphone. What you said is kept. Tap Send, or Discard."

const realClock: VoiceClock = {
  now: () => Date.now(),
  every: (ms, fn) => {
    const timer = setInterval(fn, ms)
    return () => clearInterval(timer)
  },
}

export class VoiceNoteEngine<R = MemoryKeepReceipt> {
  private v: VoiceView<R> = { phase: "idle", elapsedS: 0, level: 0 }
  private subs = new Set<(v: VoiceView<R>) => void>()
  private stream?: MediaStream
  private rec?: RecorderLike
  private chunks: Blob[] = []
  private mimeType = ""
  private recStart = 0
  /** Seconds recorded before a pause. */
  private closedS = 0
  private stopped: Promise<void> = Promise.resolve()
  private stopTick?: () => void
  private meter?: { read(): number; close(): void }
  private lock?: { release(): Promise<void> }

  private upload: VoiceUpload<R>
  private media: VoiceMedia
  private clock: VoiceClock
  /** Called with the receipt of each note sent. */
  onSent?: (receipt: R, seconds: number) => void

  constructor(upload: VoiceUpload<R>, media: VoiceMedia, clock: VoiceClock = realClock) {
    this.upload = upload
    this.media = media
    this.clock = clock
  }

  view = () => this.v
  subscribe(fn: (v: VoiceView<R>) => void) {
    this.subs.add(fn)
    return () => void this.subs.delete(fn)
  }
  private set(change: Partial<VoiceView<R>>) {
    this.v = { ...this.v, ...change }
    for (const fn of this.subs) fn(this.v)
  }

  /** Tap 1: open the microphone and record. */
  async start() {
    if (this.v.phase !== "idle" && this.v.phase !== "failed") return
    this.reset()
    this.set({ phase: "starting", error: undefined, info: undefined })
    try {
      this.stream = await this.media.microphone()
    } catch (error) {
      return this.set({ phase: "failed", error: micError(error) })
    }
    // iOS mutes the microphone when the phone locks; `ended` when another app takes it.
    for (const track of this.stream.getAudioTracks())
      for (const event of ["ended", "mute"]) track.addEventListener?.(event, () => this.interrupted())
    this.meter = this.media.level?.(this.stream) ?? undefined
    this.lock = (await this.media.wakeLock?.().catch(() => undefined)) ?? undefined
    let rec: RecorderLike
    try {
      rec = this.media.recorder(this.stream)
    } catch (error) {
      this.releaseMic()
      return this.set({ phase: "failed", error: (error as Error)?.message || "This browser cannot record audio." })
    }
    let done!: () => void
    this.stopped = new Promise<void>((resolve) => (done = resolve))
    rec.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data)
      // The recorder's own one-second events keep the clock going where a background tab slows timers.
      if (rec === this.rec) this.tick()
    }
    rec.onstop = () => done()
    this.rec = rec
    this.mimeType = rec.mimeType
    this.recStart = this.clock.now()
    this.set({ phase: "recording" })
    this.stopTick = this.clock.every(250, () => this.tick())
    rec.start(1000)
  }

  private seconds() {
    return this.closedS + (this.rec ? (this.clock.now() - this.recStart) / 1000 : 0)
  }

  private tick() {
    if (this.v.phase !== "recording") return
    const change: Partial<VoiceView<R>> = { elapsedS: Math.floor(this.seconds()) }
    if (this.meter) change.level = Math.max(0, Math.min(1, this.meter.read()))
    this.set(change)
    if (this.seconds() >= VOICE_NOTE_MAX_SECONDS) {
      this.set({ info: `Stopped at ${VOICE_NOTE_MAX_SECONDS / 60} minutes and sent.` })
      void this.finish()
    }
  }

  /** Stop the recorder; resolves once its last audio is in. */
  private async closeRecorder() {
    const rec = this.rec
    if (!rec) return
    this.closedS = this.seconds()
    this.rec = undefined
    try {
      rec.stop()
    } catch {
      /* already stopped */
    }
    await this.stopped
  }

  /** The microphone stopped under the note (phone locked, mic taken): keep what is recorded. */
  interrupted() {
    if (this.v.phase !== "recording") return
    void this.closeRecorder()
    this.releaseMic()
    this.set({ phase: "paused", level: 0, elapsedS: Math.floor(this.closedS), info: INTERRUPTED_TEXT })
  }

  /** Tap 2: stop and send. Also "Send again" after a failed upload. */
  async finish() {
    if (!(["recording", "paused", "failed"] as VoicePhase[]).includes(this.v.phase)) return
    if (this.v.phase === "failed" && this.chunks.length === 0) return
    await this.closeRecorder()
    this.releaseMic()
    const seconds = this.closedS
    if (seconds < VOICE_NOTE_MIN_SECONDS || this.chunks.length === 0) {
      this.reset()
      return this.set({ phase: "idle", info: "That was too short to send." })
    }
    const audio = new Blob(this.chunks, { type: this.mimeType || this.chunks[0]?.type || "audio/webm" })
    this.set({ phase: "sending", level: 0, elapsedS: Math.floor(seconds), error: undefined, retry: false })
    try {
      const receipt = await this.upload(audio, seconds)
      this.reset()
      this.set({ phase: "idle", info: undefined, sent: { receipt, seconds } })
      this.onSent?.(receipt, seconds)
    } catch (error) {
      this.set({
        phase: "failed",
        error: `Not sent: ${error instanceof Error ? error.message : "try again"}`,
        retry: true,
      })
    }
  }

  /** Throw the note away: nothing is sent. */
  async discard() {
    await this.closeRecorder()
    this.releaseMic()
    this.reset()
    this.set({ phase: "idle", info: undefined, error: undefined })
  }

  private releaseMic() {
    this.stopTick?.()
    this.stopTick = undefined
    this.meter?.close()
    this.meter = undefined
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = undefined
    void this.lock?.release().catch(() => undefined)
    this.lock = undefined
  }

  private reset() {
    this.chunks = []
    this.closedS = 0
    this.rec = undefined
    this.v = { phase: "idle", elapsedS: 0, level: 0 }
  }
}

export function micError(error: unknown): string {
  const name = (error as { name?: string })?.name
  if (name === "NotAllowedError")
    return "The microphone is blocked for this page. Allow it in the browser's site settings, then tap again."
  if (name === "NotFoundError") return "No microphone found."
  return (error as Error)?.message || "The microphone did not open."
}

/** m:ss for the recording length. */
export function formatLength(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

async function receiptRequest(path: string, init?: RequestInit): Promise<MemoryKeepReceipt> {
  const response = await fetch(path, init)
  const data = (await response.json().catch(() => null)) as
    | (MemoryKeepReceipt & { error?: string; code?: string; message?: string })
    | null
  if (!response.ok) {
    const code = data?.code ?? data?.error
    throw new MemoryChatError(
      response.status,
      data?.message ??
        (response.status === 401 ? "Your session ended. Sign in again." : "Zenod could not take that voice note just now."),
      code
    )
  }
  return data as MemoryKeepReceipt
}

/** Send one recorded note: the body is the audio itself. */
export function sendVoiceNote(audio: Blob, seconds: number): Promise<MemoryKeepReceipt> {
  return receiptRequest("/api/console/voice-note", {
    method: "POST",
    headers: { "content-type": audio.type || "audio/webm", "x-seconds": seconds.toFixed(2) },
    body: audio,
  })
}

export function voiceNoteStatus(id: string): Promise<MemoryKeepReceipt> {
  return receiptRequest(`/api/console/voice-note/${encodeURIComponent(id)}`)
}

/** The recording formats, best first: opus in webm (Chrome, Firefox, Android), AAC in mp4 (Safari, iPhone). */
const MIMES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"]

export function browserVoiceMedia(): VoiceMedia {
  return {
    microphone: () => {
      if (!navigator.mediaDevices?.getUserMedia)
        return Promise.reject(new Error("This browser does not let this page use the microphone (it needs https)."))
      return navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    },
    recorder: (stream) => {
      if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot record audio.")
      const mimeType = MIMES.find((m) => MediaRecorder.isTypeSupported?.(m))
      // 32 kbit/s mono speech: about 2.4 MB for ten minutes.
      return new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32_000,
      }) as unknown as RecorderLike
    },
    level: (stream) => {
      const AC =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return undefined
      const ctx = new AC()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)
      return {
        read: () => {
          analyser.getByteTimeDomainData(buf)
          let sum = 0
          for (const b of buf) sum += ((b - 128) / 128) ** 2
          return Math.min(1, Math.sqrt(sum / buf.length) * 4)
        },
        close: () => void ctx.close().catch(() => undefined),
      }
    },
    // Keeps the phone from locking by itself while recording, where the browser allows it.
    wakeLock: async () => {
      const wakeLock = (navigator as Navigator & {
        wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> }
      }).wakeLock
      return wakeLock ? await wakeLock.request("screen") : undefined
    },
  }
}
