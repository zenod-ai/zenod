// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { MemoryChat } from "@/components/memory-chat"
import { memoryPathFromHash, plainWikilinks } from "@/lib/memory-chat"

// EPIC-12 E12-S1: the hosted app's chat with your memory. Asking saves nothing; only Keep does.

const ANSWER = {
  question: "Who fixes the boiler?",
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

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: Array<{ url: string; body: unknown }> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      const result = handler(url, init) as { status?: number; body: unknown }
      return new Response(JSON.stringify(result.body), { status: result.status ?? 200 })
    })
  )
  return calls
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("MemoryChat (E12-S1)", () => {
  it("answers from memory with the top memories, their percentages and links, and saves nothing", async () => {
    const calls = mockFetch(() => ({ body: ANSWER }))
    render(<MemoryChat />)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Who fixes the boiler?" } })
    fireEvent.click(screen.getByRole("button", { name: "Ask" }))

    expect((await screen.findByTestId("memory-answer")).textContent).toContain("Ana, the plumber from your plumber note.")
    const used = screen.getByLabelText("Memories used")
    expect(used.textContent).toContain("Top 2 memories for this question")
    expect(used.textContent).toContain("92%")
    expect(used.textContent).toContain("71%")
    expect(screen.getByRole("link", { name: "Plumber" }).getAttribute("href")).toBe("/#memory?path=Home%2FPlumber.md")
    expect(screen.getAllByRole("link", { name: "GitHub" })[0].getAttribute("href")).toBe("https://github.com/o/vault/blob/main/Home/Plumber.md")
    expect(used.textContent).toContain("cited")

    expect(calls.map((call) => call.url)).toEqual(["/api/console/memory-chat"])
    expect(calls[0]!.body).toEqual({ question: "Who fixes the boiler?" })
    expect(screen.getByText(/Asking saves nothing/)).toBeTruthy()
  })

  it("keeps an answer only when Keep is tapped, once", async () => {
    const calls = mockFetch((url) =>
      url === "/api/console/memory-chat"
        ? { body: ANSWER }
        : { status: 202, body: { id: "job-1", status: "saved", reply: "Saved.", notePath: "Home/Plumber.md", noteUrl: "https://github.com/o/vault/blob/main/Home/Plumber.md" } }
    )
    render(<MemoryChat />)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Who fixes the boiler?" } })
    fireEvent.click(screen.getByRole("button", { name: "Ask" }))
    await screen.findByTestId("memory-answer")
    expect(calls.filter((call) => call.url.includes("memory-keep"))).toHaveLength(0)

    const keep = screen.getAllByRole("button", { name: "Keep" }).find((button) => button.closest(".zp-turn"))!
    fireEvent.click(keep)
    expect(await screen.findByText(/Kept ✓/)).toBeTruthy()
    const keeps = calls.filter((call) => call.url === "/api/console/memory-keep")
    expect(keeps).toHaveLength(1)
    expect(keeps[0]!.body).toEqual({ kind: "answer", question: ANSWER.question, answer: ANSWER.answer })
    expect((screen.getByRole("button", { name: "Kept" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("keeps a typed note with the composer's Keep, without asking", async () => {
    const calls = mockFetch(() => ({ status: 202, body: { id: "job-2", status: "saved", reply: "Saved.", notePath: null, noteUrl: null } }))
    render(<MemoryChat />)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "The plumber is Ana." } })
    fireEvent.click(screen.getByRole("button", { name: "Keep" }))
    await waitFor(() => expect(screen.getByText(/Kept ✓/)).toBeTruthy())
    expect(calls).toEqual([{ url: "/api/console/memory-keep", body: { kind: "note", content: "The plumber is Ana." } }])
  })

  it("shows the AI allowance reason instead of an answer", async () => {
    mockFetch(() => ({ status: 429, body: { error: "ai_allowance_exhausted", code: "ai_allowance_exhausted", message: "You have used this month's AI allowance." } }))
    render(<MemoryChat />)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "anything" } })
    fireEvent.click(screen.getByRole("button", { name: "Ask" }))
    expect((await screen.findByRole("alert")).textContent).toContain("You have used this month's AI allowance.")
  })
})

describe("memory chat helpers (E12-S1)", () => {
  it("reads a memory link's path and renders wikilinks as words", () => {
    expect(memoryPathFromHash("#memory?path=Home%2FPlumber.md")).toBe("Home/Plumber.md")
    expect(memoryPathFromHash("#memory")).toBeNull()
    expect(memoryPathFromHash("#vault")).toBeNull()
    expect(plainWikilinks("see [[Home/Plumber]] and [[A/B.md#x|that]]")).toBe("see Plumber and that")
  })
})
