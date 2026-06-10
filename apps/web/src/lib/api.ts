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

export type SettingsValues = {
  vault_repo: string | null
  vault_branch: string | null
  github_token: string | null
  anthropic_api_key: string | null
  model_ask: string | null
  model_classify: string | null
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

export type VaultStatus = {
  repo: string | null
  branch: string | null
  configured: boolean
  cloned: boolean
  headSha: string | null
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

export function isMaskedSecret(value: string): boolean {
  return value.startsWith("•")
}
