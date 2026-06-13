#!/usr/bin/env node
// Backlog monitor (#27) — the single process that runs the chat-trigger loop.
//
// Architecture: GitHub is the queue + state + comms surface. Zenod agents can
// create and label proposed tickets, but only a human applies `status:queued`.
// THIS monitor — running
// in the EXTERNAL agent-runner container, never killed by an app redeploy —
// reacts to label state with three motions:
//
//   1. LAUNCH  : owner:agent + status:queued  -> launch Codex via fanout
//                (the fanout flips queued -> running and opens draft PRs).
//   2. FAN-IN  : a multi-issue fanout batch reaching needs-review -> launch
//                one N+1 integration worker over every completed branch.
//   3. OUTCOME : status:needs-review | status:blocked -> ping the owner on
//                WhatsApp (via the app's /api/notify) with the PR / the
//                blocking question. Each issue is pinged once per state.
//
// Trigger model is poke + poll: a tiny HTTP listener gives an instant refresh
// (POST /poke), and a slow poll underneath guarantees nothing is ever missed
// (e.g. a human labelling an issue `queued` straight in GitHub).
//
// Config via env:
//   ZENOD_REPO        default zenod-ai/zenod
//   ZENOD_WORKDIR     default /runner/work/zenod
//   ZENOD_APP_URL     e.g. https://app.zenod.dev   (for /api/notify)
//   ZENOD_API_TOKEN   the app's bearer token       (for /api/notify)
//   ZENOD_POLL_MS     default 120000
//   ZENOD_POKE_PORT   default 8787
//   ZENOD_CONCURRENCY default 3
//   ZENOD_STATE       default <workdir>/.fanout/monitor-state.json
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const REPO = process.env.ZENOD_REPO || "zenod-ai/zenod";
const WORKDIR = process.env.ZENOD_WORKDIR || "/runner/work/zenod";
const APP_URL = (process.env.ZENOD_APP_URL || "").replace(/\/$/, "");
const API_TOKEN = process.env.ZENOD_API_TOKEN || "";
const POLL_MS = Number(process.env.ZENOD_POLL_MS || 120000);
const POKE_PORT = Number(process.env.ZENOD_POKE_PORT || 8787);
const CONCURRENCY = Number(process.env.ZENOD_CONCURRENCY || 3);
const STATE_PATH = process.env.ZENOD_STATE || `${WORKDIR}/.fanout/monitor-state.json`;
const BASE_BRANCH = process.env.ZENOD_BASE || "main";

function log(...a) {
  console.log(new Date().toISOString(), "[monitor]", ...a);
}

function gh(args) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`gh ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function loadState() {
  try {
    return normalizeState(JSON.parse(readFileSync(STATE_PATH, "utf8")));
  } catch {
    return normalizeState({});
  }
}
function normalizeState(state) {
  return {
    launched: state?.launched ?? {}, // issue -> true
    notified: state?.notified ?? {}, // issue -> last-status
    fanInBatches: state?.fanInBatches ?? {}, // batch key -> integration status
  };
}
function saveState(s) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

// owner:agent issues with their current status:* label.
function listAgentIssues() {
  const out = gh([
    "issue", "list", "--repo", REPO, "--state", "open",
    "--label", "owner:agent", "--limit", "100",
    "--json", "number,title,labels,url",
  ]);
  return JSON.parse(out).map((i) => ({
    number: i.number,
    title: i.title,
    url: i.url,
    status: (i.labels || []).map((l) => l.name).find((n) => n.startsWith("status:")) || null,
  }));
}

async function notify(text) {
  if (!APP_URL || !API_TOKEN) {
    log("NOTIFY (no app configured):", text);
    return;
  }
  try {
    const res = await fetch(`${APP_URL}/api/notify`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${API_TOKEN}` },
      body: JSON.stringify({ text }),
    });
    log("notify ->", res.status, text.slice(0, 60));
  } catch (e) {
    log("notify FAILED:", e.message);
  }
}

function latestComment(number) {
  try {
    const out = gh(["issue", "view", String(number), "--repo", REPO, "--json", "comments"]);
    const comments = JSON.parse(out).comments || [];
    return comments.length ? comments[comments.length - 1].body : "";
  } catch {
    return "";
  }
}

