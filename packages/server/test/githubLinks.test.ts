import { describe, expect, it } from "vitest";

import { linkifyGithubRefs } from "../src/githubLinks.js";

describe("linkifyGithubRefs", () => {
  it("appends a clickable links footer on plain (WhatsApp) surfaces", () => {
    const out = linkifyGithubRefs("🤖 Codex working on execution direct-123 — AlfaBlok/idea_scraper#94", {});
    expect(out).toContain("AlfaBlok/idea_scraper#94: https://github.com/AlfaBlok/idea_scraper/issues/94");
    // original text preserved
    expect(out.startsWith("🤖 Codex working")).toBe(true);
  });

  it("dedupes refs and skips ones already printed as a URL", () => {
    const out = linkifyGithubRefs("Execution (AlfaBlok/idea_scraper#94) — blocked. See AlfaBlok/idea_scraper#94 again.", {});
    expect((out.match(/issues\/94/g) || []).length).toBe(1); // one footer line, not two
    const already = linkifyGithubRefs("Done: AlfaBlok/idea_scraper#94 https://github.com/AlfaBlok/idea_scraper/issues/94", {});
    expect(already).toBe("Done: AlfaBlok/idea_scraper#94 https://github.com/AlfaBlok/idea_scraper/issues/94"); // no duplicate footer
  });

  it("inlines markdown links on rich (Telegram) surfaces", () => {
    const out = linkifyGithubRefs("New run for AlfaBlok/idea_scraper#94 created", { markdown: true });
    expect(out).toBe("New run for [AlfaBlok/idea_scraper#94](https://github.com/AlfaBlok/idea_scraper/issues/94) created");
  });

  it("does not double-link an already-markdown-linked ref", () => {
    const already = "[AlfaBlok/idea_scraper#94](https://github.com/AlfaBlok/idea_scraper/issues/94)";
    expect(linkifyGithubRefs(already, { markdown: true })).toBe(already);
  });

  it("ignores refs embedded in URLs and leaves plain text without refs untouched", () => {
    expect(linkifyGithubRefs("see https://github.com/AlfaBlok/idea_scraper/issues/94 ok", {})).toBe(
      "see https://github.com/AlfaBlok/idea_scraper/issues/94 ok",
    );
    expect(linkifyGithubRefs("no refs here", {})).toBe("no refs here");
    expect(linkifyGithubRefs("", {})).toBe("");
  });
});
