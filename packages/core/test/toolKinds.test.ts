import { describe, it, expect } from "vitest";
import { toolKind, isKnownTool, DECLARED_READ_TOOLS, DECLARED_MUTATE_TOOLS } from "../src/toolKinds.js";

describe("toolKinds registry (FP4 · #548)", () => {
  // The full set of tool names the LLM can call, gathered from the peer-tool registries
  // (app.ts ZENOD_MEMORY_TOOLS / ARCHUS_BACKLOG_TOOLS / EPAMINON_EXECUTION_TOOLS /
  // OUTBOUND_COMMS_TOOLS / PHYLAX_NOTIFICATION_TOOLS), the core task tools (aisdk
  // taskToolSet), and the read tools (aisdk read tool set). If a tool is added to any of
  // those without a kind declaration here, this coverage test fails in CI — the fail-safe
  // (unknown → mutate → spurious banner) can never silently ship.
  const READ_TOOLS = [
    "search_vault", "read_note", "read_facts", "list_pages", "search_chats", "inspect_connected_mcp_catalog",
    "zenod_digest_message", "ask_zenod", "search_memory", "get_memory",
    "get_recent_conversation_transcript", "read_llm_timeline",
    "archus_read_exact_github_issue", "archus_search_github_issues", "archus_list_github_issues", "ask_archus",
    "epaminon_read_issue_execution_status", "execution_status",
    "query_backlog", "service_backlog", "list_drive_files", "propose_vault_task", "digest_backlog",
    "ask_outbound", "read_x_post", "read_x_mentions", "search_x", "search_reddit", "read_subreddit", "read_reddit_replies",
    "ask_phylax",
  ];
  const MUTATE_TOOLS = [
    "create_issue", "open_issue", "edit_issue", "close_issue", "label_issue", "archus_request_backlog_action",
    "queue_execution", "approve_execution", "approve_queue", "approve_merge", "archus_run_issue", "epaminon_run_existing_issue",
    "console_create_issue_then_run", "console_create_issues", "console_run_ephemeral_task",
    "backlog_create", "backlog_edit", "backlog_close", "backlog_comment",
    "add_memory", "store_memory", "capture_note", "execute_vault_task", "ingest_drive_file",
    "post_tweet", "post_reddit", "send_email",
    "raise_event", "deliver_to_principal",
  ];

  it("classifies every known READ tool as read", () => {
    for (const t of READ_TOOLS) {
      expect(isKnownTool(t), `${t} must be declared`).toBe(true);
      expect(toolKind(t), `${t} should be read`).toBe("read");
    }
  });

  it("classifies every known MUTATE tool as mutate", () => {
    for (const t of MUTATE_TOOLS) {
      expect(isKnownTool(t), `${t} must be declared`).toBe(true);
      expect(toolKind(t), `${t} should be mutate`).toBe("mutate");
    }
  });

  it("normalizes naming variants (camelCase / snake_case / spacing)", () => {
    expect(toolKind("archusListGithubIssues")).toBe("read");
    expect(toolKind("ARCHUS_LIST_GITHUB_ISSUES")).toBe("read");
    expect(toolKind("createIssue")).toBe("mutate");
  });

  it("fails SAFE: an unknown tool is treated as mutate (never hide a fabrication — C-15)", () => {
    expect(isKnownTool("some_tool_that_does_not_exist")).toBe(false);
    expect(toolKind("some_tool_that_does_not_exist")).toBe("mutate");
  });

  it("the two declared halves are disjoint and non-empty", () => {
    const reads = new Set(DECLARED_READ_TOOLS);
    const mutates = new Set(DECLARED_MUTATE_TOOLS);
    expect(reads.size).toBeGreaterThan(0);
    expect(mutates.size).toBeGreaterThan(0);
    for (const r of reads) expect(mutates.has(r), `${r} declared in both halves`).toBe(false);
  });
});
