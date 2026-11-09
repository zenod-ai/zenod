import * as React from "react"

import { api } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"
import { RecentSavesPanel } from "@/views/ZenodPortalPanels"

// EPIC-22 E22-2, Memory › At a glance: totals, memories kept each week, the strongest places in the
// tree, where memories come from, and the recent saves. Drawn from data Zenod already stores
// (GET /api/console/memory-glance: the Log's entries and the tree); nothing is written.

export type MemoryGlance = {
  totals: { memories: number; voiceNotes: number; pages: number; places: number; thisWeek: number }
  weeks: { week: string; kept: number }[]
  places: { title: string; path: string | null; pages: number; latest: string | null }[]
  sources: { source: string; label: string; count: number }[]
}

type GlanceState = { status: "loading" } | { status: "ready"; glance: MemoryGlance } | { status: "empty" } | { status: "unavailable" }

const shortDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })

export function MemoryGlanceView({ onOpenTree }: { onOpenTree?: () => void }) {
  const [state, setState] = React.useState<GlanceState>({ status: "loading" })
  React.useEffect(() => {
    let live = true
    api<({ status: "ready" } & MemoryGlance) | { status: "empty" }>("/api/console/memory-glance")
      .then((result) => {
        if (!live) return
        setState(result.status === "ready" ? { status: "ready", glance: result } : { status: "empty" })
      })
      .catch(() => live && setState({ status: "unavailable" }))
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <section className="zp zg" aria-label="Your memory at a glance">
        {state.status === "loading" ? (
          <Skeleton className="h-64 w-full" />
        ) : state.status === "ready" ? (
          <Glance glance={state.glance} onOpenTree={onOpenTree} />
        ) : (
          <p className="zp-hint">
            {state.status === "empty"
              ? "Nothing in your memory yet. Tell Zenod something in the chat or on WhatsApp and it shows here."
              : "Zenod could not count your memory just now. Try again in a moment."}
          </p>
        )}
      </section>
      <RecentSavesPanel />
    </div>
  )
}

function Glance({ glance, onOpenTree }: { glance: MemoryGlance; onOpenTree?: () => void }) {
  const { totals, weeks, places, sources } = glance
  const most = Math.max(1, ...weeks.map((week) => week.kept))
  const biggest = Math.max(1, ...places.map((place) => place.pages))
  const all = Math.max(1, sources.reduce((sum, source) => sum + source.count, 0))
  return (
    <>
      <dl className="zg-totals">
        <div><dt>Memories</dt><dd data-testid="glance-memories">{totals.memories}</dd></div>
        <div><dt>This week</dt><dd>{totals.thisWeek}</dd></div>
        <div><dt>Voice notes</dt><dd>{totals.voiceNotes}</dd></div>
        <div><dt>Pages</dt><dd>{totals.pages}</dd></div>
        <div><dt>Places</dt><dd>{totals.places}</dd></div>
      </dl>
      <div className="zg-grid">
        <figure className="zg-card">
          <figcaption>Kept each week</figcaption>
          <ol className="zg-weeks" aria-label="Memories kept each week, last 12 weeks">
            {weeks.map((week) => (
              <li key={week.week} title={`Week of ${shortDay(week.week)}: ${week.kept}`}>
                <span className="zg-col" style={{ height: `${Math.max(2, (week.kept / most) * 100)}%` }} />
                <span className="zg-n">{week.kept || ""}</span>
              </li>
            ))}
          </ol>
          <p className="zg-axis">
            <span>{weeks[0] ? shortDay(weeks[0].week) : ""}</span>
            <span>this week</span>
          </p>
        </figure>
        <figure className="zg-card">
          <figcaption>Strongest places</figcaption>
          {places.length ? (
            <ul className="zg-rows">
              {places.map((place) => (
                <li key={place.path ?? place.title}>
                  <span className="zg-label">{place.title}</span>
                  <span className="zp-bar" aria-hidden="true"><i style={{ width: `${(place.pages / biggest) * 100}%` }} /></span>
                  <span className="zg-count">{place.pages}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="zp-hint">No places yet: Zenod makes them as it files.</p>
          )}
          {onOpenTree ? (
            <button type="button" className="zp-link" onClick={onOpenTree}>Open the tree</button>
          ) : null}
        </figure>
        <figure className="zg-card">
          <figcaption>Where they come from</figcaption>
          <ul className="zg-rows">
            {sources.map((source) => (
              <li key={source.source}>
                <span className="zg-label">{source.label}</span>
                <span className="zp-bar" aria-hidden="true"><i style={{ width: `${(source.count / all) * 100}%` }} /></span>
                <span className="zg-count">{Math.round((source.count / all) * 100)}%</span>
              </li>
            ))}
          </ul>
        </figure>
      </div>
    </>
  )
}
