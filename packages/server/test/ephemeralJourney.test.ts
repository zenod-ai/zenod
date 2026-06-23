import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runEphemeralJourney, type RunEphemeralJourneyInput } from "../src/ephemeralJourney.js";
import { JourneyStore } from "../src/journeyStore.js";
import type { PeerConfig } from "../src/peerClient.js";

const epaminon: PeerConfig = { name: "epaminon", url: "http://epaminon.test/mcp", token: "epaminon-token" };

async function withStore<T>(fn: (store: JourneyStore) => T | Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-ephemeral-journey-"));
  const store = new JourneyStore(join(dir, "journeys.sqlite"));
  try {
    return await fn(store);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function request(overrides: Partial<RunEphemeralJourneyInput> = {}): RunEphemeralJourneyInput {
  return {
    originalRequest: "do one-time research, do not create a ticket",
    objective: "Research one thing without creating a backlog issue.",
    artifactPolicy: "return summary only",
    ...overrides,
  };
}

describe("runEphemeralJourney", () => {
  it("runs through Epaminon and stores an execution artifact without a GitHub issue artifact", async () => {
    await withStore(async (store) => {
      const calls: Array<{ peer: string; tool: string; args: Record<string, unknown> }> = [];
      const result = await runEphemeralJourney({
        store,
        epaminon,
        request: request(),
        callTool: async (peer, tool, args) => {
          calls.push({ peer: peer.name, tool, args });
          return {
            content: [{ type: "text", text: "Queued ephemeral execution ephemeral-test-1: queued" }],
            structuredContent: {
              ticket: {
                executionId: "ephemeral-test-1",
                target: "ephemeral:ephemeral-test-1",
                context: String(args.objective),
                state: "queued",
                updatedAt: 123,
              },
            },
          };
        },
      });

      expect(calls).toEqual([
        {
          peer: "epaminon",
          tool: "epaminon.run_ephemeral_task",
          args: {
            objective: "Research one thing without creating a backlog issue.",
            artifactPolicy: "return summary only",
          },
        },
      ]);
      expect(result.status).toBe("completed");
      expect(result.execution?.target).toBe("ephemeral:ephemeral-test-1");
      expect(result.snapshot.journey.status).toBe("completed");
      expect(result.snapshot.artifacts).toEqual([
        expect.objectContaining({ kind: "execution_record", artifactKey: "execution:ephemeral-test-1" }),
      ]);
      expect(result.snapshot.artifacts.some((artifact) => artifact.kind === "github_issue")).toBe(false);
    });
  });

  it("blocks the journey when Epaminon does not return structured execution evidence", async () => {
    await withStore(async (store) => {
      const result = await runEphemeralJourney({
        store,
        epaminon,
        request: request(),
        callTool: async () => ({ content: [{ type: "text", text: "I will handle it" }] }),
      });

      expect(result.status).toBe("blocked");
      expect(result.message).toContain("did not return a structured execution ticket");
      expect(result.snapshot.journey.status).toBe("blocked");
      expect(result.snapshot.artifacts).toHaveLength(0);
    });
  });
});
