import * as React from "react"

import { errorMessage } from "@/lib/api"
import { readInboxCount, setInboxCount } from "@/lib/inbox"
import {
  readPersonas,
  runPersonaNow,
  setPersonaEnabled,
  type Persona,
  type PersonaList,
  type PersonaRun,
} from "@/lib/personas"
import "@/components/memory-inbox.css"
import "@/components/memory-personas.css"

// EPIC-14 S4: the personas. Helpers that wake on your memory on a schedule, mostly read, write only
// into their own folder and leave findings and questions in the inbox. Here you switch one on or
// off, see its last run (time, steps, cost) and Run now instead of waiting for the night. Paper
// language (docs/epic12/DESIGN-LANGUAGE.md).

type State =
  | { kind: "loading" }
  | { kind: "ready"; list: PersonaList }
  | { kind: "error"; message: string }

const usd = (value: number) =>
  value < 0.01 && value > 0 ? "under 1 cent" : `$${value.toFixed(2)}`

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const STATUS: Record<PersonaRun["status"], string> = {
  running: "Running",
  done: "Done",
  skipped: "Skipped",
  capped: "Stopped at a cap",
  failed: "Failed",
}

function LastRun({ run }: { run: PersonaRun | null }) {
  if (!run) return <p className="zr-run zp-hint">Has not run yet.</p>
  return (
    <p className="zr-run">
      <span className={`zr-status zr-s-${run.status}`}>
        {STATUS[run.status]}
      </span>{" "}
      {when(run.startedAt)} · {run.summary || "no summary"}
      <span className="zr-meta">
        {run.steps} steps · {run.inputTokens + run.outputTokens} tokens ·{" "}
        {run.costUsd > 0 ? usd(run.costUsd) : "no cost"}
        {run.inboxItemIds.length > 0 ? (
          <>
            {" "}
            · <a href="#inbox">in your inbox</a>
          </>
        ) : null}
      </span>
    </p>
  )
}

function PersonaCard({
  persona,
  onList,
}: {
  persona: Persona
  onList: (list: PersonaList) => void
}) {
  const [busy, setBusy] = React.useState<"toggle" | "run" | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function toggle() {
    setBusy("toggle")
    setError(null)
    try {
      onList(await setPersonaEnabled(persona.id, !persona.enabled))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  async function runNow() {
    setBusy("run")
    setError(null)
    try {
      onList(await runPersonaNow(persona.id))
      readInboxCount()
        .then((result) => setInboxCount(result.needsYou))
        .catch(() => {})
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className={`zi-item zr-item${persona.enabled ? "" : " zi-quiet"}`}>
      <p className="zi-top">
        <span className="zi-kind">{persona.schedule}</span>
        <span>{persona.enabled ? "On" : "Off"}</span>
      </p>
      <h3 className="zi-what">{persona.name}</h3>
      <p className="zi-body">{persona.brief}</p>
      <ul className="zr-perms" aria-label="What it may do">
        {persona.permissions.map((permission) => (
          <li key={permission}>{permission}</li>
        ))}
      </ul>
      <LastRun run={persona.lastRun} />
      <p className="zp-hint">
        This month {usd(persona.budget.personaUsd)} of{" "}
        {usd(persona.budget.personaCapUsd)} · at most{" "}
        {persona.limits.maxSteps} steps a run
        {persona.nextWakeAt ? <> · next {when(persona.nextWakeAt)}</> : null}
      </p>
      <div className="zi-row">
        <button
          type="button"
          className="zp-send"
          disabled={busy !== null}
          onClick={runNow}
        >
          {busy === "run" ? "Running…" : "Run now"}
        </button>
        <button
          type="button"
          className="zp-keep"
          role="switch"
          aria-checked={persona.enabled}
          disabled={busy !== null}
          onClick={toggle}
        >
          {persona.enabled ? "Switch off" : "Switch on"}
        </button>
      </div>
      {error ? (
        <p className="zi-warn" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  )
}

export function MemoryPersonas({ active = true }: { active?: boolean }) {
  const [state, setState] = React.useState<State>({ kind: "loading" })

  React.useEffect(() => {
    if (!active) return
    let live = true
    readPersonas()
      .then((list) => live && setState({ kind: "ready", list }))
      .catch(
        (cause) =>
          live && setState({ kind: "error", message: errorMessage(cause) })
      )
    return () => {
      live = false
    }
  }, [active])

  const onList = React.useCallback(
    (list: PersonaList) => setState({ kind: "ready", list }),
    []
  )

  return (
    <section className="zp zi" aria-labelledby="memory-personas-heading">
      <div className="zp-head">
        <h2 id="memory-personas-heading">Helpers that read your memory.</h2>
        <p className="zp-lede">
          They wake on a schedule, mostly read, write only into their own
          folder and leave what they find in your inbox.
        </p>
      </div>
      <div className="zp-stage">
        <div className="zp-screen zi-screen">
          {state.kind === "loading" ? (
            <p className="zp-empty">Opening your personas…</p>
          ) : state.kind === "error" ? (
            <p className="zp-empty zp-warn" role="alert">
              Your personas could not be opened: {state.message}
            </p>
          ) : (
            <>
              <ul className="zi-list" aria-label="Personas">
                {state.list.personas.map((persona) => (
                  <PersonaCard
                    key={persona.id}
                    persona={persona}
                    onList={onList}
                  />
                ))}
              </ul>
              <p className="zp-hint zi-foot">
                All personas together spend at most{" "}
                {usd(state.list.budget.capUsd)} a month of your AI allowance.
                This month: {usd(state.list.budget.spentUsd)}.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
