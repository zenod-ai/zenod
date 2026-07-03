import { describe, expect, it } from "vitest";
import { formatFilingReceipt } from "../src/filingReceipt.js";

describe("formatFilingReceipt (M-5)", () => {
  it("formats a page + anchor + short sha", () => {
    const text = formatFilingReceipt({
      evidenceRef: "Log/2026-06-11.md#^e-7f3a2c",
      pagesTouched: ["Areas/Insurance.md"],
      commitSha: "d0c0b2876fabdfed9e7b0b0ba8366a41d49c1b89",
      githubUrls: [],
    });
    expect(text).toBe("Filed → Areas/Insurance.md ^e-7f3a2c (d0c0b28)");
  });

  it("falls back to (inbox) when no meaning page was touched", () => {
    const text = formatFilingReceipt({
      evidenceRef: "Inbox/2026-06-11.md#^e-abc123",
      pagesTouched: [],
      commitSha: "1234567890abcdef",
      githubUrls: [],
    });
    expect(text).toBe("Filed → (inbox) ^e-abc123 (1234567)");
  });

  it("omits the anchor cleanly when the evidenceRef has no anchor", () => {
    const text = formatFilingReceipt({
      evidenceRef: "Log/2026-06-11.md",
      pagesTouched: ["Areas/Insurance.md"],
      commitSha: "abc1234",
      githubUrls: [],
    });
    expect(text).toBe("Filed → Areas/Insurance.md (abc1234)");
  });
});
