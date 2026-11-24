// E7-S35: a WhatsApp reply links to one note (`/#memory?path=…`). Signing in leaves the page for the OAuth provider and
// comes back to `/` without the hash, so the note's place is kept for this tab and put back once, after sign-in.
const KEY = "zenod.returnHash"

function isNoteHash(hash: string | null | undefined): hash is string {
  return typeof hash === "string" && hash.startsWith("#memory?")
}

/** Called as a sign-in button leaves: remember the note the visitor came to open. */
export function keepReturnHash(): void {
  try {
    if (isNoteHash(window.location.hash)) window.sessionStorage.setItem(KEY, window.location.hash)
  } catch {
    // Storage off (private mode): the visitor lands on the home view instead.
  }
}

/** Called once on load: put the remembered note back when the page came back without one. */
export function restoreReturnHash(): void {
  try {
    const saved = window.sessionStorage.getItem(KEY)
    if (!saved) return
    window.sessionStorage.removeItem(KEY)
    if (!window.location.hash && isNoteHash(saved)) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${saved}`)
    }
  } catch {
    // Storage off: nothing to restore.
  }
}
