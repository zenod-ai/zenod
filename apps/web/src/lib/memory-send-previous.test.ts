import { afterEach, describe, expect, it, vi } from "vitest"

import { lastQuestion, sendToMemory, withTimeZone } from "@/lib/memory-chat"

// EPIC-14 S29 round 2: "I meant …" corrects the question before it, so Send carries that question.
describe("Send carries the question before it", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("posts the previous question with the message, and nothing extra without one", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      const route = { action: "answer", keep: null, question: "q", by: "rules" }
      return new Response(`${JSON.stringify({ type: "route", route })}\n${JSON.stringify({ type: "done" })}\n`, { status: 200 })
    }))
    await sendToMemory("I meant my preferences in buying gardening", { previous: "What are my preferences?" })
    await sendToMemory("What are my preferences?")
    expect(bodies).toEqual([
      withTimeZone({ message: "I meant my preferences in buying gardening", previous: "What are my preferences?" }),
      withTimeZone({ message: "What are my preferences?" }),
    ])
  })

  // E12-S38: the browser's time zone goes with the question, so "yesterday" is the person's day.
  it("sends the browser's time zone with the message", async () => {
    const zone = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone: "America/Mexico_City" } as Intl.ResolvedDateTimeFormatOptions)
    const bodies: unknown[] = []
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      const route = { action: "answer", keep: null, question: "q", by: "rules" }
      return new Response(`${JSON.stringify({ type: "route", route })}\n${JSON.stringify({ type: "done" })}\n`, { status: 200 })
    }))
    await sendToMemory("What did I say yesterday?")
    zone.mockRestore()
    expect(bodies).toEqual([{ message: "What did I say yesterday?", timeZone: "America/Mexico_City" }])
  })

  it("takes the question the last reply answered", () => {
    const route = (question: string | null) => ({ action: question ? "answer" : "keep", keep: question ? null : "x", question, by: "model" }) as never
    expect(lastQuestion([])).toBeNull()
    expect(lastQuestion([
      { id: 1, kind: "message", text: "What are my preferences?" },
      { id: 2, kind: "reply", message: "What are my preferences?", route: route("What are my preferences?"), keep: null, result: null },
      { id: 3, kind: "message", text: "next" },
    ] as never)).toBe("What are my preferences?")
    expect(lastQuestion([{ id: 1, kind: "reply", message: "Ana's birthday is May 3", route: route(null), keep: null, result: null }] as never)).toBeNull()
  })
})
