#!/usr/bin/env node
// EPIC-6 S3: read-only production smoke battery (E6-2).
//
//   npm run smoke:prod                       # run every check, print a table, exit 1 on any fail
//   npm run smoke:prod -- --out DIR          # also write DIR/latest.json and DIR/runs/<stamp>.json (keeps --keep N)
//   npm run smoke:prod -- --json             # print the result JSON instead of the table
//   npm run smoke:prod -- --override site.home=https://bogus.invalid/   # test run: point one check elsewhere
//
// Read-only by construction: GET requests to public endpoints (no credentials, no POST), and on VPS1
// only the commands t3agent's narrow sudo allows (journalctl, systemctl is-active, tester-watch --check
// --redact --no-stripe, df). It never logs in, never sends a chat message and never touches a vault.
// Runs on Node 18+ (the VPS3 timer host has Node 18). Result shape: docs/health/SMOKE.md.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const SCHEMA = "zenod-smoke/v1";

export const URLS = {
  "site.home": "https://zenod.dev/",
  "site.connect": "https://zenod.dev/connect",
  "cloud.health": "https://cloud.zenod.dev/api/health",
  "cloud.readiness": "https://cloud.zenod.dev/api/public/production-readiness",
  "mcp.unauthorized": "https://cloud.zenod.dev/mcp",
  "mcp.resource-metadata": "https://cloud.zenod.dev/.well-known/oauth-protected-resource",
  "mcp.auth-metadata": "https://cloud.zenod.dev/.well-known/oauth-authorization-server",
  "phylax.health": "https://phylax.zenod.dev/api/health",
  "host.observatory": "http://100.104.206.10:8090/",
  // Root D28 (EPIC-24 M10): staging follows main, production moves only on a promote.
  "staging.health": "http://100.104.206.10:8781/api/health",
};

// Components use the row keys of the health page (docs/health/s1-live/probe.py, INVENTORY.md §2–§4).
export const COMPONENTS = {
  site: "Marketing site zenod.dev",
  cloud: "Cloud app cloud.zenod.dev",
  phylax: "WhatsApp relay Phylax",
  deploy: "Deploy path",
  watchdog: "Alerts: host watchdog",
  readiness: "Readiness keeper and watch",
  tester_watch: "Tester watch",
  ingress: "Ingress tunnel",
  host: "Host VPS1: disk and observatory",
};

const SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "hetzner_vps_1"];
const UA = "zenod-epic6-smoke";

function title(body) {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(body || "");
  return m ? m[1].trim().slice(0, 80) : null;
}

