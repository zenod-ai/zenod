import * as React from "react"

// agent_team E42-S22: shared helpers for the Subscribers tab.

export type SubscribersAvailability = "loading" | "on" | "off"

/** JSON call that surfaces the API's `{ error: { code, message } }` as an Error. */
export async function subscribersCall<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  })
  if (response.status === 204) return undefined as T
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: { code?: string; message?: string } })
    | null
  if (!response.ok) {
    const error = new Error(
      body?.error?.message ?? `Request failed (${response.status})`
    ) as Error & { code?: string; status?: number }
    error.code = body?.error?.code
    error.status = response.status
    throw error
  }
  return body as T
}

/** Whether this Zenod has Subscribers switched on (the tab hides otherwise). */
export function useSubscribersAvailability(): SubscribersAvailability {
  const [state, setState] = React.useState<SubscribersAvailability>("loading")
  React.useEffect(() => {
    let live = true
    fetch("/api/subscribers")
      .then((r) => live && setState(r.ok ? "on" : "off"))
      .catch(() => live && setState("off"))
    return () => {
      live = false
    }
  }, [])
  return state
}
