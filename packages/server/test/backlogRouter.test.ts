import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_REPO_INFERENCE,
  LIFE_BACKLOG_REPO,
  backlogRouterSection,
  inferRepo,
  loadRepoInference,
  nonBacklogRedirect,
  routeBacklogRequest,
} from "../src/backlogRouter.js";

describe("routeBacklogRequest — E-4 deterministic routing", () => {
  it("D2: a life-level epic defaults to the life backlog, not the code lane", () => {
    const route = routeBacklogRequest(
      "Epic: I want to be able to review my whole week every Sunday and feel on top of my life.",
    );
    expect(route.kind).toBe("life_backlog");
  });

  it("D2b: an outcome-level goal with no codebase hook never asks which repo", () => {
    const route = routeBacklogRequest("I'd like to eventually get my personal finances under control as a long-term goal.");
    expect(route.kind).toBe("life_backlog");
    expect(route.kind).not.toBe("needs_repo");
    expect(route.kind).not.toBe("code_repo_inferred");
  });

  it("D4: a write aimed at the nectary repo is redirected to Epaminon, not written by Archus", () => {
    const route = routeBacklogRequest("Open an issue in nectary to fix the waitlist signup flow.");
    expect(route.kind).toBe("worker_dispatch");
    if (route.kind === "worker_dispatch") {
      expect(route.repo).toBe("AlfaBlok/nectary");
      expect(route.redirect).toContain("Epaminon");
      expect(route.redirect).toContain(LIFE_BACKLOG_REPO);
      expect(route.redirect.toLowerCase()).toContain("don't write");
    }
  });

  it("D4b: an execute-against-code-repo ask is also intercepted and redirected", () => {
    const route = routeBacklogRequest("Fix the claims bug in nectary and deploy it.");
    expect(route.kind).toBe("worker_dispatch");
    if (route.kind === "worker_dispatch") expect(route.repo).toBe("AlfaBlok/nectary");
  });

  it("D1: an obvious code target resolves from the inference table without asking which repo", () => {
    const route = routeBacklogRequest("There's a bug in the WhatsApp gateway; open an issue in the repo for it.");
    expect(route.kind).toBe("worker_dispatch"); // zenod-ai/zenod is a code repo → Epaminon route
    if (route.kind === "worker_dispatch") expect(route.repo).toBe("zenod-ai/zenod");
    expect(route.kind).not.toBe("needs_repo");
  });

  it("D1b: voice pipeline work resolves to zenod-ai/zenod (never a which-repo question)", () => {
    const route = routeBacklogRequest("The voice note transcription is broken; run a fix in the codebase.");
    expect(route.kind).toBe("worker_dispatch");
    if (route.kind === "worker_dispatch") expect(route.repo).toBe("zenod-ai/zenod");
  });

  it("asks exactly once when code work has no inferable repo (below the confidence floor)", () => {
    const route = routeBacklogRequest("Please open an issue in the repo to refactor the thing we discussed.");
    expect(route.kind).toBe("needs_repo");
  });

  it("a plain filing with no code signal defaults to the life backlog", () => {
    const route = routeBacklogRequest("Add a reminder to call the dentist next week.");
    expect(route.kind).toBe("life_backlog");
  });
});

describe("inferRepo — deterministic keyword→repo table (E4-T3)", () => {
  it("matches WhatsApp / voice / vault → zenod-ai/zenod", () => {
    expect(inferRepo(DEFAULT_REPO_INFERENCE, "the whatsapp gateway is down")?.repo).toBe("zenod-ai/zenod");
    expect(inferRepo(DEFAULT_REPO_INFERENCE, "voice note pipeline")?.repo).toBe("zenod-ai/zenod");
    expect(inferRepo(DEFAULT_REPO_INFERENCE, "the vault indexing")?.repo).toBe("zenod-ai/zenod");
  });

  it("matches waitlist / claims → nectary", () => {
    expect(inferRepo(DEFAULT_REPO_INFERENCE, "the waitlist page")?.repo).toBe("AlfaBlok/nectary");
    expect(inferRepo(DEFAULT_REPO_INFERENCE, "claims flow")?.repo).toBe("AlfaBlok/nectary");
    expect(inferRepo(DEFAULT_REPO_INFERENCE, "nectary")?.repo).toBe("AlfaBlok/nectary");
  });

  it("resolves an exact owner/repo and a bare repo name", () => {
    expect(inferRepo(DEFAULT_REPO_INFERENCE, "AlfaBlok/nectary")?.repo).toBe("AlfaBlok/nectary");
    expect(inferRepo(DEFAULT_REPO_INFERENCE, "zenod")?.repo).toBe("zenod-ai/zenod");
  });

  it("returns null when nothing matches confidently (caller asks, not guesses)", () => {
    expect(inferRepo(DEFAULT_REPO_INFERENCE, "the quarterly finances review")).toBeNull();
    expect(inferRepo(DEFAULT_REPO_INFERENCE, "")).toBeNull();
  });
});

describe("nonBacklogRedirect / backlogRouterSection", () => {
  it("redirect names the repo, the life backlog, and Epaminon", () => {
    const text = nonBacklogRedirect("AlfaBlok/nectary");
    expect(text).toContain("AlfaBlok/nectary");
    expect(text).toContain(LIFE_BACKLOG_REPO);
    expect(text).toContain("Epaminon");
  });

  it("persona section states the one-backlog rule and lists the inference table", () => {
    const section = backlogRouterSection();
    expect(section).toContain(LIFE_BACKLOG_REPO);
    expect(section).toContain("NEVER write any other repo");
    expect(section).toContain("zenod-ai/zenod");
    expect(section).toContain("Epaminon");
  });
});

describe("loadRepoInference override", () => {
  it("falls back to built-ins when no override is set", () => {
    expect(loadRepoInference({})).toBe(DEFAULT_REPO_INFERENCE);
  });

  it("loads a valid JSON override and ignores a broken one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zenod-repo-inference-"));
    try {
      const good = join(dir, "good.json");
      await writeFile(good, JSON.stringify([{ repo: "o/r", keywords: ["thing"] }]));
      expect(loadRepoInference({ ZENOD_REPO_INFERENCE_FILE: good })[0]?.repo).toBe("o/r");

      const bad = join(dir, "bad.json");
      await writeFile(bad, "{not json");
      expect(loadRepoInference({ ZENOD_REPO_INFERENCE_FILE: bad })).toBe(DEFAULT_REPO_INFERENCE);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
