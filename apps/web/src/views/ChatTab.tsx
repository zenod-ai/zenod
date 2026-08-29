import * as React from "react"
import {
  BrainIcon,
  CheckIcon,
  ExternalLinkIcon,
  FileTextIcon,
  MicIcon,
  SendIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react"
import type { Element, Parent, Root, RootContent, Text } from "hast"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { visit } from "unist-util-visit"

import {
  api,
  chatStream,
  errorMessage,
  isNotConfigured,
  transcribeVoiceNote,
  type ChatHistoryResponse,
  type ChatSource,
  type ChatStored,
  type ChatToolEvent,
} from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"

const OBSIDIAN_LINK_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g
const SAFE_OBSIDIAN_URL_RE = /^obsidian:\/\/open\?path=[^"'<>]+(?:#[^"'<>]+)?$/

type ObsidianLinkParts = {
  display: string
  href: string
  embedded: boolean
}

function rehypeObsidianWikilinks() {
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent: Parent | undefined) => {
      if (index === undefined || !parent || !node.value.includes("[["))
        return
      if (isInsideLiteralMarkdown(parent)) return

      OBSIDIAN_LINK_RE.lastIndex = 0
      const next: RootContent[] = []
      let cursor = 0
      let match: RegExpExecArray | null

      while ((match = OBSIDIAN_LINK_RE.exec(node.value)) !== null) {
        const [raw, embedMarker = "", body = ""] = match
        const start = match.index
        if (start > cursor) {
          next.push({ type: "text", value: node.value.slice(cursor, start) })
        }

        const parsed = parseObsidianLink(body, embedMarker === "!")
        if (parsed) next.push(obsidianLinkNode(parsed))
        else next.push({ type: "text", value: raw })
        cursor = start + raw.length
      }

      if (cursor < node.value.length) {
        next.push({ type: "text", value: node.value.slice(cursor) })
      }

      parent.children.splice(index, 1, ...next)
    })
  }
}

function isInsideLiteralMarkdown(parent: Parent): boolean {
  if (parent.type !== "element") return false
  const tagName = (parent as Element).tagName
  return ["a", "code", "kbd", "pre", "samp"].includes(tagName)
}

function parseObsidianLink(
  body: string,
  embedded: boolean
): ObsidianLinkParts | null {
  const [rawTarget = "", rawAlias] = body.split("|", 2)
  const target = rawTarget.trim()
  if (!target) return null

  const display = (rawAlias?.trim() || targetDisplayName(target)).trim()
  return {
    display,
    href: obsidianOpenUrl(target),
    embedded,
  }
}

function targetDisplayName(target: string): string {
  const [path = "", subpath] = target.split("#", 2)
  const name = (path.split("/").pop() || path).replace(/\.md$/i, "")
  if (subpath) return `${name}#${subpath}`
  return name
}

function obsidianOpenUrl(target: string): string {
  const [rawPath = "", rawSubpath] = target.split("#", 2)
  const path = rawPath.endsWith(".md") ? rawPath : `${rawPath}.md`
  const url = `obsidian://open?path=${encodeURIComponent(path)}`
  return rawSubpath ? `${url}#${encodeURIComponent(rawSubpath)}` : url
}

function obsidianLinkNode({
  display,
  href,
  embedded,
}: ObsidianLinkParts): Element {
  return {
    type: "element",
    tagName: "a",
    properties: {
      href,
      title: embedded
        ? "Open embedded note in Obsidian"
        : "Open note in Obsidian",
      className: embedded
        ? ["obsidian-link", "obsidian-link-embed"]
        : ["obsidian-link"],
      dataObsidianLink: "true",
    },
    children: [{ type: "text", value: display }],
  }
}

function markdownUrlTransform(value: string): string {
  if (SAFE_OBSIDIAN_URL_RE.test(value)) return value
  return defaultUrlTransform(value)
}

function AssistantMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeObsidianWikilinks]}
      urlTransform={markdownUrlTransform}
      components={{
        p: (props) => <p className="my-1.5 first:mt-0 last:mb-0" {...props} />,
        ul: (props) => <ul className="my-1.5 list-disc pl-5" {...props} />,
        ol: (props) => <ol className="my-1.5 list-decimal pl-5" {...props} />,
        li: (props) => <li className="my-0.5" {...props} />,
        h1: (props) => <p className="mt-2 mb-1 font-semibold" {...props} />,
        h2: (props) => <p className="mt-2 mb-1 font-semibold" {...props} />,
        h3: (props) => <p className="mt-2 mb-1 font-semibold" {...props} />,
        a: ({ className, children, node, ...props }) => {
          void node
          return className?.split(" ").includes("obsidian-link") ? (
            <a
              className="inline-flex max-w-full items-baseline gap-1 align-baseline font-semibold text-sky-300 underline decoration-sky-300/60 underline-offset-3 transition-colors hover:text-sky-200 hover:decoration-sky-200"
              target="_blank"
              rel="noreferrer"
              {...props}
            >
              <FileTextIcon className="relative top-0.5 size-3 shrink-0 text-sky-300/80" />
              <span className="min-w-0 truncate">{children}</span>
            </a>
          ) : (
            <a
              className="underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
              {...props}
            >
              {children}
            </a>
          )
        },
        code: (props) => (
          <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.85em]" {...props} />
        ),
        pre: (props) => (
          <pre className="my-1.5 overflow-x-auto rounded-md bg-background/60 p-2 font-mono text-xs" {...props} />
        ),
        blockquote: (props) => (
          <blockquote className="my-1.5 border-l-2 border-border pl-3 text-muted-foreground" {...props} />
        ),
        table: (props) => <table className="my-1.5 w-full text-left text-xs" {...props} />,
        th: (props) => <th className="border-b border-border px-2 py-1 font-medium" {...props} />,
        td: (props) => <td className="border-b border-border/50 px-2 py-1" {...props} />,
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

type Message = {
  role: "user" | "assistant"
  text: string
  sources?: ChatSource[]
  stored?: ChatStored
  error?: boolean
  /** Label of the tool currently running this turn (null between/after tools). */
  activity?: string | null
  /** Tools that finished this turn, in order — shown as a quiet trail of steps. */
  steps?: string[]
}

function SourceLinks({ sources }: { sources: ChatSource[] }) {
  if (sources.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((source) => (
        <a
          key={source.path}
          href={source.url || undefined}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
        >
          {source.path}
          {source.url && <ExternalLinkIcon className="size-3" />}
        </a>
      ))}
    </div>
  )
}

function StoredReceipt({ stored }: { stored: ChatStored }) {
  const revisionLabel = stored.revision
    ? `${stored.revision.provider === "google_drive" ? "Drive" : "GitHub"} ${stored.revision.id}${stored.revision.provider === "google_drive" && stored.commitSha ? ` · git ${stored.commitSha.slice(0, 7)}` : ""}`
    : stored.commitSha
      ? stored.commitSha.slice(0, 7)
      : "saved"
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="secondary">memory stored</Badge>
      <span className="text-xs text-muted-foreground">
        {stored.pagesTouched.join(", ")} · {revisionLabel}
      </span>
    </div>
  )
}

const VOICE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
]

function preferredAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined
  return VOICE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
}

