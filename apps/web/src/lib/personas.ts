import { api } from "@/lib/api"

// EPIC-14 S4: the personas' client. Shapes mirror packages/server/src/personaRunner.ts personaView.

export type PersonaRunStatus = "running" | "done" | "skipped" | "capped" | "failed"

export type PersonaRun = {
  id: string
  personaId: string
  trigger: "schedule" | "manual"
  status: PersonaRunStatus
  startedAt: string
  endedAt: string | null
  steps: number
  modelCalls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  summary: string
  inboxItemIds: string[]
  revision: string | null
}

export type Persona = {
  id: string
  name: string
  brief: string
  schedule: string
  permissions: string[]
  enabled: boolean
  limits: { maxSteps: number; maxRunUsd: number; maxMonthUsd: number }
  budget: {
    personaUsd: number
    personaCapUsd: number
    totalUsd: number
    totalCapUsd: number
  }
  nextWakeAt: string | null
  lastRun: PersonaRun | null
  runs: PersonaRun[]
}

export type PersonaList = {
  personas: Persona[]
  budget: { spentUsd: number; capUsd: number }
}

const BASE = "/api/console/personas"

export const readPersonas = () => api<PersonaList>(BASE)
export const setPersonaEnabled = (id: string, enabled: boolean) =>
  api<PersonaList>(`${BASE}/${encodeURIComponent(id)}`, {
    method: "POST",
    body: { enabled },
  })
export const runPersonaNow = (id: string) =>
  api<PersonaList & { run: PersonaRun | null }>(
    `${BASE}/${encodeURIComponent(id)}/run`,
    { method: "POST" }
  )
