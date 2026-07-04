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
//   ZENOD_NOTIFY_URL / ZENOD_NOTIFY_TOKEN   for /api/notify
//     defaults to the Console URL/token, then the legacy app URL/token.
//   ZENOD_POLL_MS / ZENOD_POKE_PORT / ZENOD_CONCURRENCY / ZENOD_STATE / ZENOD_BASE
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
// Shared engine-quota fallback (W0). The fanout lane already replays a run on the
// other engine when the primary dies on a usage-limit / 429 / billing error; the
// ephemeral one-off path reuses the SAME error-class + fallback helpers so the two
// lanes stay in lockstep (E-2 port).
import { isQuotaError, fallbackEngine, buildWorkerSpawn, extractWorkerError, isPausedQuota, pauseMessage } from "./fanout-codex.mjs";
// I8-2 durable executor: the ~60-LOC replay/journal primitive grafted from the
// D-2 spike (spikes/d2-execution-substrate/candidate-c-diy/src/durable.mjs).
import { appendRecord } from "./lib/durable.mjs";

const BACKLOG = process.env.ZENOD_BACKLOG_REPO || "AlfaBlok/obsidian-brain";
const REPO = process.env.ZENOD_REPO || "zenod-ai/zenod"; // default target repo + fan-in repo
const WORKDIR = process.env.ZENOD_WORKDIR || "/runner/work/zenod";
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
const { url: NOTIFY_URL, token: NOTIFY_TOKEN } = notifyConfig(process.env);
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
const LAUNCH_EARLY_EXIT_MS = Number(process.env.ZENOD_LAUNCH_EARLY_EXIT_MS || 30_000);
// Live-progress heartbeat (execution-progress campaign). While a run is non-terminal the
// CONTROLLER (this monitor) posts/edits ONE pinned comment on the run's GitHub issue with
// CONTROLLER-OBSERVED telemetry only — elapsed, turn count, last event/tool from the
// streamed events log the monitor already parses. Never worker self-report. Edit-in-place,
// interval-gated (default 10m). If no NEW worker event for > the stall threshold (default
// 10m), flip the heartbeat to "possibly stalled" and raise a Tier-2 milestone. Reuses the
// #477 (M-5) watchdog pattern (age since last activity crosses a threshold → one alert).
const HEARTBEAT_INTERVAL_MS = Number(process.env.ZENOD_HEARTBEAT_INTERVAL_MS || 10 * 60 * 1000);
const HEARTBEAT_STALL_MS = Number(process.env.ZENOD_HEARTBEAT_STALL_MS || 10 * 60 * 1000);
// Tier-2 coarse milestone: one "still running" reminder to Phylax at this elapsed mark.
const HEARTBEAT_LONGRUN_MS = Number(process.env.ZENOD_HEARTBEAT_LONGRUN_MS || 30 * 60 * 1000);
const HEARTBEAT_MARKER = "<!-- zenod-exec-heartbeat -->";
const STATUS_LABEL_PRIORITY = [
  "status:blocked",
  "status:needs-review",
  "status:complete",
  "status:approved-merge",
  "status:merged",
  "status:running",
  "status:queued",
  "status:proposed",
];

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
    ephemeral: state?.ephemeral ?? {}, // execution_id -> { target, promptPath, finalPath, reportedStatus }
    // Reports to Epaminon that could not be delivered (lane not provisioned, network,
    // HTTP error). Keyed "path|execution_id"; the scan loop re-flushes them so an
    // execution never silently sticks at queued/running with its outcome lost (#stab T2).
    pendingReports: state?.pendingReports ?? {},
    // Live-progress heartbeat bookkeeping: execution_id -> { commentId, lastPostedAt, stalled,
    // fired } so the pinned comment is edited in place and each Tier-2 milestone fires once.
    heartbeats: state?.heartbeats ?? {},
  };
}
function parseBooleanSetting(value) {
  if (value === undefined || value === null || value === "") return null;
  if (["1", "true", "yes", "on"].includes(String(value).toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(String(value).toLowerCase())) return false;
  return null;
}
function notifyConfig(env = process.env) {
  const url = (env.ZENOD_NOTIFY_URL || env.ZENOD_CONSOLE_URL || env.ZENOD_APP_URL || "").replace(/\/$/, "");
  const token = env.ZENOD_NOTIFY_TOKEN || env.ZENOD_CONSOLE_TOKEN || env.ZENOD_API_TOKEN || "";
  return { url, token };
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
async function notify(text, surface, fields = {}) {
  if (!NOTIFY_URL || !NOTIFY_TOKEN) {
    log("NOTIFY (no app configured):", surface ? `[${surface}]` : "", text);
    return;
  }
  try {
    // Structured event fields (eventType/executionId/runId/targetIssue/severity) let
    // the Console notification authority dedup/coalesce (R2-T1/T2). Text is still sent
    // as-is; a plain call with no fields is the legacy manual notification.
    const body = { text, ...(surface ? { surface } : {}), ...fields };
    const res = await fetch(`${NOTIFY_URL}/api/notify`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${NOTIFY_TOKEN}` },
      body: JSON.stringify(body),
    });
    log("notify ->", res.status, surface ? `[${surface}]` : "", text.slice(0, 60));
  } catch (e) {
    log("notify FAILED:", e.message);
  }
}

// Label the worker by the actual engine (codex vs Claude) so "working" notifications
// don't always say "Codex" when the default engine is now Claude. Env-driven, matching
// the runner's ZENOD_WORKER_ENGINE (default claude).
function workerLabel() {
  const e = String(process.env.ZENOD_WORKER_ENGINE || "claude").toLowerCase();
  if (e === "codex") return "Codex";
  if (e === "claude") return "Claude";
  return e ? e.charAt(0).toUpperCase() + e.slice(1) : "Worker";
}

function pickupNotification(central) {
  return `🤖 ${workerLabel()} working on #${central.number} — ${central.title} (${central.target})`;
}

function shouldNotifyOnExecutionStart(body) {
  return body?.notify_on_start !== false;
}

function primaryStatusLabel(names) {
  const set = new Set(names || []);
  return STATUS_LABEL_PRIORITY.find((name) => set.has(name)) || (names || []).find((name) => name.startsWith("status:")) || null;
}

function targetBootstrapLabels(existingNames) {
  const names = new Set(existingNames || []);
  const missing = [];
  if (!names.has("owner:agent")) missing.push("owner:agent");
  if (![...names].some((name) => name.startsWith("status:"))) missing.push("status:queued");
  return missing;
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
      status: primaryStatusLabel(names),
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

// Epaminon-dispatched runs work the target issue directly. Archus may not have
// label-write access there, so the runner repairs the target issue labels with
// its repo-scoped GitHub credentials before launching Codex.
function repairTargetBootstrapLabels(repo, issueNumber) {
  let names = [];
  try {
    const out = gh(["issue", "view", String(issueNumber), "--repo", repo, "--json", "labels"]);
    names = (JSON.parse(out).labels || []).map((label) => label.name);
  } catch (e) {
    return { ok: false, labels: [], note: `could not read target labels for ${repo}#${issueNumber}: ${e.message}` };
  }
  const labels = targetBootstrapLabels(names);
  if (labels.length === 0) return { ok: true, labels: [] };
  for (const label of labels) ensureLabel(repo, label);
  try {
    gh(["issue", "edit", String(issueNumber), "--repo", repo, "--add-label", labels.join(",")]);
    log(`repaired target labels for ${repo}#${issueNumber}: ${labels.join(", ")}`);
    return { ok: true, labels };
  } catch (e) {
    return { ok: false, labels, note: `could not repair target labels for ${repo}#${issueNumber}: ${e.message}` };
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

// F-1 (C-08): mint a lightweight tracking issue for an ISSUE-LESS ephemeral run so its
// start ping has a resolving home and the heartbeat can pin to the same issue. Aligns
// with the standing "no issue-less executions" principle: a one-off gets a real ticket
// the moment it starts, not only if it happens to create one. Best-effort — if the
// create fails (auth/network) we return null and the caller falls back to no-link rather
// than blocking the run. Repo defaults to REPO; overridable via ZENOD_TRACKING_REPO.
function mintTrackingIssue(executionId, context, repo = process.env.ZENOD_TRACKING_REPO || REPO) {
  const summary = String(context || "").trim().replace(/\s+/g, " ").slice(0, 72) || "one-off execution";
  const body = [
    `_Tracking issue for one-off execution \`${executionId}\` — minted at start so the run is traceable from its first notification (C-08)._`,
    "",
    "Context:",
    "",
    String(context || "(no context provided)").slice(0, 4000),
  ].join("\n");
  try {
    ensureLabel(repo, "owner:agent");
    ensureLabel(repo, "status:running");
    const out = gh([
      "issue", "create", "--repo", repo,
      "--title", `[exec ${executionId}] ${summary}`,
      "--body", body, "--label", "owner:agent,status:running",
    ]);
    const m = out.match(/https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+/);
    return m ? m[0] : null;
  } catch (e) {
    log(`tracking-issue mint failed for ${executionId}: ${e.message}`);
    return null;
  }
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

function workdirForRepo(repo) {
  if (repo === REPO) return WORKDIR;
  const safe = String(repo || "")
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replace(/\//g, "__")
    .replace(/^-|-$/g, "");
  return `${dirname(WORKDIR)}/${safe || "target-repo"}`;
}

function safeFilePart(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "unknown";
}

function safePathPart(value) {
  return String(value || "unknown").replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function launchLogPath(target, execNumber, now = Date.now()) {
  return `${dirname(STATE_PATH)}/launch-${now}-${safeFilePart(target)}-${execNumber}.log`;
}

function shouldReportEarlyLaunchExit(code, elapsedMs, windowMs = LAUNCH_EARLY_EXIT_MS) {
  return code !== 0 && elapsedMs <= windowMs;
}

function earlyLaunchFailureNote(target, execNumber, code, signal, logPath) {
  const exit = signal ? `signal ${signal}` : `exit code ${code}`;
  return `fanout launcher for ${target}#${execNumber} stopped immediately with ${exit}; see runner log ${logPath}`;
}

function launchFanout(target, execNumber, extraEnv = {}, options = {}) {
  const targetWorkdir = workdirForRepo(target);
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const logPath = launchLogPath(target, execNumber);
  const fd = openSync(logPath, "a");
  const args = [
    "start", "--repo", target, "--issues", String(execNumber),
    "--workdir", targetWorkdir, "--draft-pr", "--github-status",
    "--concurrency", String(CONCURRENCY),
  ];
  const startedAt = Date.now();
  const child = spawn("zenod-fanout-codex", args, { stdio: ["ignore", fd, fd], detached: true, env: { ...process.env, ...extraEnv } });
  // Belt-and-suspenders: catch any late async spawn error so it can never become an
  // unhandled 'error' event that crashes the whole monitor.
  child.on("error", (err) => {
    try {
      closeSync(fd);
    } catch {
      // already closed
    }
    const note = `fanout launcher failed to spawn for ${target}#${execNumber}: ${err.code || err.message}; see runner log ${logPath}`;
    log(note);
    void options.onEarlyExit?.(note);
  });
  child.on("exit", (code, signal) => {
    try {
      closeSync(fd);
    } catch {
      // already closed
    }
    const elapsedMs = Date.now() - startedAt;
    if (!shouldReportEarlyLaunchExit(code, elapsedMs)) return;
    const note = earlyLaunchFailureNote(target, execNumber, code, signal, logPath);
    log(note);
    void options.onEarlyExit?.(note);
  });
  child.unref();
  log(`launched fanout for ${target}#${execNumber} workdir=${targetWorkdir} log=${logPath}`);
  return { pid: child.pid, logPath };
}

function execStatusAndComment(target, execNumber) {
  try {
    const out = gh(["issue", "view", String(execNumber), "--repo", target, "--json", "labels,comments,title"]);
    const o = JSON.parse(out);
    const names = (o.labels || []).map((l) => l.name);
    const status = primaryStatusLabel(names);
    const originLabel = names.find((n) => n.startsWith("origin:")) || null;
    const comments = o.comments || [];
    return {
      status,
      origin: originLabel ? originLabel.slice("origin:".length) : null,
      lastComment: comments.length ? comments[comments.length - 1].body : "",
      title: o.title || "",
    };
  } catch {
    return { status: null, origin: null, lastComment: "", title: "" };
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

// Reconstruct a completed run's deliverable manifest (R1-T1) from artifacts that
// already exist: the PR (changed files + head SHA/branch + merged state) and the
// reportback comment. No new worker-side state — this is a read of GitHub. `merged`
// is honest: a stranded draft PR reports false, not omitted, so downstream recall
// and notifications can tell the truth about an unmerged deliverable.
// PURE: parse the machine-parseable "Deliverables:" block from a reportback comment
// (R1-T4) into a path list — the deterministic source when the live PR file list is
// unavailable. "Deliverables: none" → []. Stops at the next blank line/section.
function parseDeliverables(commentText) {
  const lines = String(commentText || "").split(/\r?\n/);
  const idx = lines.findIndex((l) => /^Deliverables:/i.test(l.trim()));
  if (idx < 0) return [];
  if (/^Deliverables:\s*none\s*$/i.test(lines[idx].trim())) return [];
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) break; // blank line ends the block
    const m = l.match(/^-\s*(.+)$/);
    if (!m) break; // a non-list line ends the block
    out.push(m[1].trim());
  }
  return out;
}

function deliverableManifest(target, execNumber, prUrl, lastComment) {
  const manifest = {
    repo: target,
    issue: execNumber,
    ...(prUrl ? { prUrl } : {}),
    ...(lastComment ? { handoffExcerpt: String(lastComment).slice(0, 500) } : {}),
  };
  const prNumber = prNumberFromUrl(prUrl);
  if (prNumber) {
    try {
      const out = gh(["pr", "view", String(prNumber), "--repo", target, "--json", "state,headRefName,headRefOid,files"]);
      const o = JSON.parse(out);
      if (o.headRefName) manifest.branch = o.headRefName;
      if (o.headRefOid) manifest.headSha = o.headRefOid;
      manifest.merged = o.state === "MERGED";
      const paths = (o.files || []).map((f) => f.path).filter(Boolean);
      if (paths.length) manifest.paths = paths;
    } catch {
      // PR unreadable (deleted/permissions) — keep the pointer-only manifest.
    }
  }
  // Deterministic fallback: if the live PR file list was empty/unavailable, use the
  // reportback's Deliverables block (R1-T4) so the manifest still carries paths.
  if (!manifest.paths) {
    const reported = parseDeliverables(lastComment);
    if (reported.length) manifest.paths = reported;
  }
  return manifest;
}

// --- Execution lane (#194): run Epaminon-dispatched tickets + report back ---

// Parse a fully-qualified work ticket "owner/repo#N" into { repo, number }.
function parseTarget(target) {
  const m = String(target || "").match(/^([^#\s]+\/[^#\s]+)#(\d+)$/);
  return m ? { repo: m[1], number: Number(m[2]) } : null;
}

function parseEphemeralTarget(target) {
  const m = String(target || "").match(/^ephemeral:([A-Za-z0-9_.:-]+)$/);
  return m ? { executionId: m[1] } : null;
}

// PURE (F-1 / C-08): the resolving GitHub URL for a dispatched target "owner/repo#N".
// A dispatched run's target IS a real work ticket, so its start ping already has a home.
function issueUrlFromTarget(target) {
  const t = parseTarget(target);
  return t ? `https://github.com/${t.repo}/issues/${t.number}` : null;
}

// PURE (F-1 / C-08): the resolving link a start notification must carry — the target
// issue URL for a dispatched run, else the first github issue URL embedded in the run
// context (the mint-a-ticket path leaves one there). Returns null only for a genuinely
// issue-less ephemeral that has not yet been given a tracking issue — the caller then
// mints one so EVERY start ping resolves (the "no issue-less executions" principle).
function resolvingLinkForRun({ target, context } = {}) {
  const fromTarget = issueUrlFromTarget(target);
  if (fromTarget) return fromTarget;
  const m = String(context || "").match(/https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+/i);
  return m ? m[0].replace(/[).,]+$/, "") : null;
}

// PURE (F-1 / C-08): compose the "execution started" notification. It ALWAYS carries a
// resolving link to the ticket/run it executes against — a dispatched run's work ticket
// or the freshly-minted tracking issue for an issue-less ephemeral. A start ping with no
// link is the C-08 gap: a run that cannot be traced from its very first notification.
function composeExecutionStartNotification({ executionId, target, link, worker = workerLabel() } = {}) {
  const head = `🤖 ${worker} working on execution ${executionId} — ${target}`;
  return link ? `${head}\n${link}` : head;
}

function ephemeralRunPaths(executionId) {
  const root = join(dirname(STATE_PATH), "ephemeral", safePathPart(executionId));
  return {
    root,
    scratch: join(root, "scratch"),
    promptPath: join(root, "prompt.md"),
    finalPath: join(root, "final.md"),
    eventsPath: join(root, "events.jsonl"),
    // I8-2/I8-3: durable per-run step/attempt journal (survives redeploys on the
    // runner's persistent volume) — the resume record + the folded-in step log.
    journalPath: join(root, "journal.jsonl"),
  };
}

function ephemeralPrompt(executionId, context) {
  return [
    "You are Epaminon executing one one-off task for the user.",
    "",
    "This task is ephemeral: do not create, edit, close, or run a GitHub issue unless the user explicitly asked for that in the context.",
    "Use the available Console MCP tools only when they are needed to complete the requested work.",
    "Keep any filesystem work inside the current scratch directory (clone any target repo here). If the context names a Target repo, clone and work THAT repo — do not search for or guess a different one.",
    "",
    `Execution id: ${executionId}`,
    "",
    "Context:",
    context || "(no context provided)",
    "",
    "Final handoff requirements:",
    "- Start the final answer with one line: `Status: complete`, `Status: blocked`, or `Status: failed`.",
    "- If blocked, include the concrete blocker and the one question or next action needed.",
    "- If complete, include a concise summary of what was done and any evidence/pointers.",
    "- Evidence must be REAL and verifiable. If you committed/pushed, include the FULL commit URL (https://github.com/<owner>/<repo>/commit/<sha>) or PR URL — a bare SHA without a URL is NOT accepted as evidence, and a fabricated SHA will be rejected. Never invent a commit, test result, or CI status.",
    "- Deploy honesty: pushing to a branch is NOT the same as the change being live. If the change must redeploy to take effect, confirm the running service actually picked up the new commit before saying it is live. If you cannot confirm the redeploy, say `pushed but deploy unconfirmed` and do not tell the user they can test it live yet.",
    "- Merge policy: open ONE PR against main and STOP — do NOT merge it yourself. The controller enables GitHub auto-merge on your PR automatically (it merges once CI is green; never if CI is red). If the context says HOLD-FOR-REVIEW, the controller will leave the PR open for a human instead. Either way, you must never run `gh pr merge` by hand.",
  ].join("\n");
}

function ephemeralFinalState(exitCode, finalText) {
  const statusLine = String(finalText || "").match(/^\s*(?:[-*]\s*)?status:\s*(complete|blocked|failed)\b/im);
  if (statusLine) return statusLine[1].toLowerCase();
  return exitCode === 0 ? "complete" : "failed";
}

// PURE: shorten a worker's handoff comment to its first meaningful sentence(s),
// stripping a leading "Status: complete" line and markdown headers, for the terminal
// notification summary (R1-T6). Caps length so it never dominates the message.
function summarizeHandoff(handoffExcerpt, max = 320) {
  let s = String(handoffExcerpt || "")
    .replace(/^\s*(?:[-*]\s*)?status:\s*(?:complete|blocked|failed)\b[:.]?/im, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`;
  return s;
}

// PURE: honest one-line merge state from the deliverable manifest (R1-T6). A stranded
// draft/open PR is called out as NOT merged; an internal artifact says so plainly.
function mergeStateLine(manifest) {
  if (manifest && manifest.merged === true) return "merged to main";
  if (manifest && manifest.prUrl) return "PR open — not merged yet";
  return "completed (no PR — filed artifact)";
}

// PURE (R2-T4): compose a message from content tiers with a no-truncation guarantee
// for the ACTIONABLE tier. The actionable content (a blocker question, a decision ask)
// is always included in full; only the lower tiers (summary, then metadata) yield to
// the channel budget. Guarantees `actionable ⊆ composed` for any input length.
function composeActionableMessage({ header, actionable, summary, metadata }, budget = 3500) {
  const act = String(actionable || "").trim();
  const parts = [];
  if (header) parts.push(String(header).trim());
  if (act) parts.push(act);
  let used = parts.join("\n\n").length;
  const sum = String(summary || "").trim();
  if (sum && used + sum.length + 2 <= budget) {
    parts.push(sum);
    used += sum.length + 2;
  }
  const meta = String(metadata || "").trim();
  if (meta && used + meta.length + 2 <= budget) parts.push(meta);
  return parts.filter(Boolean).join("\n\n");
}

// PURE (R2-T4): compose a blocker notification whose actionable question is NEVER
// truncated (the old 280-char slice cut questions mid-word). The execution id is
// demoted to a metadata suffix; the full question always survives.
function composeBlockerNotification({ executionId, target, question }) {
  return composeActionableMessage({
    header: "⛔ Blocked — needs your decision",
    actionable: question ? String(question).trim() : "(no blocker detail was captured)",
    metadata: `${target} · ${executionId}`,
  });
}

// PURE (M-2, P-2): does a deliverable manifest carry >=1 verifiable artifact — a live
// PR, a resolved commit, actual changed file paths, or an issue/PR/commit URL the
// worker's own handoff comment points at? Evidence-required "done": a terminal
// completion with NONE of these must not render as done — that is the banana9 replay
// bug (a reported "✅ done" for work whose target never actually exists on GitHub).
//
// P-2 — this reuses the SAME extractEvidenceClaims/hasCheckableEvidence text scan the
// ephemeral-worker lane uses on its finalText (I5-2), applied here to the manifest's
// handoffExcerpt (the reportback comment reconstructed by deliverableManifest()). The
// #479 replay: an issue-creation task has no PR/commit/paths, so the old field-only
// check always missed it even though the created issue's URL was right there in the
// worker's own summary.
function hasVerifiableDeliverable(manifest) {
  if (!manifest) return false;
  if (manifest.prUrl || manifest.headSha || (manifest.paths && manifest.paths.length)) return true;
  return hasCheckableEvidence(extractEvidenceClaims(manifest.handoffExcerpt));
}

// PURE (P-2): the single evidence URL to show as proof alongside an internal "done" —
// the manifest's own verified PR link if it has one, else whatever issue/PR/commit URL
// hasVerifiableDeliverable found in the handoff text (same shared extractor).
function manifestEvidenceUrl(manifest) {
  if (!manifest) return "";
  if (manifest.prUrl) return manifest.prUrl;
  const claims = extractEvidenceClaims(manifest.handoffExcerpt);
  return pickEvidenceUrl([...claims.commitUrls, ...claims.prUrls, ...claims.issueUrls]);
}

// PURE: compose the terminal execution notification (R1-T6). Carries the issue title,
// a handoff summary, the honest merge state, and the link — instead of a bare url.
// Actionable content (title, summary, state) is prioritized; the executionId is
// demoted to a suffix. Body budget keeps it readable on a phone.
function composeTerminalNotification({ executionId, target, outward, title, manifest, context }, max = 900) {
  if (!outward) {
    const t = title ? ` — ${title}` : "";
    if (!hasVerifiableDeliverable(manifest)) {
      // #485 / C-07c: a run whose OWN objective declares no deliverable expected (smoke/
      // echo/no-op) completing with nothing checkable is SUCCESS — never "failed".
      if (declaresNoDeliverableExpected(context)) {
        return `✅ Execution completed (no deliverable expected): ${target}${t}.\n(${executionId})`;
      }
      // M-2 / C-07b: nothing checkable behind this "complete" — never render done.
      return `Finished but produced nothing verifiable — treating as failed: no commit, PR, or changed-file evidence for ${target}${t}.\n(${executionId})`;
    }
    // Internal artifact done — short and plain, with the evidence link when there is one.
    const evidence = manifestEvidenceUrl(manifest);
    return `✅ Execution done: ${target}${t}${evidence ? `\n${evidence}` : ""}\n(${executionId})`;
  }
  const head = `✅ Ready for review: ${target}${title ? ` — ${title}` : ""}`;
  const summary = summarizeHandoff(manifest && manifest.handoffExcerpt);
  const state = mergeStateLine(manifest);
  const link = (manifest && manifest.prUrl) || "";
  const lines = [head];
  if (summary) lines.push(`\n${summary}`);
  lines.push(`\nState: ${state}.`);
  if (link) lines.push(link);
  lines.push(`(${executionId})`);
  let out = lines.join("\n");
  if (out.length > max) {
    // Trim the summary first (it is the longest yield-able tier), never the state/link.
    const shorter = summarizeHandoff(manifest && manifest.handoffExcerpt, 120);
    out = [head, shorter ? `\n${shorter}` : "", `\nState: ${state}.`, link, `(${executionId})`]
      .filter(Boolean)
      .join("\n");
  }
  return out;
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
// Retries transient failures with backoff; returns false only after exhausting them
// (or when the lane is unprovisioned) so callers can durably queue the report (#stab T2).
async function reportToEpaminon(path, body, attempts = 3) {
  const secret = await ensureLaneSecret();
  if (!secret) {
    log(`exec-lane not provisioned — cannot report ${path} ${body.execution_id}`);
    return false;
  }
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${EPAMINON_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Lane-Secret": secret },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      // 4xx (except 429) won't fix itself on retry; stop early.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        log(`Epaminon rejected ${path} ${body.execution_id} (HTTP ${res.status}) — not retrying`);
        return false;
      }
      log(`Epaminon ${path} ${body.execution_id} HTTP ${res.status} (attempt ${i + 1}/${attempts})`);
    } catch (e) {
      log(`report ${path} ${body.execution_id} failed (attempt ${i + 1}/${attempts}):`, e.message);
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  return false;
}

// Deliver a report to Epaminon, notifying on success. If it cannot be delivered,
// persist it to state.pendingReports so the scan loop re-flushes it — an execution
// outcome is never silently dropped (#stab T2). Loads/saves state itself so it is
// safe to call from detached child-exit handlers that hold no scan state.
async function dispatchReport(path, body, notifyText) {
  const ok = await reportToEpaminon(path, body);
  if (ok) {
    if (notifyText) await notify(notifyText);
    return true;
  }
  const state = loadState();
  if (!state.pendingReports) state.pendingReports = {};
  state.pendingReports[`${path}|${body.execution_id}`] = {
    path,
    body,
    notifyText: notifyText || "",
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  saveState(state);
  log(`queued pending report ${path} ${body.execution_id} for later flush`);
  return false;
}

// Re-attempt every undelivered report. Mutates `state` (caller saves). Epaminon's
// reportOutcome/reportBlocked tolerate duplicate/out-of-order callbacks, so retrying
// a report that actually landed is harmless.
async function flushPendingReports(state) {
  const pending = state.pendingReports || {};
  for (const [key, p] of Object.entries(pending)) {
    const ok = await reportToEpaminon(p.path, p.body);
    if (ok) {
      if (p.notifyText) await notify(p.notifyText);
      delete pending[key];
      log(`flushed pending report ${key}`);
    } else {
      p.attempts = (p.attempts || 0) + 1;
      p.lastTryAt = new Date().toISOString();
    }
  }
}

// Is a (possibly reparented, detached) PID still alive? signal 0 probes existence
// without sending a real signal. EPERM means it exists but isn't ours.
function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// Read the last `maxBytes` of a file (the diagnostic tail). Empty string if absent.
// Used to surface a failed Codex run's stderr/stream in its execution note (#stab T1).
function tailFile(path, maxBytes = 4000) {
  try {
    const size = statSync(path).size;
    if (size === 0) return "";
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, start);
      const text = buf.toString("utf8").replace(/\s+/g, " ").trim();
      return start > 0 ? `…${text}` : text;
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
}

// S-1 (a/c): upload a run's full events.jsonl to Epaminon's durable transcript store,
// keyed by execution id, so the whole stream survives the workdir being wiped + deploys.
// A very large stream is truncated to its last `maxBytes` with a leading marker (the tail
// is the diagnostically valuable part). Returns the resolving transcript URL, or "" if the
// upload could not be delivered (best-effort — never blocks the terminal report).
async function uploadTranscript(executionId, eventsPath, maxBytes = 2_000_000) {
  const secret = await ensureLaneSecret();
  if (!secret) return "";
  let content;
  try {
    const size = statSync(eventsPath).size;
    if (size <= maxBytes) {
      content = readFileSync(eventsPath, "utf8");
    } else {
      const start = size - maxBytes;
      const fd = openSync(eventsPath, "r");
      try {
        const buf = Buffer.alloc(maxBytes);
        readSync(fd, buf, 0, maxBytes, start);
        content = `{"type":"transcript.truncated","droppedBytes":${start},"note":"showing last ${maxBytes} bytes of ${size}"}\n${buf.toString("utf8")}`;
      } finally {
        closeSync(fd);
      }
    }
  } catch {
    return ""; // no stream on disk (e.g. a spawn that never wrote) — nothing to persist
  }
  try {
    const res = await fetch(`${EPAMINON_URL}/api/exec/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Lane-Secret": secret },
      body: JSON.stringify({ execution_id: executionId, content }),
    });
    if (!res.ok) {
      log(`transcript upload for ${executionId} HTTP ${res.status}`);
      return "";
    }
    const j = await res.json().catch(() => ({}));
    return j && j.url ? String(j.url) : "";
  } catch (e) {
    log(`transcript upload for ${executionId} failed: ${e.message}`);
    return "";
  }
}

// PURE: pull verifiable evidence (GitHub commit/PR/issue URLs) out of a final handoff
// so a "complete" claim can be checked before it is accepted as done (#stab T3, I5-2).
// Returns the distinct commit, PR, and issue URLs the worker claims as proof of its
// work. Issue URLs are first-class evidence: an issue-creation task has no commit/PR
// to point at, so without this an issue-creation "complete" always read as unverified.
function extractEvidenceClaims(finalText) {
  const text = String(finalText || "");
  const commitUrls = [
    ...new Set((text.match(/https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/commit\/[0-9a-f]{7,40}/gi) || []).map((u) => u.replace(/[).,]+$/, ""))),
  ];
  const prUrls = [
    ...new Set((text.match(/https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/gi) || []).map((u) => u.replace(/[).,]+$/, ""))),
  ];
  const issueUrls = [
    ...new Set((text.match(/https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+/gi) || []).map((u) => u.replace(/[).,]+$/, ""))),
  ];
  return { commitUrls, prUrls, issueUrls };
}

// Probe gh without throwing (the strict `gh()` throws on non-zero); returns ok flag.
function ghProbe(args) {
  try {
    const r = spawnSync("gh", args, { encoding: "utf8" });
    return { ok: r.status === 0, out: r.stdout || "", err: r.stderr || "" };
  } catch (e) {
    return { ok: false, out: "", err: e.message };
  }
}

// Verify claimed commit/PR/issue URLs actually exist on GitHub. Returns the verified
// and the missing (404) URLs. Network/auth failures are treated as "unconfirmed", NOT
// missing, so a flaky gh call can never fabricate a false "evidence not found" downgrade.
function verifyEvidenceClaims(claims) {
  const verified = [];
  const missing = [];
  const unconfirmed = [];
  const commitRe = /github\.com\/([^/\s]+)\/([^/\s]+)\/commit\/([0-9a-f]{7,40})/i;
  const prRe = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i;
  const issueRe = /github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/i;
  for (const url of claims.commitUrls) {
    const m = url.match(commitRe);
    if (!m) continue;
    const probe = ghProbe(["api", `repos/${m[1]}/${m[2]}/commits/${m[3]}`, "--jq", ".sha"]);
    if (probe.ok) verified.push(url);
    else if (/Not Found|HTTP 404|No commit found/i.test(probe.err)) missing.push(url);
    else unconfirmed.push(url);
  }
  for (const url of claims.prUrls) {
    const m = url.match(prRe);
    if (!m) continue;
    const probe = ghProbe(["api", `repos/${m[1]}/${m[2]}/pulls/${m[3]}`, "--jq", ".number"]);
    if (probe.ok) verified.push(url);
    else if (/Not Found|HTTP 404/i.test(probe.err)) missing.push(url);
    else unconfirmed.push(url);
  }
  for (const url of claims.issueUrls ?? []) {
    const m = url.match(issueRe);
    if (!m) continue;
    const probe = ghProbe(["api", `repos/${m[1]}/${m[2]}/issues/${m[3]}`, "--jq", ".number"]);
    if (probe.ok) verified.push(url);
    else if (/Not Found|HTTP 404/i.test(probe.err)) missing.push(url);
    else unconfirmed.push(url);
  }
  return { verified, missing, unconfirmed };
}

async function markDispatchedLaunchBlocked(executionId, target, note) {
  const state = loadState();
  const d = state.dispatched?.[executionId];
  if (!d || d.reportedStatus) return;
  d.reportedStatus = "launch-blocked";
  d.launchBlocker = note;
  d.launchBlockedAt = new Date().toISOString();
  saveState(state);
  const ok = await reportToEpaminon("/api/exec/blocked", { execution_id: executionId, note });
  if (ok) await notify(`⛔ Execution ${executionId} (${target}) — launch blocked: ${note}`);
}

function noteFromFinalText(finalText, fallback) {
  const compact = String(finalText || "").trim().replace(/\s+/g, " ");
  return compact ? compact.slice(0, 1000) : fallback;
}

// PURE (I5-2): does this evidence claim set carry ANY checkable URL — commit, PR, or
// issue? An issue-creation task has no commit/PR to point at; without issueUrls in this
// check, every such task fell through to the "nothing checkable" branch even when the
// issue was really created.
function hasCheckableEvidence(claims) {
  return Boolean(claims.commitUrls.length || claims.prUrls.length || (claims.issueUrls ?? []).length);
}

// PURE (I5-2): pick the ticket's evidence URL from a set of verified claims. A PR
// supersedes a commit supersedes a bare issue link when several are present, but a
// bare verified issue URL is real evidence in its own right — it is the deliverable
// for an issue-creation task, not a downgrade from "unverified".
function pickEvidenceUrl(verified) {
  return verified.find((u) => /\/pull\//.test(u)) || verified.find((u) => /\/commit\//.test(u)) || verified[0];
}

// PURE: "merge by default" opt-out detector. An execution's resulting PR gets GitHub
// auto-merge enabled by the CONTROLLER (deterministic, never the worker's LLM). A task
// can suppress that only via an EXPLICIT signal in its context/objective — the marker
// `HOLD-FOR-REVIEW` (case-insensitive) or a `noAutoMerge`/`hold` flag folded into the
// context text. No signal = auto-merge ON. This is intentionally strict: only an
// unambiguous marker holds a PR open; ambiguous prose does not.
const HOLD_FOR_REVIEW_RE = /\b(HOLD-FOR-REVIEW|noAutoMerge|no-auto-merge)\b/i;
function wantsHoldForReview(context) {
  return HOLD_FOR_REVIEW_RE.test(String(context || ""));
}

// PURE (#485 / C-07c): does THIS run's own objective/artifact-policy declare that NO
// deliverable is expected — a smoke / echo / no-op run whose whole point is to return a
// summary and change nothing? Such a run completing with no commit/PR/issue is SUCCESS,
// not the C-07b "produced nothing verifiable" failure. Keyed off the run's DECLARED
// policy (the controller-authored objective/artifactPolicy text), never the worker's
// output — so a worker cannot dodge the evidence bar by claiming its task was a no-op.
// A run that WAS supposed to produce a deliverable and didn't carries none of these
// markers and still renders the honest failed-to-produce message (C-07b unchanged).
// FB-2 / #485 (C-07c): match no-deliverable INTENT, not one exact phrase. The old
// marker-only regex mislabeled real no-op runs as "failed: nothing verifiable":
// the C-10 probe ("Trivial echo … no repo work") and the C-21 summary run ("no
// deliverable/PR expected" — the "/PR" broke the contiguous "no deliverable expected"
// match). Broadened to the common ways a controller declares a run produces nothing:
// smoke/echo/no-op runs, "no deliverable" (however punctuated), summary/report-only,
// and explicit no-repo/no-code declarations. A run that WAS meant to produce a
// deliverable carries none of these and still renders the honest failed-to-produce
// message (C-07b unchanged). Deterministic; reads the controller policy, not worker output.
const NO_DELIVERABLE_EXPECTED_RE =
  /\bNO-DELIVERABLE-EXPECTED\b|\bno[- ]?op\b|\bsmoke\b|\btrivial echo\b|\becho ["'`]|\bno deliverable\b|no deliverable(?:[ /]\S+)? expected|return (?:the )?(?:summary|result) only|summary in the final message|make no (?:code or file|file or code) changes|\bno repo work\b|\bno code(?:, ?| or )(?:no )?(?:issue|pr|file)/i;
function declaresNoDeliverableExpected(context) {
  return NO_DELIVERABLE_EXPECTED_RE.test(String(context || ""));
}

// PURE: pull owner/repo out of a github PR URL so the controller can address `gh pr
// merge -R <owner/repo>` without depending on the runner's cwd/checkout.
function repoFromPrUrl(url) {
  const m = String(url || "").match(/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/\d+/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

// CONTROLLER enforcement of "merge by default": enable GitHub auto-merge (merge when the
// branch-protected `ci` check is green; never on red) on a verified PR via
// `gh pr merge <pr> -R <repo> --auto --squash`. This is deterministic — no LLM decides
// whether to merge. It never does an immediate/unconditional merge, so the CI gate always
// holds. Returns an observable outcome: `enabled` | `already-merged` | `held` |
// `no-pr` | `failed`, plus a human detail string for logging.
//   - held: the task opted out (HOLD-FOR-REVIEW / noAutoMerge) — skip, leave PR open.
//   - no-pr: no verifiable PR URL — skip (do NOT guess a PR to merge).
// `runner` is injectable for tests (defaults to the real `gh` via spawnSync).
function enableAutoMergeForPr(prUrl, { hold = false, runner } = {}) {
  const exec =
    runner ||
    ((args) => {
      const r = spawnSync("gh", args, { encoding: "utf8" });
      return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
    });
  if (hold) return { outcome: "held", detail: "task requested HOLD-FOR-REVIEW — auto-merge not enabled" };
  const repo = repoFromPrUrl(prUrl);
  if (!prUrl || !repo) return { outcome: "no-pr", detail: "no verifiable PR; auto-merge skipped" };
  const r = exec(["pr", "merge", prUrl, "-R", repo, "--auto", "--squash"]);
  if (r.status === 0) return { outcome: "enabled", detail: `auto-merge enabled on ${prUrl}` };
  const err = `${r.stdout}\n${r.stderr}`;
  if (/already merged|not mergeable: the merge commit|Pull request is already merged/i.test(err)) {
    return { outcome: "already-merged", detail: `${prUrl} already merged` };
  }
  return { outcome: "failed", detail: `gh pr merge failed for ${prUrl}: ${err.trim().slice(0, 500)}` };
}

async function reportEphemeralFinished(executionId, target, exitCode, finalPath) {
  const finalText = existsSync(finalPath) ? readFileSync(finalPath, "utf8") : "";
  let stateName = ephemeralFinalState(exitCode, finalText);
  let note = noteFromFinalText(finalText, `ephemeral worker exited with code ${exitCode ?? "unknown"}`);
  let evidenceUrl = "";
  let autoMergeEvent = null;
  const persisted = loadState();
  const entry = persisted.ephemeral?.[executionId];
  if (entry?.reportedStatus) return;
  const eventsPath = entry?.eventsPath || ephemeralRunPaths(executionId).eventsPath;

  // C-17: a run terminated by the budget sweep is an honest budget failure with the
  // transcript link (the dispatch path appends it), notified as a failure — never the
  // generic "produced nothing verifiable" path, and never a quota pause.
  if (entry?.budgetKill) {
    note = `budget exceeded: ${entry.budgetKill}. Terminated by the run budget (C-17) — nothing verifiable.`;
    stateName = "failed";
  }

  // #506: quota death with no fallback engine (both CLIs dry) is an ACCOUNT pause, not a
  // task failure — and must NOT go down the "produced nothing verifiable → failed" path.
  // Report an honest paused state with a retry-after time. (When a fallback engine IS
  // available, ephemeralFallbackDecision already replayed on it before we got here.)
  if (!entry?.budgetKill && exitCode !== 0) {
    const quotaError = extractWorkerError(eventsPath);
    if (isPausedQuota(quotaError, entry?.engine || "claude")) {
      const paused = pauseMessage(executionId, quotaError, { target });
      if (!persisted.ephemeral) persisted.ephemeral = {};
      persisted.ephemeral[executionId] = {
        ...(entry ?? { target }),
        reportedStatus: "paused",
        finishedAt: new Date().toISOString(),
        exitCode,
        finalPath,
        eventsPath,
        pausedReason: quotaError,
      };
      saveState(persisted);
      await dispatchReport("/api/exec/blocked", { execution_id: executionId, note: paused }, paused);
      return;
    }
  }

  // T3 anti-hallucination: a "complete" claim with a commit/PR/issue URL must point at
  // real GitHub objects. Fabricated evidence (a SHA/PR/issue that does not exist) is
  // downgraded to blocked rather than reported as done. Verified URLs become the
  // ticket's evidence.
  if (stateName === "complete") {
    const claims = extractEvidenceClaims(finalText);
    if (hasCheckableEvidence(claims)) {
      const { verified, missing } = verifyEvidenceClaims(claims);
      if (missing.length) {
        stateName = "failed";
        note = `claimed evidence not found on GitHub: ${missing.join(", ")} — not accepting as done. ${note}`.slice(0, 1000);
      } else if (verified.length) {
        evidenceUrl = pickEvidenceUrl(verified);
        // "Merge by default" (controller-enforced): the resulting PR gets GitHub
        // auto-merge enabled automatically so it merges once `ci` is green — UNLESS the
        // task opted out (HOLD-FOR-REVIEW / noAutoMerge, captured at launch). Keyed off a
        // VERIFIED PR URL only; if none is verifiable we skip and log rather than guess.
        // Deterministic: no LLM decides whether to merge.
        const verifiedPr = verified.find((u) => /\/pull\//.test(u)) || "";
        const merge = enableAutoMergeForPr(verifiedPr, { hold: entry?.holdForReview === true });
        log(`ephemeral ${executionId} auto-merge: ${merge.outcome} — ${merge.detail}`);
        autoMergeEvent = { url: verifiedPr || null, outcome: merge.outcome, detail: merge.detail };
      }
    } else if (declaresNoDeliverableExpected(entry?.context)) {
      // #485 / C-07c: this run's OWN objective/artifact-policy declares no deliverable
      // expected (smoke/echo/no-op). Completing with nothing checkable is SUCCESS — stays
      // `complete`, rendered as "completed (no deliverable expected)". Keyed off the
      // declared policy, never the worker's output, so a real deliverable-bearing task
      // (C-07b) cannot dodge the evidence bar this way.
      note = `completed (no deliverable expected): ${note}`.slice(0, 1000);
    } else {
      // M-2/I5-2 — evidence-required "done": a terminal run that claims complete but
      // carries ZERO checkable deliverable (no commit/PR/issue URL anywhere in its
      // final summary) must not render as done — "✅ done" with nothing behind it is
      // the exact banana9 replay bug (a reported success with no issue that exists).
      // Downgrade to failed and notify as a failure, same as a verified-missing claim.
      stateName = "failed";
      note = `Finished but produced nothing verifiable — treating as failed: no commit/PR/issue URL in the final summary. ${note}`.slice(0, 1000);
    }
  }

  // T1 traceability: a failed/blocked run, or one that produced no final message, must
  // carry the diagnostic tail of its Codex stream so `execution_status` can answer
  // "what went wrong?" — instead of the bare "exited with code N".
  if (stateName !== "complete" || !finalText.trim()) {
    const tail = tailFile(eventsPath);
    if (tail) note = `${note}\n--- log tail ---\n${tail}`.slice(0, 1800);
  }

  // S-1 (a/c): persist the whole events.jsonl to durable storage keyed by execution id
  // BEFORE reporting terminal, so the completion/blocked notification can link the full
  // transcript — and it resolves after the workdir is wiped. Best-effort; a failed upload
  // just omits the link (the run still reports its outcome).
  const transcriptUrl = await uploadTranscript(executionId, eventsPath);

  if (!persisted.ephemeral) persisted.ephemeral = {};
  persisted.ephemeral[executionId] = {
    ...(entry ?? { target }),
    reportedStatus: stateName,
    finishedAt: new Date().toISOString(),
    exitCode,
    finalPath,
    eventsPath,
    ...(evidenceUrl ? { evidenceUrl } : {}),
    ...(transcriptUrl ? { transcriptUrl } : {}),
    ...(autoMergeEvent ? { autoMerge: autoMergeEvent } : {}),
  };
  saveState(persisted);

  const transcriptLine = transcriptUrl ? `\nFull transcript: ${transcriptUrl}` : "";

  if (stateName === "complete") {
    // C-07c: a declared-no-deliverable smoke/echo/no-op run reads "completed (no
    // deliverable expected)", never a bare "done" that implies a produced artifact.
    const doneText =
      !evidenceUrl && declaresNoDeliverableExpected(entry?.context)
        ? `✅ Execution ${executionId} (${target}) — completed (no deliverable expected).${transcriptLine}`
        : `✅ Execution ${executionId} (${target}) — done.${evidenceUrl ? ` ${evidenceUrl}` : ""}${transcriptLine}`;
    await dispatchReport(
      "/api/exec/outcome",
      { execution_id: executionId, outward: false, note: `${note}${transcriptLine}`, ...(evidenceUrl ? { evidence_url: evidenceUrl } : {}) },
      doneText,
    );
    return;
  }

  const blockedNote = stateName === "blocked" ? note : `ephemeral worker failed: ${note}`;
  await dispatchReport(
    "/api/exec/blocked",
    { execution_id: executionId, note: `${blockedNote}${transcriptLine}` },
    `⛔ Execution ${executionId} (${target}) — ${stateName}: ${blockedNote.slice(0, 240)}${transcriptLine}`,
  );
}

// Recover ephemeral runs whose child-exit callback was lost (monitor restart, OOM-killed
// child, etc.): the PID is gone but no outcome was ever reported. Without this they stay
// at running/queued forever with no trace (#stab T2). reportEphemeralFinished is idempotent
// (guards on reportedStatus), so re-reporting an already-reported run is a no-op.
// I8-2 (durable executor / C-21): a run whose worker vanished with NO terminal
// outcome was almost always killed by a redeploy, not by finishing. Rather than
// reporting it dead (the pre-I8-2 "interrupted by a server restart" behavior),
// resume it — re-launch the worker — up to a durable attempt ceiling. A worker
// that DID finish (final.md / terminal event present) is reported, not resumed.
// The attempt count lives on the (durable) monitor state, so the ceiling holds
// across restarts and a genuinely-broken run can't resume forever.
const EPHEMERAL_MAX_ATTEMPTS = Number(process.env.ZENOD_EPHEMERAL_MAX_ATTEMPTS || 3);

// S-7 / C-17 — hard per-run budget: a runaway ("zombie") run is TERMINATED, not just
// warned. Standing rule (Jordi, 2026-07-03): 400+ turns / 30+ min / zero output is
// intolerable. Defaults: 60 min wall, 200 turns (overridable per env). The ceiling
// lives OUTSIDE the model loop (in the monitor), so it holds regardless of the worker.
const EPHEMERAL_BUDGET_MS = Number(process.env.ZENOD_EPHEMERAL_BUDGET_MS || 60 * 60 * 1000);
const EPHEMERAL_BUDGET_TURNS = Number(process.env.ZENOD_EPHEMERAL_BUDGET_TURNS || 200);

/**
 * PURE decision (C-17): should a running ephemeral be killed for breaching its budget?
 * Wall-clock OR turn ceiling — whichever trips first. Returns {kill, reason}.
 */
export function budgetKillDecision({ elapsedMs = 0, turns = 0, maxMs = EPHEMERAL_BUDGET_MS, maxTurns = EPHEMERAL_BUDGET_TURNS }) {
  if (elapsedMs > maxMs) return { kill: true, reason: `wall-clock budget exceeded: ${Math.round(elapsedMs / 60000)}m > ${Math.round(maxMs / 60000)}m` };
  if (turns > maxTurns) return { kill: true, reason: `turn budget exceeded: ${turns} > ${maxTurns} turns` };
  return { kill: false };
}

/**
 * Per-run budget override (B1 prerequisite, not test scaffolding). A run's task
 * context may declare its OWN ceiling — this is exactly the mechanism lane files
 * use (`budget {minutes, turns}`). Parsed here from the context text; falls back
 * to the env default (EPHEMERAL_BUDGET_MS/TURNS) when absent. Only honoured when
 * the context mentions "budget" (so an incidental "5 minutes" in a mission body
 * never silently caps a run). Returns {} when nothing is declared.
 */
export function parseRunBudget(context) {
  const s = String(context || "");
  if (!/budget/i.test(s)) return {};
  const out = {};
  // Both the natural form ("3 min", "10 turns") and the structured lane form
  // ("minutes: 5", "turns: 40") — number before OR after the unit word.
  const minutes = s.match(/(\d+)\s*(?:min\b|mins\b|minutes?)/i) || s.match(/minutes?\s*[:=]\s*(\d+)/i);
  const turns = s.match(/(\d+)\s*turns?\b/i) || s.match(/turns?\s*[:=]\s*(\d+)/i);
  if (minutes) out.maxMs = Number(minutes[1]) * 60 * 1000;
  if (turns) out.maxTurns = Number(turns[1]);
  return out;
}

/** Did the worker reach a real terminal outcome (finished), vs. get killed mid-run? */
function hasTerminalOutcome(paths) {
  try {
    if (existsSync(paths.finalPath) && readFileSync(paths.finalPath, "utf8").trim()) return true;
  } catch {
    /* unreadable → treat as no terminal */
  }
  try {
    if (existsSync(paths.eventsPath)) {
      for (const line of readFileSync(paths.eventsPath, "utf8").split("\n")) {
        const t = line.trim();
        if (!t) continue;
        let ev;
        try {
          ev = JSON.parse(t);
        } catch {
          continue;
        }
        if (ev?.type === "result") return true; // claude/codex terminal result event
      }
    }
  } catch {
    /* unreadable → treat as no terminal */
  }
  return false;
}

/**
 * PURE decision (C-21): given whether the worker finished and how many attempts a
 * run has already had, decide to RESUME (re-launch) or REPORT (give up / deliver).
 * - terminal outcome present  → report (the worker finished; the exit callback was lost)
 * - no terminal + under ceiling → resume (a redeploy killed it; run it again)
 * - no terminal + at ceiling   → report failed (don't resume forever)
 */
export function ephemeralResumeDecision({ hasTerminal, attempts, maxAttempts = EPHEMERAL_MAX_ATTEMPTS }) {
  if (hasTerminal) return { action: "report", reason: "worker reached a terminal outcome" };
  if ((attempts ?? 1) < maxAttempts) return { action: "resume", reason: `no terminal outcome; resuming (attempt ${(attempts ?? 1) + 1}/${maxAttempts})` };
  return { action: "report", reason: `no terminal outcome after ${attempts ?? 1} attempt(s); giving up` };
}

async function sweepStaleEphemeral(state) {
  for (const [executionId, e] of Object.entries(state.ephemeral || {})) {
    if (!e || e.reportedStatus || !e.pid) continue;
    if (isPidAlive(e.pid)) continue;
    const paths = ephemeralRunPaths(executionId);
    const decision = ephemeralResumeDecision({ hasTerminal: hasTerminalOutcome(paths), attempts: e.attempts ?? 1 });
    if (decision.action === "resume") {
      log(`sweep: ephemeral ${executionId} pid ${e.pid} gone, ${decision.reason} — durable resume`);
      appendRecord(paths.journalPath, { kind: "resume", runId: executionId, from: "server-restart", attempt: (e.attempts ?? 1) + 1, at: new Date().toISOString() });
      e.pid = null; // clear the dead pid so launchEphemeral's duplicate guard lets the resume through
      launchEphemeral(executionId, e.target, e.context ?? "", state);
      continue;
    }
    log(`sweep: ephemeral ${executionId} pid ${e.pid} is gone with no outcome — reporting (${decision.reason})`);
    await reportEphemeralFinished(executionId, e.target, e.exitCode ?? 1, e.finalPath || paths.finalPath);
  }
}

// Is a CLI on PATH? Mirrors fanout-codex's commandExists (not exported there) so the
// ephemeral fallback only swaps to an engine that is actually installed in the runner.
function commandExists(cmd) {
  return spawnSync("sh", ["-lc", `command -v '${String(cmd).replaceAll("'", "'\\''")}'`], { encoding: "utf8" }).status === 0;
}

// PURE: decide whether an exited ephemeral run should be replayed on the other engine.
// Same semantics as the fanout lane (W0): the ERROR CLASS decides — a non-zero exit
// whose events-stream error is a usage-limit / 429 / billing / insufficient_quota
// failure — and only if the other engine's CLI is installed. Replay AT MOST ONCE:
// callers pass alreadyFellBack=true on the second attempt to hard-stop the loop.
function ephemeralFallbackDecision({ exitCode, rawError, engine, alreadyFellBack, hasCommand = commandExists }) {
  if (alreadyFellBack) return { fallback: false };
  if (exitCode === 0) return { fallback: false };
  if (!isQuotaError(rawError)) return { fallback: false };
  const nextEngine = fallbackEngine(engine);
  if (!hasCommand(nextEngine)) return { fallback: false };
  return { fallback: true, nextEngine };
}

// ---- Live-progress heartbeat (execution-progress campaign) ----
//
// The controller watches the streamed events log it ALREADY parses (same events.jsonl
// used by extractWorkerError / extractFinalFromEvents) and derives progress from what it
// can OBSERVE — turn count, the last tool/event seen, the timestamp of the last activity.
// A worker LLM claiming "50% done" is the fabrication pattern this whole campaign exists to
// avoid; none of the fields below come from the worker's prose.

// PURE: format a millisecond duration as a compact human label ("42m", "1h05m", "38s").
function formatElapsed(ms) {
  const s = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, "0")}m`;
}

// PURE (F-2 / C-09): derive a COARSE phase label from the last controller-observed tool/
// event — never from the worker's own prose. The last tool the stream actually ran maps to
// a plain-English phase (exploring / editing / testing / committing / reviewing / working).
// This is structure, not self-report: a worker cannot fake it by claiming "50% done".
function derivePhase(lastEvent) {
  const e = String(lastEvent || "").toLowerCase();
  if (!e) return "starting up";
  if (/\bpr\b|pull|merge|review/.test(e)) return "reviewing";
  if (/commit|push|git/.test(e)) return "committing";
  if (/test|check|lint|build|npm|node --test|pytest|vitest|ci\b/.test(e)) return "testing";
  if (/edit|write|apply_patch|patch|create_file|update_file|str_replace/.test(e)) return "editing";
  if (/read|grep|search|find|ls\b|cat\b|glob|explore|view/.test(e)) return "exploring";
  if (/shell|command|bash|exec|run/.test(e)) return "running commands";
  return "working";
}

// PURE (F-2 / C-09): one compact human line describing where a run is right now —
// "editing · 42m elapsed · 187 turns · last: apply_patch". Built from controller-observed
// telemetry only. Reused by the channel-facing longrun ping and execution_status.
function phaseSummary({ elapsedMs, phase, turns, lastEvent, lastPartial } = {}) {
  const parts = [phase || "working", `${formatElapsed(elapsedMs)} elapsed`];
  if (turns) parts.push(`${turns} turns`);
  if (lastEvent) parts.push(`last: ${lastEvent}`);
  let line = parts.join(" · ");
  if (lastPartial) line += `\n"${lastPartial}"`;
  return line;
}

// PURE: reduce a streamed events log (the JSONL the worker emits, one event per line) to
// controller-observed telemetry — turn count, the last meaningful event/tool label, and the
// timestamp of the most recent activity. Handles BOTH engine dialects (codex `item.*` /
// `turn.*`, claude stream-json `assistant`/`tool_use`/`result`). Never reads the worker's
// text as a progress claim — only the STRUCTURE of the stream (which tool ran, how many
// turns) counts. Missing/empty log → zeroed observation.
function parseHeartbeatObservation(eventsPath, now = Date.now()) {
  const obs = { turns: 0, toolCalls: 0, lastEvent: "", lastPartial: "", lastActivityMs: null, recentEvents: [] };
  let raw;
  try {
    raw = readFileSync(eventsPath, "utf8");
  } catch {
    return obs;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const type = String(ev?.type || "");
    // Turn boundaries: codex emits turn.* / item.completed(kind=assistant); claude emits
    // one `assistant` event per model turn.
    if (type === "turn.completed" || type === "turn.started" || type === "assistant") obs.turns += 1;
    // Tool activity + a human label for "last: <tool>".
    let label = "";
    if (type === "item.started" || type === "item.completed") {
      const item = ev.item || {};
      const kind = String(item.type || item.item_type || "");
      if (kind.includes("command") || kind.includes("tool") || kind.includes("function")) {
        obs.toolCalls += 1;
        label = String(item.name || item.command || item.tool || kind || "").slice(0, 60);
      } else if (kind) {
        label = kind.slice(0, 60);
      }
    } else if (type === "assistant" && ev.message?.content) {
      const tool = (ev.message.content || []).find((c) => c && c.type === "tool_use");
      if (tool) {
        obs.toolCalls += 1;
        label = String(tool.name || "").slice(0, 60);
      }
      // Coarse "last partial": the most recent assistant text — a controller-observed
      // snippet of what the worker last said, NOT a self-reported percentage. Kept short.
      const text = (ev.message.content || []).find((c) => c && c.type === "text" && c.text);
      if (text) obs.lastPartial = String(text.text).replace(/\s+/g, " ").trim().slice(0, 140);
    } else if (type === "item.completed" && ev.item?.type && String(ev.item.type).includes("message")) {
      // codex reasoning/message items carry the worker's prose in item.text/content.
      const t = String(ev.item.text || ev.item.content || "").replace(/\s+/g, " ").trim();
      if (t) obs.lastPartial = t.slice(0, 140);
    } else if (type === "tool_use" || type === "tool_call") {
      obs.toolCalls += 1;
      label = String(ev.name || ev.tool || "").slice(0, 60);
    } else if (type) {
      label = type;
    }
    if (label) {
      obs.lastEvent = label;
      // S-1 (b): keep a rolling window of the last few observed event labels so
      // execution_status can show a real activity trail, not just the single last one.
      obs.recentEvents.push(label);
      if (obs.recentEvents.length > 8) obs.recentEvents.shift();
    }
    // Any parseable line counts as activity (the stream advanced). Prefer an explicit
    // event timestamp when present; else treat "now" as the observation time.
    const ts = Date.parse(ev.timestamp || ev.at || ev.ts || "");
    obs.lastActivityMs = Number.isFinite(ts) ? ts : now;
  }
  return obs;
}

// PURE (watchdog reuse — #477 M-5): has the worker gone quiet? True when the age since the
// last observed activity crosses the stall threshold. Mirrors detectStuckIngestJobs' "active
// for > threshold with no progress" decision. Unknown last-activity is treated as NOT stalled
// (we only alarm on positive evidence of silence, never on missing data).
function heartbeatStalled(lastActivityMs, now = Date.now(), thresholdMs = HEARTBEAT_STALL_MS) {
  if (!Number.isFinite(lastActivityMs)) return false;
  return now - lastActivityMs > thresholdMs;
}

// PURE: render the pinned heartbeat comment body from controller-observed data ONLY. Carries
// a hidden marker so the controller can find + edit THIS comment in place instead of spamming
// a new one each interval. Example:
//   ⏳ Running — 42m elapsed · 187 turns · last: edit_file · no terminal yet.
function renderHeartbeat({ elapsedMs, turns, toolCalls, lastEvent, lastPartial, phase, stalled, staleMs, now = Date.now() }) {
  const ph = phase || derivePhase(lastEvent);
  // F-2 / C-09: lead with the coarse PHASE, not just the turn count.
  const parts = [ph, `${formatElapsed(elapsedMs)} elapsed`];
  if (turns) parts.push(`${turns} turns`);
  if (toolCalls) parts.push(`${toolCalls} tool calls`);
  if (lastEvent) parts.push(`last: ${lastEvent}`);
  const lead = stalled
    ? `⚠️ Possibly stalled — no activity for ${formatElapsed(staleMs)}`
    : `⏳ Running — ${parts.join(" · ")} · no terminal yet`;
  let body = stalled ? `${lead} · ${parts.join(" · ")}.` : `${lead}.`;
  // Surface the last controller-observed partial (what the worker last said) when present.
  if (lastPartial) body += `\nLast: "${lastPartial}"`;
  return `${HEARTBEAT_MARKER}\n${body}\n\n_Controller-observed telemetry (not worker self-report) · updated ${new Date(now).toISOString()}_`;
}

// PURE: interval gate — should the controller refresh the heartbeat now? True on the first
// post (no prior stamp), once the interval has elapsed since the last post, or when the
// stalled-state changed (so the flip to/from "possibly stalled" lands immediately, not at the
// next tick). Deterministic; caller passes `now`.
function shouldUpdateHeartbeat(hb, now, stalled, intervalMs = HEARTBEAT_INTERVAL_MS) {
  if (!hb || !hb.lastPostedAt) return true;
  if (Boolean(hb.stalled) !== Boolean(stalled)) return true;
  return now - hb.lastPostedAt >= intervalMs;
}

// PURE (Tier 2): which coarse milestone, if any, to raise to Phylax this observation — and
// ONLY these: `start` (once, at first heartbeat), `longrun` (one reminder once elapsed crosses
// the long-run mark), `stalled` (once when it first goes quiet). Terminal is raised by the
// existing terminal-notification path, not here. Returns null when no NEW milestone is due —
// so a heartbeat refresh does NOT fire a ping every interval. `fired` is the set of milestone
// keys already sent for this run.
function heartbeatMilestone({ elapsedMs, stalled, fired = {} }, longrunMs = HEARTBEAT_LONGRUN_MS) {
  if (stalled && !fired.stalled) return "stalled";
  if (!fired.start) return "start";
  if (elapsedMs >= longrunMs && !fired.longrun) return "longrun";
  return null;
}

// PURE: resolve the GitHub issue the heartbeat should be posted on for a run entry. A
// dispatched run's target IS "owner/repo#N" (the work ticket). A genuinely-ephemeral run has
// no linked issue by construction, but the console may embed one in the context (the mint-a-
// ticket path leaves an issue URL); parse the FIRST github issue URL if present. Returns null
// when no issue can be determined — the caller then degrades gracefully (log only, no comment)
// rather than crashing the run.
function heartbeatIssueRef(entry) {
  const t = parseTarget(entry?.target);
  if (t) return { repo: t.repo, number: t.number };
  const m = String(entry?.context || "").match(/github\.com\/([^/\s]+\/[^/\s]+)\/issues\/(\d+)/i);
  if (m) return { repo: m[1], number: Number(m[2]) };
  return null;
}

// Find an existing pinned heartbeat comment (by our hidden marker) on an issue, so we EDIT it
// in place instead of posting a new comment every interval. Returns the comment id or null.
function findHeartbeatComment(repo, issueNumber) {
  try {
    const out = gh(["issue", "view", String(issueNumber), "--repo", repo, "--json", "comments"]);
    const comments = JSON.parse(out).comments || [];
    const hit = comments.filter((c) => String(c.body || "").includes(HEARTBEAT_MARKER)).pop();
    if (!hit) return null;
    // gh returns comment `url` as .../issues/N#issuecomment-<id>; the REST edit needs that id.
    const idMatch = String(hit.url || "").match(/issuecomment-(\d+)/);
    return idMatch ? idMatch[1] : null;
  } catch {
    return null;
  }
}

// Post the heartbeat once, then EDIT that same comment on every subsequent update. Returns the
// comment id (for reuse) or null on failure — a heartbeat is best-effort telemetry and must
// never crash or block the run it is reporting on.
function upsertHeartbeatComment(repo, issueNumber, commentId, body) {
  try {
    if (commentId) {
      gh(["api", "-X", "PATCH", `repos/${repo}/issues/comments/${commentId}`, "-f", `body=${body}`, "--jq", ".id"]);
      return commentId;
    }
    const out = gh(["issue", "comment", String(issueNumber), "--repo", repo, "--body", body]);
    const m = out.match(/issuecomment-(\d+)/);
    return m ? m[1] : null;
  } catch (e) {
    log(`heartbeat upsert failed for ${repo}#${issueNumber}: ${e.message}`);
    return null;
  }
}

// Raise ONE Tier-2 coarse milestone ping to Phylax via /api/notify. Keyed to the run (one
// thread, not a firehose) — Phylax owns quiet-hours + dedup. Only start / longrun / stalled
// flow through here; terminal is raised by the existing terminal path.
async function raiseHeartbeatMilestone(kind, entry, obs) {
  const target = entry.target;
  const executionId = entry.executionId || "";
  const key = `${target}|${executionId}|heartbeat.${kind}`;
  // C-08: the start milestone ping must resolve too — carry the ticket/tracking-issue link.
  const startLink = resolvingLinkForRun({ target, context: entry.context });
  const text =
    kind === "start"
      ? `🤖 Execution started — ${target}.${startLink ? `\n${startLink}` : " Live progress on its ticket."}`
      : kind === "longrun"
        ? // F-2 / C-09: the mid-run channel update carries PHASE + last partial, not just turns.
          `⏳ Still running — ${target}\n${phaseSummary({ elapsedMs: obs.elapsedMs, phase: obs.phase, turns: obs.turns, lastEvent: obs.lastEvent, lastPartial: obs.lastPartial })}${startLink ? `\n${startLink}` : ""}`
        : `⚠️ Execution may be stalled — ${target} · no activity for ${formatElapsed(obs.staleMs)}.`;
  const severity = kind === "stalled" ? "action" : "info";
  await notify(text, entry.origin, {
    eventType: `execution.heartbeat.${kind}`,
    executionId,
    targetIssue: target,
    severity,
    dedupeKey: key,
  });
}

// Per-scan heartbeat sweep: for every non-terminal run (ephemeral + dispatched) the controller
// is tracking, observe its events log and refresh the pinned comment on interval / on a state
// flip, raising the coarse Tier-2 milestones. Effectful but fully degrade-safe: a run with no
// resolvable issue logs locally and skips the comment; any gh failure is swallowed. Mutates
// `state.heartbeats` (caller saves).
function activeHeartbeatRuns(state) {
  const runs = [];
  for (const [executionId, e] of Object.entries(state.ephemeral || {})) {
    if (e && !e.reportedStatus && e.eventsPath) {
      // pid + per-run budget MUST be carried through: sweepHeartbeats's C-17 budget
      // kill guards on run.pid and reads run.budgetMs/budgetTurns. Dropping them here
      // (the original bug) made the budget kill silently un-fireable (caught by the
      // C-17 live-fire, not the unit test of budgetKillDecision alone).
      runs.push({ executionId, target: e.target, origin: e.origin ?? null, eventsPath: e.eventsPath, launchedAt: e.launchedAt, context: e.context, pid: e.pid, budgetMs: e.budgetMs, budgetTurns: e.budgetTurns, budgetKill: e.budgetKill });
    }
  }
  for (const [executionId, d] of Object.entries(state.dispatched || {})) {
    if (d && !d.reportedStatus && d.launchedAt) {
      // Dispatched (fanout) runs stream into a launch log rather than an events.jsonl; the
      // comment + milestone telemetry (elapsed/turns-from-log) still applies. The target IS
      // the issue, so heartbeatIssueRef always resolves.
      runs.push({ executionId, target: d.target, origin: d.origin ?? null, eventsPath: d.eventsPath || d.launchLogPath, launchedAt: d.launchedAt, context: d.context });
    }
  }
  return runs;
}

async function sweepHeartbeats(state, now = Date.now()) {
  if (!state.heartbeats) state.heartbeats = {};
  for (const run of activeHeartbeatRuns(state)) {
    const launchedAt = Date.parse(run.launchedAt || "") || now;
    const elapsedMs = now - launchedAt;
    const raw = parseHeartbeatObservation(run.eventsPath, now);
    // C-17 budget kill: a live run past its wall-clock/turn ceiling is a zombie —
    // terminate it (SIGTERM → the worker's exit handler reports it) and flag the run
    // so reportEphemeralFinished renders an honest "budget exceeded" failure with the
    // transcript link, notified as a failure. Deterministic; no LLM.
    const budget = budgetKillDecision({
      elapsedMs,
      turns: raw.turns,
      ...(run.budgetMs ? { maxMs: run.budgetMs } : {}),
      ...(run.budgetTurns ? { maxTurns: run.budgetTurns } : {}),
    });
    if (budget.kill && run.pid && isPidAlive(run.pid) && !run.budgetKill) {
      // Persist budgetKill on the REAL state entry (not the reshaped run copy) so
      // reportEphemeralFinished — which reloads state on the worker's exit — renders
      // the honest "budget exceeded … nothing verifiable" failure.
      const entry = state.ephemeral?.[run.executionId] ?? state.dispatched?.[run.executionId];
      if (entry) entry.budgetKill = budget.reason;
      run.budgetKill = budget.reason;
      appendRecord(ephemeralRunPaths(run.executionId).journalPath, { kind: "budget-kill", runId: run.executionId, reason: budget.reason, at: new Date(now).toISOString() });
      log(`budget kill: ephemeral ${run.executionId} — ${budget.reason} — terminating pid ${run.pid}`);
      try {
        process.kill(run.pid, "SIGTERM");
      } catch {
        /* already gone; the stale/terminal sweep will report it */
      }
      continue; // don't also post a "still running" heartbeat for a run we just killed
    }
    const stalled = heartbeatStalled(raw.lastActivityMs, now);
    const staleMs = stalled ? now - raw.lastActivityMs : 0;
    const phase = derivePhase(raw.lastEvent);
    const hb = state.heartbeats[run.executionId] || (state.heartbeats[run.executionId] = { fired: {} });
    const ref = heartbeatIssueRef(run);
    if (shouldUpdateHeartbeat(hb, now, stalled)) {
      const body = renderHeartbeat({ elapsedMs, turns: raw.turns, toolCalls: raw.toolCalls, lastEvent: raw.lastEvent, lastPartial: raw.lastPartial, phase, stalled, staleMs, now });
      if (ref) {
        const commentId = upsertHeartbeatComment(ref.repo, ref.number, hb.commentId || findHeartbeatComment(ref.repo, ref.number), body);
        if (commentId) hb.commentId = commentId;
      } else {
        log(`heartbeat (no issue to post on) ${run.executionId}: ${body.split("\n")[1]}`);
      }
      hb.lastPostedAt = now;
      hb.stalled = stalled;
      // F-2 / C-09: push the observed phase/partial onto the executor queue so
      // execution_status returns elapsed + phase mid-run (best-effort; never blocks).
      if (run.origin !== undefined || run.target) {
        void reportToEpaminon("/api/exec/progress", {
          execution_id: run.executionId,
          phase,
          ...(raw.lastPartial ? { progress_note: raw.lastPartial } : {}),
          ...(raw.recentEvents?.length ? { recent_events: raw.recentEvents } : {}),
        }).catch(() => {});
      }
    }
    // Tier 2: coarse milestone pings — start / longrun / stalled only, once each.
    const milestone = heartbeatMilestone({ elapsedMs, stalled, fired: hb.fired });
    if (milestone) {
      await raiseHeartbeatMilestone(milestone, { ...run, executionId: run.executionId }, { elapsedMs, turns: raw.turns, staleMs, phase, lastEvent: raw.lastEvent, lastPartial: raw.lastPartial });
      hb.fired[milestone] = new Date(now).toISOString();
    }
  }
  // Drop heartbeat state for runs that have gone terminal (freed on the next scan).
  for (const id of Object.keys(state.heartbeats)) {
    const stillActive = (state.ephemeral?.[id] && !state.ephemeral[id].reportedStatus) || (state.dispatched?.[id] && !state.dispatched[id].reportedStatus);
    if (!stillActive) delete state.heartbeats[id];
  }
}

function launchEphemeral(executionId, target, context, state) {
  const existing = state.ephemeral?.[executionId];
  if (existing?.pid && !existing.reportedStatus) return { ok: true, duplicate: true };
  const paths = ephemeralRunPaths(executionId);
  mkdirSync(paths.scratch, { recursive: true });
  writeFileSync(paths.promptPath, ephemeralPrompt(executionId, context));
  // I8-2/I8-3: durable step-log record for this launch attempt (fsync'd), so the
  // run's history survives a redeploy and the resume path can see it.
  appendRecord(paths.journalPath, { kind: "launch", runId: executionId, attempt: (existing?.attempts ?? 0) + 1, at: new Date().toISOString() });
  const primaryEngine = String(process.env.ZENOD_WORKER_ENGINE || "codex").toLowerCase() === "claude" ? "claude" : "codex";

  // Run one attempt on the given engine. The prompt + report-back flow is engine-agnostic
  // (same as fanout), so a quota death on one engine can be replayed verbatim on the other.
  const attempt = (engine, alreadyFellBack) => {
    const fd = openSync(paths.eventsPath, "a");
    // Reuse the fanout lane's spawn builder so both lanes agree on per-engine args.
    // (codex writes the final message to finalPath; claude's final text is recovered
    // from the events stream by reportEphemeralFinished's existing finalText handling.)
    const spec = buildWorkerSpawn({ engine, worktree: paths.scratch, finalPath: paths.finalPath });
    const child = spawn(spec.bin, spec.args, {
      cwd: paths.scratch,
      stdio: ["pipe", fd, fd],
      detached: true,
      env: { ...process.env, ...(spec.env ?? {}) },
    });
    child.stdin.end(readFileSync(paths.promptPath, "utf8"));
    child.on("error", (err) => {
      try {
        closeSync(fd);
      } catch {
        // already closed
      }
      const note = `ephemeral runner failed to spawn for ${executionId}: ${err.code || err.message}`;
      log(note);
      // Mark reported so the stale-ephemeral sweep won't re-report this run (#stab T2).
      const s = loadState();
      if (s.ephemeral?.[executionId]) {
        s.ephemeral[executionId].reportedStatus = "failed";
        s.ephemeral[executionId].finishedAt = new Date().toISOString();
        saveState(s);
      }
      void dispatchReport(
        "/api/exec/blocked",
        { execution_id: executionId, note },
        `⛔ Execution ${executionId} (${target}) — failed: ${note}`,
      );
    });
    child.on("exit", (code) => {
      try {
        closeSync(fd);
      } catch {
        // already closed
      }
      // Quota fallback (W0 port): an engine dying on usage limits is an account problem,
      // not a task problem. If the other engine's CLI is installed, replay once instead
      // of reporting the whole execution as failed. No env var decides this — the class does.
      const rawError = code !== 0 ? extractWorkerError(paths.eventsPath) : null;
      const decision = ephemeralFallbackDecision({ exitCode: code, rawError, engine, alreadyFellBack });
      if (decision.fallback) {
        appendFileSync(
          paths.eventsPath,
          `${JSON.stringify({ type: "engine.fallback", from: engine, to: decision.nextEngine, reason: String(rawError).slice(0, 240), at: new Date().toISOString() })}\n`,
        );
        log(`ephemeral ${executionId}: ${engine} out of quota — replaying on ${decision.nextEngine}`);
        const replay = attempt(decision.nextEngine, true);
        const s = loadState();
        if (s.ephemeral?.[executionId]) {
          s.ephemeral[executionId].engineFallback = `${engine}→${decision.nextEngine}`;
          s.ephemeral[executionId].engine = decision.nextEngine;
          s.ephemeral[executionId].pid = replay.pid ?? null;
          saveState(s);
        }
        return;
      }
      void reportEphemeralFinished(executionId, target, code, paths.finalPath);
    });
    child.unref();
    return child;
  };

  const child = attempt(primaryEngine, false);
  state.ephemeral[executionId] = {
    target,
    executionId, // carried so the heartbeat sweep can key Tier-2 milestones + notify dedup
    context: String(context || ""), // may embed a linked issue URL for the heartbeat comment
    promptPath: paths.promptPath,
    finalPath: paths.finalPath,
    eventsPath: paths.eventsPath,
    scratch: paths.scratch,
    engine: primaryEngine,
    pid: child.pid ?? null,
    launchedAt: new Date().toISOString(),
    reportedStatus: null,
    // I8-2 (C-21): durable attempt count — survives on the monitor state so the
    // resume ceiling in sweepStaleEphemeral holds across redeploys. A resume
    // re-enters launchEphemeral, so increment from any prior entry.
    attempts: (existing?.attempts ?? 0) + 1,
    // C-17 / B1: per-run budget ceiling declared in the task context (lane mechanism),
    // resolved once at launch and preserved across resumes. null → env default.
    budgetMs: (existing?.budgetMs ?? parseRunBudget(context).maxMs) ?? null,
    budgetTurns: (existing?.budgetTurns ?? parseRunBudget(context).maxTurns) ?? null,
    // "Merge by default": remember at launch whether THIS task opted out of auto-merge,
    // so the deterministic finalization path (reportEphemeralFinished) can honor the
    // opt-out without re-reading the (LLM-authored) worker output. No signal = ON.
    holdForReview: wantsHoldForReview(context),
  };
  log(
    `launched ephemeral execution ${executionId} scratch=${paths.scratch} engine=${primaryEngine}` +
      (wantsHoldForReview(context) ? " hold-for-review=on" : ""),
  );
  return { ok: true };
}

// Launch an Epaminon-dispatched ticket: work its target work-ticket directly (no
// central materialize — the dispatched target IS the issue).
function launchDispatched(executionId, target, context, state) {
  if (parseEphemeralTarget(target)) return launchEphemeral(executionId, target, context, state);

  const t = parseTarget(target);
  if (!t) {
    log(`/run: bad target "${target}" for ${executionId}`);
    return { ok: false, note: `bad execution target "${target}"; expected owner/repo#N` };
  }
  const repair = repairTargetBootstrapLabels(t.repo, t.number);
  if (!repair.ok) {
    log(`/run: target label repair failed — ${executionId} not started: ${repair.note}`);
    return { ok: false, note: repair.note };
  }
  if (!launcherHealthy()) {
    log(`/run: launcher not healthy — ${executionId} not started`);
    return { ok: false, note: "runner launcher is not healthy; fanout could not start" };
  }
  const launch = launchFanout(t.repo, t.number, {
    ZENOD_EXECUTION_ID: String(executionId),
    ZENOD_EXECUTION_CONTEXT: String(context || ""),
    ...(LANE_SECRET ? { ZENOD_EXEC_LANE_SECRET: LANE_SECRET } : {}),
    ZENOD_EPAMINON_URL: EPAMINON_URL,
  }, {
    onEarlyExit: (note) => markDispatchedLaunchBlocked(executionId, target, note),
  });
  state.dispatched[executionId] = {
    repo: t.repo,
    issueN: t.number,
    target,
    executionId, // for heartbeat milestone keying
    context: String(context || ""),
    workdir: workdirForRepo(t.repo),
    pid: launch.pid ?? null,
    launchLogPath: launch.logPath,
    repairedLabels: repair.labels,
    launchedAt: new Date().toISOString(),
    reportedStatus: null,
  };
  return { ok: true };
}

// Each scan: for dispatched runs, read the target issue state and report new
// terminal-ish transitions (needs-review / complete / blocked) back to Epaminon once.
async function reportDispatched(state) {
  for (const [executionId, d] of Object.entries(state.dispatched || {})) {
    const { status, origin, lastComment, title } = execStatusAndComment(d.repo, d.issueN);
    const prUrl = prUrlForExec(d.repo, d.issueN);
    const o = dispatchedOutcome(status, prUrl);
    if (o.kind === "none") continue;
    if (d.reportedStatus === status) continue; // already reported this state
    let ok = false;
    let manifest = null;
    if (o.kind === "blocked") {
      ok = await reportToEpaminon("/api/exec/blocked", { execution_id: executionId, note: (lastComment || "").slice(0, 280) });
    } else {
      manifest = deliverableManifest(d.repo, d.issueN, o.evidenceUrl || prUrl, lastComment);
      ok = await reportToEpaminon("/api/exec/outcome", {
        execution_id: executionId,
        outward: o.outward,
        ...(o.evidenceUrl ? { evidence_url: o.evidenceUrl } : {}),
        deliverable: manifest,
      });
    }
    if (ok) {
      d.reportedStatus = status;
      if (o.kind === "blocked") {
        // Dedupe on the blocker CONTENT: siblings repeating the same question collapse,
        // a genuinely different blocker on the same issue still gets through.
        const blockedKey = `${d.target}|${String(lastComment || "").slice(0, 120)}|execution.blocked`;
        await notify(
          composeBlockerNotification({ executionId, target: d.target, question: lastComment }),
          origin,
          { eventType: "execution.blocked", executionId, targetIssue: d.target, severity: "action", dedupeKey: blockedKey },
        );
      } else {
        // Dedupe on the EVIDENCE: siblings announcing the same PR collapse, but a re-run
        // producing a NEW PR (or a no-PR done, keyed by execution) is a new fact.
        const terminalKey = `${d.target}|${(manifest && manifest.prUrl) || executionId}|execution.terminal`;
        // M-2: evidence-required "done" — a terminal completion with nothing verifiable
        // behind it notifies as a failure (severity: error), never as ordinary info.
        // C-07c: a declared-no-deliverable smoke/echo/no-op run completing with nothing
        // checkable is a success, not an error — don't flag it as a failure notification.
        const verifiable = o.outward || hasVerifiableDeliverable(manifest) || declaresNoDeliverableExpected(d.context);
        await notify(
          composeTerminalNotification({ executionId, target: d.target, outward: o.outward, title, manifest, context: d.context }),
          origin,
          { eventType: "execution.terminal", executionId, targetIssue: d.target, severity: verifiable ? "info" : "error", dedupeKey: terminalKey },
        );
      }
    }
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

function shouldBlockMergeGate(approval, issueStatus) {
  if (!approval?.eligible) return false;
  return approval.autoMerge === true || issueStatus === "status:approved-merge";
}

function blockMergeGateIfNeeded(approval, issue, setStatus = setCentralStatus) {
  if (!shouldBlockMergeGate(approval, issue.status)) return false;
  setStatus(issue.number, approval.fromStatus, "status:blocked");
  issue.status = "status:blocked";
  return true;
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
      // Record EVERY gate evaluation (full audit). A hard blocker also moves the
      // central ticket out of the merge gate immediately; the notification
      // cooldown below only controls pings/comments, not structural state repair.
      const note = async (key, text, options = {}) => {
        recordMergeAttempt(state, bridge, c, {
          autoMerge: approval.autoMerge,
          prUrl,
          outcome: options.outcome ?? key,
          detail: options.detail ?? "",
        });
        if (options.blockMergeGate) {
          blockMergeGateIfNeeded(approval, c);
        }
        if (!shouldSendMergeNote(bridge, key, Date.now())) return;
        bridge.mergeNote = mergeNoteDedupKey(key);
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
          blockMergeGate: true,
        });
        continue;
      }
      // Hard blockers — need a human or a resolve worker, not a retry.
      if (g.mergeable === "CONFLICTING") {
        await note("conflict", `⛔ #${c.number} ${c.title} — branch conflicts with main; needs a rebase/resolve. ${prUrl}`, {
          comment: true,
          blockMergeGate: true,
        });
        continue;
      }
      if (g.failed) {
        await note("failed", `⛔ #${c.number} ${c.title} — CI is failing; can't merge. ${prUrl}`, {
          comment: true,
          blockMergeGate: true,
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
            blockMergeGate: true,
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
            blockMergeGate: true,
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

    // Durable report recovery (#stab T2): re-deliver any reports that failed earlier,
    // then recover ephemeral runs whose exit callback was lost. Operates on a freshly
    // loaded copy so it never clobbers the scan motions above; reportEphemeralFinished
    // owns its own persistence (idempotent), so no save follows the sweep.
    const recovery = loadState();
    await flushPendingReports(recovery);
    // Live-progress heartbeat: refresh the pinned comment + raise coarse Tier-2 milestones for
    // every non-terminal run BEFORE the stale-ephemeral sweep may report one terminal. Fully
    // degrade-safe (skips runs with no resolvable issue; swallows gh errors).
    await sweepHeartbeats(recovery);
    saveState(recovery);
    await sweepStaleEphemeral(recovery);

    log(`scan (${reason}): ${issues.length} central issues, launched ${launched}`);
  } catch (e) {
    log("scan error:", e.message);
  } finally {
    scanning = false;
  }
}

// POST /run — Epaminon dispatches an execution ticket to be worked now (#194).
// Lane-secret gated (so only Epaminon can trigger a Codex run). Body:
// { execution_id, target: "owner/repo#N", context, notify_on_start?: boolean }.
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
    const target = String(body.target);
    const context = String(body.context || "");
    const result = launchDispatched(executionId, target, context, state);
    if (!result.ok) {
      await reportToEpaminon("/api/exec/blocked", { execution_id: executionId, note: result.note });
    } else if (shouldNotifyOnExecutionStart(body)) {
      // C-08: EVERY start notification must carry a resolving link to the ticket/run it
      // executes against. A dispatched run's target is already a work ticket; an issue-less
      // ephemeral has no home yet, so mint a lightweight tracking issue and pin both the
      // start ping AND the heartbeat (via the ephemeral entry's context) to it.
      let link = resolvingLinkForRun({ target, context });
      if (!link) {
        const trackingUrl = mintTrackingIssue(executionId, context);
        if (trackingUrl) {
          link = trackingUrl;
          const eph = state.ephemeral?.[executionId];
          if (eph) eph.context = `${eph.context || ""}\nTracking issue: ${trackingUrl}`.trim();
        }
      }
      await notify(composeExecutionStartNotification({ executionId, target, link }));
    }
    saveState(state);
    res.writeHead(result.ok ? 202 : 422).end(result.ok ? "launched\n" : "could not launch\n");
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

  log(`starting — backlog=${BACKLOG} target_default=${REPO} poll=${POLL_MS}ms notify=${NOTIFY_URL || "(none)"}`);
  void scan("startup");
  setInterval(() => void scan("poll"), POLL_MS);
}

export {
  activeFanInBatchForIssue,
  activeHeartbeatRuns,
  batchKey,
  ensureFanInBatch,
  integrationPrompt,
  mergeApprovalForIssue,
  mergeNoteDedupKey,
  normalizeState,
  notifyConfig,
  recordMergeAttempt,
  shouldSendMergeNote,
  shouldBlockMergeGate,
  blockMergeGateIfNeeded,
  detectIntegrationStatus,
  reviewHeldByFanInBatch,
  updateFanInBatches,
  latestComment,
  pickupNotification,
  primaryStatusLabel,
  targetBootstrapLabels,
  parseEphemeralTarget,
  parseTarget,
  issueUrlFromTarget,
  resolvingLinkForRun,
  composeExecutionStartNotification,
  ephemeralFinalState,
  ephemeralFallbackDecision,
  ephemeralPrompt,
  extractEvidenceClaims,
  verifyEvidenceClaims,
  hasCheckableEvidence,
  pickEvidenceUrl,
  wantsHoldForReview,
  declaresNoDeliverableExpected,
  repoFromPrUrl,
  enableAutoMergeForPr,
  tailFile,
  isPidAlive,
  flushPendingReports,
  workdirForRepo,
  dispatchedOutcome,
  deliverableManifest,
  parseDeliverables,
  summarizeHandoff,
  mergeStateLine,
  composeTerminalNotification,
  hasVerifiableDeliverable,
  manifestEvidenceUrl,
  composeActionableMessage,
  composeBlockerNotification,
  shouldReportEarlyLaunchExit,
  earlyLaunchFailureNote,
  launchLogPath,
  shouldNotifyOnExecutionStart,
  formatElapsed,
  derivePhase,
  phaseSummary,
  parseHeartbeatObservation,
  heartbeatStalled,
  renderHeartbeat,
  shouldUpdateHeartbeat,
  heartbeatMilestone,
  heartbeatIssueRef,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STALL_MS,
  HEARTBEAT_LONGRUN_MS,
  HEARTBEAT_MARKER,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
