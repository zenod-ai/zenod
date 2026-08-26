export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined
  readonly retryDisposition:
    | "retry_same_operation"
    | "retry_new_operation"
    | undefined

  constructor(
    status: number,
    message: string,
    code?: string,
    retryDisposition?: "retry_same_operation" | "retry_new_operation"
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.retryDisposition = retryDisposition
  }
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

export function isNotConfigured(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.code === "not_configured"
  )
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return "Something went wrong"
}

type ApiOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  body?: unknown
}

export async function api<T>(
  path: string,
  options: ApiOptions = {}
): Promise<T> {
  const { method = "GET", body } = options

  const response = await fetch(path, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    // Some endpoints may return an empty body.
  }

  if (!response.ok) {
    const payload = data as {
      error?:
        | string
        | {
            code?: string
            message?: string
            retryDisposition?: "retry_same_operation" | "retry_new_operation"
          }
      code?: string
    } | null
    const typedError =
      payload?.error && typeof payload.error === "object" ? payload.error : null
    throw new ApiError(
      response.status,
      (typeof payload?.error === "string"
        ? payload.error
        : typedError?.message) ?? response.statusText,
      payload?.code ?? typedError?.code,
      typedError?.retryDisposition
    )
  }

  return data as T
}

export type AuthStatus = {
  needsSetup: boolean
  configured: boolean
  hostedMode: "ring" | null
  customerAuth?: boolean
  authMethod?: "github" | "admin"
}

export type TenantInfo = {
  id: string
  name?: string
  plan?: string
  quota?: number | null
}

export type OperatingDirective = {
  id: string
  text: string
  source: string
  active: boolean
  version: number
  updatedAt: string
}

export type ConductReceipt = {
  id: string
  kind: string
  status: string
  summary: string
  evidence: unknown[]
  at: string
}

export type OperatingRulesResponse = {
  tenant: TenantInfo
  seam: {
    status: "conformant"
    receiptDiscipline: "enabled"
    turnPreamble: "active-directives-re-read"
    tenantIsolation: "tenant-scoped"
    dispatchDepth: "depth<=1"
  }
  directives: OperatingDirective[]
  conductReceipts: ConductReceipt[]
  turnPreamble: {
    tenantId: string
    directives: OperatingDirective[]
    text: string
  }
}

export type McpConfigResponse = {
  tenant: TenantInfo
  unit: {
    name: string
    version: string
  }
  endpoint: string
  tokenedEndpoint: string
  auth: {
    bearer: boolean
    tokenedUrl: boolean
    oauth: boolean
  }
  routes: string[]
}

export type UnitSkillManifest = {
  id: string
  name: string
  version?: string
  description?: string
  tools?: string[]
  receiptExpectations?: string[]
}

export type SkillSettingsResponse = {
  tenant: TenantInfo
  unit: {
    name: string
    version: string
  }
  published: UnitSkillManifest | null
  installed: UnitSkillManifest[]
}

/** One row of the /api/usage breakdown — aggregated per operation or per model. */
export type UsageBucket = {
  key: string
  calls: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheCreationInputTokens: number
  costUsd: number
}

export type UsageSummary = {
  /** Window start (epoch ms); rows at or after this are included. */
  since: number
  calls: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheCreationInputTokens: number
  costUsd: number
  byOperation: UsageBucket[]
  byModel: UsageBucket[]
}

export type UsageResponse = {
  today: UsageSummary
  last7d: UsageSummary
}

export type Provider = "anthropic" | "openai" | "openrouter" | "groq"

export type SettingsValues = {
  vault_repo: string | null
  vault_branch: string | null
  github_token: string | null
  provider: Provider | null
  anthropic_api_key: string | null
  openai_api_key: string | null
  openrouter_api_key: string | null
  model_ask: string | null
  model_classify: string | null
  model_vision: string | null
  model_max_steps: string | null
  google_service_account_json: string | null
  google_oauth_client_id: string | null
  google_oauth_client_secret: string | null
  google_drive_folder_id: string | null
  groq_api_key: string | null
  openai_long_transcription: string | null
  long_transcription_provider: "openrouter" | "openai" | "local" | null
  openrouter_transcription_model: string | null
  composio_api_key: string | null
  composio_user_id: string | null
}

