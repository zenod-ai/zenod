import * as React from "react"

import { api } from "@/lib/api"

// EPIC-14 S2: the inbox's client. Shapes mirror packages/server/src/inboxStore.ts.

export type InboxKind = "question" | "finding" | "job"
export type InboxStatus =
  | "open"
  | "answered"
  | "dismissed"
  | "working"
  | "done"
  | "failed"
  | "undone"

/** What you wrote back on a card (EPIC-14 S2 round 3). */
export type InboxReply = {
  kind: "answer" | "feedback" | "followup"
  text: string
  at: string
  savedJobId?: string | null
  followUpItemId?: string | null
  readAt?: string | null
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
