import * as React from "react"
import {
  CheckIcon,
  ExternalLinkIcon,
  PlugZapIcon,
  SaveIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  type DriveStatus,
  type SettingsResponse,
  type TestResult,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { CopyButton } from "@/components/copy-button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"

const CONSOLE_SA_URL =
  "https://console.cloud.google.com/iam-admin/serviceaccounts"
const CONSOLE_DRIVE_API_URL =
  "https://console.cloud.google.com/apis/library/drive.googleapis.com"
const GROQ_KEYS_URL = "https://console.groq.com/keys"

/** Google Drive triangle, lucide-style props (lucide ships no brand icons). */
function DriveIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M8.267 1.5h7.466L24 15.546l-3.733 6.954H3.733L0 15.546 8.267 1.5Zm.96 1.873L2.4 15.546l2.667 4.968 6.826-12.173-2.666-4.968Zm5.546 0h-4.48l7.04 13.127h4.534L14.773 3.373ZM16.96 18.5H7.04l-1.92 3h13.76l-1.92-3Z" />
    </svg>
  )
}

function parseClientEmail(json: string): string | null {
  if (!json || json.includes("••••")) return null
  try {
    const parsed = JSON.parse(json) as { client_email?: string }
    return typeof parsed.client_email === "string"
      ? parsed.client_email
      : null
  } catch {
    return null
  }
}

function Step({
  n,
  children,
}: {
  n: number
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs">
        {n}
      </span>
      <div className="min-w-0 text-sm text-muted-foreground">{children}</div>
    </div>
  )
}

/**
 * Connect Google Drive for a self-hosted instance. Google offers no
 * GitHub-manifest-style flow that could create credentials for us, and a
 * shared vendor OAuth client would put someone's personal Google project
 * behind every install — so the connection is a service account you create
 * once, following the numbered steps right here in the card.
 */
