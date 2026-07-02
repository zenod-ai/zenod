import * as React from "react"
import { CheckIcon } from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage, type SettingsResponse } from "@/lib/api"
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
import { Spinner } from "@/components/ui/spinner"

/**
 * Composio connection — the interim Reddit connector for Callistheness (#420).
 * The Console stores the Composio API key and pushes it to the outbound agent, which
 * wires its Reddit tools (post/search/read) from it. The key is a masked secret: a
 * saved value shows as •••• and is left untouched unless the admin types a new one.
 */
export function ComposioConnect() {
  const [apiKey, setApiKey] = React.useState("")
  const [userId, setUserId] = React.useState("")
  const [hasKey, setHasKey] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    api<SettingsResponse>("/api/settings")
      .then((result) => {
        if (cancelled) return
        setHasKey(Boolean(result.settings.composio_api_key))
        setApiKey(result.settings.composio_api_key ?? "")
        setUserId(result.settings.composio_user_id ?? "")
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      // A masked value (••••) means "unchanged" — only send the key when the admin
      // actually typed a new one, so saving user_id alone never wipes the key.
      const body: Record<string, string> = { composio_user_id: userId.trim() }
      if (apiKey && !apiKey.includes("••••")) body.composio_api_key = apiKey.trim()
      const result = await api<SettingsResponse>("/api/settings", {
        method: "PUT",
        body,
      })
      setHasKey(Boolean(result.settings.composio_api_key))
      setApiKey(result.settings.composio_api_key ?? "")
      setUserId(result.settings.composio_user_id ?? "")
      toast.success("Composio saved", {
        description: "Pushed to Callistheness — Reddit tools will use it.",
      })
    } catch (err) {
      toast.error("Could not save Composio key", { description: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Composio
          {hasKey && (
            <Badge variant="secondary">
              <CheckIcon data-icon="inline-start" />
              Connected
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Composio powers Callistheness&apos;s Reddit (post, search, read replies) via your
          connected Reddit account. Paste your Composio API key here; the Console pushes it to
          Callistheness. Connect the Reddit account itself in the Composio dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="composio-api-key">Composio API key</FieldLabel>
          <Input
            id="composio-api-key"
            type="password"
            autoComplete="off"
            placeholder={loading ? "Loading…" : "ak_…"}
            value={apiKey}
            disabled={loading || saving}
            onChange={(e) => setApiKey(e.target.value)}
            className="font-mono text-xs"
          />
          <FieldDescription>
            Stored masked. Leave the •••• as-is to keep the saved key.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="composio-user-id">Composio user id</FieldLabel>
          <Input
            id="composio-user-id"
            autoComplete="off"
            placeholder="jordimr"
            value={userId}
            disabled={loading || saving}
            onChange={(e) => setUserId(e.target.value)}
            className="font-mono text-xs"
          />
          <FieldDescription>
            The Composio user whose connected Reddit account posts/reads. Defaults to the
            container env when left blank.
          </FieldDescription>
        </Field>
        <div>
          <Button onClick={handleSave} disabled={loading || saving}>
            {saving ? <Spinner /> : <CheckIcon data-icon="inline-start" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
