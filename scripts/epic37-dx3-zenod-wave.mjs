#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MANIFEST_SCHEMA = "epic37-dx3-candidates.v1";
const GATE_SCHEMA = "epic37-dx3-wave-gate.v1";
const ZMT6_ISSUE = "https://github.com/zenod-ai/zenod/issues/738";
const DX3_ISSUE = "https://github.com/zenod-ai/zenod/issues/728";
const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const PLACEHOLDER_RE = /<[^>]+>/;
const FORBIDDEN_KEYS = /^(token|raw_token|authorization|secret|password|api_key)$/i;
const RAW_TOKEN_RE = /(?:zenod_[a-z0-9_-]{12,}|\/mcp\/(?!<token>)[^/?#\s]{12,})/i;
const REQUIRED_SURFACES = ["mcp", "console", "repo", "ingest", "usage", "receipt", "storage"];

function fail(message) {
  throw new Error(message);
}

function present(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} must be an object`);
  return value;
}

function array(value, path) {
  if (!Array.isArray(value) || value.length === 0) fail(`${path} must be a non-empty array`);
  return value;
}

function exactSet(actual, expected, path) {
  const left = [...new Set(array(actual, path))].sort();
  const right = [...new Set(expected)].sort();
  if (left.length !== actual.length) fail(`${path} contains duplicates`);
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    fail(`${path} does not match the exact candidate manifest`);
  }
}

function requireValue(value, path) {
  if (!present(value)) fail(`${path} is required`);
  if (typeof value === "string" && PLACEHOLDER_RE.test(value)) fail(`${path} still contains a placeholder`);
  return value;
}

function timestamp(value, path) {
  requireValue(value, path);
  if (!UTC_RE.test(value) || Number.isNaN(Date.parse(value))) fail(`${path} must be an ISO-8601 UTC timestamp`);
  return Date.parse(value);
}

function receiptWindow(receipt, path, now) {
  const observed = timestamp(receipt.observed_at ?? receipt.approved_at ?? receipt.verified_at, `${path}.observed_at`);
  const validUntil = timestamp(receipt.valid_until, `${path}.valid_until`);
  if (observed > now) fail(`${path} is future-dated`);
  if (validUntil < now) fail(`${path} is stale`);
  if (validUntil < observed) fail(`${path}.valid_until precedes its observation`);
}

export function assertNoSecretMaterial(value, path = "gate") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.test(key)) fail(`${path}.${key}: plaintext credential fields are forbidden`);
      assertNoSecretMaterial(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && RAW_TOKEN_RE.test(value)) fail(`${path}: raw token material is forbidden`);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validateManifest(manifest) {
  object(manifest, "manifest");
  if (manifest.schema_version !== MANIFEST_SCHEMA) fail(`manifest.schema_version must be ${MANIFEST_SCHEMA}`);
  if (manifest.environment !== "alpha9-production") fail("manifest.environment must be alpha9-production");
  timestamp(manifest.observed_at, "manifest.observed_at");
  const candidates = array(manifest.candidates, "manifest.candidates");
  if (manifest.expected_candidate_count !== candidates.length) fail("manifest.expected_candidate_count does not match candidates");
  if (candidates.length !== 1) fail("DX-3 requires exactly one current live-paying Zenod candidate");
  const candidate = candidates[0];
  if (candidate.unit !== "zenod" || candidate.classification !== "live-paying") {
    fail("manifest candidate must be the live-paying Zenod row");
  }
  for (const [path, value] of [
    ["tenant_id", candidate.tenant_id],
    ["dokploy.compose_id", candidate.dokploy?.compose_id],
    ["dokploy.name", candidate.dokploy?.name],
    ["dokploy.app_name", candidate.dokploy?.app_name],
    ["runtime.runtime_commit_sha", candidate.runtime?.runtime_commit_sha],
    ["routes.legacy_hostname", candidate.routes?.legacy_hostname],
  ]) requireValue(value, `manifest.candidates[0].${path}`);
  if (!COMMIT_RE.test(candidate.runtime.runtime_commit_sha)) fail("manifest runtime commit must be a 40-character SHA");
  array(candidate.runtime?.container_names, "manifest.candidates[0].runtime.container_names");
  array(candidate.storage?.volume_names, "manifest.candidates[0].storage.volume_names");
  array(candidate.routes?.domain_ids, "manifest.candidates[0].routes.domain_ids");
  array(candidate.watchdog_tokens, "manifest.candidates[0].watchdog_tokens");
  if (candidate.routes.target_hostname !== "zenod.zenod.dev" || candidate.routes.target_mcp_route !== "/mcp/<token>") {
    fail("manifest target must be zenod.zenod.dev/mcp/<token>");
  }
  if (candidate.storage.volume_policy !== "snapshot-verify-then-remove") fail("manifest volume policy must be snapshot-verify-then-remove");
  return candidate;
}

function expectedResources(candidate) {
  return {
    candidateIds: [candidate.tenant_id],
    composeIds: [candidate.dokploy.compose_id],
    domainIds: candidate.routes.domain_ids,
    containerNames: candidate.runtime.container_names,
    volumeNames: candidate.storage.volume_names,
    watchdogTokens: candidate.watchdog_tokens,
    legacyHostnames: [candidate.routes.legacy_hostname],
  };
}

function validateCurrentState(receipt, expected, digest, now) {
  object(receipt, "receipts.current_state");
  if (receipt.status !== "pass") fail("receipts.current_state.status must be pass");
  receiptWindow(receipt, "receipts.current_state", now);
  if (receipt.candidate_manifest_sha256 !== digest) fail("current-state candidate digest mismatch");
  exactSet(receipt.candidate_ids, expected.candidateIds, "receipts.current_state.candidate_ids");
  exactSet(receipt.compose_ids, expected.composeIds, "receipts.current_state.compose_ids");
  exactSet(receipt.domain_ids, expected.domainIds, "receipts.current_state.domain_ids");
  exactSet(receipt.container_names, expected.containerNames, "receipts.current_state.container_names");
  exactSet(receipt.volume_names, expected.volumeNames, "receipts.current_state.volume_names");
  exactSet(receipt.watchdog_tokens, expected.watchdogTokens, "receipts.current_state.watchdog_tokens");
  requireValue(receipt.evidence_ref, "receipts.current_state.evidence_ref");
}

function validateGate2(receipt, expected, digest, tenantReceipt, now) {
  object(receipt, "receipts.z_mt_6_gate_2");
  if (receipt.status !== "accepted") fail("Z-MT-6 Gate 2 receipt is not accepted");
  if (receipt.issue_url !== ZMT6_ISSUE) fail("Z-MT-6 Gate 2 must be owned by issue #738");
  if (!String(receipt.approval_ref ?? "").startsWith(`${ZMT6_ISSUE}#issuecomment-`)) fail("Z-MT-6 Gate 2 approval_ref must be an issue #738 comment");
  if (receipt.approved_by !== "Jordi") fail("Z-MT-6 Gate 2 must be approved by Jordi");
  receiptWindow(receipt, "receipts.z_mt_6_gate_2", now);
  if (receipt.candidate_manifest_sha256 !== digest) fail("Z-MT-6 Gate 2 candidate digest mismatch");
  const tenantReceipts = array(receipt.tenant_receipts, "receipts.z_mt_6_gate_2.tenant_receipts");
  exactSet(tenantReceipts.map((entry) => entry.tenant_id), expected.candidateIds, "receipts.z_mt_6_gate_2.tenant_receipts tenant IDs");
  const gateTenant = tenantReceipts.find((entry) => entry.tenant_id === tenantReceipt.tenant_id);
  if (gateTenant?.verification_receipt_id !== tenantReceipt.verification_receipt_id) fail("Z-MT-6 Gate 2 verification receipt mismatch");
  const retire = object(receipt.retire, "receipts.z_mt_6_gate_2.retire");
  exactSet(retire.compose_ids, expected.composeIds, "receipts.z_mt_6_gate_2.retire.compose_ids");
  exactSet(retire.domain_ids, expected.domainIds, "receipts.z_mt_6_gate_2.retire.domain_ids");
  exactSet(retire.volume_names, expected.volumeNames, "receipts.z_mt_6_gate_2.retire.volume_names");
  exactSet(retire.watchdog_tokens, expected.watchdogTokens, "receipts.z_mt_6_gate_2.retire.watchdog_tokens");
  exactSet(retire.legacy_hostnames, expected.legacyHostnames, "receipts.z_mt_6_gate_2.retire.legacy_hostnames");
  if (retire.volume_policy !== "snapshot-verify-then-remove") fail("Gate 2 volume policy must require snapshot verification before removal");
}

function validateTenantAcceptance(receipt, candidate, now) {
  object(receipt, "receipts.tenant_acceptance[0]");
  if (receipt.tenant_id !== candidate.tenant_id || receipt.status !== "accepted") fail("accepted tenant receipt does not match the candidate");
  requireValue(receipt.verification_receipt_id, "receipts.tenant_acceptance[0].verification_receipt_id");
  if (receipt.source_compose_id !== candidate.dokploy.compose_id) fail("tenant receipt source compose mismatch");
  receiptWindow(receipt, "receipts.tenant_acceptance[0]", now);

  const continuity = object(receipt.shared_host_token_continuity, "tenant.shared_host_token_continuity");
  if (continuity.status !== "pass" || continuity.hostname !== "zenod.zenod.dev" || continuity.route !== "/mcp/<token>") {
    fail("shared-host token continuity proof is missing or failed");
  }
  if (!SHA256_RE.test(continuity.token_sha256 ?? "")) fail("shared-host continuity token_sha256 must be lowercase SHA-256");
  requireValue(continuity.proof_ref, "tenant.shared_host_token_continuity.proof_ref");

  const migration = object(receipt.migration_data_proof, "tenant.migration_data_proof");
  if (migration.status !== "pass") fail("migration/data proof is missing or failed");
  requireValue(migration.migration_receipt_ref, "tenant.migration_data_proof.migration_receipt_ref");
  requireValue(migration.verification_receipt_ref, "tenant.migration_data_proof.verification_receipt_ref");
  if (!SHA256_RE.test(migration.normalized_data_sha256 ?? "")) fail("migration normalized_data_sha256 is invalid");
  if (!COMMIT_RE.test(migration.source_baseline_commit_sha ?? "") || migration.source_baseline_commit_sha !== migration.target_baseline_commit_sha) {
    fail("migration source/target baseline commit proof is missing or mismatched");
  }
  const surfaces = object(migration.surfaces, "tenant.migration_data_proof.surfaces");
  for (const surface of REQUIRED_SURFACES) if (surfaces[surface] !== "pass") fail(`migration/data surface ${surface} did not pass`);

  const rollback = object(receipt.rollback_checkpoint, "tenant.rollback_checkpoint");
  if (rollback.status !== "ready") fail("rollback checkpoint is not ready");
  requireValue(rollback.checkpoint_id, "tenant.rollback_checkpoint.checkpoint_id");
  requireValue(rollback.snapshot_ref, "tenant.rollback_checkpoint.snapshot_ref");
  if (!SHA256_RE.test(rollback.checksum_sha256 ?? "")) fail("rollback checksum_sha256 is invalid");
  requireValue(rollback.restore_proof_ref, "tenant.rollback_checkpoint.restore_proof_ref");
  receiptWindow(rollback, "tenant.rollback_checkpoint", now);
  timestamp(rollback.retained_until, "tenant.rollback_checkpoint.retained_until");
  return rollback.checkpoint_id;
}

function validateWaveApproval(receipt, expected, digest, archiveTarget, checkpointId, now) {
  object(receipt, "receipts.jordi_wave_approval");
  if (receipt.status !== "approved" || receipt.approved_by !== "Jordi") fail("DX-3 wave approval by Jordi is required");
  if (receipt.issue_url !== DX3_ISSUE) fail("DX-3 wave approval must be owned by issue #728");
  if (!String(receipt.approval_ref ?? "").startsWith(`${DX3_ISSUE}#issuecomment-`)) fail("DX-3 approval_ref must be an issue #728 comment");
  const approvedAt = timestamp(receipt.approved_at, "receipts.jordi_wave_approval.approved_at");
  const start = timestamp(receipt.window_start, "receipts.jordi_wave_approval.window_start");
  const end = timestamp(receipt.window_end, "receipts.jordi_wave_approval.window_end");
  if (approvedAt > now) fail("DX-3 wave approval is future-dated");
  if (start > now || end < now || start >= end) fail("current time is outside the approved DX-3 wave window");
  if (receipt.candidate_manifest_sha256 !== digest) fail("DX-3 approval candidate digest mismatch");
  if (receipt.archive_target !== archiveTarget) fail("DX-3 approval archive target mismatch");
  exactSet(receipt.candidate_ids, expected.candidateIds, "receipts.jordi_wave_approval.candidate_ids");
  exactSet(receipt.rollback_checkpoint_ids, [checkpointId], "receipts.jordi_wave_approval.rollback_checkpoint_ids");
  return end;
}

export function authorizeWave({ manifestRaw, gate, now = new Date() }) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (Number.isNaN(nowMs)) fail("--now must be a valid timestamp");
  assertNoSecretMaterial(gate);
  const manifest = JSON.parse(manifestRaw);
  const candidate = validateManifest(manifest);
  const digest = sha256(manifestRaw);
  if (!SHA256_RE.test(gate.candidate_manifest_sha256 ?? "") || gate.candidate_manifest_sha256 !== digest) {
    fail("gate candidate_manifest_sha256 does not match the exact manifest bytes");
  }
  if (gate.schema_version !== GATE_SCHEMA) fail(`gate.schema_version must be ${GATE_SCHEMA}`);
  if (gate.environment !== manifest.environment) fail("gate environment does not match manifest");
  const archiveTarget = requireValue(gate.archive_target, "gate.archive_target");
  if (!archiveTarget.startsWith("/srv/zenod-archives/epic37/dx3/") || archiveTarget.endsWith("/dx3/")) {
    fail("archive_target must be a wave-specific path below /srv/zenod-archives/epic37/dx3/");
  }
  const receipts = object(gate.receipts, "gate.receipts");
  const expected = expectedResources(candidate);
  validateCurrentState(receipts.current_state, expected, digest, nowMs);
  const tenantReceipts = array(receipts.tenant_acceptance, "receipts.tenant_acceptance");
  exactSet(tenantReceipts.map((entry) => entry.tenant_id), expected.candidateIds, "receipts.tenant_acceptance tenant IDs");
  const tenantReceipt = tenantReceipts[0];
  const checkpointId = validateTenantAcceptance(tenantReceipt, candidate, nowMs);
  validateGate2(receipts.z_mt_6_gate_2, expected, digest, tenantReceipt, nowMs);
  const windowEnd = validateWaveApproval(receipts.jordi_wave_approval, expected, digest, archiveTarget, checkpointId, nowMs);
  const rollback = tenantReceipt.rollback_checkpoint;
  if (Date.parse(rollback.retained_until) < windowEnd) fail("rollback checkpoint retention ends before the approved wave window");
  if (Date.parse(receipts.z_mt_6_gate_2.valid_until) < windowEnd) fail("Z-MT-6 Gate 2 receipt expires before the approved wave window");
  if (Date.parse(tenantReceipt.valid_until) < windowEnd) fail("tenant acceptance receipt expires before the approved wave window");

  const plan = {
    schema_version: "epic37-dx3-dry-run-plan.v1",
    mode: "dry-run-only",
    generated_at: new Date(nowMs).toISOString(),
    environment: manifest.environment,
    candidate_manifest_sha256: digest,
    archive_target: archiveTarget,
    approval_refs: {
      z_mt_6_gate_2: receipts.z_mt_6_gate_2.approval_ref,
      dx3_wave: receipts.jordi_wave_approval.approval_ref,
    },
    candidates: [{
      tenant_id: candidate.tenant_id,
      compose_id: candidate.dokploy.compose_id,
      domain_ids: candidate.routes.domain_ids,
      container_names: candidate.runtime.container_names,
      volume_names: candidate.storage.volume_names,
      watchdog_tokens: candidate.watchdog_tokens,
      rollback_checkpoint_id: checkpointId,
      phases: [
        "capture fresh source/control-plane evidence and freeze the exact identities",
        "stop writes and snapshot every approved volume into archive_target",
        "write and independently verify snapshot checksums and rollback material",
        "remove exact watchdog registrations and verify source synchronization cannot recreate them",
        "stop the exact Dokploy compose and verify shared-host token continuity remains healthy",
        "remove exact legacy domain and compose records",
        "remove only snapshot-verified volumes approved by the manifest",
        "run shared-host tenant matrix and exact post-sweep inventory",
      ],
    }],
  };
  return { ...plan, plan_sha256: sha256(JSON.stringify(plan)) };
}

