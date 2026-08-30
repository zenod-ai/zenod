import { execFileSync, spawnSync } from "node:child_process";

const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
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
  command: "npm run acceptance:gdv10",
  startedAt,
  completedAt: new Date().toISOString(),
  boundary:
    "deterministic local integration with fake Google identity, OAuth, Drive, channel and billing/provider boundaries; no live credentials, grants, card, Drive mutation, deployment, or public signup",
  steps: results,
};

process.stdout.write(`\nGDV10_RELEASE_ACCEPTANCE_RECEIPT ${JSON.stringify(receipt)}\n`);
process.exitCode = failed ? 1 : 0;
