// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { MemoryChat } from "@/components/memory-chat"
import { memoryPathFromHash, plainWikilinks, presentAnswer } from "@/lib/memory-chat"

// EPIC-12 E12-S1: the hosted app's chat with your memory; E12-S1b: the answer streams in and is
// checked. EPIC-16 E16-B1: one Send button; Zenod decides to keep, answer or both and says which.

const ANSWER = {
  question: "Who fixes the boiler?",
  answered: true,
  answer: "Ana, the plumber from [[Home/Plumber|your plumber note]].",
  memories: [
    {
      rank: 1, path: "Home/Plumber.md", title: "Plumber", snippet: "Ana", matchPercent: 92,
      url: "https://github.com/o/vault/blob/main/Home/Plumber.md", provider: "github",
      appPath: "/#memory?path=Home%2FPlumber.md", treePath: "Home › Plumber", kind: "page", cited: true,
    },
    {
      rank: 2, path: "Log/2026-11-03.md#^e-1", title: "Voice note", snippet: "boiler", matchPercent: 71,
      url: "https://github.com/o/vault/blob/main/Log/2026-11-03.md", provider: "github",
      appPath: "/#memory?path=Log%2F2026-11-03.md%23%5Ee-1", treePath: "", kind: "log", cited: false,
    },
  ],
  alsoCited: [],
  ms: 1200,
}

const ASK_ROUTE = { action: "answer", keep: null, question: "Who fixes the boiler?", by: "model" }
const SAVED = { id: "job-1", status: "saved", reply: "Saved.", notePath: "Home/Plumber.md", noteUrl: "https://github.com/o/vault/blob/main/Home/Plumber.md" }

/** The one Send route (E16-B1), streamed the way the server does: route, kept, memories, text, answer, done. */
function streamFetch() {
  const calls: Array<{ url: string; body: unknown }> = []
  let push: (line: unknown) => void = () => {}
  let close: () => void = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      push = (line) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))
      close = () => controller.close()
    },
  })
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.startsWith("/api/console/memory-keep/")) return new Response(JSON.stringify(SAVED), { status: 200 })
      return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } })
    })
  )
  return { calls, push: (line: unknown) => push(line), close: () => close() }
}

