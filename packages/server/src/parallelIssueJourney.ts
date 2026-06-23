import type { JourneySnapshot, JourneyStore } from "./journeyStore.js";
import { callPeerTool, type PeerConfig, type PeerToolResult } from "./peerClient.js";
import {
  createdIssueFromStructured,
  normalizeIssueRequest,
  peerToolText,
  repoFromText,
  type CreatedIssueArtifact,
  type JourneyPeerToolCaller,
} from "./createIssueRunJourney.js";

export interface CreateIssuesJourneyInput {
  originalRequest: string;
  conversationId?: string | null;
  surface?: string;
  issues: Array<{
    repo?: string;
    title: string;
    body?: string;
    labels?: string[];
  }>;
  notify?: {
    message?: string;
  };
}

export interface CreateIssuesJourneyResult {
  journeyId: string;
  createdIssues: CreatedIssueArtifact[];
  status: "completed" | "blocked";
  message: string;
  notificationText?: string;
  snapshot: JourneySnapshot;
}

export async function createIssuesJourney(input: {
  store: JourneyStore;
  archus: PeerConfig;
  phylax?: PeerConfig;
  request: CreateIssuesJourneyInput;
  callTool?: JourneyPeerToolCaller;
  now?: () => number;
}): Promise<CreateIssuesJourneyResult> {
  const now = input.now ?? Date.now;
  const callTool = input.callTool ?? callPeerTool;
  const request = input.request;
  const fallbackRepo = repoFromText(request.originalRequest);
  const issues = request.issues.map((issue) => normalizeIssueRequest(issue, fallbackRepo));
  const notifyMessage = request.notify?.message?.trim();
  const journey = input.store.create(
    {
      conversationId: request.conversationId ?? null,
      surface: request.surface ?? "console",
      originalRequest: request.originalRequest,
      context: {
        interpretedGoal: "create multiple GitHub issues and optionally notify with the verified result",
        pattern: notifyMessage ? "parallel_issue_creation_then_notify" : "parallel_issue_creation",
      },
    },
    now(),
  );

  const createSteps = issues.map((issue, index) =>
    input.store.addStep(
      journey.id,
      {
        owner: "archus",
        title: `Create GitHub issue ${index + 1}`,
        input: {
          intent: "github.issue.create",
          repo: issue.repo,
          title: issue.title,
          body: issue.body,
          labels: issue.labels ?? [],
          expectedArtifactKinds: ["github_issue"],
        },
        idempotencyKey: `journey:${journey.id}:archus:create_issue:${index}`,
      },
      now(),
    ),
  );
  const notifyStep =
    notifyMessage && input.phylax
      ? input.store.addStep(
          journey.id,
          {
            owner: "phylax",
            title: "Notify user about created issues",
            dependencyIds: createSteps.map((step) => step.id),
            input: {
              intent: "notification.send",
              message: notifyMessage,
              dependsOn: createSteps.map((step) => step.id),
              expectedArtifactKinds: ["notification"],
            },
            idempotencyKey: `journey:${journey.id}:phylax:notify_created_issues`,
          },
          now(),
        )
      : null;

  const createdIssues: CreatedIssueArtifact[] = [];
  const failures: string[] = [];
  await Promise.all(
    createSteps.map(async (step, index) => {
      const issue = issues[index]!;
      input.store.dispatchStep(step.id, { deadlineAt: now() + 5 * 60_000 }, now());
      const result = await callTool(input.archus, "create_issue", {
        ...(issue.repo ? { repo: issue.repo } : {}),
        title: issue.title,
        ...(issue.body !== undefined ? { body: issue.body } : {}),
        labels: issue.labels ?? [],
      });
      if (result.isError) {
        const reason = peerToolText(result) || "Archus create_issue failed";
        failures.push(reason);
        input.store.blockStep(step.id, reason, now());
        return;
      }
      const createdIssue = createdIssueFromStructured(result);
      if (!createdIssue) {
        const reason = "Archus create_issue did not return a structured issue artifact";
        failures.push(reason);
        input.store.blockStep(step.id, reason, now());
        return;
      }
      createdIssues.push(createdIssue);
      input.store.addArtifact(
        journey.id,
        {
          stepId: step.id,
          kind: "github_issue",
          artifactKey: `github:${createdIssue.target}`,
          data: { ...createdIssue },
        },
        now(),
      );
      input.store.completeStep(step.id, { createdIssue }, now());
    }),
  );

  if (failures.length > 0) {
    return {
      journeyId: journey.id,
      createdIssues,
      status: "blocked",
      message: `Created ${createdIssues.length}/${issues.length} issue(s); blocked: ${failures.join("; ")}`,
      snapshot: input.store.snapshot(journey.id)!,
    };
  }

  let notificationText: string | undefined;
  if (notifyStep && input.phylax) {
    input.store.readyPendingDependents(journey.id, now());
    input.store.dispatchStep(notifyStep.id, { deadlineAt: now() + 5 * 60_000 }, now());
    const summary = [
      notifyMessage,
      "",
      "Verified created issues:",
      ...createdIssues.map((issue) => `- ${issue.target}: ${issue.url}`),
    ].join("\n");
    const result = await callTool(input.phylax, "chat_with_phylax", { message: summary });
    if (result.isError) {
      const reason = peerToolText(result) || "Phylax notification handoff failed";
      input.store.blockStep(notifyStep.id, reason, now());
      return {
        journeyId: journey.id,
        createdIssues,
        status: "blocked",
        message: `Created ${createdIssues.length} issue(s), but notification handoff failed: ${reason}`,
        snapshot: input.store.snapshot(journey.id)!,
      };
    }
    notificationText = peerToolText(result);
    input.store.addArtifact(
      journey.id,
      {
        stepId: notifyStep.id,
        kind: "notification",
        artifactKey: `notification:${notifyStep.id}`,
        data: { handoff: true, text: notificationText },
      },
      now(),
    );
    input.store.completeStep(notifyStep.id, { notificationText }, now());
  }

  input.store.completeJourneyIfReady(journey.id, now());
  return {
    journeyId: journey.id,
    createdIssues,
    status: "completed",
    message: [
      `Created ${createdIssues.length} issue(s).`,
      ...createdIssues.map((issue) => `${issue.target}: ${issue.url}`),
      ...(notificationText ? ["Notification handoff completed."] : []),
    ].join("\n"),
    ...(notificationText ? { notificationText } : {}),
    snapshot: input.store.snapshot(journey.id)!,
  };
}
