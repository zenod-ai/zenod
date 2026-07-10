#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const TENANT_COUNT = 3;
const CHASSIS_SQLITE_PATHS = ["chassis-tenants.sqlite", "usage.sqlite"];
const REQUIRED_TENANT_PATHS = [
  "zenod.sqlite",
  "oauth.sqlite",
  "whatsapp/whatsapp.sqlite",
  "ingest.sqlite",
  "tasks.sqlite",
  "execution.sqlite",
  "journeys.sqlite",
  "usage.sqlite",
  "notifications.sqlite",
  "vault.sqlite",
  "transcripts",
];
const FORBIDDEN_ROOT_STATE = [
  "zenod.sqlite",
  "oauth.sqlite",
  "whatsapp",
  "ingest.sqlite",
  "tasks.sqlite",
  "execution.sqlite",
  "journeys.sqlite",
  "notifications.sqlite",
  "vault.sqlite",
  "transcripts",
  "vault",
  "media",
];

export class ProofFailure extends Error {
  constructor(message, { kind = "failure", detail } = {}) {
    super(message);
    this.name = "ProofFailure";
    this.kind = kind;
    this.detail = detail;
  }
}

export function parseArgs(argv, env = process.env) {
  const options = {
    baseUrl: env.EPIC32_BASE_URL ?? "http://127.0.0.1:8080",
    controlToken: env.CONTROL_PLANE_TOKEN ?? "",
    dataRoot: env.EPIC32_DATA_ROOT ?? "",
    evidenceDir: env.EPIC32_EVIDENCE_DIR ?? "",
    mode: env.EPIC32_MODE ?? "contract",
    selfHostUrl: env.EPIC32_SELF_HOST_URL ?? "",
    selfHostToken: env.EPIC32_SELF_HOST_TOKEN ?? "",
    migratedUrl: env.EPIC32_MIGRATED_URL ?? "",
    migratedToken: env.EPIC32_MIGRATED_TOKEN ?? "",
    runId: env.EPIC32_RUN_ID ?? "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--help") return { ...options, help: true };
    if (!value || value.startsWith("--")) throw new ProofFailure(`missing value for ${key}`, { kind: "usage" });
    if (key === "--base-url") options.baseUrl = value;
    else if (key === "--control-token") options.controlToken = value;
    else if (key === "--data-root") options.dataRoot = value;
    else if (key === "--evidence-dir") options.evidenceDir = value;
    else if (key === "--mode") options.mode = value;
    else if (key === "--self-host-url") options.selfHostUrl = value;
    else if (key === "--self-host-token") options.selfHostToken = value;
    else if (key === "--migrated-url") options.migratedUrl = value;
    else if (key === "--migrated-token") options.migratedToken = value;
    else if (key === "--run-id") options.runId = value;
    else throw new ProofFailure(`unknown option ${key}`, { kind: "usage" });
    index += 1;
  }
  if (!new Set(["contract", "full"]).has(options.mode)) {
    throw new ProofFailure("--mode must be contract or full", { kind: "usage" });
  }
  return options;
}

export function parseMcpPayload(text, contentType = "application/json") {
  if (contentType.includes("text/event-stream")) {
    const events = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]")
      .map((line) => JSON.parse(line));
    if (events.length === 0) throw new ProofFailure("MCP response contained no data event");
    return events.at(-1);
  }
  return JSON.parse(text);
}

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        /token|secret|password|authorization|cookie|private.?key/i.test(key) ? "[redacted]" : redact(child),
      ]),
    );
  }
  if (typeof value !== "string") return value;
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/zenod_[A-Za-z0-9_-]{12,}/g, "zenod_[redacted]")
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "gh_[redacted]");
}

export function assertNoForeignMarker(payload, ownMarker, foreignMarkers) {
  const text = JSON.stringify(payload);
  if (ownMarker && !text.includes(ownMarker)) {
    throw new ProofFailure(`own marker was not returned: ${ownMarker}`);
  }
  for (const marker of foreignMarkers) {
    if (text.includes(marker)) throw new ProofFailure(`cross-tenant marker leaked: ${marker}`);
  }
}

