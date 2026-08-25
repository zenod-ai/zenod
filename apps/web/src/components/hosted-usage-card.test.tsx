// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { HostedUsageCard } from "./hosted-usage-card"

afterEach(cleanup)

describe("HostedUsageCard", () => {
  it("shows only customer-safe included usage", () => {
    render(
      <HostedUsageCard
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
        usage={{ percentageUsed: 100, state: "paused", resetsAt: null }}
      />
    )

    expect(screen.getByText(/resumes when managed access is restored/i)).not.toBeNull()
    expect(screen.queryByText(/resumes after the reset/i)).toBeNull()
  })
})
