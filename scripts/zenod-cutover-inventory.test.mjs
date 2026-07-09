import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { normalizeInventory, renderMarkdown, sha256Token } from "./zenod-cutover-inventory.mjs";

function tenant(overrides = {}) {
  return {
    tenant_id: "tenant-a",
    classification: "test",
    cutover_order: 1,
    cohort: "canary",
    source: {
      compose_id: "compose-a",
      service_name: "zenod-tenant-a",
      hostname: "z-tenant-a.zenod.dev",
      volume_name: "tenant-a-data",
      volume_mount: "/data",
      image_ref: "ghcr.io/zenod-ai/zenod:sha-1234567",
      runtime_sha: "1234567890abcdef1234567890abcdef12345678",
      health_url: "https://z-tenant-a.zenod.dev/api/health",
    },
    target: {
      hostname: "zenod.zenod.dev",
      tenant_root: "/data/tenant-a",
      mcp_route: "/mcp/<token>",
    },
    continuity: {
      token_sha256: "a".repeat(64),
      vault_repo: "example/tenant-a-vault",
      baseline_commit_sha: "b".repeat(40),
    },
    rollback: {
      checkpoint_id: "tenant-a-r1",
      snapshot_ref: "snapshot://tenant-a-r1",
      checksum_manifest: "evidence/tenant-a/source.sha256",
      restore_command_ref: "#rollback-r4",
    },
    evidence: {
      dokploy_inventory_ref: "evidence/dokploy.json#compose-a",
      docker_inventory_ref: "evidence/docker.json#zenod-tenant-a",
      watchdog_ref: "evidence/watchdog.txt#tenant-a",
    },
    ...overrides,
  };
}

function inventory(tenants = [tenant()]) {
  return {
    schema_version: "z-mt-6.v1",
    environment: "local-fixture",
    generated_at: "2026-07-10T00:00:00Z",
    tenants,
  };
}

test("normalizes a gate-ready inventory and renders the continuity evidence", () => {
  const result = normalizeInventory(inventory(), { requireReady: true });
  assert.equal(result.ready_for_live_migration_gate, true);
  assert.equal(result.tenants[0].readiness.ready, true);
  const markdown = renderMarkdown(result);
  assert.match(markdown, /tenant-a-data/);
  assert.match(markdown, new RegExp("a{64}"));
  assert.match(markdown, /tenant-a-r1/);
});

test("sorts by cutover order and rejects duplicate order or token hashes", () => {
  const second = tenant({
    tenant_id: "tenant-b",
    cutover_order: 2,
    source: { ...tenant().source, compose_id: "compose-b", service_name: "zenod-tenant-b", volume_name: "tenant-b-data" },
    target: { ...tenant().target, tenant_root: "/data/tenant-b" },
    continuity: { ...tenant().continuity, token_sha256: "c".repeat(64) },
  });
  const result = normalizeInventory(inventory([second, tenant()]));
  assert.deepEqual(result.tenants.map((row) => row.tenant_id), ["tenant-a", "tenant-b"]);
  assert.throws(() => normalizeInventory(inventory([tenant(), { ...second, cutover_order: 1 }])), /Duplicate cutover_order/);
  assert.throws(() => normalizeInventory(inventory([tenant(), { ...second, continuity: tenant().continuity }])), /Duplicate token_sha256/);
});

test("rejects plaintext credentials and token-bearing MCP URLs", () => {
  const fakeToken = ["zenod", "fake", "token", "value", "123456"].join("_");
  assert.throws(() => normalizeInventory(inventory([{ ...tenant(), token: fakeToken }])), /plaintext credential fields/);
  assert.throws(
    () => normalizeInventory(inventory([{ ...tenant(), target: { ...tenant().target, mcp_route: `/mcp/${fakeToken}` } }])),
    /raw token or token-bearing MCP URL/,
  );
});

test("rejects mutable image tags and non-UTC inventory timestamps", () => {
  assert.throws(
    () => normalizeInventory(inventory([{ ...tenant(), source: { ...tenant().source, image_ref: "ghcr.io/zenod-ai/zenod:latest" } }])),
    /immutable sha-/,
  );
  assert.throws(
    () => normalizeInventory({ ...inventory(), generated_at: "2026-07-10 00:00:00" }),
    /ISO-8601 UTC timestamp/,
  );
});

test("reports missing gate evidence and --require-ready fails closed", () => {
  const incomplete = tenant({ rollback: { ...tenant().rollback, snapshot_ref: null } });
  const result = normalizeInventory(inventory([incomplete]));
  assert.equal(result.ready_for_live_migration_gate, false);
  assert.deepEqual(result.tenants[0].readiness.missing, ["rollback.snapshot_ref"]);
  assert.throws(() => normalizeInventory(inventory([incomplete]), { requireReady: true }), /not ready for the live-migration gate/);
});

test("an unknown tenant classification cannot pass the live-migration gate", () => {
  const result = normalizeInventory(inventory([tenant({ classification: "unknown" })]));
  assert.equal(result.ready_for_live_migration_gate, false);
  assert.match(result.tenants[0].readiness.missing[0], /classification/);
  assert.throws(
    () => normalizeInventory(inventory([tenant({ classification: "unknown" })]), { requireReady: true }),
    /must not be unknown at Gate 1/,
  );
});

test("hashes token input without echoing it", () => {
  assert.equal(sha256Token("zenod_example"), "84ba20e0956d60df401dd57d24e0c7303236e89fed046210f77a9a854b10536d");
  const result = spawnSync(process.execPath, ["scripts/zenod-cutover-inventory.mjs", "--hash-token"], {
    cwd: new URL("..", import.meta.url),
    input: "zenod_example\n",
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), sha256Token("zenod_example"));
  assert.doesNotMatch(result.stdout, /zenod_example/);
});

test("CLI reads the inventory without modifying it or creating output files", () => {
  const dir = mkdtempSync(join(tmpdir(), "z-mt-6-inventory-"));
  const path = join(dir, "inventory.json");
  const source = `${JSON.stringify(inventory(), null, 2)}\n`;
  writeFileSync(path, source);
  const result = spawnSync(
    process.execPath,
    ["scripts/zenod-cutover-inventory.mjs", "--input", path, "--format", "markdown", "--require-ready"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path, "utf8"), source);
  assert.match(result.stdout, /Ready for live-migration gate: YES/);
  assert.deepEqual(readdirSync(dir, { withFileTypes: true }).map((entry) => entry.name), ["inventory.json"]);
  rmSync(dir, { recursive: true, force: true });
});
