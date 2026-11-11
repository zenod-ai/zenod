import * as React from "react"

import { talkHash } from "@/lib/memory-chat"

import { errorMessage } from "@/lib/api"
import { readInboxCount, setInboxCount } from "@/lib/inbox"
import {
  readPersonas,
  runPersonaNow,
  setPersonaAskTeam,
  setPersonaCadence,
  setPersonaEnabled,
  type Persona,
  type PersonaCadence,
  type PersonaList,
  type PersonaRun,
} from "@/lib/personas"
import "@/components/memory-inbox.css"
import "@/components/memory-personas.css"

// EPIC-14 S4: the persona catalog. Helpers that wake on your memory on a schedule, mostly read,
// write only into their own folder and leave findings and questions in the inbox. Each has its own
// switch, a cadence you can change and the skills it comes with; one that is off never runs. Once
// on, you see its last run (time, steps, cost) and can Run now instead of waiting for the night.
// Paper language (docs/epic12/DESIGN-LANGUAGE.md).

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

const CADENCE_KIND: Record<PersonaCadence["every"], string> = {
  night: "Daily",
  week: "Weekly",
  days: "Every few days",
}

function Cadence({
  persona,
  disabled,
  onChange,
}: {
  persona: Persona
  disabled: boolean
  onChange: (cadence: PersonaCadence) => void
}) {
  const { cadence } = persona
  const [days, setDays] = React.useState(
    cadence.every === "days" ? cadence.days : 3
  )
  return (
    <div className="zr-cadence">
      <label>
        <span>How often</span>
        <select
          value={cadence.every}
          disabled={disabled}
          aria-label={`How often ${persona.name} runs`}
          onChange={(event) => {
            const every = event.target.value as PersonaCadence["every"]
            onChange(every === "days" ? { every, days } : { every })
          }}
        >
          {(Object.keys(CADENCE_KIND) as Array<PersonaCadence["every"]>).map(
            (every) => (
              <option key={every} value={every}>
                {CADENCE_KIND[every]}
              </option>
            )
          )}
        </select>
      </label>
      {cadence.every === "days" ? (
        <label>
          <span>every</span>
          <input
            type="number"
            min={2}
            max={30}
            value={days}
            disabled={disabled}
            aria-label={`Days between ${persona.name} runs`}
            onChange={(event) => setDays(Number(event.target.value))}
            onBlur={() => {
              if (days >= 2 && days <= 30 && days !== cadence.days)
                onChange({ every: "days", days })
            }}
          />
          <span>days</span>
        </label>
      ) : null}
      <span className="zr-when">{persona.schedule}</span>
    </div>
  )
}