function json(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

const fail = (reason) => ({ ok: false, reason });
const pass = (reason) => ({ ok: true, reason });

// Each check: { id, component, title, kind: "http"|"remote", url?|cmd?, judge(result, ctx) -> {ok, reason} }.
// `http` results are { status, body, headers }; `remote` results are { code, stdout }.
export function checks() {
  return [
    {
      id: "site.home", component: "site", title: "Home page answers", kind: "http",
      judge: (r) => (r.status === 200 && /zenod/i.test(title(r.body) || "")
        ? pass(`200, title “${title(r.body)}”`)
        : fail(`${r.status || r.error}${title(r.body) ? `, title “${title(r.body)}”` : ""}, expected 200 with Zenod in the title`)),
    },
    {
      id: "site.connect", component: "site", title: "Public connect page", kind: "http",
      judge: (r) => (r.status === 200 && /connect/i.test(title(r.body) || "")
        ? pass(`200, title “${title(r.body)}”`)
        : fail(`${r.status || r.error}, expected 200 with Connect in the title`)),
    },
    {
      id: "cloud.health", component: "cloud", title: "Cloud app health and sha", kind: "http",
      judge: (r, ctx) => {
        const j = json(r.body);
        if (r.status !== 200 || j?.status !== "ok") return fail(`${r.status || r.error}, status ${j?.status ?? "unreadable"}`);
        ctx.cloudSha = j.sha || null;
        const p99 = j.eventLoop?.p99Ms;
        return pass(`ok, sha ${String(j.sha || "?").slice(0, 7)}${p99 != null ? `, event loop p99 ${p99} ms` : ""}`);
      },
    },
    {
      id: "staging.health", component: "cloud", title: "Staging app health and sha", kind: "http",
      judge: (r, ctx) => {
        const j = json(r.body);
        if (r.status !== 200 || j?.status !== "ok") return fail(`${r.status || r.error}, status ${j?.status ?? "unreadable"}`);
        ctx.stagingSha = j.sha || null;
        return pass(`ok, sha ${String(j.sha || "?").slice(0, 7)}`);
      },
    },
    {
      // Root D28: staging (not production) follows main; production moves only on scripts/promote-production.sh.
      id: "cloud.deployed-sha", component: "cloud", title: "Staging runs the newest published image", kind: "local",
      run: (ctx) => ctx.newestPublish(),
      judge: (r, ctx) => {
        if (!ctx.stagingSha) return fail("no sha from staging health");
        if (!r?.headSha) return fail(`newest successful publish run unknown${r?.error ? ` (${r.error})` : ""}`);
        const prod = ctx.cloudSha ? `; production ${ctx.cloudSha.slice(0, 7)} moves on a promote` : "";
        if (r.headSha === ctx.stagingSha) return pass(`staging ${ctx.stagingSha.slice(0, 7)} = newest publish${prod}`);
        const ageMin = (ctx.now() - Date.parse(r.createdAt)) / 60000;
        if (ageMin < 30) return pass(`staging ${ctx.stagingSha.slice(0, 7)}, publish ${r.headSha.slice(0, 7)} ${Math.round(ageMin)} min old, roll pending${prod}`);
        return fail(`staging ${ctx.stagingSha.slice(0, 7)} but newest publish is ${r.headSha.slice(0, 7)} from ${Math.round(ageMin)} min ago`);
      },
    },
    {
      // EPIC-24 M22: production lagging staging is normal for up to about an hour (root D28's hourly promote tick,
      // scripts/promote-schedule/tick.py, batches, waits out quiet hours and pauses). Red only when the tick itself
      // says it is stuck: it went silent, its gate or promote failed, or daytime ticks keep waiting on the same sha.
      id: "cloud.promote-lag", component: "cloud", title: "Production follows staging on the hourly promote", kind: "local",
      run: (ctx) => ctx.promoteTicks(),
      judge: (ticks, ctx) => judgePromoteLag(ticks, ctx),
    },
    {
      id: "cloud.readiness", component: "readiness", title: "Production readiness gate", kind: "http",
      judge: (r) => {
        const j = json(r.body);
        if (r.status !== 200 || j?.ready !== true) {
          const bad = (j?.checks || []).filter((c) => !c.ok && !(j.advisoryChecks || []).includes(c.id)).map((c) => c.id);
          return fail(`${r.status || r.error}, ready ${j?.ready ?? "unreadable"}${bad.length ? `, failing ${bad.join(", ")}` : ""}`);
        }
        return pass(`ready, ${(j.advisoryChecks || []).length} advisory checks open`);
      },
    },
    {
      id: "mcp.unauthorized", component: "cloud", title: "MCP endpoint asks for OAuth", kind: "http",
      judge: (r) => {
        const auth = r.headers?.["www-authenticate"] || "";
        return r.status === 401 && /resource_metadata=/.test(auth)
          ? pass("401 with resource metadata pointer")
          : fail(`${r.status || r.error}${auth ? "" : ", no WWW-Authenticate"}, expected 401 with resource_metadata`);
      },
    },
    {
      id: "mcp.resource-metadata", component: "cloud", title: "OAuth protected-resource metadata", kind: "http",
      judge: (r) => {
        const j = json(r.body);
        return r.status === 200 && /\/mcp$/.test(j?.resource || "") && j?.authorization_servers?.length
          ? pass(`200, resource ${j.resource}`)
          : fail(`${r.status || r.error}, resource ${j?.resource ?? "missing"}`);
      },
    },
    {
      id: "mcp.auth-metadata", component: "cloud", title: "OAuth authorization-server metadata", kind: "http",
      judge: (r) => {
        const j = json(r.body);
        return r.status === 200 && j?.issuer && j?.token_endpoint && j?.authorization_endpoint
          ? pass(`200, issuer ${j.issuer}`)
          : fail(`${r.status || r.error}, issuer or endpoints missing`);
      },
    },
    {
      id: "phylax.health", component: "phylax", title: "Phylax health and worker heartbeat", kind: "http",
      judge: (r, ctx) => {
        const j = json(r.body);
        if (r.status !== 200 || j?.status !== "ok") return fail(`${r.status || r.error}, status ${j?.status ?? "unreadable"}`);
        if (j.restart?.required) return fail(`restart required: ${j.restart.reason || "no reason"}`);
        const hb = j.worker?.lastHeartbeatAt;
        const age = hb ? (ctx.now() - hb) / 1000 : null;
        if (age == null || age > 120) return fail(`worker heartbeat ${age == null ? "missing" : `${Math.round(age)} s old`}`);
        return pass(`ok, sha ${String(j.sha || "?").slice(0, 7)}, worker heartbeat ${Math.max(0, Math.round(age))} s old`);
      },
    },
    {
      id: "phylax.whatsapp", component: "phylax", title: "WhatsApp transport connected", kind: "http", url: URLS["phylax.health"],
      judge: (r) => {
        const w = json(r.body)?.channels?.whatsapp;
        if (!w) return fail(`${r.status || r.error}, no WhatsApp channel in Phylax health`);
        const rp = w.receivePath || {};
        return w.state === "connected" && rp.status === "ready"
          ? pass(`connected, receive path ready${rp.outageSince ? "" : ", no outage"}`)
          : fail(`state ${w.state}, receive path ${rp.status}${rp.reason ? ` (${rp.reason})` : ""}`);
      },
    },
    {
      // EPIC-24 M25: a tenant's Drive vault stuck on a preserved journal edit logged "[quick-index] update failed" every
      // 5 min and "[vault-recovery] UNRESOLVED" for hours (19 Nov 22:56Z on) and nothing on the page went red. Reads the
      // running zenod-mt container's log the read-only way (docker logs of the one container id, the narrow sudo rules).
      id: "cloud.vault-recovery", component: "cloud", title: "No tenant vault stuck in recovery or failing to index", kind: "remote",
      cmd: VAULT_LOG_CMD,
      judge: (r, ctx) => judgeVaultRecovery(r, ctx.now()),
    },
    {
      id: "readiness.proofs", component: "readiness", title: "Readiness keeper proofs in date", kind: "remote",
      cmd: "sudo -n journalctl -u zenod-readiness-watch --since -3h -o short-iso --no-pager | grep 'watch ready=' | tail -1",
      judge: (r, ctx) => {
        const line = (r.stdout || "").trim();
        const m = /^(\S+) .*watch ready=(\w+) issues=(\[.*?\]) proofs=(\[.*\])/.exec(line);
        if (!m) return fail(r.code ? `ssh exit ${r.code}` : "no readiness-watch run in the last 3 h");
        const proofs = json(m[4]) || [];
        const age = (ctx.now() - Date.parse(m[1])) / 3600000;
        if (m[2] !== "True") return fail(`watch says ready=${m[2]}, issues ${m[3]}`);
        if (age > 2) return fail(`last watch run ${age.toFixed(1)} h ago`);
        const near = proofs.reduce((a, p) => (a && a.daysLeft <= p.daysLeft ? a : p), null);
        if (proofs.some((p) => p.daysLeft <= 0)) return fail(`expired proof: ${proofs.filter((p) => p.daysLeft <= 0).map((p) => p.id).join(", ")}`);
        return pass(`ready, ${proofs.length} proofs valid${near ? `, nearest ${near.id} to ${near.expiresAt.slice(0, 10)}` : ""}`);
      },
    },
    {
      id: "testers.check", component: "tester_watch", title: "tester-watch --check", kind: "remote",
      cmd: "sudo -n /usr/local/bin/tester-watch --check --redact --no-stripe 2>&1 | tail -1; exit ${PIPESTATUS[0]}",
      judge: (r) => {
        const last = (r.stdout || "").trim().split("\n").pop() || "";
        return r.code === 0 && /^OK\b/.test(last) ? pass(last.slice(0, 80)) : fail(`exit ${r.code}: ${last.slice(0, 80) || "no output"}`);
      },
    },
    {
      id: "deploy.poller", component: "deploy", title: "Deploy poller ran in the last 10 min", kind: "remote",
      cmd: "journalctl --user -u infra-vps-deploy-poller --since -10min -o short-iso --no-pager | grep -E 'deploy-poller (zenod-staging|zenod-mt)' | tail -1",
      judge: (r) => {
        const line = (r.stdout || "").trim();
        if (!line) return fail(r.code ? `ssh exit ${r.code}` : "no deploy-poller run in 10 min");
        const msg = line.split(/deploy-poller zenod-(?:staging|mt): /)[1] || line;
        return /error|fail/i.test(msg) ? fail(msg.slice(0, 80)) : pass(msg.slice(0, 80));
      },
    },
    {
      id: "watchdog.timer", component: "watchdog", title: "Watchdog timer running", kind: "remote",
      // S5 moved the watchdog to the user timer zenod-health-watchdog; the root zenod-watchdog is being retired.
      cmd: "echo user=$(systemctl --user is-active zenod-health-watchdog.timer) root=$(systemctl is-active zenod-watchdog.timer)",
      judge: (r) => {
        const m = /user=(\S*) root=(\S*)/.exec(r.stdout || "");
        if (!m) return fail(`unreadable${r.code ? `, ssh exit ${r.code}` : ""}`);
        if (m[1] === "active") return pass("zenod-health-watchdog timer active");
        if (m[2] === "active") return pass("old root zenod-watchdog timer active");
        return fail(`no watchdog timer active (user ${m[1] || "?"}, root ${m[2] || "?"})`);
      },
    },
    {
      id: "ingress.tunnel", component: "ingress", title: "Cloudflare tunnel service active", kind: "remote",
      cmd: "systemctl is-active cloudflared-vps1-sites.service",
      judge: (r) => ((r.stdout || "").trim() === "active" ? pass("cloudflared-vps1-sites active") : fail(`service ${(r.stdout || "").trim() || `ssh exit ${r.code}`}`)),
    },
    {
      id: "host.disk", component: "host", title: "VPS1 root disk below 85 %", kind: "remote",
      cmd: "df -P / | tail -1",
      judge: (r) => {
        const pct = Number((/(\d+)%/.exec(r.stdout || "") || [])[1]);
        if (!Number.isFinite(pct)) return fail(`df unreadable${r.code ? `, ssh exit ${r.code}` : ""}`);
        return pct < 85 ? pass(`${pct} % used`) : fail(`${pct} % used`);
      },
    },
    {
      id: "host.observatory", component: "host", title: "Infra observatory answers on the tailnet", kind: "http",
      judge: (r) => (r.status === 200 ? pass("200") : fail(`${r.status || r.error}, expected 200`)),
    },
  ];
}


// EPIC-24 M25: tenant vaults stuck in recovery. The log lines come from packages/server (runtime.ts quick-index every 5 min,
// vaultRecovery.ts); both end with ` tenant=<id>` since M25, older builds carry none.
export const VAULT_FAIL_MIN = 30; // a failure streak this long is red
export const VAULT_RETRY_GAP_MIN = 12; // quick-index retries every 5 min; a longer gap ends a streak
export const VAULT_LOG_CMD = [
  "T=$(sudo -n docker service ps -q --no-trunc zenod-mt-fxpzoo | head -1)",
  "C=$(sudo -n docker inspect --type task --format '{{.ServiceID}}|{{.Status.ContainerStatus.ContainerID}}|{{.Status.ContainerStatus.ExitCode}}|{{.Status.State}}|{{.DesiredState}}|{{.Status.Timestamp}}' $T | cut -d'|' -f2)",
  '[ -n "$C" ] || { echo CONTAINER-UNKNOWN; exit 0; }',
  "sudo -n docker logs --since $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ) --until $(date -u +%Y-%m-%dT%H:%M:%SZ) --timestamps $C 2>&1 | grep -E '\\[vault-recovery\\]|\\[quick-index\\] update failed' | cut -c1-600",
  "echo READ-OK",
].join("; ");

export function judgeVaultRecovery(r, nowMs) {
  const out = r.stdout || "";
  if (!/^READ-OK$/m.test(out)) return fail(/CONTAINER-UNKNOWN/.test(out) ? "no running zenod-mt container found" : `production log unreadable${r.code ? `, ssh exit ${r.code}` : ""}`);
  const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16) + "Z";
  const failures = new Map(); // key -> [ms]
  const unresolved = new Map(); // key -> ms of the latest UNRESOLVED
  const settled = new Map(); // key -> ms of the latest recovered/clean line
  for (const line of out.split("\n")) {
    const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (.*)$/.exec(line);
    if (!m) continue;
    const at = Date.parse(m[1].replace(/(\.\d{3})\d+Z$/, "$1Z")); // docker stamps 9 fraction digits
    if (!Number.isFinite(at)) continue;
    const text = m[2];
    const tenant = (/ tenant=(\S+)\s*$/.exec(text) || [])[1] || "";
    const key = tenant || "?";
    if (text.startsWith("[quick-index] update failed:")) {
      const what = text.slice("[quick-index] update failed:".length).replace(/ tenant=\S+\s*$/, "").trim().slice(0, 100);
      const k = `${key}|${what}`;
      (failures.get(k) || failures.set(k, []).get(k)).push(at);
    } else if (text.startsWith("[vault-recovery] UNRESOLVED")) {
      unresolved.set(key, Math.max(unresolved.get(key) || 0, at));
    } else if (/^\[vault-recovery\] (recovered; writes unblocked|vault clean)/.test(text)) {
      settled.set(key, Math.max(settled.get(key) || 0, at));
    }
  }
  const reds = [];
  for (const [key, at] of unresolved) {
    if ((settled.get(key) || 0) > at) continue;
    reds.push(`vault recovery UNRESOLVED since ${hhmm(at)}${key === "?" ? "" : ` (tenant ${key})`}`);
  }
  for (const [k, times] of failures) {
    times.sort((a, b) => a - b);
    const latest = times.at(-1);
    if (nowMs - latest > VAULT_RETRY_GAP_MIN * 60000) continue;
    let start = latest;
    for (let i = times.length - 2; i >= 0 && times[i + 1] - times[i] <= VAULT_RETRY_GAP_MIN * 60000; i--) start = times[i];
    if (nowMs - start < VAULT_FAIL_MIN * 60000) continue;
    const [tenant, what] = k.split("|");
    reds.push(`quick-index failing ${Math.round((latest - start) / 60000)} min since ${hhmm(start)}${tenant === "?" ? "" : ` (tenant ${tenant})`}: ${what}`);
  }
  return reds.length ? fail(reds.join("; ").slice(0, 300)) : pass("no UNRESOLVED vault recovery, no quick-index failure streak");
}

