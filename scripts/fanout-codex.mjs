#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const STATUSES = new Set([
  "queued",
  "starting",
  "reading-context",
  "planning",
  "editing",
  "testing",
  "pushing",
  "opening-pr",
  "blocked",
  "failed",
  "complete",
]);

const ISSUE_STATUS_LABELS = new Map([
  ["status:queued", { color: "C5DEF5", description: "Queued for an agent run" }],
  ["status:running", { color: "FBCA04", description: "Actively being worked by an agent" }],
  ["status:blocked", { color: "B60205", description: "Blocked or failed and needs human intervention" }],
  ["status:needs-review", { color: "D4C5F9", description: "Agent work is complete and awaiting human review" }],
  ["status:complete", { color: "0E8A16", description: "Completed and resolved" }],
]);

const DISTILLED_MEMORY_CONTEXT = `
## Distilled Zenod Memory Context

Sources summarized for workers:
- Projects/Zenod.md
- Projects/Zenod Workflow Learnings.md
- Notes/Memory Mining and Queue Drainage.md

Zenod is the controlled memory/librarian layer: it preserves evidence, source links, transcripts, decisions, goals, and meaning pages with citations. It can mine or write backlog records, but full autonomous execution belongs to a separate queue-drainage/runtime layer.

The launch story is "mine your mind": a messy phone/Drive/WhatsApp voice note becomes durable evidence, cited memory, extracted actions/open questions, backlog records or GitHub issues, and later agent-executable work.

The intended loop is:
Evidence / conversation / artifacts -> Zenod memory -> Miner/digester extracts actions, question-actions, dependencies, priority, difficulty, acceptance criteria -> executable queue -> agents/humans execute -> results and blockers return to memory.

Agent fan-out should be dependency-aware rather than fire-and-forget. A worker may finish, fail, discover a blocking decision, or produce follow-on tickets. The controller must be able to inspect state, ask what is blocked, and bubble human decisions upward.

For this repository, launch phase zero can stop at ingestion, digestion, and backlog hydration. Full autonomous issue execution is an experiment/harness around Zenod, not core librarian scope.
`.trim();

const ISSUE_CONSTRAINTS = {
  17: `
Issue-specific constraint for #17:
- Own the two-phase ingest/digest lifecycle and report-back contract.
- Do not build the backlog/action digester itself except through a narrow interface or placeholder if needed.
- The immediate acknowledgment must not wait on transcription, LLM digestion, GitHub issue creation, or filing.
`.trim(),
  18: `
Issue-specific constraint for #18:
- This is the most independent first worker.
- Focus on clean-slate vault onboarding, command/flow semantics, two-commit reversibility, and tests.
- Do not rework unrelated ingestion or digester behavior.
`.trim(),
  19: `
Issue-specific constraint for #19:
- This issue is broad; constrain v1 to a structured backlog candidate schema, callable tool shape, fixture tests, and conservative integration.
- GitHub issue writing should be optional/flagged unless the existing code makes a safe writer target obvious.
- Avoid deep rewrites of the ingestion lifecycle; #17 owns that lifecycle.
`.trim(),
};

function usage() {
  return `
Usage:
  node scripts/fanout-codex.mjs start --repo owner/name --issues 17,18,19 [options]
  node scripts/fanout-codex.mjs status --run <run-id> [--workdir <path>]
  node scripts/fanout-codex.mjs inspect --run <run-id> --issue 18 [--workdir <path>]
  node scripts/fanout-codex.mjs tail --run <run-id> --issue 18 [--workdir <path>] [--follow]
  node scripts/fanout-codex.mjs cancel --run <run-id> --issue 18|--all [--workdir <path>]
  node scripts/fanout-codex.mjs summarize --run <run-id> [--workdir <path>]

Start options:
  --repo <owner/name>       GitHub repository to work on.
  --issues <list>           Comma-separated issue numbers.
  --base <branch>           Base branch. Default: main.
  --workdir <path>          Main checkout path. Default: current directory.
  --run-dir <path>          Run directory root. Default: <workdir>/.fanout/runs.
  --concurrency <n>         Max workers to run at once. Default: issue count.
  --goal <text>             Root GOAL for the whole fan-out run.
  --goal-file <path>        File containing the root GOAL.
  --model <model>           Optional Codex model override.
  --thinking <effort>       Optional Codex reasoning effort if supported by installed CLI.
  --draft-pr                Push branches and open draft PRs.
  --github-status           Comment start/final/blocker status on GitHub issues.
  --dry-run                 Build prompts/manifests only; do not launch Codex.
  --no-push                 Never push or open PRs.
`.trim();
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { _: [], command };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      opts._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (["draft-pr", "github-status", "dry-run", "no-push", "follow", "all"].includes(key)) {
      opts[toCamel(key)] = true;
      continue;
    }
    const value = rest[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    opts[toCamel(key)] = value;
    i += 1;
  }
  return opts;
}

function toCamel(key) {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(`${cmd} ${args.join(" ")} failed (${result.status})${stderr ? `\n${stderr}` : ""}${stdout ? `\n${stdout}` : ""}`);
  }
  return result;
}

function commandExists(cmd) {
  return spawnSync("sh", ["-lc", `command -v ${shellQuote(cmd)}`], { encoding: "utf8" }).status === 0;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function jsonRead(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmp, path);
}

