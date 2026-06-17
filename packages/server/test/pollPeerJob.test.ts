import { afterEach, describe, expect, it, vi } from "vitest";

import { pollPeerJob } from "../src/pollPeerJob.js";

describe("pollPeerJob", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the completed job result for receipt formatting", async () => {
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
      [{ name: "zenod", url: "https://z2.zenod.dev", token: "token" }],
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
  });
});
