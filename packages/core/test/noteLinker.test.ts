import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyNoteLinks, planNoteLinks, receiptPoints, unwrittenPoints } from "../src/engine/noteLinker.js";
import { runTreeSweep } from "../src/engine/treeSweep.js";
import { buildTreeIndex } from "../src/vault/tree.js";
import { listMarkdownFiles } from "../src/vault/files.js";
import { parseNote } from "../src/vault/frontmatter.js";
import { lintVault } from "../src/vault/lint.js";
import { seedTreeFiles, type SeedNode } from "../src/vault/treeSeed.js";

/**
 * E12-S20: every voice note linked to the topics it talks about. A fixture vault (made-up notes)
 * with each way a note ended up with no topic link: a filing that stopped on a failed reconcile,
 * a note never filed, a test recording kept as evidence only, and a half-filed note.
 */
const NODES: SeedNode[] = [
  { name: "Garden", kind: "working", path: "Projects/Garden.md", summary: "Planting the vegetable garden: seeds, beds and watering." },
  { name: "Life admin", kind: "long-term", path: "Areas/Life admin.md", summary: "Running life: insurance, kitchen, recipes and travel documents." },
];
const CONFIG = "schema_version: 1\ntags:\n  - home\nconfidence_threshold: 0.7\n";
const page = (title: string, parent: string, body: string) => [
  "---", `title: ${title}`, "type: note", "tags: []", "created: 2026-10-01", "updated: 2026-10-01",
  `summary: ${title} notes.`, `parent: "[[${parent}]]"`, "---", "", `# ${title}`, "", body, "", "See [[Index]].", "",
].join("\n");
const voice = (time: string, anchor: string, text: string, source = "whatsapp", type = "voice_note") =>
  `## ${time} Voice note "${anchor}.ogg" ingested  ^${anchor}\n- source: ${source}\n- verbatim: yes\n- content-type: ${type}\n\n> Voice note "${anchor}.ogg" ingested through Zenod media seam.\n> Transcribed by a stand-in.\n> \n> ${text}\n`;

const STOPPED = "The drip line in the beds needs a timer before the heat comes.";
const REJECTED = "Maybe a rain barrel by the shed, if the landlord agrees.";
const WATERING = page("Watering", "Projects/Garden", "- Water the beds at dawn ([[2026-10-20#^e-aaaaa4]], [[2026-10-22#^e-aaaaa5]]).");
const LOG_1020 = `# 2026-10-20\n\n${voice("09:00", "e-aaaaa4", "Water the beds at dawn, it is cooler then.")}`;
const LOG_1021 = `# 2026-10-21\n\n${voice("10:00", "e-aaaaa1", `Two things. ${STOPPED}`)}\n${voice("10:05", "e-aaaaa2", "Renew the travel insurance documents before the trip.")}\n${voice("10:09", "e-aaaaa3", "Just a quick test that voice notes work, say banana.")}\n`;
const LOG_1022 = `# 2026-10-22\n\n${voice("08:00", "e-aaaaa5", `Water at dawn again. ${REJECTED}`)}\n## 08:30 deploy report  ^e-bbbbb1\n- source: mcp\n- verbatim: yes\n\n> EPIC-9 merged and live on abc1234.\n`;

const v1 = (ref: string, topics: Array<{ topic: string; ideaId: string; disposition: string; pages: string[]; quote: string }>, outcomes: Array<{ ideaId: string; status: string; reason?: string; filedPages: string[] }>, disposition = "append_compact_note") => [
  "---", "status: filing-record", `evidence: ${JSON.stringify(ref)}`, "---", "", "# Topic filing receipt", "",
  "```json", JSON.stringify({ version: 1, evidenceRef: ref, phase: "ready", classification: {
    disposition, topics: topics.map(t => ({ topic: t.topic, ideaId: t.ideaId, disposition: t.disposition, pages: t.pages.map(path => ({ path, action: "update" })), evidenceAssignments: [{ quote: t.quote }] })),
  }, outcomes: outcomes.map(o => ({ ...o, pages: [] })) }, null, 2), "```", "",
].join("\n");

