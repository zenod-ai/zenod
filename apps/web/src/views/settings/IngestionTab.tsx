import * as React from "react"
import { CheckIcon, SaveIcon } from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  type TranscriptionModelsResponse,
  type TranscriptionStatus,
  type WhisperModelInfo,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { IngestionPanel } from "@/components/ingestion-panel"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

function sizeLabel(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

/**
 * Transcription quality picker. Saving stores the choice and the server
 * downloads the matching ggml model to the persistent /data volume (so it
 * survives restarts). Smaller = faster but less accurate, which matters most
 * for non-English or accented audio.
 */
function TranscriptionModelCard() {
  const [models, setModels] = React.useState<WhisperModelInfo[]>([])
  const [selected, setSelected] = React.useState<string>("")
  const [saved, setSaved] = React.useState<string>("")
  const [status, setStatus] = React.useState<TranscriptionStatus | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    void api<TranscriptionModelsResponse>("/api/transcription/models")
      .then((result) => {
        setModels(result.models)
        setSelected(result.selected)
        setSaved(result.selected)
      })
      .catch(() => {
        /* leave empty */
      })
  }, [])

  // Poll model readiness; keep polling while a download is in flight.
  React.useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      void api<TranscriptionStatus>("/api/transcription/status")
        .then((result) => {
          if (cancelled) return
          setStatus(result)
          if (result.downloading || !result.ready) timer = setTimeout(tick, 2000)
        })
        .catch(() => {
          /* decorative */
        })
    }
    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [saved])

  const current = models.find((m) => m.id === selected)
  const dirty = selected !== saved

  async function handleSave() {
    setSaving(true)
    try {
      await api("/api/settings", { method: "PUT", body: { whisper_model: selected } })
      setSaved(selected)
      setStatus(null) // force the poller to re-check the new model
      toast.success("Transcription quality saved", {
        description: "Downloading the model to the server if it isn't already there.",
      })
    } catch (err) {
      toast.error("Could not save", { description: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transcription quality</CardTitle>
        <CardDescription>
          Which local whisper.cpp model transcribes your voice notes. Bigger
          models are more accurate (and better at non-English or accented
          speech) but slower on a small server. The model downloads once to the
          server and is kept across restarts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field>
          <FieldLabel htmlFor="whisper-model">Model</FieldLabel>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger id="whisper-model" className="w-full">
              <SelectValue placeholder="Choose a model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label} — {sizeLabel(m.sizeMb)} · {m.note}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {current && (
            <FieldDescription>
              {current.note} Download size {sizeLabel(current.sizeMb)}.
            </FieldDescription>
          )}
          {status && (
            <div
              className={cn(
                "flex items-center gap-2 text-xs",
                status.error ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {status.error ? (
                <span>Model download failed: {status.error}</span>
              ) : status.ready ? (
                <>
                  <CheckIcon className="size-3.5 text-emerald-500" />
                  Model “{status.model}” is ready on the server.
                </>
              ) : status.downloading ? (
                <>
                  <Spinner className="size-3.5" />
                  Downloading “{status.model}” — {status.progress}%
                </>
              ) : (
                <span>Model “{status.model}” will download when first used.</span>
              )}
            </div>
          )}
        </Field>
      </CardContent>
      <CardFooter className="justify-end">
        <Button type="button" disabled={saving || !dirty || selected === ""} onClick={handleSave}>
          {saving ? <Spinner /> : <SaveIcon data-icon="inline-start" />}
          Save &amp; download
        </Button>
      </CardFooter>
    </Card>
  )
}

export function IngestionTab() {
  return (
    <div className="flex flex-col gap-6">
      <TranscriptionModelCard />
      <IngestionPanel />
    </div>
  )
}
