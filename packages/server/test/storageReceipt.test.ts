import { describe, expect, it } from "vitest";

import { formatStorageReceipt } from "../src/storageReceipt.js";

describe("formatStorageReceipt", () => {
  it("includes vault evidence, touched notes, commit, and Drive archive link", () => {
    const receipt = formatStorageReceipt({
      storeResult: {
        evidenceRef: "Log/2026-06-17.md#^e-eda5eb",
        pagesTouched: ["Projects/Zenod Workflow Learnings.md"],
        commitSha: "39afb29ef01035777e86512428976535b18abf19",
        githubUrls: [
          "https://github.com/AlfaBlok/obsidian-brain/blob/main/Log/2026-06-17.md",
          "https://github.com/AlfaBlok/obsidian-brain/blob/main/Projects/Zenod%20Workflow%20Learnings.md",
        ],
      },
      archive: {
        fileId: "drive-file-1",
        name: "voice-2026-06-17T01-19-03-000Z-34618217703.ogg",
        webViewLink: "https://drive.google.com/file/d/drive-file-1/view",
      },
      filingStatus: "done",
    });

    expect(receipt).toContain("Storage receipt");
    expect(receipt).toContain("Vault evidence: Log/2026-06-17.md#^e-eda5eb");
    expect(receipt).toContain("Vault note(s): Projects/Zenod Workflow Learnings.md");
    expect(receipt).toContain("Vault commit: 39afb29ef01035777e86512428976535b18abf19");
    expect(receipt).toContain("https://github.com/AlfaBlok/obsidian-brain/blob/main/Log/2026-06-17.md");
    expect(receipt).toContain("Drive audio: voice-2026-06-17T01-19-03-000Z-34618217703.ogg");
    expect(receipt).toContain("Drive link: https://drive.google.com/file/d/drive-file-1/view");
  });
});
