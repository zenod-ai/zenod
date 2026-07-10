import * as React from "react"
import { BlocksIcon } from "lucide-react"
import { toast } from "sonner"

import {
  api,
  errorMessage,
  type SkillSettingsResponse,
  type UnitSkillManifest,
} from "@/lib/api"
import { Badge } from "@/components/ui/badge"
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

export function useSkillSettings() {
  const [data, setData] = React.useState<SkillSettingsResponse | null>(null)

  React.useEffect(() => {
    let cancelled = false
    api<SkillSettingsResponse>("/api/skills")
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error("Could not load skills", {
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

function SkillCard({ skill }: { skill: UnitSkillManifest }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{skill.name}</CardTitle>
        <CardDescription>
          {skill.id}
          {skill.version ? `@${skill.version}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {skill.description && <p className="text-sm">{skill.description}</p>}
        {skill.tools && skill.tools.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {skill.tools.map((tool) => (
              <Badge key={tool} variant="outline">
                {tool}
              </Badge>
            ))}
          </div>
        )}
        {skill.receiptExpectations && skill.receiptExpectations.length > 0 && (
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            {skill.receiptExpectations.map((expectation) => (
              <span key={expectation}>{expectation}</span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function SkillSettingsTab() {
  const data = useSkillSettings()

  if (data === null) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    )
  }

  const skills = [
    ...(data.published ? [data.published] : []),
    ...data.installed,
  ]

  if (skills.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BlocksIcon />
          </EmptyMedia>
          <EmptyTitle>No skills</EmptyTitle>
          <EmptyDescription>{data.unit.name}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Skills</h2>
        <p className="text-sm text-muted-foreground">
          {data.tenant.name ?? data.tenant.id}
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {skills.map((skill) => (
          <SkillCard key={skill.id} skill={skill} />
        ))}
      </div>
    </div>
  )
}
