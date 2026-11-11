import * as React from "react"

import "@/components/quick-start.css"
import {
  refreshQuickStart,
  setQuickStartHidden,
  useQuickStart,
  type QuickStart,
  type QuickStartStepId,
} from "@/lib/quick-start"
import { readPersonas, setPersonaEnabled, type Persona } from "@/lib/personas"
import type { DashboardPlace } from "@/views/dashboard-navigation"

// EPIC-26 S15 (Jordi's E26-A8, "build as shown", mockup E26-S12): one card every new tester sees above
// Chat, five steps that tick off by themselves from what Zenod stores, and a score. Hidden at the end or
// on "Hide quick start"; Settings › Account brings it back.

type Go = (place: DashboardPlace) => void

const WORD = ["Let’s start", "Good start", "Nice, keep going", "Over halfway", "One to go", "All set"]

function scoreWord(score: number, total: number): string {
  if (score >= total) return WORD[5]!
  if (total - score === 1) return WORD[4]!
  return WORD[Math.min(score, 3)]!
}

function mcpAddress(): string {
  return `${window.location.origin}/mcp`
}

export function QuickStartPill({ onOpen }: { onOpen?: () => void }) {
  const quick = useQuickStart()
  if (!quick || quick.hidden || quick.complete) return null
  const counted = quick.steps.filter((step) => quick.helpersOpen || step.id !== "helper")
  return (
    <button type="button" className="qs-pill" data-testid="quick-start-pill" title="Quick start score" onClick={onOpen}>
      <span className="qs-dots" aria-hidden="true">
        {counted.map((step) => (
          <i key={step.id} className={step.done ? "on" : ""} />
        ))}
      </span>
      Quick start {quick.score} of {quick.total}
    </button>
  )
}

function Ring({ score, total }: { score: number; total: number }) {
  const length = 226.2
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
      <circle cx="42" cy="42" r="36" fill="none" className="qs-ring-track" strokeWidth="6" />
      <circle
        cx="42"
        cy="42"
        r="36"
        fill="none"
        className="qs-ring"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - score / total)}
        transform="rotate(-90 42 42)"
      />
    </svg>
  )
}

function HelperSwitches() {
  const [helpers, setHelpers] = React.useState<Persona[] | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    let live = true
    readPersonas()
      .then((list) => live && setHelpers(list.personas))
      .catch(() => live && setHelpers([]))
    return () => {
      live = false
    }
  }, [])
  if (!helpers) return <p className="qs-muted">Loading helpers…</p>
  if (helpers.length === 0) return <p className="qs-muted">Open the Helpers tab to switch one on.</p>
  const flip = async (helper: Persona) => {
    setBusy(helper.id)
    setError(null)
    try {
      const list = await setPersonaEnabled(helper.id, !helper.enabled)
      setHelpers(list.personas)
      await refreshQuickStart()
    } catch {
      setError("That switch did not take. Try again in a moment.")
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <div className="qs-helpers">
        {helpers.map((helper) => (
          <div className="qs-helper" key={helper.id}>
            <span>
              {helper.name}
              <small>{helper.purpose}</small>
            </span>
            <button
              type="button"
              className="qs-sw"
              role="switch"
              aria-checked={helper.enabled}
              aria-label={helper.name}
              disabled={busy !== null}
              onClick={() => void flip(helper)}
            />
          </div>
        ))}
      </div>
      {error ? <p className="qs-warn" role="alert">{error}</p> : null}
    </>
  )
}

