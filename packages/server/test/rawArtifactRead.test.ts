import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, describe, expect, it } from "vitest";
import type { BrainEngine } from "zenod";
import { buildMcpServer } from "../src/mcp.js";
import { rawArtifactPointer, readRawArtifact, type RawArtifactDrive, type RawArtifactStore } from "../src/rawArtifactRead.js";

// EPIC-21 V8: get_raw_artifact returns a capture's archived original, own tenant only, sha256 checked.

const audio = Buffer.from("OggS fake opus bytes");
const sha = createHash("sha256").update(audio).digest("hex");

const entryContent = (fileId: string, sha256 = sha) => [
  `Voice note "note.ogg" ingested through Zenod media seam.`,
  `Raw artifact: drive://file/${fileId}`,
  `Raw artifact URL: https://drive.google.com/file/d/${fileId}/view`,
  `Raw artifact sha256: ${sha256}`,
  "Media type: audio/ogg",
  "Source: WhatsApp voice note",
  "",
  "Transcript words",
].join("\n");

/** Two tenants' archives in one fake Drive: A's root folder rootA holds Raw Artifacts rawA; B's root is rootB. */
const files: Record<string, { name: string; mimeType: string; size?: string; parents: string[]; data?: Buffer }> = {
  rawA: { name: "Raw Artifacts", mimeType: "application/vnd.google-apps.folder", parents: ["rootA"] },
  noteA: { name: `${sha}-note.ogg`, mimeType: "audio/ogg", size: String(audio.byteLength), parents: ["rawA"], data: audio },
  badA: { name: "tampered.ogg", mimeType: "audio/ogg", size: "5", parents: ["rawA"], data: Buffer.from("other") },
  bigA: { name: "big.ogg", mimeType: "audio/ogg", size: String(50 * 1024 * 1024), parents: ["rawA"], data: audio },
};
const drive: RawArtifactDrive = {
  async getFile(id) {
    const file = files[id];
    if (!file) throw new Error("404");
    return { id, name: file.name, mimeType: file.mimeType, size: file.size, parents: file.parents };
  },
  async download(id) {
    const file = files[id];
    if (!file?.data) throw new Error("404");
    return file.data;
  },
};
const tenantA: RawArtifactStore = { drive, driveFolderIds: ["rootA"] };
const tenantB: RawArtifactStore = { drive, driveFolderIds: ["rootB"] };

function engineWith(entries: Record<string, string>): BrainEngine {
  return {
    async getEntry(ref: string) {
      const content = entries[ref];
      if (!content) throw new Error(`no entry ${ref}`);
      const marker = ref.lastIndexOf("#^");
      return { evidenceRef: ref, path: ref.slice(0, marker), anchor: ref.slice(marker + 2), title: "Voice note", content, source: "whatsapp", verbatim: true, contentType: "voice_note", capturedAt: "2026-11-15T02:01:54.000Z", githubUrl: "" };
    },
  } as unknown as BrainEngine;
}

async function connect(engine: BrainEngine, store: RawArtifactStore) {
  const server = buildMcpServer(async () => engine, undefined, undefined, undefined, undefined, undefined, undefined, "zenod",
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, "", undefined, undefined, undefined, undefined, undefined, undefined,
    () => store);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}

const ref = "Log/2026-11-15.md#^e-70debb";
const entries = {
  [ref]: entryContent("noteA"),
  "Log/2026-11-15.md#^e-bad000": entryContent("badA"),
  "Log/2026-11-15.md#^e-text00": "A plain typed note with no archive.",
};

describe("get_raw_artifact (EPIC-21 V8)", () => {
  it("returns the owner's own archived voice note as base64 with its mime type, sha256 verified", async () => {
    const client = await connect(engineWith(entries), tenantA);
    const result = await client.callTool({ name: "get_raw_artifact", arguments: { ref } });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as Record<string, unknown>;
    expect(out).toMatchObject({ ref, mimeType: "audio/ogg", sha256: sha, sha256Verified: true, encoding: "base64", sizeBytes: audio.byteLength });
    expect(Buffer.from(out.data as string, "base64").equals(audio)).toBe(true);
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "get_raw_artifact")?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    await client.close();
  });

  it("refuses a file outside the calling tenant's archive, even with a valid ref and sha", async () => {
    const client = await connect(engineWith(entries), tenantB);
    const result = await client.callTool({ name: "get_raw_artifact", arguments: { ref } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: "not_in_this_vault" } });
    expect(JSON.stringify(result)).not.toContain(audio.toString("base64"));
    await client.close();
  });

  it("refuses a bad ref, an unknown entry and an entry with no archived original", async () => {
    const client = await connect(engineWith(entries), tenantA);
    const bad = await client.callTool({ name: "get_raw_artifact", arguments: { ref: "Areas/Insurance.md" } });
    expect(bad.structuredContent).toMatchObject({ error: { code: "bad_ref" } });
    const missing = await client.callTool({ name: "get_raw_artifact", arguments: { ref: "Log/2026-11-15.md#^e-nope00" } });
    expect(missing.structuredContent).toMatchObject({ error: { code: "not_found" } });
    const text = await client.callTool({ name: "get_raw_artifact", arguments: { ref: "Log/2026-11-15.md#^e-text00" } });
    expect(text.structuredContent).toMatchObject({ error: { code: "no_raw_artifact" } });
    await client.close();
  });

  it("refuses bytes that do not match the recorded sha256", async () => {
    const client = await connect(engineWith(entries), tenantA);
    const result = await client.callTool({ name: "get_raw_artifact", arguments: { ref: "Log/2026-11-15.md#^e-bad000" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: "sha256_mismatch" } });
    await client.close();
  });

  it("refuses a file over the size cap before downloading it", async () => {
    await expect(readRawArtifact(ref, entryContent("bigA"), tenantA)).rejects.toMatchObject({ code: "too_large" });
  });

  it("is absent when no archive reader is wired (other agents)", async () => {
    const server = buildMcpServer(async () => engineWith(entries));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientSide);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).not.toContain("get_raw_artifact");
    await client.close();
  });
});

describe("local archive provider", () => {
  let dir = "";
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("reads inside the tenant's local dir and refuses a path outside it", async () => {
    dir = await mkdtemp(join(tmpdir(), "v8-raw-"));
    await mkdir(join(dir, "mine"), { recursive: true });
    await mkdir(join(dir, "other"), { recursive: true });
    await writeFile(join(dir, "mine", "a.ogg"), audio);
    await writeFile(join(dir, "other", "b.ogg"), audio);
    const content = (path: string) => `Raw artifact: ${pathToFileURL(path).href}\nRaw artifact sha256: ${sha}\nMedia type: audio/ogg`;
    const own = await readRawArtifact(ref, content(join(dir, "mine", "a.ogg")), { localDir: join(dir, "mine") });
    expect(own.data.equals(audio)).toBe(true);
    await expect(readRawArtifact(ref, content(join(dir, "other", "b.ogg")), { localDir: join(dir, "mine") }))
      .rejects.toMatchObject({ code: "not_in_this_vault" });
  });

  it("parses the pointer lines Zenod writes", () => {
    expect(rawArtifactPointer(entryContent("noteA"))).toEqual({ uri: "drive://file/noteA", sha256: sha, mediaType: "audio/ogg" });
    expect(rawArtifactPointer("no pointer here")).toBeNull();
  });
});
