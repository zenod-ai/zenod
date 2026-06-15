import * as React from "react"
import { CheckIcon, ClockIcon, SaveIcon, ZapIcon } from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  type OpenRouterTranscriptionModel,
  type OpenRouterTranscriptionModelsResponse,
  type SettingsResponse,
  type TranscriptionModelsResponse,
  type TranscriptionStatus,
  type WhisperModelInfo,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { TranscriptionPanel } from "@/components/transcription-panel"
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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

/**
 * Groq cloud transcription key. When set, voice notes go to Groq's
 * whisper-large-v3-turbo (~200x realtime, free tier) and the local model
 * below becomes the automatic fallback. The key is stored server-side and
 * echoed back masked; saving the masked echo leaves it unchanged, saving an
 * empty field removes it.
 */
function GroqTranscriptionCard() {
  const [value, setValue] = React.useState("")
  const [savedMasked, setSavedMasked] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    void api<SettingsResponse>("/api/settings")
      .then((result) => {
        setSavedMasked(result.settings.groq_api_key)
        setValue(result.settings.groq_api_key ?? "")
      })
      .catch(() => {
        /* field starts empty; saving still works */
      })
  }, [])

  const active = savedMasked !== null
  const dirty = value !== (savedMasked ?? "")

  async function handleSave() {
    setSaving(true)
    try {
      const result = await api<SettingsResponse>("/api/settings", {
        method: "PUT",
        body: { groq_api_key: value },
      })
      setSavedMasked(result.settings.groq_api_key)
      setValue(result.settings.groq_api_key ?? "")
      toast.success(
        result.settings.groq_api_key
          ? "Groq key saved — voice notes now transcribe in the cloud"
          : "Groq key removed — back to local transcription"
      )
    } catch (err) {
      toast.error("Could not save", { description: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cloud transcription (Groq)</CardTitle>
        <CardDescription>
          Paste a Groq API key to transcribe voice notes with
          whisper-large-v3-turbo in the cloud — seconds instead of minutes,
          with a generous free tier. The local model below stays as the
          automatic fallback whenever Groq is unavailable. Get a key at{" "}
          <a
            href="https://console.groq.com/keys"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            console.groq.com/keys
          </a>
          .
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field>
          <FieldLabel htmlFor="groq-api-key">Groq API key</FieldLabel>
          <Input
            id="groq-api-key"
            type="password"
            autoComplete="off"
            placeholder="gsk_…"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {active ? (
              <>
                <ZapIcon className="size-3.5 text-emerald-500" />
                Groq transcription is active — the local model is only used as
                fallback. Clear the field and save to go local-only.
              </>
            ) : (
              <span>
                No key set — transcription runs on this server&apos;s CPU.
              </span>
            )}
          </div>
        </Field>
      </CardContent>
      <CardFooter className="justify-end">
        <Button type="button" disabled={saving || !dirty} onClick={handleSave}>
          {saving ? <Spinner /> : <SaveIcon data-icon="inline-start" />}
          Save
        </Button>
      </CardFooter>
    </Card>
  )
}

function sizeLabel(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

type LongTranscriptionProvider = "openrouter" | "openai" | "local"

function resolveLongProvider(settings: SettingsResponse["settings"]): LongTranscriptionProvider {
  const configured = settings.long_transcription_provider
  if (configured === "openrouter" || configured === "openai" || configured === "local") return configured
  if (settings.openrouter_api_key !== null) return "openrouter"
  return settings.openai_api_key !== null && settings.openai_long_transcription !== "false" ? "openai" : "local"
}

function LongTranscriptionProviderCard() {
  const [hasOpenRouterKey, setHasOpenRouterKey] = React.useState(false)
  const [hasOpenAiKey, setHasOpenAiKey] = React.useState(false)
  const [provider, setProvider] = React.useState<LongTranscriptionProvider>("local")
  const [savedProvider, setSavedProvider] = React.useState<LongTranscriptionProvider>("local")
  const [model, setModel] = React.useState("openai/whisper-large-v3-turbo")
  const [savedModel, setSavedModel] = React.useState("openai/whisper-large-v3-turbo")
  const [models, setModels] = React.useState<OpenRouterTranscriptionModel[]>([])
  const [modelsFallback, setModelsFallback] = React.useState(false)
  const [modelsLoading, setModelsLoading] = React.useState(true)
  const [modelsError, setModelsError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    void Promise.all([
      api<SettingsResponse>("/api/settings"),
      api<OpenRouterTranscriptionModelsResponse>("/api/transcription/openrouter-models"),
    ])
      .then((result) => {
        const [settingsResult, modelsResult] = result
        const resolved = resolveLongProvider(settingsResult.settings)
        const selectedModel = settingsResult.settings.openrouter_transcription_model ?? modelsResult.selected
        setHasOpenRouterKey(settingsResult.settings.openrouter_api_key !== null)
        setHasOpenAiKey(settingsResult.settings.openai_api_key !== null)
        setProvider(resolved)
        setSavedProvider(resolved)
        setModel(selectedModel)
        setSavedModel(selectedModel)
        setModels(modelsResult.models)
        setModelsFallback(modelsResult.fallback)
        setModelsError(null)
      })
      .catch((err) => {
        setModelsError(errorMessage(err))
      })
      .finally(() => {
        setModelsLoading(false)
      })
  }, [])

  const effectiveProvider =
    provider === "openrouter" && !hasOpenRouterKey ? "local" : provider === "openai" && !hasOpenAiKey ? "local" : provider
  const modelOptions = React.useMemo(() => {
    if (models.some((option) => option.id === model)) return models
    return [
      {
        id: model,
        name: model,
        popularityRank: models.length + 1,
        pricing: { prompt: null, completion: null, audio: null, request: null },
        costLabel: "custom saved model",
      },
      ...models,
    ]
  }, [model, models])
  const currentModel = modelOptions.find((option) => option.id === model)
  const dirty = effectiveProvider !== savedProvider || model !== savedModel

  async function handleSave() {
    setSaving(true)
    try {
      const result = await api<SettingsResponse>("/api/settings", {
        method: "PUT",
        body: {
          long_transcription_provider: effectiveProvider,
          openrouter_transcription_model: model.trim() || "openai/whisper-large-v3-turbo",
          openai_long_transcription: effectiveProvider === "openai" ? "true" : "false",
        },
      })
      const resolved = resolveLongProvider(result.settings)
      const selectedModel = result.settings.openrouter_transcription_model ?? "openai/whisper-large-v3-turbo"
      setHasOpenRouterKey(result.settings.openrouter_api_key !== null)
      setHasOpenAiKey(result.settings.openai_api_key !== null)
      setProvider(resolved)
      setSavedProvider(resolved)
      setModel(selectedModel)
      setSavedModel(selectedModel)
      toast.success("Long-note transcription saved")
    } catch (err) {
      toast.error("Could not save", { description: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Long voice notes</CardTitle>
        <CardDescription>
          Choose the paid or local fallback for notes over 5 minutes. Short
          notes still try Groq first when a Groq key is saved; if Groq is
          unavailable, OpenRouter can take over before local whisper.cpp.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="long-transcription-provider">Provider</FieldLabel>
          <Select value={provider} onValueChange={(value) => setProvider(value as LongTranscriptionProvider)}>
            <SelectTrigger id="long-transcription-provider" className="w-full">
              <SelectValue placeholder="Choose a provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openrouter" disabled={!hasOpenRouterKey}>
                OpenRouter
              </SelectItem>
              <SelectItem value="openai" disabled={!hasOpenAiKey}>
                OpenAI
              </SelectItem>
              <SelectItem value="local">Local whisper.cpp</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>
            {effectiveProvider === "openrouter"
              ? "Uses your OpenRouter key for long notes and Groq fallback."
              : effectiveProvider === "openai"
                ? "Uses your OpenAI key for long notes; Groq fallback still goes local."
                : "Long notes and Groq failures use the local model below."}
          </FieldDescription>
        </Field>
        {effectiveProvider === "openrouter" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ZapIcon className="size-3.5" />
            OpenRouter will run the selected speech-to-text model below.
          </div>
        )}
        <Field>
          <FieldLabel htmlFor="openrouter-transcription-model">OpenRouter transcription model</FieldLabel>
          <Select value={model} onValueChange={setModel} disabled={modelsLoading || modelOptions.length === 0}>
            <SelectTrigger id="openrouter-transcription-model" className="w-full">
              <SelectValue placeholder={modelsLoading ? "Loading OpenRouter models" : "Choose a transcription model"} />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name} — popularity #{option.popularityRank} · {option.costLabel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            {modelsLoading
              ? "Loading the top OpenRouter speech-to-text models by popularity."
              : modelsError
                ? `Could not load the live OpenRouter catalog: ${modelsError}`
                : currentModel
                  ? `${currentModel.id} · ${currentModel.costLabel}${modelsFallback ? " · fallback catalog" : ""}`
                  : "Top OpenRouter speech-to-text models by popularity."}
          </FieldDescription>
        </Field>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ClockIcon className="size-3.5" />
          Threshold: 300 seconds.
        </div>
        <FieldDescription>
          {!hasOpenRouterKey && !hasOpenAiKey
            ? "Add an OpenRouter or OpenAI API key in Keys to enable cloud fallback."
            : !hasOpenRouterKey
              ? "Add an OpenRouter API key in Keys to enable paid Groq fallback."
              : null}
        </FieldDescription>
      </CardContent>
      <CardFooter className="justify-end">
        <Button type="button" disabled={saving || !dirty} onClick={handleSave}>
          {saving ? <Spinner /> : <SaveIcon data-icon="inline-start" />}
          Save
        </Button>
      </CardFooter>
    </Card>
  )
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
        <CardTitle>Local transcription quality</CardTitle>
        <CardDescription>
          Which local whisper.cpp model transcribes your voice notes (or serves
          as fallback when a Groq key is set above). Bigger models are more
          accurate (and better at non-English or accented speech) but slower on
          a small server. The model downloads once to the server and is kept
          across restarts.
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

export function TranscriptionTab() {
  return (
    <div className="flex flex-col gap-6">
      <GroqTranscriptionCard />
      <LongTranscriptionProviderCard />
      <TranscriptionModelCard />
      <TranscriptionPanel />
    </div>
  )
}
