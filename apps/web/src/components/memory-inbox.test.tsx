// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"

import { MemoryInbox } from "@/components/memory-inbox"
import { setInboxCount, useInboxCount, type InboxItem } from "@/lib/inbox"

// EPIC-14 S2: the inbox screen. Questions answer with the recommendation first, findings are
// read and put away, desk jobs show their step, then what changed with See the changes and Undo.

const base = {
  body: null, options: [], recommended: null, answer: null, links: [], step: null, result: null,
  replies: [], followUpOf: null, example: false, createdAt: "2026-11-08T18:00:00Z", updatedAt: "2026-11-08T18:00:00Z", seenAt: null, needsYou: true,
}

const QUESTION: InboxItem = {
  ...base, id: "q1", kind: "question", status: "open", from: "Librarian", title: "Join Flat and Apartment?",
  options: [{ id: "join", label: "Yes, join" }, { id: "keep", label: "No, keep both" }], recommended: "join",
}
const FINDING: InboxItem = {
  ...base, id: "f1", kind: "finding", status: "open", from: "Night reader", title: "Dentist three times, never booked.",
  links: [{ label: "Health", path: "Areas/Health.md" }],
}
const WORKING: InboxItem = { ...base, id: "j1", kind: "job", status: "working", from: "Memory desk", title: "Clean up Travel", step: "Reading 41 memories" }
const DONE: InboxItem = {
  ...base, id: "j2", kind: "job", status: "done", from: "Memory desk", title: "Split two topics",
  result: { summary: "Two topics again.", changes: [{ what: "Hull moved", before: "Both", after: "Boat repair" }], search: { query: "boat", before: ["Both"], after: ["Boat repair"] } },
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
  act(() => setInboxCount(0))
})

describe("MemoryInbox", () => {
  it("answers a question and saves the answer", async () => {
    const calls = mockFetch((url) => {
      if (url === "/api/console/inbox") return { items: [QUESTION, FINDING], needsYou: 2 }
      if (url === "/api/console/inbox/q1/answer") {
        return { item: { ...QUESTION, status: "answered", needsYou: false, answer: { optionId: "join", label: "Yes, join", at: "x", savedJobId: "job-1" } }, needsYou: 1 }
      }
      return { needsYou: 1 }
    })
    render(<MemoryInbox />)
    expect(await screen.findByText("Join Flat and Apartment?")).toBeTruthy()
    expect(screen.getByText("Recommended: Yes, join")).toBeTruthy()
    const buttons = screen.getAllByRole("button").map((button) => button.textContent)
    expect(buttons.indexOf("Yes, join")).toBeLessThan(buttons.indexOf("No, keep both"))
    fireEvent.click(screen.getByRole("button", { name: "Yes, join" }))
    expect(await screen.findByText(/You answered “Yes, join”\. Saved as a memory\./)).toBeTruthy()
    expect(calls.find((call) => call.url === "/api/console/inbox/q1/answer")).toMatchObject({ method: "POST", body: { option: "join" } })
  })

  it("opens a finding's memories and marks what it showed as seen", async () => {
    const calls = mockFetch((url) => (url === "/api/console/inbox" ? { items: [FINDING], needsYou: 1 } : { needsYou: 0 }))
    render(<MemoryInbox />)
    fireEvent.click(await screen.findByRole("button", { name: "Open the memories" }))
    expect(screen.getByRole("link", { name: "Health" }).getAttribute("href")).toBe("#memory?path=Areas%2FHealth.md")
    await waitFor(() => expect(calls.some((call) => call.url === "/api/console/inbox/seen")).toBe(true), { timeout: 3000 })
    expect(calls.find((call) => call.url === "/api/console/inbox/seen")!.body).toEqual({ ids: ["f1"] })
  })

  it("shows a job working, then its changes and a confirmed Undo", async () => {
    const calls = mockFetch((url) => {
      if (url === "/api/console/inbox") return { items: [WORKING, DONE], needsYou: 2 }
      if (url === "/api/console/inbox/j2/undo") return { item: { ...DONE, status: "undone", needsYou: false }, needsYou: 1 }
      return { needsYou: 1 }
    })
    render(<MemoryInbox />)
    expect(await screen.findByText("Reading 41 memories")).toBeTruthy()
    expect(screen.getByText("Working")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "See the changes" }))
    expect(screen.getByText("Hull moved")).toBeTruthy()
    expect(screen.getByText("Searching “boat”")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    expect(calls.some((call) => call.url.endsWith("/undo"))).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Yes, put it back" }))
    expect(await screen.findByText(/Your memory is as it was before the job\./)).toBeTruthy()
  })

  it("offers examples when empty", async () => {
    const calls = mockFetch((url) =>
      url === "/api/console/inbox"
        ? { items: [], needsYou: 0 }
        : { items: [{ ...FINDING, example: true }], needsYou: 1 }
    )
    render(<MemoryInbox />)
    fireEvent.click(await screen.findByRole("button", { name: "Show examples" }))
    expect(await screen.findByText("Example")).toBeTruthy()
    expect(calls.find((call) => call.url === "/api/console/inbox/examples")).toMatchObject({ method: "POST" })
    expect(screen.getByRole("button", { name: "Clear examples" })).toBeTruthy()
  })

  it("keeps the tab's count from the server", async () => {
    mockFetch(() => ({ needsYou: 3 }))
    const { result } = renderHook(() => useInboxCount(true))
    await waitFor(() => expect(result.current).toBe(3))
  })
})

