// EPIC-14 S8: a recorded Realtime session for the call button, so the whole call (WebRTC offer and
// answer, the data channel's events, both tools, usage metering, hang up) runs without OpenAI. The
// tests use it, and so does the local demo build (VITE_ZENOD_CALL_STUB=1); a production build never
// includes it. The caller's lines and the event shapes and usage numbers follow real
// gpt-realtime-2.1-mini calls (agent_team E42); the voice's answers come from what the tools return.

import type { CallMedia } from "@/lib/memory-call"

type Event = Record<string, unknown>

export type StubTurn = {
  /** What the caller says. */
  you: string
  /** What the voice says first; then, if `tool`, it calls it and speaks from its output. */
  say?: string
  tool?: { name: "ask_memory" | "desk_job" | "hang_up"; arguments: Record<string, string> }
}

export const RECORDED_CALL: StubTurn[] = [
  { you: "What did the plumber fix at the house?", say: "Let me look.", tool: { name: "ask_memory", arguments: { question: "What did the plumber fix at the house?" } } },
  {
    you: "Can you take the cabin decision out of boat repair and make it its own topic?",
    tool: { name: "desk_job", arguments: { job: "Take the cabin decision out of Boat repair and make it its own topic" } },
  },
  { you: "That's all, thanks. Bye.", say: "Bye, talk soon.", tool: { name: "hang_up", arguments: {} } },
]

// Usage of one spoken response and one transcription, as the API reports them.
const responseUsage = (audioOut: number) => ({
  total_tokens: 1400 + audioOut,
  input_tokens: 1400,
  output_tokens: audioOut + 40,
  input_token_details: { text_tokens: 1250, audio_tokens: 150, cached_tokens: 1024, cached_tokens_details: { text_tokens: 1024, audio_tokens: 0 } },
  output_token_details: { text_tokens: 40, audio_tokens: audioOut },
})
const transcriptionUsage = (words: string) => ({ type: "tokens", input_tokens: 20 + words.length, output_tokens: Math.ceil(words.length / 4) })

/** What the voice says from a tool's output (the model would word it the same way: short, from the facts). */
function spokenFrom(name: string, output: Record<string, unknown>): string {
  if (output.error) return String(output.error)
  if (name === "ask_memory") return output.answered ? String(output.answer) : "I couldn't find a checked answer in your memory for that."
  if (name === "desk_job") return output.started ? "Sure, the memory desk has it. You'll see it in your inbox, where you can undo it." : String(output.error ?? "The desk couldn't take that just now.")
  return ""
}

class StubChannel {
  readyState: "connecting" | "open" | "closed" = "connecting"
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  private readonly session: StubSession
  constructor(session: StubSession) {
    this.session = session
  }
  send(data: string) {
    this.session.fromPage(JSON.parse(data) as Event)
  }
  close() {
    this.readyState = "closed"
    this.session.closed = true
  }
}

