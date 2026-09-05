#!/usr/bin/env node
// A credential-free, isolated demo over the production MCP/core seams.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.env.ZMR_BASELINE_OUTPUT_DIR || await mkdtemp(join(tmpdir(), "zmr-report-"));
try {
  const result = spawnSync("npm", ["run", "test", "-w", "@zenod/server", "--", "test/zmrBaseline.test.ts"], {
    cwd: root, env: { ...process.env, ZMR_BASELINE_OUTPUT_DIR: output }, stdio: "inherit",
  });
  if (result.status !== 0) process.exitCode = result.status || 1;
  else for (const provider of ["github", "google_drive"]) {
    const report = JSON.parse(await readFile(join(output, `${provider}.json`), "utf8"));
    console.log(`\n${provider}: deterministic observer; real-model quality/latency/cost UNMEASURED`);
    console.table(report.answerCases.map(({ id, expected, actual }) => ({ id, expected, actual })));
    console.log(JSON.stringify(report.observed, null, 2));
    console.log("Measured local seam durations (ms):", report.durationsMs);
  }
} finally {
  if (!process.env.ZMR_BASELINE_OUTPUT_DIR) await rm(output, { recursive: true, force: true });
}