function nowIso() {
  return new Date().toISOString();
}

function runId() {
  const d = new Date();
  const stamp = d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `fanout-${stamp}`;
}

function defaultWorkdir() {
  return resolve(process.cwd());
}

function runRoot(opts) {
  const workdir = resolve(opts.workdir ?? defaultWorkdir());
  return resolve(opts.runDir ?? join(workdir, ".fanout", "runs"));
}

function runPath(opts) {
  if (!opts.run) throw new Error("--run is required");
  return resolve(runRoot(opts), opts.run);
}

function issueList(value) {
  if (!value) throw new Error("--issues is required");
  const issues = String(value)
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (issues.length === 0) throw new Error("--issues must contain at least one issue number");
  return [...new Set(issues)];
}

function branchName(issue) {
  const slug = String(issue.title ?? `issue-${issue.number}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 52)
    .replace(/^-|-$/g, "");
  return `codex/issue-${issue.number}-${slug || "work"}`;
}

function resolveGoal(opts, issues) {
  if (opts.goal && opts.goalFile) throw new Error("Use --goal or --goal-file, not both");
  if (opts.goalFile) return readFileSync(resolve(opts.goalFile), "utf8").trim();
  if (opts.goal) return String(opts.goal).trim();
  const issueText = issues.map((n) => `#${n}`).join(", ");
  return [
    `GOAL: Drain agent-owned GitHub issues ${issueText} into isolated branches and draft-ready implementation results.`,
    "",
    "Success means every runnable issue has either a tested local branch / draft PR candidate or a structured blocked report with a concrete human decision request. Do not merge to main. Preserve visibility into each subagent's state throughout the run.",
  ].join("\n");
}

async function ensureCheckout(repo, workdir, base) {
  if (!existsSync(workdir)) {
    await mkdir(dirname(workdir), { recursive: true });
    run("git", ["clone", `https://github.com/${repo}.git`, workdir], { stdio: "inherit" });
  }
  if (!existsSync(join(workdir, ".git"))) throw new Error(`${workdir} is not a git checkout`);
  run("git", ["fetch", "origin", base, "--prune"], { cwd: workdir, stdio: "inherit" });
  run("git", ["checkout", base], { cwd: workdir, stdio: "inherit" });
  run("git", ["pull", "--ff-only", "origin", base], { cwd: workdir, stdio: "inherit" });
}

function verifyPrereqs({ allowNode18 = false } = {}) {
  for (const cmd of ["git", "gh", "codex"]) {
    if (!commandExists(cmd)) throw new Error(`Required command not found: ${cmd}`);
  }
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (!allowNode18 && nodeMajor < 22) {
    throw new Error(`Node >=22 is required for Zenod builds/tests. Current node: ${process.version}`);
  }
  run("gh", ["auth", "status"], { allowFailure: false });
}

function fetchIssue(repo, number) {
  const result = run("gh", [
    "issue",
    "view",
    String(number),
    "--repo",
    repo,
    "--json",
    "number,title,body,labels,url",
  ]);
  return JSON.parse(result.stdout);
}

function labels(issue) {
  return (issue.labels ?? []).map((label) => label.name);
}

function clarityCheck(issue) {
  const body = issue.body ?? "";
  const names = labels(issue);
  const failures = [];
  const warnings = [];
  if (!issue.title?.trim()) failures.push("missing title");
  if (!body.trim()) failures.push("missing body");
  if (!names.includes("owner:agent")) failures.push("missing owner:agent label");
  if (!/(acceptance criteria|done when|requirements?|test[s]? \/ verification|verification|deliverables?|outcomes?|definition of done)/i.test(body)) {
    failures.push("missing acceptance criteria or clear done condition");
  }
  // Scope is satisfied either by an explicit scope section OR by concrete code-surface
  // references (file paths) that bound what the worker should touch.
  const hasPathRefs = /(\b(?:packages|apps|src|scripts|lib|test|tests)\/[\w./-]+|\w+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|md))/i.test(body);
  if (!/(scope|out of scope|requirements?|deliverables?)/i.test(body) && !hasPathRefs) {
    failures.push("missing scope boundaries");
  }
  if (!/(source basis|source refs?|source context|log\/|projects\/|notes\/|github)/i.test(body) && !hasPathRefs) {
    failures.push("missing source context references");
  }
  if (body.length > 12000) warnings.push("large issue body; consider splitting if worker blocks");
  if (issue.number === 19) warnings.push("broad issue; v1 prompt constrains work to schema/tool/tests and conservative integration");
  return { ok: failures.length === 0, failures, warnings };
}