function prUrlForIssue(number) {
  try {
    const out = gh(["pr", "list", "--repo", REPO, "--state", "open", "--json", "url,headRefName", "--limit", "100"]);
    const pr = JSON.parse(out).find((p) => p.headRefName.includes(`issue-${number}-`));
    return pr ? pr.url : "";
  } catch {
    return "";
  }
}

function prForIssue(number) {
  try {
    const out = gh(["pr", "list", "--repo", REPO, "--state", "open", "--json", "url,headRefName,title", "--limit", "100"]);
    return JSON.parse(out).find((p) => p.headRefName.includes(`issue-${number}-`)) ?? null;
  } catch {
    return null;
  }
}

function batchKey(numbers) {
  return [...numbers].sort((a, b) => a - b).join("-");
}

function activeFanInBatchForIssue(state, number) {
  return Object.values(state.fanInBatches ?? {}).find(
    (batch) =>
      batch.issues?.includes(number) &&
      !["complete", "blocked", "failed"].includes(batch.status),
  );
}

function reviewHeldByFanInBatch(state, number) {
  return Object.values(state.fanInBatches ?? {}).some(
    (batch) => batch.issues?.includes(number) && !["blocked", "failed"].includes(batch.status),
  );
}

function ensureFanInBatch(state, numbers) {
  if (numbers.length <= 1) return null;
  const key = batchKey(numbers);
  const existing = state.fanInBatches[key];
  if (existing && !["blocked", "failed"].includes(existing.status)) return existing;
  const batch = {
    key,
    issues: [...numbers].sort((a, b) => a - b),
    status: "waiting",
    createdAt: new Date().toISOString(),
    integrationBranch: `codex/integration-fanout-${key}`,
    integrationWorktree: `${WORKDIR}/.fanout/worktrees/integration-fanout-${key}`,
    promptPath: `${WORKDIR}/.fanout/integration-fanout-${key}.prompt.md`,
    finalPath: `${WORKDIR}/.fanout/integration-fanout-${key}.final.md`,
    eventsPath: `${WORKDIR}/.fanout/integration-fanout-${key}.events.jsonl`,
  };
  state.fanInBatches[key] = batch;
  return batch;
}

function launch(numbers) {
  const args = [
    "start", "--repo", REPO, "--issues", numbers.join(","),
    "--workdir", WORKDIR,
    // --draft-pr: push branch + open draft PR. --github-status: flip the
    // issue's status:* labels (queued→running→needs-review/blocked) — the
    // monitor's outcome motion reads those labels, so this is required.
    "--draft-pr", "--github-status",
    "--concurrency", String(CONCURRENCY),
  ];
  // Detached: the fanout run is long; the monitor must stay responsive.
  const child = spawn("zenod-fanout-codex", args, { stdio: "ignore", detached: true });
  child.unref();
  log("launched fanout for", numbers.join(", "));
}

function integrationPrompt(batch, branchRefs) {
  const branchLines = branchRefs
    .map((ref) => `- #${ref.issue} ${ref.title}: branch \`${ref.branch}\`${ref.prUrl ? `, PR ${ref.prUrl}` : ""}`)
    .join("\n");
  return `
You are the N+1 fan-in Codex integration worker for a Zenod fan-out batch.

Repository: ${REPO}
Base branch: ${BASE_BRANCH}
Working branch: ${batch.integrationBranch}
Worktree: ${batch.integrationWorktree}
Batch key: ${batch.key}
Issues in scope: ${batch.issues.map((n) => `#${n}`).join(", ")}

Goal:
Merge every completed issue branch in this batch into one integration branch, resolve textual conflicts, detect semantic conflicts by running the combined build/typecheck/test suite, and leave one draft-ready integration result.

Branches to integrate, in deterministic issue-number order:
${branchLines}

Hard rules:
- Do not drop, skip, squash away, or silently ignore any listed branch.
- Merge branches in the exact order listed above.
- If a branch cannot be found, stop and report blocked with the missing branch.
- Resolve textual conflicts explicitly and list the files touched.
- Treat build, typecheck, and test failures after clean textual merges as semantic conflicts unless clearly unrelated infrastructure failure.
- Do not push, open a PR, merge to main, or close issues. The controller handles fan-in publication.
- Keep changes limited to integration conflict resolution and minimal test updates needed for combined behavior.
- Commit the resolved integration result locally if validation is acceptable.

Validation:
- Run \`npm run build\`.
- Run \`npm run typecheck\`.
- Run \`npm run test\`.
- If a full command cannot complete, run the most relevant narrower commands and explain exactly why.

Final response requirements:
- Status: complete | blocked | failed
- Integrated branches and merge order
- Textual conflicts found/resolved
- Semantic conflicts found/resolved or a human decision request
- Files changed for integration
- Tests run, with exact commands and outcomes
- Residual risk
- Suggested integration PR title/body if complete

Blocking protocol:
If blocked, include:
\`\`\`json
{
  "status": "blocked",
  "reason": "textual-conflict|semantic-conflict|missing-branch|needs-human-decision",
  "question": "Specific decision needed",
  "attempted": ["what you inspected or tried"],
  "suggestedNextStep": "Concrete next step"
}
\`\`\`
`.trim();
}

