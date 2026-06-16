import * as React from "react"
import { PlugZapIcon, SaveIcon } from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  providerLabel,
  type GithubAppStatus,
  type Provider,
  type SettingsResponse,
  type SettingsValues,
  type TestResult,
} from "@/lib/api"
import { cn } from "@/lib/utils"
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
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  MODEL_CATALOG,
  PROVIDER_DEFAULT_MODEL,
  costLong,
  costShort,
  findModel,
} from "@/lib/model-catalog"

type ApiKeyField =
  | "anthropic_api_key"
  | "openai_api_key"
  | "openrouter_api_key"
  | "groq_api_key"

type FormState = {
  vault_repo: string
  vault_branch: string
  github_token: string
  provider: Provider
  anthropic_api_key: string
  openai_api_key: string
  openrouter_api_key: string
  groq_api_key: string
  model_ask: string
  model_classify: string
  model_max_steps: string
}

const MAX_STEPS_DEFAULT = 8
const MAX_STEPS_MIN = 2
const MAX_STEPS_MAX = 20

function toFormState(settings: SettingsValues): FormState {
  return {
    vault_repo: settings.vault_repo ?? "",
    vault_branch: settings.vault_branch ?? "",
    github_token: settings.github_token ?? "",
    provider: settings.provider,
    anthropic_api_key: settings.anthropic_api_key ?? "",
    openai_api_key: settings.openai_api_key ?? "",
    openrouter_api_key: settings.openrouter_api_key ?? "",
    groq_api_key: settings.groq_api_key ?? "",
    model_ask: settings.model_ask ?? "",
    model_classify: settings.model_classify ?? "",
    model_max_steps: settings.model_max_steps ?? "",
  }
}

const KEY_FIELD: Record<Provider, ApiKeyField> = {
  anthropic: "anthropic_api_key",
  openai: "openai_api_key",
  openrouter: "openrouter_api_key",
  groq: "groq_api_key",
}

const KEY_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic API key",
  openai: "OpenAI API key",
  openrouter: "OpenRouter API key",
  groq: "Groq API key",
}

const KEY_PLACEHOLDER: Record<Provider, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
  openrouter: "sk-or-…",
  groq: "gsk_…",
}

const CUSTOM = "__custom__"
const DEFAULT = "__default__"

/**
 * Model picker for a single role (Ask/Classify). The stored value is a plain
 * model-ID string; "" means "use the provider default". Catalog entries show
 * their cost; a "Custom model ID…" option falls back to a free-text input so
 * any model the backend accepts can still be entered.
 */