export function GoogleDriveConnect() {
  const [status, setStatus] = React.useState<DriveStatus | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [setupOpen, setSetupOpen] = React.useState(false)
  const [json, setJson] = React.useState("")
  const [folderId, setFolderId] = React.useState("")
  const [groqKey, setGroqKey] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<TestResult | null>(null)
  const [disconnecting, setDisconnecting] = React.useState(false)

  const loadStatus = React.useCallback(() => {
    return api<DriveStatus>("/api/drive/status")
      .then((result) => {
        setStatus(result)
        setLoadError(null)
        setFolderId((previous) => previous || (result.folderId ?? ""))
      })
      .catch((err: unknown) => {
        setLoadError(errorMessage(err))
      })
  }, [])

  React.useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const pastedEmail = parseClientEmail(json)

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api<TestResult>("/api/settings/test-drive", {
        method: "POST",
        body: { service_account_json: json, folder_id: folderId },
      })
      setTestResult(result)
    } catch (err) {
      setTestResult({ ok: false, message: errorMessage(err) })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await api<SettingsResponse>("/api/settings", {
        method: "PUT",
        body: {
          ...(json.trim() !== "" ? { google_service_account_json: json } : {}),
          google_drive_folder_id: folderId,
          ...(groqKey.trim() !== "" ? { groq_api_key: groqKey } : {}),
        },
      })
      setJson("")
      setGroqKey("")
      setSetupOpen(false)
      await loadStatus()
      toast.success("Google Drive connected", {
        description:
          "Ask Zeno in the Chat tab to list or ingest your Drive files.",
      })
    } catch (err) {
      toast.error("Could not save the connection", {
        description: errorMessage(err),
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      await api("/api/settings", {
        method: "PUT",
        body: { google_service_account_json: "" },
      })
      await loadStatus()
      toast.success("Google Drive disconnected")
    } catch (err) {
      toast.error("Could not disconnect", { description: errorMessage(err) })
    } finally {
      setDisconnecting(false)
    }
  }

  const connected = Boolean(status?.configured)
  const showSetup = !connected || setupOpen

  return (
    <Card>
      <CardHeader>
        <DriveIcon className="size-5 text-muted-foreground" />
        <CardTitle className="flex items-center gap-2">
          Google Drive
          {connected && (
            <Badge variant="secondary">
              <CheckIcon />
              Connected
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Your shared Drive folder becomes Zeno&apos;s inbox: drop voice notes
          or documents there and ask Zeno to ingest them — audio is
          transcribed, filed into the vault as evidence, and the original is
          moved to an Archive/ subfolder in Drive (the vault keeps the link).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {connected && status?.clientEmail !== null && (
          <Field>
            <FieldLabel>Connected service account</FieldLabel>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">
                {status?.clientEmail}
              </code>
              {status?.clientEmail && <CopyButton value={status.clientEmail} />}
            </div>
            <FieldDescription>
              Any folder shared with this email is visible to Zeno.
              {status?.transcriptionProvider
                ? ` Voice-note transcription: ${status.transcriptionProvider}.`
                : " No transcription key yet — add a Groq key below to ingest voice notes."}
            </FieldDescription>
          </Field>
        )}

        {showSetup && (
          <>
            <div className="flex flex-col gap-3">
              <Step n={1}>
                In Google Cloud, create a service account (any project, no
                roles needed) and download a <strong>JSON key</strong> for it
                — then make sure the <strong>Google Drive API</strong> is
                enabled in that project.
                <span className="mt-1 flex flex-wrap gap-3">
                  <a
                    className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
                    href={CONSOLE_SA_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Service accounts <ExternalLinkIcon className="size-3" />
                  </a>
                  <a
                    className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
                    href={CONSOLE_DRIVE_API_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Enable Drive API <ExternalLinkIcon className="size-3" />
                  </a>
                </span>
              </Step>
              <Step n={2}>
                Paste the key file below — its email appears; share your Drive
                folder with that email as <strong>Editor</strong> (lets Zeno
                archive ingested files; Viewer works but skips archiving).
              </Step>
              <Step n={3}>
                Test, save, and you&apos;re connected — from then on Zeno can
                list and ingest that folder whenever you ask in chat.
              </Step>
            </div>

            <Field>
              <FieldLabel htmlFor="drive-sa-json">
                Service account key (JSON)
              </FieldLabel>
              <Textarea
                id="drive-sa-json"
                rows={4}
                autoComplete="off"
                spellCheck={false}
                placeholder='{ "type": "service_account", "client_email": "…", "private_key": "…" }'
                value={json}
                onChange={(event) => {
                  setJson(event.target.value)
                  setTestResult(null)
                }}
              />
              <FieldDescription>
                Stored only on this server, masked after saving.
              </FieldDescription>
            </Field>

            {pastedEmail !== null && (
              <Field>
                <FieldLabel>Share your folder with</FieldLabel>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">
                    {pastedEmail}
                  </code>
                  <CopyButton value={pastedEmail} />
                </div>
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="drive-folder-id">
                Folder ID (optional)
              </FieldLabel>
              <Input
                id="drive-folder-id"
                autoComplete="off"
                placeholder="the part after /folders/ in the folder URL"
                value={folderId}
                onChange={(event) => setFolderId(event.target.value)}
              />
              <FieldDescription>
                The folder that acts as the inbox — needed for archiving.
                Leave empty to see everything shared with the service account
                (no archiving).
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="drive-groq-key">
                Groq API key (voice-note transcription)
              </FieldLabel>
              <Input
                id="drive-groq-key"
                type="password"
                autoComplete="off"
                placeholder="gsk_…"
                value={groqKey}
                onChange={(event) => setGroqKey(event.target.value)}
              />
              <FieldDescription>
                Whisper on Groq&apos;s{" "}
                <a
                  className="underline underline-offset-4"
                  href={GROQ_KEYS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  free tier
                </a>
                . Falls back to your OpenAI key (Keys &amp; models) if one is
                saved.
              </FieldDescription>
            </Field>

            {testResult !== null && (
              <p
                className={cn(
                  "text-sm",
                  testResult.ok ? "text-muted-foreground" : "text-destructive"
                )}
              >
                {testResult.message}
              </p>
            )}
          </>
        )}

        {loadError !== null && (
          <p className="text-sm text-destructive">{loadError}</p>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-2">
        {showSetup ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={testing}
              onClick={handleTest}
            >
              {testing ? <Spinner /> : <PlugZapIcon data-icon="inline-start" />}
              Test
            </Button>
            <Button type="button" disabled={saving} onClick={handleSave}>
              {saving ? <Spinner /> : <SaveIcon data-icon="inline-start" />}
              {connected ? "Save changes" : "Connect Google Drive"}
            </Button>
            {connected && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSetupOpen(false)}
              >
                Close
              </Button>
            )}
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => setSetupOpen(true)}
          >
            Edit connection
          </Button>
        )}
        {connected && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={disconnecting}
              >
                {disconnecting ? <Spinner /> : null}
                Disconnect
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect Google Drive?</AlertDialogTitle>
                <AlertDialogDescription>
                  Zenod forgets the service-account key and Zeno loses access
                  to your Drive files. Nothing changes in your Drive.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void handleDisconnect()}
                >
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardFooter>
    </Card>
  )
}
