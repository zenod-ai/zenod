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
import { ChannelControlCard } from "@/components/channel-experience"
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

const TURN_TYPES = ["voice_note", "text", "media"] as const
type TurnType = (typeof TURN_TYPES)[number]
type VoiceDefault = "capture" | "assistant"
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }
type SourceName =
  | "transcript"
  | "sender"
  | "chatId"
  | "constant"
  | "message"
  | "surface"
  | "conversationKey"
type ArgumentSource = {
  source: SourceName
  value?: JsonValue
  constantText?: string
}
type TurnBinding = {
  tool: string
  argumentMappings: Record<string, ArgumentSource>
}
type TurnBindings = Record<TurnType, TurnBinding>

type DiscoveredTool = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
}

type ToolDiscoveryResponse = {
  tools: DiscoveredTool[]
}

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
  voiceDefault: VoiceDefault
  turnBindings: TurnBindings
  telegramBinding: string | null
  telegramLegacyBinding: string | null
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

const SOURCE_OPTIONS: Array<{ value: SourceName; label: string }> = [
  { value: "transcript", label: "Transcript" },
  { value: "sender", label: "Sender" },
  { value: "chatId", label: "Chat ID" },
  { value: "constant", label: "Constant JSON value" },
  { value: "message", label: "Legacy message" },
  { value: "surface", label: "Legacy surface" },
  { value: "conversationKey", label: "Legacy conversation key" },
]

function editableBindings(value: TurnBindings): TurnBindings {
  return Object.fromEntries(
    TURN_TYPES.map((turnType) => [
      turnType,
      {
        tool: value[turnType].tool,
        argumentMappings: Object.fromEntries(
          Object.entries(value[turnType].argumentMappings).map(
            ([field, source]) => [
              field,
              source.source === "constant"
                ? {
                    ...source,
                    constantText: JSON.stringify(source.value),
                  }
                : { ...source },
            ]
          )
        ),
      },
    ])
  ) as TurnBindings
}

function schemaFields(tool: DiscoveredTool): {
  properties: Record<string, unknown>
  required: Set<string>
} {
  const schema = tool.inputSchema
  if (
    !schema ||
    typeof schema !== "object" ||
    Array.isArray(schema) ||
    (schema.type !== undefined && schema.type !== "object")
  ) {
    throw new Error(`${tool.name} does not advertise an object input schema`)
  }
  const properties = schema.properties ?? {}
  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  ) {
    throw new Error(`${tool.name} advertises malformed schema properties`)
  }
  const requiredValue = schema.required ?? []
  if (
    !Array.isArray(requiredValue) ||
    requiredValue.some(
      (field) =>
        typeof field !== "string" ||
        !Object.prototype.hasOwnProperty.call(properties, field)
    )
  ) {
    throw new Error(`${tool.name} advertises malformed required fields`)
  }
  return {
    properties: properties as Record<string, unknown>,
    required: new Set(requiredValue as string[]),
  }
}

