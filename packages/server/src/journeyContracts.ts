import type { JourneyArtifact, JourneyContext, JourneySnapshot, JourneyStep, JourneyStepStatus } from "./journeyStore.js";

export type JourneyAgentName = "console" | "archus" | "epaminon" | "zenod" | "phylax" | "callisthenes" | string;

export type JourneyStepIntent =
  | "github.issue.create"
  | "github.issue.read"
  | "github.issue.update"
  | "github.issue.close"
  | "execution.issue.run"
  | "execution.issue.status"
  | "memory.store"
  | "memory.search"
  | "notification.send"
  | "outbound.post"
  | string;

export type JourneyArtifactKind =
  | "github_issue"
  | "execution_record"
  | "pull_request"
  | "memory_evidence"
  | "notification"
  | "outbound_post"
  | string;

export type StepCallbackStatus = Extract<JourneyStepStatus, "completed" | "blocked" | "failed" | "running">;

export interface JourneyArtifactInput {
  kind: JourneyArtifactKind;
  artifactKey: string;
  data: JourneyContext;
}

export interface JourneyContextPacket {
  journeyId: string;
  conversationId: string | null;
  surface: string;
  originalRequest: string;
  interpretedGoal: string | null;
  user: JourneyContext;
  completedSteps: Array<{
    stepId: string;
    owner: string;
    title: string;
    result: JourneyContext | null;
  }>;
  knownArtifacts: JourneyArtifact[];
  blockers: Array<{
    stepId: string;
    owner: string;
    blocker: string;
  }>;
}

export interface StepDispatchPacket {
  journeyId: string;
  stepId: string;
  agent: JourneyAgentName;
  intent: JourneyStepIntent;
  journeyContext: JourneyContextPacket;
  stepInput: JourneyContext;
  callback: {
    url: string;
    idempotencyKey: string;
  };
  idempotencyKey: string;
  allowedActions: string[];
}

export interface StepCallbackResult {
  journeyId: string;
  stepId: string;
  status: StepCallbackStatus;
  idempotencyKey: string;
  result?: JourneyContext;
  createdArtifacts?: JourneyArtifactInput[];
  blockers?: string[];
  questionForUser?: string;
  nextRecommendedAction?: JourneyContext;
}

export interface CallbackValidationResult {
  ok: boolean;
  errors: string[];
  duplicate: boolean;
}

export function journeyStepIdempotencyKey(journeyId: string, stepId: string): string {
  return `journey:${journeyId}:step:${stepId}`;
}

export function buildJourneyContextPacket(snapshot: JourneySnapshot): JourneyContextPacket {
  return {
    journeyId: snapshot.journey.id,
    conversationId: snapshot.journey.conversationId,
    surface: snapshot.journey.surface,
    originalRequest: snapshot.journey.originalRequest,
    interpretedGoal: typeof snapshot.journey.context.interpretedGoal === "string" ? snapshot.journey.context.interpretedGoal : null,
    user: (snapshot.journey.context.user && typeof snapshot.journey.context.user === "object"
      ? snapshot.journey.context.user
      : {}) as JourneyContext,
    completedSteps: snapshot.steps
      .filter((step) => step.status === "completed")
      .map((step) => ({
        stepId: step.id,
        owner: step.owner,
        title: step.title,
        result: step.result,
      })),
    knownArtifacts: snapshot.artifacts,
    blockers: snapshot.steps
      .filter((step) => step.blocker || step.error)
      .map((step) => ({
        stepId: step.id,
        owner: step.owner,
        blocker: step.blocker ?? step.error ?? "",
      })),
  };
}

export function buildStepDispatchPacket(input: {
  snapshot: JourneySnapshot;
  step: JourneyStep;
  intent: JourneyStepIntent;
  callbackBaseUrl: string;
  allowedActions?: string[];
}): StepDispatchPacket {
  const idempotencyKey = input.step.idempotencyKey ?? journeyStepIdempotencyKey(input.snapshot.journey.id, input.step.id);
  const callbackBaseUrl = input.callbackBaseUrl.replace(/\/+$/, "");
  return {
    journeyId: input.snapshot.journey.id,
    stepId: input.step.id,
    agent: input.step.owner,
    intent: input.intent,
    journeyContext: buildJourneyContextPacket(input.snapshot),
    stepInput: input.step.input,
    callback: {
      url: `${callbackBaseUrl}/internal/journeys/${input.snapshot.journey.id}/steps/${input.step.id}/callback`,
      idempotencyKey,
    },
    idempotencyKey,
    allowedActions: input.allowedActions ?? [],
  };
}

export function validateStepCallback(
  step: JourneyStep,
  callback: StepCallbackResult,
  options: { expectedArtifactKinds?: string[] } = {},
): CallbackValidationResult {
  const errors: string[] = [];
  if (callback.journeyId !== step.journeyId) errors.push(`callback journeyId ${callback.journeyId} does not match step journeyId ${step.journeyId}`);
  if (callback.stepId !== step.id) errors.push(`callback stepId ${callback.stepId} does not match step id ${step.id}`);
  const expectedKey = step.idempotencyKey ?? journeyStepIdempotencyKey(step.journeyId, step.id);
  if (callback.idempotencyKey !== expectedKey) errors.push("callback idempotencyKey does not match step idempotencyKey");
  if (!["completed", "blocked", "failed", "running"].includes(callback.status)) errors.push(`invalid callback status: ${callback.status}`);
  for (const kind of options.expectedArtifactKinds ?? []) {
    if (!callback.createdArtifacts?.some((artifact) => artifact.kind === kind)) {
      errors.push(`callback is missing expected artifact kind: ${kind}`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    duplicate: step.status === "completed" || step.status === "blocked" || step.status === "failed",
  };
}
