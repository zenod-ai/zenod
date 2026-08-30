import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const expectedSha = process.env.GDV10_EXPECTED_SHA?.trim();
const expectedBaseSha = process.env.GDV10_EXPECTED_BASE_SHA?.trim();
const receiptPath = process.env.GDV10_RECEIPT_PATH?.trim();

if (resolve(process.cwd()) !== resolve(repositoryRoot)) {
  throw new Error(`GDV-10 acceptance must run from repository root ${repositoryRoot}`);
}
if (!expectedSha || !/^[0-9a-f]{40}$/.test(expectedSha)) {
  throw new Error("GDV10_EXPECTED_SHA must be the exact 40-character candidate SHA");
}
if (sourceSha !== expectedSha) {
  throw new Error(`GDV-10 candidate mismatch: expected ${expectedSha}, found ${sourceSha}`);
}
if (!expectedBaseSha || !/^[0-9a-f]{40}$/.test(expectedBaseSha)) {
  throw new Error("GDV10_EXPECTED_BASE_SHA must be the exact 40-character integration base SHA");
}
const mergeBase = execFileSync("git", ["merge-base", sourceSha, expectedBaseSha], {
  encoding: "utf8",
}).trim();
if (mergeBase !== expectedBaseSha) {
  throw new Error(`GDV-10 base mismatch: ${expectedBaseSha} is not the candidate base`);
}
const dirty = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
  encoding: "utf8",
});
if (dirty.trim()) {
  throw new Error(`GDV-10 acceptance requires a clean tree:\n${dirty.trimEnd()}`);
}
const startedAt = new Date().toISOString();

const steps = [
  {
    id: "workspace-dependencies",
    command: ["npm", "run", "build", "-w", "zenod"],
  },
  {
    id: "chassis-dependencies",
    command: ["npm", "run", "build", "-w", "@zenod/mcp-chassis"],
  },
  {
    id: "drive-authority-and-memory-loop",
    command: [
      "npm", "exec", "-w", "zenod", "--", "vitest", "run",
      "test/driveRepository.test.ts", "test/vaultRepositoryContract.test.ts",
    ],
  },
  {
    id: "hosted-runtime-transports-and-regressions",
    command: [
      "npm", "exec", "-w", "@zenod/server", "--", "vitest", "run",
      "test/customerLayer.test.ts",
      "test/customerAccounts.test.ts",
      "test/gdv7DriveTenantRuntime.test.ts",
      "test/zenodUnit.test.ts",
      "test/mcp.test.ts",
      "test/mcpGithubCapability.test.ts",
      "test/runtime.test.ts",
      "test/githubApp.test.ts",
      "test/storageReceipt.test.ts",
      "test/filingReceipt.test.ts",
      "test/hostedChannels.test.ts",
      "test/whatsapp.test.ts",
      "test/drive.test.ts",
      "test/productionReadiness.test.ts",
    ],
  },
  {
    id: "google-first-and-github-ui-regression",
    command: [
      "npm", "exec", "-w", "web", "--", "vitest", "run",
      "src/App.hosted-onboarding.test.tsx",
      "src/views/HostedLogin.test.tsx",
      "src/views/HostedAccount.test.tsx",
      "src/views/ZenodPortalPanels.overview.test.tsx",
      "src/views/settings/VaultTab.hosted.test.tsx",
    ],
  },
];

const results = [];
let failed = false;

for (const step of steps) {
  const stepStartedAt = new Date().toISOString();
  const [executable, ...args] = step.command;
  process.stdout.write(`\nGDV10_STEP ${step.id}: ${step.command.join(" ")}\n`);
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  results.push({
    id: step.id,
    status: result.status === 0 ? "pass" : "fail",
    exitCode: result.status ?? 1,
    startedAt: stepStartedAt,
    completedAt: new Date().toISOString(),
  });
  if (result.status !== 0) {
    failed = true;
    break;
  }
}

const receipt = {
  schemaVersion: 1,
  acceptance: "GDV-10 Google-only release acceptance and GitHub regression",
  status: failed ? "fail" : "pass",
  sourceSha,
  integrationBaseSha: expectedBaseSha,
  command: "npm run acceptance:gdv10",
  startedAt,
  completedAt: new Date().toISOString(),
  boundary:
    "deterministic local integration with fake Google identity, OAuth, Drive, channel and billing/provider boundaries; no live credentials, grants, card, Drive mutation, deployment, or public signup",
  steps: results,
};

if (receiptPath) {
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
process.stdout.write(`\nGDV10_RELEASE_ACCEPTANCE_RECEIPT ${JSON.stringify(receipt)}\n`);
process.exitCode = failed ? 1 : 0;
