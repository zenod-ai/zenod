import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import {
  askMemoryStream,
  keepAnswer,
  keepNote,
  keepStatus,
  MemoryChatError,
  presentAnswer,
  vaultLabel,
  type MemoryChatAnswer,
  type MemoryChatMemory,
  type MemoryKeepReceipt,
} from "@/lib/memory-chat"

// EPIC-12 E12-S1: the hosted app opens on this chat. It answers from your memory, shows
// the memories it used with their match percentages and links, and saves nothing unless
// you tap Keep. Styled in the product deck's paper language (docs/epic12/DESIGN-LANGUAGE.md).
// E12-S1b: the memories show as soon as they are found and the answer streams in, marked as a
// draft until Zenod has checked each citation against the memory it names.

type KeepState =
  | { state: "idle" }
  | { state: "keeping" }
  | { state: "kept"; receipt: MemoryKeepReceipt }
  | { state: "error"; message: string }

type Turn =
  | { id: number; kind: "question"; text: string }
  | { id: number; kind: "answer"; result: MemoryChatAnswer; keep: KeepState }
  | {
      id: number
      kind: "pending"
      question: string
      memories: MemoryChatMemory[] | null
      text: string
    }
  | { id: number; kind: "kept-note"; text: string; keep: KeepState }
  | { id: number; kind: "error"; text: string }

type NewTurn = Turn extends infer T
  ? T extends Turn
    ? Omit<T, "id">
    : never
  : never

const KEEP_POLL_MS = 1500
const KEEP_POLL_TRIES = 40

function useKeepPolling(
  update: (id: number, keep: KeepState) => void
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
        keepStatus(first.id)
          .then((receipt) => {
            if (!alive.current) return
            update(turnId, { state: "kept", receipt })
            if (receipt.status === "saving") setTimeout(tick, KEEP_POLL_MS)
          })
          .catch(() => setTimeout(tick, KEEP_POLL_MS))
      }
      setTimeout(tick, KEEP_POLL_MS)
    },
    [update]
  )
}

function KeepLine({ keep }: { keep: KeepState }) {
  if (keep.state === "keeping")
    return <span className="zp-keepnote">Keeping…</span>
  if (keep.state === "error")
    return <span className="zp-keepnote zp-warn">{keep.message}</span>
  if (keep.state !== "kept") return null
  const { receipt } = keep
  if (receipt.status === "saving")
    return <span className="zp-keepnote">Kept. Filing it in your vault…</span>
  if (receipt.status === "failed")
    return (
      <span className="zp-keepnote zp-warn">Not saved. Try Keep again.</span>
    )
  return (
    <span className="zp-keepnote">
      Kept ✓ Saved to your vault.
      {receipt.noteUrl ? (
        <>
          {" "}
          <a href={receipt.noteUrl} target="_blank" rel="noreferrer">
            Open it
          </a>
        </>
      ) : null}
    </span>
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
}: {
  memories: MemoryChatMemory[]
  alsoCited?: MemoryChatAnswer["alsoCited"]
  noteLinks?: MemoryChatAnswer["noteLinks"]
}) {
  return (
    <div className="zp-used" aria-label="Memories used">
      <p className="zp-usedhead">
        {memories.length > 0
          ? memories.length > 5
            ? "Memories for this question"
            : `Top ${memories.length} memories for this question`
          : "Memories cited"}
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
  memories,
  text,
}: {
  memories: MemoryChatMemory[] | null
  text: string
}) {
  return (
    <div className="zp-turn">
      {text ? (
        <div className="zp-msg zp-z zp-draft" data-testid="memory-draft">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={answerLinks}>
            {presentAnswer(text, memories ?? [])}
          </ReactMarkdown>
          <span className="zp-checking">Checking against your memories…</span>
        </div>
      ) : (
        <div className="zp-msg zp-z zp-typing" aria-label="Zenod is answering">
          <i />
          <i />
          <i />
        </div>
      )}
      {memories && memories.length > 0 ? <MemoryList memories={memories} /> : null}
    </div>
  )
}

function AnswerTurn({
  result,
  keep,
  onKeep,
}: {
  result: MemoryChatAnswer
  keep: KeepState
  onKeep: () => void
}) {
  return (
    <div className="zp-turn">
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
        />
      ) : (
        <p className="zp-hint">No memory matched this question.</p>
      )}
      <div className="zp-actions">
        {result.answered ? (
          <button
            type="button"
            className="zp-keep"
            onClick={onKeep}
            disabled={
              keep.state === "keeping" ||
              (keep.state === "kept" && keep.receipt.status !== "failed")
            }
          >
            {keep.state === "kept" && keep.receipt.status !== "failed"
              ? "Kept"
              : "Keep"}
          </button>
        ) : null}
        <KeepLine keep={keep} />
        <span className="zp-time">{(result.ms / 1000).toFixed(1)} s</span>
      </div>
    </div>
  )
}

