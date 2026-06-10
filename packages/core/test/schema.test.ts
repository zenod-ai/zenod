import { cp, mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkEvidenceImmutability } from "../src/vault/immutability.js";
import { lintVault } from "../src/vault/lint.js";
import { loadBrainConfig, ConfigError } from "../src/vault/config.js";
import { parseNote, serializeNote } from "../src/vault/frontmatter.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/vault", import.meta.url));

describe("loadBrainConfig", () => {
  it("loads the fixture config", async () => {
    const config = await loadBrainConfig(FIXTURE);
    expect(config.schemaVersion).toBe(1);
    expect(config.tags).toContain("insurance");
    expect(config.confidenceThreshold).toBe(0.7);
  });

  it("throws ConfigError for a non-vault directory", async () => {
    await expect(loadBrainConfig(tmpdir())).rejects.toBeInstanceOf(ConfigError);
  });
});

describe("parseNote / serializeNote", () => {
  it("round-trips frontmatter and body", () => {
    const raw = serializeNote({ title: "X", tags: ["a"] }, "# X\n\nBody.\n");
    const parsed = parseNote(raw);
    expect(parsed.frontmatter).toEqual({ title: "X", tags: ["a"] });
    expect(parsed.body).toContain("# X");
  });

  it("returns null frontmatter when absent or malformed", () => {
    expect(parseNote("# Just a heading\n").frontmatter).toBeNull();
    expect(parseNote("---\n[broken: yaml\n---\nbody").frontmatter).toBeNull();
  });
});

describe("lintVault", () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), "zenod-vault-"));
    await cp(FIXTURE, vault, { recursive: true });
  });

  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it("passes on the clean fixture vault", async () => {
    const report = await lintVault(vault);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checkedFiles).toBeGreaterThan(4);
  });

  it("flags a meaning page without frontmatter", async () => {
    await writeFile(join(vault, "Notes/Bare.md"), "# Bare\n\nNo frontmatter, no links.\n");
    const report = await lintVault(vault);
    expect(report.errors.map((e) => e.rule)).toContain("frontmatter/missing");
  });

  it("flags out-of-vocabulary tags", async () => {
    await writeFile(
      join(vault, "Notes/Rogue.md"),
      `---\ntitle: Rogue\ntype: note\ntags: [made-up-tag]\ncreated: 2026-06-11\nupdated: 2026-06-11\nsummary: A page with an invented tag.\n---\n\nLinks: [[Areas/Insurance|Insurance]]\n`,
    );
    const report = await lintVault(vault);
    expect(report.errors.map((e) => e.rule)).toContain("tags/vocabulary");
  });

  it("flags orphan pages", async () => {
    await writeFile(
      join(vault, "Notes/Loner.md"),
      `---\ntitle: Loner\ntype: note\ntags: [insurance]\ncreated: 2026-06-11\nupdated: 2026-06-11\nsummary: A page that links nothing.\n---\n\nNo links here.\n`,
    );
    const report = await lintVault(vault);
    expect(report.errors.map((e) => e.rule)).toContain("links/orphan");
  });

  it("does not count an evidence citation as an orphan-saving link", async () => {
    await writeFile(
      join(vault, "Notes/CitesOnly.md"),
      `---\ntitle: CitesOnly\ntype: note\ntags: [insurance]\ncreated: 2026-06-11\nupdated: 2026-06-11\nsummary: Cites evidence but links no page.\n---\n\nFact ([[2026-06-10#^e-7f3a2c]]).\n`,
    );
    const report = await lintVault(vault);
    expect(report.errors.map((e) => e.rule)).toContain("links/orphan");
  });

  it("flags citations pointing at anchors that do not exist", async () => {
    await writeFile(
      join(vault, "Notes/BadCite.md"),
      `---\ntitle: BadCite\ntype: note\ntags: [insurance]\ncreated: 2026-06-11\nupdated: 2026-06-11\nsummary: Cites a missing anchor.\n---\n\nClaim ([[2026-06-10#^e-000000]]). Related: [[Areas/Insurance|Insurance]]\n`,
    );
    const report = await lintVault(vault);
    expect(report.errors.map((e) => e.rule)).toContain("citations/unresolved");
  });

  it("flags type/folder mismatches", async () => {
    await writeFile(
      join(vault, "Areas/Wrong.md"),
      `---\ntitle: Wrong\ntype: note\ntags: [insurance]\ncreated: 2026-06-11\nupdated: 2026-06-11\nsummary: Filed in Areas but typed note.\n---\n\nRelated: [[Areas/Insurance|Insurance]]\n`,
    );
    const report = await lintVault(vault);
    expect(report.errors.map((e) => e.rule)).toContain("frontmatter/type-folder");
  });

  it("flags duplicate evidence anchors", async () => {
    await appendFile(
      join(vault, "Log/2026-06-10.md"),
      `\n## 15:00 Another capture  ^e-7f3a2c\n- source: cli\n\n> duplicate anchor\n`,
    );
    const report = await lintVault(vault);
    expect(report.errors.map((e) => e.rule)).toContain("evidence/anchor-duplicate");
  });

  it("narrows to given paths but still resolves cross-file references", async () => {
    await writeFile(join(vault, "Notes/Bare.md"), "# Bare\n");
    const narrowed = await lintVault(vault, ["Areas/Insurance.md"]);
    expect(narrowed.ok).toBe(true);
    expect(narrowed.checkedFiles).toBe(1);
  });
});

describe("checkEvidenceImmutability", () => {
  const log = "# 2026-06-10\n\n## 14:32 Entry  ^e-7f3a2c\n\n> words\n";

  it("allows appends to Log files", () => {
    expect(
      checkEvidenceImmutability([{ path: "Log/2026-06-10.md", before: log, after: `${log}\n## 15:00 More  ^e-aaaaaa\n` }]),
    ).toEqual([]);
  });

  it("allows new evidence files", () => {
    expect(checkEvidenceImmutability([{ path: "Log/2026-06-11.md", before: null, after: "# 2026-06-11\n" }])).toEqual([]);
  });

  it("rejects modified Log lines", () => {
    const tampered = log.replace("words", "different words");
    const errors = checkEvidenceImmutability([{ path: "Log/2026-06-10.md", before: log, after: tampered }]);
    expect(errors.map((e) => e.rule)).toEqual(["evidence/immutable"]);
  });

  it("rejects appending onto an unterminated final line", () => {
    const before = "# 2026-06-10\n\n> last line without newline";
    const errors = checkEvidenceImmutability([
      { path: "Log/2026-06-10.md", before, after: `${before} sneaky suffix\n` },
    ]);
    expect(errors.map((e) => e.rule)).toEqual(["evidence/immutable"]);
  });

  it("rejects deleting evidence", () => {
    const errors = checkEvidenceImmutability([{ path: "_attachments/insurance/policy.pdf", before: "binary", after: null }]);
    expect(errors.map((e) => e.rule)).toEqual(["evidence/immutable"]);
  });

  it("rejects modifying attachments", () => {
    const errors = checkEvidenceImmutability([{ path: "_attachments/insurance/policy.pdf", before: "v1", after: "v2" }]);
    expect(errors.map((e) => e.rule)).toEqual(["evidence/immutable"]);
  });

  it("ignores meaning pages", () => {
    expect(checkEvidenceImmutability([{ path: "Areas/Insurance.md", before: "a", after: "b" }])).toEqual([]);
  });
});