function files(): Array<{ path: string; content: string }> {
  return [
    { path: ".brain/config.yml", content: CONFIG },
    { path: "Index.md", content: "---\ntitle: Index\n---\n\n# Index\n\nTop of the vault.\n" },
    ...seedTreeFiles(NODES, "2026-10-01"),
    { path: "Notes/Watering.md", content: WATERING },
    { path: "Log/2026-10-20.md", content: LOG_1020 },
    { path: "Log/2026-10-21.md", content: LOG_1021 },
    { path: "Log/2026-10-22.md", content: LOG_1022 },
    // Stopped on a failed reconcile, receipt archived unfiled (the tree migration did this).
    { path: "Archive/Inbox/filing-2026-10-21-e-aaaaa1.md", content: v1("Log/2026-10-21.md#^e-aaaaa1",
      [{ topic: "Drip line timer", ideaId: "i-1", disposition: "append_compact_note", pages: ["Notes/Watering.md"], quote: STOPPED }],
      [{ ideaId: "i-1", status: "pending", reason: "reconciliation_validation_failed", filedPages: [] }]) },
    // A test recording its filing kept as evidence only.
    { path: "Archive/Inbox/filing-2026-10-21-e-aaaaa3.md", content: v1("Log/2026-10-21.md#^e-aaaaa3",
      [{ topic: "Voice-note test", ideaId: "i-3", disposition: "evidence_only", pages: [], quote: "Just a quick test that voice notes work, say banana." }],
      [{ ideaId: "i-3", status: "filed", filedPages: [] }], "evidence_only") },
    // Half filed: one point rejected for its page, never written.
    { path: "Inbox/filing-2026-10-22-e-aaaaa5.md", content: v1("Log/2026-10-22.md#^e-aaaaa5",
      [{ topic: "Rain barrel", ideaId: "i-5", disposition: "append_compact_note", pages: ["Notes/Watering.md"], quote: REJECTED }],
      [{ ideaId: "i-5", status: "pending", reason: "reconciliation_needs_clarification", filedPages: [] }]) },
  ];
}

