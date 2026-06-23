import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createIssueThenRunJourney, type JourneyPeerToolCaller } from "../src/createIssueRunJourney.js";
import { JourneyStore } from "../src/journeyStore.js";
import type { PeerConfig } from "../src/peerClient.js";

const archus: PeerConfig = { name: "archus", url: "http://archus.test/mcp", token: "archus-token" };
const epaminon: PeerConfig = { name: "epaminon", url: "http://epaminon.test/mcp", token: "epaminon-token" };

async function withStore<T>(fn: (store: JourneyStore) => T | Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-create-run-"));
  const store = new JourneyStore(join(dir, "journeys.sqlite"));
  try {
    return await fn(store);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

describe("createIssueThenRunJourney", () => {
  it("hands Epaminon the structured created issue artifact, not the prose text", async () => {
    await withStore(async (store) => {
      const calls: Array<{ peer: string; tool: string; args: Record<string, unknown> }> = [];
      const callTool: JourneyPeerToolCaller = async (peer, tool, args) => {
        calls.push({ peer: peer.name, tool, args });
        if (peer.name === "archus") {
          return {
            content: [{ type: "text", text: "Created AlfaBlok/zenod#999: https://github.com/AlfaBlok/zenod/issues/999" }],
            structuredContent: {
              repo: "AlfaBlok/zenod",
              issueNumber: 500,
              issueUrl: "https://github.com/AlfaBlok/zenod/issues/500",
              labels: ["status:proposed"],
            },
          };
        }
        return {
          content: [{ type: "text", text: "Queued direct-test-1" }],
          structuredContent: {
            ticket: {
              executionId: "direct-test-1",
              target: args.target,
              context: "Run it",
              state: "queued",
              updatedAt: 123,
            },
          },
        };
      };

      const result = await createIssueThenRunJourney({
        store,
        archus,
        epaminon,
        callTool,
        now: () => 1000,
        request: {
          originalRequest: "create a ticket and run it",
          surface: "chat",
          issue: {
            repo: "AlfaBlok/zenod",
            title: "Smoke create then run",
            body: "Objective: prove artifact handoff.\nDone: Epaminon receives the exact created issue.",
          },
          runInstructions: "Run the created issue.",
        },
      });

      expect(result.status).toBe("completed");
      expect(result.createdIssue).toMatchObject({
        target: "AlfaBlok/zenod#500",
        url: "https://github.com/AlfaBlok/zenod/issues/500",
      });
      expect(calls.map((call) => `${call.peer}:${call.tool}`)).toEqual([
        "archus:create_issue",
        "epaminon:epaminon.run_existing_issue",
      ]);
      expect(calls[1].args.target).toBe("AlfaBlok/zenod#500");
      expect(result.snapshot.journey.status).toBe("completed");
      expect(result.snapshot.artifacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "github_issue", artifactKey: "github:AlfaBlok/zenod#500" }),
        expect.objectContaining({ kind: "execution_record", artifactKey: "execution:direct-test-1" }),
      ]));
    });
  });

  it("does not call Epaminon when Archus fails to create the issue", async () => {
    await withStore(async (store) => {
      const calls: Array<{ peer: string; tool: string }> = [];
      const callTool: JourneyPeerToolCaller = async (peer, tool) => {
        calls.push({ peer: peer.name, tool });
        return {
          content: [{ type: "text", text: "No GitHub repository is configured." }],
          isError: true,
        };
      };

      const result = await createIssueThenRunJourney({
        store,
        archus,
        epaminon,
        callTool,
        request: {
          originalRequest: "create a ticket and run it",
          issue: { title: "Won't be created" },
        },
      });

      expect(result.status).toBe("blocked");
      expect(result.execution).toBeUndefined();
      expect(calls).toEqual([{ peer: "archus", tool: "create_issue" }]);
      expect(result.snapshot.journey.status).toBe("blocked");
      expect(result.snapshot.steps.find((step) => step.owner === "epaminon")?.status).toBe("pending");
    });
  });

  it("keeps the created issue artifact when Epaminon cannot run it", async () => {
    await withStore(async (store) => {
      const callTool: JourneyPeerToolCaller = async (peer) => {
        if (peer.name === "archus") {
          return {
            content: [{ type: "text", text: "Created AlfaBlok/zenod#501" }],
            structuredContent: {
              repo: "AlfaBlok/zenod",
              issueNumber: 501,
              issueUrl: "https://github.com/AlfaBlok/zenod/issues/501",
              labels: ["status:proposed"],
            },
          };
        }
        return {
          content: [{ type: "text", text: "Execution queue is not available." }],
          isError: true,
        };
      };

      const result = await createIssueThenRunJourney({
        store,
        archus,
        epaminon,
        callTool,
        request: {
          originalRequest: "create a ticket and run it",
          issue: { repo: "AlfaBlok/zenod", title: "Create succeeds, run blocks" },
        },
      });

      expect(result.status).toBe("blocked");
      expect(result.createdIssue?.target).toBe("AlfaBlok/zenod#501");
      expect(result.message).toContain("Created AlfaBlok/zenod#501, but did not run it");
      expect(result.execution).toBeUndefined();
      expect(result.snapshot.artifacts).toEqual([
        expect.objectContaining({ kind: "github_issue", artifactKey: "github:AlfaBlok/zenod#501" }),
      ]);
      expect(result.snapshot.steps.map((step) => `${step.owner}:${step.status}`)).toEqual(["archus:completed", "epaminon:blocked"]);
    });
  });
});