export function extractProvisionedToken(payload) {
  const candidates = [payload?.token, payload?.rawToken, payload?.credential, payload?.tenant?.token];
  return candidates.find((value) => typeof value === "string" && value.length > 0) ?? null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function tenantFixture(index, runId, env) {
  const label = `T${index + 1}`;
  const lower = label.toLowerCase();
  return {
    label,
    tenantId: `epic32-${runId}-${lower}`.slice(0, 64),
    name: `Epic 3.2 proof ${label}`,
    token: "",
    issuedTokens: [],
    marker: `EPIC32_${runId}_${label}_MARKER_${randomBytes(8).toString("hex")}`,
    repo: env[`EPIC32_${label}_REPO`] ?? `epic32-proof/${runId}-${lower}`,
    githubToken: env[`EPIC32_${label}_GITHUB_TOKEN`] ?? env.EPIC32_GITHUB_TOKEN ?? "",
    provider: env.EPIC32_PROVIDER ?? "openrouter",
    apiKey: env.EPIC32_LLM_API_KEY ?? "",
    sessionCookie: "",
  };
}

function createRecorder(metadata) {
  const steps = [];
  return {
    pass(name, detail = {}) {
      steps.push({ name, status: "pass", detail: redact(detail) });
      process.stdout.write(`PASS ${name}\n`);
    },
    fail(name, error) {
      const detail = error instanceof ProofFailure ? error.detail : undefined;
      steps.push({ name, status: "fail", error: String(error?.message ?? error), detail: redact(detail) });
      process.stderr.write(`FAIL ${name}: ${error?.message ?? error}\n`);
    },
    skip(name, reason) {
      steps.push({ name, status: "skip", reason });
      process.stdout.write(`SKIP ${name}: ${reason}\n`);
    },
    summary(status) {
      return { ...metadata, status, steps };
    },
  };
}

async function fetchPayload(url, init = {}) {
  let response;
  try {
    response = await fetch(url, { redirect: "manual", ...init });
  } catch (error) {
    throw new ProofFailure(`cannot reach ${url}: ${error.message}`, { kind: "prerequisite" });
  }
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { response, body, text };
}

async function jsonRequest(baseUrl, path, { method = "GET", token, cookie, body } = {}) {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (cookie) headers.set("Cookie", cookie);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return fetchPayload(`${normalizeBaseUrl(baseUrl)}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function mcpRequest(baseUrl, token, method, params = {}, id = 1) {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/mcp/${encodeURIComponent(token)}`;
  const { response, text } = await fetchPayload(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  if (!response.ok) {
    const kind = [404, 405].includes(response.status) ? "prerequisite" : "failure";
    throw new ProofFailure(`MCP ${method} returned HTTP ${response.status}`, {
      kind,
      detail: { endpoint: "/mcp/[redacted]", status: response.status, body: redact(text.slice(0, 500)) },
    });
  }
  const payload = parseMcpPayload(text, response.headers.get("content-type") ?? "");
  if (payload.error) throw new ProofFailure(`MCP ${method} failed: ${payload.error.message ?? "unknown error"}`);
  return payload.result;
}

async function mcpInitialize(baseUrl, token) {
  return mcpRequest(baseUrl, token, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "epic32-joint-proof", version: "1.0.0" },
  });
}

async function callTool(baseUrl, token, name, args) {
  return mcpRequest(baseUrl, token, "tools/call", { name, arguments: args }, Math.floor(Math.random() * 1_000_000));
}

async function terminalToolResult(baseUrl, token, initial) {
  const first = initial?.structuredContent ?? initial;
  if (!first?.jobId || !new Set(["queued", "running"]).has(first.status)) return first;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const polled = await callTool(baseUrl, token, "get_task_result", { jobId: first.jobId });
    const job = polled?.structuredContent ?? polled;
    if (job?.status === "done") return job.result ?? job;
    if (new Set(["error", "failed", "interrupted", "cancelled"]).has(job?.status)) {
      throw new ProofFailure(`job ${first.jobId} ended ${job.status}`, { detail: redact(job) });
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new ProofFailure(`job ${first.jobId} did not finish within 30 seconds`);
}

function expectStatus(result, allowed, name, kind = "failure") {
  if (!allowed.includes(result.response.status)) {
    throw new ProofFailure(`${name} returned HTTP ${result.response.status}; expected ${allowed.join(" or ")}`, {
      kind,
      detail: { status: result.response.status, body: redact(result.body) },
    });
  }
}

async function provisionTenants(baseUrl, controlToken, tenants) {
  const unauthenticated = await jsonRequest(baseUrl, "/api/tenants", { method: "POST", body: {} });
  expectStatus(unauthenticated, [401, 403], "unauthenticated tenant provisioning");

  for (const tenant of tenants) {
    const provisioned = await jsonRequest(baseUrl, "/api/tenants", {
      method: "POST",
      token: controlToken,
      body: { tenantId: tenant.tenantId, name: tenant.name, plan: "pilot" },
    });
    expectStatus(provisioned, [201], `provision ${tenant.label}`, "prerequisite");
    const returnedToken = extractProvisionedToken(provisioned.body);
    if (!returnedToken) {
      throw new ProofFailure(`${tenant.label} provisioning omitted the one-time raw token`, {
        kind: "prerequisite",
      });
    }
    tenant.token = returnedToken;
    tenant.issuedTokens.push(returnedToken);

    const settings = {
      vault_repo: tenant.repo,
      vault_branch: "main",
      ...(tenant.githubToken ? { github_token: tenant.githubToken } : {}),
      ...(tenant.apiKey
        ? {
            provider: tenant.provider,
            [`${tenant.provider}_api_key`]: tenant.apiKey,
          }
        : {}),
    };
    const configured = await jsonRequest(baseUrl, "/api/settings", {
      method: "PUT",
      token: tenant.token,
      body: settings,
    });
    expectStatus(configured, [200], `configure ${tenant.label}`, "prerequisite");
  }
  return {
    tenants: tenants.map(({ tenantId, name }) => ({ tenantId, name })),
    registryVisibility: "no list endpoint; persistence redaction verified by storage scan",
  };
}

async function verifyMcpIsolation(baseUrl, tenants, mode) {
  const unknown = await fetchPayload(`${normalizeBaseUrl(baseUrl)}/mcp/zenod_unknown_${randomBytes(16).toString("hex")}`, {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "negative", version: "1" } },
    }),
  });
  expectStatus(unknown, [401], "unknown token negative");

  for (const tenant of tenants) {
    const initialized = await mcpInitialize(baseUrl, tenant.token);
    if (!initialized?.serverInfo) throw new ProofFailure(`${tenant.label} initialize omitted serverInfo`);
    const listed = await mcpRequest(baseUrl, tenant.token, "tools/list", {}, 2);
    if (!Array.isArray(listed?.tools)) throw new ProofFailure(`${tenant.label} tools/list omitted tools`);
    const timeline = await callTool(baseUrl, tenant.token, "read_llm_timeline", {
      windowMinutes: 60,
      limit: 10,
    });
    if (timeline?.isError) {
      throw new ProofFailure(`${tenant.label} declared read tool failed conduct`, {
        detail: redact(timeline),
      });
    }
    if (!Array.isArray(timeline?.structuredContent?.calls)) {
      throw new ProofFailure(`${tenant.label} read_llm_timeline omitted calls[]`);
    }
  }

  if (mode !== "full") return;
  for (const tenant of tenants) {
    if (!tenant.githubToken || !tenant.apiKey) {
      throw new ProofFailure("full mode requires EPIC32_GITHUB_TOKEN (or per-tenant tokens) and EPIC32_LLM_API_KEY", {
        kind: "prerequisite",
      });
    }
    const stored = await callTool(baseUrl, tenant.token, "store_memory", {
      content: `${tenant.marker}\nJoint Epic 3.1 and 3.2 tenant isolation proof for ${tenant.label}.`,
      source: "epic32-joint-proof",
    });
    const queued = stored?.structuredContent ?? stored;
    if (
      !Array.isArray(queued?.evidence) ||
      !queued.evidence.some(
        (item) => item?.kind === "job_queued" && item?.id === queued.jobId,
      )
    ) {
      throw new ProofFailure(`${tenant.label} store_memory omitted its C-16 queue receipt`, {
        detail: redact(queued),
      });
    }
    const receipt = await terminalToolResult(baseUrl, tenant.token, stored);
    const receiptText = JSON.stringify(receipt);
    if (!/[a-f0-9]{40}/i.test(receiptText)) throw new ProofFailure(`${tenant.label} store receipt omitted a commit SHA`);
    if (!receiptText.toLowerCase().includes(tenant.repo.toLowerCase())) {
      throw new ProofFailure(`${tenant.label} store receipt did not identify ${tenant.repo}`);
    }
  }

  for (const tenant of tenants) {
    const own = await callTool(baseUrl, tenant.token, "search_memory", { query: tenant.marker });
    assertNoForeignMarker(own, tenant.marker, tenants.filter((item) => item !== tenant).map((item) => item.marker));
    for (const foreign of tenants.filter((item) => item !== tenant)) {
      const negative = await callTool(baseUrl, tenant.token, "search_memory", { query: foreign.marker });
      assertNoForeignMarker(negative, "", [foreign.marker]);
    }
  }
}

