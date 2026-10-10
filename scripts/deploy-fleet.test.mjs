// Tests scripts/deploy-fleet.sh against an in-process fake Dokploy + health endpoint
// (real curl/jq, no network). Covers the 2026-10-10 failure: a stale GIT_SHA env line
// made /api/health report the old sha after a correct roll.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const script = join(dirname(fileURLToPath(import.meta.url)), "deploy-fleet.sh");
const NEW_SHA = "066ab3d4eedab49aa975b2f02623cdfc271bf6c0";
const IMAGE = "ghcr.io/zenod-ai/zenod:sha-066ab3d";

async function fake({ image, env, healthAfterDeploy, rollDelayMs = 0 }) {
  const calls = [];
  const app = { applicationId: "app1", name: "zenod-mt", dockerImage: image, env, applicationStatus: "done" };
  let deployedAt = null;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const send = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
      if (req.method === "POST") {
        const parsed = JSON.parse(body || "{}");
        calls.push({ path: url.pathname, body: parsed });
        if (url.pathname === "/api/application.update") {
          if (parsed.dockerImage) app.dockerImage = parsed.dockerImage;
          if (parsed.env !== undefined) app.env = parsed.env;
        }
        if (url.pathname === "/api/application.deploy") deployedAt = Date.now();
        return send({});
      }
      if (url.pathname === "/api/project.all") {
        return send([{ name: "zenod", environments: [{ name: "production", applications: [
          { applicationId: app.applicationId, name: app.name, dockerImage: app.dockerImage }] }] }]);
      }
      if (url.pathname === "/api/application.one") return send(app);
      if (url.pathname === "/health") {
        return send({ status: "ok", sha: deployedAt !== null && Date.now() - deployedAt >= rollDelayMs ? healthAfterDeploy : "587c00521ddda32295a3dfff44e15f428935e853" });
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return { calls, port, close: () => server.close() };
}

async function run(f, extra = {}) {
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    IMAGE, DOKPLOY_API_KEY: "k", DOKPLOY_API_BASE: `http://127.0.0.1:${f.port}/api`,
    VERIFY_URL: `http://127.0.0.1:${f.port}/health`, SETTLE_SECONDS: "0", HEALTH_TIMEOUT_SECONDS: "3",
    ...extra,
  };
  const child = spawn("bash", [script], { env });
  let out = "";
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (out += c));
  const code = await new Promise((r) => child.on("close", r));
  f.close();
  return { code, out };
}

const OLD_IMAGE = "ghcr.io/zenod-ai/zenod@sha256:67b6af5da627720c021e2fcc49cc4258ba9e2584458f74c57280930a417178b3";

test("strips a stale GIT_SHA env override, keeps other env lines, succeeds on matching health", async () => {
  const f = await fake({ image: OLD_IMAGE, env: "A=1\nGIT_SHA=587c005\nB=two words\n", healthAfterDeploy: NEW_SHA });
  const { code, out } = await run(f);
  assert.equal(code, 0, out);
  const update = f.calls.find((c) => c.path === "/api/application.update").body;
  assert.equal(update.dockerImage, IMAGE);
  assert.equal(update.env, "A=1\nB=two words");
  assert.ok(f.calls.some((c) => c.path === "/api/application.deploy"));
});

test("without an override the update carries no env field", async () => {
  const f = await fake({ image: OLD_IMAGE, env: "A=1\n", healthAfterDeploy: NEW_SHA });
  const { code, out } = await run(f);
  assert.equal(code, 0, out);
  assert.equal("env" in f.calls.find((c) => c.path === "/api/application.update").body, false);
});

test("already on the image but with a stale override still re-deploys", async () => {
  const f = await fake({ image: IMAGE, env: "GIT_SHA=587c005\nA=1", healthAfterDeploy: NEW_SHA });
  const { code, out } = await run(f);
  assert.equal(code, 0, out);
  assert.ok(f.calls.some((c) => c.path === "/api/application.deploy"));
});

test("already on the image and clean env is a no-op", async () => {
  const f = await fake({ image: IMAGE, env: "A=1", healthAfterDeploy: NEW_SHA });
  const { code, out } = await run(f);
  assert.equal(code, 0, out);
  assert.equal(f.calls.length, 0);
});

test("fails (never reports success) when live health keeps the old sha", async () => {
  const f = await fake({ image: OLD_IMAGE, env: "A=1", healthAfterDeploy: "587c00521ddda32295a3dfff44e15f428935e853" });
  const { code, out } = await run(f, { HEALTH_TIMEOUT_SECONDS: "1" });
  assert.notEqual(code, 0);
  assert.match(out, /timed out after \d+s \(limit 1s;/);
  assert.match(out, /live sha '587c00521ddda32295a3dfff44e15f428935e853'/);
});

// 2026-10-10 a7673eb: Dokploy queued the deploy behind an unrelated build, so health
// kept the old sha (Dokploy status 'done' throughout) for minutes before the roll
// landed. A slow-but-successful roll within the timeout must succeed.
test("slow roll: health flips to the new sha only after a delay, within the timeout", async () => {
  const f = await fake({ image: OLD_IMAGE, env: "A=1", healthAfterDeploy: NEW_SHA, rollDelayMs: 4000 });
  const { code, out } = await run(f, { HEALTH_TIMEOUT_SECONDS: "20", HEALTH_POLL_SECONDS: "1" });
  assert.equal(code, 0, out);
  assert.match(out, /live sha 066ab3d\w+ matches \(Dokploy status 'done', \d+s after deploy request\)/);
});

test("slow roll beyond the configured timeout still fails with elapsed time and live sha", async () => {
  const f = await fake({ image: OLD_IMAGE, env: "A=1", healthAfterDeploy: NEW_SHA, rollDelayMs: 60000 });
  const { code, out } = await run(f, { HEALTH_TIMEOUT_SECONDS: "3", HEALTH_POLL_SECONDS: "1" });
  assert.notEqual(code, 0);
  assert.match(out, /timed out after [3-9]s \(limit 3s;.*live sha '587c005/);
});

test("default timeout is 900s and the workflow job limit exceeds it", async () => {
  const { readFileSync } = await import("node:fs");
  const sh = readFileSync(script, "utf8");
  assert.match(sh, /HEALTH_TIMEOUT_SECONDS="\$\{HEALTH_TIMEOUT_SECONDS:-900\}"/);
  const wf = readFileSync(join(dirname(script), "..", ".github", "workflows", "publish.yml"), "utf8");
  const deploy = wf.slice(wf.indexOf("\n  deploy:"));
  const minutes = Number(/timeout-minutes:\s*(\d+)/.exec(deploy)[1]);
  assert.ok(minutes * 60 >= 900 + 300, `deploy timeout-minutes ${minutes} too small`);
});

test("DRY_RUN changes nothing", async () => {
  const f = await fake({ image: OLD_IMAGE, env: "GIT_SHA=587c005", healthAfterDeploy: NEW_SHA });
  const { code, out } = await run(f, { DRY_RUN: "1" });
  assert.equal(code, 0, out);
  assert.equal(f.calls.length, 0);
  assert.match(out, /strip_git_sha_env=1/);
});

test("refuses an app outside the zenod image boundary", async () => {
  const f = await fake({ image: "ghcr.io/zenod-ai/phylax@sha256:abc", env: "", healthAfterDeploy: NEW_SHA });
  const { code, out } = await run(f);
  assert.notEqual(code, 0);
  assert.match(out, /outside Zenod production boundary/);
  assert.equal(f.calls.length, 0);
});
