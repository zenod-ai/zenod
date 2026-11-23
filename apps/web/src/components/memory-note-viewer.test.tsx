// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MemoryNoteViewer } from "@/components/memory-note-viewer"

// EPIC-21 V9: opening a captured note shows where it was spoken and its real title.
function mockNote(note: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(note), { status: 200 }))
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("MemoryNoteViewer (EPIC-21 V9)", () => {
  it("shows the label and the real title of a voice note, not the day's file name", async () => {
    mockNote({
      path: "Log/2026-11-23.md",
      body: "Voice note \"x.webm\" ingested.\n\nteam demo words here",
      url: "",
      provider: "github",
      title: "team demo words here",
      label: "From EpicTeam Chat",
    })
    render(<MemoryNoteViewer path="Log/2026-11-23.md#^e-1" onClose={() => {}} />)
    expect((await screen.findByTestId("note-label")).textContent).toBe("From EpicTeam Chat")
    expect(screen.getByRole("heading", { name: "team demo words here" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "2026-11-23" })).toBeNull()
  })

  it("names a note spoken straight to Zenod", async () => {
    mockNote({ path: "Log/2026-11-23.md", body: "words", url: "", provider: "github", title: "words", label: "Spoken to Zenod" })
    render(<MemoryNoteViewer path="Log/2026-11-23.md#^e-2" onClose={() => {}} />)
    expect((await screen.findByTestId("note-label")).textContent).toBe("Spoken to Zenod")
  })

  it("keeps a page as it was: its file name, no label", async () => {
    mockNote({ path: "Notes/Shed.md", body: "# Shed", url: "", provider: "github" })
    render(<MemoryNoteViewer path="Notes/Shed.md" onClose={() => {}} />)
    await screen.findByText("Shed", { selector: "h1" })
    expect(screen.getByRole("heading", { name: "Shed", level: 2 })).toBeTruthy()
    expect(screen.queryByTestId("note-label")).toBeNull()
  })
})
