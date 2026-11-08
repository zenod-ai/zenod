import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import {
  keepStatus,
  MemoryChatError,
  presentAnswer,
  sendToMemory,
  vaultLabel,
  type MemoryChatAnswer,
  type MemoryChatMemory,
  type MemoryKeepReceipt,
  type MemorySendRoute,
} from "@/lib/memory-chat"
import { litHash } from "@/lib/memory-graph"
import { formatLength, voiceNoteStatus } from "@/lib/voice-note"
import { VoiceNoteButton } from "@/components/voice-note-button"

// EPIC-12 E12-S1: the hosted app opens on this chat. It answers from your memory and shows
// the memories it used with their match percentages and links. EPIC-16 E16-B1: one Send button;
// Zenod decides from the message whether to keep it, answer it, or both, and says which it did
// (a question is never kept). Styled in the product deck's paper language (docs/epic12/DESIGN-LANGUAGE.md).
// E12-S1b: the memories show as soon as they are found and the answer streams in, marked as a
// draft until Zenod has checked each citation against the memory it names.
// E12-S13: "Show in graph" opens the Graph tab with the answer's memories lit up.

type KeepState =
  | { state: "idle" }
  | { state: "keeping" }
  | { state: "kept"; receipt: MemoryKeepReceipt }
  | { state: "error"; message: string }

type Turn =
  | { id: number; kind: "message"; text: string }
  | {
      id: number
      kind: "pending"
      route: MemorySendRoute | null
      keep: KeepState | null
      memories: MemoryChatMemory[] | null
      text: string
    }
  | {
      id: number
      kind: "reply"
      route: MemorySendRoute
      keep: KeepState | null
      result: MemoryChatAnswer | null
    }
  | { id: number; kind: "voice-note"; seconds: number; keep: KeepState }
  | { id: number; kind: "error"; text: string }

type NewTurn = Turn extends infer T
  ? T extends Turn
    ? Omit<T, "id">
    : never
  : never

const KEEP_POLL_MS = 1500
const KEEP_POLL_TRIES = 40

function useKeepPolling(
  update: (id: number, keep: KeepState) => void,
  status: (id: string) => Promise<MemoryKeepReceipt> = keepStatus
): (turnId: number, receipt: MemoryKeepReceipt) => void {
  const alive = React.useRef(true)
  React.useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  return React.useCallback(
    (turnId: number, first: MemoryKeepReceipt) => {
      update(turnId, { state: "kept", receipt: first })
      if (first.status !== "saving") return
      let tries = 0
      const tick = () => {
        if (!alive.current || tries++ >= KEEP_POLL_TRIES) return
        status(first.id)
          .then((receipt) => {
            if (!alive.current) return
            update(turnId, { state: "kept", receipt })
            if (receipt.status === "saving") setTimeout(tick, KEEP_POLL_MS)
          })
          .catch(() => setTimeout(tick, KEEP_POLL_MS))
      }
      setTimeout(tick, KEEP_POLL_MS)
    },
    [update, status]
  )
}

/** What Zenod did with the message (E16-B1): said plainly, with a link once it is saved. */
function KeepLine({
  keep,
  route,
  retry = "Send it again.",
}: {
  keep: KeepState
  route?: MemorySendRoute
  retry?: string
}) {
  const part = route?.action === "both" ? (
    <span className="zp-keptpart">“{route.keep}”</span>
  ) : null
  if (keep.state === "keeping" || keep.state === "idle")
    return <p className="zp-keepnote" data-testid="memory-kept">Saving to your memory… {part}</p>
  if (keep.state === "error")
    return <p className="zp-keepnote zp-warn" data-testid="memory-kept">{keep.message}</p>
  const { receipt } = keep
  if (receipt.status === "failed")
    return (
      <p className="zp-keepnote zp-warn" data-testid="memory-kept">
        Not saved. {retry}
      </p>
    )
  if (receipt.status === "saving")
    return <p className="zp-keepnote" data-testid="memory-kept">Saved to your memory. Filing it… {part}</p>
  return (
    <p className="zp-keepnote" data-testid="memory-kept">
      Saved to your memory ✓ {part}
      {receipt.noteUrl ? (
        <>
          {" "}
          <a href={receipt.noteUrl} target="_blank" rel="noreferrer">
            Open it
          </a>
        </>
      ) : null}
    </p>
  )
}