export function MemoryChat() {
  const [turns, setTurns] = React.useState<Turn[]>([])
  const [draft, setDraft] = React.useState("")
  const [asking, setAsking] = React.useState(false)
  const nextId = React.useRef(1)
  const endRef = React.useRef<HTMLDivElement>(null)

  const updateKeep = React.useCallback((id: number, keep: KeepState) => {
    setTurns((all) =>
      all.map((turn) =>
        turn.id === id && (turn.kind === "answer" || turn.kind === "kept-note")
          ? { ...turn, keep }
          : turn
      )
    )
  }, [])
  const pollKeep = useKeepPolling(updateKeep)

  React.useEffect(() => {
    if (turns.length > 0) endRef.current?.scrollIntoView?.({ block: "end" })
  }, [turns])

  const push = (turn: NewTurn) => {
    const id = nextId.current++
    setTurns((all) => [...all, { ...turn, id } as Turn])
    return id
  }

  async function ask() {
    const question = draft.trim()
    if (!question || asking) return
    setDraft("")
    setAsking(true)
    push({ kind: "question", text: question })
    const pendingId = push({ kind: "pending", question, memories: null, text: "" })
    const updatePending = (change: (turn: Extract<Turn, { kind: "pending" }>) => Turn) =>
      setTurns((all) =>
        all.map((turn) => (turn.id === pendingId && turn.kind === "pending" ? change(turn) : turn))
      )
    try {
      const result = await askMemoryStream(question, {
        onMemories: (memories) => updatePending((turn) => ({ ...turn, memories })),
        onText: (text) => updatePending((turn) => ({ ...turn, text: turn.text + text })),
      })
      updatePending((turn) => ({ id: turn.id, kind: "answer", result, keep: { state: "idle" } }))
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
      setAsking(false)
    }
  }

  async function keepTyped() {
    const content = draft.trim()
    if (!content || asking) return
    setDraft("")
    const id = push({
      kind: "kept-note",
      text: content,
      keep: { state: "keeping" },
    })
    try {
      pollKeep(id, await keepNote(content))
    } catch (error) {
      updateKeep(id, {
        state: "error",
        message: error instanceof Error ? error.message : "Not saved.",
      })
    }
  }

  async function keepTurn(id: number, result: MemoryChatAnswer) {
    updateKeep(id, { state: "keeping" })
    try {
      pollKeep(id, await keepAnswer(result.question, result.answer))
    } catch (error) {
      updateKeep(id, {
        state: "error",
        message: error instanceof Error ? error.message : "Not saved.",
      })
    }
  }

  return (
    <section className="zp" aria-labelledby="memory-chat-heading">
      <div className="zp-head">
        <h2 id="memory-chat-heading">Ask your memory.</h2>
        <p className="zp-lede">
          Zenod answers from your own notes and shows the memories it used, with
          how strongly each one matches.
        </p>
      </div>
      <div className="zp-stage">
        <div className="zp-screen">
          <div className="zp-log" aria-live="polite">
            {turns.length === 0 ? (
              <p className="zp-empty">
                Try “What did I decide about the garden shed?” or “Who is our
                plumber?”
              </p>
            ) : null}
            {turns.map((turn) =>
              turn.kind === "question" ? (
                <div key={turn.id} className="zp-msg zp-me">
                  {turn.text}
                </div>
              ) : turn.kind === "kept-note" ? (
                <div key={turn.id} className="zp-turn">
                  <div className="zp-msg zp-me">{turn.text}</div>
                  <div className="zp-actions zp-right">
                    <KeepLine keep={turn.keep} />
                  </div>
                </div>
              ) : turn.kind === "pending" ? (
                <PendingTurn key={turn.id} memories={turn.memories} text={turn.text} />
              ) : turn.kind === "error" ? (
                <p key={turn.id} className="zp-msg zp-z zp-warn" role="alert">
                  {turn.text}
                </p>
              ) : (
                <AnswerTurn
                  key={turn.id}
                  result={turn.result}
                  keep={turn.keep}
                  onKeep={() => keepTurn(turn.id, turn.result)}
                />
              )
            )}
            <div ref={endRef} />
          </div>
          <form
            className="zp-compose"
            onSubmit={(event) => {
              event.preventDefault()
              void ask()
            }}
          >
            <textarea
              aria-label="Ask your memory, or write something to keep"
              placeholder="Ask your memory, or write something to keep"
              value={draft}
              rows={1}
              maxLength={2000}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void ask()
                }
              }}
            />
            <button
              type="button"
              className="zp-keep"
              disabled={!draft.trim() || asking}
              onClick={() => void keepTyped()}
            >
              Keep
            </button>
            <button
              type="submit"
              className="zp-send"
              disabled={!draft.trim() || asking}
            >
              Ask
            </button>
          </form>
          <p className="zp-hint">
            Asking saves nothing. Tap Keep to save a note or an answer to your
            vault.
          </p>
        </div>
      </div>
    </section>
  )
}
