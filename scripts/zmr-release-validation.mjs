#!/usr/bin/env node
// Three isolated deterministic MCP fixture runs. Never a real-model benchmark.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.env.ZMR_RELEASE_OUTPUT_DIR || join(root, "docs/evidence/zmr-8-release-validation/results"));
await mkdir(output, { recursive: true });
const manifestBytes = await readFile(join(root, "packages/server/test/fixtures/zmr/manifest.json"));
const manifest = JSON.parse(manifestBytes);
const rows = [];
for (let trial = 1; trial <= 3; trial++) {
  const dir = join(output, `trial-${trial}`); await mkdir(dir, { recursive: true });
  const run = spawnSync("npm", ["run", "test", "-w", "@zenod/server", "--", "test/zmrBaseline.test.ts"], {
    cwd: root, encoding: "utf8", env: { ...process.env, ZMR_BASELINE_OUTPUT_DIR: dir }, timeout: 180_000,
  });
  await writeFile(join(dir, "command.log"), run.stdout + run.stderr);
  if (run.status !== 0) throw new Error(`Trial ${trial} failed; inspect ${dir}/command.log`);
  for (const provider of ["github", "google_drive"]) {
    const report = JSON.parse(await readFile(join(dir, `${provider}.json`), "utf8"));
    for (const item of report.answerCases) {
      const testCase = manifest.cases.find(test => test.id === item.id);
      rows.push({ trial, provider, case: item.id, heldOut: testCase.heldOut === true, expected: item.expected,
        actual: item.actual, correctLiteral: item.actual.includes(item.expected),
        expectedRefs: item.refs, actualRefs: item.actualSources.map(source => source.path),
        expectedCitationPresent: item.refs.length ? item.refs.every(ref => item.actualSources.some(source => source.path === ref)) : null,
        unknownReturnedSourceCount: item.id === "unknown" ? item.actualSources.length : null,
        localSeamMs: report.durationsMs[`ask-${item.id}`],
        rawLexicalParaphraseHits: item.id === "paraphrase" ? report.observed.paraphraseSearchHits : null,
      });
    }
  }
}
const ledger = {
  productCandidate: "3f5ba097a8d287cdb9ae4468251bc42563e7e7a3",
  harnessHeadAtRun: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  manifest: manifest.id, manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
  environment: { node: process.version, platform: process.platform, transport: "in-memory MCP", model: manifest.model, temperature: null },
  independence: "Each trial starts a fresh Vitest process, isolated vault and SQLite state per provider. Public ask_brain is stateless. Tool selection and synthesis are scripted.",
  harnessFilesSha256: Object.fromEntries(await Promise.all(["scripts/zmr-release-validation.mjs", "packages/server/test/zmrBaseline.test.ts"].map(async path => [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")]))),
  rows, deterministicLiteralCorrect: rows.filter(row => row.correctLiteral).length,
  deterministicCitationIdentityCorrect: rows.filter(row => row.expectedCitationPresent === true).length,
  citationIdentityCases: rows.filter(row => row.expectedCitationPresent !== null).length,
  totalCases: rows.length, realModel: { retrievalRecall: null, answerCorrectness: null, citationSupport: null, unknownAbstention: null, falseAbsence: null, p50LatencyMs: null, p95LatencyMs: null, costUsd: null },
  limitation: "Scripted traversal knows the log path and extracts expected literals. Repeated success is access/identity repeatability, not autonomous recall, semantic entailment, held-out model generalization or SHIP. Raw held-out lexical search remains zero; no prompt/model tuning performed.",
};
await writeFile(join(output, "ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
console.log(JSON.stringify({ deterministicLiteralCorrect: ledger.deterministicLiteralCorrect, deterministicCitationIdentityCorrect: ledger.deterministicCitationIdentityCorrect, totalCases: ledger.totalCases, realModel: "UNMEASURED", output }, null, 2));
if (rows.some(row => !row.correctLiteral || row.expectedCitationPresent === false)) process.exitCode = 1;