function likelyCodeSurfaces(issue) {
  const common = [
    "README.md",
    "docs/",
    "packages/core/src/engine/engine.ts",
    "packages/core/src/llm/aisdk.ts",
    "packages/core/src/types.ts",
    "packages/server/src/app.ts",
    "packages/server/src/mcp.ts",
  ];
  if (issue.number === 17) {
    return [
      ...common,
      "packages/server/src/ingestQueue.ts",
      "packages/server/src/ingestStore.ts",
      "packages/server/src/driveTools.ts",
      "apps/web/src/components/ingestion-panel.tsx",
      "packages/server/test/drive.test.ts",
    ];
  }
  if (issue.number === 18) {
    return [
      ...common,
      "packages/core/src/vault/migrate.ts",
      "packages/core/src/git/vaultRepo.ts",
      "packages/core/src/cli.ts",
      "packages/core/test/schema.test.ts",
      "packages/core/test/engine.test.ts",
    ];
  }
  if (issue.number === 19) {
    return [
      ...common,
      "packages/core/src/llm/types.ts",
      "packages/server/src/mcp.ts",
      "packages/server/src/ingestQueue.ts",
      "packages/core/test/",
      "packages/server/test/",
    ];
  }
  return common;
}

function workerPrompt({ issue, repo, branch, base, runDir, worktree, goal }) {
  const constraint = ISSUE_CONSTRAINTS[issue.number] ?? "";
  const surfaces = likelyCodeSurfaces(issue).map((p) => `- ${p}`).join("\n");
  return `
You are a Codex subagent working on one GitHub issue in a fan-out run.

Repository: ${repo}
Issue: #${issue.number} ${issue.title}
Issue URL: ${issue.url}
Branch: ${branch}
Base branch: ${base}
Worktree: ${worktree}
Run directory: ${runDir}

## Root GOAL

${goal}

Treat this GOAL as the persistent objective for the overall fan-out run. Your local issue work is one part of satisfying that GOAL.

Hard rules:
- Work only on this issue's scope.
- Do not push, open a PR, merge, or close the issue. The controller will handle git fan-in.
- Do not run destructive git commands such as git reset --hard or git checkout -- unless explicitly needed and limited to files you created.
- Preserve unrelated user changes if any exist.
- Add focused tests when behavior changes.
- Run relevant tests/builds. If you cannot, explain exactly why.
- If blocked by a human/product decision, stop and make that explicit instead of guessing.
- Keep a concise final handoff with changed files, tests run, residual risks, and context used.

Blocking protocol:
If you are blocked, your final response must include a JSON block like:
\`\`\`json
{
  "status": "blocked",
  "reason": "needs-human-decision",
  "question": "Specific decision needed",
  "attempted": ["what you inspected or tried"],
  "suggestedNextStep": "Concrete next step"
}
\`\`\`

${constraint ? `${constraint}\n` : ""}
${DISTILLED_MEMORY_CONTEXT}

## Local Repo Pointers
Likely relevant surfaces:
${surfaces}

## Full GitHub Issue Body

${issue.body ?? "(no issue body)"}

## Final Handoff Requirements
In your final response, include:
- Status: complete | blocked | failed
- Context used: issue URL plus any files/docs/memory excerpts you relied on
- Changes made
- Tests run, with exact commands
- Blockers or decisions needed
- Suggested PR title/body if complete
`.trim();
}

async function commentIssue(repo, issueNumber, body, enabled) {
  if (!enabled) return;
  const tmp = join(process.cwd(), `.fanout-comment-${process.pid}-${issueNumber}.md`);
  try {
    writeFileSync(tmp, body);
    run("gh", ["issue", "comment", String(issueNumber), "--repo", repo, "--body-file", tmp], { stdio: "inherit" });
  } finally {
    rmSync(tmp, { force: true });
  }
}

function addLabels(repo, issueNumber, names) {
  if (names.length === 0) return;
  run("gh", ["issue", "edit", String(issueNumber), "--repo", repo, "--add-label", names.join(",")], {
    allowFailure: true,
    stdio: "inherit",
  });
}

function removeLabels(repo, issueNumber, names) {
  if (names.length === 0) return;
  for (const name of names) {
    run("gh", ["issue", "edit", String(issueNumber), "--repo", repo, "--remove-label", name], {
      allowFailure: true,
      stdio: "ignore",
    });
  }
}

function ensureIssueStatusLabels(repo) {
  for (const [name, meta] of ISSUE_STATUS_LABELS) {
    run("gh", ["label", "create", name, "--repo", repo, "--color", meta.color, "--description", meta.description], {
      allowFailure: true,
      stdio: "ignore",
    });
  }
}

function issueStatusLabelFor(workerStatus, { hasReviewableWork = false } = {}) {
  if (workerStatus === "queued") return "status:queued";
  if (["starting", "reading-context", "planning", "editing", "testing", "pushing", "opening-pr"].includes(workerStatus)) {
    return "status:running";
  }
  if (workerStatus === "blocked" || workerStatus === "failed") return "status:blocked";
  if (workerStatus === "complete") return hasReviewableWork ? "status:needs-review" : "status:complete";
  return null;
}

function syncIssueStatusLabel(repo, issueNumber, workerStatus, options = {}) {
  const next = issueStatusLabelFor(workerStatus, options);
  if (!next) return;
  const statusLabels = [...ISSUE_STATUS_LABELS.keys()].filter((name) => name !== next);
  removeLabels(repo, issueNumber, statusLabels);
  addLabels(repo, issueNumber, [next]);
}

async function prepareWorktree({ workdir, base, issue, branch, worktree }) {
  rmSync(worktree, { recursive: true, force: true });
  run("git", ["branch", "-D", branch], { cwd: workdir, allowFailure: true });
  await mkdir(dirname(worktree), { recursive: true });
  run("git", ["worktree", "add", "-b", branch, worktree, `origin/${base}`], { cwd: workdir, stdio: "inherit" });
  const prompt = `Prepared worktree for #${issue.number} on ${branch}`;
  return prompt;
}

