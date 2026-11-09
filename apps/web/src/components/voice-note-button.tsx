import * as React from "react"

import type { MemoryKeepReceipt } from "@/lib/memory-chat"
import {
  browserVoiceMedia,
  formatLength,
  sendVoiceNote,
  VOICE_NOTE_MAX_SECONDS,
  VoiceNoteEngine,
  type VoiceMedia,
  type VoiceUpload,
  type VoiceView,
} from "@/lib/voice-note"

// EPIC-14 E14-S1: the chat's voice note button. Idle it is a microphone in the compose bar; while
// recording the bar shows the length, a level line, Discard and Send. Sent notes appear in the chat
// with the same receipt as a Keep (see memory-chat.tsx).

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function VoiceNoteButton<R = MemoryKeepReceipt>({
  onSent,
  onNotice,
  disabled,
  upload = sendVoiceNote as unknown as VoiceUpload<R>,
  media,
  label = "Record a voice note",
}: {
  onSent: (receipt: R, seconds: number) => void
  /** A note that did not start or was too short: the chat shows why. */
  onNotice?: (text: string, warn: boolean) => void
  disabled?: boolean
  upload?: VoiceUpload<R>
  media?: VoiceMedia
  /** The microphone's name (S26: "Leave a voice note" on an inbox card). */
  label?: string
}) {
  const engine = React.useMemo(
    () => new VoiceNoteEngine<R>(upload, media ?? browserVoiceMedia()),
    [upload, media]
  )
  const [view, setView] = React.useState<VoiceView<R>>(() => engine.view())
  React.useEffect(() => engine.subscribe(setView), [engine])
  React.useEffect(() => () => void engine.discard(), [engine])
  const sentRef = React.useRef(onSent)
  const noticeRef = React.useRef(onNotice)
  React.useEffect(() => {
    sentRef.current = onSent
    noticeRef.current = onNotice
  })
  const { sent } = view
  React.useEffect(() => {
    if (sent) sentRef.current(sent.receipt, sent.seconds)
  }, [sent])

  const { phase } = view
  const idleNotice = phase === "idle" || (phase === "failed" && !view.retry) ? (view.error ?? view.info) : undefined
  React.useEffect(() => {
    if (idleNotice) noticeRef.current?.(idleNotice, phase === "failed")
  }, [idleNotice, phase])
  if (phase === "idle" || phase === "starting" || (phase === "failed" && !view.retry)) {
    return (
      <button
        type="button"
        className="zp-mic"
        aria-label={label}
        title={label}
        disabled={disabled || phase === "starting"}
        onClick={() => void engine.start()}
      >
        <MicIcon />
      </button>
    )
  }

  const left = VOICE_NOTE_MAX_SECONDS - view.elapsedS
  return (
    <div className="zp-recording" role="group" aria-label="Voice note">
      <span className={phase === "recording" ? "zp-recdot" : "zp-recdot zp-recdot-off"} aria-hidden="true" />
      <span className="zp-reclen" aria-live="off">
        {formatLength(view.elapsedS)}
      </span>
      <span className="zp-reclevel" aria-hidden="true">
        <i style={{ transform: `scaleX(${phase === "recording" ? Math.max(0.04, view.level) : 0})` }} />
      </span>
      <span className="zp-recstate">
        {phase === "recording"
          ? left <= 30
            ? `${left} s left`
            : "Recording"
          : phase === "sending"
            ? "Sending…"
            : phase === "paused"
              ? "Paused"
              : "Not sent"}
      </span>
      <button
        type="button"
        className="zp-recdiscard"
        aria-label="Discard voice note"
        disabled={phase === "sending"}
        onClick={() => void engine.discard()}
      >
        Discard
      </button>
      <button
        type="button"
        className="zp-send"
        aria-label="Send voice note"
        disabled={phase === "sending"}
        onClick={() => void engine.finish()}
      >
        {phase === "failed" ? "Send again" : "Send"}
      </button>
      {view.error || view.info ? (
        <p className={view.error ? "zp-voicemsg zp-warn" : "zp-voicemsg"} role={view.error ? "alert" : "status"}>
          {view.error ?? view.info}
        </p>
      ) : null}
    </div>
  )
}