describe("one chat, and a reply box on every card (EPIC-14 S2 round 3)", () => {
  it("has no chat of its own: a new desk job is written in the Chat tab", async () => {
    mockFetch(() => ({ items: [], needsYou: 0 }))
    render(<MemoryInbox />)
    await waitFor(() => expect(screen.getByText("Nothing needs you.")).toBeTruthy())
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.queryByRole("button", { name: "Start the job" })).toBeNull()
    expect(screen.getByRole("link", { name: "Chat" }).getAttribute("href")).toBe("#chat")
  })

  it("answers a question in words, sends feedback to a persona, and a follow-up to the desk", async () => {
    let items: InboxItem[] = [QUESTION, FINDING, DONE]
    const followUp: InboxItem = { ...WORKING, id: "j9", title: "Also move Yard quotes", step: "Waiting for its turn", followUpOf: { id: "j2", title: "Split two topics" } }
    const calls = mockFetch((url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      const at = "2026-11-08T18:05:00Z"
      if (url === "/api/console/inbox/q1/reply") {
        const item = { ...QUESTION, status: "answered" as const, answer: { optionId: "words", label: body.text, at, savedJobId: "s1" }, replies: [{ kind: "answer" as const, text: body.text, at }] }
        items = items.map((x) => (x.id === "q1" ? item : x))
        return { item, needsYou: 2 }
      }
      if (url === "/api/console/inbox/f1/reply") {
        const item = { ...FINDING, replies: [{ kind: "feedback" as const, text: body.text, at, readAt: null }] }
        items = items.map((x) => (x.id === "f1" ? item : x))
        return { item, needsYou: 1 }
      }
      if (url === "/api/console/inbox/j2/reply") {
        const item = { ...DONE, replies: [{ kind: "followup" as const, text: body.text, at, followUpItemId: "j9" }] }
        items = [followUp, ...items.map((x) => (x.id === "j2" ? item : x))]
        return { item, followUp, needsYou: 1 }
      }
      return { items, needsYou: items.length }
    })
    render(<MemoryInbox />)
    await waitFor(() => expect(screen.getByText("Join Flat and Apartment?")).toBeTruthy())
    expect(screen.getAllByRole("textbox")).toHaveLength(3)

    fireEvent.change(screen.getByRole("textbox", { name: "Or answer in your own words" }), { target: { value: "Join them under Home" } })
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }))
    await waitFor(() => expect(screen.getByText(/You answered “Join them under Home”/)).toBeTruthy())
    expect(calls.find((call) => call.url === "/api/console/inbox/q1/reply")).toMatchObject({ method: "POST", body: { text: "Join them under Home" } })

    fireEvent.change(screen.getByRole("textbox", { name: /Feedback for Night reader/ }), { target: { value: "I booked it yesterday" } })
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }))
    await waitFor(() => expect(screen.getByText("Sent. Night reader reads it on its next run.")).toBeTruthy())
    expect(screen.getByText("“I booked it yesterday”")).toBeTruthy()
    expect((screen.getByRole("textbox", { name: /Feedback for Night reader/ }) as HTMLTextAreaElement).value).toBe("")

    const desk = screen.getAllByRole("textbox", { name: "A follow-up or a correction for the desk" })
    fireEvent.change(desk[desk.length - 1]!, { target: { value: "Also move Yard quotes" } })
    fireEvent.click(screen.getAllByRole("button", { name: "Send to the desk" }).at(-1)!)
    await waitFor(() => expect(screen.getByText(/Sent to the desk as a new job/)).toBeTruthy())
    expect(screen.getByText("Also move Yard quotes")).toBeTruthy()
    expect(screen.getByText(/Follows up/)).toBeTruthy()
  })

  // EPIC-14 S26: the suggestion card.
  const SUGGESTION: InboxItem = {
    ...base, id: "s1", kind: "suggestion", status: "open", from: "Topic gardener",
    title: "Join Flat hunt into Moving to Valencia: they are the same thing.",
    action: "Join the topic Flat hunt into Moving to Valencia.", done: null,
    links: [{ label: "Flat hunt", path: "Areas/Flat hunt.md" }],
  }

  it("a suggestion: Do it runs one desk job shown on the card, and Undo puts it back", async () => {
    const job: InboxItem = { ...WORKING, id: "j9", title: "Join the topic Flat hunt into Moving to Valencia.", step: "Waiting for its turn", followUpOf: { id: "s1", title: SUGGESTION.title } }
    const accepted = { ...SUGGESTION, status: "accepted" as const, needsYou: false, done: { jobItemId: "j9", action: SUGGESTION.action!, changed: false, at: "x" } }
    const finished: InboxItem = { ...job, status: "done", step: null, result: { summary: "14 memories moved.", changes: [{ what: "Flat hunt moved", before: "Root", after: "Moving to Valencia" }] } }
    const calls = mockFetch((url) => {
      if (url === "/api/console/inbox") return { items: [SUGGESTION], needsYou: 1 }
      if (url === "/api/console/inbox/s1/do") return { item: accepted, followUp: finished, needsYou: 1 }
      if (url === "/api/console/inbox/j9/undo") return { item: { ...finished, status: "undone", needsYou: false }, needsYou: 0 }
      return { needsYou: 1 }
    })
    render(<MemoryInbox />)
    expect(await screen.findByText(SUGGESTION.title)).toBeTruthy()
    expect(screen.getByText("Suggestion")).toBeTruthy()
    expect(screen.getByText("Join the topic Flat hunt into Moving to Valencia.")).toBeTruthy()
    for (const name of ["Do it", "Change", "Not now", "Talk it over", "Your feedback"]) expect(screen.getByRole("button", { name })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Do it" }))
    expect(await screen.findByText("Done on the memory desk. 14 memories moved.")).toBeTruthy()
    expect(calls.find((call) => call.url === "/api/console/inbox/s1/do")).toMatchObject({ method: "POST", body: {} })
    // The job is on the suggestion's card, not a second card.
    expect(screen.getAllByTestId("inbox-item")).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    fireEvent.click(screen.getByRole("button", { name: "Yes, put it back" }))
    expect(await screen.findByText(/Undone\. Your memory is as it was before\./)).toBeTruthy()
  })

  it("a suggestion: Change runs your words, Not now keeps an optional reason", async () => {
    const calls = mockFetch((url) => {
      if (url === "/api/console/inbox") return { items: [SUGGESTION, { ...SUGGESTION, id: "s2", title: "Split Boat" }], needsYou: 2 }
      if (url === "/api/console/inbox/s1/do") return { item: { ...SUGGESTION, status: "accepted", needsYou: false, done: { jobItemId: null, action: "Join them, keep Ruzafa apart.", changed: true, at: "x" } }, needsYou: 1 }
      if (url === "/api/console/inbox/s2/not-now") return { item: { ...SUGGESTION, id: "s2", title: "Split Boat", status: "declined", needsYou: false, replies: [{ kind: "notnow", text: "Not this month", at: "2026-11-08T18:00:00Z", readAt: null }] }, needsYou: 0 }
      return { needsYou: 1 }
    })
    render(<MemoryInbox />)
    await screen.findByText(SUGGESTION.title)
    fireEvent.click(screen.getAllByRole("button", { name: "Change" })[0]!)
    const box = screen.getByRole("textbox", { name: "The change, in your words" }) as HTMLTextAreaElement
    expect(box.value).toBe(SUGGESTION.action)
    fireEvent.change(box, { target: { value: "Join them, keep Ruzafa apart." } })
    fireEvent.click(screen.getByRole("button", { name: "Do it like this" }))
    expect(await screen.findByText("You changed it first: “Join them, keep Ruzafa apart.”")).toBeTruthy()
    expect(calls.find((call) => call.url === "/api/console/inbox/s1/do")!.body).toEqual({ action: "Join them, keep Ruzafa apart." })

    fireEvent.click(screen.getByRole("button", { name: "Not now" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Why not now" }), { target: { value: "Not this month" } })
    fireEvent.click(screen.getByRole("button", { name: "Put it away" }))
    expect(await screen.findByText("“Not this month”")).toBeTruthy()
    expect(screen.getByText("Sent. Topic gardener reads it on its next run.")).toBeTruthy()
    expect(calls.find((call) => call.url === "/api/console/inbox/s2/not-now")!.body).toEqual({ reason: "Not this month" })
  })

  it("a suggestion: Your feedback opens a text box with a microphone, and the note is kept for the helper", async () => {
    const calls = mockFetch((url) => {
      if (url === "/api/console/inbox") return { items: [SUGGESTION], needsYou: 1 }
      if (url === "/api/console/inbox/s1/reply") return { item: { ...SUGGESTION, replies: [{ kind: "feedback", text: "Good idea, but later", at: "2026-11-08T18:00:00Z", readAt: null }] }, needsYou: 1 }
      return { needsYou: 1 }
    })
    render(<MemoryInbox />)
    await screen.findByText(SUGGESTION.title)
    expect(screen.queryByRole("textbox")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Your feedback" }))
    expect(screen.getByRole("button", { name: "Leave a voice note" })).toBeTruthy()
    fireEvent.change(screen.getByRole("textbox", { name: /Your feedback for Topic gardener/ }), { target: { value: "Good idea, but later" } })
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }))
    expect(await screen.findByText("“Good idea, but later”")).toBeTruthy()
    expect(screen.getByText("Sent. Topic gardener reads it on its next run.")).toBeTruthy()
    expect(calls.find((call) => call.url === "/api/console/inbox/s1/reply")!.body).toEqual({ text: "Good idea, but later" })
    // The suggestion still waits for Do it, Change or Not now.
    expect(screen.getByRole("button", { name: "Do it" })).toBeTruthy()
  })
})