function prepareIntegrationWorktree(batch) {
  rmSync(batch.integrationWorktree, { recursive: true, force: true });
  gh(["repo", "view", REPO, "--json", "nameWithOwner"]);
  spawnSync("git", ["fetch", "origin", BASE_BRANCH], { cwd: WORKDIR, stdio: "ignore" });
  spawnSync("git", ["branch", "-D", batch.integrationBranch], { cwd: WORKDIR, stdio: "ignore" });
  const result = spawnSync("git", ["worktree", "add", "-b", batch.integrationBranch, batch.integrationWorktree, `origin/${BASE_BRANCH}`], {
    cwd: WORKDIR,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git worktree add failed: ${result.stderr || result.stdout}`);
}

function branchRefsForBatch(batch, issuesByNumber) {
  return batch.issues.map((number) => {
    const pr = prForIssue(number);
    const issue = issuesByNumber.get(number);
    return {
      issue: number,
      title: issue?.title ?? `Issue ${number}`,
      branch: pr?.headRefName ?? "",
      prUrl: pr?.url ?? "",
    };
  });
}

function launchIntegration(batch, issuesByNumber) {
  const branchRefs = branchRefsForBatch(batch, issuesByNumber);
  const missing = branchRefs.filter((ref) => !ref.branch);
  if (missing.length) {
    batch.status = "blocked";
    batch.blocker = `Missing PR branch for ${missing.map((ref) => `#${ref.issue}`).join(", ")}`;
    batch.updatedAt = new Date().toISOString();
    log("fan-in blocked:", batch.blocker);
    return false;
  }

  mkdirSync(dirname(batch.promptPath), { recursive: true });
  prepareIntegrationWorktree(batch);
  writeFileSync(batch.promptPath, `${integrationPrompt(batch, branchRefs)}\n`);
  const args = [
    "exec",
    "--json",
    "--cd",
    batch.integrationWorktree,
    "--dangerously-bypass-approvals-and-sandbox",
    "--output-last-message",
    batch.finalPath,
    "-",
  ];
  const child = spawn("codex", args, { cwd: batch.integrationWorktree, stdio: ["pipe", "ignore", "ignore"], detached: true });
  child.stdin.end(readFileSync(batch.promptPath, "utf8"));
  child.unref();
  batch.status = "running";
  batch.pid = child.pid;
  batch.startedAt = new Date().toISOString();
  batch.updatedAt = batch.startedAt;
  log("launched fan-in for", batch.issues.map((n) => `#${n}`).join(", "), "on", batch.integrationBranch);
  return true;
}

function detectIntegrationStatus(finalText) {
  if (!finalText) return null;
  const blocker = finalText.match(/```json\s*([\s\S]*?)```/i);
  if (blocker) {
    try {
      const parsed = JSON.parse(blocker[1]);
      if (parsed?.status === "blocked") return "blocked";
    } catch {
      // Fall back to text matching below.
    }
  }
  if (/status:\s*blocked|\"status\"\s*:\s*\"blocked\"/i.test(finalText)) return "blocked";
  if (/status:\s*failed|\"status\"\s*:\s*\"failed\"/i.test(finalText)) return "failed";
  if (/status:\s*complete|\"status\"\s*:\s*\"complete\"/i.test(finalText)) return "complete";
  return "complete";
}

function updateFanInBatches(state, issues, options = {}) {
  const launcher = options.launchIntegration ?? launchIntegration;
  const issuesByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  for (const batch of Object.values(state.fanInBatches ?? {})) {
    if (batch.status === "running" && batch.finalPath && existsSync(batch.finalPath)) {
      const finalText = readFileSync(batch.finalPath, "utf8");
      batch.status = detectIntegrationStatus(finalText);
      batch.finishedAt = new Date().toISOString();
      batch.updatedAt = batch.finishedAt;
      batch.summary = finalText.trim().replace(/\s+/g, " ").slice(0, 500);
      continue;
    }
    if (batch.status !== "waiting") continue;
    const statuses = batch.issues.map((number) => issuesByNumber.get(number)?.status);
    if (statuses.some((status) => status === "status:blocked")) {
      batch.status = "blocked";
      batch.blocker = "One or more fan-out workers is blocked.";
      batch.updatedAt = new Date().toISOString();
    } else if (statuses.every((status) => status === "status:needs-review" || status === "status:complete")) {
      launcher(batch, issuesByNumber);
    }
  }
}

let scanning = false;
async function scan(reason) {
  if (scanning) return;
  scanning = true;
  try {
    const state = loadState();
    const issues = listAgentIssues();

    // 1. LAUNCH motion
    const toLaunch = issues
      .filter((i) => i.status === "status:queued" && !state.launched[i.number])
      .map((i) => i.number);
    if (toLaunch.length) {
      launch(toLaunch);
      for (const n of toLaunch) state.launched[n] = true;
      ensureFanInBatch(state, toLaunch);
      await notify(`🚀 Zenod queued Codex on ${toLaunch.map((n) => `#${n}`).join(", ")}. I'll message you when each lands.`);
    }

    updateFanInBatches(state, issues);

    // 2. OUTCOME motion — ping once per terminal state.
    for (const i of issues) {
      if (i.status === "status:needs-review" && state.notified[i.number] !== "needs-review") {
        if (reviewHeldByFanInBatch(state, i.number)) continue;
        const pr = prUrlForIssue(i.number);
        await notify(`✅ #${i.number} ${i.title} — ready for review${pr ? `: ${pr}` : "."}`);
        state.notified[i.number] = "needs-review";
        delete state.launched[i.number];
      } else if (i.status === "status:blocked" && state.notified[i.number] !== "blocked") {
        const q = latestComment(i.number).slice(0, 280);
        await notify(`⛔ #${i.number} ${i.title} — blocked, needs your decision${q ? `:\n${q}` : "."}`);
        state.notified[i.number] = "blocked";
        delete state.launched[i.number];
      } else if (i.status === "status:queued" && state.notified[i.number]) {
        // Re-queued after a block/review — allow it to notify again next time.
        delete state.notified[i.number];
      }
    }

    for (const batch of Object.values(state.fanInBatches ?? {})) {
      if (batch.status === "complete" && state.notified[`fan-in:${batch.key}`] !== "complete") {
        await notify(`✅ Fan-in ${batch.key} — integration pass complete on \`${batch.integrationBranch}\`.`);
        state.notified[`fan-in:${batch.key}`] = "complete";
      } else if (["blocked", "failed"].includes(batch.status) && state.notified[`fan-in:${batch.key}`] !== batch.status) {
        await notify(`⛔ Fan-in ${batch.key} — ${batch.status}${batch.blocker ? `: ${batch.blocker}` : ". Inspect the integration final handoff."}`);
        state.notified[`fan-in:${batch.key}`] = batch.status;
      }
    }

    saveState(state);
    log(`scan (${reason}): ${issues.length} agent issues, launched ${toLaunch.length}`);
  } catch (e) {
    log("scan error:", e.message);
  } finally {
    scanning = false;
  }
}

function main() {
  // Poke endpoint — workers (and Zenod) hit POST /poke for an instant refresh.
  createServer((req, res) => {
    if (req.method === "POST" && req.url === "/poke") {
      res.writeHead(202).end("scanning\n");
      void scan("poke");
    } else if (req.url === "/health") {
      res.writeHead(200).end("ok\n");
    } else {
      res.writeHead(404).end();
    }
  }).listen(POKE_PORT, () => log(`poke listener on :${POKE_PORT}`));

  log(`starting — repo=${REPO} poll=${POLL_MS}ms app=${APP_URL || "(none)"}`);
  void scan("startup");
  setInterval(() => void scan("poll"), POLL_MS);
}

export {
  activeFanInBatchForIssue,
  batchKey,
  ensureFanInBatch,
  integrationPrompt,
  normalizeState,
  detectIntegrationStatus,
  reviewHeldByFanInBatch,
  updateFanInBatches,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
