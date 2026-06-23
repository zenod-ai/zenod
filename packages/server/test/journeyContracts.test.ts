import { describe, expect, it } from "vitest";
import {
  buildStepDispatchPacket,
  journeyStepIdempotencyKey,
  validateStepCallback,
  type StepCallbackResult,
} from "../src/journeyContracts.js";
import { JourneyStore } from "../src/journeyStore.js";

describe("journey contracts", () => {
  it("builds an Archus create-issue packet from a journey", () => {
    const store = new JourneyStore(":memory:");
    try {
      const journey = store.create(
        {
          conversationId: "whatsapp:+123",
          surface: "whatsapp",
          originalRequest: "create a ticket for the Drive bug",
          context: {
            interpretedGoal: "Create a GitHub issue for the Drive bug.",
            user: { timezone: "Europe/Paris" },
          },
        },
        100,
      );
      const step = store.addStep(
        journey.id,
        {
          owner: "archus",
          title: "Create Drive bug issue",
          input: { repo: "zenod-ai/zenod", title: "Drive bug" },
          idempotencyKey: journeyStepIdempotencyKey(journey.id, "create-drive-bug"),
        },
        110,
      );
      const packet = buildStepDispatchPacket({
        snapshot: store.snapshot(journey.id)!,
        step,
        intent: "github.issue.create",
        callbackBaseUrl: "https://c1.zenod.dev/",
        allowedActions: ["create_issue"],
      });

      expect(packet).toMatchObject({
        journeyId: journey.id,
        stepId: step.id,
        agent: "archus",
        intent: "github.issue.create",
        stepInput: { repo: "zenod-ai/zenod", title: "Drive bug" },
        callback: {
          url: `https://c1.zenod.dev/internal/journeys/${journey.id}/steps/${step.id}/callback`,
          idempotencyKey: journeyStepIdempotencyKey(journey.id, "create-drive-bug"),
        },
        allowedActions: ["create_issue"],
      });
      expect(packet.journeyContext).toMatchObject({
        originalRequest: "create a ticket for the Drive bug",
        interpretedGoal: "Create a GitHub issue for the Drive bug.",
        user: { timezone: "Europe/Paris" },
      });
    } finally {
      store.close();
    }
  });

  it("builds an Epaminon run packet using the artifact returned by Archus", () => {
    const store = new JourneyStore(":memory:");
    try {
      const journey = store.create({ surface: "console", originalRequest: "create and run it" }, 100);
      const archus = store.addStep(journey.id, { owner: "archus", title: "Create issue" }, 110);
      store.completeStep(archus.id, { target: "zenod-ai/zenod#500" }, 120);
      store.addArtifact(
        journey.id,
        {
          stepId: archus.id,
          kind: "github_issue",
          artifactKey: "github:zenod-ai/zenod#500",
          data: { target: "zenod-ai/zenod#500", url: "https://github.com/zenod-ai/zenod/issues/500" },
        },
        130,
      );
      const epaminon = store.addStep(
        journey.id,
        {
          owner: "epaminon",
          title: "Run created issue",
          dependencyIds: [archus.id],
          input: { targetArtifactKey: "github:zenod-ai/zenod#500" },
        },
        140,
      );

      const packet = buildStepDispatchPacket({
        snapshot: store.snapshot(journey.id)!,
        step: epaminon,
        intent: "execution.issue.run",
        callbackBaseUrl: "https://c1.zenod.dev",
        allowedActions: ["run_issue"],
      });

      expect(packet.agent).toBe("epaminon");
      expect(packet.intent).toBe("execution.issue.run");
      expect(packet.stepInput).toEqual({ targetArtifactKey: "github:zenod-ai/zenod#500" });
      expect(packet.journeyContext.completedSteps).toEqual([
        expect.objectContaining({ stepId: archus.id, owner: "archus", result: { target: "zenod-ai/zenod#500" } }),
      ]);
      expect(packet.journeyContext.knownArtifacts).toEqual([
        expect.objectContaining({
          kind: "github_issue",
          artifactKey: "github:zenod-ai/zenod#500",
          data: expect.objectContaining({ target: "zenod-ai/zenod#500" }),
        }),
      ]);
    } finally {
      store.close();
    }
  });

  it("validates callback coordinates, idempotency, status, and required artifacts", () => {
    const store = new JourneyStore(":memory:");
    try {
      const journey = store.create({ surface: "console", originalRequest: "create issue" }, 100);
      const step = store.addStep(journey.id, {
        owner: "archus",
        title: "Create issue",
        idempotencyKey: journeyStepIdempotencyKey(journey.id, "create-issue"),
      });
      const good: StepCallbackResult = {
        journeyId: journey.id,
        stepId: step.id,
        status: "completed",
        idempotencyKey: journeyStepIdempotencyKey(journey.id, "create-issue"),
        createdArtifacts: [{ kind: "github_issue", artifactKey: "github:repo#1", data: { target: "repo#1" } }],
      };
      expect(validateStepCallback(step, good, { expectedArtifactKinds: ["github_issue"] })).toEqual({
        ok: true,
        errors: [],
        duplicate: false,
      });

      expect(
        validateStepCallback(
          step,
          {
            ...good,
            journeyId: "wrong",
            stepId: "wrong",
            idempotencyKey: "wrong",
            createdArtifacts: [],
          },
          { expectedArtifactKinds: ["github_issue"] },
        ),
      ).toMatchObject({
        ok: false,
        errors: [
          expect.stringContaining("journeyId"),
          expect.stringContaining("stepId"),
          expect.stringContaining("idempotencyKey"),
          expect.stringContaining("github_issue"),
        ],
      });
    } finally {
      store.close();
    }
  });

  it("detects duplicate callbacks for terminal steps", () => {
    const store = new JourneyStore(":memory:");
    try {
      const journey = store.create({ surface: "console", originalRequest: "run issue" });
      const step = store.addStep(journey.id, { owner: "epaminon", title: "Run issue" });
      const completed = store.completeStep(step.id, { executionId: "123" });
      const result = validateStepCallback(completed, {
        journeyId: journey.id,
        stepId: step.id,
        status: "completed",
        idempotencyKey: journeyStepIdempotencyKey(journey.id, step.id),
      });
      expect(result).toMatchObject({ ok: true, duplicate: true });
    } finally {
      store.close();
    }
  });

  it("serializes and reconstructs dispatch packets without losing context", () => {
    const store = new JourneyStore(":memory:");
    try {
      const journey = store.create({ surface: "telegram", originalRequest: "notify me", context: { user: { locale: "en-US" } } });
      const step = store.addStep(journey.id, { owner: "phylax", title: "Notify user", input: { channel: "telegram" } });
      const packet = buildStepDispatchPacket({
        snapshot: store.snapshot(journey.id)!,
        step,
        intent: "notification.send",
        callbackBaseUrl: "https://c1.zenod.dev",
      });
      const restored = JSON.parse(JSON.stringify(packet));

      expect(restored).toEqual(packet);
      expect(restored.journeyContext.user).toEqual({ locale: "en-US" });
      expect(restored.callback.url).toContain(`/internal/journeys/${journey.id}/steps/${step.id}/callback`);
    } finally {
      store.close();
    }
  });
});
