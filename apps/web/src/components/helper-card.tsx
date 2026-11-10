import type { HelperCard, HelperCardChange } from "@/lib/inbox"
import "@/components/helper-card.css"

// EPIC-14 S36 (Jordi, voice note 10 Nov 23:08Z): "I'm introducing this new link. It's between these
// two concepts. That's why I think you should do it. That's why you might not want to do it. Make
// your call." The one way a helper's card says what it wants: a small picture of the two ideas with
// the change drawn between them, one line why yes, one line why not, and the call is yours. Every
// helper card uses it, so later helpers (a clarifying question, something to try) look the same.

/** The words on the line between the two ideas. */
const CHANGE_WORDS: Record<HelperCardChange, string> = {
  link: "new link",
  unlink: "link off",
  move: "moves under",
  rename: "new name",
  "own-place": "own place",
}

function Picture({ picture }: { picture: NonNullable<HelperCard["picture"]> }) {
  const { change, from } = picture
  const to = change === "own-place" ? "Top of your memory" : picture.to
  return (
    <figure
      className={`zh-picture zh-${change}`}
      data-testid="helper-card-picture"
      aria-label={`${from}, ${CHANGE_WORDS[change]}, ${to}`}
    >
      <span className="zh-idea zh-from">{from}</span>
      <span className="zh-join" aria-hidden="true">
        <span className="zh-line" />
        <span className="zh-change">{CHANGE_WORDS[change]}</span>
      </span>
      <span className={`zh-idea zh-to${change === "own-place" ? " zh-top" : ""}`}>
        {to}
      </span>
    </figure>
  )
}

/** The card's picture, why yes, why not and "Make your call", while the call is still open. */
export function HelperCardView({
  card,
  open,
}: {
  card: HelperCard
  open: boolean
}) {
  return (
    <div className="zh-card" data-testid="helper-card">
      {card.picture ? <Picture picture={card.picture} /> : null}
      <dl className="zh-why">
        <div>
          <dt>Why yes</dt>
          <dd>{card.yes}</dd>
        </div>
        <div>
          <dt>Why not</dt>
          <dd>{card.no}</dd>
        </div>
      </dl>
      {open ? <p className="zh-call">Make your call.</p> : null}
    </div>
  )
}
