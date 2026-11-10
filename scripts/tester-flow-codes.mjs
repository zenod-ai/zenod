#!/usr/bin/env node
// EPIC-26 S2: give each accepted tester their code through the tester-code command.
//
// The Zenod server accepts testers itself (packages/server/src/testerFlow.ts). When it
// cannot mint codes (its Stripe key only reads promotion codes), each accepted tester
// waits "for the code command". This script, run on VPS1 by an agent or a timer:
//   1. asks the server which tester ids wait for a code (ids only, never an email),
//   2. runs the root-only tester-code command `issue <label>` once per id (E26-A1/A2),
//   3. hands the new code back to the server, which emails the personal link.
//
// Usage: node scripts/tester-flow-codes.mjs --token-file <file> [--base https://cloud.zenod.dev]
//          [--issue-cmd "sudo -n /usr/local/sbin/zenod-tester-code issue"] [--dry-run]
// Prints counts only. The ops token (ZENOD_TESTER_OPS_TOKEN) is read from the file, never printed.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const DEFAULT_BASE = "https://cloud.zenod.dev";
export const DEFAULT_ISSUE_CMD = "sudo -n /usr/local/sbin/zenod-tester-code issue";

export function parseArgs(argv) {
  const opts = { base: DEFAULT_BASE, issueCmd: DEFAULT_ISSUE_CMD, dryRun: false, tokenFile: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--base") opts.base = argv[++i];
    else if (arg === "--issue-cmd") opts.issueCmd = argv[++i];
    else if (arg === "--token-file") opts.tokenFile = argv[++i];
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!opts.tokenFile) throw new Error("pass --token-file <file with ZENOD_TESTER_OPS_TOKEN>");
  return opts;
}

/** The code from stripe-testers.mjs `issue` output (`label=…  code=ZT-…  promotion_code=…`). */
export function codeFromIssueOutput(stdout) {
  return /(?:^|\s)code=(ZT-[A-Z2-9]{8})(?:\s|$)/m.exec(stdout)?.[1] ?? null;
}

export async function drain({ base, token, issue, fetchImpl = fetch, dryRun = false }) {
  const headers = { Authorization: `Bearer ${token}` };
  const list = await fetchImpl(`${base}/api/ops/testers/pending-codes`, { headers });
  if (!list.ok) throw new Error(`pending list answered ${list.status}`);
  const { pending } = await list.json();
  const result = { waiting: pending.length, issued: 0, failed: 0 };
  if (dryRun) return result;
  for (const { id } of pending) {
    try {
      const code = codeFromIssueOutput(await issue(`zenod-tester-${id}`));
      if (!code) throw new Error("the code command printed no code");
      const post = await fetchImpl(`${base}/api/ops/testers/codes`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ id, code }),
      });
      if (!post.ok) throw new Error(`attach answered ${post.status}`);
      result.issued += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`tester ${id.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

export function commandIssuer(issueCmd) {
  const [file, ...args] = issueCmd.split(/\s+/).filter(Boolean);
  const run = promisify(execFile);
  return async (label) => (await run(file, [...args, label], { timeout: 60_000 })).stdout;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const token = readFileSync(opts.tokenFile, "utf8").trim();
  drain({ base: opts.base.replace(/\/$/, ""), token, issue: commandIssuer(opts.issueCmd), dryRun: opts.dryRun })
    .then((result) => {
      console.log(`waiting=${result.waiting} issued=${result.issued} failed=${result.failed}${opts.dryRun ? " (dry run)" : ""}`);
      process.exitCode = result.failed ? 1 : 0;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
