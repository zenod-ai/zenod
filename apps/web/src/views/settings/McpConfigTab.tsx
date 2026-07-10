import * as React from "react"
import { ServerCogIcon } from "lucide-react"
import { toast } from "sonner"

import { api, errorMessage, type McpConfigResponse } from "@/lib/api"
import { CopyButton } from "@/components/copy-button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

export function useMcpConfig() {
  const [data, setData] = React.useState<McpConfigResponse | null>(null)

  React.useEffect(() => {
    let cancelled = false
    api<McpConfigResponse>("/api/mcp-config")
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error("Could not load MCP config", {
            description: errorMessage(err),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return data
}

export function McpConfigTab() {
  const data = useMcpConfig()

  if (data === null) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  const mcpUrl = window.location.origin + data.endpoint

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">MCP Config</h2>
        <p className="text-sm text-muted-foreground">
          {data.unit.name}@{data.unit.version}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ServerCogIcon className="size-4" />
            Endpoint
          </CardTitle>
          <CardDescription>{data.tenant.name ?? data.tenant.id}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field orientation="vertical">
            <FieldContent>
              <FieldLabel htmlFor="mcp-config-url">URL</FieldLabel>
            </FieldContent>
            <div className="flex gap-2">
              <Input id="mcp-config-url" value={mcpUrl} readOnly />
              <CopyButton value={mcpUrl} />
            </div>
          </Field>
          <div className="flex flex-wrap gap-2">
            {data.auth.bearer && <Badge variant="outline">bearer</Badge>}
            {data.auth.tokenedUrl && (
              <Badge variant="outline">tokened URL</Badge>
            )}
            {data.auth.oauth && <Badge variant="outline">OAuth</Badge>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Routes</CardTitle>
          <CardDescription>{data.routes.length} active</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {data.routes.map((route) => (
              <code key={route} className="rounded-md bg-muted px-2 py-1 text-xs">
                {route}
              </code>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
