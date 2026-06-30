import { describe, expect, it } from "vitest";

import { buildOneOffIssueBody, oneOffIssueTitle } from "../src/oneOffExecution.js";
import { validateCreateIssueThenRunRequest } from "../src/createIssueRunJourney.js";

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
