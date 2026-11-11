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

export type PersonaCadence =
  | { every: "night" }
  | { every: "week" }
  | { every: "days"; days: number }

export type PersonaSkill = { id: string; label: string }

export type Persona = {
  id: string
  name: string
  /** One plain line: what it is for. */
  purpose: string
  brief: string
  cadence: PersonaCadence
  defaultCadence: PersonaCadence
  /** The cadence in words. */
  schedule: string
  /** Its pre-loaded skills: the only things it can do. */
  skills: PersonaSkill[]
  enabled: boolean
  /** S35: null when it cannot ask the Team desk; else whether that is switched on (off by default). */
  askTeam?: boolean | null
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
  /** Every skill a persona can be given. */
  skills: PersonaSkill[]
  /** S35: the account has a Team connection its helpers could ask. */
  teamConnected?: boolean
  /** EPIC-23 U7: helpers are still building for this account: every one off, switches disabled. */
  building?: boolean
}

const BASE = "/api/console/personas"

export const readPersonas = () => api<PersonaList>(BASE)
export const setPersonaEnabled = (id: string, enabled: boolean) =>
  api<PersonaList>(`${BASE}/${encodeURIComponent(id)}`, {
    method: "POST",
    body: { enabled },
  })
export const setPersonaCadence = (id: string, cadence: PersonaCadence) =>
  api<PersonaList>(`${BASE}/${encodeURIComponent(id)}`, {
    method: "POST",
    body: { cadence },
  })
export const setPersonaAskTeam = (id: string, askTeam: boolean) =>
  api<PersonaList>(`${BASE}/${encodeURIComponent(id)}`, {
    method: "POST",
    body: { askTeam },
  })
export const runPersonaNow = (id: string) =>
  api<PersonaList & { run: PersonaRun | null }>(
    `${BASE}/${encodeURIComponent(id)}/run`,
    { method: "POST" }
  )
