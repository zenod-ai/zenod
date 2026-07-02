import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Runtime } from "../src/runtime.js";
import { toMcpToolResult, type ToolResponse } from "../src/toolOutput.js";
import { BACKLOG_CREATE_SHAPE, BACKLOG_EDIT_SHAPE, BACKLOG_CLOSE_SHAPE, BACKLOG_COMMENT_SHAPE, BACKLOG_LIST_SHAPE } from "../src/mcpToolSchemas.js";

// S0-T1 / EPIC T0 — deterministic life-backlog write path reliability tests.
// The 2026-07-02 regression: Archus created against a wrong default repo
// ('AlfaBlok/backlog'), got 404s, and replied with content that read like
// success. These tests lock the deterministic tools that make that impossible:
// hard-wired repo (no repo parameter), read-back verification on every write,
// and honest FAILED replies with no success evidence when a write fails.

const BACKLOG_REPO = "AlfaBlok/obsidian-brain";

type FakeIssue = { number: number; title: string; body: string; state: "open" | "closed"; labels: string[]; html_url: string };
type FakeComment = { id: number; body: string; html_url: string };

interface FakeGithubOptions {
  failCreate?: number; // http status to fail POST /issues with
  swallowCreate?: boolean; // POST succeeds but the issue is not actually stored (read-back must catch it)
  failClosePatch?: boolean; // PATCH to close succeeds but state does not change
  dropComment?: boolean; // POST comment returns but is not stored (read-back must catch it)
}

function fakeGithub(options: FakeGithubOptions = {}) {
  const issues = new Map<number, FakeIssue>();
  const comments = new Map<number, FakeComment[]>();
  let nextIssue = 100;
  let nextComment = 5000;
  const calls: Array<{ method: string; path: string }> = [];

  const url = (n: number) => `https://github.com/${BACKLOG_REPO}/issues/${n}`;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input).replace("https://api.github.com", "");
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ method, path });
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const base = `/repos/${BACKLOG_REPO}/issues`;

    // List
    if (method === "GET" && path.startsWith(`${base}?`)) {
      return json([...issues.values()].map((issue) => ({ ...issue, labels: issue.labels.map((name) => ({ name })) })));
    }
    // Create
    if (method === "POST" && path === base) {
      if (options.failCreate) return json({ message: "Not Found" }, options.failCreate);
      const number = (nextIssue += 1);
      const issue: FakeIssue = { number, title: body.title, body: body.body ?? "", state: "open", labels: body.labels ?? [], html_url: url(number) };
      if (!options.swallowCreate) issues.set(number, issue);
      return json(issue, 201);
    }
    const issueMatch = path.match(new RegExp(`^${base}/(\\d+)$`));
    if (issueMatch) {
      const number = Number(issueMatch[1]);
      const issue = issues.get(number);
      if (method === "GET") {
        if (!issue) return json({ message: "Not Found" }, 404);
        return json({ ...issue, labels: issue.labels.map((name) => ({ name })) });
      }
      if (method === "PATCH") {
        if (!issue) return json({ message: "Not Found" }, 404);
        if (body.title !== undefined) issue.title = body.title;
        if (body.body !== undefined) issue.body = body.body;
        if (body.state !== undefined && !options.failClosePatch) issue.state = body.state;
        return json({ ...issue, labels: issue.labels.map((name) => ({ name })) });
      }
    }
    const labelsMatch = path.match(new RegExp(`^${base}/(\\d+)/labels$`));
    if (labelsMatch && method === "POST") {
      const issue = issues.get(Number(labelsMatch[1]))!;
      issue.labels = [...new Set([...issue.labels, ...(body.labels ?? [])])];
      return json(issue.labels.map((name) => ({ name })));
    }
    const labelDelMatch = path.match(new RegExp(`^${base}/(\\d+)/labels/(.+)$`));
    if (labelDelMatch && method === "DELETE") {
      const issue = issues.get(Number(labelDelMatch[1]))!;
      issue.labels = issue.labels.filter((name) => name !== decodeURIComponent(labelDelMatch[2]!));
      return json(issue.labels.map((name) => ({ name })));
    }
    const commentsMatch = path.match(new RegExp(`^${base}/(\\d+)/comments`));
    if (commentsMatch) {
      const number = Number(commentsMatch[1]);
      if (method === "POST") {
        const comment: FakeComment = { id: (nextComment += 1), body: body.body, html_url: `${url(number)}#comment-${nextComment}` };
        if (!options.dropComment) comments.set(number, [...(comments.get(number) ?? []), comment]);
        return json(comment, 201);
      }
      if (method === "GET") return json(comments.get(number) ?? []);
    }
    return json({ message: `unexpected ${method} ${path}` }, 500);
  });

  return { fetchImpl, calls, issues, comments };
}

