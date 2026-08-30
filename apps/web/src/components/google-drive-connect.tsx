import * as React from "react"
import {
  CheckIcon,
  ExternalLinkIcon,
  LogInIcon,
  PlugZapIcon,
  SaveIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  type DriveStatus,
  type HostedDriveStatus,
  type SettingsResponse,
  type TestResult,
  type TranscriptionStatus,
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
import type { ZenodEdition } from "@/views/zenod-edition"

const CONSOLE_DRIVE_API_URL =
  "https://console.cloud.google.com/apis/library/drive.googleapis.com"
const CONSOLE_OAUTH_URL = "https://console.cloud.google.com/apis/credentials"

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
    return typeof parsed.client_email === "string" ? parsed.client_email : null
  } catch {
    return null
  }
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs">
        {n}
      </span>
      <div className="min-w-0 text-sm text-muted-foreground">{children}</div>
    </div>
  )
}

/** Connect Drive with a managed projection in Hosted and operator controls in self-host. */
export function GoogleDriveConnect({
  edition = "self-hosted",
}: {
  edition?: ZenodEdition
}) {
  const hosted = edition === "hosted"
  const [status, setStatus] = React.useState<
    DriveStatus | HostedDriveStatus | null
  >(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [setupOpen, setSetupOpen] = React.useState(false)
  const [oauthClientId, setOauthClientId] = React.useState("")
  const [oauthClientSecret, setOauthClientSecret] = React.useState("")
  const [json, setJson] = React.useState("")
  const [folderId, setFolderId] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [connecting, setConnecting] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<TestResult | null>(null)
  const [disconnecting, setDisconnecting] = React.useState(false)
  const [model, setModel] = React.useState<TranscriptionStatus | null>(null)

  // Poll the transcription model while it downloads, so "preparing model" shows
  // as setup progress. The fetch is cheap; we stop once it's ready or errors.
  React.useEffect(() => {
    if (hosted) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      void api<TranscriptionStatus>("/api/transcription/status")
        .then((result) => {
          if (cancelled) return
          setModel(result)
          if (!result.ready && !result.error) timer = setTimeout(tick, 4000)
        })
        .catch(() => {
          /* status is decorative */
        })
    }
    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [hosted])

  const loadStatus = React.useCallback(() => {
    return api<DriveStatus | HostedDriveStatus>("/api/drive/status")
      .then((result) => {
        setStatus(result)
        setLoadError(null)
        setFolderId((previous) => previous || (result.folderId ?? ""))
        if (!hosted && "oauthClientId" in result) {
          setOauthClientId(
            (previous) => previous || (result.oauthClientId ?? "")
          )
        }
      })
      .catch((err: unknown) => {
        setLoadError(errorMessage(err))
      })
  }, [hosted])

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
          artifact_archive_provider: "drive",
        },
      })
      setJson("")
      setSetupOpen(false)
      await loadStatus()
      toast.success("Google Drive connected", {
        description:
          "Ask Zeno in the Chat tab to list or transcribe your Drive files.",
      })
    } catch (err) {
      toast.error("Could not save the connection", {
        description: errorMessage(err),
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleOAuthConnect() {
    setConnecting(true)
    try {
      const body: Record<string, string> = hosted
        ? {}
        : { google_drive_folder_id: folderId }
      if (oauthClientId.trim() !== "") {
        body.google_oauth_client_id = oauthClientId.trim()
      }
      if (oauthClientSecret.trim() !== "") {
        body.google_oauth_client_secret = oauthClientSecret
      }
      if (Object.keys(body).length > 0) {
        await api<SettingsResponse>("/api/settings", {
          method: "PUT",
          body,
        })
      }
      window.location.assign("/api/drive/oauth/start")
    } catch (err) {
      toast.error("Could not start Google OAuth", {
        description: errorMessage(err),
      })
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      await api("/api/drive/disconnect", { method: "POST" })
      await loadStatus()
      toast.success("Google Drive disconnected")
    } catch (err) {
      toast.error("Could not disconnect", { description: errorMessage(err) })
    } finally {
      setDisconnecting(false)
    }
  }

  const connected = Boolean(status?.configured)
  const showSetup = hosted ? setupOpen : !connected || setupOpen
  const hostedStatus = status && "oauthAvailable" in status ? status : null
  const selfHostedStatus = status && "authMode" in status ? status : null
  const connectedLabel = hosted
    ? hostedStatus?.accountEmail || "Connected Google account"
    : selfHostedStatus?.authMode === "oauth"
      ? selfHostedStatus.oauthEmail || "Google OAuth user"
      : selfHostedStatus?.clientEmail

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
          {connected && status?.archiveConfigured === false && (
            <Badge variant="destructive">Archive folder missing</Badge>
          )}
        </CardTitle>
        <CardDescription>
          {hosted
            ? "Optional imports and archive copies in a private app-managed folder. This is separate from the authoritative Google Drive or GitHub vault selected above."
            : "Pick one Zenod Drive folder. Drop voice notes or documents there, or in its Inbox/ subfolder, and ask Zeno to transcribe them — Zeno creates archive subfolders inside that same folder."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {connected && connectedLabel && (
          <Field>
            <FieldLabel>
              {hosted || selfHostedStatus?.authMode === "oauth"
                ? "Connected Google account"
                : "Connected service account"}
            </FieldLabel>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">
                {connectedLabel}
              </code>
              <CopyButton value={connectedLabel} />
            </div>
            <FieldDescription>
              {hosted ? (
                "Zenod writes archive/export copies only to its app-managed folder."
              ) : (
                <>
                  {selfHostedStatus?.authMode === "oauth"
                    ? "Uploads use this Google account's Drive quota."
                    : "Any folder shared with this email is visible to Zeno."}{" "}
                  Voice notes are transcribed on this server with{" "}
                  {selfHostedStatus?.transcriptionProvider ??
                    "local whisper.cpp"}{" "}
                  — no API key, no per-minute cost.
                </>
              )}
            </FieldDescription>
            {status?.archiveConfigured === false && (
              <FieldDescription className="text-destructive">
                WhatsApp media receipts will not include Drive links yet:{" "}
                {status.archiveReason}
              </FieldDescription>
            )}
            {!hosted && model && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {model.error ? (
                  <span className="text-destructive">
                    Transcription model failed to download: {model.error}
                  </span>
                ) : model.ready ? (
                  <>
                    <CheckIcon className="size-3.5 text-emerald-500" />
                    Transcription model ({model.model}) ready
                  </>
                ) : model.downloading ? (
                  <>
                    <Spinner className="size-3.5" />
                    Downloading transcription model ({model.model}) — one-time
                    setup, ~1.5 GB…
                  </>
                ) : (
                  <span>
                    Transcription model ({model.model}) downloads on first use.
                  </span>
                )}
              </div>
            )}
          </Field>
        )}

        {showSetup && hosted && (
          <>
            {hostedStatus?.oauthAvailable === false && (
              <p className="text-sm text-destructive">
                Google Drive connection is unavailable for this tenant.
              </p>
            )}
            <div className="flex flex-col gap-3 text-sm text-muted-foreground">
              <p>
                Connect your Google account through Zenod. Zenod creates or
                recovers one private archive folder automatically and requests
                access only to files it creates there.
              </p>
              <p>
                This optional imports/archive folder is separate from the
                authoritative Google Drive or GitHub memory vault selected
                above.
              </p>
              <p>
                Disconnecting removes Zenod access and never deletes files
                already stored in Google Drive.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <Step n={1}>
                In this tenant&apos;s Google Cloud project, create an{" "}
                <strong>OAuth client</strong> for a web application, add{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  {window.location.origin}/api/drive/oauth/callback
                </code>{" "}
                as an authorized redirect URI, and enable the{" "}
                <strong>Google Drive API</strong>.
                <span className="mt-1 flex flex-wrap gap-3">
                  <a
                    className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
                    href={CONSOLE_OAUTH_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    OAuth clients <ExternalLinkIcon className="size-3" />
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
                Paste this tenant&apos;s client ID and client secret, then
                connect the Google account whose Drive should hold its Zenod
                archive.
              </Step>
            </div>
            <FieldDescription>
              After consent, the managed archive folder is ready automatically.
              There is no folder to select.
            </FieldDescription>

            <Field>
              <FieldLabel htmlFor="hosted-drive-oauth-client-id">
                OAuth client ID
              </FieldLabel>
              <Input
                id="hosted-drive-oauth-client-id"
                autoComplete="off"
                placeholder="1234567890-abc.apps.googleusercontent.com"
                value={oauthClientId}
                onChange={(event) => setOauthClientId(event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="hosted-drive-oauth-client-secret">
                OAuth client secret
              </FieldLabel>
              <Input
                id="hosted-drive-oauth-client-secret"
                type="password"
                autoComplete="off"
                placeholder={
                  hostedStatus?.oauthClientConfigured
                    ? "saved; leave blank to keep it"
                    : "GOCSPX-..."
                }
                value={oauthClientSecret}
                onChange={(event) => setOauthClientSecret(event.target.value)}
              />
              <FieldDescription>
                Stored only for this Zenod tenant. Leave blank to keep an
                already saved secret.
              </FieldDescription>
            </Field>
          </>
        )}

        {showSetup && !hosted && (
          <>
            <div className="flex flex-col gap-3">
              <Step n={1}>
                In Google Cloud, create an <strong>OAuth client</strong> for a
                web application, add{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  {window.location.origin}/api/drive/oauth/callback
                </code>{" "}
                as an authorized redirect URI, and make sure the{" "}
                <strong>Google Drive API</strong> is enabled.
                <span className="mt-1 flex flex-wrap gap-3">
                  <a
                    className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
                    href={CONSOLE_OAUTH_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    OAuth clients <ExternalLinkIcon className="size-3" />
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
                Paste the client ID and client secret, choose one Zenod Drive
                folder, then connect with Google. Uploads and archived media
                will be owned by that Google account.
              </Step>
              <Step n={3}>
                From then on Zeno can list and transcribe files in that folder
                or its Inbox/ subfolder; receipts include the final Drive link.
              </Step>
            </div>

            <Field>
              <FieldLabel htmlFor="drive-oauth-client-id">
                OAuth client ID
              </FieldLabel>
              <Input
                id="drive-oauth-client-id"
                autoComplete="off"
                placeholder="1234567890-abc.apps.googleusercontent.com"
                value={oauthClientId}
                onChange={(event) => setOauthClientId(event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="drive-oauth-client-secret">
                OAuth client secret
              </FieldLabel>
              <Input
                id="drive-oauth-client-secret"
                type="password"
                autoComplete="off"
                placeholder={
                  selfHostedStatus?.oauthClientConfigured
                    ? "saved; leave blank to keep it"
                    : "GOCSPX-..."
                }
                value={oauthClientSecret}
                onChange={(event) => setOauthClientSecret(event.target.value)}
              />
              <FieldDescription>
                Stored only on this server. Leave blank when reconnecting with
                an already saved secret.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="drive-folder-id">
                Zenod Drive folder ID
              </FieldLabel>
              <Input
                id="drive-folder-id"
                autoComplete="off"
                placeholder="the part after /folders/ in the folder URL"
                value={folderId}
                onChange={(event) => setFolderId(event.target.value)}
              />
              <FieldDescription>
                Use one folder. Zeno creates Inbox/ and Archive/ subfolders
                inside it as needed.
              </FieldDescription>
            </Field>

            <div className="border-t pt-4">
              <p className="text-sm font-medium">Service account fallback</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Use this only for Shared Drive setups. My Drive uploads from a
                service account can fail because service accounts have no Drive
                storage quota.
              </p>
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

            <FieldDescription>
              Voice notes are transcribed locally with whisper.cpp
              (large-v3-turbo), built into this server — no API key, no
              per-minute cost. The model downloads once on the first
              transcription.
            </FieldDescription>

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
              disabled={
                connecting || (hosted && hostedStatus?.oauthAvailable === false)
              }
              onClick={handleOAuthConnect}
            >
              {connecting ? (
                <Spinner />
              ) : (
                <LogInIcon data-icon="inline-start" />
              )}
              Connect with Google
            </Button>
            {!hosted && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={testing}
                  onClick={handleTest}
                >
                  {testing ? (
                    <Spinner />
                  ) : (
                    <PlugZapIcon data-icon="inline-start" />
                  )}
                  Test
                </Button>
                <Button type="button" disabled={saving} onClick={handleSave}>
                  {saving ? <Spinner /> : <SaveIcon data-icon="inline-start" />}
                  {connected ? "Save changes" : "Connect Google Drive"}
                </Button>
              </>
            )}
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
            {hosted && !connected
              ? "Set up optional imports & archive"
              : "Edit connection"}
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
                  {hosted
                    ? "Zenod loses access to its managed archive folder. Nothing changes in Google Drive and no files are deleted."
                    : "Zenod forgets the service-account key and Zeno loses access to your Drive files. Nothing changes in your Drive."}
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
