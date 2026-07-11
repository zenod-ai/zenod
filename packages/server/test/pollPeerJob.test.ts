import { afterEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { pollPeerJob } from "../src/pollPeerJob.js";

const mockedLookup = vi.mocked(lookup);

describe("pollPeerJob", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the completed job result for receipt formatting", async () => {
    mockedLookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        job: {
          status: "done",
          kind: "store",
          result: {
            evidenceRef: "Log/2026-06-17.md#^e-eda5eb",
            pagesTouched: ["Projects/Zenod Workflow Learnings.md"],
            commitSha: "39afb29ef01035777e86512428976535b18abf19",
            githubUrls: ["https://github.com/AlfaBlok/obsidian-brain/blob/main/Log/2026-06-17.md"],
          },
        },
      }),
    );

    const result = await pollPeerJob(
      [{ name: "zenod", url: "https://z2.zenod.dev/mcp", token: "token" }],
      "14ff5e91-c12b-4e1f-8c30-ecdc8dc2d3d3",
      0,
      100,
    );

    expect(result).toEqual({
      status: "done",
      kind: "store",
      result: {
        evidenceRef: "Log/2026-06-17.md#^e-eda5eb",
        pagesTouched: ["Projects/Zenod Workflow Learnings.md"],
        commitSha: "39afb29ef01035777e86512428976535b18abf19",
        githubUrls: ["https://github.com/AlfaBlok/obsidian-brain/blob/main/Log/2026-06-17.md"],
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://z2.zenod.dev/api/tasks/jobs/14ff5e91-c12b-4e1f-8c30-ecdc8dc2d3d3",
      { headers: { Authorization: "Bearer token" } },
    );
  });

  it("rejects a rebound private address before sending the downstream bearer", async () => {
    mockedLookup.mockResolvedValue([{ address: "192.168.1.7", family: 4 }]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await pollPeerJob(
      [{ name: "zenod", url: "https://rebound.example/mcp", token: "downstream-secret", wallet: true }],
      "14ff5e91-c12b-4e1f-8c30-ecdc8dc2d3d3",
      0,
      100,
    );

    expect(result).toEqual({
      status: "error",
      error: "Peer job polling refused: MCP URL resolves to a private or loopback address.",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("permits the exact private fleet host marked by server policy", async () => {
    mockedLookup.mockResolvedValue([{ address: "10.0.0.8", family: 4 }]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ job: { status: "done", kind: "store", result: { commitSha: "c".repeat(40) } } }),
    );

    const result = await pollPeerJob(
      [{
        name: "zenod",
        url: "https://zenod.internal/mcp",
        token: "fleet-token",
        wallet: true,
        allowPrivateHost: true,
      }],
      "14ff5e91-c12b-4e1f-8c30-ecdc8dc2d3d3",
      0,
      100,
    );

    expect(result).toEqual({ status: "done", kind: "store", result: { commitSha: "c".repeat(40) } });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://zenod.internal/api/tasks/jobs/14ff5e91-c12b-4e1f-8c30-ecdc8dc2d3d3",
      { headers: { Authorization: "Bearer fleet-token" } },
    );
  });
});