// ------------------------------------------------------------------------------------------ transports

export async function httpGet(url, timeoutMs = 15000) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.text()).slice(0, 400000);
    return { status: res.status, body, headers: Object.fromEntries(res.headers) };
  } catch (e) {
    const cause = e?.cause?.code || e?.name || "error";
    return { status: 0, body: "", headers: {}, error: `${cause} reaching ${new URL(url).host}` };
  }
}

export function sshRun(cmd, timeoutMs = 90000) {
  const r = spawnSync(SSH[0], [...SSH.slice(1), "bash", "-s"], { input: cmd, encoding: "utf8", timeout: timeoutMs });
  return { code: r.status ?? -1, stdout: r.stdout || "" };
}

// EPIC-24 M22: the promote tick's own log (one JSON line per hourly tick, on this VPS3 host).
export const PROMOTE_LOG = process.env.ZENOD_PROMOTE_LOG || join(homedir(), "zenod-eval", "promote-schedule.jsonl");
export const PROMOTE_SILENT_MIN = 90; // the tick runs hourly at :41; two missed ticks is a stall
export const PROMOTE_FAILED = new Set(["gate-failed", "gate-failed-earlier", "promote-failed", "error"]);
export const PROMOTE_IDLE = new Set(["quiet-hours", "paused", "nothing-new"]); // waits the schedule means to make
export const PROMOTE_MAX_WAITS = 3; // daytime ticks that saw this staging sha and still did not promote it