function PersonaCard({
  persona,
  teamConnected,
  building,
  onList,
}: {
  persona: Persona
  teamConnected: boolean
  building: boolean
  onList: (list: PersonaList) => void
}) {
  const [busy, setBusy] = React.useState<
    "toggle" | "run" | "cadence" | "ask" | null
  >(
    null
  )
  const [error, setError] = React.useState<string | null>(null)

  async function change(
    kind: "toggle" | "cadence" | "ask",
    call: () => Promise<PersonaList>
  ) {
    setBusy(kind)
    setError(null)
    try {
      onList(await call())
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }
  const toggle = () =>
    change("toggle", () => setPersonaEnabled(persona.id, !persona.enabled))

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
    <li
      className={`zi-item zr-item${persona.enabled ? " zr-on" : " zi-quiet"}`}
    >
      <div className="zr-head">
        <h3 className="zi-what">{persona.name}</h3>
        <button
          type="button"
          className="zr-switch"
          role="switch"
          aria-checked={persona.enabled}
          aria-label={`${persona.name} ${persona.enabled ? "on" : "off"}${building ? ", still building" : ""}`}
          disabled={building || busy !== null}
          onClick={toggle}
        >
          <i aria-hidden="true" />
          {persona.enabled ? "On" : "Off"}
        </button>
      </div>
      <p className="zr-purpose">{persona.purpose}</p>
      <p className="zi-body">{persona.brief}</p>
      <Cadence
        persona={persona}
        disabled={building || busy !== null}
        onChange={(cadence) =>
          change("cadence", () => setPersonaCadence(persona.id, cadence))
        }
      />
      <div className="zr-skills">
        <span>Skills</span>
        <ul aria-label={`${persona.name}'s skills`}>
          {persona.skills.map((skill) => (
            <li key={skill.id}>{skill.label}</li>
          ))}
        </ul>
      </div>
      {/* EPIC-14 S35: one read-only question to the Team desk a run, off by default. */}
      {!building && teamConnected && typeof persona.askTeam === "boolean" ? (
        <label className="zr-askteam">
          <input
            type="checkbox"
            checked={persona.askTeam}
            disabled={busy !== null}
            onChange={() =>
              change("ask", () =>
                setPersonaAskTeam(persona.id, !persona.askTeam)
              )
            }
          />
          Ask your team how things connect: one question a run, read only. It
          never picks or starts work.
        </label>
      ) : null}
      {/* EPIC-22 E22-2: talk something over with this persona in the chat, on or off. */}
      <div className="zi-row">
        <button
          type="button"
          className="zp-deskbtn"
          disabled={building}
          onClick={() => {
            window.location.hash = talkHash(persona.id)
          }}
        >
          Talk it over
        </button>
      </div>
      {building ? (
        <p className="zp-hint">Still building: off for now.</p>
      ) : persona.enabled ? (
        <>
          <LastRun run={persona.lastRun} />
          <p className="zp-hint">
            This month {usd(persona.budget.personaUsd)} of{" "}
            {usd(persona.budget.personaCapUsd)} · at most{" "}
            {persona.limits.maxSteps} steps a run
            {persona.nextWakeAt ? (
              <> · next {when(persona.nextWakeAt)}</>
            ) : null}
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
          </div>
        </>
      ) : (
        <p className="zp-hint">Off: it never runs until you switch it on.</p>
      )}
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

  const building = state.kind === "ready" && state.list.building === true

  return (
    <section className="zp zi" aria-labelledby="memory-personas-heading">
      <div className="zp-head">
        {/* EPIC-23 U7 (Jordi, 2026-11-11): Zenod goes live as memory only; helpers are off and still building. */}
        {building ? (
          <p className="zp-building" data-testid="helpers-building">
            Still building
          </p>
        ) : null}
        <h2 id="memory-personas-heading">Helpers that read your memory.</h2>
        {building ? (
          <p className="zp-lede" data-testid="helpers-building-note">
            Helpers are switched off while we finish building them. Your
            memory works fully without them: save, file and ask as usual.
          </p>
        ) : null}
        <p className="zp-lede zr-what" data-testid="helpers-what">
          A helper is a harness that wakes up bound to a persona, reads your
          memory and puts cards in your inbox.
        </p>
        {building ? null : (
          <p className="zp-lede">
            Switch on the ones you want. Each wakes on its own schedule inside
            your Zenod account, uses only the skills listed, writes only into
            its own folder and leaves what it finds in your inbox. None of
            them ever messages anyone.
          </p>
        )}
      </div>
      <div className="zp-stage">
        <div className="zp-screen zi-screen">
          {state.kind === "loading" ? (
            <p className="zp-empty">Opening your helpers…</p>
          ) : state.kind === "error" ? (
            <p className="zp-empty zp-warn" role="alert">
              Your helpers could not be opened: {state.message}
            </p>
          ) : (
            <>
              <ul className="zi-list" aria-label="Helpers">
                {state.list.personas.map((persona) => (
                  <PersonaCard
                    key={persona.id}
                    persona={persona}
                    teamConnected={state.list.teamConnected === true}
                    building={building}
                    onList={onList}
                  />
                ))}
              </ul>
              <p className="zp-hint zi-foot">
                {state.list.personas.filter((p) => p.enabled).length} of{" "}
                {state.list.personas.length} on. All helpers together spend
                at most {usd(state.list.budget.capUsd)} a month of your AI
                allowance. This month: {usd(state.list.budget.spentUsd)}.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