function validateDiscovery(value: ToolDiscoveryResponse): DiscoveredTool[] {
  if (!value || !Array.isArray(value.tools)) {
    throw new Error("Downstream tools/list returned a malformed catalog")
  }
  const names = new Set<string>()
  for (const tool of value.tools) {
    if (
      !tool ||
      typeof tool.name !== "string" ||
      !tool.name.trim() ||
      names.has(tool.name)
    ) {
      throw new Error("Downstream tools/list returned invalid tool names")
    }
    names.add(tool.name)
    schemaFields(tool)
  }
  return value.tools
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson(
            (value as Record<string, unknown>)[key]
          )}`
      )
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function schemaSignature(tools: DiscoveredTool[]): string {
  return stableJson(
    [...tools]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ name, inputSchema }) => ({ name, inputSchema }))
  )
}

function materializeBindings(value: TurnBindings): TurnBindings {
  return Object.fromEntries(
    TURN_TYPES.map((turnType) => [
      turnType,
      {
        tool: value[turnType].tool,
        argumentMappings: Object.fromEntries(
          Object.entries(value[turnType].argumentMappings).map(
            ([field, source]) => {
              if (source.source !== "constant") {
                return [field, { source: source.source }]
              }
              try {
                return [
                  field,
                  {
                    source: "constant",
                    value: JSON.parse(
                      source.constantText ?? "null"
                    ) as JsonValue,
                  },
                ]
              } catch {
                throw new Error(
                  `${turnType}.${field} constant must be valid JSON`
                )
              }
            }
          )
        ),
      },
    ])
  ) as TurnBindings
}

function jsonValueType(value: JsonValue): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (typeof value === "number" && Number.isInteger(value)) return "integer"
  return typeof value
}

function mappingSchemaError(
  field: string,
  source: ArgumentSource,
  schemaValue: unknown
): string | null {
  if (schemaValue === true) return null
  if (schemaValue === false) return `${field} is rejected by its live schema`
  if (
    !schemaValue ||
    typeof schemaValue !== "object" ||
    Array.isArray(schemaValue)
  ) {
    return `${field} advertises a malformed field schema`
  }
  const schema = schemaValue as Record<string, unknown>
  const valueType =
    source.source === "constant"
      ? jsonValueType(source.value ?? null)
      : "string"
  const advertisedType = schema.type
  const acceptedTypes =
    typeof advertisedType === "string"
      ? [advertisedType]
      : Array.isArray(advertisedType) &&
          advertisedType.every((candidate) => typeof candidate === "string")
        ? (advertisedType as string[])
        : advertisedType === undefined
          ? []
          : null
  if (!acceptedTypes) return `${field} advertises a malformed type constraint`
  if (
    acceptedTypes.length > 0 &&
    !acceptedTypes.includes(valueType) &&
    !(valueType === "integer" && acceptedTypes.includes("number"))
  ) {
    return `${field} expects ${acceptedTypes.join(" or ")}, but ${source.source} supplies ${valueType}`
  }
  if (schema.enum !== undefined) {
    const enumValues = schema.enum
    if (!Array.isArray(enumValues)) {
      return `${field} advertises a malformed enum constraint`
    }
    const knownDynamicValues =
      source.source === "surface" ? ["whatsapp", "mcp"] : null
    const knownDynamicValuesFit =
      knownDynamicValues &&
      knownDynamicValues.every((value) =>
        enumValues.some((candidate) => candidate === value)
      )
    if (!knownDynamicValuesFit && source.source !== "constant") {
      return `${field} is enum-constrained and requires a constant mapping`
    }
    if (
      source.source === "constant" &&
      !enumValues.some(
        (candidate) => stableJson(candidate) === stableJson(source.value)
      )
    ) {
      return `${field} constant is absent from the live enum`
    }
  }
  if (Object.prototype.hasOwnProperty.call(schema, "const")) {
    if (source.source !== "constant") {
      return `${field} is const-constrained and requires a constant mapping`
    }
    if (stableJson(schema.const) !== stableJson(source.value)) {
      return `${field} constant does not match the live const constraint`
    }
  }
  return null
}

function bindingErrors(
  bindings: TurnBindings,
  tools: DiscoveredTool[]
): string[] {
  const errors: string[] = []
  for (const turnType of TURN_TYPES) {
    const binding = bindings[turnType]
    const tool = tools.find((candidate) => candidate.name === binding.tool)
    if (!tool) {
      errors.push(`${turnType}: choose a tool from the discovered catalog`)
      continue
    }
    const { properties, required } = schemaFields(tool)
    for (const field of Object.keys(binding.argumentMappings)) {
      if (!Object.prototype.hasOwnProperty.call(properties, field)) {
        errors.push(
          `${turnType}: ${field} is absent from ${tool.name}'s live schema`
        )
        continue
      }
      const compatibilityError = mappingSchemaError(
        field,
        binding.argumentMappings[field],
        properties[field]
      )
      if (compatibilityError) {
        errors.push(`${turnType}: ${compatibilityError}`)
      }
    }
    for (const field of required) {
      if (!binding.argumentMappings[field]) {
        errors.push(
          `${turnType}: required field ${field} has no source mapping`
        )
      }
    }
  }
  return errors
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
  const [telegramLegacyBinding, setTelegramLegacyBinding] = React.useState("")
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
  const [voiceDefault, setVoiceDefault] =
    React.useState<VoiceDefault>("capture")
  const [turnBindings, setTurnBindings] = React.useState<TurnBindings | null>(
    null
  )
  const [discoveredTools, setDiscoveredTools] = React.useState<
    DiscoveredTool[] | null
  >(null)
  const [discoveryError, setDiscoveryError] = React.useState<string | null>(
    null
  )
  const [discovering, setDiscovering] = React.useState(false)
  const [savingConnection, setSavingConnection] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const apply = React.useCallback((next: Response) => {
    setData(next)
    setPhone(next.settings.phoneNumber ?? "")
    setDownstreamUrl(next.settings.downstreamUrl ?? "")
    setTelegramLegacyBinding(next.settings.telegramLegacyBinding ?? "")
    setProvider(next.settings.transcriptionProvider)
    setTranscriptionModel(next.settings.transcriptionModel ?? "")
    setTranscriptionEnabled(next.settings.transcriptionEnabled)
    setWhatsappNotify(next.settings.notificationPrefs.whatsapp)
    setTelegramNotify(next.settings.notificationPrefs.telegram)
    setVoiceDefault(next.settings.voiceDefault)
    setTurnBindings(editableBindings(next.settings.turnBindings))
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

  async function fetchDiscoveredTools(): Promise<DiscoveredTool[]> {
    const result = await api<ToolDiscoveryResponse>(
      "/api/phylax/downstream/tools",
      { method: "POST" }
    )
    return validateDiscovery(result)
  }

  async function discoverTools() {
    setDiscovering(true)
    setDiscoveryError(null)
    try {
      const tools = await fetchDiscoveredTools()
      setDiscoveredTools(tools)
      toast.success(
        `Discovered ${tools.length} tool${tools.length === 1 ? "" : "s"}`
      )
    } catch (error) {
      const message = errorMessage(error)
      setDiscoveryError(message)
      toast.error("Could not discover downstream tools", {
        description: message,
      })
    } finally {
      setDiscovering(false)
    }
  }

  async function saveConnection() {
    if (!downstreamUrl.trim()) {
      toast.error("Enter the tenant's memory MCP URL")
      return
    }
    if (!downstreamToken.trim() && !data?.settings.downstreamTokenConfigured) {
      toast.error("Enter a memory-scoped MCP token")
      return
    }
    setSavingConnection(true)
    try {
      const result = await api<{ settings: Settings }>("/api/phylax/settings", {
        method: "PUT",
        body: {
          downstreamUrl: downstreamUrl.trim(),
          ...(downstreamToken.trim()
            ? { downstreamToken: downstreamToken.trim() }
            : {}),
        },
      })
      setData((current) =>
        current ? { ...current, settings: result.settings } : current
      )
      setDownstreamUrl(result.settings.downstreamUrl ?? "")
      setDownstreamToken("")
      setDiscoveredTools(null)
      setDiscoveryError(null)
      toast.success("Tenant memory connection saved", {
        description: "Discover its authenticated tools before saving bindings.",
      })
    } catch (error) {
      toast.error("Could not save memory connection", {
        description: errorMessage(error),
      })
    } finally {
      setSavingConnection(false)
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
    if (!turnBindings) {
      toast.error("Binding settings have not loaded")
      return
    }
    if (!discoveredTools) {
      toast.error("Discover downstream tools before saving bindings")
      return
    }
    setSaving(true)
    try {
      const freshTools = await fetchDiscoveredTools()
      if (schemaSignature(freshTools) !== schemaSignature(discoveredTools)) {
        setDiscoveredTools(freshTools)
        setDiscoveryError(
          "The downstream tool schema changed. Review every binding, then save again."
        )
        throw new Error(
          "Downstream schema drift detected; mappings were not saved"
        )
      }
      const materialized = materializeBindings(turnBindings)
      const errors = bindingErrors(materialized, freshTools)
      if (errors.length > 0) throw new Error(errors.join("; "))
      const result = await api<{ settings: Settings }>("/api/phylax/settings", {
        method: "PUT",
        body: {
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
          telegramLegacyBinding,
          notificationPrefs: {
            whatsapp: whatsappNotify,
            telegram: telegramNotify,
          },
          voiceDefault,
          turnBindings: materialized,
        },
      })
      setData((current) =>
        current ? { ...current, settings: result.settings } : current
      )
      setVoiceDefault(result.settings.voiceDefault)
      setTurnBindings(editableBindings(result.settings.turnBindings))
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
  const connectionDirty =
    downstreamUrl.trim() !== (data?.settings.downstreamUrl ?? "") ||
    downstreamToken.trim().length > 0

  function selectBindingTool(turnType: TurnType, toolName: string) {
    if (!turnBindings) return
    const tool = discoveredTools?.find(
      (candidate) => candidate.name === toolName
    )
    const properties = tool ? schemaFields(tool).properties : {}
    setTurnBindings({
      ...turnBindings,
      [turnType]: {
        tool: toolName,
        argumentMappings: Object.fromEntries(
          Object.keys(properties)
            .filter(
              (field) =>
                turnBindings[turnType].argumentMappings[field] !== undefined
            )
            .map((field) => [
              field,
              turnBindings[turnType].argumentMappings[field],
            ])
        ),
      },
    })
  }

  function selectMappingSource(
    turnType: TurnType,
    field: string,
    source: SourceName | ""
  ) {
    if (!turnBindings) return
    const argumentMappings = {
      ...turnBindings[turnType].argumentMappings,
    }
    if (!source) {
      delete argumentMappings[field]
    } else {
      argumentMappings[field] =
        source === "constant"
          ? { source, value: null, constantText: "null" }
          : { source }
    }
    setTurnBindings({
      ...turnBindings,
      [turnType]: { ...turnBindings[turnType], argumentMappings },
    })
  }

  function setConstantText(
    turnType: TurnType,
    field: string,
    constantText: string
  ) {
    if (!turnBindings) return
    setTurnBindings({
      ...turnBindings,
      [turnType]: {
        ...turnBindings[turnType],
        argumentMappings: {
          ...turnBindings[turnType].argumentMappings,
          [field]: { source: "constant", constantText },
        },
      },
    })
  }

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
      <ChannelControlCard
        control={{
          id: "whatsapp",
          label: "Verify your WhatsApp",
          state: data.settings.verified
            ? "connected"
            : keyword
              ? "awaiting_code"
              : "off",
          identityHint: data.settings.phoneNumber,
          description:
            "Possession is proved only by an inbound message from this number.",
        }}
        hideIdentity
      >
        <div className="space-y-4">
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
        </div>
      </ChannelControlCard>
      <Card>
        <CardHeader>
          <CardTitle>Tenant memory MCP connection</CardTitle>
          <CardDescription>
            Phylax uses this tenant&apos;s memory-scoped credential only for the
            configured capture bindings. The saved token stays server-side and
            is never returned to this browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.settings.downstreamCredentialStatus === "rejected" ? (
            <div
              role="alert"
              className="border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
            >
              <strong>Memory connection rejected.</strong> Replace both the
              tenant-scoped MCP URL and memory-scoped bearer token below, save
              the connection, then discover its tools again.
            </div>
          ) : null}
          <Field>
            <FieldLabel htmlFor="phylax-downstream-url">MCP URL</FieldLabel>
            <Input
              id="phylax-downstream-url"
              value={downstreamUrl}
              onChange={(e) => setDownstreamUrl(e.target.value)}
              placeholder="https://memory.example/mcp/…"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="phylax-downstream-token">
              Memory-scoped bearer token
            </FieldLabel>
            <Input
              id="phylax-downstream-token"
              type="password"
              autoComplete="off"
              value={downstreamToken}
              onChange={(e) => setDownstreamToken(e.target.value)}
              placeholder={
                data.settings.downstreamTokenConfigured
                  ? "Saved — enter to replace"
                  : "Required memory-scoped token"
              }
            />
            <FieldDescription>
              Use a tenant credential limited to the six memory tools. Do not
              attach a full-surface agent token.
            </FieldDescription>
          </Field>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => void saveConnection()}
              disabled={savingConnection || !connectionDirty}
            >
              {savingConnection ? "Saving connection…" : "Save connection"}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Mechanical capture bindings</CardTitle>
              <CardDescription>
                Tools come only from authenticated tools/list. Each target field
                below is taken from that tool&apos;s exact live input schema.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void discoverTools()}
              disabled={
                discovering ||
                connectionDirty ||
                !data.settings.downstreamTokenConfigured
              }
            >
              <RefreshCwIcon
                className={discovering ? "animate-spin" : undefined}
              />
              {discovering ? "Discovering…" : "Discover tools"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {connectionDirty ? (
            <p role="alert" className="text-sm text-destructive">
              Save the tenant connection before discovery so tools/list uses the
              saved server-side credential.
            </p>
          ) : null}
          {discoveryError ? (
            <div
              role="alert"
              className="border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {discoveryError}
            </div>
          ) : null}
          {discoveredTools ? (
            <p className="text-sm text-muted-foreground">
              {discoveredTools.length} authenticated tool
              {discoveredTools.length === 1 ? "" : "s"} discovered. Phylax
              checks tools/list again immediately before saving.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Discover the saved tenant endpoint before editing or saving
              bindings.
            </p>
          )}
          <Field>
            <FieldLabel htmlFor="phylax-voice-default">
              Standalone voice-note default
            </FieldLabel>
            <select
              id="phylax-voice-default"
              className="h-9 w-full border border-input bg-transparent px-3 text-sm"
              value={voiceDefault}
              onChange={(event) =>
                setVoiceDefault(event.target.value as VoiceDefault)
              }
            >
              <option value="capture">
                Capture — store the transcript mechanically
              </option>
              <option value="assistant">
                Assistant — route the transcript to the assistant
              </option>
            </select>
            <FieldDescription>
              Capture is the safe default. Assistant applies only to standalone
              voice notes explicitly configured for conversation.
            </FieldDescription>
          </Field>
          {turnBindings
            ? TURN_TYPES.map((turnType) => {
                const binding = turnBindings[turnType]
                const selectedTool = discoveredTools?.find(
                  (tool) => tool.name === binding.tool
                )
                const fields = selectedTool
                  ? schemaFields(selectedTool)
                  : { properties: {}, required: new Set<string>() }
                return (
                  <section
                    key={turnType}
                    className="space-y-4 border border-border p-4"
                  >
                    <Field>
                      <FieldLabel htmlFor={`phylax-binding-${turnType}`}>
                        {turnType.replace("_", " ")} → MCP tool
                      </FieldLabel>
                      <select
                        id={`phylax-binding-${turnType}`}
                        className="h-9 w-full border border-input bg-transparent px-3 text-sm"
                        value={selectedTool ? binding.tool : ""}
                        onChange={(event) =>
                          selectBindingTool(turnType, event.target.value)
                        }
                        disabled={!discoveredTools}
                      >
                        <option value="">
                          {discoveredTools
                            ? "Choose a discovered tool"
                            : "Discover tools first"}
                        </option>
                        {(discoveredTools ?? []).map((tool) => (
                          <option key={tool.name} value={tool.name}>
                            {tool.name}
                          </option>
                        ))}
                      </select>
                      {selectedTool?.description ? (
                        <FieldDescription>
                          {selectedTool.description}
                        </FieldDescription>
                      ) : binding.tool && discoveredTools ? (
                        <p role="alert" className="text-sm text-destructive">
                          Saved tool {binding.tool} is absent from the live
                          catalog.
                        </p>
                      ) : null}
                    </Field>
                    {selectedTool
                      ? Object.keys(fields.properties).map((field) => {
                          const mapping = binding.argumentMappings[field]
                          return (
                            <div
                              key={field}
                              className="grid gap-3 border-t border-border pt-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1fr)]"
                            >
                              <div>
                                <code>{field}</code>
                                {fields.required.has(field) ? (
                                  <Badge className="ml-2" variant="outline">
                                    required
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="space-y-2">
                                <label
                                  className="sr-only"
                                  htmlFor={`phylax-mapping-${turnType}-${field}`}
                                >
                                  {turnType} {field} source
                                </label>
                                <select
                                  id={`phylax-mapping-${turnType}-${field}`}
                                  aria-label={`${turnType} ${field} source`}
                                  className="h-9 w-full border border-input bg-transparent px-3 text-sm"
                                  value={mapping?.source ?? ""}
                                  onChange={(event) =>
                                    selectMappingSource(
                                      turnType,
                                      field,
                                      event.target.value as SourceName | ""
                                    )
                                  }
                                >
                                  <option value="">Not mapped</option>
                                  {SOURCE_OPTIONS.map((option) => (
                                    <option
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                {mapping?.source === "constant" ? (
                                  <textarea
                                    aria-label={`${turnType} ${field} constant JSON`}
                                    className="min-h-20 w-full border border-input bg-transparent p-2 font-mono text-sm"
                                    value={mapping.constantText ?? "null"}
                                    onChange={(event) =>
                                      setConstantText(
                                        turnType,
                                        field,
                                        event.target.value
                                      )
                                    }
                                  />
                                ) : null}
                              </div>
                            </div>
                          )
                        })
                      : null}
                  </section>
                )
              })
            : null}
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
            Preserve legacy private-admin handles while new Hosted delivery is
            activated through a verified private DM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel htmlFor="phylax-telegram-legacy">
              Legacy Telegram handle
            </FieldLabel>
            <Input
              id="phylax-telegram-legacy"
              value={telegramLegacyBinding}
              onChange={(e) => setTelegramLegacyBinding(e.target.value)}
              placeholder="@username"
            />
            <FieldDescription>
              {data.settings.telegramBinding
                ? `Verified numeric chat ID ${data.settings.telegramBinding} is active.`
                : telegramLegacyBinding
                  ? "This legacy handle is preserved but is not routable. Reverify it from the host product's Channels page in a private Telegram DM."
                  : "Use the host product's Channels page to create a verified numeric Telegram binding."}
            </FieldDescription>
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
            connectionDirty ||
            !discoveredTools ||
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