async function initialStatus({ issue, branch, worktree, promptPath }) {
  return {
    issue: issue.number,
    title: issue.title,
    url: issue.url,
    branch,
    worktree,
    promptPath,
    status: "queued",
    startedAt: null,
    finishedAt: null,
    pid: null,
    exitCode: null,
    latestModelSummary: null,
    latestCommand: null,
    latestCommandExitCode: null,
    filesChanged: [],
    testsAttempted: [],
    prUrl: null,
    blocker: null,
    clarity: clarityCheck(issue),
    error: null,
  };
}

async function updateManifest(runDir, mutator) {
  const path = join(runDir, "manifest.json");
  const manifest = jsonRead(path);
  if (!manifest) throw new Error(`Missing manifest: ${path}`);
  await mutator(manifest);
  manifest.updatedAt = nowIso();
  await writeJson(path, manifest);
  return manifest;
}

async function updateWorkerStatus(runDir, issueNumber, patch) {
  const path = join(runDir, `issue-${issueNumber}.status.json`);
  const current = jsonRead(path, {});
  const next = { ...current, ...patch, updatedAt: nowIso() };
  await writeJson(path, next);
  await updateManifest(runDir, async (manifest) => {
    manifest.workers[String(issueNumber)] = {
      ...(manifest.workers[String(issueNumber)] ?? {}),
      ...summaryWorker(next),
    };
  });
  return next;
}

function summaryWorker(status) {
  return {
    issue: status.issue,
    title: status.title,
    branch: status.branch,
    worktree: status.worktree,
    status: status.status,
    pid: status.pid,
    startedAt: status.startedAt,
    finishedAt: status.finishedAt,
    exitCode: status.exitCode,
    latestCommand: status.latestCommand,
    latestCommandExitCode: status.latestCommandExitCode,
    filesChanged: status.filesChanged,
    testsAttempted: status.testsAttempted,
    prUrl: status.prUrl,
    blocker: status.blocker,
    error: status.error,
  };
}

function inferEventState(event, current) {
  const text = JSON.stringify(event).toLowerCase();
  const patch = {};
  if (text.includes("tool") || text.includes("read") || text.includes("search")) patch.status = bump(current.status, "reading-context");
  if (text.includes("plan") || text.includes("todo")) patch.status = bump(current.status, "planning");
  if (text.includes("apply_patch") || text.includes("write") || text.includes("edit")) patch.status = bump(current.status, "editing");
  if (text.includes("npm test") || text.includes("npm run test") || text.includes("vitest") || text.includes("testing")) {
    patch.status = bump(current.status, "testing");
  }
  if (text.includes("git push")) patch.status = bump(current.status, "pushing");
  if (text.includes("pull request") || text.includes("create pr")) patch.status = bump(current.status, "opening-pr");

  const command = extractCommand(event);
  if (command) {
    patch.latestCommand = command;
    if (/npm (run )?(test|build)|vitest|tsc|playwright|pnpm test|yarn test/.test(command)) {
      patch.testsAttempted = [...new Set([...(current.testsAttempted ?? []), command])];
      patch.status = "testing";
    }
  }
  const exitCode = extractExitCode(event);
  if (exitCode !== null) patch.latestCommandExitCode = exitCode;
  const summary = extractModelSummary(event);
  if (summary) patch.latestModelSummary = summary;
  return patch;
}

function bump(current, next) {
  if (["blocked", "failed", "complete"].includes(current)) return current;
  const order = ["queued", "starting", "reading-context", "planning", "editing", "testing", "pushing", "opening-pr"];
  return order.indexOf(next) > order.indexOf(current) ? next : current;
}

function extractCommand(value) {
  const stack = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item || typeof item !== "object") continue;
    for (const [key, val] of Object.entries(item)) {
      if (typeof val === "string" && ["cmd", "command", "shell_command"].includes(key.toLowerCase())) return val.slice(0, 500);
      if (val && typeof val === "object") stack.push(val);
    }
  }
  return null;
}

function extractExitCode(value) {
  const stack = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item || typeof item !== "object") continue;
    for (const [key, val] of Object.entries(item)) {
      if (typeof val === "number" && ["exit_code", "exitcode", "status"].includes(key.toLowerCase())) return val;
      if (val && typeof val === "object") stack.push(val);
    }
  }
  return null;
}

function extractModelSummary(value) {
  const candidates = [];
  const stack = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item || typeof item !== "object") continue;
    for (const [key, val] of Object.entries(item)) {
      if (typeof val === "string" && ["text", "message", "content", "delta"].includes(key.toLowerCase())) candidates.push(val);
      if (val && typeof val === "object") stack.push(val);
    }
  }
  const chosen = candidates.find((s) => s.trim().length > 20) ?? candidates[0];
  return chosen ? chosen.replace(/\s+/g, " ").trim().slice(0, 500) : null;
}

