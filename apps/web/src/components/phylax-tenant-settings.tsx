import * as React from "react"
import {
  CheckCircle2Icon,
  CopyIcon,
  RefreshCwIcon,
  SaveIcon,
  TestTube2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

type Settings = {
  phoneNumber: string | null
  verified: boolean
  numberId: string
  downstreamUrl: string | null
  downstreamTokenConfigured: boolean
  downstreamCredentialStatus: "unknown" | "healthy" | "rejected"
  downstreamCredentialCheckedAt: string | null
  transcriptionEnabled: boolean
  transcriptionProvider: "local" | "groq" | "openai" | "openrouter"
  transcriptionModel: string | null
  transcriptionKeyConfigured: boolean
  transcriptionKeysConfigured?: Record<
    "groq" | "openai" | "openrouter",
    boolean
  >
  telegramBinding: string | null
  notificationPrefs: { whatsapp: boolean; telegram: boolean }
}

type Response = {
  settings: Settings
  phylaxNumber: string | null
  mcp: { url: string; token: string } | null
}

type TranscriptionOptions = {
  defaults: Record<Settings["transcriptionProvider"], string>
  localModels: Array<{
    id: string
    label: string
    note: string
    sizeMb: number
  }>
  openrouterModels: Array<{
    id: string
    name: string
    popularityRank: number
    costLabel: string
  }>
  openrouterCatalog: { cached: boolean; fallback: boolean }
}

type TranscriptionCheck = {
  ok: boolean
  provider: Settings["transcriptionProvider"]
  model: string
  message: string
}

function isCloudProvider(
  provider: Settings["transcriptionProvider"]
): provider is "groq" | "openai" | "openrouter" {
  return provider !== "local"
}

function transcriptionDefault(
  provider: Settings["transcriptionProvider"],
  options?: TranscriptionOptions | null
): string {
  return (
    options?.defaults[provider] ??
    (provider === "local"
      ? "base"
      : provider === "groq"
        ? "whisper-large-v3-turbo"
        : provider === "openai"
          ? "whisper-1"
          : "openai/whisper-large-v3-turbo")
  )
}

function providerLabel(provider: Settings["transcriptionProvider"]): string {
  if (provider === "local") return "Local whisper.cpp"
  if (provider === "groq") return "Groq"
  if (provider === "openai") return "OpenAI"
  return "OpenRouter"
}

function CopyButton({ value }: { value: string }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      aria-label="Copy"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => toast.success("Copied"))
      }}
    >
      <CopyIcon />
    </Button>
  )
}