async function verifyAnonymousWeb(baseUrl) {
  const root = await fetchPayload(`${normalizeBaseUrl(baseUrl)}/`);
  expectStatus(root, [200], "anonymous SPA root", "prerequisite");
  if (typeof root.body !== "string" || !root.body.includes("<html")) {
    throw new ProofFailure("anonymous SPA root did not return HTML");
  }
  const assetPath = root.body.match(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/i)?.[1];
  if (!assetPath) throw new ProofFailure("anonymous SPA root did not reference a built JS/CSS asset");
  const assetUrl = new URL(assetPath, `${normalizeBaseUrl(baseUrl)}/`).toString();
  const asset = await fetchPayload(assetUrl);
  expectStatus(asset, [200], "anonymous SPA asset", "prerequisite");
  if (!asset.text.trim()) throw new ProofFailure("anonymous SPA asset was empty");

  const protectedApi = await jsonRequest(baseUrl, "/api/settings");
  expectStatus(protectedApi, [401], "anonymous protected product API");
  return {
    rootStatus: root.response.status,
    assetPath,
    assetStatus: asset.response.status,
    protectedApiStatus: protectedApi.response.status,
  };
}

async function rotateTenantToken(baseUrl, controlToken, tenant) {
  const retiredToken = tenant.token;
  const rotated = await jsonRequest(
    baseUrl,
    `/api/tenants/${encodeURIComponent(tenant.tenantId)}/token/rotate`,
    { method: "POST", token: controlToken },
  );
  expectStatus(rotated, [200], `${tenant.label} token rotation`);
  const nextToken = extractProvisionedToken(rotated.body);
  if (!nextToken || nextToken === retiredToken) {
    throw new ProofFailure(`${tenant.label} token rotation did not return a new one-time token`);
  }
  tenant.token = nextToken;
  tenant.issuedTokens.push(nextToken);

  const retired = await jsonRequest(baseUrl, "/api/settings", { token: retiredToken });
  expectStatus(retired, [401], `${tenant.label} retired token negative`);
  const active = await jsonRequest(baseUrl, "/api/settings", { token: nextToken });
  expectStatus(active, [200], `${tenant.label} rotated token settings`);
  await mcpInitialize(baseUrl, nextToken);

  const login = await jsonRequest(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { token: nextToken },
  });
  expectStatus(login, [200], `${tenant.label} rotated token session login`);
  const cookie = (login.response.headers.get("set-cookie") ?? "").split(";", 1)[0];
  if (!cookie.includes("=")) throw new ProofFailure(`${tenant.label} rotated token returned no session cookie`);
  const session = await jsonRequest(baseUrl, "/api/settings", { cookie });
  expectStatus(session, [200], `${tenant.label} rotated token session`);
  return {
    tenantId: tenant.tenantId,
    retiredCredentialSha256: sha256(retiredToken),
    activeCredentialSha256: sha256(nextToken),
    retiredStatus: retired.response.status,
    activeStatus: active.response.status,
    sessionStatus: session.response.status,
  };
}

