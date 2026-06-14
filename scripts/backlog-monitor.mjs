#!/usr/bin/env node
// Backlog monitor — the chat-trigger loop over the CENTRAL backlog (#61).
//
// The central backlog lives on Zenod's own repo (obsidian-brain). Zenod writes
// ONLY there. This monitor (external agent-runner, never killed by an app
// redeploy) watches the central backlog and BRIDGES each queued ticket to its
// `target:` repo, where Codex actually works the code:
//
//   LAUNCH  : central owner:agent + status:queued -> materialize an execution
//             issue on the ticket's target repo, run the fanout there, flip the
//             central ticket to status:running.
//   OUTCOME : the execution issue reaches needs-review/blocked -> mirror that
//             onto the central ticket and ping the owner (PR link / question).
//
// Zenod never touches the target repo; only Codex (broad VPS access) does.
// Trigger model: poke (POST /poke) + poll.
//
// Config via env:
//   ZENOD_BACKLOG_REPO  the CENTRAL backlog repo (default AlfaBlok/obsidian-brain)
//   ZENOD_REPO          default target repo for code work + fan-in (default zenod-ai/zenod)
//   ZENOD_WORKDIR       the target-repo checkout for the fanout (default /runner/work/zenod)
//   ZENOD_APP_URL / ZENOD_API_TOKEN   for /api/notify
//   ZENOD_POLL_MS / ZENOD_POKE_PORT / ZENOD_CONCURRENCY / ZENOD_STATE / ZENOD_BASE
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const BACKLOG = process.env.ZENOD_BACKLOG_REPO || "AlfaBlok/obsidian-brain";
const REPO = process.env.ZENOD_REPO || "zenod-ai/zenod"; // default target repo + fan-in repo
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
    launched: state?.launched ?? {},
    notified: state?.notified ?? {},
    fanInBatches: state?.fanInBatches ?? {},
    bridges: state?.bridges ?? {}, // central # -> { target, exec, mirrored }
  };
}
function saveState(s) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
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

// ---- central backlog (obsidian-brain) ----

// owner:agent central issues with their status + target repo.
function listCentralIssues() {
  const out = gh([
    "issue", "list", "--repo", BACKLOG, "--state", "open",
    "--label", "owner:agent", "--limit", "100",
    "--json", "number,title,labels,url,body",
  ]);
  return JSON.parse(out).map((i) => {
    const names = (i.labels || []).map((l) => l.name);
    const target = names.find((n) => n.startsWith("target:"));
    return {
      number: i.number,
      title: i.title,
      url: i.url,
      body: i.body || "",
      status: names.find((n) => n.startsWith("status:")) || null,
      target: target ? target.slice("target:".length) : REPO,
    };
  });
}

function setCentralStatus(number, from, to) {
  try {
    if (from) gh(["issue", "edit", String(number), "--repo", BACKLOG, "--remove-label", from]);
    gh(["issue", "edit", String(number), "--repo", BACKLOG, "--add-label", to]);
  } catch (e) {
    log(`setCentralStatus #${number} -> ${to} failed:`, e.message);
  }
}

