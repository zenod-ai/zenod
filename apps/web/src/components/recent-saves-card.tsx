import { ExternalLinkIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/** One capture as projected by GET /api/console/recent-saves (EPIC-7 T2.5). */
export type RecentSave = {
  id: string
  savedAt: string
  channel: "whatsapp" | "telegram" | "app" | "connector"
  kind: "voice" | "text" | "image" | "document" | "link"
  channelLabel: string
  snippet: string
  status: "saved" | "saving" | "failed"
  reply: string
  notePath: string | null
  noteUrl: string | null
}

function savedAtLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString()
}

export function RecentSavesCard({
  saves,
  unavailable = false,
}: {
  saves: RecentSave[]
  unavailable?: boolean
}) {
  return (
    <Card className="rounded-none" data-testid="recent-saves-card">
      <CardHeader>
        <CardTitle>Recent saves</CardTitle>
        <CardDescription>
          What you sent to Zenod and the reply you got back, newest first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {unavailable ? (
          <p className="text-sm text-muted-foreground">
            Recent saves are temporarily unavailable. Your notes are safe in
            your vault.
          </p>
        ) : saves.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing saved yet. Send a voice note or a message to Zenod on
            WhatsApp and it shows up here.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {saves.map((save) => (
              <li key={save.id} className="flex flex-col gap-1 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{save.channelLabel}</Badge>
                  <time dateTime={save.savedAt}>{savedAtLabel(save.savedAt)}</time>
                </div>
                <p className="text-sm">{save.snippet}</p>
                <p
                  className={
                    save.status === "failed"
                      ? "text-sm text-destructive"
                      : "text-sm text-muted-foreground"
                  }
                >
                  {save.reply}
                </p>
                {save.noteUrl ? (
                  <a
                    className="inline-flex items-center gap-1 text-sm underline underline-offset-4"
                    href={save.noteUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {save.notePath ?? "Open in your vault"}
                    <ExternalLinkIcon className="size-3" />
                  </a>
                ) : save.notePath ? (
                  <p className="text-sm text-muted-foreground">{save.notePath}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
