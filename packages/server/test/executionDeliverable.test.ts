import { describe, expect, it } from "vitest";
import {
  resolveDeliverableManifest,
  fetchDeliverableFiles,
  deliverableMergeState,
  formatDeliverableResult,
  type GithubContentsReader,
} from "../src/executionDeliverable.js";
import type { JourneyArtifact } from "../src/journeyStore.js";

function record(executionId: string, deliverable: unknown, updatedAt: number): JourneyArtifact {
  return {
    id: `a-${executionId}`,
    journeyId: "j1",
    stepId: null,
    kind: "execution_record",
    artifactKey: `execution:${executionId}`,
    data: { executionId, deliverable } as Record<string, unknown>,
    createdAt: updatedAt,
    updatedAt,
  };
}

const manifest = {
  repo: "AlfaBlok/idea_scraper",
  issue: 105,
  prUrl: "https://github.com/AlfaBlok/idea_scraper/pull/106",
  branch: "codex/issue-105-legal-matrix",
  headSha: "deadbeef",
  merged: false,
  paths: ["ideascraper-vps-v1/telegram-bot/LEGAL_COMMERCIAL_DECISION_MATRIX.md"],
  handoffExcerpt: "Produced the matrix; opened a draft PR.",
};

describe("resolveDeliverableManifest (R1-T3)", () => {
  const artifacts = [
    record("direct-1", { repo: "o/r", issue: 7, paths: ["a.md"] }, 100),
    record("direct-105", manifest, 200),
  ];

  it("resolves by executionId", () => {
    expect(resolveDeliverableManifest(artifacts, "direct-105")).toEqual(manifest);
  });

  it("resolves by fully-qualified owner/repo#N target", () => {
    expect(resolveDeliverableManifest(artifacts, "AlfaBlok/idea_scraper#105")).toEqual(manifest);
  });

  it("resolves from a message containing owner/repo#N", () => {
    expect(resolveDeliverableManifest(artifacts, "please fetch AlfaBlok/idea_scraper#105 for me")?.issue).toBe(105);
  });

  it("returns undefined when nothing matches", () => {
    expect(resolveDeliverableManifest(artifacts, "nope#999")).toBeUndefined();
  });
});

describe("fetchDeliverableFiles (R1-T3)", () => {
  it("fetches the file body at headSha for an unmerged PR and reports honest state", async () => {
    const reads: Array<{ repo: string; path: string; ref?: string }> = [];
    const read: GithubContentsReader = async (repo, path, ref) => {
      reads.push({ repo, path, ref });
      return "# Legal matrix\nrow 1";
    };
    const result = await fetchDeliverableFiles(manifest, read);
    expect(result.mergeState).toBe("PR open — NOT merged yet");
    expect(result.files[0]).toMatchObject({ path: manifest.paths[0], content: "# Legal matrix\nrow 1" });
    // Read at the head SHA so an unmerged/deleted branch still resolves.
    expect(reads[0].ref).toBe("deadbeef");
  });

  it("falls back to branch when there is no headSha", async () => {
    const reads: Array<{ ref?: string }> = [];
    const read: GithubContentsReader = async (_repo, _path, ref) => {
      reads.push({ ref });
      return "x";
    };
    await fetchDeliverableFiles({ ...manifest, headSha: undefined }, read);
    expect(reads[0].ref).toBe("codex/issue-105-legal-matrix");
  });

  it("reports merged state for a merged PR", () => {
    expect(deliverableMergeState({ ...manifest, merged: true })).toBe("merged to main");
  });

  it("captures a per-file read error without throwing", async () => {
    const read: GithubContentsReader = async () => {
      throw new Error("404 not found");
    };
    const result = await fetchDeliverableFiles(manifest, read);
    expect(result.files[0]).toMatchObject({ path: manifest.paths[0], error: "404 not found" });
    expect(result.found).toBe(true);
  });

  it("handles a commit-only (no PR, no paths) manifest gracefully", async () => {
    const read: GithubContentsReader = async () => "unused";
    const result = await fetchDeliverableFiles({ repo: "o/r", issue: 7, merged: false }, read);
    expect(result.files).toHaveLength(0);
    expect(result.mergeState).toBe("completed (no PR — filed artifact)");
  });
});

describe("formatDeliverableResult (R1-T3)", () => {
  it("renders the honest state, PR link, and file body", async () => {
    const read: GithubContentsReader = async () => "BODY";
    const text = formatDeliverableResult(await fetchDeliverableFiles(manifest, read));
    expect(text).toContain("NOT merged yet");
    expect(text).toContain(manifest.prUrl);
    expect(text).toContain("BODY");
  });

  it("says not-found clearly", () => {
    expect(formatDeliverableResult({ reference: "x#1", found: false, mergeState: "unknown", files: [] })).toContain(
      "No deliverable found",
    );
  });
});
