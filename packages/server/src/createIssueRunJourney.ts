import { LIFE_BACKLOG_REPO } from "./backlogRouter.js";
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

/**
 * E-4 worker-route (obsidian-brain#231): is this issue-create aimed at a repo OTHER than
 * the life backlog? Archus writes ONLY the life backlog (there is no GitHub App to
 * install — M1 is dead). Any other repo's issue MUST be created by an Epaminon worker
 * using the runner's own `gh` auth on the VPS, NEVER via the Console/Archus App token.
 */
export function isForeignRepo(repo: string | undefined): boolean {
  const r = String(repo || "").trim().toLowerCase();
  return r.length > 0 && r !== LIFE_BACKLOG_REPO.toLowerCase();
}

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

/**
 * Make a one-off request runnable instead of letting it die at the clarify gate.
 *
 * A request with a clear objective used to hard-block on missing *ceremonial*
 * sections (scope / acceptance / source context) — that silently killed real tasks
 * (e.g. a research VN that produced nothing). The substance the validator actually
 * needs is the objective; the rest can be defaulted. So: if the body is already
 * structured, keep it; if it has content but lacks the sections, fold that content
 * into a structured body with sensible defaults; only a genuinely empty request
 * (no body AND no title) is left to the clarify gate (preserving ask-first).
 */
