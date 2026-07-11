import * as React from "react"
import { CheckCircle2Icon, CopyIcon, SaveIcon } from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

type Settings = {
  phoneNumber: string | null
  verified: boolean
  numberId: string
  downstreamUrl: string | null
  downstreamTokenConfigured: boolean
  transcriptionEnabled: boolean
  transcriptionProvider: "local" | "groq" | "openai" | "openrouter"
  transcriptionModel: string | null
  transcriptionKeyConfigured: boolean
  telegramBinding: string | null
  notificationPrefs: { whatsapp: boolean; telegram: boolean }
}

type Response = {
  settings: Settings
  phylaxNumber: string | null
  mcp: { url: string; token: string } | null
}

function CopyButton({ value }: { value: string }) {
  return <Button type="button" size="icon" variant="outline" aria-label="Copy" onClick={() => {
    void navigator.clipboard.writeText(value).then(() => toast.success("Copied"))
  }}><CopyIcon /></Button>
}

/** Tenant-side composition of the ported channel settings controls. */
export function PhylaxTenantSettings() {
  const [data, setData] = React.useState<Response | null>(null)
  const [phone, setPhone] = React.useState("")
  const [keyword, setKeyword] = React.useState<string | null>(null)
  const [downstreamUrl, setDownstreamUrl] = React.useState("")
  const [downstreamToken, setDownstreamToken] = React.useState("")
  const [telegramBinding, setTelegramBinding] = React.useState("")
  const [transcriptionKey, setTranscriptionKey] = React.useState("")
  const [transcriptionModel, setTranscriptionModel] = React.useState("")
  const [provider, setProvider] = React.useState<Settings["transcriptionProvider"]>("local")
  const [transcriptionEnabled, setTranscriptionEnabled] = React.useState(true)
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

  const load = React.useCallback(() => api<Response>("/api/phylax/settings").then(apply), [apply])
  React.useEffect(() => { void load() }, [load])
  React.useEffect(() => {
    if (!keyword || data?.settings.verified) return
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [data?.settings.verified, keyword, load])

  async function registerPhone() {
    try {
      const result = await api<Response & { keyword: string }>("/api/phylax/phone-registration", {
        method: "POST", body: { phoneNumber: phone, numberId: "primary" },
      })
      apply(result)
      setKeyword(result.keyword)
    } catch (error) { toast.error("Could not register phone", { description: errorMessage(error) }) }
  }

  async function save() {
    setSaving(true)
    try {
      const result = await api<{ settings: Settings }>("/api/phylax/settings", {
        method: "PUT",
        body: {
          downstreamUrl,
          ...(downstreamToken ? { downstreamToken } : {}),
          transcriptionEnabled,
          transcriptionProvider: provider,
          transcriptionModel,
          ...(transcriptionKey ? { transcriptionKey } : {}),
          telegramBinding,
          notificationPrefs: { whatsapp: whatsappNotify, telegram: telegramNotify },
        },
      })
      setData((current) => current ? { ...current, settings: result.settings } : current)
      setDownstreamToken("")
      setTranscriptionKey("")
      toast.success("Phylax settings saved")
    } catch (error) { toast.error("Could not save", { description: errorMessage(error) }) }
    finally { setSaving(false) }
  }

  if (!data) return <p className="text-sm text-muted-foreground">Loading Phylax settings…</p>
  return <div className="flex flex-col gap-6">
    <Card>
      <CardHeader><CardTitle>Verify your WhatsApp</CardTitle><CardDescription>Possession is proved only by an inbound message from this number.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <Field><FieldLabel htmlFor="phylax-phone">Your phone number</FieldLabel><div className="flex gap-2"><Input id="phylax-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+34…" /><Button onClick={registerPhone}>Register</Button></div></Field>
        {data.settings.verified ? <p className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2Icon className="size-4" />Verified</p> : keyword ? <div className="border border-border bg-muted p-4"><p className="text-sm">WhatsApp this one-time keyword to <strong>{data.phylaxNumber ?? "the Phylax number"}</strong>:</p><div className="mt-2 flex items-center gap-2"><code className="text-lg font-semibold">{keyword}</code><CopyButton value={keyword} /></div></div> : null}
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Your Ring downstream</CardTitle><CardDescription>Inbound messages go directly to this tenant-scoped Ring MCP face.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <Field><FieldLabel>MCP URL</FieldLabel><Input value={downstreamUrl} onChange={(e) => setDownstreamUrl(e.target.value)} placeholder="https://ring.zenod.dev/mcp/…" /></Field>
        <Field><FieldLabel>Bearer token</FieldLabel><Input type="password" value={downstreamToken} onChange={(e) => setDownstreamToken(e.target.value)} placeholder={data.settings.downstreamTokenConfigured ? "Saved — enter to replace" : "Ring token"} /></Field>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Transcription</CardTitle><CardDescription>The existing Phylax edge transcription pipeline runs after sender-to-tenant resolution.</CardDescription></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={transcriptionEnabled} onChange={(e) => setTranscriptionEnabled(e.target.checked)} />Transcribe voice notes</label>
        <Field><FieldLabel>Provider</FieldLabel><select className="h-9 border border-input bg-transparent px-3 text-sm" value={provider} onChange={(e) => setProvider(e.target.value as Settings["transcriptionProvider"])}><option value="local">Local whisper.cpp</option><option value="groq">Groq</option><option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option></select></Field>
        <Field><FieldLabel>Provider key</FieldLabel><Input type="password" value={transcriptionKey} onChange={(e) => setTranscriptionKey(e.target.value)} placeholder={data.settings.transcriptionKeyConfigured ? "Saved — enter to replace" : "Optional for local"} /></Field>
        <Field><FieldLabel>Model</FieldLabel><Input value={transcriptionModel} onChange={(e) => setTranscriptionModel(e.target.value)} placeholder="Provider default" /></Field>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Telegram and notifications</CardTitle><CardDescription>Bind the Telegram identity handled by the ported Phylax bot.</CardDescription></CardHeader>
      <CardContent className="space-y-4"><Field><FieldLabel>Telegram handle</FieldLabel><Input value={telegramBinding} onChange={(e) => setTelegramBinding(e.target.value)} placeholder="@username" /></Field><div className="flex gap-5 text-sm"><label><input type="checkbox" checked={whatsappNotify} onChange={(e) => setWhatsappNotify(e.target.checked)} /> WhatsApp notifications</label><label><input type="checkbox" checked={telegramNotify} onChange={(e) => setTelegramNotify(e.target.checked)} /> Telegram notifications</label></div></CardContent>
    </Card>
    {data.mcp ? <Card><CardHeader><CardTitle>Your Phylax MCP endpoint</CardTitle><CardDescription>Use this from any tokened agent. Every send returns a delivery receipt.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex gap-2"><Input readOnly value={data.mcp.url} /><CopyButton value={data.mcp.url} /></div><div className="flex gap-2"><Input readOnly type="password" value={data.mcp.token} /><CopyButton value={data.mcp.token} /></div></CardContent></Card> : null}
    <div className="flex justify-end"><Button onClick={save} disabled={saving}>{saving ? "Saving…" : <><SaveIcon />Save settings</>}</Button></div>
    <FieldDescription>Changing your phone number always requires a fresh inbound verification.</FieldDescription>
  </div>
}
