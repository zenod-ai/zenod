import * as React from "react"
import { BrainIcon, CheckIcon, ExternalLinkIcon, SendIcon, Trash2Icon } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import {
  api,
  chatStream,
  errorMessage,
  isNotConfigured,
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

function AssistantMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: (props) => <p className="my-1.5 first:mt-0 last:mb-0" {...props} />,
        ul: (props) => <ul className="my-1.5 list-disc pl-5" {...props} />,
        ol: (props) => <ol className="my-1.5 list-decimal pl-5" {...props} />,
        li: (props) => <li className="my-0.5" {...props} />,
        h1: (props) => <p className="mt-2 mb-1 font-semibold" {...props} />,
        h2: (props) => <p className="mt-2 mb-1 font-semibold" {...props} />,
        h3: (props) => <p className="mt-2 mb-1 font-semibold" {...props} />,
        a: (props) => (
          <a className="underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />
        ),
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
          href={source.githubUrl || undefined}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
        >
          {source.path}
          {source.githubUrl && <ExternalLinkIcon className="size-3" />}
        </a>
      ))}
    </div>
  )
}

function StoredReceipt({ stored }: { stored: ChatStored }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="secondary">memory stored</Badge>
      <span className="text-xs text-muted-foreground">
        {stored.pagesTouched.join(", ")} · {stored.commitSha.slice(0, 7)}
      </span>
    </div>
  )
}

export function ChatTab() {
  const [messages, setMessages] = React.useState<Message[]>([])
  const [input, setInput] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)
  const endRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

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
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, busy])

  async function clearThread() {
    if (busy || clearing) return
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

  async function send() {
    const message = input.trim()
    if (!message || busy) return
    setInput("")
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
        onDone: ({ sources, stored }) =>
          patchStreaming((last) => ({ ...last, activity: null, sources, ...(stored ? { stored } : {}) })),
      })
    } catch (err) {
      const text = isNotConfigured(err)
        ? "Zenod is not fully configured yet — set the vault and API key in the other tabs first."
        : errorMessage(err)
      patchStreaming(() => ({ role: "assistant", text, error: true }))
    } finally {
      setBusy(false)
      textareaRef.current?.focus()
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
                <EmptyTitle>Talk to your brain</EmptyTitle>
                <EmptyDescription>
                  Ask anything stored in your vault, or say &ldquo;remember
                  this: …&rdquo; to file a new memory.
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
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <Textarea
            ref={textareaRef}
            value={input}
            placeholder="Ask your vault, or say 'remember this: …'"
            rows={1}
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
            type="submit"
            size="icon"
            className="rounded-full transition-all active:scale-95"
            disabled={busy || input.trim() === ""}
          >
            <SendIcon />
            <span className="sr-only">Send</span>
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
