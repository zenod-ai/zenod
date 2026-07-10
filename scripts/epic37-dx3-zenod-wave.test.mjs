import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertNoSecretMaterial, authorizeWave, sha256 } from "./epic37-dx3-zenod-wave.mjs";

const ROOT = new URL("..", import.meta.url);
const MANIFEST_PATH = new URL("../docs/EPIC-3.7-DX3-ZENOD-CANDIDATES.json", import.meta.url);
const manifestRaw = readFileSync(MANIFEST_PATH, "utf8");
const manifestDigest = sha256(manifestRaw);

function gate() {
  return {
    schema_version: "epic37-dx3-wave-gate.v1",
    environment: "alpha9-production",
    candidate_manifest_sha256: manifestDigest,
    archive_target: "/srv/zenod-archives/epic37/dx3/z-mt-6-20260710-0500z",
    receipts: {
      current_state: {
        status: "pass",
        observed_at: "2026-07-10T05:30:00Z",
        valid_until: "2026-07-10T07:30:00Z",
        candidate_manifest_sha256: manifestDigest,
        candidate_ids: ["jordi-f2c7a6"],
        compose_ids: ["xDxfVYs0_4M09naWuCl66"],
        domain_ids: ["qJCkerpwpOQPqhYP_lN45"],
        container_names: ["zenod-jordi-f2c7a6"],
        volume_names: ["compose-quantify-multi-byte-firewall-r3b7ka_zenod-standalone-data"],
        watchdog_tokens: ["zenod-jordi-f2c7a6", "https://z-jordi-f2c7a6.zenod.dev/api/health"],
        evidence_ref: "evidence://dx3/preflight/current-state.json",
      },
      z_mt_6_gate_2: {
        status: "accepted",
        issue_url: "https://github.com/zenod-ai/zenod/issues/738",
        approval_ref: "https://github.com/zenod-ai/zenod/issues/738#issuecomment-9001",
        approved_by: "Jordi",
        approved_at: "2026-07-10T04:30:00Z",
        valid_until: "2026-07-10T08:00:00Z",
        candidate_manifest_sha256: manifestDigest,
        tenant_receipts: [{ tenant_id: "jordi-f2c7a6", verification_receipt_id: "V-jordi-f2c7a6-1" }],
        retire: {
          compose_ids: ["xDxfVYs0_4M09naWuCl66"],
          domain_ids: ["qJCkerpwpOQPqhYP_lN45"],
          volume_names: ["compose-quantify-multi-byte-firewall-r3b7ka_zenod-standalone-data"],
          volume_policy: "snapshot-verify-then-remove",
          watchdog_tokens: ["zenod-jordi-f2c7a6", "https://z-jordi-f2c7a6.zenod.dev/api/health"],
          legacy_hostnames: ["z-jordi-f2c7a6.zenod.dev"],
        },
      },
      tenant_acceptance: [{
        tenant_id: "jordi-f2c7a6",
        status: "accepted",
        verification_receipt_id: "V-jordi-f2c7a6-1",
        observed_at: "2026-07-10T04:00:00Z",
        valid_until: "2026-07-10T08:00:00Z",
        source_compose_id: "xDxfVYs0_4M09naWuCl66",
        shared_host_token_continuity: {
          status: "pass",
          hostname: "zenod.zenod.dev",
          route: "/mcp/<token>",
          token_sha256: "a".repeat(64),
          proof_ref: "evidence://z-mt-6/V-jordi-f2c7a6-1/continuity.json",
        },
        migration_data_proof: {
          status: "pass",
          migration_receipt_ref: "evidence://z-mt-6/V-jordi-f2c7a6-1/migration.json",
          verification_receipt_ref: "evidence://z-mt-6/V-jordi-f2c7a6-1/verification.json",
          normalized_data_sha256: "b".repeat(64),
          source_baseline_commit_sha: "c".repeat(40),
          target_baseline_commit_sha: "c".repeat(40),
          surfaces: {
            mcp: "pass",
            console: "pass",
            repo: "pass",
            ingest: "pass",
            usage: "pass",
            receipt: "pass",
            storage: "pass",
          },
        },
        rollback_checkpoint: {
          status: "ready",
          checkpoint_id: "zmt6-jordi-f2c7a6-r2",
          snapshot_ref: "archive://z-mt-6/jordi-f2c7a6-r2.tgz",
          checksum_sha256: "d".repeat(64),
          restore_proof_ref: "evidence://z-mt-6/jordi-f2c7a6-r2/restore.json",
          verified_at: "2026-07-10T04:15:00Z",
          valid_until: "2026-07-10T08:00:00Z",
          retained_until: "2026-07-20T00:00:00Z",
        },
      }],
      jordi_wave_approval: {
        status: "approved",
        issue_url: "https://github.com/zenod-ai/zenod/issues/728",
        approval_ref: "https://github.com/zenod-ai/zenod/issues/728#issuecomment-9002",
        approved_by: "Jordi",
        approved_at: "2026-07-10T04:45:00Z",
        window_start: "2026-07-10T05:00:00Z",
        window_end: "2026-07-10T07:00:00Z",
        candidate_manifest_sha256: manifestDigest,
        candidate_ids: ["jordi-f2c7a6"],
        archive_target: "/srv/zenod-archives/epic37/dx3/z-mt-6-20260710-0500z",
        rollback_checkpoint_ids: ["zmt6-jordi-f2c7a6-r2"],
      },
    },
  };
}

