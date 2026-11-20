import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { judgePromoteLag, judgeVaultRecovery, runBattery, SCHEMA, store, URLS, VAULT_LOG_CMD } from "./smoke-prod.mjs";

const NOW = Date.parse("2026-11-03T16:00:00Z");

function healthyGet(url) {
  const ok = (body, status = 200, headers = {}) => ({ status, body: typeof body === "string" ? body : JSON.stringify(body), headers });
  switch (url) {
    case URLS["site.home"]: return ok("<title>Zenod — one memory</title>");
    case URLS["site.connect"]: return ok("<title>Connect Zenod to Claude</title>");
    case URLS["cloud.health"]: return ok({ status: "ok", sha: "abc1234def", eventLoop: { p99Ms: 20 } });
    case URLS["cloud.readiness"]: return ok({ ready: true, advisoryChecks: ["stripe_webhook"], checks: [] });
    case URLS["mcp.unauthorized"]: return ok({ error: "unauthorized" }, 401, { "www-authenticate": 'Bearer resource_metadata="x"' });
    case URLS["mcp.resource-metadata"]: return ok({ resource: "https://cloud.zenod.dev/mcp", authorization_servers: ["https://cloud.zenod.dev"] });
    case URLS["mcp.auth-metadata"]: return ok({ issuer: "https://cloud.zenod.dev", token_endpoint: "t", authorization_endpoint: "a" });
    case URLS["phylax.health"]: return ok({
      status: "ok", sha: "1707c9f", worker: { lastHeartbeatAt: NOW - 3000 }, restart: { required: false },
      channels: { whatsapp: { state: "connected", receivePath: { status: "ready", outageSince: null } } },
    });
    case URLS["host.observatory"]: return ok("ok");
    case URLS["staging.health"]: return ok({ status: "ok", sha: "abc1234def" });
    default: return { status: 0, body: "", headers: {}, error: `ENOTFOUND reaching ${new URL(url).host}` };
  }
}

function healthySsh(cmd) {
  if (cmd.includes("readiness-watch")) {
    return { code: 0, stdout: `2026-11-03T16:17:00+00:00 h zenod-readiness-watch[1]: [keeper] watch ready=True issues=[] proofs=[{"id": "backup_restore", "expiresAt": "2026-12-02T08:06:42Z", "daysLeft": 28.6}]\n` };
  }
  if (cmd.includes("docker logs")) return { code: 0, stdout: "READ-OK\n" };
  if (cmd.includes("tester-watch")) return { code: 0, stdout: "OK 1 tester(s), no alerts\n" };
  if (cmd.includes("deploy-poller")) return { code: 0, stdout: "2026-11-03T16:58:00+00:00 h python3[1]: deploy-poller zenod-staging: noop up to date\n" };
  if (cmd.includes("zenod-health-watchdog")) return { code: 0, stdout: "user=inactive root=active\n" };
  if (cmd.includes("is-active")) return { code: 0, stdout: "active\n" };
  if (cmd.startsWith("df")) return { code: 0, stdout: "/dev/sda1 78425224 39839000 35341484 53% /\n" };
  return { code: 1, stdout: "" };
}

const base = { get: healthyGet, ssh: healthySsh, publish: () => ({ headSha: "abc1234def", createdAt: "2026-11-03T10:00:00Z" }), ticks: () => [], now: () => NOW };

test("all checks pass on a healthy prod and the result has the documented shape", async () => {
  const r = await runBattery(base);
  assert.equal(r.schema, SCHEMA);
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(r.simulated, false);
  assert.equal(r.summary.fail, 0);
  assert.ok(r.summary.total >= 15);
  for (const c of r.checks) {
    assert.equal(typeof c.reason, "string");
    assert.equal(typeof c.ms, "number");
    assert.ok(["pass", "fail"].includes(c.status));
  }
  assert.deepEqual(Object.keys(r.components).sort(), ["cloud", "deploy", "host", "ingress", "phylax", "readiness", "site", "tester_watch", "watchdog"]);
});

