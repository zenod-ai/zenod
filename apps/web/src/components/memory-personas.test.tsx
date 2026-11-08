// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { MemoryPersonas } from "@/components/memory-personas"
import type { Persona, PersonaList } from "@/lib/personas"

// EPIC-14 S4: the personas screen. Each persona shows what it may do, its last run and spend,
// a switch, and Run now.

const RECAP: Persona = {
  id: "weekly-recap", name: "Weekly recap", brief: "Reads the last 7 days.", schedule: "Weekly, Sunday night",
  permissions: ["Reads your memory", "Writes only into its own folder"], enabled: true,
  limits: { maxSteps: 6, maxRunUsd: 0.02, maxMonthUsd: 0.1 },
  budget: { personaUsd: 0, personaCapUsd: 0.1, totalUsd: 0, totalCapUsd: 1 },
  nextWakeAt: "2026-11-15T02:00:00Z", lastRun: null, runs: [],
}
const list = (persona: Persona): PersonaList => ({ personas: [persona], budget: { spentUsd: persona.budget.totalUsd, capUsd: 1 } })
const RAN: Persona = {
  ...RECAP, budget: { ...RECAP.budget, personaUsd: 0.0004, totalUsd: 0.0004 },
  lastRun: {
    id: "r1", personaId: "weekly-recap", trigger: "manual", status: "done", startedAt: "2026-11-08T18:00:00Z", endedAt: "2026-11-08T18:00:04Z",
    steps: 4, modelCalls: 1, inputTokens: 1200, outputTokens: 90, costUsd: 0.0004, summary: "Read 12 memories, wrote a recap and posted one finding",
    inboxItemIds: ["f1"], revision: "abc",
  },
}

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify(handler(url, init)), { status: 200 })
    })
  )
  return calls
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("MemoryPersonas", () => {
  it("shows a persona that has not run, runs it now and shows the run with its cost", async () => {
    const calls = mockFetch((url) => {
      if (url.endsWith("/run")) return { run: RAN.lastRun, ...list(RAN) }
      if (url.includes("/inbox/count")) return { needsYou: 1 }
      return list(RECAP)
    })
    render(<MemoryPersonas />)
    expect(await screen.findByText("Weekly recap")).toBeTruthy()
    expect(screen.getByText("Has not run yet.")).toBeTruthy()
    expect(screen.getByText("Writes only into its own folder")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Run now" }))
    expect(await screen.findByText(/Read 12 memories/)).toBeTruthy()
    expect(screen.getByText(/1290 tokens/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "in your inbox" }).getAttribute("href")).toBe("#inbox")
    expect(calls.some((call) => call.url === "/api/console/personas/weekly-recap/run" && call.method === "POST")).toBe(true)
  })

  it("switches a persona off", async () => {
    const calls = mockFetch((_url, init) => (init?.method === "POST" ? list({ ...RECAP, enabled: false, nextWakeAt: null }) : list(RECAP)))
    render(<MemoryPersonas />)
    const toggle = await screen.findByRole("switch")
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false"))
    expect(calls.at(-1)).toMatchObject({ url: "/api/console/personas/weekly-recap", method: "POST", body: { enabled: false } })
  })
})