/** Why a recent-note question shows a memory (E12-S3c): the note by time, then its place in the graph. */
const RELATION_LABEL: Record<NonNullable<MemoryChatMemory["relation"]>, string> = {
  note: "voice note, by time",
  filed: "filed from the note",
  linked: "linked",
  parent: "its topic",
  child: "under the top match",
}

function noteFlag(
  memory: MemoryChatMemory,
  noteLinks: MemoryChatAnswer["noteLinks"]
): string | null {
  if (memory.unlinked) {
    const count = noteLinks?.unlinked
      ? ` · ${noteLinks.unlinked} of your ${noteLinks.voiceNotes} voice notes are not`
      : ""
    return `not yet linked to topics${count}`
  }
  if (memory.unwritten) {
    return `${memory.unwritten} ${memory.unwritten === 1 ? "topic" : "topics"} not yet written`
  }
  return null
}

function MemoryList({
  memories,
  alsoCited = [],
  noteLinks,
  question,
}: {
  memories: MemoryChatMemory[]
  alsoCited?: MemoryChatAnswer["alsoCited"]
  noteLinks?: MemoryChatAnswer["noteLinks"]
  /** Set once the answer is in: offers "Show in graph" with these memories lit. */
  question?: string
}) {
  return (
    <div className="zp-used" aria-label="Memories used">
      <p className="zp-usedhead">
        {memories.length > 0
          ? memories.length > 5
            ? "Memories for this question"
            : `Top ${memories.length} memories for this question`
          : "Memories cited"}
        {question !== undefined ? (
          <a
            className="zp-showgraph"
            data-testid="show-in-graph"
            href={`/${litHash({
              question,
              memories: [
                ...memories.map((memory) => ({
                  path: memory.path,
                  title: memory.title,
                  matchPercent: memory.matchPercent,
                })),
                ...alsoCited.map((source) => ({
                  path: source.path,
                  title: source.title,
                  matchPercent: null,
                })),
              ],
            })}`}
          >
            Show in graph
          </a>
        ) : null}
      </p>
      <ol>
        {memories.map((memory) => (
          <li key={memory.path} className={memory.cited ? "zp-cited" : undefined}>
            <a className="zp-title" href={memory.appPath}>
              {memory.title}
            </a>
            <span className="zp-bar" aria-hidden="true">
              <i style={{ width: `${memory.matchPercent}%` }} />
            </span>
            <span className="zp-pct">{memory.matchPercent}%</span>
            <span className="zp-meta">
              {memory.cited ? <b>cited</b> : null}
              {memory.relation ? (
                <span className="zp-rel">{RELATION_LABEL[memory.relation]}</span>
              ) : null}
              {noteFlag(memory, noteLinks) ? (
                <span className="zp-unlinked">{noteFlag(memory, noteLinks)}</span>
              ) : null}
              {memory.treePath ? <span>{memory.treePath}</span> : null}
              {memory.url ? (
                <a href={memory.url} target="_blank" rel="noreferrer">
                  {vaultLabel(memory.provider)}
                </a>
              ) : null}
            </span>
          </li>
        ))}
        {alsoCited.map((source) => (
          <li key={source.path} className="zp-cited">
            <a className="zp-title" href={source.appPath}>
              {source.title}
            </a>
            <span className="zp-bar" aria-hidden="true" />
            <span className="zp-pct">{source.rank ? `[${source.rank}]` : "·"}</span>
            <span className="zp-meta">
              <b>cited</b>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer">
                  Vault
                </a>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

const answerLinks = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) =>
    href?.startsWith("/#") ? (
      <a href={href} className="zp-cite">
        {children}
      </a>
    ) : (
      <a href={href} target="_blank" rel="noreferrer" className="zp-src">
        {children}
      </a>
    ),
}

function PendingTurn({
  route,
  keep,
  memories,
  text,
}: {
  route: MemorySendRoute | null
  keep: KeepState | null
  memories: MemoryChatMemory[] | null
  text: string
}) {
  const asking = route?.question != null
  return (
    <div className="zp-turn">
      {route && keep ? <KeepLine keep={keep} route={route} /> : null}
      {!route || (asking && !text) ? (
        <div className="zp-msg zp-z zp-typing" aria-label="Zenod is working">
          <i />
          <i />
          <i />
        </div>
      ) : null}
      {asking && text ? (
        <div className="zp-msg zp-z zp-draft" data-testid="memory-draft">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={answerLinks}>
            {presentAnswer(text, memories ?? [])}
          </ReactMarkdown>
          <span className="zp-checking">Checking against your memories…</span>
        </div>
      ) : null}
      {asking && memories && memories.length > 0 ? <MemoryList memories={memories} /> : null}
    </div>
  )
}

function AnswerTurn({ result }: { result: MemoryChatAnswer }) {
  return (
    <>
      <div
        className={result.answered ? "zp-msg zp-z" : "zp-msg zp-z zp-none"}
        data-testid="memory-answer"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={answerLinks}>
          {presentAnswer(result.answer, [...result.memories, ...result.alsoCited])}
        </ReactMarkdown>
        {result.answered && result.checkedBy === "quoted" ? (
          <span className="zp-checked">Checked against your memories</span>
        ) : null}
      </div>
      {result.memories.length > 0 || result.alsoCited.length > 0 ? (
        <MemoryList
          memories={result.memories}
          alsoCited={result.alsoCited}
          noteLinks={result.noteLinks}
          question={result.question}
        />
      ) : (
        <p className="zp-hint">No memory matched this question.</p>
      )}
    </>
  )
}

/** One reply (E16-B1): what was kept, then the answer, then what Zenod did in one line. */
function ReplyTurn({
  route,
  keep,
  result,
}: {
  route: MemorySendRoute
  keep: KeepState | null
  result: MemoryChatAnswer | null
}) {
  const did =
    route.action === "keep"
      ? "Kept as a new memory"
      : route.action === "both"
        ? "Kept the new part and answered the question"
        : "Answered from your memory · nothing saved"
  return (
    <div className="zp-turn">
      {keep ? <KeepLine keep={keep} route={route} /> : null}
      {result ? <AnswerTurn result={result} /> : null}
      <div className="zp-actions">
        <span className="zp-did" data-testid="memory-did">{did}</span>
        {result ? <span className="zp-time">{(result.ms / 1000).toFixed(1)} s</span> : null}
      </div>
    </div>
  )
}

export function MemoryChat() {
  const [turns, setTurns] = React.useState<Turn[]>([])
  const [draft, setDraft] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const nextId = React.useRef(1)
  const endRef = React.useRef<HTMLDivElement>(null)

  const updateKeep = React.useCallback((id: number, keep: KeepState) => {
    setTurns((all) =>
      all.map((turn) =>
        turn.id === id &&
        (turn.kind === "reply" || turn.kind === "pending" || turn.kind === "voice-note")
          ? { ...turn, keep }
          : turn
      )
    )
  }, [])
  const pollKeep = useKeepPolling(updateKeep)
  const pollVoice = useKeepPolling(updateKeep, voiceNoteStatus)

  React.useEffect(() => {
    if (turns.length > 0) endRef.current?.scrollIntoView?.({ block: "end" })
  }, [turns])

  const push = (turn: NewTurn) => {
    const id = nextId.current++
    setTurns((all) => [...all, { ...turn, id } as Turn])
    return id
  }

  async function send() {
    const message = draft.trim()
    if (!message || sending) return
    setDraft("")
    setSending(true)
    push({ kind: "message", text: message })
    const pendingId = push({ kind: "pending", route: null, keep: null, memories: null, text: "" })
    const updatePending = (change: (turn: Extract<Turn, { kind: "pending" }>) => Turn) =>
      setTurns((all) =>
        all.map((turn) => (turn.id === pendingId && turn.kind === "pending" ? change(turn) : turn))
      )
    try {
      const sent = await sendToMemory(message, {
        onRoute: (route) =>
          updatePending((turn) => ({ ...turn, route, keep: route.keep ? { state: "keeping" } : null })),
        onKept: (kept) =>
          updatePending((turn) => ({
            ...turn,
            keep: "error" in kept ? { state: "error", message: kept.error } : { state: "kept", receipt: kept },
          })),
        onMemories: (memories) => updatePending((turn) => ({ ...turn, memories })),
        onText: (text) => updatePending((turn) => ({ ...turn, text: turn.text + text })),
      })
      updatePending((turn) => ({
        id: turn.id,
        kind: "reply",
        route: sent.route,
        keep: !sent.kept
          ? sent.route.keep
            ? { state: "error", message: "Not saved. Send it again." }
            : null
          : "error" in sent.kept
            ? { state: "error", message: sent.kept.error }
            : { state: "kept", receipt: sent.kept },
        result: sent.answer,
      }))
      if (sent.kept && !("error" in sent.kept)) pollKeep(pendingId, sent.kept)
    } catch (error) {
      updatePending((turn) => ({
        id: turn.id,
        kind: "error",
        text:
          error instanceof MemoryChatError || error instanceof Error
            ? error.message
            : "Something went wrong. Try again.",
      }))
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="zp" aria-labelledby="memory-chat-heading">
      <div className="zp-head">
        <h2 id="memory-chat-heading">Talk to your memory.</h2>
        <p className="zp-lede">
          Tell Zenod something and it keeps it. Ask it something and it answers
          from your own notes, with the memories it used.
        </p>
      </div>
      <div className="zp-stage">
        <div className="zp-screen">
          <div className="zp-log" aria-live="polite">
            {turns.length === 0 ? (
              <p className="zp-empty">
                Try “The plumber is Ana, 612 445 019” or “Who is our plumber?”
              </p>
            ) : null}
            {turns.map((turn) =>
              turn.kind === "message" ? (
                <div key={turn.id} className="zp-msg zp-me">
                  {turn.text}
                </div>
              ) : turn.kind === "voice-note" ? (
                <div key={turn.id} className="zp-turn">
                  <div className="zp-msg zp-me zp-voice">
                    Voice note · {formatLength(turn.seconds)}
                  </div>
                  <KeepLine keep={turn.keep} retry="Record it again." />
                </div>
              ) : turn.kind === "pending" ? (
                <PendingTurn
                  key={turn.id}
                  route={turn.route}
                  keep={turn.keep}
                  memories={turn.memories}
                  text={turn.text}
                />
              ) : turn.kind === "error" ? (
                <p key={turn.id} className="zp-msg zp-z zp-warn" role="alert">
                  {turn.text}
                </p>
              ) : (
                <ReplyTurn key={turn.id} route={turn.route} keep={turn.keep} result={turn.result} />
              )
            )}
            <div ref={endRef} />
          </div>
          <form
            className="zp-compose"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <textarea
              aria-label="Message your memory"
              placeholder="Tell Zenod something, or ask your memory"
              value={draft}
              rows={1}
              maxLength={2000}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
            />
            <VoiceNoteButton
              onSent={(receipt, seconds) =>
                pollVoice(push({ kind: "voice-note", seconds, keep: { state: "keeping" } }), receipt)
              }
              onNotice={(text) => push({ kind: "error", text })}
            />
            <button
              type="submit"
              className="zp-send"
              disabled={!draft.trim() || sending}
            >
              Send
            </button>
          </form>
          <p className="zp-hint">
            Zenod decides: what you tell it is kept, what you ask is answered. A
            question is never saved.
          </p>
        </div>
      </div>
    </section>
  )
}
