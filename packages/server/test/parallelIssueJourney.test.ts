import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createIssuesJourney, type CreateIssuesJourneyInput } from "../src/parallelIssueJourney.js";
import { JourneyStore } from "../src/journeyStore.js";
import type { PeerConfig, PeerToolResult } from "../src/peerClient.js";

const archus: PeerConfig = { name: "archus", url: "http://archus.test/mcp", token: "archus-token" };
const phylax: PeerConfig = { name: "phylax", url: "http://phylax.test/mcp", token: "phylax-token" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function withStore<T>(fn: (store: JourneyStore) => T | Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-parallel-journey-"));
  const store = new JourneyStore(join(dir, "journeys.sqlite"));
  try {
    return await fn(store);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function createResult(index: number): PeerToolResult {
  return {
    content: [{ type: "text", text: `Created misleading/repo#${900 + index}` }],
    structuredContent: {
      repo: "AlfaBlok/zenod",
      issueNumber: 600 + index,
      issueUrl: `https://github.com/AlfaBlok/zenod/issues/${600 + index}`,
      labels: ["status:proposed"],
    },
  };
}

function request(overrides: Partial<CreateIssuesJourneyInput> = {}): CreateIssuesJourneyInput {
  return {
    originalRequest: "create three tickets and notify me",
    issues: [
      { repo: "AlfaBlok/zenod", title: "Parallel A" },
      { repo: "AlfaBlok/zenod", title: "Parallel B" },
      { repo: "AlfaBlok/zenod", title: "Parallel C" },
    ],
    notify: { message: "Tell me when all issues exist." },
    ...overrides,
  };
}

describe("createIssuesJourney", () => {
  it("creates independent Archus steps in parallel and notifies only after all finish", async () => {
    await withStore(async (store) => {
      const waits = [deferred<PeerToolResult>(), deferred<PeerToolResult>(), deferred<PeerToolResult>()];
      const calls: Array<{ peer: string; tool: string; title?: string; message?: string }> = [];
      const running = createIssuesJourney({
        store,
        archus,
        phylax,
        request: request(),
        now: () => 2000,
        callTool: async (peer, tool, args) => {
          calls.push({ peer: peer.name, tool, title: String(args.title ?? ""), message: String(args.message ?? "") });
          if (peer.name === "phylax") {
            return { content: [{ type: "text", text: "Delivered: all three issue links." }] };
          }
          const index = ["Parallel A", "Parallel B", "Parallel C"].indexOf(String(args.title));
          return waits[index]!.promise;
        },
      });

      await tick();
      expect(calls.map((call) => `${call.peer}:${call.tool}`)).toEqual([
        "archus:create_issue",
        "archus:create_issue",
        "archus:create_issue",
      ]);

      waits[1]!.resolve(createResult(2));
      await tick();
      expect(calls.some((call) => call.peer === "phylax")).toBe(false);

      waits[0]!.resolve(createResult(1));
      await tick();
      expect(calls.some((call) => call.peer === "phylax")).toBe(false);

      waits[2]!.resolve(createResult(3));
      const result = await running;

      expect(result.status).toBe("completed");
      expect(result.createdIssues.map((issue) => issue.target).sort()).toEqual([
        "AlfaBlok/zenod#601",
        "AlfaBlok/zenod#602",
        "AlfaBlok/zenod#603",
      ]);
      const phylaxCall = calls.find((call) => call.peer === "phylax");
      expect(phylaxCall?.tool).toBe("chat_with_phylax");
      expect(phylaxCall?.message).toContain("AlfaBlok/zenod#601");
      expect(result.snapshot.steps.map((step) => `${step.owner}:${step.status}`)).toEqual([
        "archus:completed",
        "archus:completed",
        "archus:completed",
        "phylax:completed",
      ]);
      expect(result.snapshot.artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "github_issue", artifactKey: "github:AlfaBlok/zenod#601" }),
          expect.objectContaining({ kind: "github_issue", artifactKey: "github:AlfaBlok/zenod#602" }),
          expect.objectContaining({ kind: "github_issue", artifactKey: "github:AlfaBlok/zenod#603" }),
          expect.objectContaining({ kind: "notification" }),
        ]),
      );
    });
  });

  it("applies an owner/repo from the original request when issue objects omit repo", async () => {
    await withStore(async (store) => {
      const calls: Array<Record<string, unknown>> = [];
      const result = await createIssuesJourney({
        store,
        archus,
        request: request({
          originalRequest: "create two issues in zenod-ai/zenod",
          issues: [
            { title: "Repo inferred A", labels: ["status:proposed", "stability"] },
            { title: "Repo inferred B", labels: ["status:proposed", "stability"] },
          ],
          notify: undefined,
        }),
        callTool: async (_peer, _tool, args) => {
          calls.push(args);
          const index = calls.length;
          return {
            content: [{ type: "text", text: `Created zenod-ai/zenod#${700 + index}` }],
            structuredContent: {
              repo: "zenod-ai/zenod",
              issueNumber: 700 + index,
              issueUrl: `https://github.com/zenod-ai/zenod/issues/${700 + index}`,
              labels: ["status:proposed", "stability"],
            },
          };
        },
      });

      expect(result.status).toBe("completed");
      expect(calls).toEqual([
        expect.objectContaining({ repo: "zenod-ai/zenod", title: "Repo inferred A", labels: ["status:proposed", "stability"] }),
        expect.objectContaining({ repo: "zenod-ai/zenod", title: "Repo inferred B", labels: ["status:proposed", "stability"] }),
      ]);
    });
  });

  it("treats accidental repo-like labels as the target repo instead of GitHub labels", async () => {
    await withStore(async (store) => {
      const calls: Array<Record<string, unknown>> = [];
      await createIssuesJourney({
        store,
        archus,
        request: request({
          originalRequest: "create issues",
          issues: [{ title: "Repo label A", labels: ["status:proposed", "repo", "zenod-ai/zenod"] }],
          notify: undefined,
        }),
        callTool: async (_peer, _tool, args) => {
          calls.push(args);
          return {
            content: [{ type: "text", text: "Created zenod-ai/zenod#710" }],
            structuredContent: {
              repo: "zenod-ai/zenod",
              issueNumber: 710,
              issueUrl: "https://github.com/zenod-ai/zenod/issues/710",
              labels: ["status:proposed"],
            },
          };
        },
      });

      expect(calls).toEqual([
        expect.objectContaining({ repo: "zenod-ai/zenod", title: "Repo label A", labels: ["status:proposed"] }),
      ]);
    });
  });

  it("does not notify when one upstream issue creation blocks", async () => {
    await withStore(async (store) => {
      const calls: Array<{ peer: string; tool: string }> = [];
      const result = await createIssuesJourney({
        store,
        archus,
        phylax,
        request: request({ issues: [{ repo: "AlfaBlok/zenod", title: "Good" }, { repo: "AlfaBlok/zenod", title: "Bad" }] }),
        callTool: async (peer, tool, args) => {
          calls.push({ peer: peer.name, tool });
          if (String(args.title) === "Bad") {
            return { content: [{ type: "text", text: "GitHub rejected the issue" }], isError: true };
          }
          return createResult(7);
        },
      });

      expect(result.status).toBe("blocked");
      expect(result.createdIssues.map((issue) => issue.target)).toEqual(["AlfaBlok/zenod#607"]);
      expect(calls.map((call) => `${call.peer}:${call.tool}`)).toEqual(["archus:create_issue", "archus:create_issue"]);
      expect(result.snapshot.steps.map((step) => `${step.owner}:${step.status}`)).toEqual([
        "archus:completed",
        "archus:blocked",
        "phylax:pending",
      ]);
    });
  });
});