class StubPeer {
  connectionState = "new"
  ontrack: ((e: { streams: MediaStream[] }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  tracks: unknown[] = []
  channel?: StubChannel
  private readonly session: StubSession
  constructor(session: StubSession) {
    this.session = session
  }
  addTrack(track: unknown) {
    this.tracks.push(track)
  }
  createDataChannel() {
    this.channel = new StubChannel(this.session)
    this.session.channel = this.channel
    return this.channel
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=zenod-call-stub\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" }
  }
  async setLocalDescription() {}
  async setRemoteDescription() {
    this.connectionState = "connected"
    this.ontrack?.({ streams: [this.session.remote] })
    this.session.wait(() => {
      if (!this.channel) return
      this.channel.readyState = "open"
      this.channel.onopen?.()
    })
  }
  close() {
    this.connectionState = "closed"
    this.session.closed = true
  }
}

/** Plays the recorded turns: the caller's words, the voice's replies, the tool calls, and the usage. */
export class StubSession {
  channel?: StubChannel
  closed = false
  sent: Event[] = []
  remote: MediaStream
  private turn = -1
  private pendingTool?: { name: string; callId: string }
  private n = 0
  readonly turns: StubTurn[]
  readonly wait: (fn: () => void, ms?: number) => void
  readonly pace: number
  constructor(
    turns: StubTurn[] = RECORDED_CALL,
    wait: (fn: () => void, ms?: number) => void = (fn, ms = 0) => void setTimeout(fn, ms),
    pace = 1,
  ) {
    this.turns = turns
    this.wait = wait
    this.pace = pace
    this.remote = (typeof MediaStream === "function" ? new MediaStream() : ({ getTracks: () => [] } as unknown)) as MediaStream
  }

  private emit(ev: Event) {
    if (this.closed || !this.channel) return
    this.channel.onmessage?.({ data: JSON.stringify({ event_id: `evt_stub_${++this.n}`, ...ev }) })
  }

  private speak(text: string, then?: () => void) {
    const id = `resp_stub_${++this.n}`
    const words = text.split(" ")
    let i = 0
    const next = () => {
      if (this.closed) return
      if (i < words.length) {
        this.emit({ type: "response.output_audio_transcript.delta", response_id: id, delta: (i ? " " : "") + words[i++] })
        this.wait(next, 60 * this.pace)
        return
      }
      this.emit({ type: "response.output_audio_transcript.done", response_id: id, transcript: text })
      then?.()
      this.emit({ type: "response.done", response: { id, status: "completed", usage: responseUsage(Math.round(text.length * 1.4)) } })
    }
    next()
  }

  private callTool(tool: NonNullable<StubTurn["tool"]>) {
    const callId = `fc_stub_${++this.n}`
    if (tool.name !== "hang_up") this.pendingTool = { name: tool.name, callId }
    this.emit({ type: "response.function_call_arguments.done", call_id: callId, name: tool.name, arguments: JSON.stringify(tool.arguments) })
  }

  private nextTurn() {
    this.turn++
    const t = this.turns[this.turn]
    if (!t || this.closed) return
    this.wait(() => {
      const item = `item_stub_${++this.n}`
      this.emit({ type: "input_audio_buffer.speech_started", item_id: item })
      const words = t.you.split(" ")
      words.forEach((w, i) => this.emit({ type: "conversation.item.input_audio_transcription.delta", item_id: item, delta: (i ? " " : "") + w }))
      this.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: item, transcript: t.you, usage: transcriptionUsage(t.you) })
      this.wait(() => {
        const act = () => {
          if (t.tool) this.callTool(t.tool)
          else this.nextTurn()
        }
        if (t.say) this.speak(t.say, t.tool?.name === "hang_up" ? () => this.callTool(t.tool!) : act)
        else act()
      }, 500 * this.pace)
    }, 1400 * this.pace)
  }

  /** The page's events: the greeting, and each tool's output followed by response.create. */
  fromPage(ev: Event) {
    this.sent.push(ev)
    if (ev.type === "conversation.item.create") {
      const item = ev.item as { type?: string; call_id?: string; output?: string }
      if (item?.type === "function_call_output" && this.pendingTool?.callId === item.call_id) {
        const tool = this.pendingTool!
        this.pendingTool = undefined
        const output = JSON.parse(item.output ?? "{}") as Record<string, unknown>
        this.wait(() => this.speak(spokenFrom(tool.name, output), () => this.nextTurn()), 300 * this.pace)
      }
      return
    }
    if (ev.type === "response.create" && this.turn === -1) {
      const instructions = String((ev.response as { instructions?: string } | undefined)?.instructions ?? "")
      const greeting = /"([^"]+)"/.exec(instructions)?.[1] ?? "Hi."
      this.wait(() => this.speak(greeting, () => this.nextTurn()), 300 * this.pace)
    }
  }
}

/** The call's media with a recorded session in place of OpenAI and the microphone. */
export function stubCallMedia(session: StubSession = new StubSession()): CallMedia & { session: StubSession } {
  const track = { kind: "audio", enabled: true, stop() {} }
  return {
    session,
    microphone: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream,
    peer: () => new StubPeer(session) as unknown as RTCPeerConnection,
    exchange: async (sdp) => `v=0\r\ns=answer to ${sdp.length} bytes\r\n`,
    play: () => undefined,
  }
}
