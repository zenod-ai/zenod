import * as React from "react"
import {
  EyeIcon,
  EyeOffIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage, type TokenResponse } from "@/lib/api"
import { CodeSnippet, CopyButton } from "@/components/copy-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

export function ConnectionsTab() {
  const [tokenInfo, setTokenInfo] = React.useState<TokenResponse | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [showToken, setShowToken] = React.useState(false)
  const [regenerating, setRegenerating] = React.useState(false)

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
          setLoadError(errorMessage(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleRegenerate() {
    setRegenerating(true)
    try {
      const result = await api<{ token: string }>("/api/token/regenerate", {
        method: "POST",
      })
      setTokenInfo((previous) =>
        previous === null ? previous : { ...previous, token: result.token }
      )
      toast.success("Token regenerated", {
        description: "Update every connected agent with the new token.",
      })
    } catch (err) {
      toast.error("Could not regenerate token", {
        description: errorMessage(err),
      })
    } finally {
      setRegenerating(false)
    }
  }

  if (loadError !== null) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Could not load connection details</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    )
  }

  if (tokenInfo === null) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const mcpUrl = window.location.origin + tokenInfo.mcpPath
  const claudeCodeCommand = `claude mcp add --transport http zenod ${mcpUrl} --header "Authorization: Bearer ${tokenInfo.token}"`

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>MCP endpoint</CardTitle>
          <CardDescription>
            Agents connect to Zenod over Streamable HTTP using a bearer token.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Field>
            <FieldLabel htmlFor="connections-url">Endpoint URL</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="connections-url"
                readOnly
                value={mcpUrl}
                className="font-mono text-xs"
              />
              <CopyButton value={mcpUrl} />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="connections-token">Bearer token</FieldLabel>
            <div className="flex items-center gap-2">
              <InputGroup>
                <InputGroupInput
                  id="connections-token"
                  readOnly
                  type={showToken ? "text" : "password"}
                  value={tokenInfo.token}
                  className="font-mono text-xs"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    aria-label={showToken ? "Hide token" : "Show token"}
                    onClick={() => setShowToken((previous) => !previous)}
                  >
                    {showToken ? <EyeOffIcon /> : <EyeIcon />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <CopyButton value={tokenInfo.token} />
            </div>
            <FieldDescription>
              Anyone with this token can read and write your vault.
            </FieldDescription>
          </Field>
        </CardContent>
        <CardFooter>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={regenerating}>
                {regenerating ? (
                  <Spinner />
                ) : (
                  <RotateCwIcon data-icon="inline-start" />
                )}
                Regenerate token
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Regenerate the token?</AlertDialogTitle>
                <AlertDialogDescription>
                  The current token stops working immediately and every
                  connected agent is disconnected until you update it with the
                  new token.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={handleRegenerate}
                >
                  Regenerate
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connect a client</CardTitle>
          <CardDescription>
            Copy-paste snippets for the most common Zenod clients.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Field>
            <FieldLabel>Claude Code (CLI)</FieldLabel>
            <CodeSnippet code={claudeCodeCommand} />
          </Field>
          <Field>
            <FieldLabel>Claude.ai custom connector</FieldLabel>
            <CodeSnippet code={mcpUrl} />
            <FieldDescription>
              Add this URL as a custom connector and choose Bearer token
              authentication with the token above.
            </FieldDescription>
          </Field>
        </CardContent>
      </Card>
    </div>
  )
}
