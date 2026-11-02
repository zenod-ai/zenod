// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SubscribersPanel, type Subscriber } from "./subscribers-panel"

// agent_team E42-S22: the Subscribers tab as mockup round 2 shows it (connected
// teams with status, last delivery, retries, log, Send test, Remove with a
// confirm; a webhook added by hand with its secret shown once).

const now = new Date()
const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString()

const epicTeam: Subscriber = {
  id: "sub_team",
  name: "Epic Team",
  kind: "agent_team",
  product: "EpicSpine",
  url: "https://team.alpha9.io/api/hooks/zenod/c1",
  event: "voice_note.captured",
  enabled: true,
  created_at: "2026-11-02T10:00:00.000Z",
  created_by: { name: "Jordi Montes", email: "jordi@alpha9.io" },
  via: "oauth",
  last_delivery: { at: iso(120_000), ok: true, http_status: 200, duration_ms: 312, attempts: 1, test: false, error: null },
  retries_24h: 0,
  deliveries: [
    { id: "dlv_1", event_id: "evt_1", type: "voice_note.captured", test: false, at: iso(120_000), ok: true, status: "delivered", http_status: 200, duration_ms: 312, attempts: 1, error: null },
    { id: "dlv_2", event_id: "evt_2", type: "voice_note.captured", test: true, at: iso(3_600_000), ok: true, status: "delivered", http_status: 200, duration_ms: 400, attempts: 1, error: null },
  ],
}

const epicSocial: Subscriber = {
  ...epicTeam,
  id: "sub_social",
  name: "Epic Social",
  url: "https://team.alpha9.io/api/hooks/zenod/c2",
  last_delivery: { at: iso(120_000), ok: false, http_status: 502, duration_ms: 600, attempts: 3, test: false, error: "HTTP 502" },
  retries_24h: 2,
  deliveries: [],
}

type Route = (init?: RequestInit) => { status: number; body?: unknown }

