#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = "z-mt-6.v1";
const CLASSIFICATIONS = new Set(["live-paying", "test", "internal", "unknown"]);
const COHORTS = new Set(["canary", "wave-1", "wave-2", "final"]);
const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const TENANT_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UTC_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const IMMUTABLE_IMAGE_RE = /(?::sha-[a-f0-9]{7,40}|@sha256:[a-f0-9]{64})$/;
const FORBIDDEN_KEYS = /^(token|api_token|mcp_token|authorization|secret|password)$/i;
const SECRET_VALUE = /(?:zenod_[a-z0-9_-]{16,}|\/mcp\/(?!<token>)[^/?#\s]{16,})/i;

const REQUIRED_PATHS = [
  "source.compose_id",
  "source.service_name",
  "source.hostname",
  "source.volume_name",
  "source.volume_mount",
  "source.image_ref",
  "source.runtime_sha",
  "source.health_url",
  "target.hostname",
  "target.tenant_root",
  "target.mcp_route",
  "continuity.token_sha256",
  "continuity.vault_repo",
  "continuity.baseline_commit_sha",
  "rollback.checkpoint_id",
  "rollback.snapshot_ref",
  "rollback.checksum_manifest",
  "rollback.restore_command_ref",
  "evidence.dokploy_inventory_ref",
  "evidence.docker_inventory_ref",
  "evidence.watchdog_ref",
];

function usage() {
  return `Usage:
  node scripts/zenod-cutover-inventory.mjs --input <path|-> [--format json|markdown] [--require-ready]
  node scripts/zenod-cutover-inventory.mjs --hash-token

The inventory command reads only and writes the sanitized result to stdout. --hash-token reads one
raw token from stdin and prints only its SHA-256 digest; do not pass credentials as command arguments.`;
}

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueAt(object, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => value?.[key], object);
}

function present(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

export function sha256Token(token) {
  const value = String(token ?? "").trim();
  if (!value) fail("Refusing to hash an empty token");
  return createHash("sha256").update(value).digest("hex");
}

export function assertNoSecretMaterial(value, path = "inventory") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.test(key)) fail(`${path}.${key}: plaintext credential fields are forbidden`);
      assertNoSecretMaterial(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && SECRET_VALUE.test(value)) {
    fail(`${path}: value appears to contain a raw token or token-bearing MCP URL`);
  }
}

function assertIsoTimestamp(value) {
  if (!present(value) || !UTC_TIMESTAMP_RE.test(value) || Number.isNaN(Date.parse(value))) {
    fail("generated_at must be an ISO-8601 UTC timestamp ending in Z");
  }
}