// Materialize the central ticket as an execution issue on its target repo.
function materializeExec(central) {
  const body = [
    `_Execution copy of central backlog item ${central.url} — the central ticket is the source of truth._`,
    "",
    central.body,
  ].join("\n");
  const out = gh([
    "issue", "create", "--repo", central.target,
    "--title", `[central #${central.number}] ${central.title}`,
    "--body", body, "--label", "owner:agent,status:queued",
  ]);
  const m = out.match(/\/issues\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function launchFanout(target, execNumber) {
  const args = [
    "start", "--repo", target, "--issues", String(execNumber),
    "--workdir", WORKDIR, "--draft-pr", "--github-status",
    "--concurrency", String(CONCURRENCY),
  ];
  const child = spawn("zenod-fanout-codex", args, { stdio: "ignore", detached: true });
  child.unref();
  log(`launched fanout for ${target}#${execNumber}`);
}

function execStatusAndComment(target, execNumber) {
  try {
    const out = gh(["issue", "view", String(execNumber), "--repo", target, "--json", "labels,comments"]);
    const o = JSON.parse(out);
    const status = (o.labels || []).map((l) => l.name).find((n) => n.startsWith("status:")) || null;
    const comments = o.comments || [];
    return { status, lastComment: comments.length ? comments[comments.length - 1].body : "" };
  } catch {
    return { status: null, lastComment: "" };
  }
}

function prUrlForExec(target, execNumber) {
  try {
    const out = gh(["pr", "list", "--repo", target, "--state", "open", "--json", "url,headRefName", "--limit", "100"]);
    const pr = JSON.parse(out).find((p) => p.headRefName.includes(`issue-${execNumber}-`));
    return pr ? pr.url : "";
  } catch {
    return "";
  }
}

// ---- fan-in (#41), preserved for re-integration in the central model ----

function latestComment(number, repo = REPO) {
  try {
    const out = gh(["issue", "view", String(number), "--repo", repo, "--json", "comments"]);
    const comments = JSON.parse(out).comments || [];
    return comments.length ? comments[comments.length - 1].body : "";
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
    (batch) => batch.issues?.includes(number) && !["complete", "blocked", "failed"].includes(batch.status),
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
    "exec", "--json", "--cd", batch.integrationWorktree,
    "--dangerously-bypass-approvals-and-sandbox", "--output-last-message", batch.finalPath, "-",
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
  if (/status:\s*blocked|"status"\s*:\s*"blocked"/i.test(finalText)) return "blocked";
  if (/status:\s*failed|"status"\s*:\s*"failed"/i.test(finalText)) return "failed";
  if (/status:\s*complete|"status"\s*:\s*"complete"/i.test(finalText)) return "complete";
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

// ---- main loop: the central-backlog bridge ----

let scanning = false;
async function scan(reason) {
  if (scanning) return;
  scanning = true;
  try {
    const state = loadState();
    const issues = listCentralIssues();

    // LAUNCH: a queued central ticket -> materialize on its target repo + run Codex.
    let launched = 0;
    for (const c of issues) {
      if (c.status === "status:queued" && !state.bridges[c.number]) {
        const exec = materializeExec(c);
        if (!exec) {
          log(`materialize failed for central #${c.number}`);
          continue;
        }
        launchFanout(c.target, exec);
        setCentralStatus(c.number, "status:queued", "status:running");
        state.bridges[c.number] = { target: c.target, exec, mirrored: null };
        launched++;
        await notify(`🚀 Queued Codex on #${c.number} ${c.title} (working ${c.target}). I'll message you when it lands.`);
      }
    }

    // OUTCOME: mirror the execution issue's terminal state back to the central ticket.
    for (const c of issues) {
      const bridge = state.bridges[c.number];
      if (!bridge || bridge.mirrored) continue;
      const es = execStatusAndComment(bridge.target, bridge.exec);
      if (es.status === "status:needs-review") {
        const pr = prUrlForExec(bridge.target, bridge.exec);
        setCentralStatus(c.number, "status:running", "status:needs-review");
        await notify(`✅ #${c.number} ${c.title} — ready for review${pr ? `: ${pr}` : "."}`);
        bridge.mirrored = "needs-review";
      } else if (es.status === "status:blocked") {
        const q = (es.lastComment || "").slice(0, 280);
        setCentralStatus(c.number, "status:running", "status:blocked");
        if (q) {
          try {
            gh(["issue", "comment", String(c.number), "--repo", BACKLOG, "--body", `Blocked (execution ${bridge.target}#${bridge.exec}):\n\n${q}`]);
          } catch {
            // best-effort
          }
        }
        await notify(`⛔ #${c.number} ${c.title} — blocked, needs your decision${q ? `:\n${q}` : "."}`);
        bridge.mirrored = "blocked";
      }
    }

    // Re-queued after a review/block -> let it run again.
    for (const c of issues) {
      if (c.status === "status:queued" && state.bridges[c.number]?.mirrored) {
        delete state.bridges[c.number];
      }
    }

    saveState(state);
    log(`scan (${reason}): ${issues.length} central issues, launched ${launched}`);
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

  log(`starting — backlog=${BACKLOG} target_default=${REPO} poll=${POLL_MS}ms app=${APP_URL || "(none)"}`);
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
  latestComment,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