function voiceFilename(type: string): string {
  const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm"
  return `web-voice-note-${Date.now()}.${extension}`
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${remainder.toString().padStart(2, "0")}`
}

export function ChatTab({ vaultless = false, product = "default" }: { vaultless?: boolean; product?: "default" | "herald" } = {}) {
  const isHerald = product === "herald"
  const [messages, setMessages] = React.useState<Message[]>([])
  const [input, setInput] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)
  const [recording, setRecording] = React.useState(false)
  const [recordingSeconds, setRecordingSeconds] = React.useState(0)
  const [voiceTranscribing, setVoiceTranscribing] = React.useState(false)
  const [voiceError, setVoiceError] = React.useState<string | null>(null)
  const endRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const mediaStreamRef = React.useRef<MediaStream | null>(null)
  const voiceChunksRef = React.useRef<Blob[]>([])
  const recordingStartedAtRef = React.useRef(0)
  const recordingTimerRef = React.useRef<number | null>(null)

  const refreshHistory = React.useCallback(async () => {
    const history = await api<ChatHistoryResponse>("/api/chat/history")
    setMessages(history.messages.map((message) => ({ role: message.role, text: message.text })))
  }, [])

  // Rehydrate the thread from the server so navigating away and back keeps context.
  React.useEffect(() => {
    let cancelled = false
    void api<ChatHistoryResponse>("/api/chat/history")
      .then((history) => {
        if (cancelled) return
        setMessages(history.messages.map((m) => ({ role: m.role, text: m.text })))
      })
      .catch(() => {
        // No history yet, or not configured — start with an empty thread.
      })
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    const refresh = () => void refreshHistory().catch(() => {})
    window.addEventListener("herald:chat-refresh", refresh)
    return () => window.removeEventListener("herald:chat-refresh", refresh)
  }, [refreshHistory])

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, busy])

  React.useEffect(() => {
    return () => {
      clearRecordingTimer()
      stopMediaStream()
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop()
      }
    }
  }, [])

  function clearRecordingTimer() {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }

  function stopMediaStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
  }

  async function clearThread() {
    if (busy || clearing || recording || voiceTranscribing) return
    setClearing(true)
    try {
      await api("/api/chat", { method: "DELETE" })
      setMessages([])
    } catch {
      // Leave the thread in place if the clear failed.
    } finally {
      setClearing(false)
      textareaRef.current?.focus()
    }
  }

  // Update the streaming assistant message — always the last in the list while busy.
  function patchStreaming(patch: (last: Message) => Message) {
    setMessages((current) => {
      const next = current.slice()
      const last = next[next.length - 1]
      if (last && last.role === "assistant") next[next.length - 1] = patch(last)
      return next
    })
  }

  async function sendMessage(messageText: string, options: { clearInput?: boolean } = {}) {
    const message = messageText.trim()
    if (!message || busy) return
    if (options.clearInput !== false) setInput("")
    setVoiceError(null)
    // Append the user turn plus an empty assistant bubble to stream into.
    setMessages((current) => [
      ...current,
      { role: "user", text: message },
      { role: "assistant", text: "" },
    ])
    setBusy(true)
    try {
      await chatStream(message, {
        onDelta: (text) => patchStreaming((last) => ({ ...last, text: last.text + text })),
        onTool: (event: ChatToolEvent) =>
          patchStreaming((last) =>
            event.phase === "start"
              ? { ...last, activity: event.label }
              : {
                  ...last,
                  activity: null,
                  steps: [...(last.steps ?? []), event.label],
                }
          ),
        onDone: ({ text, sources, stored }) =>
          patchStreaming((last) => ({
            ...last,
            text,
            activity: null,
            sources,
            ...(stored ? { stored } : {}),
          })),
      })
    } catch (err) {
      const text = isNotConfigured(err)
        ? isHerald
          ? "Herald needs a model key before he can reply. Add it in Keys."
          : "Zenod is not fully configured yet — set the vault and API key in the other tabs first."
        : errorMessage(err)
      patchStreaming(() => ({ role: "assistant", text, error: true }))
    } finally {
      setBusy(false)
      textareaRef.current?.focus()
    }
  }

  async function send() {
    await sendMessage(input)
  }

  async function startVoiceRecording() {
    if (busy || voiceTranscribing || recording) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceError("Voice recording is not supported in this browser.")
      return
    }

    try {
      setVoiceError(null)
      // Default input device, but ask the browser to clean it up the way
      // phone mics do: auto-gain rescues a quiet mic (the main cause of
      // "couldn't make out any speech"), and noise/echo suppression cut ambient
      // hiss that Whisper otherwise hallucinates filler from.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: true, noiseSuppression: true, echoCancellation: true },
      })
      const mimeType = preferredAudioMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

      voiceChunksRef.current = []
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data)
      })
      recorder.addEventListener("error", () => {
        setVoiceError("Recording failed.")
        setRecording(false)
        clearRecordingTimer()
        stopMediaStream()
      })

      recordingStartedAtRef.current = Date.now()
      setRecordingSeconds(0)
      setRecording(true)
      recorder.start()
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.max(0, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)))
      }, 250)
    } catch (err) {
      stopMediaStream()
      mediaRecorderRef.current = null
      setRecording(false)
      setVoiceError(errorMessage(err))
    }
  }

  async function stopVoiceRecording() {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === "inactive") return

    setRecording(false)
    clearRecordingTimer()

    try {
      const audio = await new Promise<Blob>((resolve, reject) => {
        const type = recorder.mimeType || voiceChunksRef.current[0]?.type || "audio/webm"
        recorder.addEventListener(
          "stop",
          () => resolve(new Blob(voiceChunksRef.current, { type })),
          { once: true }
        )
        recorder.addEventListener("error", () => reject(new Error("Recording failed.")), {
          once: true,
        })
        recorder.stop()
      })
      stopMediaStream()
      mediaRecorderRef.current = null

      if (audio.size === 0) throw new Error("Recording was empty.")

      setVoiceTranscribing(true)
      const { transcript } = await transcribeVoiceNote(audio, voiceFilename(audio.type))
      setVoiceTranscribing(false)
      await sendMessage(transcript, { clearInput: false })
    } catch (err) {
      setVoiceError(errorMessage(err))
    } finally {
      setVoiceTranscribing(false)
      stopMediaStream()
      mediaRecorderRef.current = null
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {messages.length > 0 && (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={busy || clearing}
              onClick={() => void clearThread()}
            >
              <Trash2Icon className="size-3.5" />
              Clear conversation
            </Button>
          </div>
        )}
        <div className="flex max-h-[60svh] min-h-[40svh] flex-col gap-4 overflow-y-auto pr-1">
          {messages.length === 0 && !busy && (
            <Empty className="my-auto border-none">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BrainIcon />
                </EmptyMedia>
                <EmptyTitle>{isHerald ? "Talk with Herald" : "Talk to your brain"}</EmptyTitle>
                <EmptyDescription>
                  {isHerald ? "Brief Herald, review the same numbered Board items, approve selections, and follow publishing receipts here." : <>Ask anything stored in your vault, or say &ldquo;remember this: …&rdquo; to file a new memory.</>}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {messages.map((message, i) =>
            message.role === "user" ? (
              <div
                key={i}
                className="ml-auto max-w-[85%] animate-in fade-in slide-in-from-bottom-1 rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground shadow-sm duration-300"
              >
                {message.text}
              </div>
            ) : (
              <div key={i} className="flex max-w-[85%] animate-in fade-in slide-in-from-bottom-1 flex-col gap-2 duration-300">
                {/* Trail of tools that already finished this turn. */}
                {message.steps && message.steps.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {message.steps.map((step, s) => (
                      <div
                        key={s}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <CheckIcon className="size-3.5 text-emerald-500" />
                        {step}
                      </div>
                    ))}
                  </div>
                )}
                {/* The tool running right now. */}
                {message.activity && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner className="size-4" />
                    {message.activity}
                  </div>
                )}
                {message.text !== "" && (
                  <div
                    className={
                      message.error
                        ? "rounded-2xl rounded-bl-md bg-destructive/10 px-3.5 py-2 text-sm whitespace-pre-wrap text-destructive"
                        : "rounded-2xl rounded-bl-md bg-muted px-3.5 py-2 text-sm"
                    }
                  >
                    {message.error ? message.text : <AssistantMarkdown text={message.text} />}
                  </div>
                )}
                {/* Nothing yet and no tool running — first moments of the turn. */}
                {message.text === "" && !message.activity && !message.error && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner className="size-4" />
                    Working…
                  </div>
                )}
                {message.stored && <StoredReceipt stored={message.stored} />}
                {message.sources && <SourceLinks sources={message.sources} />}
              </div>
            )
          )}
          <div ref={endRef} />
        </div>

        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          {(recording || voiceTranscribing || voiceError) && (
            <div
              className={
                voiceError
                  ? "text-xs text-destructive"
                  : "flex items-center gap-2 text-xs text-muted-foreground"
              }
            >
              {recording && (
                <>
                  <span className="size-2 rounded-full bg-destructive animate-pulse" />
                  Recording {formatDuration(recordingSeconds)}
                </>
              )}
              {voiceTranscribing && (
                <>
                  <Spinner className="size-3.5" />
                  Transcribing voice note…
                </>
              )}
              {voiceError}
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              placeholder={isHerald ? "Message Herald about the briefing or current Board…" : vaultless ? "Message the agent…" : "Ask your vault, or say 'remember this: …'"}
              rows={1}
              disabled={voiceTranscribing}
              className="min-h-9 resize-none rounded-xl border-transparent bg-muted/60 px-3.5 focus-visible:border-transparent focus-visible:bg-muted focus-visible:ring-0 dark:bg-input/30 dark:focus-visible:bg-input/50"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
            />
            <Button
              type="button"
              variant={recording ? "destructive" : "ghost"}
              size="icon"
              aria-pressed={recording}
              className={
                recording
                  ? "rounded-full bg-destructive text-white transition-all hover:bg-destructive/90 active:scale-95 dark:text-white"
                  : "rounded-full transition-all active:scale-95"
              }
              disabled={busy || voiceTranscribing}
              onClick={() => {
                if (recording) void stopVoiceRecording()
                else void startVoiceRecording()
              }}
            >
              {recording ? <SquareIcon className="size-4 fill-current" /> : <MicIcon />}
              <span className="sr-only">{recording ? "Stop and send voice note" : "Record voice note"}</span>
            </Button>
            <Button
              type="submit"
              size="icon"
              className="rounded-full transition-all active:scale-95"
              disabled={busy || recording || voiceTranscribing || input.trim() === ""}
            >
              <SendIcon />
              <span className="sr-only">Send</span>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