type BacklogWriter = {
  createIssue(input: { title: string; body?: string; labels?: string[] }): Promise<ToolResponse>;
  editIssue(input: { number: number; title?: string; body?: string; addLabels?: string[]; removeLabels?: string[] }): Promise<ToolResponse>;
  closeIssue(input: { number: number; comment?: string; reason?: "completed" | "not_planned" }): Promise<ToolResponse>;
  commentIssue(input: { number: number; body: string }): Promise<ToolResponse>;
  listBacklog(input: { state?: "open" | "closed" | "all"; labels?: string[]; limit?: number }): Promise<ToolResponse>;
};

describe("deterministic life-backlog write tools (S0-T1 / T0)", () => {
  let dir: string;
  let runtime: Runtime;
  let strict: string | undefined;

  const writer = () => (runtime as unknown as { buildBacklogIssueReader(): BacklogWriter }).buildBacklogIssueReader();

  beforeEach(async () => {
    // Enforce the honesty invariant hard in tests: any success-evidence-with-error
    // slip would throw here instead of being warned-and-forwarded.
    strict = process.env.ZENOD_STRICT_TOOL_OUTPUT_VALIDATION;
    process.env.ZENOD_STRICT_TOOL_OUTPUT_VALIDATION = "1";
    dir = await mkdtemp(join(tmpdir(), "zenod-backlog-"));
    runtime = new Runtime(dir);
    runtime.settings.setRaw("backlog_repo", BACKLOG_REPO);
    runtime.settings.set("github_token", "ghp_test");
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (strict === undefined) delete process.env.ZENOD_STRICT_TOOL_OUTPUT_VALIDATION;
    else process.env.ZENOD_STRICT_TOOL_OUTPUT_VALIDATION = strict;
    runtime.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("T0-1: create returns a read-back-verified owner/repo#N in the life backlog", async () => {
    const gh = fakeGithub();
    vi.stubGlobal("fetch", gh.fetchImpl);
    const res = await writer().createIssue({ title: "New epic", body: "objective", labels: ["epic"] });

    expect(res.errors ?? []).toHaveLength(0);
    expect(res.text).toBe(`Created ${BACKLOG_REPO}#101: https://github.com/${BACKLOG_REPO}/issues/101`);
    expect(res.evidence).toEqual([
      { kind: "issue_created", target: `${BACKLOG_REPO}#101`, url: `https://github.com/${BACKLOG_REPO}/issues/101`, title: "New epic", state: "open", labels: ["epic"], verified: true },
    ]);
    // read-back: a GET followed the POST create
    expect(gh.calls.some((c) => c.method === "GET" && c.path === `/repos/${BACKLOG_REPO}/issues/101`)).toBe(true);
    // the MCP wrapper validates + confirms it is not an error result
    expect(toMcpToolResult("archus.backlog_create", res).isError).toBeUndefined();
  });

  it("T0-2: edit updates title/body/labels and reports the changed fields, verified", async () => {
    const gh = fakeGithub();
    gh.issues.set(101, { number: 101, title: "old", body: "", state: "open", labels: ["epic", "drop"], html_url: `https://github.com/${BACKLOG_REPO}/issues/101` });
    vi.stubGlobal("fetch", gh.fetchImpl);
    const res = await writer().editIssue({ number: 101, title: "renamed", body: "new body", addLabels: ["memory"], removeLabels: ["drop"] });

    expect(res.errors ?? []).toHaveLength(0);
    expect(res.evidence[0]).toMatchObject({ kind: "issue_updated", target: `${BACKLOG_REPO}#101`, changedFields: ["title", "body", "labels"], verified: true });
    expect(gh.issues.get(101)).toMatchObject({ title: "renamed", body: "new body", labels: ["epic", "memory"] });
  });

  it("T0-3: close moves state to closed only after a read-back confirms it", async () => {
    const gh = fakeGithub();
    gh.issues.set(101, { number: 101, title: "done", body: "", state: "open", labels: [], html_url: `https://github.com/${BACKLOG_REPO}/issues/101` });
    vi.stubGlobal("fetch", gh.fetchImpl);
    const res = await writer().closeIssue({ number: 101, comment: "shipped" });

    expect(res.errors ?? []).toHaveLength(0);
    expect(res.evidence[0]).toMatchObject({ kind: "issue_closed", state: "closed", verified: true });
    expect(gh.issues.get(101)!.state).toBe("closed");
    expect(gh.comments.get(101)).toHaveLength(1);
  });

  it("T0-4: comment posts and confirms the comment is present on read-back", async () => {
    const gh = fakeGithub();
    gh.issues.set(101, { number: 101, title: "t", body: "", state: "open", labels: [], html_url: `https://github.com/${BACKLOG_REPO}/issues/101` });
    vi.stubGlobal("fetch", gh.fetchImpl);
    const res = await writer().commentIssue({ number: 101, body: "a note" });

    expect(res.errors ?? []).toHaveLength(0);
    expect(res.evidence[0]).toMatchObject({ kind: "issue_updated", changedFields: ["comment"], verified: true });
    expect(gh.comments.get(101)![0]!.body).toBe("a note");
  });

  it("T0-5: an epic and its children are all created verified in the one backlog", async () => {
    const gh = fakeGithub();
    vi.stubGlobal("fetch", gh.fetchImpl);
    const epic = await writer().createIssue({ title: "EPIC", labels: ["epic"] });
    const child = await writer().createIssue({ title: "child", body: `Parent: ${(epic.evidence[0] as { target: string }).target}` });

    expect((epic.evidence[0] as { target: string }).target).toBe(`${BACKLOG_REPO}#101`);
    expect((child.evidence[0] as { target: string }).target).toBe(`${BACKLOG_REPO}#102`);
    const list = await writer().listBacklog({ state: "open" });
    expect(list.text).toContain("Found 2 issues");
  });

  it("T0-7: a failed create returns FAILED with the verbatim error and NO success evidence (2026-07-02 regression)", async () => {
    const gh = fakeGithub({ failCreate: 404 });
    vi.stubGlobal("fetch", gh.fetchImpl);
    const res = await writer().createIssue({ title: "will fail" });

    expect(res.text?.startsWith("FAILED")).toBe(true);
    expect(res.text).toContain("404");
    expect(res.evidence).toHaveLength(0); // nothing that reads like success
    expect(res.errors?.[0]).toMatchObject({ code: "create_failed" });
    // strict MCP validation must accept it (no mutation evidence alongside the error) and flag isError
    expect(toMcpToolResult("archus.backlog_create", res).isError).toBe(true);
  });

  it("T0-7b: a create whose write is not confirmed by read-back is reported FAILED, not success", async () => {
    const gh = fakeGithub({ swallowCreate: true });
    vi.stubGlobal("fetch", gh.fetchImpl);
    const res = await writer().createIssue({ title: "phantom" });

    expect(res.text?.startsWith("FAILED")).toBe(true);
    expect(res.evidence).toHaveLength(0);
    expect(res.errors?.[0]?.code).toBe("create_failed");
  });

  it("T0-7c: a close whose state does not change on read-back is reported FAILED", async () => {
    const gh = fakeGithub({ failClosePatch: true });
    gh.issues.set(101, { number: 101, title: "t", body: "", state: "open", labels: [], html_url: `https://github.com/${BACKLOG_REPO}/issues/101` });
    vi.stubGlobal("fetch", gh.fetchImpl);
    const res = await writer().closeIssue({ number: 101 });

    expect(res.text?.startsWith("FAILED")).toBe(true);
    expect(res.evidence).toHaveLength(0);
    expect(gh.issues.get(101)!.state).toBe("open");
  });

  it("T0-8: no write tool accepts a repo parameter — the destination is unredirectable", () => {
    for (const shape of [BACKLOG_CREATE_SHAPE, BACKLOG_EDIT_SHAPE, BACKLOG_CLOSE_SHAPE, BACKLOG_COMMENT_SHAPE, BACKLOG_LIST_SHAPE]) {
      expect(Object.keys(shape)).not.toContain("repo");
    }
  });

  it("T0-8b: every write only ever targets the configured backlog repo", async () => {
    const gh = fakeGithub();
    gh.issues.set(101, { number: 101, title: "t", body: "", state: "open", labels: [], html_url: `https://github.com/${BACKLOG_REPO}/issues/101` });
    vi.stubGlobal("fetch", gh.fetchImpl);
    await writer().createIssue({ title: "a" });
    await writer().editIssue({ number: 101, title: "b" });
    await writer().commentIssue({ number: 101, body: "c" });
    await writer().closeIssue({ number: 101 });

    expect(gh.calls.every((c) => c.path.startsWith(`/repos/${BACKLOG_REPO}/`))).toBe(true);
  });

  it("T0-8c: with no backlog repo configured, writes fail honestly instead of guessing one", async () => {
    runtime.settings.setRaw("backlog_repo", "");
    const gh = fakeGithub();
    vi.stubGlobal("fetch", gh.fetchImpl);
    const res = await writer().createIssue({ title: "orphan" });

    expect(res.text?.startsWith("FAILED")).toBe(true);
    expect(res.errors?.[0]?.code).toBe("repo_not_configured");
    expect(gh.calls).toHaveLength(0); // never touched GitHub
  });
});
