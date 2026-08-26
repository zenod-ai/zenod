import { execFileSync, spawnSync } from "node:child_process";

const args = [
  "exec",
  "-w",
  "@zenod/server",
  "--",
  "vitest",
  "run",
  "test/zenodUnit.test.ts",
  "test/drive.test.ts",
  "-t",
  "ZAL-17 .* Drive journey",
];
const command = "npm run acceptance:zal17:drive";
const testCommand =
  'npm exec -w @zenod/server -- vitest run test/zenodUnit.test.ts test/drive.test.ts -t "ZAL-17 .* Drive journey"';
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const startedAt = new Date().toISOString();
const result = spawnSync("npm", args, {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const receipt = {
  schemaVersion: 1,
  acceptance: "ZAL-17 managed Drive journeys",
  status: result.status === 0 ? "pass" : "fail",
  sourceSha,
  command,
  testCommand,
  startedAt,
  completedAt: new Date().toISOString(),
  boundary:
    "local integration with mocked Google token and userinfo HTTP; no credentials, staging, or live mutation",
};
process.stdout.write(`\nZAL17_DRIVE_JOURNEY_RECEIPT ${JSON.stringify(receipt)}\n`);
process.exitCode = result.status ?? 1;
