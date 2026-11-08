import * as React from "react"

import {
  browserCallMedia,
  CallEngine,
  END_TEXT,
  fetchCallApi,
  formatCallLength,
  NOT_SWITCHED_ON,
  type CallApi,
  type CallClock,
  type CallMedia,
  type CallState,
  type CallView,
} from "@/lib/memory-call"
import { stubCallMedia } from "@/lib/memory-call-stub"

// EPIC-14 S8: the chat's call button and call screen, the "library hotline". The button sits in the
// compose bar beside the voice note microphone; while Zenod has no key of its own for calls it says
// "Calls are not switched on yet." The call screen shows who said what, the length and Hang up; after
// the call, Keep files the transcript as a memory (nothing is kept otherwise).

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M6.6 3.5h2.6l1.4 4-2 1.3a10.5 10.5 0 0 0 6.6 6.6l1.3-2 4 1.4v2.6a1.8 1.8 0 0 1-1.9 1.8A15.6 15.6 0 0 1 4.8 5.4a1.8 1.8 0 0 1 1.8-1.9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The local demo build plays a recorded session in place of OpenAI (never in production builds). */
function defaultMedia(): CallMedia {
  if (import.meta.env.VITE_ZENOD_CALL_STUB === "1") return stubCallMedia()
  return browserCallMedia()
}

const NO_WEBRTC: CallState = {
  available: false,
  message: "This browser cannot make calls. Try a current Chrome, Safari or Firefox.",
  limits: { callMaxS: 0, callWarnS: 0, quietHangupS: 0, callCapUsd: 0, monthCapUsd: 0 },
  month: { spentUsd: 0, capUsd: 0 },
  active: null,
}

export type MemoryCall = {
  engine: CallEngine
  view: CallView
  state: CallState | null
  refresh: () => void
}

export function useMemoryCall({ api = fetchCallApi, media, clock }: { api?: CallApi; media?: CallMedia; clock?: CallClock } = {}): MemoryCall {
  const engine = React.useMemo(() => new CallEngine(api, media ?? defaultMedia(), clock), [api, media, clock])
  const [view, setView] = React.useState<CallView>(() => engine.view())
  const [state, setState] = React.useState<CallState | null>(null)
  React.useEffect(() => engine.subscribe(setView), [engine])
  React.useEffect(() => () => engine.dispose(), [engine])
  // A browser without WebRTC cannot call: the button says so and Zenod is not asked.
  const supported = Boolean(media) || import.meta.env.VITE_ZENOD_CALL_STUB === "1" || typeof RTCPeerConnection === "function"
  const refresh = React.useCallback(() => {
    if (!supported) {
      setState({ ...NO_WEBRTC })
      return
    }
    api.state().then(setState, () => setState(null))
  }, [api, supported])
  React.useEffect(refresh, [refresh])
  const { phase } = view
  React.useEffect(() => {
    if (phase === "ended" || phase === "failed") refresh()
  }, [phase, refresh])
  return { engine, view, state, refresh }
}

export function CallButton({ call, disabled, onNotice }: { call: MemoryCall; disabled?: boolean; onNotice?: (text: string) => void }) {
  const { engine, view, state } = call
  const on = view.phase === "starting" || view.phase === "connecting" || view.phase === "live" || view.phase === "ending"
  const off = !state || !state.available
  const why = state?.message ?? NOT_SWITCHED_ON
  return (
    <button
      type="button"
      className="zp-mic zp-callbtn"
      aria-label={off ? `Call your memory. ${why}` : "Call your memory"}
      aria-disabled={off || undefined}
      title={off ? why : "Call your memory: ask it out loud, or give the desk a job"}
      data-testid="memory-call-button"
      disabled={disabled || on}
      onClick={() => {
        if (off) {
          onNotice?.(why)
          return
        }
        void engine.call()
      }}
    >
      <PhoneIcon />
    </button>
  )
}

export function CallPanel({ call, onKept }: { call: MemoryCall; onKept?: () => void }) {
  const { engine, view } = call
  const endRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [view.lines.length, view.speaking, view.hearing])
  const keptRef = React.useRef(onKept)
  React.useEffect(() => {
    keptRef.current = onKept
  })
  const kept = view.keep.state === "kept"
  React.useEffect(() => {
    if (kept) keptRef.current?.()
  }, [kept])
  if (view.phase === "idle") return null
  const live = view.phase === "live"
  const over = view.phase === "ended" || view.phase === "failed"
  const status =
    view.phase === "starting" || view.phase === "connecting"
      ? "Calling…"
      : live
        ? formatCallLength(view.elapsedS)
        : view.phase === "ending"
          ? "Hanging up…"
          : view.error
            ? "Call failed"
            : `Call ended · ${formatCallLength(Math.max(view.elapsedS, 0))}`
  const heard = view.lines.some((line) => line.who === "you")
  return (
    <section className="zp-call" aria-label="Call with your memory" data-testid="memory-call">
      <div className="zp-callhead">
        <span className={`zp-callmark${live ? " zp-callmark-live" : ""}`} aria-hidden="true">
          Z
        </span>
        <div className="zp-callwho">
          <strong>Your memory</strong>
          <span className="zp-calltime" role="timer" aria-live="off">
            {status}
            {view.costUsd > 0 ? ` · $${view.costUsd.toFixed(3)}` : ""}
          </span>
        </div>
        {live || view.phase === "connecting" || view.phase === "starting" ? (
          <div className="zp-callctl">
            <button type="button" className="zp-deskbtn" onClick={() => engine.toggleMute()} disabled={!live} aria-pressed={view.muted}>
              {view.muted ? "Unmute" : "Mute"}
            </button>
            <button type="button" className="zp-send zp-hangup" onClick={() => void engine.hangup("hangup")}>
              Hang up
            </button>
          </div>
        ) : null}
      </div>
      <div className="zp-calllines" aria-live="polite">
        {view.lines.map((line, i) => (
          <p key={i} className={`zp-callline zp-callline-${line.who}`}>
            {line.who === "tool" ? <em>{line.text}</em> : (
              <>
                <b>{line.who === "you" ? "You" : "Zenod"}:</b> {line.text}
              </>
            )}
          </p>
        ))}
        {view.hearing ? (
          <p className="zp-callline zp-callline-you zp-callline-now">
            <b>You:</b> {view.hearing}
          </p>
        ) : null}
        {view.speaking ? (
          <p className="zp-callline zp-callline-zenod zp-callline-now">
            <b>Zenod:</b> {view.speaking}
          </p>
        ) : null}
        <div ref={endRef} />
      </div>
      {view.warn && live ? <p className="zp-hint" role="status">{view.warn}</p> : null}
      {over ? (
        <div className="zp-callend">
          <p className="zp-hint" role="status" data-testid="memory-call-ended">
            {view.error ?? END_TEXT[view.endReason ?? ""] ?? "Call ended."}{" "}
            {view.keep.state === "kept"
              ? "The call is being kept as a memory."
              : heard
                ? "Nothing from this call is saved unless you keep it."
                : ""}
          </p>
          <div className="zp-callctl">
            {heard && view.keep.state !== "kept" ? (
              <button type="button" className="zp-send" disabled={view.keep.state === "keeping"} onClick={() => void engine.keep()}>
                {view.keep.state === "keeping" ? "Keeping…" : "Keep the call"}
              </button>
            ) : null}
            <button type="button" className="zp-deskbtn" onClick={() => engine.reset()}>
              Close
            </button>
          </div>
          {view.keep.state === "failed" ? <p className="zp-hint" role="alert">{view.keep.error}</p> : null}
        </div>
      ) : null}
    </section>
  )
}
