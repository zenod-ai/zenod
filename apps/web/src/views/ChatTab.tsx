import * as React from "react"
import { BrainIcon, ExternalLinkIcon, SendIcon } from "lucide-react"

import {
  api,
  errorMessage,
  isNotConfigured,
  type ChatReply,
  type ChatSource,
  type ChatStored,
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

type Message = {
  role: "user" | "assistant"
  text: string
  sources?: ChatSource[]
  stored?: ChatStored
  error?: boolean
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
          className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
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
  const endRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, busy])

  async function send() {
    const message = input.trim()
    if (!message || busy) return
    setInput("")
    setMessages((current) => [...current, { role: "user", text: message }])
    setBusy(true)
    try {
      const reply = await api<ChatReply>("/api/chat", {
        method: "POST",
        body: { message },
      })
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: reply.text,
          sources: reply.sources,
          ...(reply.stored ? { stored: reply.stored } : {}),
        },
      ])
    } catch (err) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: isNotConfigured(err)
            ? "Zenod is not fully configured yet — set the vault and API key in the other tabs first."
            : errorMessage(err),
          error: true,
        },
      ])
    } finally {
      setBusy(false)
      textareaRef.current?.focus()
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
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
                className="ml-auto max-w-[85%] rounded-xl bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground"
              >
                {message.text}
              </div>
            ) : (
              <div key={i} className="flex max-w-[85%] flex-col gap-2">
                <div
                  className={
                    message.error
                      ? "rounded-xl bg-destructive/10 px-3 py-2 text-sm whitespace-pre-wrap text-destructive"
                      : "rounded-xl bg-muted px-3 py-2 text-sm whitespace-pre-wrap"
                  }
                >
                  {message.text}
                </div>
                {message.stored && <StoredReceipt stored={message.stored} />}
                {message.sources && <SourceLinks sources={message.sources} />}
              </div>
            )
          )}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Reading the vault…
            </div>
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
            className="min-h-9 resize-none"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <Button type="submit" size="icon" disabled={busy || input.trim() === ""}>
            <SendIcon />
            <span className="sr-only">Send</span>
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
