import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import {
  askMemoryDesk,
  keepInMemory,
  keepStatus,
  lookUpInMemory,
  MemoryChatError,
  recordModeSwitch,
  presentAnswer,
  sendToMemory,
  talkFromHash,
  talkWithMemory,
  vaultLabel,
  type MemoryChatAnswer,
  type MemoryChatMemory,
  type MemoryDeskJob,
  type MemoryKeepReceipt,
  type MemorySendRoute,
  type MemoryTalkReply,
  type MemoryTalkTurn,
} from "@/lib/memory-chat"
import { litHash } from "@/lib/memory-graph"
import { formatLength, voiceNoteStatus } from "@/lib/voice-note"
import { VoiceNoteButton } from "@/components/voice-note-button"
import { CallButton, CallPanel, useMemoryCall } from "@/components/memory-call"
import type { CallApi, CallMedia } from "@/lib/memory-call"

// EPIC-12 E12-S1: the hosted app opens on this chat. It answers from your memory and shows
// the memories it used with their match percentages and links. EPIC-16 E16-B1: one Send button;
// Zenod decides from the message whether to keep it, answer it, or both, and says which it did
// (a question is never kept). Styled in the product deck's paper language (docs/epic12/DESIGN-LANGUAGE.md).
// E12-S1b: the memories show as soon as they are found and the answer streams in, marked as a
// draft until Zenod has checked each citation against the memory it names.
// E12-S13: "Show in graph" opens the Graph tab with the answer's memories lit up.
// EPIC-14 S3: a job on the memory ("untangle Idealista and Poly-Maker") goes to the memory desk and
// shows in the inbox at once; when Zenod is unsure it asks "keep it, or do it as a job?". "Ask the
// desk" beside Send starts a job from what is written, without the decision.
// EPIC-22 E22-2: Zenod is the librarian of your memory. One box; Zenod picks Keep, Look up, Talk it
// over or Job on the memory, labels each reply Kept, Looked up, Talking or Job sent, and a tap on the
// label redoes the same message another way ("Make it a job" replaces "Ask the desk"). Talk it over
// is a read-only talk with a persona; it also starts from a persona or inbox card (#chat?talk=…).

type KeepState =
  | { state: "idle" }
  | { state: "keeping" }
  | { state: "kept"; receipt: MemoryKeepReceipt }
  | { state: "error"; message: string }

type DeskState =
  | { state: "asking" }
  | { state: "starting" }
  | { state: "started"; job: MemoryDeskJob }
  | { state: "error"; message: string }

