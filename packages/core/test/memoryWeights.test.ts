import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryIndex } from "../src/vault/memoryIndex.js";
import { buildWeightedLinks, combineStrengths, derivedNodeId, expandCloud, nodeIdOf } from "../src/vault/memoryWeights.js";
import { LAST_VOICE_NOTE_VAULT, LATEST_VOICE_NOTE } from "./fixtures/lastVoiceNoteVault.js";

// EPIC-18 W1: each memory links to others with a strength; the links live in the tenant's SQLite
// index (node ids in the Markdown), and retrieval follows paths whose multiplied strength stays
// above a threshold.
const dirs: string[] = [];
const open: MemoryIndex[] = [];
afterEach(async () => {
  for (const index of open.splice(0)) index.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-11-08T07:30:00Z");
const DAY = 86_400_000;

async function vaultOf(files: Record<string, string>): Promise<{ dir: string; vault: string }> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-weights-"));
  dirs.push(dir);
  const vault = join(dir, "vault");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(vault, path)), { recursive: true });
    await writeFile(join(vault, path), content);
  }
  return { dir, vault };
}

function indexAt(dir: string, vault: string, name = "index.sqlite"): MemoryIndex {
  const index = MemoryIndex.open({ path: join(dir, name), vaultPath: vault, tenantId: "t", now: () => NOW });
  open.push(index);
  return index;
}

const chain = (links: Record<string, Record<string, number>>) => (path: string) =>
  Object.entries(links[path] ?? {}).map(([dst, strength]) => ({ dst, strength }));

describe("path retrieval (E18-2)", () => {
  it("multiplies strengths along a path and keeps what stays above the threshold", () => {
    // Jordi's example: 1.0 → 0.9 → 0.95 is 0.855, kept at 0.8; one more 0.9 step (0.77) is not.
    const links = chain({ A: { B: 0.9, X: 0.5 }, B: { C: 0.95 }, C: { D: 0.9 } });
    const cloud = expandCloud([{ path: "A", strength: 1 }], links, { threshold: 0.8 });
    expect(cloud.map((node) => [node.path, node.strength, node.hops])).toEqual([["A", 1, 0], ["B", 0.9, 1], ["C", 0.855, 2]]);
    expect(cloud.at(-1)!.trail).toEqual(["A", "B", "C"]);
    // A lower threshold goes deeper; the threshold, not a fixed depth, decides.
    expect(expandCloud([{ path: "A", strength: 1 }], links, { threshold: 0.7 }).map((node) => node.path)).toEqual(["A", "B", "C", "D"]);
  });

  it("takes each memory's strongest path, caps the cloud, and lets a note end a path", () => {
    const links = chain({ A: { B: 0.85, N: 0.95 }, N: { C: 0.99 }, B: { C: 0.99 } });
    const strongest = expandCloud([{ path: "A", strength: 1 }], links, { threshold: 0.8 });
    expect(strongest.find((node) => node.path === "C")).toMatchObject({ strength: 0.941, via: "N" });
    expect(expandCloud([{ path: "A", strength: 1 }], links, { threshold: 0.8, maxNodes: 2 })).toHaveLength(2);
    // A note about several topics does not chain one topic to the next: C is only reached through B.
    const viaPage = expandCloud([{ path: "A", strength: 1 }], links, { threshold: 0.8, endsPath: (path) => path === "N" });
    expect(viaPage.find((node) => node.path === "C")).toMatchObject({ strength: 0.842, via: "B" });
  });
});

describe("link strengths (E18-1)", () => {
  const note = (day: string, id: string) => `Log/${day}.md#^${id}`;

  it("sets strengths from filing confidence, citations, links and the tree, and adds independent reasons", () => {
    const n = note("2026-11-08", "e-000001");
    const links = buildWeightedLinks([
      { from: n, to: "A.md", kind: "filed", weight: 0.7 },
      { from: "A.md", to: n, kind: "cites" },
      { from: "A.md", to: "B.md", kind: "link" },
      { from: "A.md", to: "P.md", kind: "tree" },
    ], { now: NOW, noteTime: () => NOW });
    const strength = (src: string, dst: string) => links.find((link) => link.src === src && link.dst === dst)?.strength;
    expect(strength(n, "A.md")).toBe(0.97); // 1 − (1 − 0.7)(1 − 0.9)
    expect(strength("A.md", "B.md")).toBe(0.9);
    expect(strength("B.md", "A.md")).toBe(0.6);
    expect(strength("P.md", "A.md")).toBe(0.8);
    expect(strength("A.md", "P.md")).toBe(0.75);
    expect(links.find((link) => link.src === "A.md" && link.dst === n)!.reasons).toBe("cites,filed");
    expect(combineStrengths([0.5, 0.5])).toBe(0.75);
  });

  it("ties pages filed from the same note, fading with the note's age, and shares a hub's weight", () => {
    const fresh = note("2026-11-08", "e-000002");
    const old = note("2025-11-08", "e-000003");
    const coMention = (n: string) => buildWeightedLinks([
      { from: n, to: "A.md", kind: "filed" }, { from: n, to: "B.md", kind: "filed" },
    ], { now: NOW, noteTime: (path) => (path === fresh ? NOW : NOW - 365 * DAY) }).find((link) => link.src === "A.md" && link.dst === "B.md")!;
    expect(coMention(fresh)).toMatchObject({ strength: 0.5, reasons: "co-mention" });
    expect(coMention(old).strength).toBeCloseTo(0.5 * 0.5 ** (365 / 180), 2);
    // A page linking to 32 others: each link is shared out, (8 / 32)^¼ of 0.9.
    const hub = buildWeightedLinks(Array.from({ length: 32 }, (_, i) => ({ from: "Hub.md", to: `P${i}.md`, kind: "link" as const })), { now: NOW, noteTime: () => null });
    expect(hub.find((link) => link.src === "Hub.md")!.strength).toBe(Math.round(0.9 * (8 / 32) ** 0.25 * 1000) / 1000);
  });

  it("keeps node ids in the Markdown: a Log entry's block id, a page's zid, else one derived from its path", () => {
    expect(nodeIdOf(LATEST_VOICE_NOTE)).toBe("e-5c0e11");
    expect(nodeIdOf("Areas/House.md", "p-house01")).toBe("p-house01");
    expect(nodeIdOf("Areas/House.md")).toBe(derivedNodeId("Areas/House.md"));
    expect(derivedNodeId("Areas/House.md")).toBe(derivedNodeId("areas/house"));
    expect(derivedNodeId("Areas/House.md")).toMatch(/^p-[0-9a-f]{10}$/);
  });
});