function promoteTicks() {
  if (!existsSync(PROMOTE_LOG)) return [];
  return readFileSync(PROMOTE_LOG, "utf8").trim().split("\n").slice(-200).map(json).filter(Boolean);
}

const sameSha = (a, b) => !!a && !!b && (a.startsWith(b.slice(0, 7)) || b.startsWith(a.slice(0, 7)));

export function judgePromoteLag(ticks, ctx) {
  const prod = ctx.cloudSha;
  const staging = ctx.stagingSha;
  if (!prod || !staging) return pass("production or staging sha unknown; their health checks report it");
  const lag = `production ${prod.slice(0, 7)}, staging ${staging.slice(0, 7)}`;
  if (sameSha(prod, staging)) return pass(`production ${prod.slice(0, 7)} = staging`);
  const last = (ticks || []).at(-1);
  if (!last?.at) return fail(`${lag}; no promote tick logged (~/zenod-eval/promote-schedule.jsonl)`);
  const silent = (ctx.now() - Date.parse(last.at)) / 60000;
  if (silent > PROMOTE_SILENT_MIN) return fail(`${lag}; promote tick silent for ${Math.round(silent)} min (timer zenod-promote-tick)`);
  if (PROMOTE_FAILED.has(last.decision)) return fail(`${lag}; promote tick ${last.at.slice(11, 16)}Z: ${last.decision}`);
  const waits = ticks.filter((t) => sameSha(t.sha, staging) && !PROMOTE_IDLE.has(t.decision)).length;
  if (waits >= PROMOTE_MAX_WAITS) return fail(`${lag}; ${waits} daytime promote ticks on this sha without a promote (last: ${last.decision})`);
  return pass(`${lag}; waits for the hourly promote (last tick ${last.at.slice(11, 16)}Z: ${last.decision})`);
}