function sendText(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } })
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("MemoryChat one Send (E16-B1)", () => {
  it("has one Send button and no Ask or Keep", () => {
    render(<MemoryChat />)
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull()
    expect(screen.getByText(/A question is never saved/)).toBeTruthy()
  })

  it("answers a question from memory, says nothing was saved, and offers no Keep", async () => {
    const live = streamFetch()
    render(<MemoryChat />)
    sendText("Who fixes the boiler?")
    live.push({ type: "route", route: ASK_ROUTE })
    live.push({ type: "memories", memories: ANSWER.memories.map((memory) => ({ ...memory, cited: false })) })
    expect((await screen.findByLabelText("Memories used")).textContent).toContain("92%")
    live.push({ type: "text", text: "Ana fixes it [1]." })
    const draft = await screen.findByTestId("memory-draft")
    expect(draft.textContent).toContain("Checking against your memories")
    live.push({ type: "answer", answer: { ...ANSWER, answer: "Ana fixes it [1].", checkedBy: "quoted" } })
    live.push({ type: "done" })
    live.close()

    const answer = await screen.findByTestId("memory-answer")
    expect(answer.textContent).toContain("Checked against your memories")
    expect(screen.getByRole("link", { name: "1" }).getAttribute("href")).toBe("/#memory?path=Home%2FPlumber.md")
    expect(screen.getByTestId("memory-did").textContent).toBe("Answered from your memory · nothing saved")
    expect(screen.queryByTestId("memory-kept")).toBeNull()
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull()
    expect(live.calls).toEqual([{ url: "/api/console/memory-send/stream", body: { message: "Who fixes the boiler?" } }])
   // E12-S13: the answered memories open lit up in the graph, with their percentages.
    const show = screen.getByTestId("show-in-graph").getAttribute("href")!
    expect(show.startsWith("/#graph?")).toBe(true)
    expect(decodeURIComponent(show)).toContain("m=92:Home/Plumber.md|")
  })

  it("keeps a statement and says so with a link to the saved memory", async () => {
    const live = streamFetch()
    render(<MemoryChat />)
    sendText("The plumber is Ana.")
    live.push({ type: "route", route: { action: "keep", keep: "The plumber is Ana.", question: null, by: "model" } })
    expect((await screen.findByTestId("memory-kept")).textContent).toContain("Saving to your memory")
    live.push({ type: "kept", receipt: { ...SAVED, status: "saving" } })
    live.push({ type: "done" })
    live.close()
    expect((await screen.findByTestId("memory-did")).textContent).toBe("Kept as a new memory")
    expect(screen.getByTestId("memory-kept").textContent).toContain("Filing it")
    await waitFor(() => expect(screen.getByTestId("memory-kept").textContent).toContain("Saved to your memory ✓"), { timeout: 4_000 })
    expect(screen.getByRole("link", { name: "Open it" }).getAttribute("href")).toBe(SAVED.noteUrl)
    expect(screen.getByTestId("memory-did").textContent).toBe("Kept as a new memory")
    expect(screen.queryByTestId("memory-answer")).toBeNull()
  }, 10_000)

  it("keeps the told part of a mixed message, shows which part, and answers the question", async () => {
    const live = streamFetch()
    render(<MemoryChat />)
    sendText("Remember Ana's phone is 699 120 334, and who fixes the boiler?")
    live.push({ type: "route", route: { action: "both", keep: "Ana's phone is 699 120 334", question: "who fixes the boiler?", by: "model" } })
    live.push({ type: "kept", receipt: SAVED })
    live.push({ type: "memories", memories: ANSWER.memories })
    live.push({ type: "answer", answer: ANSWER })
    live.push({ type: "done" })
    live.close()
    expect((await screen.findByTestId("memory-answer")).textContent).toContain("Ana, the plumber")
    const kept = screen.getByTestId("memory-kept").textContent
    expect(kept).toContain("Saved to your memory ✓")
    expect(kept).toContain("“Ana's phone is 699 120 334”")
    expect(screen.getByTestId("memory-did").textContent).toBe("Kept the new part and answered the question")
  })

  it("shows the plain no-confident-answer note in place of an unchecked draft", async () => {
    const live = streamFetch()
    render(<MemoryChat />)
    sendText("Who fixes the boiler?")
    live.push({ type: "route", route: ASK_ROUTE })
    live.push({ type: "memories", memories: ANSWER.memories })
    live.push({ type: "text", text: "Maybe Bob [2]." })
    await screen.findByTestId("memory-draft")
    const note = "No confident answer: Zenod could not check its answer against your memories, so it is not shown. The closest memories are below."
    live.push({ type: "answer", answer: { ...ANSWER, answered: false, answer: note, checkedBy: "quoted" } })
    live.push({ type: "done" })
    live.close()
    const answer = await screen.findByTestId("memory-answer")
    expect(answer.textContent).toContain("No confident answer")
    expect(answer.textContent).not.toContain("Maybe Bob")
  })

  it("shows the AI allowance reason, before or during a send", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "ai_allowance_exhausted", code: "ai_allowance_exhausted", message: "You have used this month's AI allowance." }), { status: 429 })))
    render(<MemoryChat />)
    sendText("anything")
    expect((await screen.findByRole("alert")).textContent).toContain("You have used this month's AI allowance.")
    cleanup()
    const live = streamFetch()
    render(<MemoryChat />)
    sendText("anything")
    live.push({ type: "route", route: ASK_ROUTE })
    live.push({ type: "error", status: 429, code: "ai_allowance_exhausted", message: "You have used this month's AI allowance." })
    live.close()
    expect((await screen.findByRole("alert")).textContent).toContain("You have used this month's AI allowance.")
  })
})

describe("memory chat helpers (E12-S1)", () => {
  it("reads a memory link's path and renders wikilinks as words", () => {
    expect(memoryPathFromHash("#memory?path=Home%2FPlumber.md")).toBe("Home/Plumber.md")
    expect(memoryPathFromHash("#memory")).toBeNull()
    expect(memoryPathFromHash("#vault")).toBeNull()
    expect(plainWikilinks("see [[Home/Plumber]] and [[A/B.md#x|that]]")).toBe("see Plumber and that")
    expect(presentAnswer("Source summary:\nQuotes were 4,000 euros.\n[Log/2026-10-31.md#^e-c64e3b](https://github.com/o/v/blob/x/Log/2026-10-31.md)"))
      .toBe("Quotes were 4,000 euros.\n[2026-10-31](https://github.com/o/v/blob/x/Log/2026-10-31.md)")
    // E12-S1b: a numbered citation links to its memory in the app; an unknown number stays as written.
    expect(presentAnswer("Ana [1][3].", [{ rank: 1, appPath: "/#memory?path=a" }])).toBe("Ana [1](/#memory?path=a)[3].")
    // Labels that carry meaning stay.
    expect(presentAnswer("Raw source report (not independently verified current state):\nAna.")).toContain("Raw source report")
  })
})

