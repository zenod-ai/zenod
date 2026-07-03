import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createIssueThenRunJourney,
  validateCreateIssueThenRunRequest,
  type JourneyPeerToolCaller,
} from "../src/createIssueRunJourney.js";
import { JourneyStore } from "../src/journeyStore.js";
import type { PeerConfig } from "../src/peerClient.js";

const archus: PeerConfig = { name: "archus", url: "http://archus.test/mcp", token: "archus-token" };
const epaminon: PeerConfig = { name: "epaminon", url: "http://epaminon.test/mcp", token: "epaminon-token" };
const runnableBody = [
  "Objective: prove artifact handoff.",
  "Scope: no code changes; only validate the journey handoff.",
  "Acceptance criteria: Epaminon receives the exact created issue.",
  "Source context: live intent ladder create-then-run smoke.",
].join("\n");

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
            content: [{ type: "text", text: "Created AlfaBlok/obsidian-brain#999: https://github.com/AlfaBlok/obsidian-brain/issues/999" }],
            structuredContent: {
              repo: "AlfaBlok/obsidian-brain",
              issueNumber: 500,
              issueUrl: "https://github.com/AlfaBlok/obsidian-brain/issues/500",
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
            repo: "AlfaBlok/obsidian-brain",
            title: "Smoke create then run",
            body: runnableBody,
          },
          runInstructions: "Run the created issue.",
        },
      });

      expect(result.status).toBe("completed");
      expect(result.createdIssue).toMatchObject({
        target: "AlfaBlok/obsidian-brain#500",
        url: "https://github.com/AlfaBlok/obsidian-brain/issues/500",
      });
      expect(calls.map((call) => `${call.peer}:${call.tool}`)).toEqual([
        "archus:create_issue",
        "epaminon:epaminon.run_existing_issue",
      ]);
      expect(calls[1].args.target).toBe("AlfaBlok/obsidian-brain#500");
      expect(result.snapshot.journey.status).toBe("completed");
      expect(result.snapshot.artifacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "github_issue", artifactKey: "github:AlfaBlok/obsidian-brain#500" }),
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
          issue: { repo: "AlfaBlok/obsidian-brain", title: "Won't be created", body: runnableBody },
        },
      });

      expect(result.status).toBe("blocked");
      expect(result.execution).toBeUndefined();
      expect(calls).toEqual([{ peer: "archus", tool: "create_issue" }]);
      expect(result.snapshot.journey.status).toBe("blocked");
      expect(result.snapshot.steps.find((step) => step.owner === "epaminon")?.status).toBe("pending");
    });
  });

  it("routes a foreign-repo create-and-run to the Epaminon worker (gh auth), never Archus create", async () => {
    await withStore(async (store) => {
      const calls: Array<{ peer: string; tool: string; args: Record<string, unknown> }> = [];
      const callTool: JourneyPeerToolCaller = async (peer, tool, args) => {
        calls.push({ peer: peer.name, tool, args });
        // The worker (runner gh auth) mints the issue and returns the ticket carrying
        // the real created target + evidence URL.
        return {
          content: [{ type: "text", text: "Queued direct-test-720" }],
          structuredContent: {
            ticket: {
              executionId: "direct-test-720",
              target: "zenod-ai/zenod#720",
              context: "Run it",
              state: "queued",
              evidenceUrl: "https://github.com/zenod-ai/zenod/issues/720",
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
        request: {
          originalRequest: "create a ticket in zenod-ai/zenod and run it",
          issue: {
            repo: "zenod-ai/zenod",
            title: "Repo inferred create then run",
            body: [
              "Objective: prove the worker route.",
              "Scope: no code changes; create and run only this fixture ticket.",
              "Acceptance criteria: Epaminon receives the foreign repo, not Archus.",
              "Source context: original request names zenod-ai/zenod.",
            ].join("\n"),
            labels: ["status:proposed"],
          },
        },
      });

      expect(result.status).toBe("completed");
      // The App-token path (archus:create_issue) must NEVER be called for a foreign repo.
      expect(calls.some((c) => c.peer === "archus")).toBe(false);
      expect(calls.map((c) => `${c.peer}:${c.tool}`)).toEqual(["epaminon:epaminon.run_ephemeral_task"]);
      expect(calls[0].args).toMatchObject({ repo: "zenod-ai/zenod" });
      // I5-2: the dispatch must UNAMBIGUOUSLY ask the worker to run `gh issue create`
      // — the generic ephemeral-task default ("do not create ... a GitHub issue unless
      // explicitly asked") must never silently swallow this route's own intent.
      expect(String(calls[0].args.objective)).toContain("gh issue create -R zenod-ai/zenod");
      expect(String(calls[0].args.artifactPolicy)).toContain("gh issue create -R zenod-ai/zenod");
      expect(String(calls[0].args.artifactPolicy).toLowerCase()).toContain("deliverable");
      // The created-issue receipt (target + URL) is propagated back.
      expect(result.execution?.target).toBe("zenod-ai/zenod#720");
      expect(result.message).toContain("zenod-ai/zenod#720");
      expect(result.message).toContain("https://github.com/zenod-ai/zenod/issues/720");
    });
  });

  it("keeps the created issue artifact when Epaminon cannot run it", async () => {
    await withStore(async (store) => {
      const callTool: JourneyPeerToolCaller = async (peer) => {
        if (peer.name === "archus") {
          return {
            content: [{ type: "text", text: "Created AlfaBlok/obsidian-brain#501" }],
            structuredContent: {
              repo: "AlfaBlok/obsidian-brain",
              issueNumber: 501,
              issueUrl: "https://github.com/AlfaBlok/obsidian-brain/issues/501",
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
          issue: { repo: "AlfaBlok/obsidian-brain", title: "Create succeeds, run blocks", body: runnableBody },
        },
      });

      expect(result.status).toBe("blocked");
      expect(result.createdIssue?.target).toBe("AlfaBlok/obsidian-brain#501");
      expect(result.message).toContain("Created AlfaBlok/obsidian-brain#501, but did not run it");
      expect(result.execution).toBeUndefined();
      expect(result.snapshot.artifacts).toEqual([
        expect.objectContaining({ kind: "github_issue", artifactKey: "github:AlfaBlok/obsidian-brain#501" }),
      ]);
      expect(result.snapshot.steps.map((step) => `${step.owner}:${step.status}`)).toEqual(["archus:completed", "epaminon:blocked"]);
    });
  });

  it("passes notifyOnStart=false to Epaminon for terminal-only notification requests", async () => {
    await withStore(async (store) => {
      const calls: Array<{ peer: string; tool: string; args: Record<string, unknown> }> = [];
      const callTool: JourneyPeerToolCaller = async (peer, tool, args) => {
        calls.push({ peer: peer.name, tool, args });
        if (peer.name === "archus") {
          return {
            content: [{ type: "text", text: "Created AlfaBlok/obsidian-brain#502" }],
            structuredContent: {
              repo: "AlfaBlok/obsidian-brain",
              issueNumber: 502,
              issueUrl: "https://github.com/AlfaBlok/obsidian-brain/issues/502",
              labels: ["status:proposed"],
            },
          };
        }
        return {
          content: [{ type: "text", text: "Queued direct-test-502" }],
          structuredContent: {
            ticket: {
              executionId: "direct-test-502",
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
        request: {
          originalRequest: "create this and run it, then notify me only after Epaminon reports terminal or blocked",
          issue: { repo: "AlfaBlok/obsidian-brain", title: "Create run terminal notify", body: runnableBody },
          runInstructions: "Do not send a pickup/start notification; terminal notification only.",
        },
      });

      expect(result.status).toBe("completed");
      expect(calls[1]).toMatchObject({
        peer: "epaminon",
        tool: "epaminon.run_existing_issue",
        args: { target: "AlfaBlok/obsidian-brain#502", notifyOnStart: false },
      });
    });
  });

  it("still blocks when the target repo is missing (a clear objective auto-fills the rest, but repo is required)", async () => {
    await withStore(async (store) => {
      const calls: Array<{ peer: string; tool: string }> = [];
      const callTool: JourneyPeerToolCaller = async (peer, tool) => {
        calls.push({ peer: peer.name, tool });
        throw new Error("peer tools should not be called for ambiguous create-and-run");
      };

      const result = await createIssueThenRunJourney({
        store,
        archus,
        epaminon,
        callTool,
        request: {
          originalRequest: "Add this and run it: make the journey ladder ambiguity smoke sentinel better.",
          issue: {
            title: "Improve journey ladder ambiguity smoke sentinel",
            body: "Make the journey ladder ambiguity smoke test better.",
          },
        },
      });

      expect(result.status).toBe("blocked");
      expect(result.createdIssue).toBeUndefined();
      expect(result.execution).toBeUndefined();
      // The clear objective auto-structures (scope/acceptance/source context no longer
      // block); only the genuinely-required target repo is still missing.
      expect(result.message).toContain("missing target repo");
      expect(result.message).not.toContain("scope boundaries");
      expect(result.message).not.toContain("acceptance criteria or done condition");
      expect(calls).toEqual([]);
      expect(result.snapshot.steps).toEqual([
        expect.objectContaining({ owner: "console", title: "Clarify create-and-run request", status: "blocked" }),
      ]);
    });
  });

  it("routes a clear one-off with a thin body to the foreign-repo worker (research-VN fix + gh auth)", async () => {
    await withStore(async (store) => {
      const calls: Array<{ peer: string; tool: string; args: Record<string, unknown> }> = [];
      const callTool: JourneyPeerToolCaller = async (peer, tool, args) => {
        calls.push({ peer: peer.name, tool, args });
        // Foreign repo → the worker mints the issue under gh auth and returns the ticket.
        return {
          isError: false,
          content: [{ type: "text", text: "queued" }],
          structuredContent: {
            ticket: {
              executionId: "999",
              target: "AlfaBlok/idea_scraper#999",
              state: "queued",
              evidenceUrl: "https://github.com/AlfaBlok/idea_scraper/issues/999",
            },
          },
        };
      };

      const result = await createIssueThenRunJourney({
        store,
        archus,
        epaminon,
        callTool,
        request: {
          originalRequest: "research prompt enhancements for the telegram bot and commit a markdown doc",
          issue: {
            repo: "AlfaBlok/idea_scraper",
            title: "Prompt-enhancement research",
            body: "Research prompt-enhancement recommendations for the telegram bot and commit a markdown doc.",
          },
        },
      });

      expect(result.status).toBe("completed");
      // A thin body no longer dies at the clarify gate AND a foreign repo never hits Archus.
      expect(calls.some((c) => c.peer === "archus")).toBe(false);
      expect(calls.map((c) => c.tool)).toEqual(["epaminon.run_ephemeral_task"]);
      expect(result.execution?.target).toBe("AlfaBlok/idea_scraper#999");
      expect(result.message).toContain("https://github.com/AlfaBlok/idea_scraper/issues/999");
    });
  });

  it("propagates a FAILED worker dispatch (no fabricated success, no dead App-token error)", async () => {
    await withStore(async (store) => {
      const calls: Array<{ peer: string; tool: string }> = [];
      const callTool: JourneyPeerToolCaller = async (peer, tool) => {
        calls.push({ peer: peer.name, tool });
        return { isError: true, content: [{ type: "text", text: "runner gh auth unavailable" }] };
      };

      const result = await createIssueThenRunJourney({
        store,
        archus,
        epaminon,
        callTool,
        request: {
          originalRequest: "create and run in AlfaBlok/nectary",
          issue: { repo: "AlfaBlok/nectary", title: "Foreign fail", body: runnableBody },
        },
      });

      expect(result.status).toBe("blocked");
      expect(calls.some((c) => c.peer === "archus")).toBe(false);
      expect(calls.map((c) => c.tool)).toEqual(["epaminon.run_ephemeral_task"]);
      expect(result.message).toContain("FAILED");
      expect(result.message).toContain("runner gh auth unavailable");
      expect(result.message).not.toMatch(/App (not )?installed/i);
    });
  });

  it("reports missing runnable fields deterministically", () => {
    expect(
      validateCreateIssueThenRunRequest({
        originalRequest: "create and run this in AlfaBlok/obsidian-brain",
        issue: {
          title: "Thin ticket",
          body: "Objective: improve the thing.",
        },
      }),
    ).toEqual(["scope boundaries", "acceptance criteria or done condition", "source context"]);
  });
});