export type DriveStatus = {
  configured: boolean
  archiveConfigured: boolean
  archiveReason: string | null
  authMode: "oauth" | "service_account" | null
  clientEmail: string | null
  oauthEmail: string | null
  oauthClientConfigured: boolean
  oauthClientId: string | null
  folderId: string | null
  transcriptionProvider: string | null
}

/** Exact customer-safe projection returned by Hosted `/api/drive/status`. */
export type HostedDriveStatus = {
  configured: boolean
  oauthAvailable: boolean
  accountEmail: string | null
  folderId: string | null
  archiveConfigured: boolean
  archiveReason: string | null
}

export type TranscriptionStatus = {
  model: string
  ready: boolean
  downloading: boolean
  progress: number
  error: string | null
}

export type WhisperModelInfo = {
  id: string
  label: string
  note: string
  sizeMb: number
}

export type TranscriptionModelsResponse = {
  models: WhisperModelInfo[]
  selected: string
}

export type OpenRouterTranscriptionModel = {
  id: string
  name: string
  popularityRank: number
  pricing: {
    prompt: number | null
    completion: number | null
    audio: number | null
    request: number | null
  }
  costLabel: string
}

export type OpenRouterTranscriptionModelsResponse = {
  models: OpenRouterTranscriptionModel[]
  selected: string
  cached: boolean
  fallback: boolean
}

export type IngestStatus =
  | "queued"
  | "downloading"
  | "transcribing"
  | "filing"
  | "done"
  | "error"
  | "interrupted"

export type IngestJob = {
  id: string
  driveFileId: string
  fileName: string
  hints: string[]
  status: IngestStatus
  progress: number
  step: string | null
  error: string | null
  evidenceRef: string | null
  pages: string[]
  commitSha: string | null
  backlog: BacklogDigestResult | null
  archived: boolean
  cached: boolean
  createdAt: number
  updatedAt: number
}

export type BacklogDigestResult = {
  candidates: Array<{
    title: string
    type: string
    owner: string
    priority: string
    status: string
    summary: string
    open_questions: string[]
  }>
  written: Array<{ path: string; githubUrl: string; title: string }>
  skipped: Array<{ title?: string; reason: string }>
  source_refs: Array<{ path: string; githubUrl: string }>
}

export type IngestJobsResponse = {
  jobs: IngestJob[]
}

/** A job is still moving — used to decide whether to keep polling. */
export function isActiveIngest(status: IngestStatus): boolean {
  return (
    status === "queued" ||
    status === "downloading" ||
    status === "transcribing" ||
    status === "filing"
  )
}

export type WhatsAppStatus = {
  enabled: boolean
  state: "disabled" | "disconnected" | "pairing" | "connected" | "error"
  linkedNumber: string | null
  lastActivity: number | null
  lastError: string | null
  qr: string | null
  allowedSenders: string[]
  groupsEnabled: boolean
  acceptAll: boolean
  diagnostics: {
    lastUpsertAt: number | null
    lastUpsertType: string | null
    lastUpsertMessageCount: number
    lastIgnoredAt: number | null
    lastIgnoredReason: string | null
    allowedSenderAliasCount: number
    lastAliasRefreshAt: number | null
    lastAliasRefreshError: string | null
    lastAliasRefreshAllowedCount: number
    lastAliasRefreshResultCount: number
    store: {
      inboundMessages: number
      outboundAudits: number
      processingCounts: Record<string, number>
      outboundCounts: Record<string, number>
      lastInbound: {
        at: number
        sender: string | null
        status: string
        isGroup: boolean
      } | null
      lastOutbound: {
        at: number
        status: string
      } | null
    }
  }
}

