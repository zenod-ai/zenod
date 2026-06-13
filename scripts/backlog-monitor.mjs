#!/usr/bin/env node
// Backlog monitor (#27) — the single process that runs the chat-trigger loop.
//
// Architecture: GitHub is the queue + state + comms surface. Zenod (chat) drops
// thin trigger tickets and labels them `status:queued`. THIS monitor — running
// in the EXTERNAL agent-runner container, never killed by an app redeploy —
// reacts to label state with two motions:
//
//   1. LAUNCH  : owner:agent + status:queued  -> launch Codex via fanout
//                (the fanout flips queued -> running and opens draft PRs).
//   2. OUTCOME : status:needs-review | status:blocked -> ping the owner on
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
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const REPO = process.env.ZENOD_REPO || "zenod-ai/zenod";
const WORKDIR = process.env.ZENOD_WORKDIR || "/runner/work/zenod";
const APP_URL = (process.env.ZENOD_APP_URL || "").replace(/\/$/, "");
const API_TOKEN = process.env.ZENOD_API_TOKEN || "";
const POLL_MS = Number(process.env.ZENOD_POLL_MS || 120000);
const POKE_PORT = Number(process.env.ZENOD_POKE_PORT || 8787);
const CONCURRENCY = Number(process.env.ZENOD_CONCURRENCY || 3);
const STATE_PATH = process.env.ZENOD_STATE || `${WORKDIR}/.fanout/monitor-state.json`;

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
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { launched: {}, notified: {} }; // issue -> true ; issue -> last-status
  }
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
      await notify(`🚀 Zenod queued Codex on ${toLaunch.map((n) => `#${n}`).join(", ")}. I'll message you when each lands.`);
    }

    // 2. OUTCOME motion — ping once per terminal state.
    for (const i of issues) {
      if (i.status === "status:needs-review" && state.notified[i.number] !== "needs-review") {
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

    saveState(state);
    log(`scan (${reason}): ${issues.length} agent issues, launched ${toLaunch.length}`);
  } catch (e) {
    log("scan error:", e.message);
  } finally {
    scanning = false;
  }
}

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
await scan("startup");
setInterval(() => void scan("poll"), POLL_MS);