function ModelSelect({
  id,
  provider,
  value,
  defaultModelId,
  onChange,
}: {
  id: string
  provider: Provider
  value: string
  defaultModelId: string
  onChange: (value: string) => void
}) {
  const catalog = MODEL_CATALOG[provider]
  const known = value !== "" && catalog.some((m) => m.id === value)
  const isCustomValue = value !== "" && !known
  const [customMode, setCustomMode] = React.useState(isCustomValue)

  // A non-empty value that isn't in the catalog is always custom.
  React.useEffect(() => {
    if (isCustomValue) setCustomMode(true)
  }, [isCustomValue])

  const selectValue = customMode ? CUSTOM : value === "" ? DEFAULT : value

  function handleSelect(next: string) {
    if (next === DEFAULT) {
      setCustomMode(false)
      onChange("")
    } else if (next === CUSTOM) {
      setCustomMode(true)
      onChange("")
    } else {
      setCustomMode(false)
      onChange(next)
    }
  }

  const defaultModel = findModel(provider, defaultModelId)
  const selected = known ? findModel(provider, value) : undefined

  return (
    <>
      <Select value={selectValue} onValueChange={handleSelect}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>
            Provider default
            {defaultModel ? ` — ${defaultModel.label}` : ` (${defaultModelId})`}
          </SelectItem>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>{providerLabel(provider)} models</SelectLabel>
            {catalog.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
                {m.note ? ` · ${m.note}` : ""} — {costShort(m)}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectSeparator />
          <SelectItem value={CUSTOM}>Custom model ID…</SelectItem>
        </SelectContent>
      </Select>
      {customMode && (
        <Input
          className="mt-2"
          placeholder={`${defaultModelId} (or any model ID)`}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {selected && (
        <FieldDescription>Cost: {costLong(selected)}.</FieldDescription>
      )}
    </>
  )
}

function TestNote({ result }: { result: TestResult }) {
  return (
    <FieldDescription className={cn(!result.ok && "text-destructive")}>
      {result.message}
    </FieldDescription>
  )
}

export function KeysTab({
  initial,
  onSaved,
  vaultless = false,
}: {
  initial: SettingsValues
  onSaved?: (settings: SettingsValues) => void
  vaultless?: boolean
}) {
  const [form, setForm] = React.useState<FormState>(() => toFormState(initial))
  const [saving, setSaving] = React.useState(false)
  const [testingGithub, setTestingGithub] = React.useState(false)
  const [testingLlm, setTestingLlm] = React.useState(false)
  const [githubResult, setGithubResult] = React.useState<TestResult | null>(
    null
  )
  const [llmResult, setLlmResult] = React.useState<TestResult | null>(null)
  const [appInstalled, setAppInstalled] = React.useState(false)

  const keyField = KEY_FIELD[form.provider]
  const apiKeyValue = form[keyField]
  // A stored secret arrives masked ("••••…"), which still counts as present;
  // only a truly empty field means the selected provider has no key.
  const apiKeyMissing = apiKeyValue.trim() === ""

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }))
  }

  const handleAppStatus = React.useCallback((status: GithubAppStatus) => {
    setAppInstalled(status.installed)
  }, [])

  const handleRepoPicked = React.useCallback((repo: string, branch: string) => {
    setForm((previous) => ({
      ...previous,
      vault_repo: repo,
      vault_branch: branch,
    }))
  }, [])

  async function handleTestGithub() {
    setTestingGithub(true)
    setGithubResult(null)
    try {
      const result = await api<TestResult>("/api/settings/test-github", {
        method: "POST",
        body: { repo: form.vault_repo, token: form.github_token },
      })
      setGithubResult(result)
    } catch (err) {
      setGithubResult({ ok: false, message: errorMessage(err) })
    } finally {
      setTestingGithub(false)
    }
  }

  async function handleTestLlm() {
    setTestingLlm(true)
    setLlmResult(null)
    try {
      const result = await api<TestResult>("/api/settings/test-llm", {
        method: "POST",
        body: { provider: form.provider, api_key: apiKeyValue },
      })
      setLlmResult(result)
    } catch (err) {
      setLlmResult({ ok: false, message: errorMessage(err) })
    } finally {
      setTestingLlm(false)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (apiKeyMissing) {
      toast.error(`${KEY_LABEL[form.provider]} is required`, {
        description: `Add a key for ${providerLabel(form.provider)} before saving.`,
      })
      return
    }
    setSaving(true)
    try {
      const result = await api<SettingsResponse>("/api/settings", {
        method: "PUT",
        body: form,
      })
      setForm(toFormState(result.settings))
      onSaved?.(result.settings)
      toast.success("Settings saved")
    } catch (err) {
      toast.error("Could not save settings", {
        description: errorMessage(err),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <CardTitle>Keys &amp; models</CardTitle>
          <CardDescription>
            Credentials and model choices for this Zenod server. Saved secrets
            are shown masked; leave them as-is to keep the stored value.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {/* Vault + GitHub belong to a vault agent (its Vault tab) or the
                Console's Connections — not in Keys for a vaultless agent. */}
            {!vaultless && (
              <>
            <Field>
              <FieldLabel htmlFor="keys-vault-repo">
                Vault repository
              </FieldLabel>
              <Input
                id="keys-vault-repo"
                placeholder="owner/name"
                autoComplete="off"
                value={form.vault_repo}
                onChange={(event) => update("vault_repo", event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="keys-vault-branch">Vault branch</FieldLabel>
              <Input
                id="keys-vault-branch"
                placeholder="main"
                autoComplete="off"
                value={form.vault_branch}
                onChange={(event) => update("vault_branch", event.target.value)}
              />
            </Field>
            <GithubConnect
              compact
              onStatusChange={handleAppStatus}
              onRepoPicked={handleRepoPicked}
            />
            {!appInstalled && (
              <Field>
                <FieldLabel htmlFor="keys-github-token">
                  GitHub token
                </FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="keys-github-token"
                    type="password"
                    autoComplete="off"
                    placeholder="github_pat_…"
                    value={form.github_token}
                    onChange={(event) =>
                      update("github_token", event.target.value)
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={testingGithub}
                    onClick={handleTestGithub}
                  >
                    {testingGithub ? (
                      <Spinner />
                    ) : (
                      <PlugZapIcon data-icon="inline-start" />
                    )}
                    Test
                  </Button>
                </div>
                <FieldDescription>
                  Used only when the GitHub App above isn&apos;t connected.
                </FieldDescription>
                {githubResult !== null && <TestNote result={githubResult} />}
              </Field>
            )}
              </>
            )}
            <Field>
              <FieldLabel htmlFor="keys-provider">Model provider</FieldLabel>
              <Select
                value={form.provider}
                onValueChange={(value) =>
                  update("provider", value as Provider)
                }
              >
                <SelectTrigger id="keys-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="openrouter">OpenRouter</SelectItem>
                  <SelectItem value="groq">Groq</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                Switching provider changes the model list below. Clear the model
                fields to use that provider&apos;s defaults, or pick/enter model
                IDs. OpenRouter and Groq are OpenAI-compatible.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="keys-llm-key">
                {KEY_LABEL[form.provider]}
              </FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="keys-llm-key"
                  type="password"
                  autoComplete="off"
                  placeholder={KEY_PLACEHOLDER[form.provider]}
                  value={apiKeyValue}
                  onChange={(event) => update(keyField, event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  disabled={testingLlm}
                  onClick={handleTestLlm}
                >
                  {testingLlm ? (
                    <Spinner />
                  ) : (
                    <PlugZapIcon data-icon="inline-start" />
                  )}
                  Test
                </Button>
              </div>
              {apiKeyMissing ? (
                <FieldDescription className="text-destructive">
                  {KEY_LABEL[form.provider]} is required to use{" "}
                  {providerLabel(form.provider)}.
                </FieldDescription>
              ) : null}
              {llmResult !== null && <TestNote result={llmResult} />}
            </Field>
            <FieldSeparator />
            <Field>
              <FieldLabel htmlFor="keys-model-ask">Ask model</FieldLabel>
              <ModelSelect
                id="keys-model-ask"
                provider={form.provider}
                value={form.model_ask}
                defaultModelId={PROVIDER_DEFAULT_MODEL[form.provider].ask}
                onChange={(value) => update("model_ask", value)}
              />
              <FieldDescription>
                Used to answer questions over the vault.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="keys-model-classify">
                Classify model
              </FieldLabel>
              <ModelSelect
                id="keys-model-classify"
                provider={form.provider}
                value={form.model_classify}
                defaultModelId={PROVIDER_DEFAULT_MODEL[form.provider].classify}
                onChange={(value) => update("model_classify", value)}
              />
              <FieldDescription>
                Used to classify incoming evidence.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="keys-max-steps">
                Max tool steps per reply
              </FieldLabel>
              <Input
                id="keys-max-steps"
                type="number"
                inputMode="numeric"
                min={MAX_STEPS_MIN}
                max={MAX_STEPS_MAX}
                step={1}
                placeholder={String(MAX_STEPS_DEFAULT)}
                value={form.model_max_steps}
                onChange={(event) =>
                  update("model_max_steps", event.target.value)
                }
                onBlur={(event) => {
                  const raw = event.target.value.trim()
                  if (raw === "") return
                  const clamped = Math.max(
                    MAX_STEPS_MIN,
                    Math.min(MAX_STEPS_MAX, Math.round(Number(raw)))
                  )
                  update(
                    "model_max_steps",
                    Number.isFinite(clamped) ? String(clamped) : ""
                  )
                }}
              />
              <FieldDescription>
                How many rounds of tool calls (search, read, create…) the model
                may make before it must answer. The model is told this budget so
                it plans, and the final step always produces a reply — higher is
                more thorough but slower and costlier. Default {MAX_STEPS_DEFAULT}
                ; leave blank to use it.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={saving || apiKeyMissing}>
            {saving ? <Spinner /> : <SaveIcon data-icon="inline-start" />}
            Save changes
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