async function watchJsonl({ eventsPath, runDir, issueNumber, child }) {
  let buffer = "";
  child.stdout.on("data", async (chunk) => {
    const text = chunk.toString();
    await appendFile(eventsPath, text);
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const current = jsonRead(join(runDir, `issue-${issueNumber}.status.json`), {});
      const patch = inferEventState(event, current);
      if (Object.keys(patch).length > 0) await updateWorkerStatus(runDir, issueNumber, patch);
    }
  });
  child.stderr.on("data", async (chunk) => {
    await appendFile(eventsPath, chunk.toString());
  });
}

async function runWorker({ opts, manifest, issueNumber }) {
  const runDir = manifest.runDir;
  const worker = manifest.workers[String(issueNumber)];
  const promptPath = join(runDir, `issue-${issueNumber}.prompt.md`);
  const eventsPath = join(runDir, `issue-${issueNumber}.events.jsonl`);
  const finalPath = join(runDir, `issue-${issueNumber}.final.md`);
  await updateWorkerStatus(runDir, issueNumber, { status: "starting", startedAt: nowIso() });
  if (opts.githubStatus) syncIssueStatusLabel(manifest.repo, issueNumber, "starting");

  const args = [
    "exec",
    "--json",
    "--cd",
    worker.worktree,
    "--dangerously-bypass-approvals-and-sandbox",
    "--output-last-message",
    finalPath,
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.thinking) args.push("-c", `model_reasoning_effort="${opts.thinking}"`);
  args.push("-");

  const child = spawn("codex", args, {
    cwd: worker.worktree,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  child.stdin.end(readFileSync(promptPath, "utf8"));
  await updateWorkerStatus(runDir, issueNumber, { pid: child.pid });
  await watchJsonl({ eventsPath, runDir, issueNumber, child });

  const exitCode = await new Promise((resolveExit) => child.on("close", resolveExit));
  const filesChanged = changedFiles(worker.worktree);
  const finalText = existsSync(finalPath) ? readFileSync(finalPath, "utf8") : "";
  const blocker = detectBlocker(finalText);
  let status = exitCode === 0 ? "complete" : "failed";
  if (blocker) status = "blocked";

  await updateWorkerStatus(runDir, issueNumber, {
    status,
    exitCode,
    finishedAt: nowIso(),
    filesChanged,
    blocker,
    latestModelSummary: finalText.trim().replace(/\s+/g, " ").slice(0, 500) || null,
  });

  if (blocker) {
    if (opts.githubStatus) {
      syncIssueStatusLabel(manifest.repo, issueNumber, "blocked");
      await commentIssue(manifest.repo, issueNumber, blockerComment(manifest.runId, worker.branch, blocker), true);
      addLabels(manifest.repo, issueNumber, ["question", "help wanted"]);
    }
    return;
  }
  if (exitCode !== 0) {
    if (opts.githubStatus) {
      syncIssueStatusLabel(manifest.repo, issueNumber, "failed");
      await commentIssue(manifest.repo, issueNumber, finalComment(manifest.runId, issueNumber, "failed", worker.branch, finalText), true);
    }
    return;
  }

  await commitPushPr({ opts, manifest, issueNumber, finalText });
}

function changedFiles(cwd) {
  const result = run("git", ["status", "--short"], { cwd, allowFailure: true });
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function detectBlocker(text) {
  if (!text) return null;
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const jsonText = fence?.[1] ?? (text.trim().startsWith("{") ? text.trim() : null);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed?.status === "blocked") return parsed;
    } catch {
      // fall through
    }
  }
  if (/status:\s*blocked|blocked:/i.test(text)) {
    return {
      status: "blocked",
      reason: "worker-reported-blocked",
      question: text.match(/(?:question|decision needed):\s*(.+)/i)?.[1]?.trim() ?? "Worker reported blocked; inspect final handoff.",
      attempted: [],
      suggestedNextStep: "Inspect worker final handoff and decide how to proceed.",
    };
  }
  return null;
}

