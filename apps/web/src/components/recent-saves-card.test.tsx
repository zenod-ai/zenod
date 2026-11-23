// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RecentSavesCard } from "./recent-saves-card"

afterEach(cleanup)

describe("RecentSavesCard", () => {
  it("lists each save with its channel, snippet, Saved reply and vault link", () => {
    render(
      <RecentSavesCard
        saves={[
          {
            id: "a",
            savedAt: "2026-11-01T10:00:00.000Z",
            channel: "whatsapp",
            kind: "text",
            channelLabel: "WhatsApp text",
            snippet: "Call the plumber Tuesday",
            status: "saved",
            reply: "Saved — filed to Inbox; the filing question is logged in the note.",
            notePath: "Inbox/filing-1.md",
            noteUrl: "https://github.com/acme/brain/blob/main/Inbox/filing-1.md",
          },
          {
            id: "b",
            savedAt: "2026-11-01T09:00:00.000Z",
            channel: "whatsapp",
            kind: "voice",
            channelLabel: "WhatsApp voice",
            snippet: "Voice note",
            status: "failed",
            reply: "Not saved.",
            notePath: null,
            noteUrl: null,
          },
        ]}
      />
    )

    expect(screen.getByText("Call the plumber Tuesday")).not.toBeNull()
    expect(screen.getByText("WhatsApp text")).not.toBeNull()
    expect(screen.getByText(/filed to Inbox/)).not.toBeNull()
    expect(
      screen.getByRole("link", { name: /Inbox\/filing-1\.md/ })
    ).toHaveProperty(
      "href",
      "https://github.com/acme/brain/blob/main/Inbox/filing-1.md"
    )
    expect(screen.getByText("Not saved.")).not.toBeNull()
  })

  it("explains the empty state in the user's terms", () => {
    render(<RecentSavesCard saves={[]} />)
    expect(screen.getByText(/Nothing saved yet/)).not.toBeNull()
  })

  it("shows the plain label and a real title, and lets the list be filtered by it (EPIC-21 V9)", () => {
    const save = (id: string, label: string) => ({
      id,
      savedAt: "2026-11-23T10:00:00.000Z",
      channel: "connector" as const,
      kind: "voice" as const,
      channelLabel: label,
      label,
      title: "Demo words for the team test",
      snippet: "Demo words for the team test and some more",
      status: "saved" as const,
      reply: "Saved.",
      notePath: null,
      noteUrl: null,
    })
    const onFilter = vi.fn()
    render(
      <RecentSavesCard
        saves={[save("a", "From EpicTeam Chat"), save("b", "Spoken to Zenod")]}
        onFilter={onFilter}
      />
    )
    expect(screen.getAllByText("From EpicTeam Chat").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Demo words for the team test")).toHaveLength(2)
    fireEvent.click(screen.getByRole("button", { name: "From an app" }))
    expect(onFilter).toHaveBeenCalledWith("app")
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("says so when a filter finds nothing", () => {
    render(<RecentSavesCard saves={[]} filter="zenod" onFilter={() => {}} />)
    expect(screen.getByText(/No notes like that yet/)).not.toBeNull()
  })
})
