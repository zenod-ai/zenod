// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
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
})
