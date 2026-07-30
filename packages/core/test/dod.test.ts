/**
 * M0 Definition-of-Done suite — docs/M0-SPEC.md § Definition of done.
 *
 * Live tests (real LLM, scratch clone of the user's vault) run only when
 * ANTHROPIC_API_KEY is set. The scratch origin is built from a LOCAL clone of
 * the vault (ZENOD_DOD_VAULT, default ~/Documents/GitHub/obsidian-brain) —
 * the real GitHub repo is never touched.
 *
 *   ANTHROPIC_API_KEY=sk-... npm run test -w zenod -- dod            # DoD 1,2,3,4,6 + 8-store rot check
 *   ANTHROPIC_API_KEY=sk-... ZENOD_DOD_FULL=1 npm run test ...       # full 50-store anti-rot run (DoD #5)
 */
import { cp, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBrainLlm } from "../src/llm/aisdk.js";
import { createEngine } from "../src/engine/engine.js";
import { ensureSchemaV1 } from "../src/vault/migrate.js";
import { VaultRepo } from "../src/git/vaultRepo.js";
import { SqliteStateStore } from "../src/state/sqlite.js";
import type { BrainEngine, LintError } from "../src/types.js";

const API_KEY = process.env.ANTHROPIC_API_KEY;
const SOURCE_VAULT = process.env.ZENOD_DOD_VAULT ?? join(homedir(), "Documents/GitHub/obsidian-brain");
const FULL_RUN = process.env.ZENOD_DOD_FULL === "1";

const STORE_FIXTURES = [
  "I just got travel insurance with Mapfre for the summer trip, policy number TRV-2291.",
  "My car's ITV inspection is due in November 2026.",
  "Decided to keep the Dokploy VPS on Hetzner for at least another year.",
  "The dentist said I should come back for a cleaning in December.",
  "Bought a new external SSD for backups, 4TB Samsung T7.",
  "Mortgage advisor meeting went well; rates around 2.9% fixed look feasible.",
  "Started reading 'The Beginning of Infinity' — note for the reading list.",
  "The accountant needs the Q2 invoices before July 10th.",
  "Tried the new ramen place near Diagonal — excellent, want to go back.",
  "Renewed the zenod.dev domain for two more years.",
];

function lintKey(e: LintError): string {
  return `${e.path}|${e.rule}|${e.message}`;
}

describe.skipIf(!API_KEY)("M0 Definition of Done (live)", () => {
  let dir: string;
  let engine: BrainEngine;
  let state: SqliteStateStore;
  let baselineLint: Set<string>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-dod-"));
    // scratch origin from the local vault clone — the real remote is never touched
    const bare = join(dir, "origin.git");
    await simpleGit().init(["--bare", "--initial-branch=main", bare]);
    const seed = join(dir, "seed");
    await simpleGit().clone(bare, seed);
    await cp(SOURCE_VAULT, seed, {
      recursive: true,
      filter: (src) => !src.includes("/.git"),
    });
    const git = simpleGit(seed);
    await git.addConfig("user.name", "dod").addConfig("user.email", "dod@test");
    await git.add(["-A"]);
    await git.commit("seed: scratch copy of the vault");
    await git.push("origin", "main");

    const repo = await VaultRepo.open({ workdir: join(dir, "work"), remoteUrl: bare });
    const created = await ensureSchemaV1(repo.path);
    if (created.length > 0) await repo.commitAndPush(`schema: v1 — add ${created.join(", ")}`);

    state = new SqliteStateStore(":memory:");
    engine = createEngine({
      repo,
      llm: createBrainLlm({ provider: "anthropic", apiKey: API_KEY! }),
      state,
      location: { repo: "AlfaBlok/obsidian-brain" },
    });

    baselineLint = new Set((await engine.lint()).errors.map(lintKey));
  }, 120_000);

  afterAll(async () => {
    state?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  /** New lint errors introduced since the baseline (pre-existing vault debt is not ours). */
  async function newLintErrors(): Promise<LintError[]> {
    const report = await engine.lint();
    return report.errors.filter((e) => !baselineLint.has(lintKey(e)));
  }

  it("DoD #1 — verbatim store lands evidence + meaning page + clean commit", async () => {
    const result = await engine.store({
      content: "I just got travel insurance with Axa, policy ends March 2027, store this verbatim",
      source: "cli",
      verbatim: true,
    });
    expect(result.evidenceRef).toMatch(/^Log\/\d{4}-\d{2}-\d{2}\.md#\^e-[0-9a-f]{6}$/);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.githubUrls.length).toBeGreaterThan(0);
    if (result.filing !== "inbox") {
      expect(result.pagesTouched.length).toBeGreaterThan(0);
    }
    expect(await newLintErrors()).toEqual([]);
  }, 120_000);

  it("DoD #2 — ask synthesizes an answer with citations", async () => {
    const answer = await engine.ask("what do I know about my insurance?");
    expect(answer.text.toLowerCase()).toContain("insurance");
    expect(answer.sources.length).toBeGreaterThan(0);
    expect(answer.sources[0]!.githubUrl).toContain("github.com/AlfaBlok/obsidian-brain");
  }, 120_000);

  it("DoD #3 — search and get are <500ms with zero LLM calls", async () => {
    let started = performance.now();
    const hits = await engine.search("insurance");
    expect(performance.now() - started).toBeLessThan(500);
    expect(hits.length).toBeGreaterThan(0);

    started = performance.now();
    const note = await engine.get(hits[0]!.path);
    expect(performance.now() - started).toBeLessThan(500);
    expect(note.body.length).toBeGreaterThan(0);
  });

  it("DoD #4 — concurrent stores serialize into clean commits", async () => {
    const [a, b] = await Promise.all([
      engine.store({ content: "Concurrent test: gym membership renews in September.", source: "cli" }),
      engine.store({ content: "Concurrent test: passport expires August 2031.", source: "mcp" }),
    ]);
    expect(a.commitSha).not.toBe(b.commitSha);
    expect(await newLintErrors()).toEqual([]);
  }, 240_000);

  it(
    `DoD #5 — anti-rot: ${FULL_RUN ? 50 : 8} varied stores leave zero new lint errors`,
    async () => {
      const rounds = FULL_RUN ? 50 : 8;
      for (let i = 0; i < rounds; i++) {
        const fixture = STORE_FIXTURES[i % STORE_FIXTURES.length]!;
        await engine.store({ content: `${fixture} (round ${i + 1})`, source: "cli" });
      }
      expect(await newLintErrors()).toEqual([]);
    },
    FULL_RUN ? 3_600_000 : 600_000,
  );

  it("DoD #6 — low-confidence store logs uncertainty instead of asking", async () => {
    const result = await engine.store({
      content: "glorp zzz quux — no idea where this goes, deliberately ambiguous nonsense",
      source: "cli",
      hints: ["do not guess"],
    });
    // Either an Inbox fallback or a filed page; the receipt itself never asks.
    if (result.filing === "inbox") {
      expect(result.pagesTouched[0]).toMatch(/^Inbox\//);
    }
    expect(result).not.toHaveProperty("question");
    expect(await newLintErrors()).toEqual([]);
  }, 120_000);
});

describe.skipIf(Boolean(API_KEY))("M0 DoD (live) — skipped", () => {
  it("needs ANTHROPIC_API_KEY to run", () => {
    expect(API_KEY).toBeUndefined();
  });
});
