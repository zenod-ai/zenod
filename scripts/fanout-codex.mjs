#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

// Reuse the CONTROLLER auto-merge helpers shipped for the ephemeral/one-off lane
// (#480, C-20). The fan-out lane is a second PR-opening site and must enforce the
// same "merge by default on green, honor HOLD-FOR-REVIEW" policy — deterministically,
// controller-side, never the worker's LLM. Don't duplicate the logic; share it.
import { enableAutoMergeForPr, wantsHoldForReview } from "./backlog-monitor.mjs";

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
  ["status:proposed", { color: "FEF2C0", description: "Candidate from agent research; not yet approved for work" }],
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
  --engine <codex|claude>   Worker CLI. Default: claude (or ZENOD_WORKER_ENGINE).
  --model <model>           Model override. Default per engine (claude: claude-opus-4-8).
  --effort <level>          Claude reasoning effort: low|medium|high|xhigh|max. Default: low.
  --thinking <effort>       Optional Codex reasoning effort if supported by installed CLI.
  --draft-pr                Push branches and open PRs (ready + auto-merge on green;
                            HOLD-FOR-REVIEW in the goal/context keeps them draft).
  --github-status           Comment start/final/blocker status on GitHub issues.
  --execution-id <id>       Optional Epaminon execution id to report worker blockers against.
  --execution-context <txt> Optional hydrated execution context from Archus/Epaminon.
  --epaminon-url <url>      Epaminon base URL for execution blocker reports. Defaults to ZENOD_EPAMINON_URL.
  --exec-lane-secret <s>    Lane secret for execution blocker reports. Defaults to ZENOD_EXEC_LANE_SECRET.
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