async function commitPushPr({ opts, manifest, issueNumber, finalText }) {
  const runDir = manifest.runDir;
  const worker = manifest.workers[String(issueNumber)];
  const cwd = worker.worktree;
  const dirty = changedFiles(cwd);
  if (dirty.length > 0) {
    run("git", ["add", "-A"], { cwd });
    run("git", ["commit", "-m", `fix #${issueNumber}: ${worker.title}`], { cwd, allowFailure: true, stdio: "inherit" });
  }
  const ahead = run("git", ["rev-list", "--count", `origin/${manifest.base}..HEAD`], { cwd, allowFailure: true }).stdout.trim();
  const hasCommits = Number(ahead) > 0;
  if (!hasCommits) {
    await updateWorkerStatus(runDir, issueNumber, { status: "complete", error: "No commits produced" });
    if (opts.githubStatus) {
      syncIssueStatusLabel(manifest.repo, issueNumber, "complete");
      await commentIssue(manifest.repo, issueNumber, finalComment(manifest.runId, issueNumber, "complete-no-commits", worker.branch, finalText), true);
    }
    return;
  }
  if (opts.noPush || !opts.draftPr) {
    if (opts.githubStatus) {
      syncIssueStatusLabel(manifest.repo, issueNumber, "complete", { hasReviewableWork: true });
      await commentIssue(manifest.repo, issueNumber, finalComment(manifest.runId, issueNumber, "complete-local", worker.branch, finalText), true);
    }
    return;
  }

  await updateWorkerStatus(runDir, issueNumber, { status: "pushing" });
  run("git", ["push", "-u", "origin", worker.branch], { cwd, stdio: "inherit" });
  await updateWorkerStatus(runDir, issueNumber, { status: "opening-pr" });
  const bodyPath = join(runDir, `issue-${issueNumber}.pr-body.md`);
  await writeFile(
    bodyPath,
    [
      `Closes #${issueNumber}`,
      "",
      `Fan-out run: ${manifest.runId}`,
      "",
      "## Worker handoff",
      "",
      finalText || "(no final handoff captured)",
    ].join("\n"),
  );
  const pr = run("gh", [
    "pr",
    "create",
    "--repo",
    manifest.repo,
    "--base",
    manifest.base,
    "--head",
    worker.branch,
    "--title",
    `Fix #${issueNumber}: ${worker.title}`,
    "--body-file",
    bodyPath,
    "--draft",
  ], { cwd, allowFailure: true });
  const prUrl = (pr.stdout + pr.stderr).match(/https:\/\/github\.com\/\S+\/pull\/\d+/)?.[0] ?? null;
  await updateWorkerStatus(runDir, issueNumber, { status: "complete", prUrl });
  if (opts.githubStatus) {
    syncIssueStatusLabel(manifest.repo, issueNumber, "complete", { hasReviewableWork: true });
    await commentIssue(manifest.repo, issueNumber, finalComment(manifest.runId, issueNumber, "complete", worker.branch, finalText, prUrl), true);
  }
}