async function tenantApiSnapshot(baseUrl, tenant, auth) {
  const results = {};
  for (const [name, path] of [
    ["settings", "/api/settings"],
    ["vault", "/api/vault"],
    ["ingest", "/api/ingest/jobs"],
    ["usage", "/api/usage"],
  ]) {
    const result = await jsonRequest(baseUrl, path, auth);
    expectStatus(result, [200], `${tenant.label} ${name} API`, "prerequisite");
    results[name] = result.body;
  }
  return results;
}

function assertSnapshotIsolation(tenant, snapshot, allTenants) {
  const serialized = JSON.stringify(snapshot);
  if (!serialized.includes(tenant.repo)) throw new ProofFailure(`${tenant.label} API snapshot omitted its repo ${tenant.repo}`);
  const mediaPath = snapshot?.settings?.settings?.artifact_archive_local_dir;
  if (typeof mediaPath !== "string" || !mediaPath.endsWith(`/${tenant.tenantId}/media`)) {
    throw new ProofFailure(`${tenant.label} media setting is not rooted at /data/<tenant>/media`, {
      detail: { mediaPath },
    });
  }
  for (const foreign of allTenants.filter((item) => item !== tenant)) {
    if (serialized.includes(foreign.repo) || serialized.includes(foreign.marker)) {
      throw new ProofFailure(`${tenant.label} API snapshot exposed ${foreign.label} data`);
    }
  }
}

