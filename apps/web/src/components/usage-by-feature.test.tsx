// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { UsageByFeatureCard, type UsageView } from "./usage-by-feature"
import { usd } from "@/lib/usage"

afterEach(cleanup)

const feature = (over: Partial<UsageView["features"][number]> & Pick<UsageView["features"][number], "id" | "label">) => ({
  spentUsd: 0,
  shareUsd: null,
  stopsAtUsd: 3,
  state: "ok" as const,
  message: null,
  costs: "costs words",
  atCap: "cap words.",
  ...over,
})

const USAGE: UsageView = {
  allowanceUsd: 3,
  spentUsd: 1.31,
  percentageUsed: 44,
  resetsAt: "2026-12-01T00:00:00.000Z",
  reserveUsd: 0.5,
  features: [
    feature({ id: "filing", label: "Filing your notes", spentUsd: 1.2, stopsAtUsd: 6, atCap: "Never stops at the allowance." }),
    feature({ id: "chat", label: "Chat answers", spentUsd: 0.09 }),
    feature({ id: "personas", label: "Personas", spentUsd: 0.02, shareUsd: 1, stopsAtUsd: 2.5 }),
    feature({ id: "desk", label: "Memory desk jobs", shareUsd: 0.5, stopsAtUsd: 2.5 }),
    feature({ id: "calls", label: "Calls", shareUsd: 1, stopsAtUsd: 2.5, state: "paused", message: "This month's calls have reached their $1.00 limit." }),
  ],
}

describe("UsageByFeatureCard (EPIC-14 S10)", () => {
  it("shows this month's spend by feature against the allowance, in plain words", () => {
    render(<UsageByFeatureCard usage={USAGE} />)
    expect(screen.getByText(/\$1\.31 of \$3\.00 used this month/)).toBeTruthy()
    expect(screen.getByText(/notes are always kept/)).toBeTruthy()
    const filing = within(screen.getByTestId("usage-feature-filing"))
    expect(filing.getByText("Filing your notes")).toBeTruthy()
    expect(filing.getByText(/keeps going past the allowance/)).toBeTruthy()
    const personas = within(screen.getByTestId("usage-feature-personas"))
    expect(personas.getByText(/its own \$1\.00 a month, pauses when less than 50¢ is left/)).toBeTruthy()
    const calls = within(screen.getByTestId("usage-feature-calls"))
    expect(calls.getByText("Paused")).toBeTruthy()
    expect(calls.getByText(/reached their \$1\.00 limit/)).toBeTruthy()
  })

  it("writes small amounts in cents", () => {
    expect(usd(0.004)).toBe("1¢")
    expect(usd(0.5)).toBe("50¢")
    expect(usd(0)).toBe("$0.00")
    expect(usd(3)).toBe("$3.00")
  })
})
