import type { ExecutionTicket } from "./executionQueue.js";
import type { JourneySnapshot, JourneyStore } from "./journeyStore.js";
import { callPeerTool, type PeerConfig, type PeerToolResult } from "./peerClient.js";

export interface CreateIssueThenRunInput {
  originalRequest: string;
  conversationId?: string | null;
  surface?: string;
  issue: {
    repo?: string;
    title: string;
    body?: string;
    labels?: string[];
  };
  runInstructions?: string;
  notifyOnStart?: boolean;
}

export interface CreatedIssueArtifact {
  target: string;
  repo: string;
  issueNumber: number;
  url: string;
  labels: string[];
}

export interface CreateIssueThenRunResult {
  journeyId: string;
  createdIssue?: CreatedIssueArtifact;
  execution?: ExecutionTicket;
  status: "completed" | "blocked";
  message: string;
  snapshot: JourneySnapshot;
}

export type JourneyPeerToolCaller = (peer: PeerConfig, tool: string, args: Record<string, unknown>) => Promise<PeerToolResult>;

const REPO_REF_RE = /\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/;

export function repoFromText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = REPO_REF_RE.exec(text);
  return match?.[1];
}

export function normalizeIssueRequest<T extends { repo?: string; labels?: string[] }>(
  issue: T,
  fallbackRepo?: string,
): T {
  const labelRepo = issue.labels?.find((label) => REPO_REF_RE.test(label));
  const repo = issue.repo || labelRepo || fallbackRepo;
  const labels = issue.labels?.filter((label) => label !== "repo" && label !== labelRepo);
  return {
    ...issue,
    ...(repo ? { repo } : {}),
    ...(labels ? { labels } : {}),
  };
}

const OBJECTIVE_RE = /\b(objective|goal|purpose)\s*:/i;
const SCOPE_RE = /\b(scope|in scope|out of scope|non-goals?)\s*:/i;
const DONE_RE = /\b(acceptance criteria|done when|definition of done|success criteria|expected outcome|outcome)\s*:/i;
const CONTEXT_RE = /\b(source context|context|source refs?|relevant files?|evidence)\s*:/i;

export function validateCreateIssueThenRunRequest(request: CreateIssueThenRunInput): string[] {
  const issue = normalizeIssueRequest(request.issue, repoFromText(request.originalRequest));
  const body = issue.body?.trim() ?? "";
  const missing: string[] = [];

  if (!issue.repo) {
    missing.push("target repo");
  }
  if (!body) {
    missing.push("issue body");
    return missing;
  }
  if (!OBJECTIVE_RE.test(body)) missing.push("objective");
  if (!SCOPE_RE.test(body)) missing.push("scope boundaries");
  if (!DONE_RE.test(body)) missing.push("acceptance criteria or done condition");
  if (!CONTEXT_RE.test(body)) missing.push("source context");

  return missing;
}

function wantsTerminalOnlyNotification(request: CreateIssueThenRunInput): boolean {
  if (request.notifyOnStart === false) return true;
  const text = [request.originalRequest, request.runInstructions].filter(Boolean).join("\n");
  return /\bnotify\s*(?:me\s*)?(?:only\s*)?after\b/i.test(text) || /\bterminal(?:\/|\s+or\s+)blocked\b/i.test(text) || /\bdo not send (?:a )?(?:pickup|start)/i.test(text);
}

