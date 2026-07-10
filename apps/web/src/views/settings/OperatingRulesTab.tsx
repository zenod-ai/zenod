import * as React from "react"
import { RefreshCwIcon, ScrollTextIcon, ShieldCheckIcon } from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  type ConductReceipt,
  type OperatingDirective,
  type OperatingRulesResponse,
} from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

export function useOperatingRules() {
  const [data, setData] = React.useState<OperatingRulesResponse | null>(null)
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      setData(await api<OperatingRulesResponse>("/api/operating-rules"))
    } catch (err) {
      toast.error("Could not load operating rules", {
        description: errorMessage(err),
      })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, refresh }
}

function DirectiveRow({ directive }: { directive: OperatingDirective }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={directive.active ? "default" : "outline"}>
            {directive.active ? "active" : "inactive"}
          </Badge>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {directive.id}
          </span>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          v{directive.version}
        </span>
      </div>
      <p className="text-sm">{directive.text}</p>
      <span className="text-xs text-muted-foreground">
        {directive.source} · {new Date(directive.updatedAt).toLocaleString()}
      </span>
    </div>
  )
}

function ReceiptRow({ receipt }: { receipt: ConductReceipt }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-muted-foreground">
          {receipt.kind}
        </span>
        <Badge variant="outline">{receipt.status}</Badge>
      </div>
      <p className="text-sm">{receipt.summary}</p>
      <span className="text-xs text-muted-foreground">
        {new Date(receipt.at).toLocaleString()} · {receipt.evidence.length}{" "}
        evidence {receipt.evidence.length === 1 ? "handle" : "handles"}
      </span>
    </div>
  )
}

export function OperatingRulesTab() {
  const { data, loading, refresh } = useOperatingRules()

  if (loading && data === null) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (data === null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ScrollTextIcon />
          </EmptyMedia>
          <EmptyTitle>Operating rules unavailable</EmptyTitle>
          <EmptyDescription>Refresh the tenant session.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Operating Rules
          </h2>
          <p className="text-sm text-muted-foreground">
            {data.tenant.name ?? data.tenant.id}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4" />
            SEAM
          </CardTitle>
          <CardDescription>{data.seam.status}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            <Badge variant="outline">{data.seam.receiptDiscipline}</Badge>
            <Badge variant="outline">{data.seam.turnPreamble}</Badge>
            <Badge variant="outline">{data.seam.tenantIsolation}</Badge>
            <Badge variant="outline">{data.seam.dispatchDepth}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Directives</CardTitle>
          <CardDescription>
            {data.turnPreamble.directives.length} active
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.directives.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No directives installed.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.directives.map((directive) => (
                <DirectiveRow key={directive.id} directive={directive} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Turn Preamble</CardTitle>
          <CardDescription>{data.turnPreamble.tenantId}</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-relaxed">
            {data.turnPreamble.text}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conduct Receipts</CardTitle>
          <CardDescription>{data.conductReceipts.length} receipts</CardDescription>
        </CardHeader>
        <CardContent>
          {data.conductReceipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No conduct receipts.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.conductReceipts.map((receipt) => (
                <ReceiptRow key={receipt.id} receipt={receipt} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
