import * as React from "react"
import {
  ArrowRightIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleXIcon,
  PlugZapIcon,
  SettingsIcon,
} from "lucide-react"

import {
  api,
  errorMessage,
  type Provider,
  type TestResult,
  type TokenResponse,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { CodeSnippet, CopyButton } from "@/components/copy-button"
import { GithubConnect } from "@/components/github-connect"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

const STEPS = ["Password", "Vault", "Model", "Connect"] as const

const KEY_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic API key",
  openai: "OpenAI API key",
}

const KEY_PLACEHOLDER: Record<Provider, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
}

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {STEPS.map((label, index) => (
        <React.Fragment key={label}>
          {index > 0 && <Separator className="max-w-6 flex-1" />}
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex size-6 items-center justify-center rounded-full border text-xs font-medium",
                index < current &&
                  "border-primary bg-primary text-primary-foreground",
                index === current && "border-primary text-primary",
                index > current && "text-muted-foreground"
              )}
            >
              {index < current ? <CheckIcon className="size-3.5" /> : index + 1}
            </div>
            <span
              className={cn(
                "text-sm",
                index === current
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {label}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}

function TestResultNote({ result }: { result: TestResult }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-sm",
        result.ok ? "text-foreground" : "text-destructive"
      )}
    >
      {result.ok ? (
        <CircleCheckIcon className="size-4 shrink-0" />
      ) : (
        <CircleXIcon className="size-4 shrink-0" />
      )}
      <span className="min-w-0">{result.message}</span>
    </div>
  )
}

