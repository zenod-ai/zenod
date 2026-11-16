// A first sign-in that lands in the app is a completed sign-up (ZAL-A13,
// agent_team E85-S1). The server marks that redirect with ?signed_up=1; tell
// the alpha9 counter once with one 1x1 image (no cookie, nothing about the
// person), then drop the marker from the address.
export const SIGNUP_COUNTER_URL =
  "https://signup.alpha9.io/api/public/pv?h=zenod.dev&e=signup"
export const SIGNUP_MARKER_PARAM = "signed_up"
// E7-S7: the sign-up steps alpha9's counter reads for "what they do" on
// cloud.zenod.dev: signin_open (the sign-in page shown), oauth_google and
// oauth_github (a sign-in button pressed) and signup_sent (the account made).
// The step's name and this host only, no cookie.
export const STEP_COUNTER_URL =
  "https://signup.alpha9.io/api/public/pv?e=step&h=cloud.zenod.dev&k="

export type SignupStep =
  | "signin_open"
  | "oauth_google"
  | "oauth_github"
  | "signup_sent"

type Ping = (url: string) => void

const imagePing: Ping = (url) => {
  const image = new Image(1, 1)
  image.referrerPolicy = "no-referrer"
  image.src = url
}

/** A step pressed on a link: keepalive lets the call finish while the browser leaves the page. */
const leavingPing: Ping = (url) => {
  try {
    void fetch(url, {
      mode: "no-cors",
      keepalive: true,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }).catch(() => undefined)
  } catch {
    imagePing(url)
  }
}

export function stepUrl(step: SignupStep): string {
  return `${STEP_COUNTER_URL}${step}`
}

export function countStep(step: SignupStep, ping: Ping = imagePing): void {
  ping(stepUrl(step))
}

export function countLeavingStep(
  step: SignupStep,
  ping: Ping = leavingPing,
): void {
  ping(stepUrl(step))
}

export function countCompletedSignup(ping: Ping = imagePing): boolean {
  const url = new URL(window.location.href)
  if (url.searchParams.get(SIGNUP_MARKER_PARAM) !== "1") return false
  ping(SIGNUP_COUNTER_URL)
  ping(stepUrl("signup_sent"))
  url.searchParams.delete(SIGNUP_MARKER_PARAM)
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  )
  return true
}