function StepBody({ id, go, ai, setAi }: { id: QuickStartStepId; go: Go; ai: "claude" | "codex"; setAi: (ai: "claude" | "codex") => void }) {
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    await navigator.clipboard?.writeText(mcpAddress()).catch(() => undefined)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  switch (id) {
    case "whatsapp":
      return (
        <>
          <ol>
            <li>Open <b>Settings › WhatsApp &amp; Telegram</b> and type your phone number.</li>
            <li>From that phone, send the code it shows to Zenod’s WhatsApp number.</li>
            <li>Send anything at all, a thought, a link, a photo.</li>
          </ol>
          <div className="qs-tick">Ticks itself when your first message arrives and Zenod replies.</div>
          <div className="qs-row">
            <button type="button" className="qs-btn" onClick={() => go({ section: "settings", settings: "channels" })}>
              Open WhatsApp settings
            </button>
          </div>
        </>
      )
    case "assistant":
      return (
        <>
          <div className="qs-choice" role="group" aria-label="Your assistant">
            <button type="button" aria-pressed={ai === "claude"} onClick={() => setAi("claude")}>Claude</button>
            <button type="button" aria-pressed={ai === "codex"} onClick={() => setAi("codex")}>Codex</button>
          </div>
          {ai === "claude" ? (
            <ol>
              <li>In Claude, open <b>Settings › Connectors</b> and press <b>Add custom connector</b>.</li>
              <li>Paste <code className="qs-code">{mcpAddress()}</code>, sign in to Zenod and press <b>Allow</b>.</li>
              <li>Ask Claude: “what does Zenod know about me?”</li>
            </ol>
          ) : (
            <ol>
              <li>In Zenod, open <b>Settings › Connect AI apps</b> and make an access token.</li>
              <li>Add Zenod to Codex with the address <code className="qs-code">{mcpAddress()}</code> and that token. The Connect page shows the one line to use.</li>
              <li>Ask Codex: “search my Zenod memory for this week”.</li>
            </ol>
          )}
          <div className="qs-tick">Ticks itself when Claude or Codex signs in to Zenod.</div>
          <div className="qs-row">
            <button type="button" className="qs-btn ghost" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy the address"}
            </button>
            {ai === "codex" ? (
              <button type="button" className="qs-btn ghost" onClick={() => go({ section: "settings", settings: "connect" })}>
                Open Connect AI apps
              </button>
            ) : null}
          </div>
        </>
      )
    case "keep":
      return (
        <>
          <p>
            Something you will want back next week. A name, a plan, a book someone recommended. Say it in WhatsApp,
            tell Claude “save this to Zenod”, or type it in Chat below.
          </p>
          <div className="qs-tick">Ticks itself when Zenod has filed it. A voice note counts too.</div>
        </>
      )
    case "found":
      return (
        <>
          <p>
            Ask the way you would ask a friend who was listening: “what was that book Ana mentioned?” Zenod answers
            with where it found it.
          </p>
          <div className="qs-tick">Ticks itself when an answer brings back something you kept.</div>
        </>
      )
    case "helper":
      return (
        <>
          <p>
            Helpers read your memory while you sleep and leave you a short note in the Inbox. They all start off.
            Pick the one that sounds useful.
          </p>
          <HelperSwitches />
          <div className="qs-tick">Ticks itself when you switch one on. Off again whenever you like.</div>
        </>
      )
  }
}

const STEP_TEXT: Record<QuickStartStepId, { title: string; sub: string }> = {
  whatsapp: { title: "Send Zenod a WhatsApp", sub: "and see it answer “Saved”" },
  assistant: { title: "Add Zenod to Claude or Codex", sub: "and ask it one thing through Zenod" },
  keep: { title: "Give Zenod something to keep", sub: "type it, or send a voice note" },
  found: { title: "Ask for it back", sub: "in Chat here, or from Claude or Codex" },
  helper: { title: "Choose one helper", sub: "switch it on, and off again whenever you like" },
}

