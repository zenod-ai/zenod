import { describe, expect, it } from "vitest";

import type { DriveClient } from "../src/drive.js";
import {
  driveIngestArchiveFolder,
  ensureDriveInboxFolder,
  imageArchiveFolder,
  uniqueDriveFiles,
  voiceArchiveFolder,
} from "../src/driveFolders.js";

function fakeClient(created: Array<{ name: string; parentId: string }>): DriveClient {
  return {
    async ensureFolder(name: string, parentId: string) {
      created.push({ name, parentId });
      return `${parentId}/${name}`;
    },
  } as unknown as DriveClient;
}

describe("Drive workspace folders", () => {
  it("derives every managed folder from one configured root", async () => {
    const created: Array<{ name: string; parentId: string }> = [];
    const client = fakeClient(created);

    await expect(ensureDriveInboxFolder(client, "root")).resolves.toBe("root/Inbox");
    await expect(driveIngestArchiveFolder(client, "root")).resolves.toBe("root/Archive/Drive Ingest");
    await expect(voiceArchiveFolder(client, "root")).resolves.toBe("root/Archive/Voice Notes");
    await expect(imageArchiveFolder(client, "root")).resolves.toBe("root/Archive/Images");

    expect(created).toEqual([
      { name: "Inbox", parentId: "root" },
      { name: "Archive", parentId: "root" },
      { name: "Drive Ingest", parentId: "root/Archive" },
      { name: "Archive", parentId: "root" },
      { name: "Voice Notes", parentId: "root/Archive" },
      { name: "Archive", parentId: "root" },
      { name: "Images", parentId: "root/Archive" },
    ]);
  });

  it("deduplicates files that are visible through root and Inbox", () => {
    expect(
      uniqueDriveFiles([
        { id: "file-1", name: "one", mimeType: "text/plain" },
        { id: "file-1", name: "one duplicate", mimeType: "text/plain" },
        { id: "file-2", name: "two", mimeType: "text/plain" },
      ]).map((file) => file.id),
    ).toEqual(["file-1", "file-2"]);
  });
});
