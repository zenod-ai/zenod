import { useFreePlanAccount } from "@/components/free-plan-notice"
import type { EndOfTestOfferView } from "@/lib/free-plan"

// EPIC-26 S13: the end-of-test offer. Shown only while a tester's free month is ending, or has
// ended, and the team did not add a month; the server decides from the subscription itself. One
// button goes into the existing €9 Hosted checkout for this account.

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" })
}

export function EndOfTestOffer({ offer }: { offer: EndOfTestOfferView }) {
  const when = day(offer.free_ends_at)
  const before = offer.phase === "before"
  return (
    <section
      className="space-y-3 border border-[#1f4d3a]/40 bg-[#f6f2e9] p-5 text-[#18211c] dark:bg-[#1b211d] dark:text-[#f6f2e9]"
      data-testid="end-of-test-offer"
      aria-label="Your free month"
    >
      <h2 className="font-serif text-xl leading-snug">
        {before ? `Your free month ends on ${when}.` : `Your free month ended on ${when}.`}
      </h2>
      <p>
        Your notes stay yours. They live in your own Google Drive or GitHub
        repository, whatever you decide.
      </p>
      <p>
        {before ? "To keep Zenod going, " : "Zenod is paused. To pick up where you left off, "}
        Hosted is €9 a month plus VAT. Zenod keeps saving what you send on
        WhatsApp and answering from your notes, with the AI included.
      </p>
      <a
        href={offer.pay_url}
        className="inline-block rounded-[3px] bg-[#1f4d3a] px-5 py-3 text-sm font-medium text-[#f6f2e9] no-underline hover:bg-[#2d6a4e]"
      >
        Keep Zenod for €9 a month
      </a>
      <p className="text-sm opacity-75">
        {before ? `Nothing is charged before ${when}. ` : ""}
        If you do not pay, nothing breaks: Zenod pauses saving and answering,
        and your notes stay where they are.
      </p>
    </section>
  )
}

/** The hosted app's offer banner: nothing unless the server sends an offer for this account. */
export function HostedEndOfTestOffer() {
  const account = useFreePlanAccount()
  const offer = account?.end_of_test_offer
  return offer ? <EndOfTestOffer offer={offer} /> : null
}