export function QuickStartView({ quick, go, onHide }: { quick: QuickStart; go: Go; onHide: () => void }) {
  const [ai, setAi] = React.useState<"claude" | "codex">("claude")
  const counted = quick.steps.filter((step) => quick.helpersOpen || step.id !== "helper")
  const next = counted.find((step) => !step.done)?.id ?? null
  const [open, setOpen] = React.useState<QuickStartStepId | null>(next)
  const lastNext = React.useRef(next)
  React.useEffect(() => {
    // A step that ticks opens the next one.
    if (lastNext.current !== next) {
      lastNext.current = next
      setOpen(next)
    }
  }, [next])

  if (quick.complete) {
    return (
      <section className="qs qs-all" data-testid="quick-start" aria-labelledby="qs-title">
        <p className="qs-eyebrow">Quick start</p>
        <h2 id="qs-title">{quick.total} of {quick.total}. You’re all set.</h2>
        <p className="qs-sub">Zenod now keeps what you send it and gives it back where you work. From here on, just use it.</p>
        <ul className="qs-win">
          <li>WhatsApp talks to Zenod</li>
          <li>{quick.assistantName ?? "Claude or Codex"} reads and saves through Zenod</li>
          <li>You kept something</li>
          <li>You got it back</li>
          {quick.helpersOpen ? <li>{quick.helperName ?? "A helper"} is on</li> : null}
        </ul>
        <button type="button" className="qs-btn" onClick={onHide}>Close quick start</button>
      </section>
    )
  }

  let number = 0
  return (
    <section className="qs" data-testid="quick-start" aria-labelledby="qs-title">
      <div className="qs-top">
        <div>
          <p className="qs-eyebrow">Quick start · about 10 minutes</p>
          <h2 id="qs-title">{quick.total === 5 ? "Five" : "Four"} things, and Zenod is yours</h2>
          <p className="qs-sub">Do each one once. Zenod notices by itself and ticks it off, so there is nothing to report back.</p>
        </div>
        <div className="qs-score" aria-live="polite" data-testid="quick-start-score">
          <Ring score={quick.score} total={quick.total} />
          <div>
            <div className="qs-n">{quick.score} of {quick.total}</div>
            <div className="qs-of">{scoreWord(quick.score, quick.total)}</div>
          </div>
        </div>
      </div>

      <div className="qs-before">
        <div className="qs-pre">
          <h4><span className="qs-ok">✓</span> Your memory is connected</h4>
          <p>It lives in a Zenod folder in your Google Drive or GitHub, whichever you picked. You own it.</p>
        </div>
        <div className="qs-pre">
          <h4><span className="qs-ok">✓</span> Nothing to set up for AI</h4>
          <p>Zenod’s AI comes with your plan. Claude or Codex use your own account with them, as they do today.</p>
        </div>
      </div>

      <ol className="qs-steps">
        {quick.steps.map((step) => {
          const coming = step.id === "helper" && !quick.helpersOpen
          if (!coming) number += 1
          const isOpen = open === step.id && !coming
          const state = step.done ? "Done" : coming ? "Coming soon" : step.id === next ? "Next" : ""
          return (
            <li
              key={step.id}
              className={`qs-step${step.done ? " done" : ""}${step.id === next ? " next" : ""}${isOpen ? " open" : ""}${coming ? " coming" : ""}`}
              data-step={step.id}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                disabled={coming}
                onClick={() => setOpen(isOpen ? null : step.id)}
              >
                <span className="qs-mark">{step.done ? "✓" : coming ? "·" : number}</span>
                <span className="qs-t">
                  {STEP_TEXT[step.id].title}
                  <span className="qs-w">
                    {coming ? "Helpers are still being built. This step opens when they are ready." : STEP_TEXT[step.id].sub}
                  </span>
                </span>
                <span className="qs-state">{state}</span>
              </button>
              {isOpen ? (
                <div className="qs-body">
                  <StepBody id={step.id} go={go} ai={ai} setAi={setAi} />
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>

      <div className="qs-foot">
        <span>Stuck on a step? Write to support@zenod.dev and a person helps.</span>
        <button type="button" onClick={onHide}>Hide quick start</button>
      </div>
    </section>
  )
}

/** The card above Chat: nothing once hidden or closed. */
export function QuickStartCard({ go }: { go: Go }) {
  const quick = useQuickStart()
  if (!quick || quick.hidden) return null
  return <QuickStartView quick={quick} go={go} onHide={() => void setQuickStartHidden(true)} />
}

/** Settings › Account: bring a hidden quick start back. */
export function QuickStartRestore({ go }: { go: Go }) {
  const quick = useQuickStart()
  if (!quick || !quick.hidden) return null
  return (
    <button
      type="button"
      className="qs-btn ghost"
      data-testid="quick-start-restore"
      onClick={() => {
        void setQuickStartHidden(false)
        go({ section: "chat" })
      }}
    >
      Show the quick start again ({quick.score} of {quick.total})
    </button>
  )
}
