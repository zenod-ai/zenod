import type { ExecutionTicket } from "./executionQueue.js";
import type { AddJourneyArtifactInput, JourneyArtifact, JourneyStep } from "./journeyStore.js";
import type { JourneyReconcileAction, JourneyStepReconciler } from "./journeyMonitor.js";
import type { ToolResponse } from "./toolOutput.js";

export interface JourneyAuthorityReaders {
  readIssue?: (target: string) => Promise<ToolResponse>;
  readExecution?: (reference: string) => Promise<ExecutionTicket | null>;
}

const terminalExecutionStates = new Set(["done", "needs-review", "approved"]);
const blockedExecutionStates = new Set(["blocked", "failed"]);

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function issueTargetFromArtifact(artifact: JourneyArtifact): string | undefined {
  if (artifact.kind !== "github_issue") return undefined;
  return stringField(artifact.data.target) ?? artifact.artifactKey.replace(/^github:/, "");
}

function executionRefFromArtifact(artifact: JourneyArtifact): string | undefined {
  if (artifact.kind !== "execution_record") return undefined;
  return stringField(artifact.data.executionId) ?? stringField(artifact.data.target) ?? artifact.artifactKey.replace(/^execution:/, "");
}

function artifactsForStep(step: JourneyStep, artifacts: JourneyArtifact[]): JourneyArtifact[] {
  return artifacts.filter((artifact) => artifact.stepId === step.id);
}

function issueTargetForStep(step: JourneyStep, artifacts: JourneyArtifact[]): string | undefined {
  return (
    stringField(step.input.target) ??
    stringField(step.externalRefs.target) ??
    stringField((step.result as Record<string, unknown> | null)?.target) ??
    artifactsForStep(step, artifacts).map(issueTargetFromArtifact).find(Boolean)
  );
}

function executionRefForStep(step: JourneyStep, artifacts: JourneyArtifact[]): string | undefined {
  return (
    stringField(step.input.executionId) ??
    stringField(step.externalRefs.executionId) ??
    stringField(step.input.target) ??
    stringField(step.externalRefs.target) ??
    artifactsForStep(step, artifacts).map(executionRefFromArtifact).find(Boolean)
  );
}

function issueEvidence(response: ToolResponse): Record<string, unknown> | undefined {
  return response.evidence.find((item) => item.kind === "issue");
}

function executionArtifact(ticket: ExecutionTicket): AddJourneyArtifactInput[] {
  return [
    {
      kind: "execution_record",
      artifactKey: `execution:${ticket.executionId}`,
      data: ticket as unknown as Record<string, unknown>,
    },
  ];
}

function issueArtifact(issue: Record<string, unknown>): AddJourneyArtifactInput[] {
  const target = stringField(issue.target);
  if (!target) return [];
  return [
    {
      kind: "github_issue",
      artifactKey: `github:${target}`,
      data: issue,
    },
  ];
}

async function reconcileGithubIssueStep(
  step: JourneyStep,
  artifacts: JourneyArtifact[],
  readers: JourneyAuthorityReaders,
): Promise<JourneyReconcileAction> {
  if (!readers.readIssue) return { status: "unchanged", reason: "no GitHub authority reader configured" };
  const target = issueTargetForStep(step, artifacts);
  if (!target) {
    return { status: "blocked", reason: "cannot reconcile GitHub step: no issue target or artifact was recorded" };
  }

  const response = await readers.readIssue(target);
  const issue = issueEvidence(response);
  if (!issue) {
    const message = response.errors?.at(0)?.message ?? response.text ?? "GitHub issue read returned no issue evidence";
    return { status: "blocked", reason: `cannot reconcile GitHub step ${target}: ${message}` };
  }

  return {
    status: "completed",
    result: { target, issue },
    artifacts: issueArtifact(issue),
  };
}

async function reconcileExecutionStep(
  step: JourneyStep,
  artifacts: JourneyArtifact[],
  readers: JourneyAuthorityReaders,
): Promise<JourneyReconcileAction> {
  if (!readers.readExecution) return { status: "unchanged", reason: "no execution authority reader configured" };
  const reference = executionRefForStep(step, artifacts);
  if (!reference) {
    return { status: "blocked", reason: "cannot reconcile execution step: no execution id or target was recorded" };
  }

  const ticket = await readers.readExecution(reference);
  if (!ticket) return { status: "unchanged", reason: `execution authority has no record for ${reference}` };

  if (blockedExecutionStates.has(ticket.state)) {
    return {
      status: "blocked",
      reason: ticket.note ? `execution ${ticket.executionId} ${ticket.state}: ${ticket.note}` : `execution ${ticket.executionId} ${ticket.state}`,
      artifacts: executionArtifact(ticket),
    };
  }

  if (terminalExecutionStates.has(ticket.state)) {
    return {
      status: "completed",
      result: { execution: ticket },
      artifacts: executionArtifact(ticket),
    };
  }

  return {
    status: "running",
    result: { execution: ticket },
    artifacts: executionArtifact(ticket),
  };
}

function reconcileRecordedNotification(step: JourneyStep, artifacts: JourneyArtifact[]): JourneyReconcileAction {
  const notification = artifactsForStep(step, artifacts).find((artifact) => artifact.kind === "notification");
  if (!notification) return { status: "unchanged", reason: "no notification artifact recorded yet" };
  return { status: "completed", result: { notification: notification.data } };
}

export function createJourneyAuthorityReconciler(readers: JourneyAuthorityReaders): JourneyStepReconciler {
  return async ({ step, snapshot }) => {
    const intent = stringField(step.input.intent) ?? "";
    if (step.owner === "archus" || intent.startsWith("github.issue.")) {
      return reconcileGithubIssueStep(step, snapshot.artifacts, readers);
    }
    if (step.owner === "epaminon" || intent.startsWith("execution.")) {
      return reconcileExecutionStep(step, snapshot.artifacts, readers);
    }
    if (step.owner === "phylax" || intent.startsWith("notification.")) {
      return reconcileRecordedNotification(step, snapshot.artifacts);
    }
    return { status: "unchanged", reason: `no authority reconciler for owner ${step.owner}` };
  };
}
