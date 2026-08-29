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

  it("renders a Drive revision without fabricating a short SHA", () => {
    const text = formatFilingReceipt({
      evidenceRef: "Log/2026-08-29.md#^e-drive",
      pagesTouched: ["Projects/Zenod.md"],
      revision: {
        provider: "google_drive",
        id: "drive-txn-1",
        committedAt: "2026-08-29T10:00:00.000Z",
        urls: ["https://drive.google.com/file/d/log-1/view"],
      },
      urls: ["https://drive.google.com/file/d/log-1/view"],
      filing: "filed",
    });

    expect(text).toBe("Filed → Projects/Zenod.md ^e-drive (google_drive:drive-txn-1)");
  });

  it("renders Drive authority before its independent Git bundle commit", () => {
    const commitSha = "d0c0b2876fabdfed9e7b0b0ba8366a41d49c1b89";
    const text = formatFilingReceipt({
      evidenceRef: "Log/2026-08-29.md#^e-drive-git",
      pagesTouched: ["Projects/Zenod.md"],
      revision: {
        provider: "google_drive",
        id: "drive-txn-independent",
        committedAt: "2026-08-29T10:00:00.000Z",
        urls: ["https://drive.google.com/file/d/log-1/view"],
        commitSha,
      },
      urls: ["https://drive.google.com/file/d/log-1/view"],
      commitSha,
      filing: "filed",
    });
    expect(text).toBe("Filed → Projects/Zenod.md ^e-drive-git (google_drive:drive-txn-independent; git:d0c0b28)");
  });
});