function parseArgs(argv) {
  const options = { format: "json" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--manifest", "--gate", "--now", "--format"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) fail(`${arg} requires a value`);
      options[arg.slice(2)] = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") options.help = true;
    else fail(`unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage: node scripts/epic37-dx3-zenod-wave.mjs --manifest <json> --gate <json> [--now <UTC>] [--format json|text]\n\nValidates receipts and prints a dry-run-only plan. This helper has no apply mode and performs no network, Docker, Dokploy, DNS, watchdog, archive, or filesystem mutation.`;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (!options.manifest || !options.gate) fail("--manifest and --gate are required");
  if (!new Set(["json", "text"]).has(options.format)) fail("--format must be json or text");
  const manifestRaw = readFileSync(options.manifest, "utf8");
  const gate = JSON.parse(readFileSync(options.gate, "utf8"));
  const plan = authorizeWave({ manifestRaw, gate, now: options.now ? new Date(options.now) : new Date() });
  if (options.format === "json") process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  else process.stdout.write(`DX-3 RECEIPTS VALID; DRY RUN ONLY\nmanifest=${plan.candidate_manifest_sha256}\nplan=${plan.plan_sha256}\narchive=${plan.archive_target}\n`);
  return 0;
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`epic37-dx3-zenod-wave: ${error.message}\n`);
    process.exitCode = 2;
  }
}