test("an override to a bogus URL fails that check with a reason and marks the run simulated", async () => {
  const r = await runBattery({ ...base, overrides: { "site.home": "https://bogus.invalid/" } });
  assert.equal(r.ok, false);
  assert.equal(r.simulated, true);
  const c = r.checks.find((x) => x.id === "site.home");
  assert.equal(c.status, "fail");
  assert.match(c.reason, /ENOTFOUND reaching bogus\.invalid/);
  assert.equal(r.components.site.ok, false);
  assert.match(r.components.site.reason, /Home page answers/);
  assert.equal(r.components.cloud.ok, true);
});

test("judges catch stale deploys, a disconnected WhatsApp and an expired proof", async () => {
  const get = (url) => {
    if (url === URLS["phylax.health"]) {
      const j = JSON.parse(healthyGet(url).body);
      j.channels.whatsapp = { state: "disconnected", receivePath: { status: "reconnecting", reason: "428" } };
      return { status: 200, body: JSON.stringify(j), headers: {} };
    }
    return healthyGet(url);
  };
  const ssh = (cmd) => (cmd.includes("readiness-watch")
    ? { code: 0, stdout: `2026-11-03T15:30:00+00:00 h x[1]: watch ready=True issues=[] proofs=[{"id": "backup_restore", "expiresAt": "2026-11-01T00:00:00Z", "daysLeft": -2.6}]\n` }
    : healthySsh(cmd));
  const r = await runBattery({ ...base, get, ssh, publish: () => ({ headSha: "fff0000", createdAt: "2026-11-03T12:00:00Z" }) });
  const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.match(by["cloud.deployed-sha"].reason, /staging abc1234 but newest publish is fff0000/);
  assert.match(by["phylax.whatsapp"].reason, /state disconnected, receive path reconnecting \(428\)/);
  assert.match(by["readiness.proofs"].reason, /expired proof: backup_restore/);
  assert.equal(by["phylax.health"].ok, true);
  assert.match(by["watchdog.timer"].reason, /old root zenod-watchdog/);
});

