// @vitest-environment jsdom

import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { CallButton, CallPanel, useMemoryCall } from "@/components/memory-call"
import { CallEngine, NOT_SWITCHED_ON, type CallApi, type CallState } from "@/lib/memory-call"
import { RECORDED_CALL, StubSession, stubCallMedia } from "@/lib/memory-call-stub"

// EPIC-14 S8: the call button, the library hotline. A recorded Realtime session stands in for OpenAI:
// the WebRTC offer and answer, the data channel's events, both tools, usage, hang up and Keep.

const LIMITS = { callMaxS: 600, callWarnS: 540, quietHangupS: 60, callCapUsd: 0.5, monthCapUsd: 1 }
const ON: CallState = { available: true, limits: LIMITS, month: { spentUsd: 0, capUsd: 1 }, active: null }
const OFF: CallState = { available: false, code: "not_switched_on", message: NOT_SWITCHED_ON, limits: LIMITS, month: { spentUsd: 0, capUsd: 1 }, active: null }
const record = (id: string, costUsd = 0) => ({ id, startedAt: "2026-11-08T21:00:00Z", endedAt: null, endReason: null, seconds: 0, costUsd, asks: 0, jobs: 0, hasTranscript: false, keptJobId: null })

function fakeApi(state: CallState = ON) {
  const calls = { usage: [] as { kind: string }[], tools: [] as { name: string; args: unknown }[], ended: [] as { reason: string; transcript: { who: string; text: string }[] }[], kept: 0 }
  let cost = 0
  const api: CallApi = {
    state: vi.fn(async () => state),
    start: vi.fn(async () => ({ call: record("call_1"), clientSecret: "ek_stub", expiresAt: 0, model: "gpt-realtime-2.1-mini", limits: LIMITS, greeting: "Hi, this is your Zenod library line. What would you like to know?" })),
    beat: vi.fn(async () => ({ call: record("call_1", cost), monthUsd: cost })),
    usage: vi.fn(async (_id, ev) => {
      calls.usage.push(ev)
      cost += 0.002
      return { call: record("call_1", cost), monthUsd: cost }
    }),
    tool: vi.fn(async (_id, name, args) => {
      calls.tools.push({ name, args })
      return name === "ask_memory"
        ? { output: { answered: true, answer: "Ana the plumber fixed the boiler on 6 October.", from: ["Boiler"] } }
        : { output: { started: true, title: "Cabin decision as its own topic", note: "The memory desk has it." } }
    }),
    end: vi.fn(async (_id, body) => {
      calls.ended.push(body)
      return { call: { ...record("call_1", cost), endedAt: "x" }, monthUsd: cost }
    }),
    keep: vi.fn(async () => {
      calls.kept++
      return { jobId: "job-9" }
    }),
  }
  return { api, calls }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Harness({ api, media }: { api: CallApi; media?: ReturnType<typeof stubCallMedia> }) {
  const call = useMemoryCall({ api, media })
  const [notice, setNotice] = React.useState("")
  return (
    <div>
      <CallPanel call={call} />
      <CallButton call={call} onNotice={setNotice} />
      <p data-testid="notice">{notice}</p>
    </div>
  )
}
describe("the call button without Zenod's own key", () => {
  it("says calls are not switched on yet and starts nothing", async () => {
    vi.stubGlobal("RTCPeerConnection", function RTCPeerConnection() {})
    const { api } = fakeApi(OFF)
    render(<Harness api={api} />)
    const button = await screen.findByTestId("memory-call-button")
    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"))
    expect(button.getAttribute("title")).toBe(NOT_SWITCHED_ON)
    fireEvent.click(button)
    expect(screen.getByTestId("notice").textContent).toBe(NOT_SWITCHED_ON)
    expect(api.start).not.toHaveBeenCalled()
  })
})

describe("a browser without WebRTC", () => {
  it("says it cannot call and does not ask Zenod", async () => {
    const { api } = fakeApi()
    render(<Harness api={api} />)
    const button = await screen.findByTestId("memory-call-button")
    await waitFor(() => expect(button.getAttribute("title")).toMatch(/cannot make calls/))
    expect(api.state).not.toHaveBeenCalled()
  })
})

describe("a recorded call end to end", () => {
  it("connects over WebRTC, greets, asks the answer engine, passes a job to the desk, meters usage, hangs up and keeps only on Keep", async () => {
    const { api, calls } = fakeApi()
    const session = new StubSession(RECORDED_CALL, (fn) => void setTimeout(fn, 0), 0)
    const media = stubCallMedia(session)
    render(<Harness api={api} media={media} />)
    const button = await screen.findByTestId("memory-call-button")
    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBeNull())
    fireEvent.click(button)

    await screen.findByText(/library line/, {}, { timeout: 3000 })
    await waitFor(() => expect(calls.ended).toHaveLength(1), { timeout: 5000 })

    // The microphone went to the peer, the greeting was asked for once, each tool output went back.
    const greet = session.sent.filter((e) => e.type === "response.create" && (e.response as { instructions?: string } | undefined)?.instructions)
    expect(greet).toHaveLength(1)
    expect(calls.tools.map((t) => t.name)).toEqual(["ask_memory", "desk_job"])
    expect(calls.tools[0]!.args).toEqual({ question: "What did the plumber fix at the house?" })
    expect(session.sent.filter((e) => e.type === "conversation.item.create")).toHaveLength(2)
    expect(calls.usage.filter((u) => u.kind === "transcription")).toHaveLength(3)
    expect(calls.usage.filter((u) => u.kind === "response").length).toBeGreaterThanOrEqual(5)

    // The transcript went to Zenod with the hang-up; the voice said the engine's answer.
    const ended = calls.ended[0]!
    expect(ended.reason).toBe("bye")
    expect(ended.transcript.map((l) => l.who)).toContain("tool")
    expect(ended.transcript.find((l) => l.who === "zenod" && l.text.includes("Ana the plumber"))).toBeTruthy()
    expect(await screen.findByTestId("memory-call-ended")).toBeTruthy()
    expect(screen.getByTestId("memory-call-ended").textContent).toMatch(/Nothing from this call is saved unless you keep it/)
    expect(calls.kept).toBe(0)

    fireEvent.click(screen.getByRole("button", { name: "Keep the call" }))
    await waitFor(() => expect(calls.kept).toBe(1))
    expect(await screen.findByText(/being kept as a memory/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(screen.queryByTestId("memory-call")).toBeNull()
  })

  it("hangs up when Zenod says a cap is reached", async () => {
    const { api } = fakeApi()
    api.usage = vi.fn(async () => ({ call: record("call_1", 0.5), monthUsd: 0.5, stop: "call_cap" }))
    const session = new StubSession(RECORDED_CALL, (fn) => void setTimeout(fn, 0), 0)
    const engine = new CallEngine(api, stubCallMedia(session))
    await act(async () => {
      await engine.call()
    })
    await waitFor(() => expect(engine.view().phase).toBe("ended"), { timeout: 3000 })
    expect(engine.view().endReason).toBe("call_cap")
    expect(api.tool).not.toHaveBeenCalled()
  })

  it("says why when the call cannot start", async () => {
    const { api } = fakeApi()
    api.start = vi.fn(async () => {
      throw new Error("This month's calls have reached their $1.00 limit. Calls open again next month.")
    })
    const engine = new CallEngine(api, stubCallMedia())
    await engine.call()
    expect(engine.view()).toMatchObject({ phase: "failed", error: expect.stringMatching(/\$1.00 limit/) })
  })
})