function mockFetch(routes: Record<string, Route>) {
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${path}`
    const route = routes[key]
    if (!route) throw new Error(`unexpected ${key}`)
    const { status, body } = route(init)
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  })
  vi.stubGlobal("fetch", fetch)
  return fetch
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("SubscribersPanel", () => {
  it("lists connected teams with what they get, status, last delivery, retries and a delivery log", async () => {
    mockFetch({ "GET /api/subscribers": () => ({ status: 200, body: { subscribers: [epicTeam, epicSocial] } }) })
    render(<SubscribersPanel />)
    expect(await screen.findByText("Epic Team")).toBeTruthy()
    expect(screen.getByText(/This is the only place connected teams and webhooks appear/)).toBeTruthy()
    expect(screen.getByText("2 subscribers")).toBeTruthy()
    expect(screen.getAllByText("agent team · EpicSpine")).toHaveLength(2)
    expect(screen.getAllByText("team.alpha9.io · connected by Jordi Montes with Sign in with Zenod, 2026-11-02 · reads new voice notes only")).toHaveLength(2)
    expect(screen.getAllByRole("switch", { checked: true })).toHaveLength(2)
    expect(screen.getAllByText("200 OK").length).toBe(3) // last delivery + two log rows
    expect(screen.getByText("failed, 502")).toBeTruthy()
    expect(screen.getByText("Delivery log, last 7 days (2)")).toBeTruthy()
    expect(screen.getByText("test")).toBeTruthy()
  })

  it("pauses a subscriber with its switch", async () => {
    const fetch = mockFetch({
      "GET /api/subscribers": () => ({ status: 200, body: { subscribers: [epicTeam] } }),
      "PATCH /api/subscribers/sub_team": (init) => ({ status: 200, body: { subscription: { ...epicTeam, enabled: JSON.parse(String(init?.body)).enabled } } }),
    })
    render(<SubscribersPanel />)
    fireEvent.click(await screen.findByRole("switch", { name: "Epic Team on or off" }))
    await waitFor(() => expect(screen.getByRole("switch", { name: "Epic Team on or off" }).getAttribute("aria-checked")).toBe("false"))
    expect(fetch).toHaveBeenCalledWith("/api/subscribers/sub_team", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: false }) }))
  })

  it("sends a test and says how it went", async () => {
    mockFetch({
      "GET /api/subscribers": () => ({ status: 200, body: { subscribers: [epicSocial] } }),
      "POST /api/subscribers/sub_social/test": () => ({ status: 200, body: { delivery: { id: "dlv_t", event_id: "evt_t", type: "voice_note.captured", test: true, at: now.toISOString(), ok: true, status: "delivered", http_status: 200, duration_ms: 400, attempts: 1, error: null }, subscription: { ...epicSocial, last_delivery: { at: now.toISOString(), ok: true, http_status: 200, duration_ms: 400, attempts: 1, test: true, error: null } } } }),
    })
    render(<SubscribersPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "Send test" }))
    expect(await screen.findByText("Delivered to Epic Social: 200 OK in 0.4 s")).toBeTruthy()
  })

  it("asks before Remove, names what is lost, and removes", async () => {
    const fetch = mockFetch({
      "GET /api/subscribers": () => ({ status: 200, body: { subscribers: [epicTeam, epicSocial] } }),
      "DELETE /api/subscribers/sub_social": () => ({ status: 204 }),
    })
    render(<SubscribersPanel />)
    const row = (await screen.findByText("Epic Social")).closest("li")!
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }))
    expect(within(row).getByText("Remove Epic Social? It stops getting voice notes and loses its read access.")).toBeTruthy()
    fireEvent.click(within(row).getByRole("button", { name: "Keep it" }))
    expect(fetch).not.toHaveBeenCalledWith("/api/subscribers/sub_social", expect.anything())
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }))
    fireEvent.click(within(row).getByRole("button", { name: "Remove Epic Social" }))
    await waitFor(() => expect(screen.queryByText("Epic Social")).toBeNull())
    expect(screen.getByText("1 subscriber")).toBeTruthy()
  })

  it("adds a webhook by hand, shows the signing secret once with the test result, and lists it", async () => {
    const created: Subscriber = { ...epicTeam, id: "sub_n8n", name: "My n8n flow", kind: "webhook", product: null, via: "manual", url: "https://hooks.example.com/zenod", last_delivery: null, deliveries: [] }
    const fetch = mockFetch({
      "GET /api/subscribers": () => ({ status: 200, body: { subscribers: [] } }),
      "POST /api/subscribers": () => ({ status: 201, body: { subscription: created, signing_secret: "whsec_onlyonce", test_delivery: { id: "dlv_x", event_id: "evt_x", type: "voice_note.captured", test: true, at: now.toISOString(), ok: true, status: "delivered", http_status: 200, duration_ms: 300, attempts: 1, error: null } } }),
    })
    render(<SubscribersPanel />)
    expect(await screen.findByText(/Nothing is subscribed yet/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Endpoint URL"), { target: { value: "https://hooks.example.com/zenod" } })
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My n8n flow" } })
    fireEvent.click(screen.getByRole("button", { name: "Create webhook" }))
    expect(await screen.findByText("Your signing secret. Zenod shows it only this once.")).toBeTruthy()
    expect(screen.getByText("whsec_onlyonce")).toBeTruthy()
    expect(screen.getByText("Test event sent: https://hooks.example.com/zenod answered 200 OK in 0.3 s.")).toBeTruthy()
    expect(screen.getByText("My n8n flow")).toBeTruthy()
    expect(screen.getByText("webhook")).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith("/api/subscribers", expect.objectContaining({ method: "POST", body: JSON.stringify({ url: "https://hooks.example.com/zenod", event: "voice_note.captured", name: "My n8n flow" }) }))
    fireEvent.click(screen.getByRole("button", { name: "I have saved it" }))
    expect(screen.queryByText("whsec_onlyonce")).toBeNull()
  })

  it("shows why Zenod refused a URL", async () => {
    mockFetch({
      "GET /api/subscribers": () => ({ status: 200, body: { subscribers: [] } }),
      "POST /api/subscribers": () => ({ status: 422, body: { error: { code: "url_not_allowed", message: "URL must use HTTPS." } } }),
    })
    render(<SubscribersPanel />)
    fireEvent.change(await screen.findByLabelText("Endpoint URL"), { target: { value: "http://hooks.example.com/zenod" } })
    fireEvent.click(screen.getByRole("button", { name: "Create webhook" }))
    expect((await screen.findByRole("alert")).textContent).toBe("URL must use HTTPS.")
  })
})