describe("E12-S20 every voice note linked to its topics", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-e12s20-links-"));
    for (const file of files()) {
      await mkdir(dirname(join(dir, file.path)), { recursive: true });
      await writeFile(join(dir, file.path), file.content);
    }
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("plans each gap: a stopped filing, a never-filed note, a test recording, a half-filed note", async () => {
    const plan = await planNoteLinks(dir);
    expect(plan).toMatchObject({ voiceNotes: 5, linked: 1, unlinked: 2, partial: 1, evidenceOnly: ["Log/2026-10-21.md#^e-aaaaa3"] });
    const byRef = new Map(plan.notes.map(note => [note.evidenceRef, note]));
    expect(byRef.get("Log/2026-10-21.md#^e-aaaaa1")).toMatchObject({ state: "unlinked", receipt: "Archive/Inbox/filing-2026-10-21-e-aaaaa1.md",
      points: [{ topic: "Drip line timer", text: STOPPED, anchors: ["Notes/Watering.md"] }] });
    expect(byRef.get("Log/2026-10-21.md#^e-aaaaa2")).toMatchObject({ state: "unlinked", receipt: null,
      points: [{ topic: null, text: "Renew the travel insurance documents before the trip.", anchors: [], reason: "never filed" }] });
    // The rejected page is no anchor: the reconciler said it is another subject.
    expect(byRef.get("Log/2026-10-22.md#^e-aaaaa5")).toMatchObject({ state: "partial", citedBy: ["Notes/Watering.md"], points: [{ topic: "Rain barrel", text: REJECTED, anchors: [] }] });
    expect(byRef.has("Log/2026-10-22.md#^e-bbbbb1")).toBe(false);
  });

  it("links each unlinked note with a provisional leaf on its subject's branch, and touches nothing else", async () => {
    const before = new Map<string, string>();
    for (const file of await listMarkdownFiles(dir)) before.set(file, await readFile(join(dir, file), "utf8"));
    const written = await applyNoteLinks(dir, await planNoteLinks(dir), "2026-11-08");
    expect(written.map(item => [item.evidenceRef, item.parent, item.anchored])).toEqual([
      ["Log/2026-10-21.md#^e-aaaaa1", "Projects/Garden.md", true],
      ["Log/2026-10-21.md#^e-aaaaa2", "Areas/Life admin.md", false],
    ]);
    const timer = await readFile(join(dir, written[0]!.leaf), "utf8");
    expect(written[0]!.leaf).toBe("Notes/Drip line timer.md");
    expect(parseNote(timer).frontmatter).toMatchObject({ parent: "[[Projects/Garden]]", provisional: true });
    expect(timer).toContain(`> ${STOPPED}`);
    expect(timer).toContain("[[2026-10-21#^e-aaaaa1]]");
    expect(await readFile(join(dir, written[1]!.leaf), "utf8")).toContain("[[2026-10-21#^e-aaaaa2]]");
    // Only new leaves: every existing file, the Log and the receipts byte for byte as before.
    for (const [file, raw] of before) expect(await readFile(join(dir, file), "utf8")).toBe(raw);
    expect((await listMarkdownFiles(dir)).filter(file => !before.has(file)).sort()).toEqual(written.map(item => item.leaf).sort());
    expect((await lintVault(dir)).errors).toEqual([]);
    const after = await planNoteLinks(dir);
    expect(after).toMatchObject({ linked: 3, unlinked: 0, partial: 1 });
    expect(after.notes.map(note => note.evidenceRef)).toEqual(["Log/2026-10-22.md#^e-aaaaa5"]);
    // Idempotent: a second run plans nothing for the linked notes.
    expect(await applyNoteLinks(dir, after, "2026-11-08")).toEqual([]);
  });

  it("puts the same recording ingested twice on one leaf", async () => {
    await writeFile(join(dir, "Log/2026-10-24.md"), `# 2026-10-24\n\n${voice("09:00", "e-aaaaa8", "Renew the travel insurance documents, before the trip.", "drive", "audio/m4a")}`);
    const written = await applyNoteLinks(dir, await planNoteLinks(dir), "2026-11-08");
    const leaves = written.filter(item => item.topic === null).map(item => item.leaf);
    expect(leaves).toHaveLength(2);
    expect(new Set(leaves).size).toBe(1);
    const raw = await readFile(join(dir, leaves[0]!), "utf8");
    expect(raw).toContain("[[2026-10-21#^e-aaaaa2]]");
    expect(raw).toContain("[[2026-10-24#^e-aaaaa8]]");
  });

  it("links the dropped points of a half-filed note only when asked", async () => {
    const written = await applyNoteLinks(dir, await planNoteLinks(dir), "2026-11-08", { partial: true });
    expect(written.map(item => item.evidenceRef)).toContain("Log/2026-10-22.md#^e-aaaaa5");
    expect((await planNoteLinks(dir))).toMatchObject({ unlinked: 0, partial: 0 });
  });

  it("the weekly sweep files each point of a stuck receipt on its own subject's branch", async () => {
    const insurance = "The travel insurance renewal is due before the trip.";
    await writeFile(join(dir, "Notes/Travel documents.md"), page("Travel documents", "Areas/Life admin", "- Passports in the drawer."));
    await writeFile(join(dir, "Log/2026-10-23.md"), `# 2026-10-23\n\n${voice("09:00", "e-aaaaa7", `${STOPPED} ${insurance}`)}`);
    await writeFile(join(dir, "Inbox/filing-2026-10-23-e-aaaaa7.md"), v1("Log/2026-10-23.md#^e-aaaaa7", [
      { topic: "Drip line timer", ideaId: "i-a", disposition: "append_compact_note", pages: ["Notes/Watering.md"], quote: STOPPED },
      { topic: "Insurance renewal", ideaId: "i-b", disposition: "append_compact_note", pages: ["Notes/Travel documents.md"], quote: insurance },
    ], [
      { ideaId: "i-a", status: "pending", reason: "reconciliation_validation_failed", filedPages: [] },
      { ideaId: "i-b", status: "pending", reason: "page_filing_failed", filedPages: [] },
    ]));
    const report = await runTreeSweep(dir, { today: "2026-11-08", discover: false });
    const swept = report.receipts.find(item => item.path === "Inbox/filing-2026-10-23-e-aaaaa7.md")!;
    expect(swept).toMatchObject({ outcome: "refiled", reason: "each unwritten point a provisional leaf on its branch" });
    const index = await buildTreeIndex(dir);
    const roots = swept.pages!.map(leaf => { const lineage = index.lineage(leaf); return lineage.ok ? lineage.root.name : null; });
    expect(roots).toEqual(["Garden", "Life admin"]);
    expect(await readFile(join(dir, swept.pages![1]!), "utf8")).toContain(`> ${insurance}`);
  });

  it("E12-S23: files a half-filed note's dropped points on moved pages, the note's own branch and one leaf per name", async () => {
    const stakesA = "The garden beds want tomato stakes before June.";
    const stakesB = "And the stakes for the beds should be bamboo, not pine.";
    await writeFile(join(dir, "Notes/Travel documents.md"), page("Travel documents", "Areas/Life admin", "- Passports in the drawer."));
    await mkdir(join(dir, "Archive/Projects/Garden"), { recursive: true });
    await writeFile(join(dir, "Archive/Projects/Garden/Hose quote.md"), "# Hose quote\n\nRetired.\n");
    await writeFile(join(dir, "Notes/Seeds.md"), page("Seeds", "Projects/Garden", "- Order the seeds early ([[2026-10-25#^e-aaaaa9]])."));
    await writeFile(join(dir, "Log/2026-10-25.md"), `# 2026-10-25\n\n${voice("09:00", "e-aaaaa9", `Seeds early. Passport photos. Compost. Hose for the garden beds. ${stakesA} ${stakesB} The garden beds need mulch.`)}`);
    await writeFile(join(dir, "Archive/Inbox/filing-2026-10-25-e-aaaaa9.md"), v1("Log/2026-10-25.md#^e-aaaaa9", [
      // An old filing names pages since moved: by its own name, and by the folder that held it.
      { topic: "Passport photos", ideaId: "i-1", disposition: "append_compact_note", pages: ["Projects/Trips/Travel documents.md"], quote: "Passport photos." },
      { topic: "Compost bins", ideaId: "i-2", disposition: "append_compact_note", pages: ["Projects/Garden/Compost bins.md"], quote: "Compost." },
      // A page retired to the Archive anchors nothing, not even through its old folder.
      { topic: "Hose quote", ideaId: "i-7", disposition: "append_compact_note", pages: ["Projects/Garden/Hose quote.md"], quote: "Hose for the garden beds." },
      // Two points under one name, no page: both land, on the branch the note already sits on.
      { topic: "Tomato stakes", ideaId: "i-3", disposition: "append_compact_note", pages: [], quote: stakesA },
      { topic: "Tomato stakes", ideaId: "i-4", disposition: "append_compact_note", pages: [], quote: stakesB },
      // The organiser's placeholder name and the note's ingest lines are not the person's point.
      { topic: "Unassigned source content", ideaId: "i-5", disposition: "append_compact_note", pages: [], quote: 'Voice note "x.ogg" ingested through Zenod media seam.\nRaw artifact URL: https://example.test/x\nThe garden beds need mulch.' },
      { topic: "Unassigned source content", ideaId: "i-6", disposition: "append_compact_note", pages: [], quote: "Raw artifact URL: https://example.test/x" },
    ], ["i-1", "i-2", "i-7", "i-3", "i-4", "i-5", "i-6"].map(ideaId => ({ ideaId, status: "pending", reason: "page_filing_failed", filedPages: [] }))));
    const plan = await planNoteLinks(dir);
    const note = plan.notes.find(item => item.evidenceRef === "Log/2026-10-25.md#^e-aaaaa9")!;
    expect(note.points.map(point => [point.topic, point.text])).toEqual([
      ["Passport photos", "Passport photos."], ["Compost bins", "Compost."], ["Hose quote", "Hose for the garden beds."],
      ["Tomato stakes", stakesA], ["Tomato stakes", stakesB], [null, "The garden beds need mulch."],
    ]);
    const written = (await applyNoteLinks(dir, plan, "2026-11-09", { partial: true })).filter(item => item.evidenceRef === note.evidenceRef);
    expect(written.map(item => [item.topic, item.parent, item.anchored])).toEqual([
      ["Passport photos", "Areas/Life admin.md", true],
      ["Compost bins", "Projects/Garden.md", true],
      ["Hose quote", "Projects/Garden.md", false],
      ["Tomato stakes", "Projects/Garden.md", false],
      ["Tomato stakes", "Projects/Garden.md", false],
      [null, "Projects/Garden.md", false],
    ]);
    const stakes = await readFile(join(dir, "Notes/Tomato stakes.md"), "utf8");
    expect(stakes).toContain(`> ${stakesA}`);
    expect(stakes).toContain(`> ${stakesB}`);
    expect(await readFile(join(dir, written[5]!.leaf), "utf8")).not.toContain("example.test");
    expect((await planNoteLinks(dir)).notes.find(item => item.evidenceRef === note.evidenceRef)).toBeUndefined();
  });

  it("reads both receipt forms and skips points already written or kept as evidence", () => {
    const legacy = receiptPoints("Inbox/filing-2026-10-21-e-aaaaa1.md", "```json\n" + JSON.stringify([
      { topic: "timer", sourceSpans: [{ start: 0, end: 9 }], status: "pending", filedPages: [], pages: ["Notes/Watering.md"] },
      { topic: "done", sourceSpans: [{ start: 0, end: 4 }], status: "filed", filedPages: ["Notes/Watering.md"] },
    ]) + "\n```\n")!;
    expect(unwrittenPoints("Drip line timer please", legacy)).toEqual([{ topic: "timer", text: "Drip line", anchors: ["Notes/Watering.md"], reason: "pending" }]);
    expect(receiptPoints("x.md", "no json")).toBeNull();
  });
});
