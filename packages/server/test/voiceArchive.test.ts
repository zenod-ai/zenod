import { describe, expect, it } from "vitest";

import { agentKeptNote, archiveImage, archiveVoiceNote, imageArchiveFilename, voiceArchiveFilename } from "../src/voiceArchive.js";
import type { Settings } from "../src/settings.js";

describe("voice archive keep-detection", () => {
  it("treats a capture_note action as a keep", () => {
    expect(agentKeptNote({ actions: [{ tool: "search_vault" }, { tool: "capture_note" }] })).toBe(true);
  });

  it("treats C1 peer memory actions as a keep", () => {
    expect(agentKeptNote({ actions: [{ tool: "add_memory" }] })).toBe(true);
    expect(agentKeptNote({ actions: [{ tool: "store_memory" }] })).toBe(true);
    expect(agentKeptNote({ actions: [{ tool: "capture" }] })).toBe(true);
  });

  it("does not keep when the agent filed nothing", () => {
    expect(agentKeptNote({ actions: [{ tool: "search_vault" }] })).toBe(false);
    expect(agentKeptNote({ actions: [] })).toBe(false);
    expect(agentKeptNote({})).toBe(false);
  });
});

describe("voiceArchiveFilename", () => {
  it("builds a safe, descriptive filename", () => {
    const name = voiceArchiveFilename("@jordi", Date.UTC(2026, 5, 17, 9, 30, 0), "ogg");
    expect(name).toBe("voice-2026-06-17T09-30-00-000Z-@jordi.ogg");
  });

  it("sanitizes unsafe characters and normalizes the extension", () => {
    expect(voiceArchiveFilename("Bob / Smith!", 0, ".mp3")).toBe("voice-1970-01-01T00-00-00-000Z-Bob_Smith_.mp3");
  });
});

describe("imageArchiveFilename", () => {
  it("builds a safe, descriptive filename", () => {
    const name = imageArchiveFilename("@jordi", Date.UTC(2026, 5, 17, 9, 30, 0), "jpg");
    expect(name).toBe("image-2026-06-17T09-30-00-000Z-@jordi.jpg");
  });

  it("falls back to jpg when no extension is given", () => {
    expect(imageArchiveFilename("Bob / Smith!", 0, "")).toBe("image-1970-01-01T00-00-00-000Z-Bob_Smith_.jpg");
  });
});

describe("archiveVoiceNote", () => {
  it("no-ops (returns null) when Drive is not configured", async () => {
    const settings = { get: () => null } as unknown as Settings;
    const result = await archiveVoiceNote(settings, {
      data: Buffer.from("audio"),
      filename: "voice.ogg",
      mimeType: "audio/ogg",
    });
    expect(result).toBeNull();
  });
});

describe("archiveImage", () => {
  it("no-ops (returns null) when Drive is not configured", async () => {
    const settings = { get: () => null } as unknown as Settings;
    const result = await archiveImage(settings, {
      data: Buffer.from("image"),
      filename: "image.jpg",
      mimeType: "image/jpeg",
    });
    expect(result).toBeNull();
  });
});