describe("the weighted graph in the tenant index (E18-W1)", { timeout: 30_000 }, () => {
  it("is rebuilt from the vault alone: two indexes of one vault hold the same nodes and links", async () => {
    const { dir, vault } = await vaultOf(LAST_VOICE_NOTE_VAULT);
    const a = await indexAt(dir, vault, "a.sqlite").cloud({ center: "Projects/Epic Social.md", threshold: 0, maxNodes: 60 });
    const b = await indexAt(dir, vault, "b.sqlite").cloud({ center: "Projects/Epic Social.md", threshold: 0, maxNodes: 60 });
    expect(a!.total.links).toBeGreaterThan(0);
    expect(b).toEqual(a);
    // Rebuilding never writes into the vault.
    expect(await readFile(join(vault, "Projects/Epic Social.md"), "utf8")).toBe(LAST_VOICE_NOTE_VAULT["Projects/Epic Social.md"]);
  });

  it("returns the cloud around a memory with ids, strengths and paths, and null for an unknown one", async () => {
    const { dir, vault } = await vaultOf(LAST_VOICE_NOTE_VAULT);
    const index = indexAt(dir, vault);
    const cloud = (await index.cloud({ center: LATEST_VOICE_NOTE }))!;
    expect(cloud.threshold).toBe(0.8);
    expect(cloud.nodes[0]).toMatchObject({ id: "e-5c0e11", path: LATEST_VOICE_NOTE, kind: "log", strength: 1, hops: 0 });
    const filed = cloud.nodes.filter((node) => node.hops === 1);
    expect(filed.map((node) => node.title)).toEqual(expect.arrayContaining(["Explainer videos", "Branded screenshots"]));
    for (const node of cloud.nodes) expect(node.strength).toBeGreaterThanOrEqual(0.8);
    for (const link of cloud.links) expect(link.strength).toBeGreaterThan(0);
    expect(await index.cloud({ center: "Nowhere.md" })).toBeNull();
    const asked = (await index.cloud({ query: "explainer videos" }))!;
    expect(asked.seeds[0]!.strength).toBe(1);
    expect(asked.nodes.length).toBeGreaterThan(1);
  });

  it("follows a page's zid and updates the links on every filing", async () => {
    const { dir, vault } = await vaultOf(LAST_VOICE_NOTE_VAULT);
    const index = indexAt(dir, vault);
    const before = (await index.cloud({ center: "Areas/Travel.md" }))!;
    expect(before.nodes[0]!.id).toBe(derivedNodeId("Areas/Travel.md"));
    expect(before.nodes.map((node) => node.title)).not.toContain("Hair transplant");
    // A filing writes the page (with its zid) and a wikilink: the next read sees both.
    await writeFile(join(vault, "Areas/Travel.md"), LAST_VOICE_NOTE_VAULT["Areas/Travel.md"]!
      .replace("---\n", "---\nzid: p-travel001\n").concat("\nSee [[Hair transplant]] before booking.\n"));
    index.markDirty();
    const after = (await index.cloud({ center: "Areas/Travel.md" }))!;
    expect(after.nodes[0]!.id).toBe("p-travel001");
    expect(after.nodes.find((node) => node.title === "Hair transplant")).toMatchObject({ strength: 0.9, hops: 1 });
  });

  it("ranks the best page's strong paths after it, each at the best match times its path strength", async () => {
    const { dir, vault } = await vaultOf(LAST_VOICE_NOTE_VAULT);
    const hits = await indexAt(dir, vault).search("tell me about Epic Social", 5);
    expect(hits[0]!.title).toBe("Epic Social");
    for (const hit of hits.filter((hit) => hit.pathStrength !== undefined)) {
      expect(hit.pathStrength).toBeGreaterThanOrEqual(0.8);
      expect(hit.matchPercent).toBe(Math.max(1, Math.round(hits[0]!.matchPercent * hit.pathStrength!)));
    }
  });
});
