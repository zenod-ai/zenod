import { describe, expect, it } from "vitest";

import {
  buildForeignIssueCreateObjective,
  buildOneOffIssueBody,
  extractCommentSubject,
  extractIssueCreateSubject,
  isAlreadyForcedIssueCreateObjective,
  isIssueCreateIntent,
  oneOffIssueTitle,
  wantsIssueComment,
} from "../src/oneOffExecution.js";
import { ensureRunnableBody, validateCreateIssueThenRunRequest } from "../src/createIssueRunJourney.js";

describe("oneOffIssueTitle", () => {
  it("uses the first line and truncates long objectives", () => {
    expect(oneOffIssueTitle("Restyle the DIOPTRA bot output")).toBe("Restyle the DIOPTRA bot output");
    expect(oneOffIssueTitle("line one\nline two")).toBe("line one");
    expect(oneOffIssueTitle("x".repeat(200)).endsWith("…")).toBe(true);
    expect(oneOffIssueTitle("   ")).toBe("One-off execution");
  });
});

describe("buildOneOffIssueBody", () => {
  it("produces a body that passes the create-and-run runnable-ticket validation", () => {
    const body = buildOneOffIssueBody({
      objective: "Restyle the Telegram bot output to serif headings",
      instructions: "no emojis; match the reference",
      repo: "AlfaBlok/idea_scraper",
      path: "ideascraper-vps-v1/telegram-bot",
      deployNote: "redeploy is not guaranteed automatic",
    });
    // The whole point: a one-off must never bounce as needs-clarification.
    const missing = validateCreateIssueThenRunRequest({
      originalRequest: "restyle the bot",
      issue: { repo: "AlfaBlok/idea_scraper", title: "Restyle", body },
    });
    expect(missing).toEqual([]);
    expect(body).toContain("repo: AlfaBlok/idea_scraper");
    expect(body).toContain("path: ideascraper-vps-v1/telegram-bot");
    // Evidence/deploy honesty is baked into the done-condition.
    expect(body).toContain("invented SHA is not acceptable");
    expect(body).toContain("redeploy is confirmed or explicitly reported as unconfirmed");
  });

  it("still validates with only an objective (defaults fill scope/done/context)", () => {
    const body = buildOneOffIssueBody({ objective: "Summarize the latest WhatsApp thread", repo: "AlfaBlok/obsidian-brain" });
    const missing = validateCreateIssueThenRunRequest({
      originalRequest: "summarize",
      issue: { repo: "AlfaBlok/obsidian-brain", title: "Summarize", body },
    });
    expect(missing).toEqual([]);
  });
});

describe("ensureRunnableBody (clarify-gate fix)", () => {
  it("auto-structures a clear but unceremonious body so it passes validation (the research-VN bug)", () => {
    // This is exactly the shape that hard-blocked: clear objective, no section markers.
    const raw = "Research prompt-enhancement recommendations for the telegram bot and commit a markdown doc to the repo.";
    const body = ensureRunnableBody({ title: "Prompt-enhancement research", body: raw });
    const missing = validateCreateIssueThenRunRequest({
      originalRequest: raw,
      issue: { repo: "AlfaBlok/idea_scraper", title: "Prompt-enhancement research", body },
    });
    expect(missing).toEqual([]); // no longer blocks
    expect(body).toContain(raw); // the user's full intent is preserved as the objective
  });

  it("leaves an already-structured body untouched", () => {
    const structured = buildOneOffIssueBody({ objective: "Do X", repo: "o/r" });
    expect(ensureRunnableBody({ title: "X", body: structured })).toBe(structured);
  });

  it("falls back to the title when there is no body", () => {
    const body = ensureRunnableBody({ title: "Restyle the bot output", body: undefined });
    expect(body).toContain("Restyle the bot output");
    expect(validateCreateIssueThenRunRequest({ originalRequest: "x", issue: { repo: "o/r", title: "Restyle the bot output", body } })).toEqual([]);
  });

  it("still blocks a genuinely empty request (preserves ask-first)", () => {
    expect(ensureRunnableBody({ title: "   ", body: "  " })).toBe("");
  });
});

describe("M-3 — issue-create intent routing", () => {
  it("isIssueCreateIntent detects create/open/file phrasing for an issue/ticket/bug", () => {
    expect(isIssueCreateIntent("create issue banana9 in the Zenod repo")).toBe(true);
    expect(isIssueCreateIntent("open a ticket for the login bug")).toBe(true);
    expect(isIssueCreateIntent("file a bug about the crash")).toBe(true);
    expect(isIssueCreateIntent("what's the status of issue 108?")).toBe(false);
    expect(isIssueCreateIntent("run the tests")).toBe(false);
  });

  it("wantsIssueComment detects a follow-up comment ask", () => {
    expect(wantsIssueComment("create issue banana9 + comment banana8")).toBe(true);
    expect(wantsIssueComment("create issue banana9 in the Zenod repo")).toBe(false);
  });

  it("buildForeignIssueCreateObjective forces gh issue create -R <repo> and reports the URL as evidence", () => {
    const { objective, artifactPolicy } = buildForeignIssueCreateObjective({
      repo: "zenod-ai/zenod",
      title: "banana9",
      body: "Objective: file the banana9 ticket.",
    });
    expect(objective).toContain("gh issue create -R zenod-ai/zenod");
    expect(objective).toContain('title "banana9"');
    expect(artifactPolicy).toContain("gh issue create -R zenod-ai/zenod");
    expect(artifactPolicy.toLowerCase()).toContain("deliverable");
  });

  it("buildForeignIssueCreateObjective folds in a requested comment", () => {
    const { objective, artifactPolicy } = buildForeignIssueCreateObjective({
      repo: "zenod-ai/zenod",
      title: "banana9",
      body: "Objective: file the banana9 ticket.",
      postComment: "banana8",
    });
    expect(objective).toContain("gh issue comment -R zenod-ai/zenod");
    expect(objective).toContain("banana8");
    expect(artifactPolicy).toContain("post the requested comment");
  });

  it("extractIssueCreateSubject pulls the real title out of the natural-language ask", () => {
    expect(extractIssueCreateSubject("create issue banana9 in the Zenod repo")).toBe("banana9");
    expect(extractIssueCreateSubject("create issue banana9")).toBe("banana9");
    expect(extractIssueCreateSubject("open a ticket for the login crash")).toBe("for the login crash");
    expect(extractIssueCreateSubject("create issue banana9 + comment banana8")).toBe("banana9");
    // Unrecognized phrasing falls back to the original text rather than an empty title.
    expect(extractIssueCreateSubject("please look into the flaky test")).toBe("please look into the flaky test");
  });

  it("extractCommentSubject pulls the comment text after the word 'comment'", () => {
    expect(extractCommentSubject("create issue banana9 + comment banana8")).toBe("banana8");
    expect(extractCommentSubject("create issue banana9 in the Zenod repo")).toBeUndefined();
  });

  it("isAlreadyForcedIssueCreateObjective recognizes its own marker and nothing else", () => {
    const { artifactPolicy } = buildForeignIssueCreateObjective({ repo: "o/r", title: "t", body: "b" });
    expect(isAlreadyForcedIssueCreateObjective(artifactPolicy)).toBe(true);
    expect(isAlreadyForcedIssueCreateObjective(undefined)).toBe(false);
    expect(isAlreadyForcedIssueCreateObjective("do not create backlog issues unless explicitly needed")).toBe(false);
  });
});