const NOW = new Date("2026-07-10T06:00:00Z");

test("authorizes only a complete exact receipt set and emits a snapshot-first dry-run plan", () => {
  const plan = authorizeWave({ manifestRaw, gate: gate(), now: NOW });
  assert.equal(plan.mode, "dry-run-only");
  assert.equal(plan.candidate_manifest_sha256, manifestDigest);
  assert.match(plan.candidates[0].phases[1], /snapshot every approved volume/);
  assert.match(plan.candidates[0].phases[2], /verify snapshot checksums/);
  assert.match(plan.plan_sha256, /^[a-f0-9]{64}$/);
});

test("missing receipts fail closed before a plan is produced", async (t) => {
  for (const key of ["current_state", "z_mt_6_gate_2", "tenant_acceptance", "jordi_wave_approval"]) {
    await t.test(key, () => {
      const input = gate();
      delete input.receipts[key];
      assert.throws(() => authorizeWave({ manifestRaw, gate: input, now: NOW }), /must be an object|non-empty array/);
    });
  }
});

test("stale current-state, Gate 2, tenant, and rollback receipts fail closed", async (t) => {
  const cases = [
    ["current state", (input) => { input.receipts.current_state.valid_until = "2026-07-10T05:59:59Z"; }],
    ["Gate 2", (input) => { input.receipts.z_mt_6_gate_2.valid_until = "2026-07-10T05:59:59Z"; }],
    ["tenant", (input) => { input.receipts.tenant_acceptance[0].valid_until = "2026-07-10T05:59:59Z"; }],
    ["rollback", (input) => { input.receipts.tenant_acceptance[0].rollback_checkpoint.valid_until = "2026-07-10T05:59:59Z"; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const input = gate();
      mutate(input);
      assert.throws(() => authorizeWave({ manifestRaw, gate: input, now: NOW }), /is stale/);
    });
  }
});

test("manifest digest mismatches at every approval boundary fail closed", async (t) => {
  const cases = [
    ["root", (input) => { input.candidate_manifest_sha256 = "f".repeat(64); }],
    ["current", (input) => { input.receipts.current_state.candidate_manifest_sha256 = "f".repeat(64); }],
    ["Gate 2", (input) => { input.receipts.z_mt_6_gate_2.candidate_manifest_sha256 = "f".repeat(64); }],
    ["wave", (input) => { input.receipts.jordi_wave_approval.candidate_manifest_sha256 = "f".repeat(64); }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const input = gate();
      mutate(input);
      assert.throws(() => authorizeWave({ manifestRaw, gate: input, now: NOW }), /digest.*mismatch|does not match the exact manifest bytes/);
    });
  }
});

test("candidate identity and Gate 2 retirement-set mismatches fail closed", async (t) => {
  const cases = [
    ["current compose", (input) => { input.receipts.current_state.compose_ids = ["wrong-compose"]; }],
    ["tenant compose", (input) => { input.receipts.tenant_acceptance[0].source_compose_id = "wrong-compose"; }],
    ["Gate 2 domain", (input) => { input.receipts.z_mt_6_gate_2.retire.domain_ids = ["wrong-domain"]; }],
    ["Gate 2 receipt", (input) => { input.receipts.z_mt_6_gate_2.tenant_receipts[0].verification_receipt_id = "wrong-receipt"; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const input = gate();
      mutate(input);
      assert.throws(() => authorizeWave({ manifestRaw, gate: input, now: NOW }), /does not match|mismatch/);
    });
  }
});

