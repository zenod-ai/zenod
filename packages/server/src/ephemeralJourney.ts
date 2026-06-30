import type { ExecutionTicket } from "./executionQueue.js";
import type { JourneySnapshot, JourneyStore } from "./journeyStore.js";
import { callPeerTool, type PeerConfig } from "./peerClient.js";
import { executionFromStructured, peerToolText, type JourneyPeerToolCaller } from "./createIssueRunJourney.js";

export interface RunEphemeralJourneyInput {
  originalRequest: string;
  conversationId?: string | null;
  surface?: string;
  objective: string;
  instructions?: string;
  artifactPolicy?: string;
  repo?: string;
  path?: string;
}

export interface RunEphemeralJourneyResult {
  journeyId: string;
  execution?: ExecutionTicket;
  status: "completed" | "blocked";
  message: string;
  snapshot: JourneySnapshot;
}

export async function runEphemeralJourney(input: {
  store: JourneyStore;
  epaminon: PeerConfig;
  request: RunEphemeralJourneyInput;
  callTool?: JourneyPeerToolCaller;
  now?: () => number;
}): Promise<RunEphemeralJourneyResult> {
  const now = input.now ?? Date.now;
  const callTool = input.callTool ?? callPeerTool;
  const request = input.request;
  const journey = input.store.create(
    {
      conversationId: request.conversationId ?? null,
      surface: request.surface ?? "console",
      originalRequest: request.originalRequest,
      context: {
        interpretedGoal: "run one ephemeral task without creating a GitHub issue by default",
        pattern: "ephemeral_execution",
      },
    },
    now(),
  );
  const step = input.store.addStep(
    journey.id,
    {
      owner: "epaminon",
      title: "Run ephemeral task",
      input: {
        intent: "execution.ephemeral.run",
        objective: request.objective,
        instructions: request.instructions,
        artifactPolicy: request.artifactPolicy,
        expectedArtifactKinds: ["execution_record"],
      },
      idempotencyKey: `journey:${journey.id}:epaminon:run_ephemeral_task`,
    },
    now(),
  );

  input.store.dispatchStep(step.id, { deadlineAt: now() + 5 * 60_000 }, now());
  const result = await callTool(input.epaminon, "epaminon.run_ephemeral_task", {
    objective: request.objective,
    ...(request.instructions ? { instructions: request.instructions } : {}),
    ...(request.repo ? { repo: request.repo } : {}),
    ...(request.path ? { path: request.path } : {}),
    ...(request.artifactPolicy ? { artifactPolicy: request.artifactPolicy } : {}),
  });
  if (result.isError) {
    const reason = peerToolText(result) || "Epaminon run_ephemeral_task failed";
    input.store.blockStep(step.id, reason, now());
    return {
      journeyId: journey.id,
      status: "blocked",
      message: reason,
      snapshot: input.store.snapshot(journey.id)!,
    };
  }

  const execution = executionFromStructured(result);
  if (!execution) {
    const reason = "Epaminon run_ephemeral_task did not return a structured execution ticket";
    input.store.blockStep(step.id, reason, now());
    return {
      journeyId: journey.id,
      status: "blocked",
      message: reason,
      snapshot: input.store.snapshot(journey.id)!,
    };
  }

  input.store.addArtifact(
    journey.id,
    {
      stepId: step.id,
      kind: "execution_record",
      artifactKey: `execution:${execution.executionId}`,
      data: execution as unknown as Record<string, unknown>,
    },
    now(),
  );
  if (execution.state === "blocked" || execution.state === "failed") {
    const reason = execution.note
      ? `Epaminon ${execution.state} ephemeral execution ${execution.executionId}: ${execution.note}`
      : `Epaminon ${execution.state} ephemeral execution ${execution.executionId}.`;
    input.store.blockStep(step.id, reason, now());
    return {
      journeyId: journey.id,
      execution,
      status: "blocked",
      message: reason,
      snapshot: input.store.snapshot(journey.id)!,
    };
  }

  input.store.completeStep(step.id, { execution }, now());
  input.store.completeJourneyIfReady(journey.id, now());
  return {
    journeyId: journey.id,
    execution,
    status: "completed",
    message: `Queued ephemeral execution ${execution.executionId} (${execution.state}).`,
    snapshot: input.store.snapshot(journey.id)!,
  };
}