function branchName(issue, runId = "") {
  const slug = String(issue.title ?? `issue-${issue.number}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 52)
    .replace(/^-|-$/g, "");
  const suffix = String(runId).replace(/^fanout-/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `codex/issue-${issue.number}-${slug || "work"}${suffix ? `-${suffix}` : ""}`;
}

function resolveGoal(opts, issues) {
  if (opts.goal && opts.goalFile) throw new Error("Use --goal or --goal-file, not both");
  if (opts.goalFile) return readFileSync(resolve(opts.goalFile), "utf8").trim();
  if (opts.goal) return String(opts.goal).trim();
  const issueText = issues.map((n) => `#${n}`).join(", ");
  return [
    `GOAL: Drain agent-owned GitHub issues ${issueText} into isolated branches and draft-ready implementation results.`,
    "",
    "Success means every runnable issue has either a tested local branch / PR candidate or a structured blocked report with a concrete human decision request. Workers must not merge to main by hand; the controller opens the PR and enables GitHub auto-merge on it by default (merges once CI is green; HOLD-FOR-REVIEW opts out). Preserve visibility into each subagent's state throughout the run.",
  ].join("\n");
}

async function ensureCheckout(repo, workdir, base) {
  if (!existsSync(workdir)) {
    await mkdir(dirname(workdir), { recursive: true });
    run("git", ["clone", `https://github.com/${repo}.git`, workdir], { stdio: "inherit" });
  }
  if (!existsSync(join(workdir, ".git"))) throw new Error(`${workdir} is not a git checkout`);
  const remote = run("git", ["remote", "get-url", "origin"], { cwd: workdir, allowFailure: true }).stdout.trim();
  if (!remoteMatchesRepo(remote, repo)) {
    throw new Error(`${workdir} origin (${remote || "missing"}) does not match --repo ${repo}; use a repo-specific --workdir`);
  }
  run("git", ["fetch", "origin", base, "--prune"], { cwd: workdir, stdio: "inherit" });
  resetBaseCheckout(workdir, base);
}

function resetBaseCheckout(workdir, base) {
  const ref = `origin/${base}`;
  const checkout = run("git", ["checkout", "-B", base, ref], { cwd: workdir, allowFailure: true, stdio: "inherit" });
  if (checkout.status !== 0) {
    run("git", ["reset", "--hard"], { cwd: workdir, stdio: "inherit" });
    run("git", ["clean", "-fd", "-e", ".fanout/"], { cwd: workdir, stdio: "inherit" });
    run("git", ["checkout", "-B", base, ref], { cwd: workdir, stdio: "inherit" });
  }
  run("git", ["reset", "--hard", ref], { cwd: workdir, stdio: "inherit" });
  run("git", ["clean", "-fd", "-e", ".fanout/"], { cwd: workdir, stdio: "inherit" });
}

function remoteMatchesRepo(remote, repo) {
  const wanted = String(repo || "").replace(/\.git$/, "").toLowerCase();
  const value = String(remote || "").trim().replace(/\.git$/, "").toLowerCase();
  if (!wanted || !value) return false;
  return (
    value === wanted ||
    value.endsWith(`/${wanted}`) ||
    value.endsWith(`:${wanted}`)
  );
}

function verifyPrereqs({ allowNode18 = false, engine = "codex" } = {}) {
  const engineBin = engine === "claude" ? "claude" : "codex";
  for (const cmd of ["git", "gh", engineBin]) {
    if (!commandExists(cmd)) {
      throw new Error(
        `Required command not found: ${cmd}` +
          (cmd === "claude"
            ? " — install @anthropic-ai/claude-code in the runner image and authenticate (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`, or a one-time `claude` login persisted in CLAUDE_CONFIG_DIR)."
            : ""),
      );
    }
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

function clarityCheck(issue, options = {}) {
  const executionContext = String(options.executionContext ?? "");
  const body = [issue.body ?? "", executionContext].filter(Boolean).join("\n\n");
  const names = labels(issue);
  const failures = [];
  const warnings = [];
  if (!issue.title?.trim()) failures.push("missing title");
  if (!body.trim()) failures.push("missing body");
  if (!options.execLane && !names.includes("owner:agent")) failures.push("missing owner:agent label");
  // Action tickets (post a tweet, send a message, etc.) are self-describing and
  // don't carry code-ticket structure (file paths, acceptance criteria, scope
  // boundaries). Recognize them by an action label and require only a clear
  // instruction — the code-surface checks below are for implementation tickets.
  const ACTION_LABELS = new Set(["twitter", "x", "social", "post", "action", "announcement"]);
  const isActionTicket = names.some((n) => ACTION_LABELS.has(n.toLowerCase()));
  if (!isActionTicket) {
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
- X/Twitter posting is gated by intent, not capability: only use the \`x\` MCP tool's posting actions (e.g. createTweet, deleteTweetById) when a human's direct instruction in this issue/GOAL explicitly asks you to post to X. Reading from X is always allowed; never post, delete, or otherwise write to X on your own initiative.
- Suite context: use the \`console\` MCP gateway tools to ground work in the user's enabled agents. Prefer \`ask_zenod\`, \`search_memory\`, and \`get_memory\` for launch notes, positioning, and decisions. For newly discovered follow-up work, use Archus through semantic tools such as \`ask_archus\`, \`open_issue\`, or \`edit_issue\`; these route through Archus's backlog brain. Do not use write/send tools unless the issue or GOAL contains direct human authorization for that exact action.
- Diagnostics: you run in an isolated sandbox with no host, SSH, or docker access, so \`docker logs\`/\`journalctl\` will not work — do not attempt them. To inspect what actually ran in production, use the \`console\` gateway's \`read_llm_timeline\` (operation-labelled LLM-call timeline from the durable usage ledger) and \`get_recent_conversation_transcript\` (message audit). These read structured data that survives redeploys and require no host access.
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
- Deliverables: a list of the changed file paths (one per \`- path\` line), or "Deliverables: none"
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

  const primaryEngine = manifest.options?.engine ?? resolveEngine(opts);

  // Run one attempt on the given engine and gather its outcome. The surrounding
  // clone/branch/commit/push/PR flow is engine-agnostic, so a quota failure on one
  // engine can be replayed verbatim on the other (see fallback below).
  const attempt = async (engine) => {
    const model = manifest.options?.engine === engine ? (manifest.options?.model ?? resolveModel(engine, opts)) : resolveModel(engine, opts);
    const effort = manifest.options?.engine === engine ? (manifest.options?.effort ?? resolveEffort(engine, opts)) : resolveEffort(engine, opts);
    const spawnSpec = buildWorkerSpawn({ engine, worktree: worker.worktree, finalPath, model, thinking: opts.thinking, effort });

    const child = spawn(spawnSpec.bin, spawnSpec.args, {
      cwd: worker.worktree,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(spawnSpec.env ?? {}) },
    });
    child.stdin.end(readFileSync(promptPath, "utf8"));
    await updateWorkerStatus(runDir, issueNumber, { pid: child.pid, engine });
    await watchJsonl({ eventsPath, runDir, issueNumber, child });

    const exitCode = await new Promise((resolveExit) => child.on("close", resolveExit));
    // codex writes the final message to finalPath; claude's final text is in the event
    // stream's `result` event — extract it and persist to finalPath so the rest of the
    // flow (handoff excerpt, PR body, blocker detection) is identical for both engines.
    let finalText = spawnSpec.capturesFinalToFile && existsSync(finalPath) ? readFileSync(finalPath, "utf8") : "";
    if (!spawnSpec.capturesFinalToFile) {
      finalText = extractFinalFromEvents(eventsPath);
      if (finalText.trim()) {
        try {
          writeFileSync(finalPath, finalText);
        } catch {
          // best-effort; finalText is still used below
        }
      }
    }
    const rawError = exitCode !== 0 && !finalText.trim() ? extractWorkerError(eventsPath) : null;
    return { engine, exitCode, finalText, rawError };
  };

  let result = await attempt(primaryEngine);

  // Quota fallback: an engine dying on usage limits is an account problem, not a task
  // problem. If the other engine's CLI is installed, replay the run there instead of
  // failing the whole execution. No env var decides this — the error class does.
  if (result.exitCode !== 0 && isQuotaError(result.rawError) && commandExists(fallbackEngine(result.engine))) {
    const nextEngine = fallbackEngine(result.engine);
    await appendFile(
      eventsPath,
      `${JSON.stringify({ type: "engine.fallback", from: result.engine, to: nextEngine, reason: String(result.rawError).slice(0, 240), at: nowIso() })}\n`,
    );
    await updateWorkerStatus(runDir, issueNumber, {
      status: "retrying",
      engineFallback: `${result.engine}→${nextEngine}`,
      error: classifyWorkerError(result.rawError),
    });
    result = await attempt(nextEngine);
  }

  const { exitCode, finalText } = result;
  const filesChanged = changedFiles(worker.worktree);
  const blocker = detectBlocker(finalText);
  let status = exitCode === 0 ? "complete" : "failed";
  if (blocker) status = "blocked";
  // A failure with no handoff: recover the real cause from the events stream
  // (e.g. "You've hit your usage limit") instead of reporting an empty failure.
  const workerError = status !== "complete" && !finalText.trim() ? classifyWorkerError(result.rawError ?? extractWorkerError(eventsPath)) : null;

  await updateWorkerStatus(runDir, issueNumber, {
    status,
    exitCode,
    finishedAt: nowIso(),
    filesChanged,
    blocker,
    error: workerError,
    latestModelSummary: finalText.trim().replace(/\s+/g, " ").slice(0, 500) || null,
  });

  if (blocker) {
    if (opts.githubStatus) {
      syncIssueStatusLabel(manifest.repo, issueNumber, "blocked");
      await commentIssue(manifest.repo, issueNumber, blockerComment(manifest.runId, worker.branch, blocker), true);
      addLabels(manifest.repo, issueNumber, ["question", "help wanted"]);
    }
    await reportExecutionBlocked(opts, blocker.question ?? blocker.reason ?? "Worker reported blocked.");
    return;
  }
  if (exitCode !== 0) {
    const reason = workerError ?? `Codex worker exited with code ${exitCode} and produced no final handoff.`;
    if (opts.githubStatus) {
      syncIssueStatusLabel(manifest.repo, issueNumber, "failed");
      await commentIssue(manifest.repo, issueNumber, finalComment(manifest.runId, issueNumber, "failed", worker.branch, finalText, null, reason), true);
    }
    // Report the real reason back so the user notification says WHY (was silent before).
    await reportExecutionBlocked(opts, reason);
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
  // 1) Authoritative structured signal: a fenced JSON block with status:blocked
  //    (the worker prompt defines this for blocking).
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
  // 2) The Final Handoff "Status:" line ONLY — anchored to the start of a line
  //    (optional leading bullet). We must NOT scan arbitrary "status:blocked"
  //    substrings: workers constantly DESCRIBE status labels in prose (e.g. "sets
  //    `status:blocked` on conflict"), which would false-block a completed task.
  //    The alternation captures the first word, so "Status: complete | blocked |
  //    failed" (the template echoed) reads as complete.
  const statusLine = text.match(/^\s*(?:[-*]\s*)?status:\s*(complete|blocked|failed)\b/im);
  if (statusLine) {
    const declared = statusLine[1].toLowerCase();
    if (declared === "blocked" || declared === "failed") {
      return {
        status: "blocked",
        reason: "worker-reported-blocked",
        question: text.match(/(?:question|decision needed):\s*(.+)/i)?.[1]?.trim() ?? "Worker reported blocked; inspect final handoff.",
        attempted: [],
        suggestedNextStep: "Inspect worker final handoff and decide how to proceed.",
      };
    }
  }
  return null;
}

// When a worker fails before writing its --output-last-message handoff (e.g. Codex
// refuses on a usage limit), the reason is ONLY in the events stream. Pull the last
// error / turn.failed message so the failure surfaces a real cause instead of the
// useless "(no final handoff captured)". (#stab fan-out traceability)
function extractWorkerError(eventsPath) {
  if (!existsSync(eventsPath)) return null;
  let raw;
  try {
    raw = readFileSync(eventsPath, "utf8");
  } catch {
    return null;
  }
  let message = null;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (ev?.type === "error" && ev.message) message = String(ev.message); // codex
    else if (ev?.type === "turn.failed" && ev.error?.message) message = String(ev.error.message); // codex
    else if (ev?.type === "system" && ev.error) message = `${ev.error}${ev.error_status ? ` (${ev.error_status})` : ""}`; // claude api_retry/billing
    else if (ev?.type === "result" && ev.is_error) message = String(ev.error || ev.result || "worker reported is_error"); // claude error result
  }
  return message;
}

// Quota/limit failures are the common operational case (an engine account is out of
// credit). Matched failures trigger the automatic engine fallback in runWorker.
const QUOTA_LIMIT_RE =
  /usage limit|quota|rate limit|rate_limit|upgrade to plus|insufficient_quota|too many requests|billing|credit balance|out of credit|\b429\b|\b402\b/i;

function isQuotaError(message) {
  return Boolean(message) && QUOTA_LIMIT_RE.test(String(message).replace(/\s+/g, " "));
}

// Turn a raw worker error into a short, actionable reason. Quota/limit failures are
// the common operational case (the user's Codex account is out of credit), so name
// them plainly with the retry hint the model already gave.
function classifyWorkerError(message) {
  if (!message) return null;
  const m = String(message).replace(/\s+/g, " ").trim();
  if (QUOTA_LIMIT_RE.test(m)) {
    return `Worker model is out of quota / credit or hit a usage limit — no work was done. Top up or wait, then re-run. Detail: ${m.slice(0, 240)}`;
  }
  return m.slice(0, 400);
}

// The opposite engine for the quota fallback. Both CLIs implement the same GitHub
// flow, so a run that died on one engine's quota can be replayed on the other.
function fallbackEngine(engine) {
  return engine === "codex" ? "claude" : "codex";
}

// --- Worker engine selection (codex CLI or Claude Code CLI, same GitHub flow) ---
// The surrounding flow (clone/branch/commit/push/PR/report) is engine-agnostic; only
// the inner "run the agent CLI, stream events, capture the final message" differs.
// Default is Claude (Sonnet 4.6); codex is opt-in via --engine codex, a gpt/o-series
// model, or ZENOD_WORKER_ENGINE=codex.
function resolveEngine(opts = {}) {
  const explicit = String(opts.engine || process.env.ZENOD_WORKER_ENGINE || "").trim().toLowerCase();
  if (explicit === "codex" || explicit === "claude") return explicit;
  const model = String(opts.model || "").toLowerCase();
  if (model && /\b(?:gpt|o3|o4|codex|openai)\b/.test(model)) return "codex";
  if (model && /\b(?:claude|sonnet|opus|haiku|fable)\b/.test(model)) return "claude";
  return "claude";
}

function resolveModel(engine, opts = {}) {
  if (opts.model) return String(opts.model);
  if (engine === "claude") return process.env.ZENOD_WORKER_MODEL || "claude-opus-4-8";
  return process.env.ZENOD_WORKER_MODEL_CODEX || null; // codex: fall back to its own config default
}

// Reasoning effort. Claude (Opus 4.8) defaults to HIGH, so we pin LOW for cheap,
// fast worker runs unless overridden (--effort, ZENOD_WORKER_EFFORT). Codex uses its
// own `thinking`/-c mechanism, so effort stays null there.
function resolveEffort(engine, opts = {}) {
  if (engine !== "claude") return opts.thinking ? String(opts.thinking) : null;
  return String(opts.effort || opts.thinking || process.env.ZENOD_WORKER_EFFORT || "low");
}

// Build the spawn command for the chosen engine. `capturesFinalToFile` says whether the
// CLI writes the final message itself (codex --output-last-message) or we must extract it
// from the event stream (claude's `result` event).
function buildWorkerSpawn({ engine, worktree, finalPath, model, thinking, effort }) {
  if (engine === "claude") {
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
    // Claude Code refuses --dangerously-skip-permissions as root unless it knows it's
    // in a sandbox. The runner is an isolated, throwaway container (root-owned, like
    // codex), so declare the sandbox escape hatch for the worker process only.
    return { bin: "claude", args, capturesFinalToFile: false, stdinPrompt: true, env: { IS_SANDBOX: "1" } };
  }
  const args = ["exec", "--json", "--cd", worktree, "--dangerously-bypass-approvals-and-sandbox", "--output-last-message", finalPath];
  if (model) args.push("--model", model);
  if (thinking) args.push("-c", `model_reasoning_effort="${thinking}"`);
  args.push("-");
  return { bin: "codex", args, capturesFinalToFile: true, stdinPrompt: true, env: {} };
}

// Claude Code has no --output-last-message; its final assistant text is the `result`
// field of the terminal `{"type":"result",...}` stream-json event. Pull the last one.
function extractFinalFromEvents(eventsPath) {
  if (!existsSync(eventsPath)) return "";
  let raw;
  try {
    raw = readFileSync(eventsPath, "utf8");
  } catch {
    return "";
  }
  let final = "";
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (ev?.type === "result" && typeof ev.result === "string") final = ev.result;
  }
  return final;
}

function executionBlockedRequest(opts, note) {
  const executionId = String(opts.executionId ?? process.env.ZENOD_EXECUTION_ID ?? "").trim();
  if (!executionId) return null;
  const secret = String(opts.execLaneSecret ?? process.env.ZENOD_EXEC_LANE_SECRET ?? "").trim();
  if (!secret) return null;
  const base = String(opts.epaminonUrl ?? process.env.ZENOD_EPAMINON_URL ?? "http://zenod-epaminon:8080").replace(/\/$/, "");
  return {
    url: `${base}/api/exec/blocked`,
    headers: { "Content-Type": "application/json", "X-Lane-Secret": secret },
    body: { execution_id: executionId, note: String(note || "Runner blocked without a detailed note.").slice(0, 1000) },
  };
}

async function reportExecutionBlocked(opts, note) {
  const request = executionBlockedRequest(opts, note);
  if (!request) return false;
  try {
    const res = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[exec-lane] Epaminon rejected blocked report for ${request.body.execution_id} (HTTP ${res.status})`);
    return res.ok;
  } catch (err) {
    console.error(`[exec-lane] blocked report failed for ${request.body.execution_id}: ${err.message}`);
    return false;
  }
}

async function commitPushPr({ opts, manifest, issueNumber, finalText }) {
  const runDir = manifest.runDir;
  const worker = manifest.workers[String(issueNumber)];
  const cwd = worker.worktree;
  const dirty = changedFiles(cwd);
  // Capture the deliverable paths BEFORE commit clears the worktree (R1-T4).
  const deliverables = deliverablePaths(dirty);
  if (dirty.length > 0) {
    run("git", ["add", "-A"], { cwd });
    const commit = run("git", ["commit", "-m", `fix #${issueNumber}: ${worker.title}`], { cwd, allowFailure: true });
    if (commit.status !== 0 && changedFiles(cwd).length > 0) {
      await controllerBlocked({
        opts,
        manifest,
        issueNumber,
        reason: `git commit failed: ${(commit.stderr || commit.stdout || "unknown error").trim().slice(0, 600)}`,
        finalText,
      });
      return;
    }
  }
  const ahead = run("git", ["rev-list", "--count", `origin/${manifest.base}..HEAD`], { cwd, allowFailure: true }).stdout.trim();
  const hasCommits = Number(ahead) > 0;
  if (!hasCommits) {
    await updateWorkerStatus(runDir, issueNumber, { status: "complete", error: "No commits produced" });
    if (opts.githubStatus) {
      syncIssueStatusLabel(manifest.repo, issueNumber, "complete");
      await commentIssue(manifest.repo, issueNumber, finalComment(manifest.runId, issueNumber, "complete-no-commits", worker.branch, finalText, null, null, deliverables), true);
    }
    return;
  }
  if (opts.noPush || !opts.draftPr) {
    if (opts.githubStatus) {
      syncIssueStatusLabel(manifest.repo, issueNumber, "complete", { hasReviewableWork: true });
      await commentIssue(manifest.repo, issueNumber, finalComment(manifest.runId, issueNumber, "complete-local", worker.branch, finalText, null, null, deliverables), true);
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
  // C-20: open the PR READY by default so GitHub auto-merge can land it on green
  // (a draft can never merge — that's what stranded #246/#247/#249). Only when the
  // controller opted into HOLD-FOR-REVIEW do we open a draft and skip auto-merge.
  const hold = manifest.options?.holdForReview === true;
  const prArgs = buildPrCreateArgs({
    repo: manifest.repo,
    base: manifest.base,
    branch: worker.branch,
    title: `Fix #${issueNumber}: ${worker.title}`,
    bodyPath,
    hold,
  });
  const pr = run("gh", prArgs, { cwd, allowFailure: true });
  const prUrl = (pr.stdout + pr.stderr).match(/https:\/\/github\.com\/\S+\/pull\/\d+/)?.[0] ?? null;
  if (!prUrl) {
    await controllerBlocked({
      opts,
      manifest,
      issueNumber,
      reason: `PR creation failed: ${(pr.stderr || pr.stdout || "no PR URL returned").trim().slice(0, 800)}`,
      finalText,
    });
    return;
  }
  // CONTROLLER enforces merge-by-default: enable GitHub auto-merge (merges on green,
  // never on red). Works on both zenod-ai/zenod (branch-protected) and
  // AlfaBlok/obsidian-brain (may have no protection — `--auto` still applies, or the
  // merge lands immediately when there are no required checks). Deterministic — no LLM.
  const autoMerge = enableAutoMergeForPr(prUrl, { hold });
  console.error(`[fanout] auto-merge ${autoMerge.outcome} for #${issueNumber}: ${autoMerge.detail}`);
  // Deliverables summary: derive the real changed paths from the PR itself so it never
  // says "Deliverables: none" for a PR that has committed files (the worker may have
  // committed, clearing the worktree that `dirty` was read from — the 3-file "none" bug).
  // Fall back to the dirty capture; only "none" when there genuinely are no files.
  const prFiles = prChangedFiles(manifest.repo, prUrl);
  const deliverablesForComment = prFiles.length ? prFiles : deliverables;
  await updateWorkerStatus(runDir, issueNumber, {
    status: "complete",
    prUrl,
    autoMerge: autoMerge.outcome,
    filesChanged: deliverablesForComment,
  });
  if (opts.githubStatus) {
    syncIssueStatusLabel(manifest.repo, issueNumber, "complete", { hasReviewableWork: true });
    await commentIssue(manifest.repo, issueNumber, finalComment(manifest.runId, issueNumber, "complete", worker.branch, finalText, prUrl, null, deliverablesForComment), true);
  }
}

// CONTROLLER-observed deliverables: the file paths actually in a PR, read from GitHub
// via `gh pr diff --name-only` (never worker self-report). Returns [] on any failure so
// callers fall back to the worktree dirty-file capture rather than fabricating paths.
// `runner` is injectable for tests (defaults to the real `gh` via run()).
function prChangedFiles(repo, prUrl, { runner } = {}) {
  if (!prUrl) return [];
  const exec = runner || ((args) => run("gh", args, { allowFailure: true }));
  const r = exec(["pr", "diff", prUrl, "--repo", repo, "--name-only"]);
  if (r.status !== 0) return [];
  return String(r.stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

// PURE: build the `gh pr create` argv. C-20 — open READY by default (no --draft) so
// auto-merge can land the PR on green; only a HOLD-FOR-REVIEW opt-out adds --draft.
function buildPrCreateArgs({ repo, base, branch, title, bodyPath, hold = false }) {
  const args = [
    "pr",
    "create",
    "--repo",
    repo,
    "--base",
    base,
    "--head",
    branch,
    "--title",
    title,
    "--body-file",
    bodyPath,
  ];
  if (hold) args.push("--draft");
  return args;
}

async function controllerBlocked({ opts, manifest, issueNumber, reason, finalText }) {
  const worker = manifest.workers[String(issueNumber)];
  const blocker = {
    status: "blocked",
    reason: "controller-failed",
    question: reason,
    attempted: ["worker completed", "controller tried to commit/push/open PR"],
    suggestedNextStep: "Inspect the runner controller error, fix the environment or repo mapping, then rerun the ticket.",
  };
  await updateWorkerStatus(manifest.runDir, issueNumber, {
    status: "blocked",
    finishedAt: nowIso(),
    blocker,
    error: reason,
  });
  if (opts.githubStatus) {
    syncIssueStatusLabel(manifest.repo, issueNumber, "blocked");
    await commentIssue(manifest.repo, issueNumber, finalComment(manifest.runId, issueNumber, "controller-blocked", worker.branch, finalText), true);
    await commentIssue(manifest.repo, issueNumber, blockerComment(manifest.runId, worker.branch, blocker), true);
  }
  await reportExecutionBlocked(opts, reason);
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

// PURE: normalize `git status --short` lines to clean deliverable paths (R1-T4).
// Strips the 2-char XY status code + separating space (the real porcelain format), and
// resolves rename arrows ("R  old -> new" keeps new). The prefix is only removed when it
// matches the exact `XY ` shape, so an already-clean path (e.g. from `gh pr diff
// --name-only`, no leading code) like "README.md" is passed through untouched — the old
// greedy `^[A-Z]{1,3}` prefix wrongly ate "REA" out of such paths.
function deliverablePaths(statusLines) {
  const out = [];
  for (const raw of statusLines || []) {
    let s = String(raw).replace(/^[ MADRCU?!]{2} /, "").trim();
    const arrow = s.split(" -> ");
    s = (arrow.length > 1 ? arrow[arrow.length - 1] : s).replace(/^"|"$/g, "").trim();
    if (s) out.push(s);
  }
  return out;
}

// PURE: render a stable, machine-parseable Deliverables block for the reportback
// (R1-T4) — the deterministic source the monitor parses into the manifest. A run
// with no file changes emits "Deliverables: none".
function deliverablesBlock(paths) {
  const list = deliverablePaths(paths);
  if (!list.length) return "Deliverables: none";
  return ["Deliverables:", ...list.map((p) => `- ${p}`)].join("\n");
}

function finalComment(runIdValue, issueNumber, status, branch, finalText, prUrl = null, errorText = null, files = []) {
  const excerpt = finalText.trim().slice(0, 3000) || (errorText ? `Worker error: ${errorText}` : "(no final handoff captured)");
  return [
    `Fan-out run \`${runIdValue}\` finished for #${issueNumber}.`,
    "",
    `Status: \`${status}\``,
    `Branch: \`${branch}\``,
    prUrl ? `PR: ${prUrl}` : "",
    "",
    deliverablesBlock(files),
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
  const executionId = String(opts.executionId ?? process.env.ZENOD_EXECUTION_ID ?? "").trim();
  const executionContext = String(opts.executionContext ?? process.env.ZENOD_EXECUTION_CONTEXT ?? "").trim();
  const execLane = Boolean(executionId);
  const goal = executionContext && !opts.goal && !opts.goalFile ? `GOAL: Execute Epaminon-dispatched work.\n\n${executionContext}` : resolveGoal(opts, issues);

  const engine = resolveEngine(opts);
  const model = resolveModel(engine, opts);
  const effort = resolveEffort(engine, opts);
  verifyPrereqs({ allowNode18: opts.dryRun, engine });
  if (opts.githubStatus) ensureIssueStatusLabels(opts.repo);
  await ensureCheckout(opts.repo, workdir, base);
  await mkdir(thisRunDir, { recursive: true });

  const manifest = {
    runId: id,
    repo: opts.repo,
    base,
    workdir,
    runDir: thisRunDir,
    goal,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    options: {
      draftPr: Boolean(opts.draftPr),
      githubStatus: Boolean(opts.githubStatus),
      dryRun: Boolean(opts.dryRun),
      noPush: Boolean(opts.noPush),
      concurrency,
      goalSupplied: Boolean(opts.goal || opts.goalFile),
      execLane,
      executionId: executionId || null,
      // CONTROLLER opt-out for merge-by-default (C-20): a HOLD-FOR-REVIEW / noAutoMerge
      // marker anywhere in the goal or execution context leaves fan-out PRs as drafts
      // with no auto-merge. Same deterministic signal as the ephemeral lane (#480).
      holdForReview: wantsHoldForReview(`${goal}\n${executionContext}`),
      engine,
      model: model ?? null,
      effort: effort ?? null,
      thinking: opts.thinking ?? null,
    },
    workers: {},
  };
  await writeFile(join(thisRunDir, "goal.md"), `${manifest.goal}\n`);

  for (const number of issues) {
    const issue = fetchIssue(opts.repo, number);
    const clarity = clarityCheck(issue, { execLane, executionContext });
    const branch = branchName(issue, id);
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
      await reportExecutionBlocked(opts, status.blocker.question);
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
  detectBlocker,
  clarityCheck,
  executionBlockedRequest,
  remoteMatchesRepo,
  resetBaseCheckout,
  branchName,
  extractWorkerError,
  classifyWorkerError,
  isQuotaError,
  fallbackEngine,
  finalComment,
  deliverablePaths,
  deliverablesBlock,
  buildPrCreateArgs,
  prChangedFiles,
  resolveEngine,
  resolveModel,
  resolveEffort,
  buildWorkerSpawn,
  extractFinalFromEvents,
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
