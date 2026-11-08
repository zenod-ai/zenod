import * as React from "react"

import { errorMessage } from "@/lib/api"
import {
  answerInbox,
  clearInboxExamples,
  dismissInbox,
  markInboxSeen,
  readInbox,
  setInboxCount,
  showInboxExamples,
  undoInbox,
  type InboxChange,
  type InboxItem,
} from "@/lib/inbox"
import "@/components/memory-inbox.css"

// EPIC-14 S2: the inbox. One list of what is addressed to you: a persona's question (decide),
// a persona's finding (read) and a memory desk job (Working with its step, then Done with what
// changed, See the changes and Undo). The question card follows Epic Team's needs-you card: the
// recommendation first, two or three buttons, the answer saved back as a memory. Paper language
// (docs/epic12/DESIGN-LANGUAGE.md). Nothing here goes to WhatsApp.

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

/** Still in front of you: an open question or finding, a job working or finished but not yet put away. */
function isOpen(item: InboxItem): boolean {
  if (item.kind !== "job") return item.status === "open"
  if (item.status === "failed") return item.needsYou
  return item.status === "working" || item.status === "done"
}

const memoryHref = (path: string) =>
  `#memory?path=${encodeURIComponent(path)}`

function kindLabel(item: InboxItem): string {
  if (item.kind === "question") return "Question"
  if (item.kind === "finding") return "Finding"
  if (item.status === "working") return "Working"
  if (item.status === "failed") return "Stopped"
  if (item.status === "undone") return "Undone"
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

function InboxCard({
  item,
  onChange,
}: {
  item: InboxItem
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
    item.status === "undone"
  return (
    <li
      className={`zi-item zi-${item.kind} zi-s-${item.status}${quiet ? " zi-quiet" : ""}`}
      data-testid="inbox-item"
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
      {item.body ? <p className="zi-body">{item.body}</p> : null}

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
        <p className="zi-step zi-warn">Stopped at: {item.step}</p>
      ) : null}
      {item.kind === "job" && item.result && item.status !== "working" ? (
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
    setState((previous) =>
      previous.kind === "ready"
        ? {
            kind: "ready",
            items: previous.items.map((item) =>
              item.id === change.item.id ? change.item : item
            ),
          }
        : previous
    )
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

  const needs = (items ?? []).filter(isOpen)
  const earlier = (items ?? []).filter((item) => !isOpen(item))
  const hasExamples = (items ?? []).some((item) => item.example)

  return (
    <section className="zp zi" aria-labelledby="memory-inbox-heading">
      <div className="zp-head">
        <h2 id="memory-inbox-heading">What needs you, in one place.</h2>
        <p className="zp-lede">
          Questions and findings from the helpers that read your memory, and
          the jobs the memory desk does for you.
        </p>
        <p className="zp-hint">
          <a href="#personas">Your personas</a> leave their findings here:
          switch one on or run it now.
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
                When a helper asks something or finishes a job, it shows up
                here. Want to see what that looks like?
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
                    <InboxCard key={item.id} item={item} onChange={onChange} />
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
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