type Turn =
  | { id: number; kind: "message"; text: string }
  | {
      id: number
      kind: "pending"
      message: string
      route: MemorySendRoute | null
      keep: KeepState | null
      memories: MemoryChatMemory[] | null
      text: string
    }
  | {
      id: number
      kind: "reply"
      message: string
      route: MemorySendRoute
      keep: KeepState | null
      result: MemoryChatAnswer | null
      desk?: DeskState | null
      talk?: MemoryTalkReply | null
      /** Zenod picked this reply's mode from the box (not a talk turn, not a redo). */
      picked?: boolean
    }
  | { id: number; kind: "note"; text: string }
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
  heading,
}: {
  heading?: string
  memories: MemoryChatMemory[]
  alsoCited?: MemoryChatAnswer["alsoCited"]
  noteLinks?: MemoryChatAnswer["noteLinks"]
  /** Set once the answer is in: offers "Show in graph" with these memories lit. */
  question?: string
}) {
  return (
    <div className="zp-used" aria-label="Memories used">
      <p className="zp-usedhead">
        {heading
          ? heading
          : memories.length > 0
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
  const talking = route?.action === "talk"
  const asking = route?.question != null
  return (
    <div className="zp-turn">
      {route && keep ? <KeepLine keep={keep} route={route} /> : null}
      {talking && text ? (
        <div className="zp-msg zp-z zp-draft" data-testid="memory-talk-draft">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={answerLinks}>
            {presentAnswer(text, memories ?? [])}
          </ReactMarkdown>
        </div>
      ) : null}
      {!route || (asking && !text) || (talking && !text) ? (
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
      ) : result.about === "zenod" ? null : (
        <p className="zp-hint">No memory matched this question.</p>
      )}
    </>
  )
}

/** The memory desk's part of a reply (EPIC-14 S3): the job it started, or the question when unsure. */
function DeskLine({
  desk,
  onChoose,
}: {
  desk: DeskState
  onChoose: (choice: "keep" | "job") => void
}) {
  if (desk.state === "asking")
    return (
      <div className="zp-msg zp-z" data-testid="memory-desk">
        <p>Keep this as a memory, or should the memory desk do it as a job on your memory?</p>
        <div className="zp-row">
          <button type="button" className="zp-deskbtn" onClick={() => onChoose("keep")}>
            Keep it
          </button>
          <button type="button" className="zp-send" onClick={() => onChoose("job")}>
            Do it as a job
          </button>
        </div>
      </div>
    )
  if (desk.state === "starting")
    return <p className="zp-keepnote" data-testid="memory-desk">Passing it to the memory desk…</p>
  if (desk.state === "error")
    return <p className="zp-keepnote zp-warn" data-testid="memory-desk">{desk.message}</p>
  return (
    <div className="zp-msg zp-z" data-testid="memory-desk">
      <p>
        That is a job on your memory, so I passed it to the memory desk. You
        will see it in your inbox.
      </p>
      <p className="zp-keepnote">
        <b>Working</b> · {desk.job.title} · <a href="#inbox">Open the inbox</a>
      </p>
    </div>
  )
}

export type ChatMode = "keep" | "lookup" | "talk" | "job"

/** The four modes (EPIC-22): the label on a reply, and how the switch menu offers each. */
export const CHAT_MODES: Record<ChatMode, { label: string; verb: string; hint: string }> = {
  keep: { label: "Kept", verb: "Keep it", hint: "Save it as a new memory" },
  lookup: { label: "Looked up", verb: "Look it up", hint: "Answer it from your memory" },
  talk: { label: "Talking", verb: "Talk it over", hint: "Think it through with a persona, nothing is changed" },
  job: { label: "Job sent", verb: "Make it a job", hint: "The memory desk re-files, splits or joins" },
}
const MODE_ORDER: ChatMode[] = ["keep", "lookup", "talk", "job"]

/** What a reply did, as mode labels: empty while Zenod waits on "keep it, or a job?", and for "who are you?". */
export function replyModes(route: MemorySendRoute, result: MemoryChatAnswer | null, desk?: DeskState | null, keep?: KeepState | null): ChatMode[] {
  if (route.action === "talk") return ["talk"]
  if (route.action === "job") return ["job"]
  if (route.action === "unsure") return desk?.state === "asking" ? [] : desk ? ["job"] : keep ? ["keep"] : []
  if (route.action === "keep") return ["keep"]
  if (route.action === "both") return ["keep", "lookup"]
  return result?.about === "zenod" ? [] : ["lookup"]
}

/** The label on a reply; a tap opens "Do it another way" and redoes the message in the mode picked. */
function ModeChip({ modes, onSwitch }: { modes: ChatMode[]; onSwitch: (mode: ChatMode) => void }) {
  const [open, setOpen] = React.useState(false)
  // Near the bottom of the chat the menu opens upward, so the scrolling log never cuts it off.
  const [up, setUp] = React.useState(false)
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", escape)
    }
  }, [open])
  return (
    <span className="zp-modewrap" ref={ref}>
      <button
        type="button"
        className={`zp-chip zp-chip-${modes[modes.length - 1]}`}
        data-testid="memory-mode"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const log = ref.current?.closest(".zp-log")?.getBoundingClientRect()
          const at = ref.current?.getBoundingClientRect()
          setUp(Boolean(log && at && at.bottom > log.top + log.height / 2))
          setOpen((was) => !was)
        }}
      >
        {modes.map((mode) => CHAT_MODES[mode].label).join(" · ")}
        <span aria-hidden="true"> ▾</span>
      </button>
      {open ? (
        <span className={up ? "zp-modemenu zp-modemenu-up" : "zp-modemenu"} role="menu" aria-label="Do it another way">
          <span className="zp-modemenu-k">Do it another way</span>
          {MODE_ORDER.map((mode) => (
            <button
              key={mode}
              type="button"
              role="menuitem"
              aria-current={modes.length === 1 && modes[0] === mode ? "true" : undefined}
              onClick={() => {
                setOpen(false)
                onSwitch(mode)
              }}
            >
              <b>{CHAT_MODES[mode].verb}</b>
              <span>{CHAT_MODES[mode].hint}</span>
            </button>
          ))}
          {modes.includes("keep") ? (
            <span className="zp-modemenu-note">What was kept stays kept.</span>
          ) : null}
        </span>
      ) : null}
    </span>
  )
}