async function verifyApiAndSessions(baseUrl, tenants) {
  const snapshots = new Map();
  const violations = [];
  const checks = [];
  const capture = async (name, action) => {
    try {
      const result = await action();
      checks.push({ name, status: "pass" });
      return result;
    } catch (error) {
      violations.push(error?.message ?? String(error));
      checks.push({ name, status: "fail", error: error?.message ?? String(error) });
      return null;
    }
  };
  for (const tenant of tenants) {
    const bearerSnapshot = await capture(`${tenant.label} bearer API snapshot`, () => tenantApiSnapshot(baseUrl, tenant, { token: tenant.token }));
    if (bearerSnapshot) {
      await capture(`${tenant.label} bearer settings separation`, async () => assertSnapshotIsolation(tenant, bearerSnapshot, tenants));
      snapshots.set(tenant.tenantId, bearerSnapshot);
    }

    const login = await capture(`${tenant.label} tenant-login`, async () => {
      const result = await jsonRequest(baseUrl, "/api/auth/login", {
        method: "POST",
        body: { token: tenant.token },
      });
      expectStatus(result, [200], `${tenant.label} tenant login`, "prerequisite");
      if (result.body?.tenant?.id !== tenant.tenantId) {
        throw new ProofFailure(`${tenant.label} tenant login bound ${String(result.body?.tenant?.id)} instead of ${tenant.tenantId}`);
      }
      return result;
    });
    if (!login) continue;
    const setCookie = login.response.headers.get("set-cookie") ?? "";
    tenant.sessionCookie = setCookie.split(";", 1)[0];
    if (!tenant.sessionCookie.includes("=")) {
      violations.push(`${tenant.label} login returned no session cookie`);
      continue;
    }

    const cookieSnapshot = await capture(`${tenant.label} cookie-only API snapshot`, () => tenantApiSnapshot(baseUrl, tenant, { cookie: tenant.sessionCookie }));
    if (cookieSnapshot) {
      await capture(`${tenant.label} cookie remains tenant-bound`, async () => assertSnapshotIsolation(tenant, cookieSnapshot, tenants));
    }

    const foreign = tenants.find((item) => item !== tenant);
    await capture(`${tenant.label} direct cross-tenant URL negative`, async () => {
      const direct = await jsonRequest(baseUrl, `/api/tenants/${encodeURIComponent(foreign.tenantId)}/vault`, {
        cookie: tenant.sessionCookie,
      });
      expectStatus(direct, [401, 403, 404], `${tenant.label} direct URL negative`);
    });

    await capture(`${tenant.label} tampered tenant cookie negative`, async () => {
      const [cookieName, cookieValue] = tenant.sessionCookie.split("=", 2);
      const parts = cookieValue.split(".");
      if (parts.length !== 2) throw new ProofFailure(`${tenant.label} session cookie does not carry a signed tenant id`);
      let payload;
      try {
        payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
      } catch {
        throw new ProofFailure(`${tenant.label} session cookie payload is not valid base64url JSON`);
      }
      payload.tenant.id = foreign.tenantId;
      parts[0] = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      const tampered = await jsonRequest(baseUrl, "/api/settings", {
        cookie: `${cookieName}=${parts.join(".")}`,
      });
      expectStatus(tampered, [401], `${tenant.label} tampered tenant cookie negative`);
    });
  }

  if (violations.length > 0) {
    throw new ProofFailure(`tenant API/session contract has ${violations.length} violation${violations.length === 1 ? "" : "s"}`, {
      detail: { violations, checks },
    });
  }
  return { snapshots: Object.fromEntries(snapshots), checks };
}

async function pathExists(path) {
  return stat(path).then(() => true).catch(() => false);
}

async function walkFiles(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...(await walkFiles(path)));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

