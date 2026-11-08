// EPIC-12 E12-S1: the web app's chat with your memory (hosted). Asking saves nothing;
// only Keep files something (packages/server/src/memoryChat.ts).

export type MemoryChatMemory = {
  rank: number
  path: string
  title: string
  snippet: string
  matchPercent: number
  url: string
  provider: "github" | "google_drive" | string
  appPath: string
  treePath: string
  cited: boolean
}

export type MemoryChatSource = {
  /** The memory's number in the answer's citations, when it has one. */
  rank?: number
  path: string
  title: string
  url: string
  appPath: string
}

export type MemoryChatAnswer = {
  question: string
  /** False: no checked answer; `answer` is a plain note and the app offers no Keep. */
  answered: boolean
  answer: string
  memories: MemoryChatMemory[]
  alsoCited: MemoryChatSource[]
  ms: number
  /** "quoted": every citation's quote was found in its memory (E12-S1b); "ask": the ask loop's check. */
  checkedBy?: "quoted" | "ask"
}

export type MemoryChatStreamHandlers = {
  /** The top memories, before the answer is written. */
  onMemories?: (memories: MemoryChatMemory[]) => void
  /** The answer as it is written, before it is checked. */
  onText?: (text: string) => void
}

export type MemoryKeepReceipt = {
  id: string
  status: "saved" | "saving" | "failed"
  reply: string
  notePath: string | null
  noteUrl: string | null
}

export type MemoryNote = {
  path: string
  body: string
  url: string
  provider: string
}

export class MemoryChatError extends Error {
  readonly status: number
  readonly code: string | undefined
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = "MemoryChatError"
    this.status = status
    this.code = code
  }
}

const FRIENDLY: Record<string, string> = {
  unauthorized: "Your session ended. Sign in again to ask your memory.",
  no_account: "Your Zenod account is not active yet.",
  vault_not_ready: "Connect your vault first, then ask again.",
  "tenant unavailable": "Your workspace is starting. Try again in a moment.",
  "memory chat unavailable": "Zenod could not answer just now. Try again in a moment.",
  "keep unavailable": "Zenod could not keep that just now. Try again in a moment.",
  not_found: "That memory is not in your vault.",
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string; code?: string; message?: string })
    | null
  if (!response.ok) {
    const code = data?.code ?? data?.error
    const message =
      data?.message ??
      (code ? FRIENDLY[code] : undefined) ??
      "Something went wrong. Try again."
    throw new MemoryChatError(response.status, message, code)
  }
  return data as T
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

export function askMemory(question: string): Promise<MemoryChatAnswer> {
  return request("/api/console/memory-chat", json({ question }))
}

type StreamEvent =
  | { type: "memories"; memories: MemoryChatMemory[] }
  | { type: "text"; text: string }
  | { type: "answer"; answer: MemoryChatAnswer }
  | { type: "error"; status: number; error?: string; code?: string; message?: string }

/**
 * Ask with the answer streamed (E12-S1b): the memories arrive at once, the answer as it is written,
 * then the checked answer. Falls back to the one-shot request where the browser cannot stream.
 */
export async function askMemoryStream(
  question: string,
  handlers: MemoryChatStreamHandlers = {}
): Promise<MemoryChatAnswer> {
  if (typeof ReadableStream === "undefined" || typeof TextDecoder === "undefined")
    return askMemory(question)
  const response = await fetch("/api/console/memory-chat/stream", json({ question }))
  if (response.status === 404 && !response.headers.get("content-type")?.includes("json"))
    return askMemory(question)
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => null)) as {
      error?: string
      code?: string
      message?: string
    } | null
    const code = data?.code ?? data?.error
    throw new MemoryChatError(
      response.status,
      data?.message ?? (code ? FRIENDLY[code] : undefined) ?? "Something went wrong. Try again.",
      code
    )
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let final: MemoryChatAnswer | null = null
  const handle = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as StreamEvent
    if (event.type === "memories") handlers.onMemories?.(event.memories)
    else if (event.type === "text") handlers.onText?.(event.text)
    else if (event.type === "answer") final = event.answer
    else if (event.type === "error") {
      const code = event.code ?? event.error
      throw new MemoryChatError(
        event.status,
        event.message ?? (code ? FRIENDLY[code] : undefined) ?? "Something went wrong. Try again.",
        code
      )
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: !done })
    let newline = buffer.indexOf("\n")
    while (newline >= 0) {
      handle(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf("\n")
    }
    if (done) break
  }
  handle(buffer)
  if (!final) throw new MemoryChatError(503, FRIENDLY["memory chat unavailable"]!)
  return final
}

export function keepNote(content: string): Promise<MemoryKeepReceipt> {
  return request("/api/console/memory-keep", json({ kind: "note", content }))
}

export function keepAnswer(
  question: string,
  answer: string
): Promise<MemoryKeepReceipt> {
  return request(
    "/api/console/memory-keep",
    json({ kind: "answer", question, answer })
  )
}

export function keepStatus(id: string): Promise<MemoryKeepReceipt> {
  return request(`/api/console/memory-keep/${encodeURIComponent(id)}`)
}

export function readMemoryNote(path: string): Promise<MemoryNote> {
  return request(`/api/console/memory-note?path=${encodeURIComponent(path)}`)
}

/** The vault path in a memory link's hash (`#memory?path=…`), or null. */
export function memoryPathFromHash(hash: string): string | null {
  if (!hash.startsWith("#memory?")) return null
  const path = new URLSearchParams(hash.slice("#memory?".length)).get("path")
  return path?.trim() ? path.trim() : null
}

/** `[[Notes/Garden shed|the shed]]` → `the shed`; answers read as plain prose in the app. */
export function plainWikilinks(text: string): string {
  return text.replace(/!?\[\[([^[\]\n]+?)\]\]/g, (_raw, body: string) => {
    const [target = "", alias] = body.split("|", 2)
    if (alias?.trim()) return alias.trim()
    const name = target.split("#")[0]!.split("/").pop() ?? target
    return name.replace(/\.md$/i, "").trim()
  })
}

/** A vault path as a short name: `Log/2026-10-31.md#^e-1` → `2026-10-31`. */
export function memoryName(path: string): string {
  return (path.split("#")[0]!.split("/").pop() ?? path).replace(/\.md$/i, "")
}

/**
 * How the app shows an answer (the text itself stays the verified answer shared with MCP):
 * wikilinks as words, a citation link named by its memory instead of its raw vault path, and no
 * bare "Source summary:" label (the summary is followed by the source it summarises).
 */
export function presentAnswer(
  text: string,
  cites: ReadonlyArray<{ rank?: number; appPath: string }> = []
): string {
  const byRank = new Map(cites.filter((c) => c.rank).map((c) => [c.rank!, c.appPath]))
  return plainWikilinks(text)
    // E12-S1b: "[2]" cites memory 2 of the list; it links to that memory in the app.
    .replace(/\[(\d{1,2})\](?!\()/g, (raw, n: string) =>
      byRank.has(Number(n)) ? `[${n}](${byRank.get(Number(n))})` : raw
    )
    .replace(/^Source summary:\s*\n/gm, "")
    .replace(
      /\[([^\]\n]+?\.md(?:#[^\]\n]*)?)\]\((https?:\/\/[^)\s]+)\)/g,
      (_raw, path: string, url: string) => `[${memoryName(path)}](${url})`
    )
}

export function vaultLabel(provider: string): string {
  return provider === "google-drive" || provider === "google_drive"
    ? "Drive"
    : "GitHub"
}
