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
        <h4 className="zi-what">{persona.name}</h4>
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

// EPIC-14 S47 (Jordi's E14-A12 yes, 18 Nov): the nine helpers regrouped into five memory personas a
// user switches on, plus one quiet "Keep my memory tidy" switch. One switch per persona turns its
// helpers on or off together; the helpers stay listed underneath with their own controls. The
// grouping lives here only: what is stored and what runs is per helper, exactly as before, so an
// account's switches carry over unchanged (a persona reads on while any of its helpers is on).
export type PersonaGroup = {
  id: string
  name: string
  line: string
  /** The helpers its switch turns on and off together. */
  helpers: readonly string[]
  /** Listed with it, each still on its own switch (People and follow-ups joins Remind me in S48). */
  alongside?: readonly string[]
  /** Not built yet: shown as coming, no switch (Make it easier, S49). */
  coming?: boolean
}

export const PERSONA_GROUPS: readonly PersonaGroup[] = [
  {
    id: "remind-me",
    name: "Remind me",
    line: "Loose ends you said you would do, and your week in a few lines.",
    helpers: ["open-loops", "weekly-recap"],
    alongside: ["people-follow-ups"],
  },
  {
    id: "your-ideas",
    name: "Your ideas",
    line: "The ideas you keep coming back to, gathered in one place.",
    helpers: ["ideas-digest"],
  },
  {
    id: "new-possibilities",
    name: "New possibilities",
    line: "One thing you have not thought of, from what you said.",
    helpers: ["something-to-try"],
  },
  {
    id: "reflect",
    name: "Reflect",
    line: "Gently names what keeps coming back, with one idea to try.",
    helpers: ["patterns-and-ideas"],
  },
  {
    id: "make-it-easier",
    name: "Make it easier",
    line: "One thing you do again and again that could take less time or money.",
    helpers: [],
    coming: true,
  },
]

export const TIDY_GROUP: PersonaGroup = {
  id: "tidy",
  name: "Keep my memory tidy",
  line: "Asks about unclear notes, keeps topics neat and checks your memory's health.",
  helpers: ["clarifier", "topic-gardener", "memory-health"],
}