/** Tenant-side composition of the ported channel settings controls. */
export function PhylaxTenantSettings() {
  const [data, setData] = React.useState<Response | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [phone, setPhone] = React.useState("")
  const [keyword, setKeyword] = React.useState<string | null>(null)
  const [downstreamUrl, setDownstreamUrl] = React.useState("")
  const [downstreamToken, setDownstreamToken] = React.useState("")
  const [telegramBinding, setTelegramBinding] = React.useState("")
  const [transcriptionKey, setTranscriptionKey] = React.useState("")
  const [transcriptionModel, setTranscriptionModel] = React.useState("")
  const [provider, setProvider] =
    React.useState<Settings["transcriptionProvider"]>("local")
  const [transcriptionEnabled, setTranscriptionEnabled] = React.useState(true)
  const [transcriptionOptions, setTranscriptionOptions] =
    React.useState<TranscriptionOptions | null>(null)
  const [transcriptionOptionsError, setTranscriptionOptionsError] =
    React.useState<string | null>(null)
  const [checkingTranscription, setCheckingTranscription] =
    React.useState(false)
  const [transcriptionCheck, setTranscriptionCheck] =
    React.useState<TranscriptionCheck | null>(null)
  const [whatsappNotify, setWhatsappNotify] = React.useState(true)
  const [telegramNotify, setTelegramNotify] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const apply = React.useCallback((next: Response) => {
    setData(next)
    setPhone(next.settings.phoneNumber ?? "")
    setDownstreamUrl(next.settings.downstreamUrl ?? "")
    setTelegramBinding(next.settings.telegramBinding ?? "")
    setProvider(next.settings.transcriptionProvider)
    setTranscriptionModel(next.settings.transcriptionModel ?? "")
    setTranscriptionEnabled(next.settings.transcriptionEnabled)
    setWhatsappNotify(next.settings.notificationPrefs.whatsapp)
    setTelegramNotify(next.settings.notificationPrefs.telegram)
  }, [])

  const load = React.useCallback(async () => {
    try {
      const next = await api<Response>("/api/phylax/settings")
      setLoadError(null)
      apply(next)
    } catch (error) {
      setLoadError(errorMessage(error))
    }
  }, [apply])
  const loadTranscriptionOptions = React.useCallback(
    async (forceRefresh = false) => {
      try {
        const next = await api<TranscriptionOptions>(
          `/api/phylax/transcription/options${forceRefresh ? "?refresh=1" : ""}`
        )
        setTranscriptionOptionsError(null)
        setTranscriptionOptions(next)
      } catch (error) {
        setTranscriptionOptionsError(errorMessage(error))
      }
    },
    []
  )
  React.useEffect(() => {
    void Promise.resolve().then(() =>
      Promise.all([load(), loadTranscriptionOptions()])
    )
  }, [load, loadTranscriptionOptions])
  React.useEffect(() => {
    if (!keyword || data?.settings.verified) return
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [data?.settings.verified, keyword, load])

  async function registerPhone() {
    try {
      const result = await api<Response & { keyword: string }>(
        "/api/phylax/phone-registration",
        {
          method: "POST",
          body: { phoneNumber: phone, numberId: "primary" },
        }
      )
      apply(result)
      setKeyword(result.keyword)
    } catch (error) {
      toast.error("Could not register phone", {
        description: errorMessage(error),
      })
    }
  }

  async function save() {
    const keyConfigured =
      isCloudProvider(provider) &&
      (transcriptionKey.trim().length > 0 ||
        data?.settings.transcriptionKeysConfigured?.[provider] === true ||
        (data?.settings.transcriptionProvider === provider &&
          data.settings.transcriptionKeyConfigured))
    if (transcriptionEnabled && isCloudProvider(provider) && !keyConfigured) {
      toast.error(`${providerLabel(provider)} requires a provider key`)
      return
    }
    setSaving(true)
    try {
      const result = await api<{ settings: Settings }>("/api/phylax/settings", {
        method: "PUT",
        body: {
          downstreamUrl,
          ...(downstreamToken ? { downstreamToken } : {}),
          transcriptionEnabled,
          transcriptionProvider: provider,
          transcriptionModel:
            provider === "local" || provider === "openrouter"
              ? transcriptionModel.trim() ||
                transcriptionDefault(provider, transcriptionOptions)
              : null,
          ...(transcriptionKey.trim()
            ? { transcriptionKey: transcriptionKey.trim() }
            : {}),
          telegramBinding,
          notificationPrefs: {
            whatsapp: whatsappNotify,
            telegram: telegramNotify,
          },
        },
      })
      setData((current) =>
        current ? { ...current, settings: result.settings } : current
      )
      setDownstreamToken("")
      setTranscriptionKey("")
      setTranscriptionCheck(null)
      toast.success("Phylax settings saved")
    } catch (error) {
      toast.error("Could not save", { description: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  function selectProvider(next: Settings["transcriptionProvider"]) {
    setProvider(next)
    setTranscriptionModel(transcriptionDefault(next, transcriptionOptions))
    setTranscriptionKey("")
    setTranscriptionCheck(null)
  }

  async function checkTranscription() {
    setCheckingTranscription(true)
    setTranscriptionCheck(null)
    try {
      const result = await api<TranscriptionCheck>(
        "/api/phylax/transcription/check",
        {
          method: "POST",
          body: {
            provider,
            model:
              provider === "local" || provider === "openrouter"
                ? transcriptionModel.trim() ||
                  transcriptionDefault(provider, transcriptionOptions)
                : null,
            ...(transcriptionKey.trim()
              ? { key: transcriptionKey.trim() }
              : {}),
          },
        }
      )
      setTranscriptionCheck(result)
    } catch (error) {
      setTranscriptionCheck({
        ok: false,
        provider,
        model: transcriptionModel,
        message: errorMessage(error),
      })
    } finally {
      setCheckingTranscription(false)
    }
  }

  async function removeTranscriptionKey() {
    if (!isCloudProvider(provider)) return
    if (
      !window.confirm(
        `Remove the saved ${providerLabel(provider)} key? Transcription will be disabled if this is the active provider.`
      )
    )
      return
    setSaving(true)
    try {
      const result = await api<{ settings: Settings }>(
        "/api/phylax/transcription/key",
        {
          method: "DELETE",
          body: { provider },
        }
      )
      if (data) apply({ ...data, settings: result.settings })
      setTranscriptionKey("")
      setTranscriptionCheck(null)
      toast.success(`${providerLabel(provider)} provider key removed`, {
        description: result.settings.transcriptionEnabled
          ? undefined
          : "Voice transcription was disabled because this was the active provider.",
      })
    } catch (error) {
      toast.error("Could not remove provider key", {
        description: errorMessage(error),
      })
    } finally {
      setSaving(false)
    }
  }

  const providerKeyConfigured =
    isCloudProvider(provider) &&
    (data?.settings.transcriptionKeysConfigured?.[provider] === true ||
      (data?.settings.transcriptionProvider === provider &&
        data.settings.transcriptionKeyConfigured))
  const openRouterOptions = transcriptionOptions?.openrouterModels ?? []
  const openRouterModelOptions = openRouterOptions.some(
    (option) => option.id === transcriptionModel
  )
    ? openRouterOptions
    : transcriptionModel
      ? [
          {
            id: transcriptionModel,
            name: transcriptionModel,
            popularityRank: openRouterOptions.length + 1,
            costLabel: "saved model unavailable",
          },
          ...openRouterOptions,
        ]
      : openRouterOptions
  const openRouterModelReady =
    provider !== "openrouter" ||
    openRouterOptions.some((option) => option.id === transcriptionModel)
  const cloudReady =
    !isCloudProvider(provider) ||
    providerKeyConfigured ||
    transcriptionKey.trim().length > 0

  if (!data && loadError)
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <span>Could not load Phylax settings: {loadError}</span>
        <Button type="button" variant="outline" onClick={() => void load()}>
          <RefreshCwIcon />
          Retry
        </Button>
      </div>
    )
  if (!data)
    return (
      <p className="text-sm text-muted-foreground">Loading Phylax settings…</p>
    )
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Verify your WhatsApp</CardTitle>
          <CardDescription>
            Possession is proved only by an inbound message from this number.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel htmlFor="phylax-phone">Your phone number</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="phylax-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+34…"
              />
              <Button onClick={registerPhone}>Register</Button>
            </div>
          </Field>
          {data.settings.verified ? (
            <p className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2Icon className="size-4" />
              Verified
            </p>
          ) : keyword ? (
            <div className="border border-border bg-muted p-4">
              <p className="text-sm">
                WhatsApp this one-time keyword to{" "}
                <strong>{data.phylaxNumber ?? "the Phylax number"}</strong>:
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="text-lg font-semibold">{keyword}</code>
                <CopyButton value={keyword} />
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Your Ring downstream</CardTitle>
          <CardDescription>
            Inbound messages go directly to this tenant-scoped Ring MCP face.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.settings.downstreamCredentialStatus === "rejected" ? (
            <div
              role="alert"
              className="border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
            >
              <strong>Ring connection rejected.</strong> Replace both the
              tenant-scoped Ring MCP URL and bearer token below, then save and
              retry your message.
            </div>
          ) : null}
          <Field>
            <FieldLabel>MCP URL</FieldLabel>
            <Input
              value={downstreamUrl}
              onChange={(e) => setDownstreamUrl(e.target.value)}
              placeholder="https://ring.zenod.dev/mcp/…"
            />
          </Field>
          <Field>
            <FieldLabel>Bearer token</FieldLabel>
            <Input
              type="password"
              value={downstreamToken}
              onChange={(e) => setDownstreamToken(e.target.value)}
              placeholder={
                data.settings.downstreamTokenConfigured
                  ? "Saved — enter to replace"
                  : "Ring token"
              }
            />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Transcription</CardTitle>
              <CardDescription>
                Choose the tenant&apos;s preferred speech-to-text provider.
                Cloud failures fall back to local Whisper so voice notes are not
                lost.
              </CardDescription>
            </div>
            <Badge variant={transcriptionEnabled ? "secondary" : "outline"}>
              {transcriptionEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <label className="flex items-center gap-2 text-sm">
            <input
              id="phylax-transcription-enabled"
              type="checkbox"
              checked={transcriptionEnabled}
              onChange={(event) =>
                setTranscriptionEnabled(event.target.checked)
              }
            />
            Transcribe voice notes
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="phylax-transcription-provider">
                Preferred provider
              </FieldLabel>
              <select
                id="phylax-transcription-provider"
                className="h-9 border border-input bg-transparent px-3 text-sm"
                value={provider}
                onChange={(event) =>
                  selectProvider(
                    event.target.value as Settings["transcriptionProvider"]
                  )
                }
                disabled={!transcriptionEnabled}
              >
                <option value="local">Local whisper.cpp</option>
                <option value="groq">Groq</option>
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter</option>
              </select>
              <FieldDescription>
                {provider === "local"
                  ? "Runs on the Phylax host with no external API key."
                  : `${providerLabel(provider)} handles both short and long notes; local Base remains the failure fallback.`}
              </FieldDescription>
            </Field>
            {isCloudProvider(provider) ? (
              <Field>
                <FieldLabel htmlFor="phylax-transcription-key">
                  {providerLabel(provider)} provider key
                </FieldLabel>
                <Input
                  id="phylax-transcription-key"
                  type="password"
                  autoComplete="off"
                  value={transcriptionKey}
                  onChange={(event) => {
                    setTranscriptionKey(event.target.value)
                    setTranscriptionCheck(null)
                  }}
                  placeholder={
                    providerKeyConfigured
                      ? "Saved — enter to replace"
                      : "Required"
                  }
                  disabled={!transcriptionEnabled}
                />
                <FieldDescription>
                  {providerKeyConfigured
                    ? `A tenant-scoped ${providerLabel(provider)} key is stored write-only.`
                    : `A ${providerLabel(provider)} key is required and will be stored in this tenant's encrypted Phylax vault.`}
                </FieldDescription>
                {providerKeyConfigured ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => void removeTranscriptionKey()}
                    disabled={saving || checkingTranscription}
                  >
                    Remove saved key
                  </Button>
                ) : null}
              </Field>
            ) : (
              <div className="border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                Local transcription costs nothing, but long notes can take
                roughly real time on the shared CPU.
              </div>
            )}
          </div>
          {provider === "local" ? (
            <Field>
              <FieldLabel htmlFor="phylax-local-model">
                Local Whisper model
              </FieldLabel>
              <select
                id="phylax-local-model"
                className="h-9 w-full border border-input bg-transparent px-3 text-sm"
                value={
                  transcriptionModel ||
                  transcriptionDefault("local", transcriptionOptions)
                }
                onChange={(event) => {
                  setTranscriptionModel(event.target.value)
                  setTranscriptionCheck(null)
                }}
                disabled={!transcriptionEnabled || !transcriptionOptions}
              >
                {(transcriptionOptions?.localModels ?? []).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} — {option.note} (
                    {option.sizeMb >= 1024
                      ? `${(option.sizeMb / 1024).toFixed(1)} GB`
                      : `${option.sizeMb} MB`}
                    )
                  </option>
                ))}
              </select>
              <FieldDescription>
                Base is the hosted default. Larger models use substantially more
                RAM and CPU.
              </FieldDescription>
            </Field>
          ) : provider === "openrouter" ? (
            <Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel htmlFor="phylax-openrouter-model">
                  OpenRouter transcription model
                </FieldLabel>
                {transcriptionOptions?.openrouterCatalog.fallback ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Fallback catalog</Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void loadTranscriptionOptions(true)}
                    >
                      <RefreshCwIcon />
                      Refresh catalog
                    </Button>
                  </div>
                ) : null}
              </div>
              <select
                id="phylax-openrouter-model"
                className="h-9 w-full border border-input bg-transparent px-3 text-sm"
                value={
                  transcriptionModel ||
                  transcriptionDefault("openrouter", transcriptionOptions)
                }
                onChange={(event) => {
                  setTranscriptionModel(event.target.value)
                  setTranscriptionCheck(null)
                }}
                disabled={
                  !transcriptionEnabled ||
                  !transcriptionOptions ||
                  openRouterModelOptions.length === 0
                }
              >
                {openRouterModelOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} — popularity #{option.popularityRank} ·{" "}
                    {option.costLabel}
                  </option>
                ))}
              </select>
              <FieldDescription>
                {transcriptionOptions
                  ? transcriptionOptions.openrouterCatalog.fallback
                    ? `${transcriptionModel || transcriptionDefault("openrouter", transcriptionOptions)} · temporary fallback list; test is unavailable until the live catalog returns`
                    : openRouterModelReady
                      ? `${transcriptionModel || transcriptionDefault("openrouter", transcriptionOptions)} · live OpenRouter speech-to-text catalog`
                      : `${transcriptionModel} is saved but unavailable in the live OpenRouter transcription catalog; choose another model`
                  : "Loading OpenRouter speech-to-text models…"}
              </FieldDescription>
            </Field>
          ) : (
            <Field>
              <FieldLabel>Transcription model</FieldLabel>
              <Input
                readOnly
                value={transcriptionDefault(provider, transcriptionOptions)}
                aria-label={`${provider} transcription model`}
              />
              <FieldDescription>
                This is the model supported by the current{" "}
                {providerLabel(provider)} runtime and is not an ignored
                free-text setting.
              </FieldDescription>
            </Field>
          )}
          {transcriptionOptionsError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <span className="flex items-center gap-2">
                <TriangleAlertIcon className="size-4" />
                Could not load transcription models: {transcriptionOptionsError}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void loadTranscriptionOptions()}
              >
                <RefreshCwIcon />
                Retry
              </Button>
            </div>
          ) : null}
          {!cloudReady && transcriptionEnabled ? (
            <p role="alert" className="text-sm text-destructive">
              Enter the {providerLabel(provider)} provider key before testing or
              saving.
            </p>
          ) : null}
          {transcriptionCheck ? (
            <div
              role="status"
              className={
                transcriptionCheck.ok
                  ? "border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300"
                  : "border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
              }
            >
              <span className="flex items-center gap-2">
                {transcriptionCheck.ok ? (
                  <CheckCircle2Icon className="size-4" />
                ) : (
                  <TriangleAlertIcon className="size-4" />
                )}
                {transcriptionCheck.message}
              </span>
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => void checkTranscription()}
              disabled={
                !transcriptionEnabled ||
                !cloudReady ||
                !openRouterModelReady ||
                checkingTranscription ||
                Boolean(transcriptionOptionsError)
              }
            >
              {checkingTranscription ? (
                <RefreshCwIcon className="animate-spin" />
              ) : (
                <TestTube2Icon />
              )}
              {checkingTranscription ? "Checking…" : "Test provider"}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Telegram and notifications</CardTitle>
          <CardDescription>
            Bind the Telegram identity handled by the ported Phylax bot.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel>Telegram handle</FieldLabel>
            <Input
              value={telegramBinding}
              onChange={(e) => setTelegramBinding(e.target.value)}
              placeholder="@username"
            />
          </Field>
          <div className="flex gap-5 text-sm">
            <label>
              <input
                type="checkbox"
                checked={whatsappNotify}
                onChange={(e) => setWhatsappNotify(e.target.checked)}
              />{" "}
              WhatsApp notifications
            </label>
            <label>
              <input
                type="checkbox"
                checked={telegramNotify}
                onChange={(e) => setTelegramNotify(e.target.checked)}
              />{" "}
              Telegram notifications
            </label>
          </div>
        </CardContent>
      </Card>
      {data.mcp ? (
        <Card>
          <CardHeader>
            <CardTitle>Your Phylax MCP endpoint</CardTitle>
            <CardDescription>
              Use this from any tokened agent. Every send returns a delivery
              receipt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input readOnly value={data.mcp.url} />
              <CopyButton value={data.mcp.url} />
            </div>
            <div className="flex gap-2">
              <Input readOnly type="password" value={data.mcp.token} />
              <CopyButton value={data.mcp.token} />
            </div>
          </CardContent>
        </Card>
      ) : null}
      <div className="flex justify-end">
        <Button
          onClick={save}
          disabled={
            saving ||
            (transcriptionEnabled && (!cloudReady || !openRouterModelReady))
          }
        >
          {saving ? (
            "Saving…"
          ) : (
            <>
              <SaveIcon />
              Save settings
            </>
          )}
        </Button>
      </div>
      <FieldDescription>
        Changing your phone number always requires a fresh inbound verification.
      </FieldDescription>
    </div>
  )
}
