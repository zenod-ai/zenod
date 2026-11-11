// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { MemoryPersonas } from "@/components/memory-personas"
import type { Persona, PersonaList } from "@/lib/personas"

// EPIC-14 S4: the persona catalog. Each persona shows its purpose, its skills, its own switch
// and cadence; once on, its last run and spend and Run now.

const SKILLS = [{ id: "read", label: "Read your memory" }, { id: "write-own-folder", label: "Write only into its own folder" }]
const RECAP: Persona = {
  id: "weekly-recap", name: "Weekly recap", purpose: "A short recap of your week.", brief: "Reads the last 7 days.",
  cadence: { every: "week" }, defaultCadence: { every: "week" }, schedule: "Weekly, Sunday night",
  skills: SKILLS, enabled: true,
  limits: { maxSteps: 6, maxRunUsd: 0.02, maxMonthUsd: 0.1 },
  budget: { personaUsd: 0, personaCapUsd: 0.1, totalUsd: 0, totalCapUsd: 1 },
  nextWakeAt: "2026-11-15T02:00:00Z", lastRun: null, runs: [],
}
const LOOPS: Persona = {
  ...RECAP, id: "open-loops", name: "Open loops finder", purpose: "Finds things you said you would do.", enabled: false, nextWakeAt: null,
  skills: [...SKILLS, { id: "ask", label: "Ask you a question" }],
}
const list = (persona: Persona, ...more: Persona[]): PersonaList => ({ personas: [persona, ...more], budget: { spentUsd: persona.budget.totalUsd, capUsd: 1 }, skills: SKILLS })
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
    expect(screen.getByText("Write only into its own folder")).toBeTruthy()
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

  it("shows helpers off and still building for a tester, with every control disabled (EPIC-23 U7)", async () => {
    mockFetch(() => ({ ...list({ ...RECAP, enabled: false, nextWakeAt: null }, LOOPS), building: true }))
    render(<MemoryPersonas />)
    expect(await screen.findByTestId("helpers-building")).toBeTruthy()
    expect(screen.getByTestId("helpers-building-note").textContent).toMatch(/switched off while we finish building them/)
    for (const toggle of screen.getAllByRole("switch")) {
      expect(toggle.getAttribute("aria-checked")).toBe("false")
      expect((toggle as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.getAllByText("Still building: off for now.")).toHaveLength(2)
    expect(screen.queryByRole("button", { name: "Run now" })).toBeNull()
    for (const talk of screen.getAllByRole("button", { name: "Talk it over" })) expect((talk as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows no still-building label to an account whose helpers run", async () => {
    mockFetch(() => list(RECAP))
    render(<MemoryPersonas />)
    expect(await screen.findByText("Weekly recap")).toBeTruthy()
    expect(screen.queryByTestId("helpers-building")).toBeNull()
  })
})

describe("MemoryPersonas catalog", () => {
  it("lists personas with their own switch, cadence and skills; one that is off has no Run now", async () => {
    mockFetch(() => list(RECAP, LOOPS))
    render(<MemoryPersonas />)
    expect(await screen.findByText("Open loops finder")).toBeTruthy()
    expect(screen.getByText("Finds things you said you would do.")).toBeTruthy()
    expect(screen.getAllByRole("switch").map((s) => s.getAttribute("aria-checked"))).toEqual(["true", "false"])
    expect(screen.getAllByRole("button", { name: "Run now" })).toHaveLength(1)
    expect(screen.getByRole("list", { name: "Open loops finder's skills" }).textContent).toContain("Ask you a question")
    expect(screen.getByText("Off: it never runs until you switch it on.")).toBeTruthy()
    expect(screen.getByText(/1 of 2 on/)).toBeTruthy()
  })

  it("switches one persona on and sets its cadence to every few days", async () => {
    const calls = mockFetch((_url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.enabled === true) return list(RECAP, { ...LOOPS, enabled: true })
      if (body.cadence?.every === "days") return list(RECAP, { ...LOOPS, enabled: true, cadence: body.cadence, schedule: `Every ${body.cadence.days} days, at night` })
      return list(RECAP, LOOPS)
    })
    render(<MemoryPersonas />)
    fireEvent.click(await screen.findByRole("switch", { name: "Open loops finder off" }))
    await waitFor(() => expect(screen.getByRole("switch", { name: "Open loops finder on" })).toBeTruthy())
    expect(calls.at(-1)).toMatchObject({ url: "/api/console/personas/open-loops", method: "POST", body: { enabled: true } })
    fireEvent.change(screen.getByLabelText("How often Open loops finder runs"), { target: { value: "days" } })
    expect(await screen.findByText("Every 3 days, at night")).toBeTruthy()
    expect(calls.at(-1)).toMatchObject({ url: "/api/console/personas/open-loops", body: { cadence: { every: "days", days: 3 } } })
    expect(screen.getByLabelText("Days between Open loops finder runs")).toBeTruthy()
  })

  // EPIC-14 S35: asking the Team desk shows only with a Team connection, off by default.
  it("switches asking the team on for a helper that can ask, only when the team is connected", async () => {
    const asking = { ...LOOPS, askTeam: false }
    const calls = mockFetch((_url, init) =>
      init?.method === "POST" ? { ...list({ ...asking, askTeam: true }), teamConnected: true } : { ...list(asking, RECAP), teamConnected: true }
    )
    render(<MemoryPersonas />)
    const box = (await screen.findByRole("checkbox", { name: /Ask your team how things connect/ })) as HTMLInputElement
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    await waitFor(() => expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true))
    expect(calls.at(-1)).toMatchObject({ url: "/api/console/personas/open-loops", method: "POST", body: { askTeam: true } })
    cleanup()
    mockFetch(() => list(asking))
    render(<MemoryPersonas />)
    expect(await screen.findByText("Open loops finder")).toBeTruthy()
    expect(screen.queryByRole("checkbox")).toBeNull()
  })
})