async function verifyStorage(dataRoot, tenants, mode) {
  const violations = [];
  for (const forbidden of FORBIDDEN_ROOT_STATE) {
    if (await pathExists(join(dataRoot, forbidden))) {
      violations.push(`process-wide state remains at data root: ${forbidden}`);
    }
  }
  for (const tenant of tenants) {
    const root = resolve(dataRoot, tenant.tenantId);
    if (!root.startsWith(`${resolve(dataRoot)}/`)) violations.push(`unsafe tenant root for ${tenant.label}`);
    for (const required of REQUIRED_TENANT_PATHS) {
      if (!(await pathExists(join(root, required)))) {
        violations.push(`${tenant.label} missing tenant-scoped path ${required}`);
      }
    }
    if (!(await pathExists(join(root, "media")))) {
      violations.push(`${tenant.label} media directory is not materialized below its tenant root`);
    }
    if (mode === "full" && !(await pathExists(join(root, "vault")))) {
      violations.push(`${tenant.label} missing vault after full proof`);
    }
  }

  const files = await walkFiles(dataRoot);
  const sqliteFiles = files.filter((path) => path.endsWith(".sqlite"));
  const sqlitePerTenant = REQUIRED_TENANT_PATHS.filter((path) => path.endsWith(".sqlite")).length;
  const expectedSqliteFiles = TENANT_COUNT * sqlitePerTenant + CHASSIS_SQLITE_PATHS.length;
  if (sqliteFiles.length !== expectedSqliteFiles) {
    violations.push(`expected ${expectedSqliteFiles} SQLite files (${sqlitePerTenant} per tenant plus ${CHASSIS_SQLITE_PATHS.length} chassis stores), found ${sqliteFiles.length}`);
  }
  for (const path of sqliteFiles) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const journal = db.prepare("PRAGMA journal_mode").get();
      const journalMode = String(journal?.journal_mode ?? "").toLowerCase();
      if (journalMode !== "wal") {
        violations.push(`${path.slice(resolve(dataRoot).length + 1)} journal_mode is ${journalMode || "unknown"}, expected wal`);
      }
    } finally {
      db.close();
    }
  }
  for (const tenant of tenants) {
    for (const issuedToken of tenant.issuedTokens) {
      const secret = Buffer.from(issuedToken);
      for (const path of files) {
        const bytes = await readFile(path);
        if (bytes.indexOf(secret) !== -1) {
          violations.push(`raw ${tenant.label} token persisted at ${path.slice(resolve(dataRoot).length + 1)}`);
        }
      }
    }
  }
  if (violations.length > 0) {
    throw new ProofFailure(`storage contract has ${violations.length} violation${violations.length === 1 ? "" : "s"}`, {
      detail: {
        violations,
        sqliteFiles: sqliteFiles.map((path) => path.slice(resolve(dataRoot).length + 1)),
      },
    });
  }
  return { sqliteFiles: sqliteFiles.map((path) => path.slice(resolve(dataRoot).length + 1)) };
}

async function verifyParitySurface(name, baseUrl, token) {
  if (!baseUrl || !token) {
    throw new ProofFailure(`${name} requires both URL and token`, { kind: "prerequisite" });
  }
  const initialized = await mcpInitialize(baseUrl, token);
  if (!initialized?.serverInfo) throw new ProofFailure(`${name} MCP initialize omitted serverInfo`);
  const settings = await jsonRequest(baseUrl, "/api/settings", { token });
  expectStatus(settings, [200], `${name} settings`, "prerequisite");
}

function helpText() {
  return `Epic 3.2 joint proof harness\n\n` +
    `Required: --base-url URL --control-token TOKEN\n` +
    `Optional: --mode contract|full --data-root PATH --evidence-dir PATH\n` +
    `          --self-host-url URL --self-host-token TOKEN\n` +
    `          --migrated-url URL --migrated-token TOKEN --run-id ID\n\n` +
    `Full mode also requires EPIC32_T1_REPO..EPIC32_T3_REPO, ` +
    `EPIC32_GITHUB_TOKEN (or per-tenant variants), and EPIC32_LLM_API_KEY.\n`;
}

