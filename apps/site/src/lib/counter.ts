// Visits and sign-ups for agent_team's 30-day experiment (ZAL-A13, E85-S1).
// One 1x1 image per page load from the alpha9 counter. No cookie, and nothing
// about the visitor is sent: the host, the path, the campaign id from the link
// (?s=) and the referring host only. The CSP allows this one origin.
export const COUNTER_URL = "https://signup.alpha9.io/api/public/pv"
export const COUNTER_HOST = "zenod.dev"
/** Set by the server on the redirect after a first sign-in. */
export const SIGNUP_MARKER_PARAM = "signed_up"
const CAMPAIGN_KEY = "zenod.campaign"

type Ping = (url: string) => void

const imagePing: Ping = (url) => {
  const image = new Image(1, 1)
  image.referrerPolicy = "no-referrer"
  image.src = url
}

function campaign(search: string, storage: Pick<Storage, "getItem" | "setItem"> | null): string | null {
  const fromLink = new URLSearchParams(search).get("s")?.trim().slice(0, 64) || null
  try {
    if (fromLink) storage?.setItem(CAMPAIGN_KEY, fromLink)
    return fromLink ?? storage?.getItem(CAMPAIGN_KEY) ?? null
  } catch {
    return fromLink
  }
}

function referringHost(referrer: string, ownHost: string): string | null {
  try {
    const host = new URL(referrer).hostname
    return host && host !== ownHost ? host : null
  } catch {
    return null
  }
}

export function pageViewUrl(location: Pick<Location, "pathname" | "search" | "hostname">, referrer: string, storage: Pick<Storage, "getItem" | "setItem"> | null): string {
  const params = new URLSearchParams({ h: COUNTER_HOST, p: location.pathname || "/" })
  const s = campaign(location.search, storage)
  if (s) params.set("s", s)
  const r = referringHost(referrer, location.hostname)
  if (r) params.set("r", r)
  return `${COUNTER_URL}?${params}`
}

function storedCampaign(storage: Pick<Storage, "getItem"> | null): string | null {
  try {
    return storage?.getItem(CAMPAIGN_KEY) ?? null
  } catch {
    return null
  }
}

export function signupUrl(storage: Pick<Storage, "getItem"> | null): string {
  const params = new URLSearchParams({ h: COUNTER_HOST, e: "signup" })
  const s = storedCampaign(storage)
  if (s) params.set("s", s)
  return `${COUNTER_URL}?${params}`
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Once per page load. A first sign-in also counts once, then the marker is removed from the address. */
export function countPageLoad(ping: Ping = imagePing): void {
  const storage = sessionStore()
  ping(pageViewUrl(window.location, document.referrer, storage))
  const url = new URL(window.location.href)
  if (url.searchParams.get(SIGNUP_MARKER_PARAM) === "1") {
    ping(signupUrl(storage))
    url.searchParams.delete(SIGNUP_MARKER_PARAM)
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
  }
}

/** A testers application kept on the server. */
export function countSignup(ping: Ping = imagePing): void {
  ping(signupUrl(sessionStore()))
}