export function peerToolText(result: PeerToolResult): string {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function structuredObject(result: PeerToolResult): Record<string, unknown> | null {
  return result.structuredContent && typeof result.structuredContent === "object" ? result.structuredContent : null;
}

export function createdIssueFromStructured(result: PeerToolResult): CreatedIssueArtifact | null {
  const data = structuredObject(result);
  if (!data) return null;
  const repo = typeof data.repo === "string" ? data.repo.trim() : "";
  const issueNumber = typeof data.issueNumber === "number" ? data.issueNumber : Number(data.issueNumber);
  const url = typeof data.issueUrl === "string" ? data.issueUrl : typeof data.url === "string" ? data.url : "";
  const labels = Array.isArray(data.labels) ? data.labels.filter((item): item is string => typeof item === "string") : [];
  if (!repo || !Number.isInteger(issueNumber) || issueNumber <= 0 || !url) return null;
  return { target: `${repo}#${issueNumber}`, repo, issueNumber, url, labels };
}

export function executionFromStructured(result: PeerToolResult): ExecutionTicket | null {
  const data = structuredObject(result);
  const ticket = data?.ticket;
  if (!ticket || typeof ticket !== "object") return null;
  const record = ticket as Record<string, unknown>;
  if (typeof record.executionId !== "string" || typeof record.target !== "string" || typeof record.state !== "string") return null;
  return ticket as ExecutionTicket;
}

export async function createIssueThenRunJourney(input: {
  store: JourneyStore;
  archus: PeerConfig;
  epaminon: PeerConfig;
  request: CreateIssueThenRunInput;
  callTool?: JourneyPeerToolCaller;
  now?: () => number;
}): Promise<CreateIssueThenRunResult> {
  const now = input.now ?? Date.now;
  const callTool = input.callTool ?? callPeerTool;
  const request = input.request;
  const issue = normalizeIssueRequest(request.issue, repoFromText(request.originalRequest));
  const journey = input.store.create(
    {
      conversationId: request.conversationId ?? null,
      surface: request.surface ?? "console",
      originalRequest: request.originalRequest,
      context: {
        interpretedGoal: "create a GitHub issue, then run exactly the created issue",
        pattern: "create_issue_then_run",
      },
    },
    now(),
  );

  const missingRunnableInputs = validateCreateIssueThenRunRequest({ ...request, issue });
  if (missingRunnableInputs.length > 0) {
    const clarifyStep = input.store.addStep(
      journey.id,
      {
        owner: "console",
        title: "Clarify create-and-run request",
        input: {
          intent: "journey.create_issue_then_run.clarify",
          missing: missingRunnableInputs,
          expectedArtifactKinds: [],
        },
        idempotencyKey: `journey:${journey.id}:console:clarify_create_issue_then_run`,
      },
      now(),
    );
    const reason = `Create-and-run needs clarification before any issue is created or dispatched: missing ${missingRunnableInputs.join(
      ", ",
    )}. Ask the user for the missing details in one question, then retry after the ticket is runnable.`;
    input.store.blockStep(clarifyStep.id, reason, now());
    return blockedResult(input.store, journey.id, reason);
  }

  const createStep = input.store.addStep(
    journey.id,
    {
      owner: "archus",
      title: "Create GitHub issue",
      input: {
        intent: "github.issue.create",
        repo: issue.repo,
        title: issue.title,
        body: issue.body,
        labels: issue.labels ?? [],
        expectedArtifactKinds: ["github_issue"],
      },
      idempotencyKey: `journey:${journey.id}:archus:create_issue`,
    },
    now(),
  );
  const runStep = input.store.addStep(
    journey.id,
    {
      owner: "epaminon",
      title: "Run created issue",
      dependencyIds: [createStep.id],
      input: {
        intent: "execution.issue.run",
        dependsOn: createStep.id,
        runInstructions: request.runInstructions,
        expectedArtifactKinds: ["execution_record"],
      },
      idempotencyKey: `journey:${journey.id}:epaminon:run_created_issue`,
    },
    now(),
  );

  input.store.dispatchStep(createStep.id, { deadlineAt: now() + 5 * 60_000 }, now());
  const createResult = await callTool(input.archus, "create_issue", {
    ...(issue.repo ? { repo: issue.repo } : {}),
    title: issue.title,
    ...(issue.body !== undefined ? { body: issue.body } : {}),
    labels: issue.labels ?? [],
  });
  if (createResult.isError) {
    const reason = peerToolText(createResult) || "Archus create_issue failed";
    input.store.blockStep(createStep.id, reason, now());
    return blockedResult(input.store, journey.id, reason);
  }

  const createdIssue = createdIssueFromStructured(createResult);
  if (!createdIssue) {
    const reason = "Archus create_issue did not return a structured issue artifact";
    input.store.blockStep(createStep.id, reason, now());
    return blockedResult(input.store, journey.id, reason);
  }

  input.store.addArtifact(
    journey.id,
    {
      stepId: createStep.id,
      kind: "github_issue",
      artifactKey: `github:${createdIssue.target}`,
      data: { ...createdIssue },
    },
    now(),
  );
  input.store.completeStep(createStep.id, { createdIssue }, now());

  input.store.dispatchStep(runStep.id, { deadlineAt: now() + 5 * 60_000 }, now());
  const notifyOnStart = wantsTerminalOnlyNotification(request) ? false : undefined;
  const executionResult = await callTool(input.epaminon, "epaminon.run_existing_issue", {
    target: createdIssue.target,
    ...(request.runInstructions ? { instructions: request.runInstructions } : {}),
    ...(notifyOnStart === false ? { notifyOnStart: false } : {}),
  });
  if (executionResult.isError) {
    const reason = peerToolText(executionResult) || "Epaminon run_existing_issue failed";
    input.store.blockStep(runStep.id, reason, now());
    return blockedResult(input.store, journey.id, `Created ${createdIssue.target}, but did not run it: ${reason}`, createdIssue);
  }

  const execution = executionFromStructured(executionResult);
  if (!execution) {
    const reason = "Epaminon run_existing_issue did not return a structured execution ticket";
    input.store.blockStep(runStep.id, reason, now());
    return blockedResult(input.store, journey.id, `Created ${createdIssue.target}, but did not run it: ${reason}`, createdIssue);
  }

  input.store.addArtifact(
    journey.id,
    {
      stepId: runStep.id,
      kind: "execution_record",
      artifactKey: `execution:${execution.executionId}`,
      data: execution as unknown as Record<string, unknown>,
    },
    now(),
  );
  input.store.completeStep(runStep.id, { execution }, now());
  input.store.completeJourneyIfReady(journey.id, now());

  return {
    journeyId: journey.id,
    createdIssue,
    execution,
    status: "completed",
    message: `Created ${createdIssue.target} (${createdIssue.url}) and dispatched execution ${execution.executionId} (${execution.state}).`,
    snapshot: input.store.snapshot(journey.id)!,
  };
}

function blockedResult(
  store: JourneyStore,
  journeyId: string,
  reason: string,
  createdIssue?: CreatedIssueArtifact,
): CreateIssueThenRunResult {
  return {
    journeyId,
    ...(createdIssue ? { createdIssue } : {}),
    status: "blocked",
    message: reason,
    snapshot: store.snapshot(journeyId)!,
  };
}