describe("MemoryChat and the memory desk (EPIC-14 S3)", () => {
  const JOB = "Idealista and Poly-Maker are tangled, please split them"
  const STARTED = { id: "j9", title: JOB, status: "working", step: "Waiting for its turn" }

  it("a job message goes to the memory desk and points at the inbox; nothing is saved", async () => {
    const live = streamFetch()
    render(<MemoryChat />)
    sendText(JOB)
    live.push({ type: "route", route: { action: "job", keep: null, question: null, job: JOB, by: "model" } })
    live.push({ type: "desk", item: STARTED })
    live.push({ type: "done" })
    live.close()
    await waitFor(() => expect(screen.getByTestId("memory-did").textContent).toBe("Passed to the memory desk · nothing saved"))
    expect(screen.getByTestId("memory-desk").textContent).toContain("I passed it to the memory desk")
    expect(screen.getByRole("link", { name: "Open the inbox" }).getAttribute("href")).toBe("#inbox")
    expect(screen.queryByTestId("memory-kept")).toBeNull()
  })

  it("when unsure it asks, and Do it as a job starts the desk without keeping anything", async () => {
    const live = streamFetch()
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const inner = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/console/memory-desk/jobs") return new Response(JSON.stringify({ item: STARTED, needsYou: 1 }), { status: 202 })
      if (url === "/api/console/memory-keep") return new Response(JSON.stringify({ ...SAVED, status: "saving" }), { status: 202 })
      return inner(url, init)
    })
    render(<MemoryChat />)
    sendText("clean up my notes")
    live.push({ type: "route", route: { action: "unsure", keep: null, question: null, job: "clean up my notes", by: "rules" } })
    live.push({ type: "done" })
    live.close()
    await waitFor(() => expect(screen.getByTestId("memory-did").textContent).toBe("Waiting for you: keep it, or do it as a job"))
    fireEvent.click(screen.getByRole("button", { name: "Do it as a job" }))
    await waitFor(() => expect(screen.getByRole("link", { name: "Open the inbox" })).toBeTruthy())
    expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/console/memory-desk/jobs" && JSON.parse(String((init as RequestInit).body)).request === "clean up my notes")).toBe(true)
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/console/memory-keep")).toBe(false)
  })

  it("when unsure, Keep it keeps the message as a memory and starts no job", async () => {
    const live = streamFetch()
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const inner = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/console/memory-keep") return new Response(JSON.stringify(SAVED), { status: 202 })
      return inner(url, init)
    })
    render(<MemoryChat />)
    sendText("move my notes about the boat")
    live.push({ type: "route", route: { action: "unsure", keep: null, question: null, job: "move my notes about the boat", by: "model" } })
    live.push({ type: "done" })
    live.close()
    fireEvent.click(await screen.findByRole("button", { name: "Keep it" }))
    await waitFor(() => expect(screen.getByTestId("memory-did").textContent).toBe("Kept as a new memory"))
    expect(screen.queryByTestId("memory-desk")).toBeNull()
    const keep = fetchMock.mock.calls.find(([url]) => url === "/api/console/memory-keep")!
    expect(JSON.parse(String((keep[1] as RequestInit).body))).toEqual({ kind: "note", content: "move my notes about the boat" })
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/console/memory-desk/jobs")).toBe(false)
  })

  it("Ask the desk starts a job from what is written, and says what to write when it is empty", async () => {
    const calls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${url} ${String(init?.body ?? "")}`)
      return new Response(JSON.stringify({ item: { ...STARTED, title: "Move boiler notes under House" }, needsYou: 1 }), { status: 202 })
    }))
    render(<MemoryChat />)
    fireEvent.click(screen.getByRole("button", { name: "Ask the desk" }))
    expect(screen.getByTestId("memory-desk-hint").textContent).toContain("Write what the desk should do")
    expect(calls).toEqual([])
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Move boiler notes under House" } })
    fireEvent.click(screen.getByRole("button", { name: "Ask the desk" }))
    await waitFor(() => expect(screen.getByTestId("memory-desk").textContent).toContain("Move boiler notes under House"))
    expect(calls).toEqual(['/api/console/memory-desk/jobs {"request":"Move boiler notes under House"}'])
  })
})
