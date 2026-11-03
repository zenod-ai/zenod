import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runBattery, SCHEMA, store, URLS } from "./smoke-prod.mjs";

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
    default: return { status: 0, body: "", headers: {}, error: `ENOTFOUND reaching ${new URL(url).host}` };
  }
}

function healthySsh(cmd) {
  if (cmd.includes("readiness-watch")) {
    return { code: 0, stdout: `2026-11-03T16:17:00+00:00 h zenod-readiness-watch[1]: [keeper] watch ready=True issues=[] proofs=[{"id": "backup_restore", "expiresAt": "2026-12-02T08:06:42Z", "daysLeft": 28.6}]\n` };
  }
  if (cmd.includes("tester-watch")) return { code: 0, stdout: "OK 1 tester(s), no alerts\n" };
  if (cmd.includes("deploy-poller")) return { code: 0, stdout: "2026-11-03T16:58:00+00:00 h python3[1]: deploy-poller zenod-mt: noop up to date\n" };
  if (cmd.includes("zenod-health-watchdog")) return { code: 0, stdout: "user=inactive root=active\n" };
  if (cmd.includes("is-active")) return { code: 0, stdout: "active\n" };
  if (cmd.startsWith("df")) return { code: 0, stdout: "/dev/sda1 78425224 39839000 35341484 53% /\n" };
  return { code: 1, stdout: "" };
}

const base = { get: healthyGet, ssh: healthySsh, publish: () => ({ headSha: "abc1234def", createdAt: "2026-11-03T10:00:00Z" }), now: () => NOW };

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
  assert.match(by["cloud.deployed-sha"].reason, /newest publish is fff0000/);
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