export function ensureRunnableBody(issue: { title: string; body?: string }): string {
  const raw = (issue.body ?? "").trim();
  if (raw && OBJECTIVE_RE.test(raw) && SCOPE_RE.test(raw) && DONE_RE.test(raw) && CONTEXT_RE.test(raw)) {
    return raw; // already runnable — leave it untouched
  }
  const objective = raw || issue.title.trim();
  if (!objective) return raw; // nothing actionable — let the validator block and ask
  return [
    `Objective: ${objective}`,
    "",
    "Scope: Complete the objective above; make no unrelated changes.",
    "",
    "Acceptance criteria: The objective is achieved. For code work the change is committed and pushed with the real commit/PR URL reported as evidence; for research/ops the result is committed or reported as described.",
    "",
    "Source context: One-off task auto-structured from the user's request; full intent is in the objective.",
  ].join("\n");
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
  // Auto-structure a clear request so it doesn't silently die at the clarify gate on
  // missing ceremonial sections (#stab). Only a genuinely empty request still blocks.
  issue.body = ensureRunnableBody(issue);
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

  // E-4 worker-route (obsidian-brain#231, same standing rule as S0-T5/#224): a create
  // aimed at ANY repo other than the life backlog is NOT Archus's to write via the
  // (dead) Console App token. Deterministically hand it to an Epaminon worker that
  // creates the issue in the target repo under the runner's own `gh` auth and runs it,
  // then propagate the REAL created-issue URL as the receipt. The repo was already
  // decided upstream (routeBacklogRequest); no LLM chooses it here.
  if (isForeignRepo(issue.repo)) {
    return dispatchForeignRepoWorker({
      store: input.store,
      journeyId: journey.id,
      epaminon: input.epaminon,
      callTool,
      now,
      request,
      issue: { repo: issue.repo!, title: issue.title, body: issue.body! },
    });
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

/**
 * Best-effort receipt for a worker-created issue: prefer the ticket's fully-qualified
 * `target` (owner/repo#N) and its evidence URL; fall back to the target repo. Never
 * fabricates a URL — if the worker did not report one, the target ref is the receipt.
 */
function receiptFromExecution(repo: string, execution: ExecutionTicket): { target: string; url: string } {
  const target = /#\d+$/.test(execution.target) ? execution.target : repo;
  const url = execution.evidenceUrl || execution.deliverable?.prUrl || "";
  return { target, url };
}

const ISSUE_URL_RE = /^https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+$/i;

/**
 * I5-3 — the dispatch composer's rule: this is I5-1's renderer discipline applied to a
 * journey message, not just an outbound send. At dispatch time the worker has not run
 * yet, so the ONLY honest claim is that it was dispatched — never "opened"/"created".
 * The "opened" claim is rendered ONLY once the execution carries a REAL, verified issue
 * URL as its evidence/deliverable (I5-2) — never composed ahead of that receipt.
 */
export function renderForeignRepoDispatchMessage(execution: ExecutionTicket, repo: string): string {
  const receipt = receiptFromExecution(repo, execution);
  if (receipt.url && ISSUE_URL_RE.test(receipt.url)) {
    return `Opened ${receipt.target} (${receipt.url}) — execution ${execution.executionId} (${execution.state}).`;
  }
  return (
    `Dispatched Epaminon worker to create + run the issue in ${repo} (execution ${execution.executionId}) — ` +
    `I'll confirm with the ticket link when it lands.`
  );
}

/**
 * E-4 worker-route. Create-and-run for a FOREIGN repo goes to Epaminon's
 * run_ephemeral_task: the runner creates the issue in the target repo using its own
 * `gh` auth on the VPS and dispatches the run, returning a structured execution
 * ticket. We NEVER call Archus's create_issue (App token) here. The reply carries the
 * real created target/URL as a receipt, or FAILED + reason — never a fabricated
 * success and never the dead "App not installed" error.
 */
async function dispatchForeignRepoWorker(input: {
  store: JourneyStore;
  journeyId: string;
  epaminon: PeerConfig;
  callTool: JourneyPeerToolCaller;
  now: () => number;
  request: CreateIssueThenRunInput;
  issue: { repo: string; title: string; body: string };
}): Promise<CreateIssueThenRunResult> {
  const { store, journeyId, epaminon, callTool, now, request, issue } = input;
  const step = store.addStep(
    journeyId,
    {
      owner: "epaminon",
      title: "Create + run issue in foreign repo (runner gh auth)",
      input: {
        intent: "execution.foreign_repo.create_and_run",
        repo: issue.repo,
        title: issue.title,
        // The worker creates the issue under `gh` auth; Archus's App token is never used.
        via: "epaminon.run_ephemeral_task",
        expectedArtifactKinds: ["execution_record"],
      },
      idempotencyKey: `journey:${journeyId}:epaminon:foreign_repo_create_and_run`,
    },
    now(),
  );

  store.dispatchStep(step.id, { deadlineAt: now() + 5 * 60_000 }, now());
  // I5-2: the generic ephemeral-task prompt defaults to "do not create ... a GitHub
  // issue unless the user explicitly asked for that in the context" (backlog-monitor.mjs
  // ephemeralPrompt) — for THIS route that default actively sabotages the worker-route's
  // own stated intent (create the issue under the runner's gh auth), so a worker could
  // dispatch cleanly and finish with no issue ever created. Make the ask and the
  // artifact policy explicit and unambiguous so the worker actually runs
  // `gh issue create -R <repo>` first and reports the created issue's URL as evidence.
  const objective = (
    `Create a GitHub issue in ${issue.repo} via \`gh issue create -R ${issue.repo}\` under the runner's ` +
    `existing gh auth — title "${issue.title}", body below — THEN execute exactly that issue.\n\n` +
    `Issue body:\n${issue.body}`
  ).trim();
  const artifactPolicy =
    `This IS an issue-creation task: run \`gh issue create -R ${issue.repo}\` first (never skip it), ` +
    `then work the created issue. Report the created issue's URL (https://github.com/${issue.repo}/issues/N) ` +
    `as the deliverable/evidence, in addition to any commit/PR from the work itself.`;
  const result = await callTool(epaminon, "epaminon.run_ephemeral_task", {
    objective,
    repo: issue.repo,
    artifactPolicy,
    ...(request.runInstructions ? { instructions: request.runInstructions } : {}),
  });
  if (result.isError) {
    const reason = peerToolText(result) || "Epaminon run_ephemeral_task failed";
    store.blockStep(step.id, reason, now());
    return blockedResult(store, journeyId, `FAILED to dispatch worker for ${issue.repo}: ${reason}`);
  }

  const execution = executionFromStructured(result);
  if (!execution) {
    const reason = "Epaminon run_ephemeral_task did not return a structured execution ticket";
    store.blockStep(step.id, reason, now());
    return blockedResult(store, journeyId, `FAILED to dispatch worker for ${issue.repo}: ${reason}`);
  }

  store.addArtifact(
    journeyId,
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
      ? `Epaminon ${execution.state} the foreign-repo run: ${execution.note}`
      : `Epaminon ${execution.state} the foreign-repo run.`;
    store.blockStep(step.id, reason, now());
    return blockedResult(store, journeyId, `FAILED (${issue.repo}): ${reason}`, undefined, execution);
  }

  store.completeStep(step.id, { execution }, now());
  store.completeJourneyIfReady(journeyId, now());
  return {
    journeyId,
    execution,
    status: "completed",
    message: renderForeignRepoDispatchMessage(execution, issue.repo),
    snapshot: store.snapshot(journeyId)!,
  };
}

function blockedResult(
  store: JourneyStore,
  journeyId: string,
  reason: string,
  createdIssue?: CreatedIssueArtifact,
  execution?: ExecutionTicket,
): CreateIssueThenRunResult {
  return {
    journeyId,
    ...(createdIssue ? { createdIssue } : {}),
    ...(execution ? { execution } : {}),
    status: "blocked",
    message: reason,
    snapshot: store.snapshot(journeyId)!,
  };
}
