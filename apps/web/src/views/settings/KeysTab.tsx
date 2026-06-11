import * as React from "react"
import { PlugZapIcon, SaveIcon } from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

type FormState = {
  vault_repo: string
  vault_branch: string
  github_token: string
  provider: Provider
  anthropic_api_key: string
  openai_api_key: string
  model_ask: string
  model_classify: string
}

function toFormState(settings: SettingsValues): FormState {
  return {
    vault_repo: settings.vault_repo ?? "",
    vault_branch: settings.vault_branch ?? "",
    github_token: settings.github_token ?? "",
    provider: settings.provider,
    anthropic_api_key: settings.anthropic_api_key ?? "",
    openai_api_key: settings.openai_api_key ?? "",
    model_ask: settings.model_ask ?? "",
    model_classify: settings.model_classify ?? "",
  }
}

const KEY_FIELD: Record<Provider, "anthropic_api_key" | "openai_api_key"> = {
  anthropic: "anthropic_api_key",
  openai: "openai_api_key",
}

const KEY_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic API key",
  openai: "OpenAI API key",
}

const KEY_PLACEHOLDER: Record<Provider, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
}

const ASK_PLACEHOLDER: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
}

const CLASSIFY_PLACEHOLDER: Record<Provider, string> = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
}

function TestNote({ result }: { result: TestResult }) {
  return (
    <FieldDescription className={cn(!result.ok && "text-destructive")}>
      {result.message}
    </FieldDescription>
  )
}

export function KeysTab({ initial }: { initial: SettingsValues }) {
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
    setSaving(true)
    try {
      const result = await api<SettingsResponse>("/api/settings", {
        method: "PUT",
        body: form,
      })
      setForm(toFormState(result.settings))
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
                </SelectContent>
              </Select>
              <FieldDescription>
                Switching provider — clear the model fields to use that
                provider&apos;s defaults, or set explicit model IDs.
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
              {llmResult !== null && <TestNote result={llmResult} />}
            </Field>
            <FieldSeparator />
            <Field>
              <FieldLabel htmlFor="keys-model-ask">Ask model</FieldLabel>
              <Input
                id="keys-model-ask"
                placeholder={ASK_PLACEHOLDER[form.provider]}
                autoComplete="off"
                value={form.model_ask}
                onChange={(event) => update("model_ask", event.target.value)}
              />
              <FieldDescription>
                Used to answer questions over the vault.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="keys-model-classify">
                Classify model
              </FieldLabel>
              <Input
                id="keys-model-classify"
                placeholder={CLASSIFY_PLACEHOLDER[form.provider]}
                autoComplete="off"
                value={form.model_classify}
                onChange={(event) =>
                  update("model_classify", event.target.value)
                }
              />
              <FieldDescription>
                Used to classify incoming evidence.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner /> : <SaveIcon data-icon="inline-start" />}
            Save changes
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
