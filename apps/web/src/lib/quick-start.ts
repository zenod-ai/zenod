import * as React from "react"

// EPIC-26 S15: the tester quick start (GET /api/console/quick-start). One shared copy for the card and the
// header pill, refreshed while the app is open so a step ticks within seconds of the tester doing it.

export type QuickStartStepId = "whatsapp" | "assistant" | "keep" | "found" | "helper"

export type QuickStart = {
  steps: { id: QuickStartStepId; done: boolean; at: string | null }[]
  score: number
  total: 4 | 5
  helpersOpen: boolean
  complete: boolean
  hidden: boolean
  assistantName: string | null
  helperName: string | null
}

const REFRESH_MS = 15_000

let current: QuickStart | null = null
let loading: Promise<void> | null = null
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<(value: QuickStart | null) => void>()

function publish(value: QuickStart | null) {
  current = value
  for (const listener of listeners) listener(value)
}

export async function refreshQuickStart(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    try {
      const response = await fetch("/api/console/quick-start", { credentials: "same-origin" })
      if (!response.ok) return
      publish((await response.json()) as QuickStart)
    } catch {
      // The card simply waits for the next refresh.
    } finally {
      loading = null
    }
  })()
  return loading
}

export async function setQuickStartHidden(hidden: boolean): Promise<void> {
  if (current) publish({ ...current, hidden })
  await fetch("/api/console/quick-start/hide", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hidden }),
  }).catch(() => undefined)
  await refreshQuickStart()
}

/** The quick start, shared by every component that shows it; refreshed while it is still open. */
export function useQuickStart(): QuickStart | null {
  const [value, setValue] = React.useState<QuickStart | null>(current)
  React.useEffect(() => {
    listeners.add(setValue)
    if (!current) void refreshQuickStart()
    if (!timer) {
      timer = setInterval(() => {
        if (document.visibilityState !== "visible") return
        if (current && (current.complete || current.hidden)) return
        void refreshQuickStart()
      }, REFRESH_MS)
    }
    const onFocus = () => void refreshQuickStart()
    window.addEventListener("focus", onFocus)
    return () => {
      listeners.delete(setValue)
      window.removeEventListener("focus", onFocus)
      if (listeners.size === 0 && timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }, [])
  return value
}

/** Test seam: forget the shared copy. */
export function resetQuickStartForTests() {
  current = null
  loading = null
  if (timer) clearInterval(timer)
  timer = null
  listeners.clear()
}
