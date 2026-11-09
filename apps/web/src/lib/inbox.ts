import * as React from "react"

import { api } from "@/lib/api"

// EPIC-14 S2: the inbox's client. Shapes mirror packages/server/src/inboxStore.ts.

export type InboxKind = "question" | "finding" | "job" | "suggestion"
export type InboxStatus =
  | "open"
  | "answered"
  | "dismissed"
  | "working"
  | "done"
  | "failed"
  | "undone"
  /** S26: a suggestion you pressed Do it on. */
  | "accepted"
  /** S26: a suggestion put away with Not now. */
  | "declined"

/** What you wrote back on a card (EPIC-14 S2 round 3; S26 adds Not now's reason and voice notes). */
export type InboxReply = {
  kind: "answer" | "feedback" | "followup" | "notnow"
  text: string
  at: string
  savedJobId?: string | null
  followUpItemId?: string | null
  readAt?: string | null
  /** Feedback left as a voice note: its length. The text is its transcript. */
  voice?: { seconds: number | null } | null
}

export type InboxItem = {
  id: string
  kind: InboxKind
  status: InboxStatus
  from: string
  title: string
  body: string | null
  options: { id: string; label: string }[]
  recommended: string | null
  answer: {
    optionId: string
    label: string
    at: string
    savedJobId: string | null
  } | null
  links: { label: string; path: string }[]
  step: string | null
  result: {
    summary: string
    changes: { what: string; before?: string; after?: string }[]
    search?: { query: string; before: string[]; after: string[] }
    changesUrl?: string
    /** The job was a question: summary is the answer, nothing changed. */
    answer?: boolean
  } | null
  replies: InboxReply[]
  followUpOf: { id: string; title: string } | null
  /** S26 suggestion: the change in words, as the memory desk would run it. */
  action?: string | null
  /** S26 suggestion: what Do it started. */
  done?: {
    jobItemId: string | null
    action: string
    changed: boolean
    at: string
  } | null
  example: boolean
  createdAt: string
  updatedAt: string
  seenAt: string | null
  needsYou: boolean
}

export type InboxList = { items: InboxItem[]; needsYou: number }
export type InboxChange = {
  item: InboxItem
  needsYou: number
  /** A follow-up sent to the desk: the new job it started. */
  followUp?: InboxItem
}

const BASE = "/api/console/inbox"
const itemPath = (id: string, action: string) =>
  `${BASE}/${encodeURIComponent(id)}/${action}`

export const readInbox = () => api<InboxList>(BASE)
export const readInboxCount = () =>
  api<{ needsYou: number }>(`${BASE}/count`)
export const markInboxSeen = (ids: string[]) =>
  api<{ needsYou: number }>(`${BASE}/seen`, { method: "POST", body: { ids } })
export const answerInbox = (id: string, option: string) =>
  api<InboxChange>(itemPath(id, "answer"), {
    method: "POST",
    body: { option },
  })
export const dismissInbox = (id: string) =>
  api<InboxChange>(itemPath(id, "dismiss"), { method: "POST" })
export const undoInbox = (id: string) =>
  api<InboxChange>(itemPath(id, "undo"), { method: "POST" })
/** The reply box on a card: an answer in words, feedback to a persona, or a follow-up for the desk. */
export const replyInbox = (id: string, text: string) =>
  api<InboxChange>(itemPath(id, "reply"), { method: "POST", body: { text } })
/** S26: Do it on a suggestion; `action` is your own words after Change. */
export const doSuggestion = (id: string, action?: string) =>
  api<InboxChange>(itemPath(id, "do"), {
    method: "POST",
    body: action ? { action } : {},
  })
/** S26: Not now on a suggestion, with an optional reason the helper reads next run. */
export const notNowSuggestion = (id: string, reason?: string) =>
  api<InboxChange>(itemPath(id, "not-now"), {
    method: "POST",
    body: reason ? { reason } : {},
  })

/** S26: a voice note as feedback on a card; what is typed in the box goes before the spoken words. */
export async function sendVoiceFeedback(
  id: string,
  audio: Blob,
  seconds: number,
  typed: string
): Promise<InboxChange> {
  const query = typed.trim() ? `?typed=${encodeURIComponent(typed.trim())}` : ""
  const response = await fetch(`${itemPath(id, "voice-feedback")}${query}`, {
    method: "POST",
    headers: {
      "content-type": audio.type || "audio/webm",
      "x-seconds": seconds.toFixed(2),
    },
    body: audio,
  })
  const data = (await response.json().catch(() => null)) as
    | (InboxChange & { message?: string })
    | null
  if (!response.ok || !data?.item)
    throw new Error(
      data?.message ??
        (response.status === 401
          ? "Your session ended. Sign in again."
          : "That voice note could not be sent.")
    )
  return data
}
export const showInboxExamples = () =>
  api<InboxList>(`${BASE}/examples`, { method: "POST" })
export const clearInboxExamples = () =>
  api<InboxList>(`${BASE}/examples`, { method: "DELETE" })

// The tab's count is shared between the tab bar and the inbox screen.
let count = 0
const listeners = new Set<() => void>()

export function setInboxCount(next: number) {
  if (next === count) return
  count = next
  for (const listener of listeners) listener()
}

/** How often the tab's count is refreshed while the app is open. */
export const INBOX_COUNT_POLL_MS = 60_000

/** The inbox tab's count: open questions and anything new. Polls while `enabled`. */
export function useInboxCount(enabled: boolean): number {
  const value = React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => count
  )
  React.useEffect(() => {
    if (!enabled) return
    let stopped = false
    const refresh = () =>
      readInboxCount()
        .then((result) => {
          if (!stopped) setInboxCount(result.needsYou)
        })
        .catch(() => {})
    void refresh()
    const timer = window.setInterval(refresh, INBOX_COUNT_POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [enabled])
  return value
}