function PasswordStep({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  const tooShort = password.length > 0 && password.length < 8
  const mismatch = confirm.length > 0 && confirm !== password

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < 8 || password !== confirm) {
      return
    }

    setPending(true)
    setError(null)
    try {
      await api("/api/auth/setup", { method: "POST", body: { password } })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <CardHeader>
        <CardTitle>Create admin password</CardTitle>
        <CardDescription>
          This password protects the Zenod settings on this server.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field data-invalid={tooShort || undefined}>
            <FieldLabel htmlFor="setup-password">Password</FieldLabel>
            <Input
              id="setup-password"
              type="password"
              autoFocus
              autoComplete="new-password"
              value={password}
              aria-invalid={tooShort || undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
            {tooShort ? (
              <FieldError>Must be at least 8 characters.</FieldError>
            ) : (
              <FieldDescription>At least 8 characters.</FieldDescription>
            )}
          </Field>
          <Field data-invalid={mismatch || undefined}>
            <FieldLabel htmlFor="setup-confirm">Confirm password</FieldLabel>
            <Input
              id="setup-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              aria-invalid={mismatch || undefined}
              onChange={(event) => setConfirm(event.target.value)}
            />
            {mismatch && <FieldError>Passwords do not match.</FieldError>}
          </Field>
          {error !== null && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          type="submit"
          disabled={pending || password.length < 8 || confirm !== password}
        >
          {pending ? <Spinner /> : null}
          Continue
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </CardFooter>
    </form>
  )
}

function VaultStep({ onDone }: { onDone: () => void }) {
  const [token, setToken] = React.useState("")
  const [repo, setRepo] = React.useState("")
  const [branch, setBranch] = React.useState("")
  const [appRepoPicked, setAppRepoPicked] = React.useState(false)
  const [testResult, setTestResult] = React.useState<TestResult | null>(null)
  const [testing, setTesting] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const complete = repo.length > 0 && (token.length > 0 || appRepoPicked)

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api<TestResult>("/api/settings/test-github", {
        method: "POST",
        body: { repo, token },
      })
      setTestResult(result)
    } catch (err) {
      setTestResult({ ok: false, message: errorMessage(err) })
    } finally {
      setTesting(false)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, string> = {
        vault_repo: repo,
        vault_branch: branch.length > 0 ? branch : "main",
      }
      if (token.length > 0) {
        body.github_token = token
      }
      await api("/api/settings", { method: "PUT", body })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <CardHeader>
        <CardTitle>Connect your vault</CardTitle>
        <CardDescription>
          Zenod stores memory as Markdown in a GitHub repository. Connect with
          the GitHub App in one click, or paste a fine-grained token manually.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <GithubConnect
          onRepoPicked={(pickedRepo, pickedBranch) => {
            setRepo(pickedRepo)
            setBranch(pickedBranch)
            setAppRepoPicked(true)
          }}
        />
        {appRepoPicked ? (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="vault-repo-app">Vault repository</FieldLabel>
              <Input
                id="vault-repo-app"
                readOnly
                value={`${repo}${branch && branch !== "main" ? ` (${branch})` : ""}`}
                className="font-mono text-xs"
              />
              <FieldDescription>
                Authenticated via the connected GitHub App. Use “Choose vault
                repo” above to change it.
              </FieldDescription>
            </Field>
            {error !== null && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </FieldGroup>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">
                or paste a token manually
              </span>
              <Separator className="flex-1" />
            </div>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="vault-token">
                  GitHub personal access token
                </FieldLabel>
                <Input
                  id="vault-token"
                  type="password"
                  autoComplete="off"
                  placeholder="github_pat_…"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="vault-repo">Vault repository</FieldLabel>
                <Input
                  id="vault-repo"
                  placeholder="owner/name"
                  autoComplete="off"
                  value={repo}
                  onChange={(event) => setRepo(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="vault-branch">Branch</FieldLabel>
                <Input
                  id="vault-branch"
                  placeholder="main"
                  autoComplete="off"
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                />
                <FieldDescription>
                  Optional — defaults to main.
                </FieldDescription>
              </Field>
              {testResult !== null && <TestResultNote result={testResult} />}
              {error !== null && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </FieldGroup>
          </>
        )}
      </CardContent>
      <CardFooter className={cn(appRepoPicked ? "justify-end" : "justify-between")}>
        {!appRepoPicked && (
          <Button
            type="button"
            variant="outline"
            disabled={testing || repo.length === 0 || token.length === 0}
            onClick={handleTest}
          >
            {testing ? <Spinner /> : <PlugZapIcon data-icon="inline-start" />}
            Test connection
          </Button>
        )}
        <Button type="submit" disabled={saving || !complete}>
          {saving ? <Spinner /> : null}
          Save &amp; continue
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </CardFooter>
    </form>
  )
}

function ModelStep({ onDone }: { onDone: () => void }) {
  const [provider, setProvider] = React.useState<Provider>("anthropic")
  const [apiKey, setApiKey] = React.useState("")
  const [testResult, setTestResult] = React.useState<TestResult | null>(null)
  const [testing, setTesting] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api<TestResult>("/api/settings/test-llm", {
        method: "POST",
        body: { provider, api_key: apiKey },
      })
      setTestResult(result)
    } catch (err) {
      setTestResult({ ok: false, message: errorMessage(err) })
    } finally {
      setTesting(false)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const keyField =
        provider === "openai" ? "openai_api_key" : "anthropic_api_key"
      await api("/api/settings", {
        method: "PUT",
        body: { provider, [keyField]: apiKey },
      })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <CardHeader>
        <CardTitle>Model provider</CardTitle>
        <CardDescription>
          Zenod uses an LLM to classify and answer questions about your
          memories. Choose a provider and paste its API key.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="model-provider">Model provider</FieldLabel>
            <Select
              value={provider}
              onValueChange={(value) => setProvider(value as Provider)}
            >
              <SelectTrigger id="model-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="model-key">{KEY_LABEL[provider]}</FieldLabel>
            <Input
              id="model-key"
              type="password"
              autoComplete="off"
              placeholder={KEY_PLACEHOLDER[provider]}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </Field>
          {testResult !== null && <TestResultNote result={testResult} />}
          {error !== null && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={testing || apiKey.length === 0}
          onClick={handleTest}
        >
          {testing ? <Spinner /> : <PlugZapIcon data-icon="inline-start" />}
          Test key
        </Button>
        <Button type="submit" disabled={saving || apiKey.length === 0}>
          {saving ? <Spinner /> : null}
          Save &amp; continue
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </CardFooter>
    </form>
  )
}

function DoneStep({ onDone }: { onDone: () => void }) {
  const [tokenInfo, setTokenInfo] = React.useState<TokenResponse | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    api<TokenResponse>("/api/token")
      .then((result) => {
        if (!cancelled) {
          setTokenInfo(result)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(errorMessage(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const mcpUrl =
    tokenInfo === null ? null : window.location.origin + tokenInfo.mcpPath

  return (
    <>
      <CardHeader>
        <CardTitle>You&apos;re all set</CardTitle>
        <CardDescription>
          Connect an agent to Zenod over MCP using this endpoint and bearer
          token.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {error !== null && <p className="text-sm text-destructive">{error}</p>}
        {tokenInfo === null && error === null && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {tokenInfo !== null && mcpUrl !== null && (
          <>
            <Field>
              <FieldLabel htmlFor="done-mcp-url">MCP endpoint</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="done-mcp-url"
                  readOnly
                  value={mcpUrl}
                  className="font-mono text-xs"
                />
                <CopyButton value={mcpUrl} />
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="done-token">Bearer token</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="done-token"
                  readOnly
                  type="password"
                  value={tokenInfo.token}
                  className="font-mono text-xs"
                />
                <CopyButton value={tokenInfo.token} />
              </div>
            </Field>
            <Field>
              <FieldLabel>Connect from Claude Code</FieldLabel>
              <CodeSnippet
                code={`claude mcp add --transport http zenod ${mcpUrl} --header "Authorization: Bearer ${tokenInfo.token}"`}
              />
            </Field>
          </>
        )}
      </CardContent>
      <CardFooter className="justify-end">
        <Button type="button" onClick={onDone}>
          <SettingsIcon data-icon="inline-start" />
          Open settings
        </Button>
      </CardFooter>
    </>
  )
}

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = React.useState(0)

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Zenod</h1>
        <p className="text-sm text-muted-foreground">
          Set up your self-hosted memory agent
        </p>
      </div>
      <Stepper current={step} />
      <Card className="w-full max-w-lg">
        {step === 0 && <PasswordStep onDone={() => setStep(1)} />}
        {step === 1 && <VaultStep onDone={() => setStep(2)} />}
        {step === 2 && <ModelStep onDone={() => setStep(3)} />}
        {step === 3 && <DoneStep onDone={onComplete} />}
      </Card>
    </div>
  )
}
