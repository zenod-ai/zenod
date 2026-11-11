import * as React from "react"

import { talkHash } from "@/lib/memory-chat"

import { errorMessage } from "@/lib/api"
import {
  answerInbox,
  bringBackSuggestion,
  clearInboxExamples,
  dismissInbox,
  doSuggestion,
  markInboxSeen,
  notNowSuggestion,
  readInbox,
  replyInbox,
  sendVoiceFeedback,
  setInboxCount,
  showInboxExamples,
  undoInbox,
  type InboxChange,
  type InboxItem,
  type InboxReply,
} from "@/lib/inbox"
import { formatLength } from "@/lib/voice-note"
import { VoiceNoteButton } from "@/components/voice-note-button"
import { HelperCardView } from "@/components/helper-card"
import "@/components/memory-inbox.css"

// EPIC-14 S2: the inbox. One list of what is addressed to you: a persona's question (decide),
// a persona's finding (read) and a memory desk job (Working with its step, then Done with what
// changed, See the changes and Undo). The question card follows Epic Team's needs-you card: the
// recommendation first, two or three buttons, the answer saved back as a memory. Paper language
// (docs/epic12/DESIGN-LANGUAGE.md). Nothing here goes to WhatsApp.
//
// Round 3 (Jordi: "shouldn't we have 1 chat?"): the inbox is a list of cards, and the Chat tab is the
// one chat. The inbox's own "Ask the desk" box is gone: a job for the desk is written in the chat,
// whose Send box hands it over. Each card instead has a reply box, like Epic Team's feedback box: it
// answers a question in your words, sends feedback to the persona that wrote a finding, or sends a
// follow-up to the desk about a job.
//
// EPIC-14 S26 (Jordi, E14-A9: "a harness waking up bound to a persona ... introduces these cards into
// your inbox, which has a one-tap response"): a helper's suggestion card. Do it runs the change as one
// memory desk job, shown on the card with Undo; Change edits the words first; Not now takes an
// optional reason the helper reads on its next run; Talk it over opens the chat; Your feedback opens
// a text box with a microphone, and the note or voice note is kept on the card for the helper to read,
// as on Epic Team's review cards.

/** While a job is working the list refreshes this often, so its step moves. */
const WORKING_POLL_MS = 5_000
const IDLE_POLL_MS = 30_000

type State =
  | { kind: "loading" }
  | { kind: "ready"; items: InboxItem[] }
  | { kind: "error"; message: string }

function ago(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms)) return ""
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h`
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })
}

/** "just now", "5 min ago", "on 8 Nov". */
function since(iso: string): string {
  const when = ago(iso)
  if (when === "now") return "just now"
  return /\d (min|h)$/.test(when) ? `${when} ago` : `on ${when}`
}

/** The desk job a suggestion's Do it started, when it is in the list. */
type Jobs = ReadonlyMap<string, InboxItem>
const jobOf = (item: InboxItem, jobs: Jobs) =>
  item.done?.jobItemId ? (jobs.get(item.done.jobItemId) ?? null) : null

/** Still in front of you: an open question, finding or suggestion, a job working or finished but not yet put away. */
function isOpen(item: InboxItem, jobs: Jobs = new Map()): boolean {
  if (item.kind === "suggestion") {
    if (item.status === "open") return true
    const job = item.status === "accepted" ? jobOf(item, jobs) : null
    return job !== null && isOpen(job)
  }
  if (item.kind !== "job") return item.status === "open"
  if (item.status === "failed") return item.needsYou
  return item.status === "working" || item.status === "done"
}

const memoryHref = (path: string) =>
  `#memory?path=${encodeURIComponent(path)}`

function kindLabel(item: InboxItem): string {
  if (item.kind === "question") return "Question"
  if (item.kind === "finding") return "Finding"
  if (item.kind === "suggestion") return "Suggestion"
  if (item.status === "working") return "Working"
  if (item.status === "failed") return "Stopped"
  if (item.status === "undone") return "Undone"
  if (item.result?.answer) return "Answered"
  return "Done"
}

function Links({ item }: { item: InboxItem }) {
  if (item.links.length === 0) return null
  return (
    <ul className="zi-links">
      {item.links.map((link) => (
        <li key={link.path}>
          <a href={memoryHref(link.path)}>{link.label}</a>
        </li>
      ))}
    </ul>
  )
}