function blockerComment(runIdValue, branch, blocker) {
  return [
    `Fan-out run \`${runIdValue}\` blocked on branch \`${branch}\`.`,
    "",
    `Reason: ${blocker.reason ?? "blocked"}`,
    blocker.question ? `Question: ${blocker.question}` : "",
    blocker.suggestedNextStep ? `Suggested next step: ${blocker.suggestedNextStep}` : "",
    blocker.attempted?.length ? `Attempted:\n${blocker.attempted.map((x) => `- ${x}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

function finalComment(runIdValue, issueNumber, status, branch, finalText, prUrl = null) {
  const excerpt = finalText.trim().slice(0, 3000) || "(no final handoff captured)";
  return [
    `Fan-out run \`${runIdValue}\` finished for #${issueNumber}.`,
    "",
    `Status: \`${status}\``,
    `Branch: \`${branch}\``,
    prUrl ? `Draft PR: ${prUrl}` : "",
    "",
    "Worker handoff excerpt:",
    "",
    excerpt,
  ].filter(Boolean).join("\n");
}

async function start(opts) {
  if (!opts.repo) throw new Error("--repo is required");
  const issues = issueList(opts.issues);
  const base = opts.base ?? "main";
  const workdir = resolve(opts.workdir ?? defaultWorkdir());
  const runDirRoot = runRoot({ ...opts, workdir });
  const id = runId();
  const thisRunDir = join(runDirRoot, id);
  const concurrency = Number(opts.concurrency ?? issues.length);
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("--concurrency must be a positive integer");

  verifyPrereqs({ allowNode18: opts.dryRun });
  if (opts.githubStatus) ensureIssueStatusLabels(opts.repo);
  await ensureCheckout(opts.repo, workdir, base);
  await mkdir(thisRunDir, { recursive: true });

  const manifest = {
    runId: id,
    repo: opts.repo,
    base,
    workdir,
    runDir: thisRunDir,
    goal: resolveGoal(opts, issues),
    startedAt: nowIso(),
    updatedAt: nowIso(),
    options: {
      draftPr: Boolean(opts.draftPr),
      githubStatus: Boolean(opts.githubStatus),
      dryRun: Boolean(opts.dryRun),
      noPush: Boolean(opts.noPush),
      concurrency,
      goalSupplied: Boolean(opts.goal || opts.goalFile),
      model: opts.model ?? null,
      thinking: opts.thinking ?? null,
    },
    workers: {},
  };
  await writeFile(join(thisRunDir, "goal.md"), `${manifest.goal}\n`);

  for (const number of issues) {
    const issue = fetchIssue(opts.repo, number);
    const clarity = clarityCheck(issue);
    const branch = branchName(issue);
    const worktree = join(workdir, ".fanout", "worktrees", `${id}-issue-${number}`);
    const promptPath = join(thisRunDir, `issue-${number}.prompt.md`);
    const prompt = workerPrompt({ issue, repo: opts.repo, branch, base, runDir: thisRunDir, worktree, goal: manifest.goal });
    await writeFile(promptPath, `${prompt}\n`);
    const status = await initialStatus({ issue, branch, worktree, promptPath });
    status.clarity = clarity;
    await writeJson(join(thisRunDir, `issue-${number}.status.json`), status);
    manifest.workers[String(number)] = summaryWorker(status);
    if (!clarity.ok) {
      status.status = "blocked";
      status.blocker = {
        status: "blocked",
        reason: "ticket-needs-clarification",
        question: `Issue #${number} needs clarification: ${clarity.failures.join("; ")}`,
        attempted: ["deterministic ticket clarity check"],
        suggestedNextStep: "Clarify the issue body, acceptance criteria, source context, or labels before launching a worker.",
      };
      await writeJson(join(thisRunDir, `issue-${number}.status.json`), status);
      manifest.workers[String(number)] = summaryWorker(status);
      if (opts.githubStatus) syncIssueStatusLabel(opts.repo, number, "blocked");
    } else if (opts.githubStatus) {
      syncIssueStatusLabel(opts.repo, number, "queued");
    }
  }
  await writeJson(join(thisRunDir, "manifest.json"), manifest);

  for (const number of issues) {
    const status = jsonRead(join(thisRunDir, `issue-${number}.status.json`));
    if (status.status === "blocked") {
      if (opts.githubStatus) {
        syncIssueStatusLabel(opts.repo, number, "blocked");
        await commentIssue(opts.repo, number, blockerComment(id, status.branch, status.blocker), true);
        addLabels(opts.repo, number, ["question", "help wanted"]);
      }
      continue;
    }
    if (!opts.dryRun) {
      await prepareWorktree({ workdir, base, issue: { number }, branch: status.branch, worktree: status.worktree });
      if (opts.githubStatus) {
        await commentIssue(opts.repo, number, `Fan-out run \`${id}\` started.\n\nBranch: \`${status.branch}\`\nWorktree: \`${status.worktree}\``, true);
      }
    }
  }

  if (opts.dryRun) {
    await summarizeRun(thisRunDir);
    console.log(`Dry run prepared: ${thisRunDir}`);
    console.log(`Run ID: ${id}`);
    return;
  }

  const queue = issues.filter((number) => jsonRead(join(thisRunDir, `issue-${number}.status.json`))?.status !== "blocked");
  const active = new Set();
  async function launchNext() {
    while (active.size < concurrency && queue.length > 0) {
      const number = queue.shift();
      const promise = runWorker({ opts, manifest: jsonRead(join(thisRunDir, "manifest.json")), issueNumber: number })
        .catch(async (err) => {
          await updateWorkerStatus(thisRunDir, number, {
            status: "failed",
            finishedAt: nowIso(),
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => active.delete(promise));
      active.add(promise);
    }
    if (active.size > 0) {
      await Promise.race(active);
      return launchNext();
    }
  }
  await launchNext();
  await summarizeRun(thisRunDir);
  console.log(`Fan-out run complete: ${thisRunDir}`);
  console.log(`Run ID: ${id}`);
}

async function summarizeRun(runDir) {
  const manifest = jsonRead(join(runDir, "manifest.json"));
  if (!manifest) throw new Error(`Missing manifest in ${runDir}`);
  const statuses = Object.keys(manifest.workers)
    .sort((a, b) => Number(a) - Number(b))
    .map((n) => jsonRead(join(runDir, `issue-${n}.status.json`), manifest.workers[n]));
  const overlap = fileOverlap(statuses);
  const mergeChecks = statuses.map((status) => dryMergeCheck(manifest, status));
  const lines = [
    `# Fan-out Run ${manifest.runId}`,
    "",
    `Repository: ${manifest.repo}`,
    `Base: ${manifest.base}`,
    `Started: ${manifest.startedAt}`,
    `Updated: ${nowIso()}`,
    "",
    "## Root GOAL",
    "",
    manifest.goal ?? "(no goal recorded)",
    "",
    "## Workers",
    "",
    "| Issue | Status | Branch | PR | Files | Blocker |",
    "| --- | --- | --- | --- | ---: | --- |",
    ...statuses.map((s) =>
      `| #${s.issue} | ${s.status} | \`${s.branch}\` | ${s.prUrl ?? ""} | ${(s.filesChanged ?? []).length} | ${s.blocker?.reason ?? ""} |`,
    ),
    "",
    "## File Overlap",
    "",
    overlap.length ? overlap.map((o) => `- ${o.file}: ${o.issues.map((n) => `#${n}`).join(", ")}`).join("\n") : "No touched-file overlap detected.",
    "",
    "## Dry Merge Checks",
    "",
    ...mergeChecks.map((m) => `- #${m.issue}: ${m.ok ? "ok" : `conflict/failure (${m.message})`}`),
    "",
    "## Recommended Merge Order",
    "",
    recommendedOrder(statuses).map((s, i) => `${i + 1}. #${s.issue} ${s.title} (${s.status})`).join("\n") || "No completed branches.",
    "",
  ];
  await writeFile(join(runDir, "summary.md"), `${lines.join("\n")}\n`);
}

function fileOverlap(statuses) {
  const map = new Map();
  for (const status of statuses) {
    for (const line of status.filesChanged ?? []) {
      const file = line.replace(/^[ MADRCU?!]{1,2}\s+/, "").trim();
      if (!file) continue;
      const list = map.get(file) ?? [];
      list.push(status.issue);
      map.set(file, list);
    }
  }
  return [...map.entries()]
    .filter(([, issues]) => new Set(issues).size > 1)
    .map(([file, issues]) => ({ file, issues: [...new Set(issues)] }));
}

function dryMergeCheck(manifest, status) {
  if (!status?.worktree || !existsSync(status.worktree) || !["complete", "failed", "blocked"].includes(status.status)) {
    return { issue: status.issue, ok: true, message: "not checked" };
  }
  const baseRef = `origin/${manifest.base}`;
  const result = run("git", ["merge-tree", baseRef, "HEAD"], { cwd: status.worktree, allowFailure: true });
  const output = `${result.stdout}\n${result.stderr}`;
  const ok = result.status === 0 && !output.includes("<<<<<<<") && !/CONFLICT/i.test(output);
  return { issue: status.issue, ok, message: ok ? "" : output.trim().slice(0, 300) || `exit ${result.status}` };
}

function recommendedOrder(statuses) {
  return statuses
    .filter((s) => s.status === "complete")
    .sort((a, b) => {
      if (a.issue === 18) return -1;
      if (b.issue === 18) return 1;
      if (a.issue === 17) return -1;
      if (b.issue === 17) return 1;
      return a.issue - b.issue;
    });
}

function printStatus(opts) {
  const dir = runPath(opts);
  const manifest = jsonRead(join(dir, "manifest.json"));
  if (!manifest) throw new Error(`Missing manifest in ${dir}`);
  const rows = Object.keys(manifest.workers).sort((a, b) => Number(a) - Number(b)).map((n) => {
    const s = jsonRead(join(dir, `issue-${n}.status.json`), manifest.workers[n]);
    return {
      issue: `#${s.issue}`,
      status: s.status,
      branch: s.branch,
      pid: s.pid ?? "",
      pr: s.prUrl ?? "",
      current: s.latestCommand ?? s.latestModelSummary ?? s.blocker?.reason ?? "",
    };
  });
  console.log(`Run: ${manifest.runId}`);
  console.log(`Repo: ${manifest.repo}`);
  console.table(rows);
}

function inspectIssue(opts) {
  if (!opts.issue) throw new Error("--issue is required");
  const dir = runPath(opts);
  const status = jsonRead(join(dir, `issue-${opts.issue}.status.json`));
  if (!status) throw new Error(`No status for issue ${opts.issue}`);
  console.log(JSON.stringify(status, null, 2));
}

async function tailIssue(opts) {
  if (!opts.issue) throw new Error("--issue is required");
  const file = join(runPath(opts), `issue-${opts.issue}.events.jsonl`);
  if (!existsSync(file)) throw new Error(`No event log found: ${file}`);
  const start = Math.max(0, statSync(file).size - 20_000);
  await streamFrom(file, start, Boolean(opts.follow));
}

async function streamFrom(file, start, follow) {
  let position = start;
  await new Promise((resolveStream, reject) => {
    const stream = createReadStream(file, { start });
    stream.on("data", (chunk) => {
      position += chunk.length;
      process.stdout.write(chunk);
    });
    stream.on("error", reject);
    stream.on("end", resolveStream);
  });
  if (!follow) return;
  setInterval(() => {
    const size = statSync(file).size;
    if (size <= position) return;
    const stream = createReadStream(file, { start: position });
    stream.on("data", (chunk) => {
      position += chunk.length;
      process.stdout.write(chunk);
    });
  }, 1000);
}

async function cancel(opts) {
  const dir = runPath(opts);
  const manifest = jsonRead(join(dir, "manifest.json"));
  if (!manifest) throw new Error(`Missing manifest in ${dir}`);
  const targets = opts.issue === "all" || opts.all ? Object.keys(manifest.workers) : [String(opts.issue)];
  for (const issue of targets) {
    const status = jsonRead(join(dir, `issue-${issue}.status.json`));
    if (!status?.pid) continue;
    try {
      process.kill(Number(status.pid), "SIGTERM");
      await updateWorkerStatus(dir, issue, { status: "failed", error: "cancelled by controller", finishedAt: nowIso() });
      console.log(`Cancelled #${issue} pid ${status.pid}`);
    } catch (err) {
      console.error(`Could not cancel #${issue}: ${err.message}`);
    }
  }
}

async function summarizeCommand(opts) {
  const dir = runPath(opts);
  await summarizeRun(dir);
  console.log(readFileSync(join(dir, "summary.md"), "utf8"));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.command || opts.command === "help" || opts.help) {
    console.log(usage());
    return;
  }
  if (!["start", "status", "inspect", "tail", "cancel", "summarize"].includes(opts.command)) {
    throw new Error(`Unknown command: ${opts.command}\n\n${usage()}`);
  }
  switch (opts.command) {
    case "start":
      await start(opts);
      break;
    case "status":
      printStatus(opts);
      break;
    case "inspect":
      inspectIssue(opts);
      break;
    case "tail":
      await tailIssue(opts);
      break;
    case "cancel":
      await cancel(opts);
      break;
    case "summarize":
      await summarizeCommand(opts);
      break;
  }
}

export {
  issueStatusLabelFor,
};

// Run main() only when invoked as the entry script — but resolve symlinks first.
// The CLI is invoked via the `zenod-fanout-codex` symlink, so process.argv[1] is
// the symlink path while fileURLToPath(import.meta.url) is the real path; without
// realpath-ing argv[1] the guard is false under the symlink and main() silently
// never runs (clean exit 0, zero work). Tests import this module, so the guard
// must still NOT run main() on import.
const entryPath = (() => {
  if (!process.argv[1]) return null;
  try {
    return realpathSync(process.argv[1]);
  } catch {
    return process.argv[1];
  }
})();
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
