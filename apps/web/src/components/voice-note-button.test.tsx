// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { MemoryChat } from "@/components/memory-chat"
import type { MemoryKeepReceipt } from "@/lib/memory-chat"
import {
  formatLength,
  INTERRUPTED_TEXT,
  VOICE_NOTE_MAX_SECONDS,
  VoiceNoteEngine,
  type RecorderLike,
  type VoiceClock,
  type VoiceMedia,
} from "@/lib/voice-note"

// EPIC-14 E14-S1: the chat's voice note button records, shows the length and sends the audio
// into Zenod's media seam; the chat shows the same receipt as a Keep.

class FakeTrack extends EventTarget {
  readyState = "live"
  muted = false
  stop = vi.fn(() => void (this.readyState = "ended"))
}

class FakeRecorder implements RecorderLike {
  static last: FakeRecorder | undefined
  state = "inactive"
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  readonly mimeType: string
  constructor(mimeType = "audio/webm;codecs=opus") {
    this.mimeType = mimeType
    FakeRecorder.last = this
  }
  start() {
    this.state = "recording"
  }
  stop() {
    if (this.state === "inactive") return
    this.state = "inactive"
    this.ondataavailable?.({ data: new Blob(["voice-bytes"], { type: this.mimeType }) })
    queueMicrotask(() => this.onstop?.())
  }
}

function fakes(options: { mimeType?: string; deny?: boolean } = {}) {
  let now = 1_000_000
  const ticks: Array<() => void> = []
  const clock: VoiceClock = {
    now: () => now,
    every: (_ms, fn) => {
      ticks.push(fn)
      return () => void ticks.splice(ticks.indexOf(fn), 1)
    },
  }
  const track = new FakeTrack()
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream
  const media: VoiceMedia = {
    microphone: async () => {
      if (options.deny) throw Object.assign(new Error("denied"), { name: "NotAllowedError" })
      return stream
    },
    recorder: () => new FakeRecorder(options.mimeType),
  }
  const advance = (seconds: number) => {
    now += seconds * 1000
    for (const fn of [...ticks]) fn()
  }
  return { clock, media, track, advance }
}