test("store keeps latest.json and only the newest N runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zenod-smoke-"));
  try {
    for (let i = 0; i < 5; i++) {
      const r = await runBattery({ ...base, now: () => NOW + i * 900000 });
      store(r, dir, 3);
    }
    assert.equal(readdirSync(join(dir, "runs")).length, 3);
    assert.equal(JSON.parse(readFileSync(join(dir, "latest.json"), "utf8")).startedAt, new Date(NOW + 4 * 900000).toISOString());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// EPIC-24 M22: production lagging staging is red only when the hourly promote tick says it is stuck.
const AT = Date.parse("2026-11-19T17:31:00Z");
const lagCtx = { cloudSha: "5bda977f4c7c", stagingSha: "c4c920c4fdf0", now: () => AT };
const tick = (at, decision, sha = "c4c920c4fdf000d8") => ({ at, sha, production: "5bda977f4c7c", decision });

test("promote lag: the 19 Nov 17:31Z false alarm (staging 11 min old, tick batching) now passes", () => {
  const ticks = [tick("2026-11-19T16:42:53Z", "promoted", "5bda977f4c7c")];
  assert.equal(judgePromoteLag(ticks, lagCtx).ok, true);
  const r = judgePromoteLag([...ticks, tick("2026-11-19T17:43:29Z", "batching")], { ...lagCtx, now: () => Date.parse("2026-11-19T18:00:00Z") });
  assert.equal(r.ok, true, r.reason);
  assert.match(r.reason, /waits for the hourly promote/);
  assert.equal(judgePromoteLag([], { ...lagCtx, stagingSha: "5bda977" }).ok, true);
});

test("promote lag: quiet hours and an infra pause stay green however long", () => {
  const night = Array.from({ length: 9 }, (_, i) => tick(new Date(Date.parse("2026-11-19T21:41:00Z") + i * 3600000).toISOString(), "quiet-hours"));
  assert.equal(judgePromoteLag(night, { ...lagCtx, now: () => Date.parse(night.at(-1).at) + 600000 }).ok, true);
  assert.equal(judgePromoteLag([tick("2026-11-19T17:41:00Z", "paused")], { ...lagCtx, now: () => Date.parse("2026-11-19T18:00:00Z") }).ok, true);
});

test("promote lag: a real stall stays red (silent tick, failed gate, daytime ticks that never promote)", () => {
  const silent = judgePromoteLag([tick("2026-11-19T15:41:00Z", "batching")], lagCtx);
  assert.equal(silent.ok, false);
  assert.match(silent.reason, /promote tick silent for 110 min/);
  const none = judgePromoteLag([], lagCtx);
  assert.equal(none.ok, false);
  for (const d of ["gate-failed", "gate-failed-earlier", "promote-failed", "error"]) {
    const r = judgePromoteLag([tick("2026-11-19T17:20:00Z", d)], lagCtx);
    assert.equal(r.ok, false, d);
    assert.match(r.reason, new RegExp(`17:20Z: ${d}`));
  }
  const stuck = ["14:41", "15:41", "16:41"].map((h) => tick(`2026-11-19T${h}:00Z`, "hourly-limit"));
  const r = judgePromoteLag(stuck, lagCtx);
  assert.equal(r.ok, false);
  assert.match(r.reason, /3 daytime promote ticks on this sha without a promote/);
});

test("promote lag runs in the battery and reads the injected tick log", async () => {
  const get = (url) => (url === URLS["staging.health"] ? { status: 200, body: JSON.stringify({ status: "ok", sha: "fff0000aaa" }), headers: {} } : healthyGet(url));
  const r = await runBattery({ ...base, get, ticks: () => [{ at: "2026-11-03T13:41:00Z", sha: "fff0000aaa", decision: "batching" }] });
  const c = r.checks.find((x) => x.id === "cloud.promote-lag");
  assert.equal(c.ok, false);
  assert.match(c.reason, /silent for 139 min/);
});

test("deploy poller: a zenod-staging line is green, no line in 10 min is red", async () => {
  let r = await runBattery({ ...base, only: ["deploy.poller"] });
  assert.equal(r.checks[0].ok, true);
  assert.match(r.checks[0].reason, /noop up to date/);
  r = await runBattery({ ...base, only: ["deploy.poller"], ssh: (cmd) => (cmd.includes("deploy-poller") ? { code: 1, stdout: "" } : healthySsh(cmd)) });
  assert.equal(r.checks[0].ok, false);
  r = await runBattery({ ...base, only: ["deploy.poller"], ssh: (cmd) => (cmd.includes("deploy-poller") ? { code: 0, stdout: "" } : healthySsh(cmd)) });
  assert.equal(r.checks[0].ok, false);
  assert.match(r.checks[0].reason, /no deploy-poller run in 10 min/);
});

// EPIC-24 M25: a stuck tenant vault (the 19 Nov 22:56Z case) shows red on the page.
const VNOW = Date.parse("2026-11-20T00:35:30Z");
const J = "Drive transaction journal 9172c14c-3faa-46de-945a-b143917eb03c has a preserved external edit";
const fails = (from, count, suffix = "") => Array.from({ length: count }, (_, i) =>
  `${new Date(Date.parse(from) + i * 300000).toISOString().slice(0, 19)}.123456789Z [quick-index] update failed: ${J}${suffix}`);
const vlog = (...lines) => ({ code: 0, stdout: `${lines.flat().join("\n")}\nREAD-OK\n` });

test("vault recovery: the 19 Nov case (failing every 5 min since 23:02Z, UNRESOLVED at 23:27Z) is red with both causes", () => {
  const r = judgeVaultRecovery(vlog(fails("2026-11-19T23:02:30Z", 19),
    '2026-11-19T23:27:24.004Z [vault-recovery] UNRESOLVED: filing still interrupted: {"interrupted":true}'), VNOW);
  assert.equal(r.ok, false);
  assert.match(r.reason, /vault recovery UNRESOLVED since 23:27Z/);
  assert.match(r.reason, /quick-index failing 90 min since 23:02Z: Drive transaction journal 9172c14c/);
});

test("vault recovery: a short failure streak, a finished streak and a clean log stay green", () => {
  assert.equal(judgeVaultRecovery(vlog(fails("2026-11-20T00:15:00Z", 5)), VNOW).ok, true); // 20 min
  assert.equal(judgeVaultRecovery(vlog(fails("2026-11-19T22:00:00Z", 12)), VNOW).ok, true); // ended at 22:55Z, hours ago
  assert.equal(judgeVaultRecovery(vlog([]), VNOW).ok, true);
  // a gap longer than 12 min ends the streak: two short bursts are not one long failure
  assert.equal(judgeVaultRecovery(vlog(fails("2026-11-19T23:50:00Z", 3), fails("2026-11-20T00:25:00Z", 3)), VNOW).ok, true);
});

test("vault recovery: the streak turns red at 30 min and is tied to its tenant once the log names it", () => {
  assert.equal(judgeVaultRecovery(vlog(fails("2026-11-20T00:05:00Z", 7, " tenant=user-usr_450335af")), VNOW).ok, false);
  const r = judgeVaultRecovery(vlog(fails("2026-11-20T00:05:00Z", 7, " tenant=user-usr_450335af")), VNOW);
  assert.match(r.reason, /\(tenant user-usr_450335af\)/);
  assert.equal(judgeVaultRecovery(vlog(fails("2026-11-20T00:10:00Z", 6, " tenant=user-usr_450335af")), VNOW).ok, true); // 25 min so far
});

test("vault recovery: UNRESOLVED clears when that tenant recovers, not when another one does", () => {
  const un = (t) => `2026-11-20T00:00:00.1Z [vault-recovery] UNRESOLVED: filing still interrupted: {} tenant=${t}`;
  const ok = (t) => `2026-11-20T00:20:00.1Z [vault-recovery] recovered; writes unblocked: {"requeued":0} tenant=${t}`;
  assert.equal(judgeVaultRecovery(vlog(un("a"), ok("a")), VNOW).ok, true);
  const r = judgeVaultRecovery(vlog(un("a"), ok("b")), VNOW);
  assert.equal(r.ok, false);
  assert.match(r.reason, /tenant a/);
});

test("vault recovery: an unreadable production log is red, never a silent pass", async () => {
  assert.equal(judgeVaultRecovery({ code: 255, stdout: "" }, VNOW).ok, false);
  assert.match(judgeVaultRecovery({ code: 0, stdout: "CONTAINER-UNKNOWN\n" }, VNOW).reason, /no running zenod-mt container/);
  const r = await runBattery({ ...base, only: ["cloud.vault-recovery"], ssh: (cmd) => (cmd.includes("docker logs") ? vlog(fails("2026-11-03T15:00:00Z", 13)) : healthySsh(cmd)) });
  assert.equal(r.checks[0].ok, false);
  assert.equal(r.components.cloud.ok, false);
});

test("vault recovery reads the log with the exact read-only docker forms the VPS1 sudo rules allow", () => {
  assert.match(VAULT_LOG_CMD, /sudo -n docker service ps -q --no-trunc zenod-mt-fxpzoo/);
  assert.match(VAULT_LOG_CMD, /docker inspect --type task --format '\{\{\.ServiceID\}\}\|\{\{\.Status\.ContainerStatus\.ContainerID\}\}/);
  assert.match(VAULT_LOG_CMD, /docker logs --since \$\(date -u [^)]*\) --until \$\(date -u [^)]*\) --timestamps \$C/);
  assert.doesNotMatch(VAULT_LOG_CMD, /docker (exec|rm|restart|stop|kill)/);
});
