// EPIC-24 M2: tell the server when the app breaks for the person using it (a script error, an unhandled
// rejection, an API call that fails with a 5xx or never reaches the server), so the health page turns red
// and the team hears before they do. Only the error class, the page's route, the API route and the HTTP
// status are sent (the server keeps route templates only): never a message, stack, note text or id.

export const CLIENT_ERROR_URL = "/api/public/client-error"
const MAX_PER_PAGE_LOAD = 10

export type ClientErrorReport = {
  kind: "error" | "rejection" | "api" | "network"
  name?: string
  api?: string
  status?: number
}

const sent = new Set<string>()

function enabled(): boolean {
  return typeof window !== "undefined" && import.meta.env.MODE !== "test"
}

export function reportClientError(
  report: ClientErrorReport,
  send: (body: string) => void = (body) => {
    void fetch(CLIENT_ERROR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined)
  },
): boolean {
  if (report.api?.startsWith(CLIENT_ERROR_URL)) return false
  const key = `${report.kind}|${report.name ?? ""}|${report.api ?? ""}|${report.status ?? ""}`
  if (sent.has(key) || sent.size >= MAX_PER_PAGE_LOAD) return false
  sent.add(key)
  try {
    send(JSON.stringify({ ...report, page: window.location.pathname }))
  } catch {
    // reporting must never break the app
  }
  return true
}

/** The class name of whatever was thrown, e.g. `TypeError`; never its message. */
export function errorClass(error: unknown): string {
  return error instanceof Error ? error.name || "Error" : typeof error
}

/** An API call failed on the server (5xx) or never reached it. */
export function reportApiFailure(path: string, status: number | null): void {
  if (!enabled()) return
  if (status === null) reportClientError({ kind: "network", name: "TypeError", api: path })
  else if (status >= 500) reportClientError({ kind: "api", name: "ApiError", api: path, status })
}

export function installClientErrorReporting(): void {
  if (!enabled()) return
  window.addEventListener("error", (event) => {
    reportClientError({ kind: "error", name: errorClass(event.error) })
  })
  window.addEventListener("unhandledrejection", (event) => {
    reportClientError({ kind: "rejection", name: errorClass(event.reason) })
  })
}

/** Tests only: forget what this page load already sent. */
export function resetClientErrorReports(): void {
  sent.clear()
}
