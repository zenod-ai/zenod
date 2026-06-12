export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
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
    const payload = data as { error?: string; code?: string } | null
    throw new ApiError(
      response.status,
      payload?.error ?? response.statusText,
      payload?.code
    )
  }

  return data as T
}

export type AuthStatus = {
  needsSetup: boolean
  configured: boolean
}

export type Provider = "anthropic" | "openai"

export type SettingsValues = {
  vault_repo: string | null
  vault_branch: string | null
  github_token: string | null
  provider: Provider
  anthropic_api_key: string | null
  openai_api_key: string | null
  model_ask: string | null
  model_classify: string | null
  google_service_account_json: string | null
  google_drive_folder_id: string | null
  groq_api_key: string | null
}

export type DriveStatus = {
  configured: boolean
  clientEmail: string | null
  folderId: string | null
  transcriptionProvider: string | null
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
  archived: boolean
  createdAt: number
  updatedAt: number
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

export type ChatToolEvent = {
  phase: "start" | "end" | "error"
  tool: string
  label: string
}

export type ChatStreamHandlers = {
  onDelta: (text: string) => void
  onTool?: (event: ChatToolEvent) => void
  onDone: (done: { sources: ChatSource[]; stored?: ChatStored }) => void
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

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const event = JSON.parse(trimmed) as
      | { type: "delta"; text: string }
      | { type: "tool"; phase: ChatToolEvent["phase"]; tool: string; label: string }
      | { type: "done"; sources: ChatSource[]; stored?: ChatStored }
      | { type: "error"; message: string }
      | { type: "ping" }
    if (event.type === "ping") return // keep-alive; nothing to render
    if (event.type === "delta") handlers.onDelta(event.text)
    else if (event.type === "tool")
      handlers.onTool?.({ phase: event.phase, tool: event.tool, label: event.label })
    else if (event.type === "done")
      handlers.onDone({ sources: event.sources, ...(event.stored ? { stored: event.stored } : {}) })
    else if (event.type === "error") throw new ApiError(500, event.message)
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

export function providerLabel(provider: Provider): string {
  return provider === "openai" ? "OpenAI" : "Anthropic"
}
