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
// Execution lane (#194): Epaminon dispatches a ticket to POST /run; the runner works
// it and reports the result back to Epaminon's /api/exec/outcome|blocked, gated by the
// cross-provisioned lane secret. The secret is fetched from the Console with the
// runner's Console token (so a static env never drifts), with an env override.
const EPAMINON_URL = (process.env.ZENOD_EPAMINON_URL || "http://zenod-epaminon:8080").replace(/\/$/, "");
const CONSOLE_URL = (process.env.ZENOD_CONSOLE_URL || "").replace(/\/$/, "");
const CONSOLE_TOKEN = process.env.ZENOD_CONSOLE_TOKEN || "";
let LANE_SECRET = process.env.ZENOD_EXEC_LANE_SECRET || "";
const AUTO_MERGE_ENV = parseBooleanSetting(process.env.ZENOD_AUTO_MERGE);
// How long a merge-gate alarm stays quiet before it may remind again. A blocked
// PR is re-discovered on EVERY scan for as long as it stays blocked; without a
// cooldown it would re-ping each time GitHub's lazily-computed `mergeable` field
// flaps (CONFLICTING <-> UNKNOWN) or CI flips red/green. Alarm once, then at most
// once per window. Tunable via env; default 12h.
const NOTIFY_COOLDOWN_MS = Number(process.env.ZENOD_NOTIFY_COOLDOWN_MS || 12 * 60 * 60 * 1000);
// Keep the merge-attempt audit bounded. recordMergeAttempt appends on EVERY scan
// for every eligible PR, so a long-lived ticket (e.g. a PR stuck blocked for
// days) grows the persisted state file without limit — one bridge was observed
// at 807 entries / ~260KB. Keep only the most recent entries; older ones are
// forensic noise. Trimming on each append self-heals an already-bloated file on
// the next scan. Tunable via env.
const MERGE_ATTEMPT_HISTORY = Number(process.env.ZENOD_MERGE_ATTEMPT_HISTORY || 200);
const BRIDGE_MERGE_ATTEMPT_HISTORY = 30;

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
    return stateWithEnvOverrides(normalizeState(JSON.parse(readFileSync(STATE_PATH, "utf8"))));
  } catch {
    return stateWithEnvOverrides(normalizeState({}));
  }
}
function normalizeState(state) {
  return {
    autoMerge: state?.autoMerge === true,
    launched: state?.launched ?? {},
    notified: state?.notified ?? {},
    fanInBatches: state?.fanInBatches ?? {},
    bridges: state?.bridges ?? {}, // central # -> { target, exec, mirrored }
    mergeAttempts: Array.isArray(state?.mergeAttempts) ? state.mergeAttempts : [],
    dispatched: state?.dispatched ?? {}, // execution_id -> { repo, issueN, target, reportedStatus }
  };
}
function parseBooleanSetting(value) {
  if (value === undefined || value === null || value === "") return null;
  if (["1", "true", "yes", "on"].includes(String(value).toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(String(value).toLowerCase())) return false;
  return null;
}
function stateWithEnvOverrides(state) {
  if (AUTO_MERGE_ENV !== null) state.autoMerge = AUTO_MERGE_ENV;
  return state;
}
function saveState(s) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

// `surface` (the ticket's origin chat channel, from its origin: label) routes
// the ping back to where the work was requested. Omitted/null → the app falls
// back to WhatsApp, the historical default.
async function notify(text, surface) {
  if (!APP_URL || !API_TOKEN) {
    log("NOTIFY (no app configured):", surface ? `[${surface}]` : "", text);
    return;
  }
  try {
    const res = await fetch(`${APP_URL}/api/notify`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${API_TOKEN}` },
      body: JSON.stringify(surface ? { text, surface } : { text }),
    });
    log("notify ->", res.status, surface ? `[${surface}]` : "", text.slice(0, 60));
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
    const origin = names.find((n) => n.startsWith("origin:"));
    return {
      number: i.number,
      title: i.title,
      url: i.url,
      body: i.body || "",
      status: names.find((n) => n.startsWith("status:")) || null,
      target: target ? target.slice("target:".length) : REPO,
      origin: origin ? origin.slice("origin:".length) : null, // chat channel the ticket came from
      autoMerge: names.includes("auto-merge") || names.includes("auto_merge"),
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

// Smart-merge-gate readiness for a PR: state, draft, mergeability, CI rollup, AND
// how many commits it is BEHIND base. behind>0 means its green CI ran against a
// stale main — we must update-branch + re-CI before trusting it. We compute behind
// ourselves (via compare of SHAs) so the gate works regardless of branch protection.
function prGate(target, prNumber) {
  try {
    const out = gh(["pr", "view", String(prNumber), "--repo", target, "--json", "state,isDraft,mergeable,headRefOid,baseRefName,statusCheckRollup"]);
    const o = JSON.parse(out);
    const checks = o.statusCheckRollup || [];
    const norm = checks.map((c) => String(c.conclusion || c.state || c.status || "").toUpperCase());
    const PENDING = new Set(["", "PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "WAITING", "REQUESTED", "ACTION_REQUIRED"]);
    const FAILED = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "STARTUP_FAILURE", "STALE"]);
    let behind = null;
    if (o.state === "OPEN") {
      try {
        const baseSha = gh(["api", `repos/${target}/commits/${o.baseRefName}`, "--jq", ".sha"]).trim();
        // compare base...head → behind_by = commits in base not in head = how far head trails main
        behind = Number(gh(["api", `repos/${target}/compare/${baseSha}...${o.headRefOid}`, "--jq", ".behind_by"]).trim());
      } catch {
        behind = null; // unknown; treated as "wait" below
      }
    }
    return {
      state: o.state, // OPEN | MERGED | CLOSED
      isDraft: o.isDraft === true,
      mergeable: o.mergeable, // MERGEABLE | CONFLICTING | UNKNOWN
      pending: norm.some((s) => PENDING.has(s)),
      failed: norm.some((s) => FAILED.has(s)),
      checks: checks.length,
      behind, // number of commits behind base, or null if unknown
    };
  } catch {
    return null;
  }
}

function prNumberFromUrl(url) {
  const m = (url || "").match(/\/pull\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// --- Execution lane (#194): run Epaminon-dispatched tickets + report back ---

// Parse a fully-qualified work ticket "owner/repo#N" into { repo, number }.
function parseTarget(target) {
  const m = String(target || "").match(/^([^#\s]+\/[^#\s]+)#(\d+)$/);
  return m ? { repo: m[1], number: Number(m[2]) } : null;
}

// PURE: map a dispatched run's target-issue status (+ whether a PR exists) to the
// exec-lane outcome Epaminon expects. `none` = not terminal yet (keep watching).
// Outward (a PR to merge) parks at needs-review; an internal completion with no PR
// is done. Blocked surfaces the blocker. Mirrors the gate decision Epaminon owns.
function dispatchedOutcome(status, prUrl) {
  if (status === "status:blocked") return { kind: "blocked" };
  if (status === "status:needs-review") return { kind: "outcome", outward: true, evidenceUrl: prUrl || "" };
  if (status === "status:complete") {
    return prUrl ? { kind: "outcome", outward: true, evidenceUrl: prUrl } : { kind: "outcome", outward: false, evidenceUrl: "" };
  }
  return { kind: "none" }; // queued / running / unknown — not terminal
}

// Fetch the cross-provisioned lane secret from the Console (with the runner's Console
// token) so it always matches the Console-minted value. Cached; env override wins.
async function ensureLaneSecret() {
  if (LANE_SECRET) return LANE_SECRET;
  if (!CONSOLE_URL || !CONSOLE_TOKEN) return "";
  try {
    const res = await fetch(`${CONSOLE_URL}/api/lane-secret`, { headers: { Authorization: `Bearer ${CONSOLE_TOKEN}` } });
    if (res.ok) {
      const j = await res.json();
      if (j && j.secret) LANE_SECRET = String(j.secret);
    }
  } catch (e) {
    log("lane-secret fetch failed:", e.message);
  }
  return LANE_SECRET;
}

// Report an Epaminon-owned execution edge back to its receivers, lane-secret gated.
async function reportToEpaminon(path, body) {
  const secret = await ensureLaneSecret();
  if (!secret) {
    log(`exec-lane not provisioned — cannot report ${path} ${body.execution_id}`);
    return false;
  }
  try {
    const res = await fetch(`${EPAMINON_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Lane-Secret": secret },
      body: JSON.stringify(body),
    });
    if (!res.ok) log(`Epaminon rejected ${path} ${body.execution_id} (HTTP ${res.status})`);
    return res.ok;
  } catch (e) {
    log(`report ${path} ${body.execution_id} failed:`, e.message);
    return false;
  }
}

// Launch an Epaminon-dispatched ticket: work its target work-ticket directly (no
// central materialize — the dispatched target IS the issue).
function launchDispatched(executionId, target, state) {
  const t = parseTarget(target);
  if (!t) {
    log(`/run: bad target "${target}" for ${executionId}`);
    return false;
  }
  if (!launcherHealthy()) {
    log(`/run: launcher not healthy — ${executionId} not started`);
    return false;
  }
  launchFanout(t.repo, t.number);
  state.dispatched[executionId] = { repo: t.repo, issueN: t.number, target, reportedStatus: null };
  return true;
}

// Each scan: for dispatched runs, read the target issue state and report new
// terminal-ish transitions (needs-review / complete / blocked) back to Epaminon once.
async function reportDispatched(state) {
  for (const [executionId, d] of Object.entries(state.dispatched || {})) {
    const { status, lastComment } = execStatusAndComment(d.repo, d.issueN);
    const prUrl = prUrlForExec(d.repo, d.issueN);
    const o = dispatchedOutcome(status, prUrl);
    if (o.kind === "none") continue;
    if (d.reportedStatus === status) continue; // already reported this state
    let ok = false;
    if (o.kind === "blocked") {
      ok = await reportToEpaminon("/api/exec/blocked", { execution_id: executionId, note: (lastComment || "").slice(0, 280) });
    } else {
      ok = await reportToEpaminon("/api/exec/outcome", {
        execution_id: executionId,
        outward: o.outward,
        ...(o.evidenceUrl ? { evidence_url: o.evidenceUrl } : {}),
      });
    }
    if (ok) d.reportedStatus = status;
  }
}

function autoMergeForIssue(state, issue) {
  return state.autoMerge === true || issue.autoMerge === true;
}

function mergeApprovalForIssue(state, issue) {
  if (issue.status === "status:approved-merge") {
    return { eligible: true, autoMerge: false, fromStatus: "status:approved-merge" };
  }
  if (issue.status === "status:needs-review" && autoMergeForIssue(state, issue)) {
    return { eligible: true, autoMerge: true, fromStatus: "status:needs-review" };
  }
  return { eligible: false, autoMerge: false, fromStatus: issue.status };
}

// Keep only the most recent `max` entries of an audit array, in place.
function trimTail(arr, max) {
  if (arr.length > max) arr.splice(0, arr.length - max);
  return arr;
}

function recordMergeAttempt(state, bridge, issue, attempt) {
  const entry = {
    at: new Date().toISOString(),
    central: issue.number,
    title: issue.title,
    target: bridge?.target ?? issue.target,
    exec: bridge?.exec ?? null,
    autoMerge: attempt.autoMerge === true,
    prUrl: attempt.prUrl ?? "",
    outcome: attempt.outcome,
    detail: attempt.detail ?? "",
  };
  state.mergeAttempts.push(entry);
  trimTail(state.mergeAttempts, MERGE_ATTEMPT_HISTORY);
  if (bridge) {
    bridge.autoMerge = attempt.autoMerge === true;
    bridge.mergeAttempts = bridge.mergeAttempts ?? [];
    bridge.mergeAttempts.push(entry);
    trimTail(bridge.mergeAttempts, BRIDGE_MERGE_ATTEMPT_HISTORY);
  }
  return entry;
}

// Merge-gate notification dedup. The old guard keyed dedup on the exact blocker
// REASON, so a PR flapping between "conflicting" and "CI failing" (or bouncing
// through a transient "verify" while GitHub recomputes mergeability) read as a
// brand-new event each scan and re-pinged the owner. To a human these are the
// same condition: "this PR can't merge and needs you." Collapse the
// interchangeable hard-blocker reasons to ONE dedup identity so the alarm is a
// single ongoing event; distinct events (verify progress, closed, merge error)
// keep their own identity but are still rate-limited by the cooldown below.
function mergeNoteDedupKey(key) {
  return key === "conflict" || key === "failed" ? "blocked" : key;
}

// Decide whether a merge-gate note should actually ping this scan. Pure and
// deterministic — the caller passes `now` so tests can drive the clock. Stamps
// the send time per dedup identity on the bridge when a ping is warranted; the
// bridge is persisted in monitor state (on a named volume), so the cooldown
// survives runner restarts and redeploys.
function shouldSendMergeNote(bridge, key, now, cooldownMs = NOTIFY_COOLDOWN_MS) {
  const dedupKey = mergeNoteDedupKey(key);
  const sent = bridge.notifications || (bridge.notifications = {});
  const last = sent[dedupKey];
  if (last != null && now - last < cooldownMs) return false;
  sent[dedupKey] = now;
  return true;
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
          await notify(pickupNotification(c), c.origin);
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
        await notify(`✅ #${c.number} ${c.title} — ready for review${pr ? `: ${pr}` : "."}`, c.origin);
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
        await notify(`⛔ #${c.number} ${c.title} — blocked, needs your decision${q ? `:\n${q}` : "."}`, c.origin);
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
          c.origin,
        );
        bridge.mirrored = pr ? "needs-review" : "complete-no-pr";
      }
    }

    // MERGE: manual mode watches human approval (status:approved-merge). Opt-in
    // auto-merge also lets status:needs-review tickets enter this SAME smart gate.
    // Zenod never merges — it relays/records the trigger; the controller (this
    // monitor) lands the PR. This is a SMART MERGE GATE / merge-queue: integration
    // happens per-PR at merge time.
    // Concurrent, independently-queued workers each land safely with NO fan-in,
    // because before merging we (a) bring the PR up to date with main and (b)
    // require GREEN CI on the UPDATED branch — so a PR whose green ran against a
    // stale main is re-verified against what it will actually merge into. A
    // textual/semantic clash surfaces here as a conflict or a red re-run. At most
    // ONE merge per scan keeps main stable while the loop runs.
    let mergedThisScan = false;
    for (const c of issues) {
      const approval = mergeApprovalForIssue(state, c);
      if (!approval.eligible) continue;
      // Fast path: the bridge. Durable fallback: recover exec from the title.
      let bridge = state.bridges[c.number];
      if (!bridge) {
        const exec = execForCentral(c.target, c.number);
        if (exec) bridge = state.bridges[c.number] = { target: c.target, exec, mirrored: "needs-review" };
      }
      if (!bridge) {
        log(`merge: no exec mapping for central #${c.number}`);
        recordMergeAttempt(state, null, c, { autoMerge: approval.autoMerge, outcome: "no-exec-mapping" });
        continue;
      }
      if (bridge.mirrored === "merged") continue;
      const prUrl = prUrlForExec(bridge.target, bridge.exec);
      const prNum = prNumberFromUrl(prUrl);
      if (!prNum) {
        log(`merge: no open PR for ${bridge.target}#${bridge.exec} (central #${c.number})`);
        recordMergeAttempt(state, bridge, c, { autoMerge: approval.autoMerge, outcome: "no-open-pr", prUrl });
        continue;
      }
      // Record EVERY gate evaluation (full audit), but only ACT — flip the
      // central status, comment, ping the owner — when the dedup+cooldown gate
      // says this is a fresh alarm. A blocked PR thus alarms once and then stays
      // quiet, instead of re-pinging on every scan as GitHub's mergeable field
      // flaps between conflicting / unknown / CI-failed (see shouldSendMergeNote).
      const note = async (key, text, options = {}) => {
        recordMergeAttempt(state, bridge, c, {
          autoMerge: approval.autoMerge,
          prUrl,
          outcome: options.outcome ?? key,
          detail: options.detail ?? "",
        });
        if (!shouldSendMergeNote(bridge, key, Date.now())) return;
        bridge.mergeNote = mergeNoteDedupKey(key);
        if (options.blockAutoMerge && approval.autoMerge && c.status === "status:needs-review") {
          setCentralStatus(c.number, "status:needs-review", "status:blocked");
        }
        if (options.comment && approval.autoMerge) {
          try {
            gh(["issue", "comment", String(c.number), "--repo", BACKLOG, "--body", text]);
          } catch {
            // best-effort
          }
        }
        await notify(text, c.origin);
      };
      const finalizeMerged = async () => {
        recordMergeAttempt(state, bridge, c, { autoMerge: approval.autoMerge, prUrl, outcome: "merged" });
        setCentralStatus(c.number, approval.fromStatus, "status:merged");
        try {
          gh(["issue", "close", String(c.number), "--repo", BACKLOG]);
        } catch {
          // best-effort
        }
        bridge.mirrored = "merged";
        await notify(`🎉 #${c.number} ${c.title} — merged: ${prUrl}`, c.origin);
      };

      const g = prGate(bridge.target, prNum);
      if (!g) {
        log(`merge: could not read PR ${prUrl}`);
        recordMergeAttempt(state, bridge, c, { autoMerge: approval.autoMerge, prUrl, outcome: "pr-gate-unreadable" });
        continue;
      }
      if (g.state === "MERGED") {
        await finalizeMerged();
        continue;
      }
      if (g.state === "CLOSED") {
        await note("closed", `⚠️ #${c.number} ${c.title} — PR was closed without merging. ${prUrl}`, {
          comment: true,
          blockAutoMerge: true,
        });
        continue;
      }
      // Hard blockers — need a human or a resolve worker, not a retry.
      if (g.mergeable === "CONFLICTING") {
        await note("conflict", `⛔ #${c.number} ${c.title} — branch conflicts with main; needs a rebase/resolve. ${prUrl}`, {
          comment: true,
          blockAutoMerge: true,
        });
        continue;
      }
      if (g.failed) {
        await note("failed", `⛔ #${c.number} ${c.title} — CI is failing; can't merge. ${prUrl}`, {
          comment: true,
          blockAutoMerge: true,
        });
        continue;
      }
      // Fanout opens DRAFT PRs (review is the approve_merge gate); ready it first.
      if (g.isDraft) {
        try {
          gh(["pr", "ready", String(prNum), "--repo", bridge.target]);
        } catch {
          // already ready
        }
        await note("verify", `⏳ #${c.number} ${c.title} — verifying against latest main before merge. ${prUrl}`);
        continue;
      }
      // Mergeability/behind not yet known → wait a scan.
      if (g.behind === null || g.mergeable === "UNKNOWN") {
        await note("verify", `⏳ #${c.number} ${c.title} — verifying mergeability. ${prUrl}`);
        continue;
      }
      // STALE: behind main → its green CI ran against an old main. Merge main in
      // (update-branch), which re-triggers CI; land only after it goes green.
      if (g.behind > 0) {
        try {
          gh(["api", "-X", "PUT", `repos/${bridge.target}/pulls/${prNum}/update-branch`]);
          await note("verify", `⏳ #${c.number} ${c.title} — bringing branch up to latest main + re-running CI before merge. ${prUrl}`, {
            outcome: "update-branch",
          });
        } catch {
          await note("conflict", `⛔ #${c.number} ${c.title} — couldn't update branch to main (likely a conflict); needs resolve. ${prUrl}`, {
            comment: true,
            blockAutoMerge: true,
            outcome: "update-branch-failed",
          });
        }
        continue;
      }
      // Up to date but CI still running on the merged-in result → wait.
      if (g.pending) {
        await note("verify", `⏳ #${c.number} ${c.title} — verifying against latest main (CI running). ${prUrl}`);
        continue;
      }
      // behind==0, mergeable, GREEN on the up-to-date branch → safe to land.
      if (mergedThisScan) {
        recordMergeAttempt(state, bridge, c, { autoMerge: approval.autoMerge, prUrl, outcome: "deferred-one-merge-per-scan" });
        continue;
      } // one merge per scan; the rest re-verify next pass
      let merged = false;
      try {
        gh(["pr", "merge", String(prNum), "--repo", bridge.target, "--squash", "--delete-branch"]);
        merged = true;
      } catch (e) {
        const after = prGate(bridge.target, prNum);
        if (after && after.state === "MERGED") merged = true;
        else {
          await note("mergeerr", `⚠️ #${c.number} ${c.title} — merge failed: ${String(e.message).slice(0, 160)}. ${prUrl}`, {
            comment: true,
            blockAutoMerge: true,
            outcome: "merge-failed",
            detail: String(e.message).slice(0, 300),
          });
          log(`merge failed for ${prUrl}: ${e.message}`);
        }
      }
      if (merged) {
        mergedThisScan = true;
        await finalizeMerged();
      }
    }

    // Re-queued after a review/block -> let it run again.
    for (const c of issues) {
      if (c.status === "status:queued" && state.bridges[c.number]?.mirrored) {
        delete state.bridges[c.number];
      }
    }

    // Execution lane (#194): report Epaminon-dispatched runs' results back to
    // Epaminon. Additive — independent of the central-scan motions above.
    await reportDispatched(state);

    saveState(state);
    log(`scan (${reason}): ${issues.length} central issues, launched ${launched}`);
  } catch (e) {
    log("scan error:", e.message);
  } finally {
    scanning = false;
  }
}