function assertUrl(value, path) {
  if (!present(value)) return;
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${path} must be an absolute URL`);
  }
  if (url.protocol !== "https:") fail(`${path} must use https`);
}

function assertUnique(rows, selector, label) {
  const seen = new Set();
  for (const row of rows) {
    const value = selector(row);
    if (!present(value)) continue;
    if (seen.has(value)) fail(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function readinessFor(tenant) {
  const missing = REQUIRED_PATHS.filter((path) => !present(valueAt(tenant, path)));
  if (tenant.classification === "unknown") missing.unshift("classification (must not be unknown at Gate 1)");
  return { ready: missing.length === 0, missing };
}

function validateTenant(tenant, index) {
  const at = `tenants[${index}]`;
  if (!isObject(tenant)) fail(`${at} must be an object`);
  if (!TENANT_RE.test(String(tenant.tenant_id ?? ""))) {
    fail(`${at}.tenant_id must match ${TENANT_RE}`);
  }
  if (!CLASSIFICATIONS.has(tenant.classification)) {
    fail(`${at}.classification must be one of ${[...CLASSIFICATIONS].join(", ")}`);
  }
  if (!Number.isInteger(tenant.cutover_order) || tenant.cutover_order < 1) {
    fail(`${at}.cutover_order must be a positive integer`);
  }
  if (!COHORTS.has(tenant.cohort)) fail(`${at}.cohort must be one of ${[...COHORTS].join(", ")}`);

  const tokenHash = tenant.continuity?.token_sha256;
  if (present(tokenHash) && !SHA256_RE.test(tokenHash)) fail(`${at}.continuity.token_sha256 must be a lowercase SHA-256 hex digest`);
  const baselineSha = tenant.continuity?.baseline_commit_sha;
  if (present(baselineSha) && !COMMIT_RE.test(baselineSha)) fail(`${at}.continuity.baseline_commit_sha must be a 40-character commit SHA`);
  const runtimeSha = tenant.source?.runtime_sha;
  if (present(runtimeSha) && !COMMIT_RE.test(runtimeSha)) fail(`${at}.source.runtime_sha must be a 40-character commit SHA`);
  const imageRef = tenant.source?.image_ref;
  if (present(imageRef) && !IMMUTABLE_IMAGE_RE.test(imageRef)) {
    fail(`${at}.source.image_ref must use an immutable sha-* tag or sha256 digest`);
  }

  const expectedRoot = `/data/${tenant.tenant_id}`;
  if (present(tenant.target?.tenant_root) && tenant.target.tenant_root !== expectedRoot) {
    fail(`${at}.target.tenant_root must be ${expectedRoot}`);
  }
  if (present(tenant.target?.hostname) && tenant.target.hostname !== "zenod.zenod.dev") {
    fail(`${at}.target.hostname must be zenod.zenod.dev`);
  }
  if (present(tenant.target?.mcp_route) && tenant.target.mcp_route !== "/mcp/<token>") {
    fail(`${at}.target.mcp_route must be the redacted route /mcp/<token>`);
  }
  if (present(tenant.source?.volume_mount) && tenant.source.volume_mount !== "/data") {
    fail(`${at}.source.volume_mount must be /data`);
  }
  assertUrl(tenant.source?.health_url, `${at}.source.health_url`);
  return { ...tenant, readiness: readinessFor(tenant) };
}

export function normalizeInventory(input, { requireReady = false } = {}) {
  assertNoSecretMaterial(input);
  if (!isObject(input)) fail("Inventory root must be an object");
  if (input.schema_version !== SCHEMA_VERSION) fail(`schema_version must be ${SCHEMA_VERSION}`);
  if (!present(input.environment)) fail("environment is required");
  assertIsoTimestamp(input.generated_at);
  if (!Array.isArray(input.tenants) || input.tenants.length === 0) fail("tenants must be a non-empty array");

  const tenants = input.tenants.map(validateTenant).sort((a, b) => a.cutover_order - b.cutover_order);
  assertUnique(tenants, (row) => row.tenant_id, "tenant_id");
  assertUnique(tenants, (row) => row.cutover_order, "cutover_order");
  assertUnique(tenants, (row) => row.continuity?.token_sha256, "token_sha256");
  assertUnique(tenants, (row) => row.source?.compose_id, "source compose_id");
  assertUnique(tenants, (row) => row.source?.volume_name, "source volume_name");

  const ready = tenants.every((tenant) => tenant.readiness.ready);
  if (requireReady && !ready) {
    const details = tenants
      .filter((tenant) => !tenant.readiness.ready)
      .map((tenant) => `${tenant.tenant_id}: ${tenant.readiness.missing.join(", ")}`)
      .join("; ");
    fail(`Inventory is not ready for the live-migration gate: ${details}`);
  }

  return {
    schema_version: SCHEMA_VERSION,
    environment: input.environment,
    generated_at: input.generated_at,
    ready_for_live_migration_gate: ready,
    tenants,
  };
}

function md(value) {
  return String(value ?? "MISSING").replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderMarkdown(inventory) {
  const lines = [
    `# Zenod Cutover Inventory (${inventory.environment})`,
    "",
    `Generated: ${inventory.generated_at}`,
    `Ready for live-migration gate: ${inventory.ready_for_live_migration_gate ? "YES" : "NO"}`,
    "",
    "| Order | Tenant | Class | Cohort | Token SHA-256 | Source compose | Source volume | Target root | Rollback checkpoint | Ready |",
    "|---:|---|---|---|---|---|---|---|---|---|",
  ];
  for (const tenant of inventory.tenants) {
    lines.push(
      `| ${tenant.cutover_order} | ${md(tenant.tenant_id)} | ${md(tenant.classification)} | ${md(tenant.cohort)} | ${md(tenant.continuity?.token_sha256)} | ${md(tenant.source?.compose_id)} | ${md(tenant.source?.volume_name)} | ${md(tenant.target?.tenant_root)} | ${md(tenant.rollback?.checkpoint_id)} | ${tenant.readiness.ready ? "YES" : "NO"} |`,
    );
    if (!tenant.readiness.ready) lines.push(`|  | ${md(tenant.tenant_id)} missing | ${tenant.readiness.missing.map(md).join(", ")} |  |  |  |  |  |  |  |`);
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = { format: "json", requireReady: false, hashToken: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--require-ready") options.requireReady = true;
    else if (arg === "--hash-token") options.hashToken = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--input" || arg === "--format") {
      const value = argv[i + 1];
      if (!value) fail(`${arg} requires a value`);
      options[arg.slice(2)] = value;
      i += 1;
    } else fail(`Unknown argument: ${arg}`);
  }
  return options;
}

function readStdin() {
  return readFileSync(0, "utf8");
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (options.hashToken) {
    if (options.input || options.requireReady || options.format !== "json") fail("--hash-token cannot be combined with inventory options");
    process.stdout.write(`${sha256Token(readStdin())}\n`);
    return 0;
  }
  if (!options.input) fail("--input is required");
  if (!new Set(["json", "markdown"]).has(options.format)) fail("--format must be json or markdown");
  const raw = options.input === "-" ? readStdin() : readFileSync(options.input, "utf8");
  const inventory = normalizeInventory(JSON.parse(raw), { requireReady: options.requireReady });
  process.stdout.write(options.format === "markdown" ? renderMarkdown(inventory) : `${JSON.stringify(inventory, null, 2)}\n`);
  return 0;
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`zenod-cutover-inventory: ${error.message}\n`);
    process.exitCode = 2;
  }
}