function newestPublish() {
  const r = spawnSync("gh", ["run", "list", "-R", "zenod-ai/zenod", "--workflow", "publish.yml", "--branch", "main",
    "--status", "success", "-L", "1", "--json", "headSha,createdAt"], { encoding: "utf8", timeout: 60000 });
  if (r.status !== 0) return { error: "gh run list failed" };
  return (json(r.stdout) || [])[0] || { error: "no run" };
}

// ------------------------------------------------------------------------------------------ battery

export async function runBattery({ get = httpGet, ssh = sshRun, publish = newestPublish, ticks = promoteTicks, now = Date.now, overrides = {}, only } = {}) {
  const startedAt = new Date(now()).toISOString();
  const t0 = now();
  const ctx = { now, newestPublish: publish, promoteTicks: ticks };
  const cache = new Map();
  const results = [];
  for (const c of checks()) {
    if (only && !only.includes(c.id) && !only.includes(c.component)) continue;
    const s = now();
    let raw;
    let target;
    let verdict;
    try {
      if (c.kind === "http") {
        target = overrides[c.id] || c.url || URLS[c.id];
        if (!cache.has(target)) cache.set(target, await get(target));
        raw = cache.get(target);
      } else if (c.kind === "remote") {
        target = "VPS1";
        raw = await ssh(c.cmd);
      } else {
        raw = await c.run(ctx);
      }
      verdict = c.judge(raw, ctx);
    } catch (e) {
      verdict = fail(`check crashed: ${e?.message || e}`.slice(0, 120));
    }
    results.push({
      id: c.id, component: c.component, title: c.title, ok: verdict.ok, status: verdict.ok ? "pass" : "fail",
      reason: verdict.reason, ms: Math.max(0, Math.round(now() - s)), at: new Date(s).toISOString(),
      ...(overrides[c.id] ? { target, overridden: true } : {}),
    });
  }
  const components = {};
  for (const r of results) {
    const k = (components[r.component] ||= { name: COMPONENTS[r.component] || r.component, ok: true, pass: 0, fail: 0, checks: [] });
    k.checks.push(r.id);
    r.ok ? k.pass++ : k.fail++;
    if (!r.ok) {
      k.ok = false;
      k.reason ||= `${r.title}: ${r.reason}`;
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  return {
    schema: SCHEMA, battery: "prod", host: hostname(), startedAt, finishedAt: new Date(now()).toISOString(),
    durationMs: Math.round(now() - t0), ok: failed === 0, simulated: Object.keys(overrides).length > 0,
    ...(Object.keys(overrides).length ? { overrides } : {}),
    summary: { pass: results.length - failed, fail: failed, total: results.length }, components, checks: results,
  };
}

export function store(result, dir, keep = 96) {
  const runs = join(dir, "runs");
  mkdirSync(runs, { recursive: true });
  const stamp = result.startedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const body = JSON.stringify(result, null, 1);
  writeFileSync(join(runs, `${stamp}.json`), body);
  writeFileSync(join(dir, "latest.json.tmp"), body);
  renameSync(join(dir, "latest.json.tmp"), join(dir, "latest.json"));
  const files = readdirSync(runs).filter((f) => f.endsWith(".json")).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) rmSync(join(runs, f));
}

export function table(result) {
  const lines = [`${SCHEMA} ${result.startedAt}  ${result.summary.pass}/${result.summary.total} pass${result.simulated ? "  (test run with overrides)" : ""}`];
  for (const r of result.checks) lines.push(`${r.ok ? "PASS" : "FAIL"}  ${r.id.padEnd(22)} ${String(r.ms).padStart(5)} ms  ${r.reason}`);
  return lines.join("\n");
}

function parseArgs(argv) {
  const a = { overrides: {}, keep: 96 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--out") a.out = argv[++i];
    else if (k === "--keep") a.keep = Number(argv[++i]);
    else if (k === "--json") a.json = true;
    else if (k === "--only") a.only = argv[++i].split(",");
    else if (k === "--override") {
      const [id, ...rest] = argv[++i].split("=");
      if (!URLS[id]) throw new Error(`--override: ${id} is not an http check (${Object.keys(URLS).join(", ")})`);
      a.overrides[id] = rest.join("=");
    } else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseArgs(process.argv.slice(2));
  const result = await runBattery({ overrides: args.overrides, only: args.only });
  if (args.out) store(result, args.out, args.keep);
  console.log(args.json ? JSON.stringify(result, null, 1) : table(result));
  process.exitCode = result.ok ? 0 : 1;
}