export type TelegramStatus = {
  enabled: boolean
  state: "disabled" | "disconnected" | "connected" | "error"
  botUsername: string | null
  hasToken: boolean
  lastActivity: number | null
  lastError: string | null
  allowedUsers: string[]
  acceptAll: boolean
  rich: boolean
}

export type HostedChannelsResponse = {
  whatsapp: {
    state: "off" | "awaiting_code" | "verified" | "degraded" | "paused"
    senderHint: string | null
    sharedNumber: string | null
    verificationExpiresAt: number | null
    lastInboundAt: number | null
    lastReceiptAt: number | null
    revision: string
  }
  telegram: {
    state: "off" | "awaiting_code" | "connected" | "degraded"
    identityHint: string | null
    verificationExpiresAt: number | null
    revision: string
  }
}

export type HostedChannelMutation = {
  operationId: string
  operation:
    | "whatsapp.challenge"
    | "whatsapp.verify"
    | "whatsapp.test"
    | "whatsapp.disconnect"
    | "telegram.connect"
    | "telegram.verify"
    | "telegram.test"
    | "telegram.disconnect"
  outcome: "succeeded" | "rejected" | "failed"
  at: number
}

export type HostedWhatsAppChallengeResponse = {
  channels: HostedChannelsResponse
  challenge: {
    code: string
    sharedNumber: string
    expiresAt: number
  }
  mutation: HostedChannelMutation
}

export type HostedWhatsAppTestResponse = {
  channels: HostedChannelsResponse
  receipt: { deliveredAt: number }
  mutation: HostedChannelMutation
}

export type HostedWhatsAppDisconnectResponse = {
  channels: HostedChannelsResponse
  mutation: HostedChannelMutation
}

export type HostedTelegramConnectResponse = {
  channels: HostedChannelsResponse
  challenge: { code: string; expiresAt: number }
  mutation: HostedChannelMutation
}
export type HostedTelegramTestResponse = HostedWhatsAppTestResponse
export type HostedTelegramDisconnectResponse = HostedWhatsAppDisconnectResponse

export type SettingsResponse = {
  settings: SettingsValues
  configured: boolean
}

export type TestResult = {
  ok: boolean
  message: string
}

export type TokenResponse = {
  token: string
  mcpPath: string
}

export type ConnectedClient = {
  name: string
  version: string | null
  lastSeen: number
  connections: number
}

export type OAuthGrant = {
  clientName: string
  clientId: string
  createdAt: number
  expiresAt: number
}

export type ConnectionsResponse = {
  token: string
  mcpPath: string
  clients: ConnectedClient[]
  grants: OAuthGrant[]
}

export type ExecutorEffort = "low" | "medium" | "high"

export type ExecutorCliProvider = "auto" | "codex" | "claude"

export type ExecutorMcpServer = {
  name: string
  url: string
  enabled: boolean
  hasToken: boolean
}

export type ExecutorSettingsResponse = {
  defaultEffort: ExecutorEffort
  workerInstructions: string
  cliProvider: ExecutorCliProvider
  mcpServers: ExecutorMcpServer[]
  skills: string[]
  status: {
    githubAuth: "configured" | "missing"
    providerAuth: "configured" | "missing"
    cliAuth: "configured" | "missing"
    provider: Provider
    hasGithubToken: boolean
    hasGithubApp: boolean
    hasProviderKey: boolean
    hasCodexCliAuth: boolean
    hasClaudeCliAuth: boolean
    executionLaneConfigured: boolean
    archusPeerUrl: string | null
  }
}

export type VaultStatus = {
  repo: string | null
  branch: string | null
  vaultConfigured: boolean
  configured: boolean
  provider: Provider
  llmReady: boolean
  cloned: boolean
  headSha: string | null
  cloneError: string | null
}

export type LintIssue = {
  path: string
  rule: string
  message: string
  line?: number
}

export type LintResult = {
  ok: boolean
  errors: LintIssue[]
  checkedFiles: number
}

export type ChatSource = {
  path: string
  githubUrl: string
}