test("continuity, migration/data, and rollback proof failures fail closed", async (t) => {
  const cases = [
    ["continuity", (input) => { input.receipts.tenant_acceptance[0].shared_host_token_continuity.status = "fail"; }],
    ["migration", (input) => { input.receipts.tenant_acceptance[0].migration_data_proof.status = "blocked"; }],
    ["surface", (input) => { input.receipts.tenant_acceptance[0].migration_data_proof.surfaces.storage = "fail"; }],
    ["baseline", (input) => { input.receipts.tenant_acceptance[0].migration_data_proof.target_baseline_commit_sha = "e".repeat(40); }],
    ["rollback", (input) => { input.receipts.tenant_acceptance[0].rollback_checkpoint.status = "missing"; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const input = gate();
      mutate(input);
      assert.throws(() => authorizeWave({ manifestRaw, gate: input, now: NOW }), /missing|failed|did not pass|mismatched|not ready/);
    });
  }
});

test("archive, window, rollback, and approval mismatches fail closed", async (t) => {
  const cases = [
    ["archive approval", (input) => { input.receipts.jordi_wave_approval.archive_target += "-other"; }],
    ["window", (input) => { input.receipts.jordi_wave_approval.window_end = "2026-07-10T05:00:00Z"; }],
    ["rollback approval", (input) => { input.receipts.jordi_wave_approval.rollback_checkpoint_ids = ["wrong-checkpoint"]; }],
    ["rollback retention", (input) => { input.receipts.tenant_acceptance[0].rollback_checkpoint.retained_until = "2026-07-10T06:30:00Z"; }],
    ["wrong approver", (input) => { input.receipts.jordi_wave_approval.approved_by = "operator"; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const input = gate();
      mutate(input);
      assert.throws(() => authorizeWave({ manifestRaw, gate: input, now: NOW }), /mismatch|does not match|outside|retention|Jordi/);
    });
  }
});

test("raw token material is rejected", () => {
  const input = gate();
  input.receipts.current_state.notes = "https://zenod.zenod.dev/mcp/zenod_example_raw_token_value";
  assert.throws(() => assertNoSecretMaterial(input), /raw token material/);
  assert.throws(() => authorizeWave({ manifestRaw, gate: input, now: NOW }), /raw token material/);
});

test("CLI valid and invalid runs create no mutation artifacts", () => {
  const dir = mkdtempSync(join(tmpdir(), "epic37-dx3-"));
  try {
    const manifestPath = join(dir, "manifest.json");
    const gatePath = join(dir, "gate.json");
    writeFileSync(manifestPath, manifestRaw);
    writeFileSync(gatePath, `${JSON.stringify(gate(), null, 2)}\n`);
    const before = readdirSync(dir).sort();
    const valid = spawnSync(process.execPath, [
      "scripts/epic37-dx3-zenod-wave.mjs",
      "--manifest", manifestPath,
      "--gate", gatePath,
      "--now", NOW.toISOString(),
      "--format", "text",
    ], { cwd: ROOT, encoding: "utf8" });
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /DX-3 RECEIPTS VALID; DRY RUN ONLY/);
    assert.deepEqual(readdirSync(dir).sort(), before);

    const invalidGate = gate();
    delete invalidGate.receipts.z_mt_6_gate_2;
    writeFileSync(gatePath, `${JSON.stringify(invalidGate, null, 2)}\n`);
    const invalidBefore = readdirSync(dir).sort();
    const invalid = spawnSync(process.execPath, [
      "scripts/epic37-dx3-zenod-wave.mjs",
      "--manifest", manifestPath,
      "--gate", gatePath,
      "--now", NOW.toISOString(),
    ], { cwd: ROOT, encoding: "utf8" });
    assert.equal(invalid.status, 2);
    assert.equal(invalid.stdout, "");
    assert.match(invalid.stderr, /z_mt_6_gate_2 must be an object/);
    assert.deepEqual(readdirSync(dir).sort(), invalidBefore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
