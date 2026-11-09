// EPIC-12 E12-S27: check where Zenod filed things, on your own tree. The server lists the filings
// Zenod was least sure of first; "Right place" confirms one, "Wrong place" moves it under the page
// you pick, and Undo puts it back. Each change is one commit in your vault; no model runs.

export type PlacementReviewItem = {
  path: string
  title: string
  /** `Working › Zenod › Page` */
  place: string
  /** How sure Zenod was, 0–100; null for an older page it marked unsure before confidences. */
  confidence: number | null
  provisional: boolean
  evidenceRef: string | null
  date: string | null
}

export type PlacementReview = {
  items: PlacementReviewItem[]
  total: number
  scored: number
  low: number
  checked: { confirmed: number; moved: number }
  recent: Array<{
    id: string
    ts: string
    title: string
    from: string | null
    to: string
    undone: boolean
  }>
}

export type PlacementReviewResponse =
  | ({ status: "ready" } & PlacementReview)
  | { status: "empty" }

export type PlacementChange = {
  id: string
  action: "confirm" | "move" | "undo"
  page: string
  title: string
  before: string
  after: string
  revision: string
}

/** Below this Zenod was unsure; the list shows these first anyway. */
export const LOW_CONFIDENCE = 60

export class MemoryReviewError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const FRIENDLY: Record<string, string> = {
  unauthorized: "Your session ended. Sign in again to see your memory.",
  no_account: "Your Zenod account is not active yet.",
  "tenant unavailable": "Your workspace is starting. Try again in a moment.",
}

async function request<T>(
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string; message?: string })
    | null
  if (!response.ok) {
    throw new MemoryReviewError(
      response.status,
      data?.message ??
        (data?.error ? FRIENDLY[data.error] : undefined) ??
        "Something went wrong. Try again."
    )
  }
  return data as T
}

export function readPlacementReview(): Promise<PlacementReviewResponse> {
  return request("/api/console/memory-review?limit=40")
}

/** `to` set: move the page under it. `to` null: it is in the right place. */
export function placeMemory(
  page: string,
  to: string | null
): Promise<PlacementChange> {
  return request("/api/console/memory-place", { page, to: to ?? "" })
}

export function undoPlacement(id: string): Promise<PlacementChange> {
  return request("/api/console/memory-place/undo", { id })
}

export function confidenceLabel(confidence: number | null): string {
  return confidence === null ? "not scored" : `${confidence}% sure`
}
