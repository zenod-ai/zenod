import { describe, expect, it, vi } from "vitest";
import {
  compileAllToolOutputSchemas,
  evidence,
  ToolOutputValidationError,
  toolResponse,
  toMcpToolResult,
  validateToolResponse,
} from "../src/toolOutput.js";

describe("v4 tool output validation", () => {
  it("compiles every generated packaged schema at startup", () => {
    expect(() => compileAllToolOutputSchemas()).not.toThrow();
  });

  it("requires the evidence array", () => {
    expect(() => validateToolResponse("archus.get_issue", {})).toThrow(ToolOutputValidationError);
  });

  it("accepts the expected evidence kind for a tool", () => {
    const output = toolResponse({
      evidence: [
        evidence("issue", {
          target: "zenod-ai/zenod#237",
          url: "https://github.com/zenod-ai/zenod/issues/237",
          title: "Contract epic",
          state: "open",
        }),
      ],
    });

    expect(validateToolResponse("archus.get_issue", output)).toBe(output);
  });

  it("accepts typed, canonically linked terminal memory evidence", () => {
    const result = {
      evidenceRef: "Log/2026-07-12.md#^e-cobalt",
      evidenceUrl: `https://github.com/owner/vault/blob/${"a".repeat(40)}/Log/2026-07-12.md#L42`,
      pagesTouched: ["Projects/Council.md"],
      pageUrls: [`https://github.com/owner/vault/blob/${"a".repeat(40)}/Projects/Council.md`],
      commitSha: "a".repeat(40),
      githubUrls: [
        "https://github.com/owner/vault/blob/main/Log/2026-07-12.md",
        "https://github.com/owner/vault/blob/main/Projects/Council.md",
      ],
    };
    const output = {
      found: true,
      ticket_id: "job-1",
      jobId: "job-1",
      kind: "store",
      status: "done",
      state: "done",
      result,
      evidence: [
        evidence("memory_stored", {
          id: "job-1",
          ticket_id: "job-1",
          jobId: "job-1",
          status: "done",
          evidenceRef: "Log/2026-07-12.md#^e-cobalt",
          url: `https://github.com/owner/vault/blob/${"a".repeat(40)}/Log/2026-07-12.md#L42`,
          urls: [
            `https://github.com/owner/vault/blob/${"a".repeat(40)}/Log/2026-07-12.md#L42`,
            `https://github.com/owner/vault/blob/${"a".repeat(40)}/Projects/Council.md`,
          ],
          commitSha: "a".repeat(40),
          pagesTouched: ["Projects/Council.md"],
          githubUrls: [
            "https://github.com/owner/vault/blob/main/Log/2026-07-12.md",
            "https://github.com/owner/vault/blob/main/Projects/Council.md",
          ],
          pageUrls: [`https://github.com/owner/vault/blob/${"a".repeat(40)}/Projects/Council.md`],
        }),
      ],
    };

    expect(validateToolResponse("zenod.get_task_result", output)).toBe(output);
  });

  it("rejects terminal memory evidence without its typed reference and canonical URL", () => {
    const output = {
      found: true,
      ticket_id: "job-1",
      jobId: "job-1",
      kind: "store",
      status: "done",
      state: "done",
      result: {
        evidenceRef: "Log/2026-07-12.md#^e-cobalt",
        pagesTouched: [],
        commitSha: "a".repeat(40),
        githubUrls: [],
      },
      evidence: [
        evidence("memory_stored", {
          jobId: "job-1",
          status: "done",
          commitSha: "a".repeat(40),
          pagesTouched: [],
          githubUrls: [],
          pageUrls: [],
        }),
      ],
    };

    expect(() => validateToolResponse("zenod.get_task_result", output)).toThrow(/evidenceRef|url/);
  });

  it("accepts a Drive terminal revision without GitHub compatibility fields", () => {
    const url = "https://drive.google.com/file/d/log-1/view";
    const revision = {
      provider: "google_drive",
      id: "drive-txn-1",
      committedAt: "2026-08-29T10:00:00.000Z",
      urls: [url],
    };
    const output = {
      found: true,
      ticket_id: "job-drive",
      jobId: "job-drive",
      kind: "store",
      status: "done",
      state: "done",
      result: { evidenceRef: "Log/2026-08-29.md#^e-drive", pagesTouched: [], revision, urls: [url] },
      evidence: [evidence("memory_stored", {
        jobId: "job-drive",
        status: "done",
        evidenceRef: "Log/2026-08-29.md#^e-drive",
        url,
        urls: [url],
        revision,
        pagesTouched: [],
        pageUrls: [],
      })],
    };

    expect(validateToolResponse("zenod.get_task_result", output)).toBe(output);
  });

  it("rejects Drive terminal evidence carrying a fabricated GitHub field", () => {
    const url = "https://drive.google.com/file/d/log-1/view";
    const output = toolResponse({
      evidence: [evidence("memory_stored", {
        jobId: "job-drive",
        status: "done",
        evidenceRef: "Log/2026-08-29.md#^e-drive",
        url,
        urls: [url],
        revision: {
          provider: "google_drive",
          id: "drive-txn-1",
          committedAt: "2026-08-29T10:00:00.000Z",
          urls: [url],
        },
        commitSha: "a".repeat(40),
        pagesTouched: [],
        pageUrls: [],
      })],
    });

    expect(() => validateToolResponse("zenod.store_memory", output)).toThrow(/must NOT be valid/);
  });

  it("rejects evidence shapes outside a tool's public contract", () => {
    const output = toolResponse({
      evidence: [evidence("memory_stored", { jobId: "j1", status: "done", commitSha: "abc", pagesTouched: [] })],
    });

    expect(() => validateToolResponse("archus.get_issue", output)).toThrow(/must have required property|must be equal/);
  });

  it("rejects right-kind evidence with missing required fields", () => {
    const output = toolResponse({
      evidence: [evidence("issue_created")],
    });

    expect(() => validateToolResponse("archus.request_backlog_action", output)).toThrow(/target/);
  });

  it("fails closed on unknown tool names", () => {
    const output = toolResponse({ evidence: [] });

    expect(() => validateToolResponse("archus.typo", output)).toThrow(/Unknown v4 tool output schema/);
  });

  it("requires currentState on write-tool errors", () => {
    const output = toolResponse({
      evidence: [],
      errors: [{ code: "readback_failed", message: "GitHub did not confirm the write." }],
    });

    expect(() => validateToolResponse("archus.request_backlog_action", output)).toThrow(/currentState/);
  });

  it("allows read-tool errors without currentState", () => {
    const output = toolResponse({
      evidence: [],
      errors: [{ code: "not_found", message: "No such issue." }],
    });

    expect(validateToolResponse("archus.get_issue", output)).toBe(output);
  });

  it("rejects same-operation ambiguity plus write evidence", () => {
    const output = toolResponse({
      operations: [{ operationId: "op-1", interpretedAs: "create", status: "needs_input" }],
      questions: [{ operationId: "op-1", text: "Which repo?" }],
      evidence: [
        evidence("issue_created", {
          operationId: "op-1",
          target: "zenod-ai/zenod#250",
          url: "https://github.com/zenod-ai/zenod/issues/250",
          verified: true,
        }),
      ],
    });

    expect(() => validateToolResponse("archus.request_backlog_action", output)).toThrow(/op-1/);
  });

  it("does not treat execution_blocked as a mutation", () => {
    const output = toolResponse({
      operations: [{ operationId: "op-1", interpretedAs: "run", status: "blocked" }],
      questions: [{ operationId: "op-1", text: "Which repo should this run in?" }],
      evidence: [
        evidence("execution_blocked", {
          operationId: "op-1",
          executionId: "exec-1",
          state: "blocked",
          blockers: ["ambiguous target"],
        }),
      ],
    });

    expect(validateToolResponse("archus.run_issue", output)).toBe(output);
  });

  it("rejects same-operation error plus write evidence", () => {
    const output = toolResponse({
      operations: [{ operationId: "op-1", interpretedAs: "create", status: "blocked" }],
      errors: [{ operationId: "op-1", code: "readback_failed", message: "GitHub did not confirm.", currentState: {} }],
      evidence: [
        evidence("issue_created", {
          operationId: "op-1",
          target: "zenod-ai/zenod#250",
          url: "https://github.com/zenod-ai/zenod/issues/250",
          verified: true,
        }),
      ],
    });

    expect(() => validateToolResponse("archus.request_backlog_action", output)).toThrow(/both an error/);
  });

  it("allows a completed write operation and a different ambiguous operation in one turn", () => {
    const output = toolResponse({
      operations: [
        { operationId: "op-1", interpretedAs: "create", status: "completed" },
        { operationId: "op-2", interpretedAs: "run", status: "needs_input" },
      ],
      candidates: [{ operationId: "op-2", target: "zenod-ai/zenod#108", confidence: 0.5 }],
      evidence: [
        evidence("issue_created", {
          operationId: "op-1",
          target: "zenod-ai/zenod#250",
          url: "https://github.com/zenod-ai/zenod/issues/250",
          verified: true,
        }),
      ],
    });

    expect(validateToolResponse("archus.request_backlog_action", output)).toBe(output);
  });

  it("maps MCP isError only from structured errors", () => {
    const notFound = toolResponse({
      evidence: [evidence("issue_not_found", { searchedRepos: ["zenod-ai/zenod"], searchedWindow: "48h", candidates: [] })],
    });
    const failedRead = toolResponse({
      evidence: [],
      errors: [{ code: "github_unavailable", message: "GitHub request failed." }],
    });

    expect(toMcpToolResult("archus.find_issue", notFound).isError).toBeUndefined();
    expect(toMcpToolResult("archus.get_issue", failedRead).isError).toBe(true);
  });

  it("forwards non-conforming MCP output by default instead of breaking the live tool", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const malformed = toolResponse({
        evidence: [evidence("issue_created", { target: "zenod-ai/zenod#250" })],
      });

      const result = toMcpToolResult("archus.request_backlog_action", malformed);

      expect(result.structuredContent).toBe(malformed);
      expect(result.isError).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("archus.request_backlog_action returned non-conforming"));
    } finally {
      warn.mockRestore();
    }
  });
});
