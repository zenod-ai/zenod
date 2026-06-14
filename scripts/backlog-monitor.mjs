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

function pickupNotification(central) {
  return `🤖 Codex working on #${central.number} — ${central.title} (${central.target})`;
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

// Idempotently ensure a label exists in the repo (gh edit --add-label fails on a
// label the repo doesn't have yet — e.g. status:merged on first use).
function ensureLabel(repo, name) {
  try {
    gh(["label", "create", name, "--repo", repo, "--force"]);
  } catch (e) {
    log(`ensureLabel ${name} on ${repo} (ignored):`, e.message);
  }
}

function setCentralStatus(number, from, to) {
  // Remove is best-effort: it must not block the add if the old label is absent.
  if (from) {
    try {
      gh(["issue", "edit", String(number), "--repo", BACKLOG, "--remove-label", from]);
    } catch (e) {
      log(`setCentralStatus #${number} remove ${from} (ignored):`, e.message);
    }
  }
  ensureLabel(BACKLOG, to);
  try {
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

// Synchronous spawnability probe for the fanout launcher. Only spawn-level errors
// (ENOENT/EACCES) populate probe.error; a nonzero exit does not. We check this ONCE
// per scan before materializing any exec issue, so a broken launcher never crashes the
// monitor and never leaks orphan exec issues.
function launcherHealthy() {
  const probe = spawnSync("zenod-fanout-codex", ["status", "--run", "__preflight__", "--workdir", WORKDIR], {
    stdio: "ignore",
    timeout: 10000,
  });
  if (probe.error) {
    log(`fanout launcher not spawnable: ${probe.error.code || probe.error.message} — skipping launch motion this scan`);
    return false;
  }
  return true;
}

function launchFanout(target, execNumber) {
  const args = [
    "start", "--repo", target, "--issues", String(execNumber),
    "--workdir", WORKDIR, "--draft-pr", "--github-status",
    "--concurrency", String(CONCURRENCY),
  ];
  const child = spawn("zenod-fanout-codex", args, { stdio: "ignore", detached: true });
  // Belt-and-suspenders: catch any late async spawn error so it can never become an
  // unhandled 'error' event that crashes the whole monitor.
  child.on("error", (err) => log(`fanout spawn error (post-probe) for ${target}#${execNumber}: ${err.code || err.message}`));
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

// Recover the execution issue number for a central ticket from its [central #N]
// title — the bridge state is the fast path; this is the durable fallback when
// the monitor was restarted and lost its in-memory map.
function execForCentral(target, centralNumber) {
  try {
    const out = gh([
      "issue", "list", "--repo", target, "--state", "all",
      "--search", `[central #${centralNumber}] in:title`, "--json", "number,title", "--limit", "30",
    ]);
    const found = JSON.parse(out).find((i) => i.title.startsWith(`[central #${centralNumber}]`));
    return found ? found.number : null;
  } catch {
    return null;
  }
}

// PR merge readiness: open/merged state, CI rollup (pending/failed), mergeability.
function prMergeReadiness(target, prNumber) {
  try {
    const out = gh(["pr", "view", String(prNumber), "--repo", target, "--json", "state,mergeable,statusCheckRollup"]);
    const o = JSON.parse(out);
    const checks = o.statusCheckRollup || [];
    const norm = checks.map((c) => String(c.conclusion || c.state || c.status || "").toUpperCase());
    const PENDING = new Set(["", "PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "WAITING", "REQUESTED", "ACTION_REQUIRED"]);
    const FAILED = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "STARTUP_FAILURE", "STALE"]);
    return {
      state: o.state, // OPEN | MERGED | CLOSED
      mergeable: o.mergeable, // MERGEABLE | CONFLICTING | UNKNOWN
      pending: norm.some((s) => PENDING.has(s)),
      failed: norm.some((s) => FAILED.has(s)),
      checks: checks.length,
    };
  } catch {
    return null;
  }
}

function prNumberFromUrl(url) {
  const m = (url || "").match(/\/pull\/(\d+)/);
  return m ? Number(m[1]) : null;
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
    // Gate the whole motion on launcher health, checked ONCE per scan BEFORE any
    // materialize — so a broken launcher never crashes the monitor and never leaks
    // orphan exec issues. Tickets simply stay queued and retry on a later scan.
    let launched = 0;
    const pendingLaunch = issues.some((c) => c.status === "status:queued" && !state.bridges[c.number]);
    if (pendingLaunch && launcherHealthy()) {
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
          await notify(pickupNotification(c));
        }
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
      } else if (es.status === "status:complete") {
        // Worker finished. If it produced a PR, it's reviewable like needs-review;
        // if it made no code change (no commits / nothing to do), say so plainly
        // instead of stranding the central ticket at running.
        const pr = prUrlForExec(bridge.target, bridge.exec);
        setCentralStatus(c.number, "status:running", "status:needs-review");
        await notify(
          pr
            ? `✅ #${c.number} ${c.title} — complete, ready for review: ${pr}`
            : `ℹ️ #${c.number} ${c.title} — worker completed with no code change (nothing to do / already satisfied). ${bridge.target}#${bridge.exec}`,
        );
        bridge.mirrored = pr ? "needs-review" : "complete-no-pr";
      }
    }

    // MERGE: the human approved the PR via Zenod (status:approved-merge). Zenod
    // never merges — it relays the trigger; the controller (this monitor) merges
    // the PR on GREEN CI, then marks the central ticket merged and closes it.
    for (const c of issues) {
      if (c.status !== "status:approved-merge") continue;
      // Fast path: the bridge. Durable fallback: recover exec from the title.
      let bridge = state.bridges[c.number];
      if (!bridge) {
        const exec = execForCentral(c.target, c.number);
        if (exec) bridge = state.bridges[c.number] = { target: c.target, exec, mirrored: "needs-review" };
      }
      if (!bridge) {
        log(`merge: no exec mapping for central #${c.number}`);
        continue;
      }
      if (bridge.mirrored === "merged") continue;
      const prUrl = prUrlForExec(bridge.target, bridge.exec);
      const prNum = prNumberFromUrl(prUrl);
      if (!prNum) {
        log(`merge: no open PR for ${bridge.target}#${bridge.exec} (central #${c.number})`);
        continue;
      }
      const r = prMergeReadiness(bridge.target, prNum);
      if (!r) {
        log(`merge: could not read PR ${prUrl}`);
        continue;
      }
      const finalizeMerged = async () => {
        setCentralStatus(c.number, "status:approved-merge", "status:merged");
        try {
          gh(["issue", "close", String(c.number), "--repo", BACKLOG]);
        } catch {
          // best-effort
        }
        bridge.mirrored = "merged";
        await notify(`🎉 #${c.number} ${c.title} — merged: ${prUrl}`);
      };
      if (r.state === "MERGED") {
        await finalizeMerged();
        continue;
      }
      if (r.failed || r.mergeable === "CONFLICTING") {
        if (!bridge.mergeBlockedNotified) {
          bridge.mergeBlockedNotified = true;
          await notify(`⚠️ #${c.number} ${c.title} — can't merge: ${r.mergeable === "CONFLICTING" ? "branch has conflicts" : "CI is failing"}. ${prUrl}`);
        }
        continue;
      }
      if (r.pending || r.mergeable === "UNKNOWN") {
        if (!bridge.mergeWaitNotified) {
          bridge.mergeWaitNotified = true;
          await notify(`⏳ #${c.number} ${c.title} — approved; waiting on green CI before merge. ${prUrl}`);
        }
        continue;
      }
      // Green + mergeable -> merge now (squash). A failed branch-delete after a
      // successful merge must not read as a merge failure, so re-check state.
      let merged = false;
      try {
        // Fanout opens DRAFT PRs (humans review via the approve_merge gate); a
        // draft can't be merged, so mark it ready at merge time. Idempotent.
        try {
          gh(["pr", "ready", String(prNum), "--repo", bridge.target]);
        } catch {
          // already ready
        }
        gh(["pr", "merge", String(prNum), "--repo", bridge.target, "--squash", "--delete-branch"]);
        merged = true;
      } catch (e) {
        const after = prMergeReadiness(bridge.target, prNum);
        if (after && after.state === "MERGED") merged = true;
        else if (!bridge.mergeErrNotified) {
          bridge.mergeErrNotified = true;
          await notify(`⚠️ #${c.number} ${c.title} — merge failed: ${String(e.message).slice(0, 180)}. ${prUrl}`);
          log(`merge failed for ${prUrl}: ${e.message}`);
        }
      }
      if (merged) await finalizeMerged();
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
  pickupNotification,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
