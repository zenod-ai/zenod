import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readNotePassage, readNotePacket, uniqueEvidenceRef } from "../src/ops/passage.js";
import { AnswerSupportRegistry } from "../src/engine/answerSupport.js";
import { getNote } from "../src/ops/get.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function vault(body: string, path = "Log/2026-01-01.md") {
  const root = await mkdtemp(join(tmpdir(), "zmr-passage-")); roots.push(root);
  await mkdir(join(root, "Log")); await mkdir(join(root, "Notes"));
  await writeFile(join(root, path), body); return root;
}
const path = "Log/2026-01-01.md";
const entry = `## 00:00 Target  ^e-000001\n- source: drive\n- content-type: text\n- source-id: drive-original\n\n> ${"😀İ世界🧠 ".repeat(2300)}\n> access word: cobalt-seventeen\n`;
const neighbor = "\n## 00:01 Neighbor  ^e-000002\n> NEIGHBOR-SECRET\n";
const body = `# Daily log\n\n${entry}${neighbor}`;

describe("bounded memory passages", () => {
  it.each(["github", "google_drive"] as const)("traverses a huge exact entry with %s identity, no dropped Unicode or neighbors", async provider => {
    const root = await vault(body);
    const resolver = (file: string) => ({ path: file, provider, revisionId: "revision-17", url: provider === "github" ? "https://github.com/synthetic/vault/blob/revision-17/" + file : "https://drive.google.com/file/d/synthetic/view" });
    const ref = `${path}#^e-000001`;
    let cursor: string | undefined;
    let reconstructed = "";
    let count = 0;
    do {
      const page = await readNotePassage(root, ref, { cursor, maxChars: 701 }, resolver);
      expect(page.body.length).toBeLessThanOrEqual(701);
      expect(page.body.isWellFormed()).toBe(true);
      expect(page.body).not.toContain("NEIGHBOR-SECRET");
      expect(page.identity).toBe(ref);
      expect(page.source).toMatchObject({ provider, revisionId: "revision-17" });
      expect(page.extent.end - page.extent.start).toBe(page.body.length);
      expect(page.version).toMatch(/^sha256:[a-f0-9]{64}$/);
      reconstructed += page.body; cursor = page.nextCursor ?? undefined;
      expect(++count).toBeLessThan(100);
    } while (cursor);
    expect(reconstructed).toBe(entry + "\n");
    expect((await getNote(root, path)).body).toBe(body);
  });

  it("registers the final complete source after real paginated Log reads", async()=>{
    const transcript="First complete sentence. "+"Background material. ".repeat(250)+"Final qualified statement.";
    const root=await vault("# Log\n\n## 00:00 Target  ^e-000001\n- source: test\n\n> "+transcript+"\n"+neighbor);
    const registry=new AnswerSupportRegistry();let cursor:string|undefined;const hints=[];
    do {
      const page=await readNotePassage(root,`${path}#^e-000001`,{cursor,maxChars:701});
      hints.push(...registry.addPassage(page));cursor=page.nextCursor??undefined;
      if(!cursor) { expect(page.truncated).toBe(true);expect(page.extent.end).toBe(page.extent.sectionEnd); }
    } while(cursor);
    const last=hints.find(h=>h.excerpt?.includes("Final qualified statement."));
    expect(last).toBeDefined();
    expect(transcript.slice(last!.start,last!.end)).toBe("Final qualified statement.");
    expect(registry.render([{id:last!.id,mode:"raw_report"}]).text).toContain("Final qualified statement.");
    expect(registry.render([{id:last!.id,mode:"raw_report"}]).text).not.toContain("NEIGHBOR-SECRET");
  });

  it("locates a late passage, reports skipped extent and resumes without conflating no match with absence", async () => {
    const root = await vault(body);
    const page = await readNotePassage(root, path, { query: "ACCESS WORD", maxChars: 500 });
    expect(page.extent.start).toBeGreaterThan(8000);
    expect(page.body).toContain("cobalt-seventeen");
    expect(page.body).not.toContain("NEIGHBOR-SECRET");
    expect(page.identity).toBe(`${path}#^e-000001`);
    expect(page.omittedBefore).toBe(true); expect(page.truncated).toBe(true);
    expect(page.queryMatched).toBe(true); expect(page.nextCursor).toBeTruthy();
    const next = await readNotePassage(root, path, { cursor: page.nextCursor! });
    expect(next.body).toContain("NEIGHBOR-SECRET");
    const miss = await readNotePassage(root, path, { query: "missing fact" });
    expect(miss.queryMatched).toBe(false); expect(miss.nextCursor).toBeTruthy();
  });

  it("traverses legacy notes and all sections without omitting bytes", async () => {
    const legacy = "Intro\n\n# First\n" + "A".repeat(9000) + "\n## Second\n終わり\n";
    const root = await vault(legacy, "Notes/Legacy");
    let reconstructed = ""; let cursor: string | undefined;
    do {
      const page = await readNotePassage(root, "Notes/Legacy", { cursor });
      expect(page.source.path).toBe("Notes/Legacy");
      reconstructed += page.body; cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(reconstructed).toBe(legacy);
    expect((await readNotePassage(root, "Notes/Legacy", { query: "終わり" })).identity).toContain("#section-");
  });

  it("rejects missing anchors, invalid budgets/cursors, wrong source and stale content/revision", async () => {
    const root = await vault(body);
    await expect(readNotePassage(root, `${path}#^e-ffff00`)).rejects.toThrow("not found");
    await expect(readNotePassage(root, `${path}#anything`)).rejects.toThrow("anchor");
    await expect(readNotePassage(root, path, { maxChars: 8001 })).rejects.toThrow("maxChars");
    await expect(readNotePassage(root, path, { cursor: "nonsense" })).rejects.toThrow("cursor");
    await expect(readNotePassage(root, path, { cursor: Buffer.from("null").toString("base64url") })).rejects.toThrow("Invalid read cursor");
    const first = await readNotePassage(root, path);
    await expect(readNotePassage(root, `${path}#^e-000001`, { cursor: first.nextCursor! })).rejects.toThrow("another source");
    await expect(readNotePassage(root, path, { cursor: first.nextCursor!, query: "word" })).rejects.toThrow("omit query");
    const cursor = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString()); cursor.offset = -10;
    await expect(readNotePassage(root, path, { cursor: Buffer.from(JSON.stringify(cursor)).toString("base64url") })).rejects.toThrow("offset");
    const revision = (id: string) => (file: string) => ({ path: file, provider: "google_drive" as const, url: "", revisionId: id });
    const versioned = await readNotePassage(root, path, {}, revision("one"));
    await expect(readNotePassage(root, path, { cursor: versioned.nextCursor! }, revision("two"))).rejects.toThrow("revision");
    await writeFile(join(root, path), body + "changed");
    await expect(readNotePassage(root, path, { cursor: first.nextCursor! })).rejects.toThrow("Stale");
  });

  it("makes oversized frontmatter traversable separately without leaking it into an exact evidence read", async () => {
    const summary = "metadata ".repeat(1400) + "metadata-tail";
    const root = await vault(`---\nsummary: ${summary}\n---\n${body}`);
    let cursor: string | undefined; let text = "";
    do {
      const page = await readNotePassage(root, path, { part: "frontmatter", cursor });
      expect(page.part).toBe("frontmatter");
      expect(page.body.length).toBeLessThanOrEqual(8000);
      expect(page.body).not.toContain("NEIGHBOR-SECRET");
      text += page.body; cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(JSON.parse(text).summary).toBe(summary);
    const first = await readNotePassage(root, path, { part: "frontmatter" });
    await expect(readNotePassage(root, path, { cursor: first.nextCursor! })).rejects.toThrow("another source");
    await expect(readNotePassage(root, `${path}#^e-000001`, { part: "frontmatter" })).rejects.toThrow("cannot access");
  });

  it("isolates legacy single-space evidence anchors and empty notes", async () => {
    const legacy = "# Log\n\n## 01:00 Old format ^e-abcdef\n> legacy fact\n\n## 02:00 Neighbor ^e-123456\n> secret\n";
    const root = await vault(legacy);
    const page = await readNotePassage(root, `${path}#^e-abcdef`);
    expect(page.body).toContain("legacy fact");
    expect(page.body).not.toContain("secret");
    expect(page.nextCursor).toBeNull();
    await writeFile(join(root, "Notes/Empty.md"), "");
    expect(await readNotePassage(root, "Notes/Empty.md")).toMatchObject({ body: "", nextCursor: null, truncated: false });
  });

  it("rejects tenant-crossing cursors and filesystem escape paths, including symlinks", async () => {
    const root = await vault(body); const other = await vault(body);
    const first = await readNotePassage(root, path);
    await expect(readNotePassage(other, path, { cursor: first.nextCursor! })).rejects.toThrow("another source");
    await symlink(join(other, path), join(root, "Notes/Escape.md"));
    await mkdir(join(root, ".brain"));
    await writeFile(join(root, ".brain/secret.md"), "internal state");
    await symlink(join(root, ".brain/secret.md"), join(root, "Notes/Internal.md"));
    for (const bad of ["../outside", "..\\outside", "/etc/passwd", "Notes/Escape.md", "Notes/Internal.md", ".git/config", "Notes/../../outside"]) {
      await expect(readNotePassage(root, bad)).rejects.toThrow();
    }
  });
});


describe("substantive section packets", () => {
  it("reads a small headed page in one bounded packet without losing section identities", async () => {
    const text = "\n# Workshop\n\n## Responsibilities\nLucia checks brakes; Omar checks wheels.\n\n## Limits\nNo electric battery repair.\n";
    const root = await vault(text, "Notes/Workshop.md");
    const packet = await readNotePacket(root, "Notes/Workshop.md");
    expect("passages" in packet).toBe(true);
    if (!("passages" in packet)) throw new Error("expected packet");
    expect(packet.passages.map(p => p.body).join("")).toBe(text);
    expect(new Set(packet.passages.map(p => p.identity)).size).toBe(packet.passages.length);
    expect(packet.readPartial).toBe(false); expect(packet.nextCursor).toBeNull();
    const registry = new AnswerSupportRegistry();
    const hints = packet.passages.flatMap(p => registry.addPassage(p));
    const selected = hints.find(h => h.excerpt?.includes("Lucia"))!;
    expect(selected.modes).toEqual(["raw_report"]);
    expect(registry.render([{id:selected.id,mode:"raw_report"}]).text).toContain("Omar checks wheels");
    expect(registry.render([{id:selected.id,mode:"current"}]).valid).toBe(false);
  });
  it("keeps exact and pinned entry boundaries unchanged", async () => {
    const root = await vault(body);
    for (const [ref,pins] of [[`${path}#^e-000001`,undefined],[path,["e-000001"]]] as const) {
      const result = await readNotePacket(root, ref, {maxChars:500}, {}, pins);
      expect("passages" in result).toBe(false);
      expect(JSON.stringify(result)).not.toContain("NEIGHBOR-SECRET");
    }
  });
  it("stops a heading-dense packet at sixteen sections with explicit continuation", async () => {
    const text=Array.from({length:40},(_,i)=>`# Section ${i}\n\n`).join("");
    const root=await vault(text,"Notes/Headings.md");
    const packet=await readNotePacket(root,"Notes/Headings.md");
    if (!("passages" in packet)) throw new Error("expected packet");
    expect(packet.passages).toHaveLength(16);expect(packet.readPartial).toBe(true);
    expect(packet.nextCursor).toBeTruthy();
  });
  it("bounds section count/body bytes and resumes without gaps", async () => {
    const text = Array.from({length:40},(_,i)=>`# Section ${i}\n${"hello ".repeat(20)}\n`).join("");
    const root = await vault(text,"Notes/Many.md"); let cursor: string|undefined; let actual="";
    do {
      const packet = await readNotePacket(root,"Notes/Many.md",{maxChars:512,cursor});
      if (!("passages" in packet)) throw new Error("expected packet");
      expect(packet.bodyChars).toBeLessThanOrEqual(512);expect(packet.passages.length).toBeLessThanOrEqual(16);
      actual+=packet.passages.map(p=>p.body).join("");cursor=packet.nextCursor??undefined;
    } while(cursor);
    expect(actual).toBe(text);
  });
});

it("resolves only a unique anchored source with the existing literal query semantics",()=>{
 const path="Log/2026-01-01.md",first="## 12:00 Studio (plan) ^e-123abc\n> Repair is tentative.\n",second="## 13:00 Garden ^e-456def\n> Watering is tentative.\n";
 expect(uniqueEvidenceRef(path,first)).toBe(path+"#^e-123abc");
 expect(uniqueEvidenceRef(path,first+second)).toBeUndefined();
 expect(uniqueEvidenceRef(path,first+second,"STUDIO (PLAN)")).toBe(path+"#^e-123abc");
 expect(uniqueEvidenceRef(path,first+second,"tentative")).toBeUndefined();
 expect(uniqueEvidenceRef(path,first+second,"missing")).toBeUndefined();
 expect(uniqueEvidenceRef(path,first+second.replace("e-456def","e-123abc"),"Garden")).toBeUndefined();
 expect(uniqueEvidenceRef("Notes/Other.md",first,"Repair")).toBeUndefined();
});