/** A Talk it over reply (EPIC-22): the persona's words, then the memories it read. */
function TalkTurn({ talk }: { talk: MemoryTalkReply }) {
  return (
    <>
      <div className={talk.talked ? "zp-msg zp-z" : "zp-msg zp-z zp-none"} data-testid="memory-talk">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={answerLinks}>
          {presentAnswer(talk.text, talk.memories)}
        </ReactMarkdown>
      </div>
      {talk.memories.length > 0 ? (
        <MemoryList memories={talk.memories} heading="Memories it read" />
      ) : null}
    </>
  )
}

/** One reply: its mode label, what was kept, the answer or the talk, then what Zenod did in one line. */
function ReplyTurn({
  route,
  keep,
  result,
  desk,
  talk,
  onDeskChoice,
  onSwitch,
}: {
  route: MemorySendRoute
  keep: KeepState | null
  result: MemoryChatAnswer | null
  desk?: DeskState | null
  talk?: MemoryTalkReply | null
  onDeskChoice: (choice: "keep" | "job") => void
  onSwitch: (mode: ChatMode) => void
}) {
  const modes = replyModes(route, result, desk, keep)
  const did =
    route.action === "talk"
      ? "Read your memory · nothing saved or changed"
      : route.action === "job"
        ? desk?.state === "error"
          ? "Not passed to the memory desk"
          : "Passed to the memory desk · nothing saved"
        : route.action === "unsure"
          ? desk?.state === "asking"
            ? "Waiting for you: keep it, or do it as a job"
            : desk
              ? "Passed to the memory desk · nothing saved"
              : "Kept as a new memory"
          : route.action === "keep"
            ? "Kept as a new memory"
            : route.action === "both"
              ? "Kept the new part and answered the question"
              : result?.about === "zenod"
                ? "About Zenod · nothing saved"
                : "Answered from your memory · nothing saved"
  return (
    <div className="zp-turn">
      <div className="zp-modehead">
        {modes.length > 0 ? (
          <ModeChip modes={modes} onSwitch={onSwitch} />
        ) : result?.about === "zenod" ? (
          <span className="zp-direct" data-testid="memory-mode">Answered directly</span>
        ) : null}
        {route.action === "talk" && talk ? (
          <span className="zp-who">with {talk.persona.name}</span>
        ) : null}
      </div>
      {desk ? <DeskLine desk={desk} onChoose={onDeskChoice} /> : null}
      {keep ? <KeepLine keep={keep} route={route} /> : null}
      {result ? <AnswerTurn result={result} /> : null}
      {talk ? <TalkTurn talk={talk} /> : null}
      <div className="zp-actions">
        <span className="zp-did" data-testid="memory-did">{did}</span>
        {result ? <span className="zp-time">{(result.ms / 1000).toFixed(1)} s</span> : null}
        {talk ? <span className="zp-time">{(talk.ms / 1000).toFixed(1)} s</span> : null}
      </div>
    </div>
  )
}

type Talking = { persona: string | null; name: string; history: MemoryTalkTurn[] }

const failureText = (error: unknown) =>
  error instanceof MemoryChatError || error instanceof Error
    ? error.message
    : "Something went wrong. Try again."

