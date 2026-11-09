// A first sign-in that lands in the app is a completed sign-up (ZAL-A13,
// agent_team E85-S1). The server marks that redirect with ?signed_up=1; tell
// the alpha9 counter once with one 1x1 image (no cookie, nothing about the
// person), then drop the marker from the address.
export const SIGNUP_COUNTER_URL =
  "https://signup.alpha9.io/api/public/pv?h=zenod.dev&e=signup"
export const SIGNUP_MARKER_PARAM = "signed_up"

export function countCompletedSignup(
  ping: (url: string) => void = (url) => {
    const image = new Image(1, 1)
    image.referrerPolicy = "no-referrer"
    image.src = url
  },
): boolean {
  const url = new URL(window.location.href)
  if (url.searchParams.get(SIGNUP_MARKER_PARAM) !== "1") return false
  ping(SIGNUP_COUNTER_URL)
  url.searchParams.delete(SIGNUP_MARKER_PARAM)
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  )
  return true
}