export type ChatStored = {
  evidenceRef: string
  pagesTouched: string[]
  commitSha: string
  githubUrls: string[]
  question?: string
}

export type ChatReply = {
  text: string
  sources: ChatSource[]
  stored?: ChatStored
}

export type VoiceTranscriptionResponse = {
  transcript: string
  provider: string
}

export async function transcribeVoiceNote(
  audio: Blob,
  filename: string
): Promise<VoiceTranscriptionResponse> {
  const body = new FormData()
  body.append("audio", audio, filename)

  const response = await fetch("/api/chat/voice/transcribe", {
    method: "POST",
    body,
  })

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    // Some failures may not include a JSON body.
  }

  if (!response.ok) {
    const payload = data as { error?: string; code?: string } | null
    throw new ApiError(
      response.status,
      payload?.error ?? response.statusText,
      payload?.code
    )
  }

  return data as VoiceTranscriptionResponse
}

export type ChatToolEvent = {
  phase: "start" | "end" | "error"
  tool: string
  label: string
}

export type ChatStreamHandlers = {
  onDelta: (text: string) => void
  onTool?: (event: ChatToolEvent) => void
  onDone: (done: {
    text: string
    sources: ChatSource[]
    stored?: ChatStored
  }) => void
}

/**
 * POST a chat message and consume the newline-delimited JSON stream from
 * /api/chat/stream, dispatching text deltas as they arrive. Resolves when the
 * stream ends; throws ApiError on a non-OK response or a server "error" event.
 */
export async function chatStream(
  message: string,
  handlers: ChatStreamHandlers
): Promise<void> {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  })

  if (!response.ok || !response.body) {
    let payload: { error?: string; code?: string } | null = null
    try {
      payload = await response.json()
    } catch {
      // no JSON body
    }
    throw new ApiError(
      response.status,
      payload?.error ?? response.statusText,
      payload?.code
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const pendingDeltas: string[] = []

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const event = JSON.parse(trimmed) as
      | { type: "delta"; text: string }
      | {
          type: "tool"
          phase: ChatToolEvent["phase"]
          tool: string
          label: string
        }
      | {
          type: "done"
          text: string
          sources: ChatSource[]
          stored?: ChatStored
        }
      | { type: "error"; code?: string; message: string }
      | { type: "ping" }
    if (event.type === "ping") return // keep-alive; nothing to render
    if (event.type === "delta") pendingDeltas.push(event.text)
    else if (event.type === "tool")
      handlers.onTool?.({
        phase: event.phase,
        tool: event.tool,
        label: event.label,
      })
    else if (event.type === "done") {
      // The final event is the host-gated authority. Never expose an earlier model
      // delta that the gate replaced; replay natural chunks only when they exactly
      // compose that final text, otherwise emit the gated result as one safe block.
      if (pendingDeltas.join("") === event.text) {
        for (const delta of pendingDeltas) handlers.onDelta(delta)
      } else if (event.text) {
        handlers.onDelta(event.text)
      }
      handlers.onDone({
        text: event.text,
        sources: event.sources,
        ...(event.stored ? { stored: event.stored } : {}),
      })
    } else if (event.type === "error")
      throw new ApiError(503, event.message, event.code)
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline: number
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      handleLine(line)
    }
  }
  if (buffer.trim()) handleLine(buffer)
}

export type ChatHistoryMessage = {
  role: "user" | "assistant"
  text: string
}

export type ChatHistoryResponse = {
  messages: ChatHistoryMessage[]
}

export type GithubAppStatus = {
  created: boolean
  installed: boolean
  slug: string | null
  installationId: string | null
}

export type GithubAppStart = {
  action: string
  manifest: Record<string, unknown>
}

export type GithubRepo = {
  fullName: string
  private: boolean
  defaultBranch: string
}

export type GithubReposResponse = {
  repositories: GithubRepo[]
}

export function isMaskedSecret(value: string): boolean {
  return value.startsWith("•")
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  groq: "Groq",
}

export function providerLabel(provider: Provider): string {
  return PROVIDER_LABELS[provider]
}
