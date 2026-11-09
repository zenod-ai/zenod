import * as React from "react"

import { api } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"

// EPIC-14 S28, Memory › At a glance, "What Zenod knows you mean": the quick index. Every place in
// the tree with its one-line summary, the other names you use for it, how many notes and when you
// last added to it, plus what you added to this week (GET /api/console/quick-index). Read only.

export type QuickIndexPlace = {
  path: string
  title: string
  lineage: string[]
  summary: string
  names: string[]
  pages: number
  memories: number
  week: number
  lastTouched: string | null
}

export type QuickIndex = {
  builtAt: string | null
  places: QuickIndexPlace[]
  thisWeek: { path: string; title: string; week: number; lastTouched: string | null }[]
  totals: { places: number; named: number; names: number; thisWeek: number }
  cost: { todayUsd: number; perDayUsd: { day: string; usd: number; calls: number }[]; firstBuildUsd: number; calls: number }
}

type State = { status: "loading" } | { status: "ready"; index: QuickIndex } | { status: "empty" } | { status: "unavailable" }

const SHOWN = 12

const shortDay = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })

/** US cents, the way the plan talks about it: "0.3 cent". */
export const cents = (usd: number) => {
  const c = usd * 100
  if (c === 0) return "nothing"
  if (c < 0.01) return "under 0.01 cent"
  return c < 1 ? `${c.toFixed(2)} cent` : `${c.toFixed(1)} cents`
}

/** This week's places first, then places with names, then the fullest. */
export function orderPlaces(places: readonly QuickIndexPlace[]): QuickIndexPlace[] {
  return [...places].sort((a, b) =>
    b.week - a.week
    || Number(b.names.length > 0) - Number(a.names.length > 0)
    || (b.lastTouched ?? "").localeCompare(a.lastTouched ?? "")
    || b.memories - a.memories
    || a.title.localeCompare(b.title))
}

export function matchesPlace(place: QuickIndexPlace, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [place.title, place.summary, ...place.names, ...place.lineage].some((text) => text.toLowerCase().includes(q))
}

export function QuickIndexPanel() {
  const [state, setState] = React.useState<State>({ status: "loading" })
  const [query, setQuery] = React.useState("")
  const [all, setAll] = React.useState(false)
  React.useEffect(() => {
    let live = true
    api<({ status: "ready" } & QuickIndex) | { status: "empty" }>("/api/console/quick-index")
      .then((result) => {
        if (!live) return
        setState(result.status === "ready" ? { status: "ready", index: result } : { status: "empty" })
      })
      .catch(() => live && setState({ status: "unavailable" }))
    return () => {
      live = false
    }
  }, [])

  return (
    <section className="zp zq" aria-label="What Zenod knows you mean">
      <header className="zq-head">
        <h3>What Zenod knows you mean</h3>
        <p className="zp-hint">Your places, the names you use for them and what is live this week. Kept fresh after each note and once a night.</p>
      </header>
      {state.status === "loading" ? (
        <Skeleton className="h-40 w-full" />
      ) : state.status === "ready" ? (
        <Index index={state.index} query={query} setQuery={setQuery} all={all} setAll={setAll} />
      ) : (
        <p className="zp-hint">
          {state.status === "empty"
            ? "Nothing here yet: Zenod builds this once your memory has places."
            : "Zenod could not read its index just now. Try again in a moment."}
        </p>
      )}
    </section>
  )
}

function Index({ index, query, setQuery, all, setAll }: { index: QuickIndex; query: string; setQuery: (q: string) => void; all: boolean; setAll: (all: boolean) => void }) {
  const ordered = orderPlaces(index.places).filter((place) => matchesPlace(place, query))
  const shown = all || query ? ordered : ordered.slice(0, SHOWN)
  const week = index.cost.perDayUsd.reduce((sum, d) => sum + d.usd, 0)
  return (
    <>
      <p className="zq-week" data-testid="quick-index-week">
        <b>This week</b>{" "}
        {index.thisWeek.length ? index.thisWeek.map((place) => place.title).join(", ") : "nothing new yet"}
      </p>
      <input
        className="zq-find"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Find among ${index.totals.places} places or the names you use`}
        aria-label="Find a place or a name"
      />
      <ul className="zq-list" data-testid="quick-index-places">
        {shown.map((place) => (
          <li key={place.path}>
            <p>
              <b>{place.title}</b>{" "}
              <i>
                {place.lineage.length > 1 ? `· ${place.lineage.slice(0, -1).join(" › ")} ` : ""}
                {place.names.length ? <>· also {place.names.map((name) => `“${name}”`).join(", ")} </> : null}
                · {place.memories} {place.memories === 1 ? "note" : "notes"}
                {place.lastTouched ? ` · last ${shortDay(place.lastTouched)}` : ""}
              </i>
            </p>
            {place.summary ? <p className="zq-sum">{place.summary}</p> : null}
          </li>
        ))}
      </ul>
      {!query && ordered.length > SHOWN ? (
        <button type="button" className="zp-link zq-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${ordered.length} places`}
        </button>
      ) : null}
      <p className="zp-hint zq-cost">
        {index.totals.names} {index.totals.names === 1 ? "name" : "names"} for {index.totals.named} of {index.totals.places} places.
        {" "}Keeping it cost {cents(index.cost.todayUsd)} today and {cents(week)} this week
        {index.cost.firstBuildUsd > 0 ? `, ${cents(index.cost.firstBuildUsd)} to build` : ""}.
      </p>
    </>
  )
}
