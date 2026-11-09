// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { HostedUsageCard } from "./hosted-usage-card"

afterEach(cleanup)

describe("HostedUsageCard", () => {
  it("shows only customer-safe included usage", () => {
    render(
      <HostedUsageCard
        productName="Zenod"
        usage={{
          percentageUsed: 84,
          state: "warn",
          resetsAt: "2026-09-01T00:00:00.000Z",
        }}
      />
    )

    expect(screen.getByText("Included usage")).not.toBeNull()
    expect(screen.getByText("Nearly used")).not.toBeNull()
    expect(screen.getByText("84% used")).not.toBeNull()
    expect(
      screen.queryByText(/OpenRouter|token|audio minute|\$1\.67|model/i)
    ).toBeNull()
  })

  it("explains a fail-closed provider outage without inventing a balance", () => {
    render(
      <HostedUsageCard
        productName="Zenod"
        usage={{ percentageUsed: null, state: "unavailable", resetsAt: null }}
      />
    )

    expect(screen.getByText("Usage temporarily unavailable")).not.toBeNull()
    expect(screen.getByText(/processing waits safely/i)).not.toBeNull()
    expect(screen.queryByText(/processing paused/i)).toBeNull()
    expect(screen.queryByRole("progressbar")).toBeNull()
  })

  it("states that raw evidence survives a managed-processing pause", () => {
    render(
      <HostedUsageCard
        productName="Zenod"
        usage={{
          percentageUsed: 100,
          state: "paused",
          resetsAt: "2026-09-01T00:00:00.000Z",
        }}
      />
    )

    expect(screen.getByText("Managed processing paused")).not.toBeNull()
    expect(screen.getByText(/raw evidence remains safe/i)).not.toBeNull()
  })

  it("does not promise a reset when managed access has no provider reset timestamp", () => {
    render(
      <HostedUsageCard
        productName="Zenod"
        usage={{ percentageUsed: 100, state: "paused", resetsAt: null }}
      />
    )

    expect(
      screen.getByText(/resumes when managed access is restored/i)
    ).not.toBeNull()
    expect(screen.queryByText(/resumes after the reset/i)).toBeNull()
  })
})

describe("HostedUsageCard breakdown (EPIC-7 T3)", () => {
  it("shows AI and messages usage separately, as percentages only", () => {
    render(
      <HostedUsageCard
        productName="Zenod"
        usage={{
          percentageUsed: 40,
          state: "normal",
          resetsAt: "2026-12-01T00:00:00.000Z",
          breakdown: {
            ai: { spendUsd: 1.67, allowanceUsd: 4, percentageUsed: 42, paused: false },
            channel: { usedUnits: 12_000, allowanceUnits: 1_000_000, percentageUsed: 1, paused: false },
          },
        }}
      />
    )

    expect(screen.getByText("AI processing: 42% of this month's allowance")).not.toBeNull()
    expect(screen.getByText("Messages and voice: 1% of this month's allowance")).not.toBeNull()
    expect(screen.queryByText(/\$|1\.67|units|OpenRouter/i)).toBeNull()
  })

  it("omits the AI line when no AI allowance is set", () => {
    render(
      <HostedUsageCard
        productName="Zenod"
        usage={{
          percentageUsed: 0,
          state: "normal",
          resetsAt: "2026-12-01T00:00:00.000Z",
          breakdown: {
            ai: { spendUsd: 3.2, allowanceUsd: null, percentageUsed: null, paused: false },
            channel: { usedUnits: 0, allowanceUnits: 1_000_000, percentageUsed: 0, paused: false },
          },
        }}
      />
    )

    expect(screen.queryByText(/AI processing/)).toBeNull()
    expect(screen.getByText("Messages and voice: 0% of this month's allowance")).not.toBeNull()
  })

  it("says why processing stopped when the AI allowance is used up", () => {
    render(
      <HostedUsageCard
        productName="Zenod"
        usage={{
          percentageUsed: 70,
          state: "paused",
          resetsAt: "2026-12-01T00:00:00.000Z",
          breakdown: {
            ai: { spendUsd: 4, allowanceUsd: 4, percentageUsed: 100, paused: true },
            channel: { usedUnits: 5_000, allowanceUnits: 1_000_000, percentageUsed: 1, paused: false },
          },
        }}
      />
    )

    // EPIC-14 S10: only answers stop at the allowance; notes are still kept and filed.
    expect(screen.getByText("Answers paused, notes still kept")).not.toBeNull()
    expect(screen.getByText(/still kept and filed/)).not.toBeNull()
    expect(screen.getByText("AI processing: this month's allowance is used up")).not.toBeNull()
    expect(screen.getByText(/used this month's AI allowance/i)).not.toBeNull()
    expect(screen.getByText(/tells you so in WhatsApp/i)).not.toBeNull()
  })
})