const RECEIPT: MemoryKeepReceipt = { id: "job-1", status: "saving", reply: "Saving…", notePath: null, noteUrl: null }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("voice note recorder (E14-S1)", () => {
  it("records, counts the length and sends one audio file with its format and seconds", async () => {
    const f = fakes()
    const upload = vi.fn(async () => RECEIPT)
    const sent = vi.fn()
    const engine = Object.assign(new VoiceNoteEngine(upload, f.media, f.clock), { onSent: sent })
    await engine.start()
    expect(engine.view().phase).toBe("recording")
    f.advance(65)
    expect(engine.view().elapsedS).toBe(65)
    expect(formatLength(engine.view().elapsedS)).toBe("1:05")
    await engine.finish()
    expect(upload).toHaveBeenCalledTimes(1)
    const [audio, seconds] = upload.mock.calls[0]! as unknown as [Blob, number]
    expect(audio.type).toBe("audio/webm;codecs=opus")
    expect(seconds).toBe(65)
    expect(sent).toHaveBeenCalledWith(RECEIPT, 65)
    expect(f.track.stop).toHaveBeenCalled()
    expect(engine.view().phase).toBe("idle")
  })

  it("records AAC in mp4 where the browser only has that (iPhone Safari)", async () => {
    const f = fakes({ mimeType: "audio/mp4" })
    const upload = vi.fn(async () => RECEIPT)
    const engine = new VoiceNoteEngine(upload, f.media, f.clock)
    await engine.start()
    f.advance(3)
    await engine.finish()
    expect((upload.mock.calls[0]! as unknown as [Blob])[0].type).toBe("audio/mp4")
  })

  it("keeps what was said when the phone locks, and sends it on Send", async () => {
    const f = fakes()
    const upload = vi.fn(async () => RECEIPT)
    const engine = new VoiceNoteEngine(upload, f.media, f.clock)
    await engine.start()
    f.advance(12)
    f.track.dispatchEvent(new Event("mute"))
    expect(engine.view()).toMatchObject({ phase: "paused", elapsedS: 12, info: INTERRUPTED_TEXT })
    await engine.finish()
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it("stops and sends at the cap", async () => {
    const f = fakes()
    const upload = vi.fn(async () => RECEIPT)
    const engine = new VoiceNoteEngine(upload, f.media, f.clock)
    await engine.start()
    f.advance(VOICE_NOTE_MAX_SECONDS)
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
  })

  it("sends nothing for a tap too short to hold words, or on Discard", async () => {
    const f = fakes()
    const upload = vi.fn(async () => RECEIPT)
    const engine = new VoiceNoteEngine(upload, f.media, f.clock)
    await engine.start()
    await engine.finish()
    expect(engine.view()).toMatchObject({ phase: "idle", info: "That was too short to send." })
    await engine.start()
    f.advance(5)
    await engine.discard()
    expect(upload).not.toHaveBeenCalled()
  })

  it("says how to allow a blocked microphone", async () => {
    const f = fakes({ deny: true })
    const engine = new VoiceNoteEngine(vi.fn(), f.media, f.clock)
    await engine.start()
    expect(engine.view()).toMatchObject({ phase: "failed", error: expect.stringContaining("Allow it") })
  })

  it("keeps the recording when the upload fails, so Send tries again", async () => {
    const f = fakes()
    const upload = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(RECEIPT)
    const sent = vi.fn()
    const engine = Object.assign(new VoiceNoteEngine(upload, f.media, f.clock), { onSent: sent })
    await engine.start()
    f.advance(4)
    await engine.finish()
    expect(engine.view()).toMatchObject({ phase: "failed", retry: true, error: "Not sent: offline" })
    await engine.finish()
    expect(upload).toHaveBeenCalledTimes(2)
    expect(sent).toHaveBeenCalledTimes(1)
  })
})

describe("voice note in the chat (E14-S1)", () => {
  function stubBrowser() {
    const track = new FakeTrack()
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] }
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => stream) } })
    vi.stubGlobal(
      "MediaRecorder",
      Object.assign(
        class extends FakeRecorder {
          constructor(_stream: unknown, opts: { mimeType?: string }) {
            super(opts.mimeType)
          }
        },
        { isTypeSupported: (m: string) => m === "audio/webm;codecs=opus" }
      )
    )
  }

  it("records from the compose bar, sends the audio and shows the Keep receipt as it files", async () => {
    stubBrowser()
    const calls: Array<{ url: string; type?: string; seconds?: string }> = []
    let polls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        calls.push({ url, type: headers["content-type"], seconds: headers["x-seconds"] })
        if (url === "/api/console/voice-note") return new Response(JSON.stringify(RECEIPT), { status: 202 })
        polls++
        return new Response(
          JSON.stringify({ ...RECEIPT, status: "saved", reply: "Filed", noteUrl: "https://github.com/o/vault/blob/main/Log/2026-11-08.md" }),
          { status: 200 }
        )
      })
    )
    vi.spyOn(Date, "now").mockReturnValue(5_000_000)
    render(<MemoryChat />)
    fireEvent.click(screen.getByRole("button", { name: "Record a voice note" }))
    await screen.findByRole("group", { name: "Voice note" })
    expect(screen.getByText("0:00")).toBeTruthy()
    vi.mocked(Date.now).mockReturnValue(5_007_000)
    act(() => FakeRecorder.last!.ondataavailable?.({ data: new Blob(["a"], { type: "audio/webm;codecs=opus" }) }))
    expect(screen.getByText("0:07")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Send voice note" }))
    await screen.findByText(/Voice note · 0:07/)
    expect(calls[0]).toMatchObject({ url: "/api/console/voice-note", type: "audio/webm;codecs=opus", seconds: "7.00" })
    await waitFor(() => expect(screen.getByText(/Saved to your memory ✓/)).toBeTruthy(), { timeout: 4000 })
    expect(calls.some((call) => call.url === "/api/console/voice-note/job-1")).toBe(true)
    expect(polls).toBeGreaterThan(0)
  })

  it("shows why when the browser cannot use the microphone", async () => {
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: undefined })
    render(<MemoryChat />)
    fireEvent.click(screen.getByRole("button", { name: "Record a voice note" }))
    expect((await screen.findByRole("alert")).textContent).toContain("microphone")
  })
})
