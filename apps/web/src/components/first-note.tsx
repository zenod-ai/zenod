import { MicIcon } from "lucide-react"

import { useQuickStart } from "@/lib/quick-start"

// EPIC-7 E7-S49 (the app half of E7-S37, started by Jordi 28 Nov when he closed E7-S47): the WhatsApp setup
// screens suggest the same first note the WhatsApp welcome asks for (packages/server/src/phylaxWhatsAppWelcome.ts,
// PR #1776), so a tester who links knows what to say and sends it the same day. One suggestion, no new flow.

/** The example the WhatsApp welcome and zenod.dev/start use, word for word. */
export const FIRST_NOTE_EXAMPLE = "This week I'm working on..."

/**
 * One suggested first note. `before`: on the setup screen, while WhatsApp is not linked yet. `after`: on the
 * screen right after linking; it steps aside once Zenod has filed a first memory (quick start's "keep" step),
 * and stays hidden when the quick start is not known (it never tells someone with memories to send a first one).
 */
export function FirstNoteSuggestion({ when }: { when: "before" | "after" }) {
  const quick = useQuickStart()
  if (when === "after") {
    const kept = quick?.steps.find((step) => step.id === "keep")
    if (!kept || kept.done) return null
  }
  return (
    <div
      id="first-note"
      className="flex items-start gap-3 rounded-md border bg-muted/40 px-3 py-2.5 text-sm"
      data-testid="first-note-suggestion"
      data-when={when}
    >
      <MicIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>
        <b>{when === "after" ? "Send your first voice note now." : "Then send your first voice note."}</b>{" "}
        Hold the microphone in the Zenod chat and try: <q>{FIRST_NOTE_EXAMPLE}</q>
        {when === "before" ? " Zenod answers “Saved”." : null}
      </span>
    </div>
  )
}
