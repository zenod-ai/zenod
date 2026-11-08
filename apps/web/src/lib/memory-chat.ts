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
export function presentAnswer(text: string): string {
  return plainWikilinks(text)
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