export async function runProof(options, env = process.env) {
  if (!options.controlToken) throw new ProofFailure("CONTROL_PLANE_TOKEN or --control-token is required", { kind: "usage" });
  const runId = (options.runId || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)).toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/.test(runId)) throw new ProofFailure("run id must be 3-32 lowercase letters, numbers, _ or -", { kind: "usage" });
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const evidenceDir = resolve(options.evidenceDir || join(tmpdir(), "zenod-epic32-proof", runId));
  const tenants = Array.from({ length: TENANT_COUNT }, (_, index) => tenantFixture(index, runId, env));
  const metadata = {
    epic: "3.2",
    issue: 736,
    assignment: "epic32-joint-proof-tester",
    runId,
    mode: options.mode,
    baseUrl,
    commit: env.EPIC32_COMMIT ?? "unknown",
    startedAt: new Date().toISOString(),
    tenantIds: tenants.map((tenant) => tenant.tenantId),
    tokenHashes: tenants.map((tenant) => ({ label: tenant.label, sha256: sha256(tenant.token) })),
  };
  const recorder = createRecorder(metadata);
  let terminalStatus = "pass";

  const runStep = async (name, action, { optional = false } = {}) => {
    try {
      const detail = await action();
      recorder.pass(name, detail);
      return true;
    } catch (error) {
      if (optional && error instanceof ProofFailure && error.kind === "prerequisite") {
        recorder.skip(name, error.message);
        return true;
      }
      recorder.fail(name, error);
      if (error instanceof ProofFailure && error.kind === "prerequisite") {
        if (terminalStatus === "pass") terminalStatus = "prerequisite-missing";
      } else {
        terminalStatus = "fail";
      }
      return false;
    }
  };

  const healthReady = await runStep("health", async () => {
    const health = await jsonRequest(baseUrl, "/healthz");
    expectStatus(health, [200], "health", "prerequisite");
    return { status: health.response.status, body: health.body };
  });
  let tenantsReady = false;
  if (healthReady) {
    await runStep("anonymous root, built asset, and protected API boundary", () => verifyAnonymousWeb(baseUrl));
    tenantsReady = await runStep("three-tenant provisioning and registry redaction", async () => {
      const registry = await provisionTenants(baseUrl, options.controlToken, tenants);
      metadata.tokenHashes = tenants.map((tenant) => ({ label: tenant.label, sha256: sha256(tenant.token) }));
      return { tenants: tenants.map((tenant) => tenant.tenantId), registry };
    });
  }
  if (tenantsReady) {
    await runStep("tokened MCP isolation and marker negatives", () => verifyMcpIsolation(baseUrl, tenants, options.mode));
    await runStep("control token cannot access tenant product APIs", async () => {
      const result = await jsonRequest(baseUrl, "/api/settings", { token: options.controlToken });
      expectStatus(result, [401], "control token settings negative");
      return { status: result.response.status };
    });
    await runStep("T1/T2/T3 bearer settings and signed tenant-session isolation", () => verifyApiAndSessions(baseUrl, tenants));
    await runStep("T2 token rotation, retired-token rejection, and new session", async () => {
      const detail = await rotateTenantToken(baseUrl, options.controlToken, tenants[1]);
      metadata.tokenHashes = tenants.map((tenant) => ({ label: tenant.label, sha256: sha256(tenant.token) }));
      return detail;
    });
    if (options.dataRoot) {
      await runStep("joint chassis storage layout, persisted WAL, and token-at-rest", () => verifyStorage(resolve(options.dataRoot), tenants, options.mode));
    } else {
      recorder.skip("joint chassis storage layout, persisted WAL, and token-at-rest", "EPIC32_DATA_ROOT not provided");
    }
    await runStep("single-tenant self-host parity", () => verifyParitySurface("single-tenant self-host", options.selfHostUrl, options.selfHostToken), { optional: true });
    await runStep("same-token migration rehearsal", () => verifyParitySurface("migrated tenant", options.migratedUrl, options.migratedToken), { optional: true });
  }

  await mkdir(evidenceDir, { recursive: true });
  const summary = recorder.summary(terminalStatus);
  summary.finishedAt = new Date().toISOString();
  const summaryPath = join(evidenceDir, "summary.json");
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`Evidence: ${summaryPath}\n`);
  return { status: terminalStatus, summaryPath, summary };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n${helpText()}`);
    process.exitCode = 64;
    return;
  }
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  try {
    const result = await runProof(options);
    process.exitCode = result.status === "pass" ? 0 : result.status === "prerequisite-missing" ? 2 : 1;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = error instanceof ProofFailure && error.kind === "usage" ? 64 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