function Changes({ result }: { result: NonNullable<InboxItem["result"]> }) {
  return (
    <div className="zi-changes">
      {result.changes.length > 0 ? (
        <ul>
          {result.changes.map((change, index) => (
            <li key={index}>
              <span>{change.what}</span>
              {change.before || change.after ? (
                <span className="zi-move">
                  {change.before ?? "–"} <i aria-hidden="true">→</i>{" "}
                  {change.after ?? "–"}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {result.search ? (
        <div className="zi-search">
          <p className="zi-searchhead">
            Searching “{result.search.query}”
          </p>
          <div className="zi-ba">
            <div>
              <b>Before</b>
              <ol>
                {result.search.before.map((title, index) => (
                  <li key={index}>{title}</li>
                ))}
              </ol>
            </div>
            <div>
              <b>After</b>
              <ol>
                {result.search.after.map((title, index) => (
                  <li key={index}>{title}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      ) : null}
      {result.changesUrl ? (
        <a href={result.changesUrl} target="_blank" rel="noreferrer">
          The full change
        </a>
      ) : null}
    </div>
  )
}

/** A helper's finding or suggestion: its reply box is feedback that helper reads on its next run. */
const takesFeedback = (item: InboxItem) =>
  (item.kind === "finding" || item.kind === "suggestion") &&
  item.from !== "Memory desk"

/** Where a card's reply box sends its words, in plain words for the box itself. */
function replyCopy(item: InboxItem): {
  placeholder: string
  send: string
  hint: string
} | null {
  const desk = item.kind === "job" || item.from === "Memory desk"
  if (item.kind === "question") {
    if (item.status !== "open") return null
    return desk
      ? {
          placeholder: "Something else? Tell the desk what to do instead",
          send: "Send to the desk",
          hint: item.example
            ? "An example, so no job starts."
            : "The desk starts a new job instead of this one.",
        }
      : {
          placeholder: "Or answer in your own words",
          send: "Send answer",
          hint: item.example
            ? "An example, so nothing is saved."
            : "Saved as a memory, like a button.",
        }
  }
  if (takesFeedback(item))
    return {
      placeholder:
        item.kind === "suggestion"
          ? `Your feedback for ${item.from}: type it, or tap the microphone`
          : `Feedback for ${item.from}: was it useful, what was wrong?`,
      send: "Send feedback",
      hint: item.example
        ? "An example, so no helper reads it."
        : `${item.from} reads it on its next run.`,
    }
  return {
    placeholder: "A follow-up or a correction for the desk",
    send: "Send to the desk",
    hint: item.example
      ? "An example, so no job starts."
      : "Starts a new job, linked to this one.",
  }
}

function scrollToItem(id: string) {
  document
    .querySelector(`[data-item-id="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" })
}

/** What you wrote back on this card, and what became of it. Answers show as the card's answer. */
function Replies({ item }: { item: InboxItem }) {
  const shown = item.replies.filter(
    (reply: InboxReply) => reply.kind !== "answer"
  )
  if (shown.length === 0) return null
  return (
    <ul className="zi-replies" aria-label="What you wrote back">
      {shown.map((reply, index) => (
        <li key={index}>
          <p className="zi-said">
            <b>You</b>
            {reply.kind === "notnow" ? " · Not now" : null}
            {reply.voice ? (
              <>
                {" "}
                · voice note
                {reply.voice.seconds ? ` ${formatLength(reply.voice.seconds)}` : ""}
              </>
            ) : null}{" "}
            · {ago(reply.at)}
            <span>“{reply.text}”</span>
          </p>
          <p className="zi-sent" role="status">
            {reply.kind === "feedback" || reply.kind === "notnow"
              ? item.example
                ? "Sent. An example, so no helper reads it."
                : reply.readAt
                  ? `${item.from} read it on its run ${since(reply.readAt)}.`
                  : `Sent. ${item.from} reads it on its next run.`
              : reply.followUpItemId
                ? (
                    <>
                      Sent to the desk as a new job.{" "}
                      <button
                        type="button"
                        className="zi-link"
                        onClick={() => scrollToItem(reply.followUpItemId!)}
                      >
                        See the job
                      </button>
                    </>
                  )
                : "Sent. An example, so no job started."}
          </p>
        </li>
      ))}
    </ul>
  )
}

/**
 * The card's reply box: a short text box and Send, like Epic Team's feedback box. On a helper's card
 * (S26) it also has a microphone: the voice note is turned into words and kept with what is typed.
 */
function ReplyBox({
  item,
  onChange,
  onCancel,
}: {
  item: InboxItem
  onChange: (change: InboxChange) => void
  /** S26: the suggestion's Your feedback box closes again. */
  onCancel?: () => void
}) {
  const [text, setText] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [heard, setHeard] = React.useState<string | null>(null)
  // The recorder must not restart on every key: it reads the typed words when it sends.
  const typed = React.useRef(text)
  typed.current = text
  const itemId = item.id
  const upload = React.useCallback(
    (audio: Blob, seconds: number) =>
      sendVoiceFeedback(itemId, audio, seconds, typed.current),
    [itemId]
  )
  const copy = replyCopy(item)
  if (!copy) return null
  const voice = takesFeedback(item)
  async function send() {
    const words = text.trim()
    if (!words || busy) return
    setBusy(true)
    setError(null)
    try {
      onChange(await replyInbox(item.id, words))
      setText("")
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="zi-reply"
      aria-label={`Reply to ${item.from}`}
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <textarea
        aria-label={copy.placeholder}
        placeholder={copy.placeholder}
        value={text}
        rows={1}
        maxLength={1000}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void send()
          }
        }}
      />
      <div className="zi-replyrow">
        <span className="zp-hint">{copy.hint}</span>
        <span className="zi-replyacts">
          {voice ? (
            <VoiceNoteButton<InboxChange>
              label="Leave a voice note"
              upload={upload}
              disabled={busy}
              onSent={(change) => {
                onChange(change)
                setText("")
                setHeard("Your voice note is kept as words on this card.")
              }}
              onNotice={(notice, warn) =>
                warn ? setError(notice) : setHeard(notice)
              }
            />
          ) : null}
          {onCancel ? (
            <button type="button" className="zp-keep" onClick={onCancel}>
              Close
            </button>
          ) : null}
          <button
            type="submit"
            className="zp-keep"
            disabled={!text.trim() || busy}
          >
            {busy ? "Sending…" : copy.send}
          </button>
        </span>
      </div>
      {heard ? (
        <p className="zp-hint" role="status">
          {heard}
        </p>
      ) : null}
      {error ? (
        <p className="zi-warn" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}

/** What Do it started, on the suggestion's own card: the desk job's step, then its result with Undo. */
function SuggestionJob({
  item,
  job,
  onChange,
}: {
  item: InboxItem
  job: InboxItem | null
  onChange: (change: InboxChange) => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [confirmUndo, setConfirmUndo] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  async function act(run: () => Promise<InboxChange>) {
    setBusy(true)
    setError(null)
    try {
      onChange(await run())
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
      setConfirmUndo(false)
    }
  }
  const changed = item.done?.changed ? (
    <p className="zp-hint">You changed it first: “{item.done.action}”</p>
  ) : null
  if (!job)
    return (
      <>
        <p className="zi-done">You said Do it. Sent to the memory desk.</p>
        {changed}
      </>
    )
  const finished = job.status === "done" || job.status === "dismissed"
  return (
    <div className="zi-did" data-testid="suggestion-job">
      {job.status === "working" ? (
        <p className="zi-step" aria-live="polite">
          <i aria-hidden="true" />
          On the memory desk: {job.step}
        </p>
      ) : job.status === "failed" ? (
        <p className="zi-step zi-warn">Stopped. {job.step}</p>
      ) : job.status === "undone" ? (
        <p className="zi-done">
          Undone.{" "}
          {job.example
            ? "An example, so nothing changed."
            : "Your memory is as it was before."}
        </p>
      ) : (
        <p className="zi-done">
          Done on the memory desk. {job.result?.summary}
        </p>
      )}
      {changed}
      {finished ? (
        <>
          {open && job.result ? <Changes result={job.result} /> : null}
          <div className="zi-row">
            {job.result && job.result.changes.length > 0 ? (
              <button
                type="button"
                className="zp-keep"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              >
                {open ? "Hide the changes" : "See the changes"}
              </button>
            ) : null}
            {confirmUndo ? (
              <>
                <button
                  type="button"
                  className="zp-send"
                  disabled={busy}
                  onClick={() => act(() => undoInbox(job.id))}
                >
                  Yes, put it back
                </button>
                <button
                  type="button"
                  className="zp-keep"
                  onClick={() => setConfirmUndo(false)}
                >
                  Keep it
                </button>
              </>
            ) : (
              <button
                type="button"
                className="zp-keep"
                disabled={busy}
                onClick={() => setConfirmUndo(true)}
              >
                Undo
              </button>
            )}
            {job.status === "done" && !confirmUndo ? (
              <button
                type="button"
                className="zp-keep"
                disabled={busy}
                onClick={() => act(() => dismissInbox(job.id))}
              >
                Good
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {error ? (
        <p className="zi-warn" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * S26: a helper's suggestion. Do it, Change, Not now, Talk it over and Your feedback while it is
 * open; then what Do it started, or that it was put away.
 */
function Suggestion({
  item,
  jobs,
  onChange,
}: {
  item: InboxItem
  jobs: Jobs
  onChange: (change: InboxChange) => void
}) {
  type Mode = "buttons" | "change" | "notnow" | "feedback"
  const [mode, setMode] = React.useState<Mode>("buttons")
  const [words, setWords] = React.useState(item.action ?? item.title)
  const [why, setWhy] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  async function act(run: () => Promise<InboxChange>) {
    setBusy(true)
    setError(null)
    try {
      onChange(await run())
      setMode("buttons")
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  const open = item.status === "open"
  const talk = () => {
    window.location.hash = talkHash(item.from, item.title)
  }
  const reason = item.replies.find((reply) => reply.kind === "notnow")
  return (
    <>
      {/* S36: the picture says the change; the desk's own words wait behind Change. */}
      {open && item.action && !item.card?.picture ? (
        <p className="zi-action">
          <b>The change</b> {item.action}
        </p>
      ) : null}
      <Links item={item} />
      {mode === "change" ? (
        <form
          className="zi-reply"
          aria-label="Change it first"
          onSubmit={(event) => {
            event.preventDefault()
            if (words.trim()) void act(() => doSuggestion(item.id, words.trim()))
          }}
        >
          <textarea
            aria-label="The change, in your words"
            value={words}
            rows={2}
            maxLength={600}
            autoFocus
            onChange={(event) => setWords(event.target.value)}
          />
          <div className="zi-replyrow">
            <span className="zp-hint">
              {item.example
                ? "An example, so nothing changes."
                : "The memory desk does it as one job you can undo."}
            </span>
            <span className="zi-replyacts">
              <button
                type="button"
                className="zp-keep"
                onClick={() => setMode("buttons")}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="zp-send"
                disabled={!words.trim() || busy}
              >
                {busy ? "Starting…" : "Do it like this"}
              </button>
            </span>
          </div>
        </form>
      ) : mode === "notnow" ? (
        <form
          className="zi-reply"
          aria-label="Not now"
          onSubmit={(event) => {
            event.preventDefault()
            void act(() => notNowSuggestion(item.id, why.trim()))
          }}
        >
          <textarea
            aria-label="Why not now"
            placeholder={`Why not now? Optional: ${item.from} reads it on its next run`}
            value={why}
            rows={1}
            maxLength={1000}
            autoFocus
            onChange={(event) => setWhy(event.target.value)}
          />
          <div className="zi-replyrow">
            <span className="zp-hint">Nothing changes in your memory.</span>
            <span className="zi-replyacts">
              <button
                type="button"
                className="zp-keep"
                onClick={() => setMode("buttons")}
              >
                Cancel
              </button>
              <button type="submit" className="zp-send" disabled={busy}>
                Put it away
              </button>
            </span>
          </div>
        </form>
      ) : (
        <div className="zi-row">
          {open ? (
            <>
              <button
                type="button"
                className="zp-send"
                disabled={busy}
                onClick={() => act(() => doSuggestion(item.id))}
              >
                {busy ? "Starting…" : "Do it"}
              </button>
              <button
                type="button"
                className="zp-keep"
                disabled={busy}
                onClick={() => setMode("change")}
              >
                Change
              </button>
              <button
                type="button"
                className="zp-keep"
                disabled={busy}
                onClick={() => setMode("notnow")}
              >
                Not now
              </button>
            </>
          ) : null}
          {!item.example ? (
            <button type="button" className="zp-keep" onClick={talk}>
              Talk it over
            </button>
          ) : null}
          <button
            type="button"
            className="zp-keep"
            aria-expanded={mode === "feedback"}
            onClick={() => setMode(mode === "feedback" ? "buttons" : "feedback")}
          >
            Your feedback
          </button>
        </div>
      )}
      {item.status === "accepted" ? (
        <SuggestionJob item={item} job={jobOf(item, jobs)} onChange={onChange} />
      ) : null}
      {item.status === "declined" ? (
        <>
          <p className="zi-done">
            Put away. Nothing changed.
            {reason ? "" : ` ${item.from} may suggest it again later.`}
          </p>
          {item.example ? null : (
            <div className="zi-row">
              <button
                type="button"
                className="zp-keep"
                disabled={busy}
                onClick={() => void act(() => bringBackSuggestion(item.id))}
              >
                Bring it back
              </button>
            </div>
          )}
        </>
      ) : null}
      {error ? (
        <p className="zi-warn" role="alert">
          {error}
        </p>
      ) : null}
      {mode === "feedback" ? (
        <ReplyBox
          item={item}
          onChange={onChange}
          onCancel={() => setMode("buttons")}
        />
      ) : null}
    </>
  )
}

function InboxCard({
  item,
  jobs = new Map(),
  onChange,
}: {
  item: InboxItem
  jobs?: Jobs
  onChange: (change: InboxChange) => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)
  const [confirmUndo, setConfirmUndo] = React.useState(false)

  async function act(run: () => Promise<InboxChange>) {
    setBusy(true)
    setError(null)
    try {
      onChange(await run())
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
      setConfirmUndo(false)
    }
  }

  const label = kindLabel(item)
  const quiet =
    item.status === "dismissed" ||
    item.status === "answered" ||
    item.status === "undone" ||
    item.status === "declined"
  return (
    <li
      className={`zi-item zi-${item.kind} zi-s-${item.status}${quiet ? " zi-quiet" : ""}`}
      data-testid="inbox-item"
      data-item-id={item.id}
    >
      <p className="zi-top">
        <span className="zi-kind">{label}</span>
        <span className="zi-who">
          {item.from} · {ago(item.updatedAt)}
        </span>
        {item.example ? <span className="zi-example">Example</span> : null}
        {item.needsYou ? <span className="zi-new">New</span> : null}
      </p>
      <p className="zi-what">{item.title}</p>
      {/* S36: with a card, the body (what the team said) is a note under its reasons. */}
      {item.body && !item.followUpOf && !item.card ? (
        <p className="zi-body">{item.body}</p>
      ) : null}
      {item.followUpOf ? (
        <p className="zi-follows">
          Follows up{" "}
          <button
            type="button"
            className="zi-link"
            onClick={() => scrollToItem(item.followUpOf!.id)}
          >
            {item.followUpOf.title}
          </button>
        </p>
      ) : null}

      {item.card ? (
        <HelperCardView
          card={item.card}
          open={item.status === "open"}
          note={item.followUpOf ? null : item.body}
        />
      ) : null}

      {item.kind === "suggestion" ? (
        <Suggestion item={item} jobs={jobs} onChange={onChange} />
      ) : null}

      {item.kind === "question" && item.status === "open" ? (
        <>
          {item.recommended ? (
            <p className="zi-rec">
              Recommended:{" "}
              {item.options.find((option) => option.id === item.recommended)
                ?.label}
            </p>
          ) : null}
          <div className="zi-row">
            {item.options.map((option) => (
              <button
                key={option.id}
                type="button"
                className={
                  option.id === item.recommended ? "zp-send" : "zp-keep"
                }
                disabled={busy}
                onClick={() => act(() => answerInbox(item.id, option.id))}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Links item={item} />
        </>
      ) : null}
      {item.kind === "question" && item.answer ? (
        <p className="zi-done">
          You answered “{item.answer.label}”.{" "}
          {item.example
            ? "An example, so nothing was saved."
            : "Saved as a memory."}
        </p>
      ) : null}

      {item.kind === "finding" ? (
        <>
          {open ? <Links item={item} /> : null}
          {item.status === "open" ? (
            <div className="zi-row">
              {item.links.length > 0 ? (
                <button
                  type="button"
                  className="zp-keep"
                  aria-expanded={open}
                  onClick={() => setOpen(!open)}
                >
                  {open ? "Hide the memories" : "Open the memories"}
                </button>
              ) : null}
              <button
                type="button"
                className="zp-keep"
                disabled={busy}
                onClick={() => act(() => dismissInbox(item.id))}
              >
                Got it
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {item.kind === "job" && item.status === "working" ? (
        <p className="zi-step" aria-live="polite">
          <i aria-hidden="true" />
          {item.step}
        </p>
      ) : null}
      {item.kind === "job" && item.status === "failed" ? (
        <p className="zi-step zi-warn">Stopped. {item.step}</p>
      ) : null}
      {item.kind === "job" && item.result?.answer && item.status !== "working" ? (
        <>
          <p className="zi-summary">{item.result.summary}</p>
          <p className="zp-hint">This was a question, so nothing in your memory changed.</p>
          {item.status === "done" ? (
            <div className="zi-row">
              <button
                type="button"
                className="zp-keep"
                disabled={busy}
                onClick={() => act(() => dismissInbox(item.id))}
              >
                Good
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {item.kind === "job" && item.result && !item.result.answer && item.status !== "working" ? (
        <>
          <p className="zi-summary">{item.result.summary}</p>
          {open ? <Changes result={item.result} /> : null}
          <div className="zi-row">
            <button
              type="button"
              className="zp-keep"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? "Hide the changes" : "See the changes"}
            </button>
            {item.status === "done" || item.status === "dismissed" ? (
              confirmUndo ? (
                <>
                  <button
                    type="button"
                    className="zp-send"
                    disabled={busy}
                    onClick={() => act(() => undoInbox(item.id))}
                  >
                    Yes, put it back
                  </button>
                  <button
                    type="button"
                    className="zp-keep"
                    onClick={() => setConfirmUndo(false)}
                  >
                    Keep it
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="zp-keep"
                  disabled={busy}
                  onClick={() => setConfirmUndo(true)}
                >
                  Undo
                </button>
              )
            ) : null}
            {item.status === "done" && !confirmUndo ? (
              <button
                type="button"
                className="zp-keep"
                disabled={busy}
                onClick={() => act(() => dismissInbox(item.id))}
              >
                Good
              </button>
            ) : null}
          </div>
          {item.status === "undone" ? (
            <p className="zi-done">
              Undone.{" "}
              {item.example
                ? "An example, so nothing changed."
                : "Your memory is as it was before the job."}
            </p>
          ) : null}
        </>
      ) : null}
      {error ? (
        <p className="zi-warn" role="alert">
          {error}
        </p>
      ) : null}
      {item.kind !== "job" && item.kind !== "suggestion" && !item.example ? (
        <div className="zi-row">
          {/* EPIC-22 E22-2: talk this note over with the persona that wrote it. */}
          <button
            type="button"
            className="zp-deskbtn"
            onClick={() => {
              window.location.hash = talkHash(item.from, item.title)
            }}
          >
            Talk it over
          </button>
        </div>
      ) : null}
      <Replies item={item} />
      {item.kind !== "suggestion" ? (
        <ReplyBox item={item} onChange={onChange} />
      ) : null}
    </li>
  )
}

export function MemoryInbox({ active = true }: { active?: boolean }) {
  const [state, setState] = React.useState<State>({ kind: "loading" })
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const list = await readInbox()
      setState({ kind: "ready", items: list.items })
      setInboxCount(list.needsYou)
    } catch (cause) {
      setState((previous) =>
        previous.kind === "ready"
          ? previous
          : { kind: "error", message: errorMessage(cause) }
      )
    }
  }, [])

  const items = state.kind === "ready" ? state.items : null
  const working = items?.some((item) => item.status === "working") ?? false

  React.useEffect(() => {
    if (!active) return
    void load()
    const timer = window.setInterval(
      load,
      working ? WORKING_POLL_MS : IDLE_POLL_MS
    )
    return () => window.clearInterval(timer)
  }, [active, load, working])

  // What the inbox has shown is now seen; open questions still count until answered.
  const unseen = React.useMemo(
    () =>
      (items ?? [])
        .filter((item) => item.seenAt === null && item.kind !== "question")
        .map((item) => item.id),
    [items]
  )
  React.useEffect(() => {
    if (!active || unseen.length === 0) return
    const timer = window.setTimeout(() => {
      markInboxSeen(unseen)
        .then((result) => setInboxCount(result.needsYou))
        .catch(() => {})
    }, 1_500)
    return () => window.clearTimeout(timer)
  }, [active, unseen])

  const onChange = React.useCallback((change: InboxChange) => {
    setState((previous) => {
      if (previous.kind !== "ready") return previous
      const items = previous.items.map((item) =>
        item.id === change.item.id ? change.item : item
      )
      // A follow-up sent to the desk: its new job comes in at the top, Working.
      const followUp = change.followUp
      return {
        kind: "ready",
        items: followUp
          ? [followUp, ...items.filter((item) => item.id !== followUp.id)]
          : items,
      }
    })
    setInboxCount(change.needsYou)
  }, [])

  async function examples(show: boolean) {
    setBusy(true)
    try {
      const list = await (show ? showInboxExamples() : clearInboxExamples())
      setState({ kind: "ready", items: list.items })
      setInboxCount(list.needsYou)
    } catch (cause) {
      setState({ kind: "error", message: errorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }

  // S26: a desk job started by Do it shows on its suggestion's card, not as a card of its own.
  const jobs: Jobs = new Map((items ?? []).map((item) => [item.id, item]))
  const onCard = new Set(
    (items ?? []).flatMap((item) =>
      item.kind === "suggestion" && item.done?.jobItemId
        ? [item.done.jobItemId]
        : []
    )
  )
  const shown = (items ?? []).filter((item) => !onCard.has(item.id))
  const needs = shown.filter((item) => isOpen(item, jobs))
  const earlier = shown.filter((item) => !isOpen(item, jobs))
  const hasExamples = (items ?? []).some((item) => item.example)

  return (
    <section className="zp zi" aria-labelledby="memory-inbox-heading">
      <div className="zp-head">
        <h2 id="memory-inbox-heading">What needs you, in one place.</h2>
        <p className="zp-lede">
          Suggestions, questions and findings from the helpers that read your
          memory, and the jobs the memory desk does for you.
        </p>
        <p className="zp-hint">
          <a href="#helpers">Your helpers</a> leave their cards here: switch
          one on or run it now. Nothing changes in your memory until you
          press Do it, and every change can be undone. To give the desk a new
          job, write it in the <a href="#chat">Chat</a> and press Ask the
          desk.
        </p>
      </div>
      <div className="zp-stage">
        <div className="zp-screen zi-screen">
          {state.kind === "loading" ? (
            <p className="zp-empty">Opening your inbox…</p>
          ) : state.kind === "error" ? (
            <p className="zp-empty zp-warn" role="alert">
              The inbox could not be opened: {state.message}
            </p>
          ) : state.items.length === 0 ? (
            <div className="zi-empty">
              <p className="zp-empty">Nothing needs you.</p>
              <p className="zp-hint">
                When a helper asks something or the desk finishes a job, it
                shows up here. Want to see what that looks like?
              </p>
              <button
                type="button"
                className="zp-keep"
                disabled={busy}
                onClick={() => examples(true)}
              >
                Show examples
              </button>
            </div>
          ) : (
            <>
              {needs.length > 0 ? (
                <ul className="zi-list" aria-label="Needs you">
                  {needs.map((item) => (
                    <InboxCard
                      key={item.id}
                      item={item}
                      jobs={jobs}
                      onChange={onChange}
                    />
                  ))}
                </ul>
              ) : (
                <p className="zi-clear">Nothing needs you right now.</p>
              )}
              {earlier.length > 0 ? (
                <>
                  <h3 className="zi-earlier">Earlier</h3>
                  <ul className="zi-list" aria-label="Earlier">
                    {earlier.map((item) => (
                      <InboxCard
                        key={item.id}
                        item={item}
                        jobs={jobs}
                        onChange={onChange}
                      />
                    ))}
                  </ul>
                </>
              ) : null}
              {hasExamples ? (
                <p className="zp-hint zi-foot">
                  Example items are made up and never change your memory.{" "}
                  <button
                    type="button"
                    className="zi-link"
                    disabled={busy}
                    onClick={() => examples(false)}
                  >
                    Clear examples
                  </button>
                </p>
              ) : (
                <p className="zp-hint zi-foot">
                  Want to try each kind of card without touching your
                  memory?{" "}
                  <button
                    type="button"
                    className="zi-link"
                    disabled={busy}
                    onClick={() => examples(true)}
                  >
                    Show examples
                  </button>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