// POST /run — Epaminon dispatches an execution ticket to be worked now (#194).
// Lane-secret gated (so only Epaminon can trigger a Codex run). Body:
// { execution_id, target: "owner/repo#N", context }.
async function handleRun(req, res) {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const secret = await ensureLaneSecret();
    if (!secret) return void res.writeHead(503).end("lane not provisioned\n");
    if ((req.headers["x-lane-secret"] || "") !== secret) return void res.writeHead(401).end("unauthorized\n");
    const executionId = body.execution_id != null ? String(body.execution_id) : "";
    if (!executionId || !body.target) return void res.writeHead(400).end("execution_id and target required\n");
    const state = loadState();
    const ok = launchDispatched(executionId, String(body.target), state);
    saveState(state);
    res.writeHead(ok ? 202 : 422).end(ok ? "launched\n" : "could not launch\n");
  } catch (e) {
    log("/run error:", e.message);
    res.writeHead(500).end("error\n");
  }
}

function main() {
  // Poke endpoint — workers (and Zenod) hit POST /poke for an instant refresh.
  createServer((req, res) => {
    if (req.method === "POST" && req.url === "/poke") {
      res.writeHead(202).end("scanning\n");
      void scan("poke");
    } else if (req.method === "POST" && req.url === "/run") {
      void handleRun(req, res); // Epaminon dispatches an execution ticket (#194)
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
  mergeApprovalForIssue,
  mergeNoteDedupKey,
  normalizeState,
  recordMergeAttempt,
  shouldSendMergeNote,
  detectIntegrationStatus,
  reviewHeldByFanInBatch,
  updateFanInBatches,
  latestComment,
  pickupNotification,
  parseTarget,
  dispatchedOutcome,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