function GroupRow({
  group,
  personas,
  others,
  teamConnected,
  building,
  quiet,
  onList,
}: {
  group: PersonaGroup
  personas: Persona[]
  others: Persona[]
  teamConnected: boolean
  building: boolean
  quiet?: boolean
  onList: (list: PersonaList) => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const on = personas.filter((persona) => persona.enabled).length
  const enabled = on > 0

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      let last: PersonaList | null = null
      for (const persona of personas) {
        if (persona.enabled !== !enabled)
          last = await setPersonaEnabled(persona.id, !enabled)
      }
      if (last) onList(last)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const listed = [...personas, ...others]
  return (
    <li
      className={`zg-item${quiet ? " zg-quiet" : ""}${enabled ? " zg-on" : ""}${group.coming ? " zg-coming" : ""}`}
      data-testid={`persona-${group.id}`}
    >
      <div className="zg-head">
        <div className="zg-words">
          <h3 className="zg-name">{group.name}</h3>
          <p className="zg-line">{group.line}</p>
          {!group.coming && enabled && on < personas.length ? (
            <p className="zg-part">
              {on} of {personas.length} helpers on
            </p>
          ) : null}
        </div>
        {group.coming ? (
          <span className="zg-soon">Coming soon</span>
        ) : (
          <button
            type="button"
            className="zr-switch"
            role="switch"
            aria-checked={enabled}
            aria-label={`${group.name} ${enabled ? "on" : "off"}${building ? ", still building" : ""}`}
            disabled={building || busy || personas.length === 0}
            onClick={toggle}
          >
            <i aria-hidden="true" />
            {enabled ? "On" : "Off"}
          </button>
        )}
      </div>
      {error ? (
        <p className="zi-warn" role="alert">
          {error}
        </p>
      ) : null}
      {listed.length > 0 || group.id === TIDY_GROUP.id ? (
        <details className="zg-inside">
          <summary>
            {group.id === TIDY_GROUP.id
              ? `The helpers inside (${listed.length + 1})`
              : `The helper${listed.length === 1 ? "" : "s"} inside (${listed.length})`}
          </summary>
          {others.length > 0 ? (
            <p className="zp-hint zg-note">
              {others.map((persona) => persona.name).join(", ")} keeps its own
              switch for now; it joins {group.name} soon.
            </p>
          ) : null}
          <ul className="zi-list" aria-label={`${group.name}: its helpers`}>
            {listed.map((persona) => (
              <PersonaCard
                key={persona.id}
                persona={persona}
                teamConnected={teamConnected}
                building={building}
                onList={onList}
              />
            ))}
            {group.id === TIDY_GROUP.id ? (
              <li className="zi-item zr-item zr-on">
                <div className="zr-head">
                  <h4 className="zi-what">Quick index</h4>
                  <span className="zg-always">Always on</span>
                </div>
                <p className="zr-purpose">
                  Learns the words you use for people, places and projects, so
                  Zenod reads what you mean. It is part of how your notes are
                  filed, so it has no switch.
                </p>
              </li>
            ) : null}
          </ul>
        </details>
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

  function rows(list: PersonaList) {
    const byId = new Map(list.personas.map((persona) => [persona.id, persona]))
    const pick = (ids: readonly string[] = []) =>
      ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
    const grouped = new Set(
      [...PERSONA_GROUPS, TIDY_GROUP].flatMap((group) => [
        ...group.helpers,
        ...(group.alongside ?? []),
      ])
    )
    // A helper no persona holds yet still shows, with its own switch, so nothing is ever hidden.
    const loose = list.personas.filter((persona) => !grouped.has(persona.id))
    const teamConnected = list.teamConnected === true
    const personaOn = PERSONA_GROUPS.filter((group) =>
      pick(group.helpers).some((persona) => persona.enabled)
    ).length
    const live = PERSONA_GROUPS.filter((group) => !group.coming).length
    return (
      <>
        <ul className="zg-list" aria-label="Personas">
          {PERSONA_GROUPS.map((group) => (
            <GroupRow
              key={group.id}
              group={group}
              personas={pick(group.helpers)}
              others={pick(group.alongside)}
              teamConnected={teamConnected}
              building={building}
              onList={onList}
            />
          ))}
        </ul>
        <ul className="zg-list zg-tidy" aria-label="Keep my memory tidy">
          <GroupRow
            group={TIDY_GROUP}
            personas={pick(TIDY_GROUP.helpers)}
            others={[]}
            teamConnected={teamConnected}
            building={building}
            quiet
            onList={onList}
          />
        </ul>
        {loose.length > 0 ? (
          <ul className="zi-list" aria-label="Other helpers">
            {loose.map((persona) => (
              <PersonaCard
                key={persona.id}
                persona={persona}
                teamConnected={teamConnected}
                building={building}
                onList={onList}
              />
            ))}
          </ul>
        ) : null}
        <p className="zp-hint zi-foot">
          {personaOn} of {live} on. Together they spend at most{" "}
          {usd(list.budget.capUsd)} a month of your AI allowance. This month:{" "}
          {usd(list.budget.spentUsd)}.
        </p>
      </>
    )
  }

  return (
    <section className="zp zi" aria-labelledby="memory-personas-heading">
      <div className="zp-head">
        {/* EPIC-23 U7 (Jordi, 2026-11-11): Zenod goes live as memory only; helpers are off and still building. */}
        {building ? (
          <p className="zp-building" data-testid="helpers-building">
            Still building
          </p>
        ) : null}
        <h2 id="memory-personas-heading">Your helpers</h2>
        {building ? (
          <p className="zp-lede" data-testid="helpers-building-note">
            Helpers are switched off while we finish building them. Your
            memory works fully without them: save, file and ask as usual.
          </p>
        ) : null}
        <p className="zp-lede zr-what" data-testid="helpers-what">
          Switch one on and it reads your memory and leaves cards in your
          inbox. Nothing changes without your yes, and none of them ever
          messages anyone.
        </p>
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
            rows(state.list)
          )}
        </div>
      </div>
    </section>
  )
}