export function MemoryChat({ call: callDeps }: { call?: { api?: CallApi; media?: CallMedia } } = {}) {
  const call = useMemoryCall(callDeps)
  const [turns, setTurns] = React.useState<Turn[]>([])
  const [draft, setDraft] = React.useState("")
  const [sending, setSending] = React.useState(false)
  // EPIC-22: a talk in progress; the box replies to the persona until the talk ends.
  const [talking, setTalking] = React.useState<Talking | null>(null)
  const talkingRef = React.useRef<Talking | null>(null)
  talkingRef.current = talking
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

  const replace = (id: number, turn: NewTurn) =>
    setTurns((all) => all.map((old) => (old.id === id ? ({ ...turn, id } as Turn) : old)))

  const updatePendingOf = (id: number) => (change: (turn: Extract<Turn, { kind: "pending" }>) => Turn) =>
    setTurns((all) =>
      all.map((turn) => (turn.id === id && turn.kind === "pending" ? change(turn) : turn))
    )

  const updateDesk = (id: number, desk: DeskState | null, keep?: KeepState) =>
    setTurns((all) =>
      all.map((turn) =>
        turn.id === id && turn.kind === "reply"
          ? { ...turn, desk, ...(keep ? { keep } : {}) }
          : turn
      )
    )

  async function startJob(id: number, description: string) {
    updateDesk(id, { state: "starting" })
    try {
      updateDesk(id, { state: "started", job: await askMemoryDesk(description) })
    } catch (error) {
      updateDesk(id, { state: "error", message: failureText(error) })
    }
  }

  // Zenod was unsure: the person chose to keep the message, or to have the desk do it.
  async function chooseDesk(id: number, route: MemorySendRoute, choice: "keep" | "job") {
    const text = route.job ?? ""
    if (choice === "job") return startJob(id, text)
    updateDesk(id, null, { state: "keeping" })
    try {
      const receipt = await keepInMemory(text)
      updateDesk(id, null, { state: "kept", receipt })
      pollKeep(id, receipt)
    } catch (error) {
      updateDesk(id, null, { state: "error", message: failureText(error) })
    }
  }

  /** One talk turn into turn `id`: the persona's reply streams in, then joins the talk's history. */
  async function talkTurn(id: number, message: string, talk: Talking, opener = false) {
    const update = updatePendingOf(id)
    const route: MemorySendRoute = { action: "talk", keep: null, question: null, talk: message, by: "rules" }
    update((turn) => ({ ...turn, route }))
    try {
      const reply = await talkWithMemory(
        { message, persona: talk.persona, history: talk.history, opener },
        {
          onMemories: (memories) => update((turn) => ({ ...turn, memories })),
          onText: (text) => update((turn) => ({ ...turn, text: turn.text + text })),
        }
      )
      replace(id, { kind: "reply", message, route, keep: null, result: null, desk: null, talk: reply })
      const history: MemoryTalkTurn[] = [
        ...talk.history,
        ...(message ? [{ role: "person" as const, text: message }] : []),
        ...(reply.talked ? [{ role: "persona" as const, text: reply.text }] : []),
      ]
      setTalking({ persona: reply.persona.id === "zenod" ? null : reply.persona.id, name: reply.persona.name, history })
    } catch (error) {
      replace(id, { kind: "error", text: failureText(error) })
    }
  }

  // A talk started from a persona or inbox card (`#chat?talk=…`): the persona speaks first.
  const startTalk = React.useCallback((persona: string, about: string) => {
    window.history.replaceState(null, "", window.location.pathname + window.location.search + "#chat")
    const talk: Talking = { persona, name: persona, history: [] }
    setTalking(talk)
    push({ kind: "note", text: about ? `You started a talk about “${about}”` : "You started a talk from Personas" })
    const id = push({ kind: "pending", message: about, route: null, keep: null, memories: null, text: "" })
    void talkTurn(id, about, talk, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  React.useEffect(() => {
    const check = () => {
      const start = talkFromHash(window.location.hash)
      if (start) startTalk(start.persona, start.about)
    }
    check()
    window.addEventListener("hashchange", check)
    return () => window.removeEventListener("hashchange", check)
  }, [startTalk])

  /** The label menu: redo the same message in another mode, in place of its reply. */
  async function redo(id: number, message: string, mode: ChatMode, picked: MemorySendRoute | null = null) {
    if (sending) return
    // E22-L3: each switch away from Zenod's pick is recorded, so the pick can be tuned from them.
    if (picked) void recordModeSwitch(message, picked.action, picked.by, mode)
    if (mode !== "talk" && talkingRef.current) setTalking(null)
    replace(id, { kind: "pending", message, route: null, keep: null, memories: null, text: "" })
    const update = updatePendingOf(id)
    try {
      if (mode === "talk") {
        const talk = talkingRef.current ?? { persona: null, name: "Zenod", history: [] }
        return await talkTurn(id, message, talk)
      }
      if (mode === "keep") {
        const route: MemorySendRoute = { action: "keep", keep: message, question: null, by: "rules" }
        update((turn) => ({ ...turn, route, keep: { state: "keeping" } }))
        const receipt = await keepInMemory(message)
        replace(id, { kind: "reply", message, route, keep: { state: "kept", receipt }, result: null, desk: null })
        pollKeep(id, receipt)
        return
      }
      if (mode === "job") {
        const route: MemorySendRoute = { action: "job", keep: null, question: null, job: message, by: "rules" }
        replace(id, { kind: "reply", message, route, keep: null, result: null, desk: { state: "starting" } })
        return await startJob(id, message)
      }
      const route: MemorySendRoute = { action: "answer", keep: null, question: message, by: "rules" }
      update((turn) => ({ ...turn, route }))
      const result = await lookUpInMemory(message, {
        onMemories: (memories) => update((turn) => ({ ...turn, memories })),
        onText: (text) => update((turn) => ({ ...turn, text: turn.text + text })),
      })
      replace(id, { kind: "reply", message, route, keep: null, result, desk: null })
    } catch (error) {
      replace(id, { kind: "error", text: failureText(error) })
    }
  }

  async function send() {
    const message = draft.trim()
    if (!message || sending) return
    setDraft("")
    setSending(true)
    push({ kind: "message", text: message })
    const pendingId = push({ kind: "pending", message, route: null, keep: null, memories: null, text: "" })
    try {
      // In a talk, the box replies to the persona.
      if (talkingRef.current) return await talkTurn(pendingId, message, talkingRef.current)
      const updatePending = updatePendingOf(pendingId)
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
      replace(pendingId, {
        kind: "reply",
        message,
        picked: true,
        route: sent.route,
        keep: !sent.kept
          ? sent.route.keep
            ? { state: "error", message: "Not saved. Send it again." }
            : null
          : "error" in sent.kept
            ? { state: "error", message: sent.kept.error }
            : { state: "kept", receipt: sent.kept },
        result: sent.answer,
        talk: sent.talk ?? null,
        desk:
          sent.route.action === "job"
            ? sent.desk && !("error" in sent.desk)
              ? { state: "started", job: sent.desk }
              : { state: "error", message: sent.desk?.error ?? "The memory desk could not take that just now. Try again in a moment." }
            : sent.route.action === "unsure"
              ? { state: "asking" }
              : null,
      })
      if (sent.kept && !("error" in sent.kept)) pollKeep(pendingId, sent.kept)
      // Zenod picked Talk it over: the talk goes on with the librarian until it ends.
      if (sent.talk?.talked) {
        setTalking({
          persona: null,
          name: sent.talk.persona.name,
          history: [
            { role: "person", text: message },
            { role: "persona", text: sent.talk.text },
          ],
        })
      }
    } catch (error) {
      replace(pendingId, { kind: "error", text: failureText(error) })
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="zp zp-librarian" aria-label="Talk to your librarian">
      <div className="zp-stage">
        <div className="zp-screen">
          <div className="zp-log" aria-live="polite">
            {turns.length === 0 ? (
              <p className="zp-empty">
                Tell me something and I keep it. Ask and I look it up. Want to
                think out loud? We talk it over. Something filed wrong? I make it
                a job. Try “who are you?”
              </p>
            ) : null}
            {turns.map((turn) =>
              turn.kind === "message" ? (
                <div key={turn.id} className="zp-msg zp-me">
                  {turn.text}
                </div>
              ) : turn.kind === "note" ? (
                <p key={turn.id} className="zp-talknote">
                  {turn.text}
                </p>
              ) : turn.kind === "voice-note" ? (
                <div key={turn.id} className="zp-turn">
                  <div className="zp-msg zp-me zp-voice">
                    Voice note · {formatLength(turn.seconds)}
                  </div>
                  <div className="zp-modehead">
                    <span className="zp-chip zp-chip-keep zp-chip-still">Kept</span>
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
                <ReplyTurn
                  key={turn.id}
                  route={turn.route}
                  keep={turn.keep}
                  result={turn.result}
                  desk={turn.desk ?? null}
                  talk={turn.talk ?? null}
                  onDeskChoice={(choice) => void chooseDesk(turn.id, turn.route, choice)}
                  onSwitch={(mode) => void redo(turn.id, turn.message, mode, turn.picked ? turn.route : null)}
                />
              )
            )}
            <div ref={endRef} />
          </div>
          <CallPanel call={call} />
          {talking ? (
            <p className="zp-talkbar" data-testid="memory-talkbar">
              Talking with <b>{talking.name}</b> · it reads your memory, nothing is changed{" "}
              <button type="button" className="zp-link" onClick={() => setTalking(null)}>
                End the talk
              </button>
            </p>
          ) : null}
          <form
            className="zp-compose"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <VoiceNoteButton
              onSent={(receipt, seconds) =>
                pollVoice(push({ kind: "voice-note", seconds, keep: { state: "keeping" } }), receipt)
              }
              onNotice={(text) => push({ kind: "error", text })}
            />
            <textarea
              aria-label="Talk to your librarian"
              placeholder={talking ? `Reply to ${talking.name}…` : "Talk to your librarian"}
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
            <CallButton call={call} onNotice={(text) => push({ kind: "error", text })} />
            <button
              type="submit"
              className="zp-send"
              disabled={!draft.trim() || sending}
            >
              Send
            </button>
          </form>
          <p className="zp-hint">
            Zenod picks the mode and says which. Tap the label to change it.
          </p>
        </div>
      </div>
    </section>
  )
}
