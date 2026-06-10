import * as React from "react"
import { PlugZapIcon, SaveIcon } from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  type GithubAppStatus,
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
import { Spinner } from "@/components/ui/spinner"

type FormState = {
  vault_repo: string
  vault_branch: string
  github_token: string
  anthropic_api_key: string
  model_ask: string
  model_classify: string
}

function toFormState(settings: SettingsValues): FormState {
  return {
    vault_repo: settings.vault_repo ?? "",
    vault_branch: settings.vault_branch ?? "",
    github_token: settings.github_token ?? "",
    anthropic_api_key: settings.anthropic_api_key ?? "",
    model_ask: settings.model_ask ?? "",
    model_classify: settings.model_classify ?? "",
  }
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
  const [testingAnthropic, setTestingAnthropic] = React.useState(false)
  const [githubResult, setGithubResult] = React.useState<TestResult | null>(
    null
  )
  const [anthropicResult, setAnthropicResult] =
    React.useState<TestResult | null>(null)
  const [appInstalled, setAppInstalled] = React.useState(false)

  function update<K extends keyof FormState>(key: K, value: string) {
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

  async function handleTestAnthropic() {
    setTestingAnthropic(true)
    setAnthropicResult(null)
    try {
      const result = await api<TestResult>("/api/settings/test-anthropic", {
        method: "POST",
        body: { api_key: form.anthropic_api_key },
      })
      setAnthropicResult(result)
    } catch (err) {
      setAnthropicResult({ ok: false, message: errorMessage(err) })
    } finally {
      setTestingAnthropic(false)
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
            <Field>
              <FieldLabel htmlFor="keys-github-token">GitHub token</FieldLabel>
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
              {appInstalled && (
                <FieldDescription>
                  Optional — the connected GitHub App is used instead when
                  present.
                </FieldDescription>
              )}
              {githubResult !== null && <TestNote result={githubResult} />}
            </Field>
            <Field>
              <FieldLabel htmlFor="keys-anthropic-key">
                Anthropic API key
              </FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="keys-anthropic-key"
                  type="password"
                  autoComplete="off"
                  placeholder="sk-ant-…"
                  value={form.anthropic_api_key}
                  onChange={(event) =>
                    update("anthropic_api_key", event.target.value)
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  disabled={testingAnthropic}
                  onClick={handleTestAnthropic}
                >
                  {testingAnthropic ? (
                    <Spinner />
                  ) : (
                    <PlugZapIcon data-icon="inline-start" />
                  )}
                  Test
                </Button>
              </div>
              {anthropicResult !== null && (
                <TestNote result={anthropicResult} />
              )}
            </Field>
            <FieldSeparator />
            <Field>
              <FieldLabel htmlFor="keys-model-ask">Ask model</FieldLabel>
              <Input
                id="keys-model-ask"
                placeholder="claude-sonnet-4-6"
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
                placeholder="claude-haiku-4-5"
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
