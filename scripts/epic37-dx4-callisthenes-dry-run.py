#!/usr/bin/env python3
"""Validate DX-4 evidence and emit a dry-run-only retirement plan.

This helper has no network, shell, SSH, Dokploy, Docker, or apply path. It writes
a plan only after every candidate and receipt gate has passed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import tempfile
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any


MANIFEST_SCHEMA = "epic37-dx4-candidate-v1"
RECEIPT_SCHEMA = "epic37-dx4-receipt-v1"
PLAN_SCHEMA = "epic37-dx4-dry-run-plan-v1"
EXECUTABLE_CLASSIFICATIONS = {"live-paying", "test", "dead", "duplicate"}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


class ValidationError(Exception):
    """A fail-closed package validation error."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError(f"cannot read {label} {path}: {exc}") from exc
    require(isinstance(value, dict), f"{label} must be a JSON object")
    return value


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise ValidationError(f"cannot hash manifest {path}: {exc}") from exc
    return digest.hexdigest()


def object_field(value: dict[str, Any], key: str, label: str) -> dict[str, Any]:
    child = value.get(key)
    require(isinstance(child, dict), f"{label}.{key} must be an object")
    return child


def list_field(value: dict[str, Any], key: str, label: str) -> list[Any]:
    child = value.get(key)
    require(isinstance(child, list), f"{label}.{key} must be an array")
    return child


def text_field(value: dict[str, Any], key: str, label: str) -> str:
    child = value.get(key)
    require(isinstance(child, str) and child.strip(), f"{label}.{key} must be non-empty")
    require(not child.upper().startswith("PENDING"), f"{label}.{key} is still pending")
    return child


def string_list(value: dict[str, Any], key: str, label: str, *, nonempty: bool) -> list[str]:
    items = list_field(value, key, label)
    require(all(isinstance(item, str) and item for item in items), f"{label}.{key} must contain non-empty strings")
    if nonempty:
        require(bool(items), f"{label}.{key} must not be empty")
    require(len(items) == len(set(items)), f"{label}.{key} contains duplicates")
    return items


def require_sha256(value: Any, label: str) -> str:
    require(isinstance(value, str) and SHA256_RE.fullmatch(value) is not None, f"{label} must be a lowercase SHA-256 digest")
    return value


def require_timestamp(value: Any, label: str) -> datetime:
    require(isinstance(value, str) and value, f"{label} must be an ISO-8601 timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError(f"{label} must be an ISO-8601 timestamp") from exc
    require(parsed.tzinfo is not None, f"{label} must include a timezone")
    return parsed


def require_ref(value: dict[str, Any], key: str, label: str) -> str:
    return text_field(value, key, label)


def validate_gate(receipt: dict[str, Any], key: str, display: str) -> dict[str, Any]:
    gate = object_field(receipt, key, "receipt")
    require(gate.get("status") == "accepted", f"{display} receipt status must be accepted")
    require_ref(gate, "receipt_ref", display)
    require_timestamp(gate.get("accepted_at"), f"{display}.accepted_at")
    return gate


def validate_manifest(manifest: dict[str, Any]) -> tuple[list[dict[str, Any]], str, str]:
    require(manifest.get("schema_version") == MANIFEST_SCHEMA, f"manifest.schema_version must be {MANIFEST_SCHEMA}")
    require(manifest.get("package_mode") == "preparation-only", "manifest.package_mode must be preparation-only")
    require(manifest.get("unit") == "callisthenes", "manifest.unit must be callisthenes")
    shared_host = text_field(manifest, "shared_host", "manifest")
    require("/" not in shared_host and "." in shared_host, "manifest.shared_host must be a hostname")

    candidates = list_field(manifest, "candidates", "manifest")
    require(bool(candidates), "manifest.candidates must not be empty")
    candidate_ids: set[str] = set()

    for index, candidate_value in enumerate(candidates):
        label = f"manifest.candidates[{index}]"
        require(isinstance(candidate_value, dict), f"{label} must be an object")
        candidate = candidate_value
        candidate_id = text_field(candidate, "candidate_id", label)
        require(candidate_id not in candidate_ids, f"manifest repeats candidate_id {candidate_id}")
        candidate_ids.add(candidate_id)
        text_field(candidate, "slug", label)

        classification = candidate.get("classification")
        require(classification != "unknown", f"candidate {candidate_id} classification is unknown; explicit Jordi/steward classification is required")
        require(classification in EXECUTABLE_CLASSIFICATIONS, f"candidate {candidate_id} classification {classification!r} is not executable")
        require_ref(candidate, "classification_source_ref", label)
        text_field(candidate, "tenant_id", label)
        require(candidate.get("kind") == "compose", f"candidate {candidate_id} kind must be compose")
        require(candidate.get("dokploy_id") == candidate_id, f"candidate {candidate_id} dokploy_id mismatch")
        string_list(candidate, "domain_ids", label, nonempty=True)
        string_list(candidate, "domains", label, nonempty=True)
        string_list(candidate, "container_names", label, nonempty=True)
        string_list(candidate, "volume_names", label, nonempty=True)
        string_list(candidate, "watchdog_tokens", label, nonempty=False)

    archive_target = manifest.get("archive_target")
    require(isinstance(archive_target, str) and archive_target.startswith("/") and archive_target != "/", "manifest.archive_target must be an exact non-root absolute path")
    require(".." not in PurePosixPath(archive_target).parts, "manifest.archive_target must not contain '..'")
    return candidates, shared_host, archive_target.rstrip("/")


def validate_snapshot(snapshot: dict[str, Any], label: str, archive_target: str) -> None:
    require(snapshot.get("status") == "verified", f"{label}.status must be verified")
    require(snapshot.get("archive_target") == archive_target, f"{label}.archive_target does not match the manifest")
    archive_path = text_field(snapshot, "archive_path", label)
    require(archive_path.startswith(f"{archive_target}/"), f"{label}.archive_path must be inside the exact archive target")
    require(".." not in PurePosixPath(archive_path).parts, f"{label}.archive_path must not contain '..'")
    require_sha256(snapshot.get("sha256"), f"{label}.sha256")
    require_timestamp(snapshot.get("verified_at"), f"{label}.verified_at")
    require_ref(snapshot, "evidence_ref", label)


def validate_candidate_receipt(
    candidate: dict[str, Any],
    proof: dict[str, Any],
    shared_host: str,
    archive_target: str,
) -> str:
    candidate_id = candidate["candidate_id"]
    label = f"receipt candidate {candidate_id}"
    require(proof.get("tenant_id") == candidate["tenant_id"], f"{label}.tenant_id does not match manifest")

    confirmation = object_field(proof, "classification_confirmation", label)
    require(confirmation.get("classification") == candidate["classification"], f"{label} classification confirmation mismatch")
    require(confirmation.get("confirmed_by") == "Jordi", f"{label} classification must be explicitly confirmed by Jordi")
    require_ref(confirmation, "evidence_ref", f"{label}.classification_confirmation")
    require_timestamp(confirmation.get("confirmed_at"), f"{label}.classification_confirmation.confirmed_at")

    credentials = object_field(proof, "tenant_scoped_credentials", label)
    require(credentials.get("status") == "verified", f"{label} tenant-scoped credentials must be verified")
    require(credentials.get("tenant_id") == candidate["tenant_id"], f"{label} credential tenant mismatch")
    require_ref(credentials, "evidence_ref", f"{label}.tenant_scoped_credentials")
    require_timestamp(credentials.get("verified_at"), f"{label}.tenant_scoped_credentials.verified_at")

    receipts = object_field(proof, "tenant_scoped_receipts", label)
    require(receipts.get("status") == "verified", f"{label} tenant-scoped receipts must be verified")
    require(receipts.get("tenant_id") == candidate["tenant_id"], f"{label} receipt tenant mismatch")
    require(
        type(receipts.get("receipt_count")) is int and receipts["receipt_count"] > 0,
        f"{label}.tenant_scoped_receipts.receipt_count must be positive",
    )
    require_ref(receipts, "evidence_ref", f"{label}.tenant_scoped_receipts")
    require_timestamp(receipts.get("verified_at"), f"{label}.tenant_scoped_receipts.verified_at")

    continuity = object_field(proof, "shared_host_token_continuity", label)
    require(continuity.get("status") == "passed", f"{label} shared-host token continuity must pass")
    require(continuity.get("tenant_id") == candidate["tenant_id"], f"{label} token continuity tenant mismatch")
    require(continuity.get("shared_host") == shared_host, f"{label} token continuity shared-host mismatch")
    require_sha256(continuity.get("old_token_fingerprint_sha256"), f"{label}.shared_host_token_continuity.old_token_fingerprint_sha256")
    require_ref(continuity, "evidence_ref", f"{label}.shared_host_token_continuity")
    require_timestamp(continuity.get("verified_at"), f"{label}.shared_host_token_continuity.verified_at")

    rollback = object_field(proof, "rollback_checkpoint", label)
    require(rollback.get("status") == "ready", f"{label} rollback checkpoint must be ready")
    require_ref(rollback, "checkpoint_ref", f"{label}.rollback_checkpoint")
    require_timestamp(rollback.get("captured_at"), f"{label}.rollback_checkpoint.captured_at")
    outbound_ref = require_ref(rollback, "outbound_key_rollback_ref", f"{label}.rollback_checkpoint")
    snapshot = object_field(rollback, "snapshot", f"{label}.rollback_checkpoint")
    validate_snapshot(snapshot, f"{label}.rollback_checkpoint.snapshot", archive_target)
    return outbound_ref


def validate_receipt(
    receipt: dict[str, Any],
    manifest_sha256: str,
    candidates: list[dict[str, Any]],
    shared_host: str,
    archive_target: str,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    require(receipt.get("schema_version") == RECEIPT_SCHEMA, f"receipt.schema_version must be {RECEIPT_SCHEMA}")
    require(receipt.get("receipt_state") == "complete", "receipt.receipt_state must be complete")
    require(receipt.get("unit") == "callisthenes", "receipt.unit must be callisthenes")
    require(receipt.get("manifest_sha256") == manifest_sha256, "receipt manifest digest does not match the exact candidate manifest")
    require(receipt.get("archive_target") == archive_target, "receipt archive target does not match the exact candidate manifest")

    validate_gate(receipt, "pilot_gate", "pilot gate")
    ca_mt_6 = validate_gate(receipt, "ca_mt_6", "CA-MT-6")
    commit_sha = ca_mt_6.get("commit_sha")
    require(isinstance(commit_sha, str) and COMMIT_RE.fullmatch(commit_sha) is not None, "CA-MT-6.commit_sha must be an exact 40-character commit")

    proof_values = list_field(receipt, "candidate_receipts", "receipt")
    proof_by_id: dict[str, dict[str, Any]] = {}
    for index, proof_value in enumerate(proof_values):
        require(isinstance(proof_value, dict), f"receipt.candidate_receipts[{index}] must be an object")
        candidate_id = text_field(proof_value, "candidate_id", f"receipt.candidate_receipts[{index}]")
        require(candidate_id not in proof_by_id, f"receipt repeats candidate_id {candidate_id}")
        proof_by_id[candidate_id] = proof_value

    manifest_ids = {candidate["candidate_id"] for candidate in candidates}
    require(set(proof_by_id) == manifest_ids, "receipt candidate IDs must exactly match the manifest")
    outbound_refs: dict[str, str] = {}
    for candidate in candidates:
        candidate_id = candidate["candidate_id"]
        outbound_refs[candidate_id] = validate_candidate_receipt(
            candidate,
            proof_by_id[candidate_id],
            shared_host,
            archive_target,
        )

    approval = object_field(receipt, "wave_approval", "receipt")
    require(approval.get("status") == "approved", "Jordi wave approval status must be approved")
    require(approval.get("approved_by") == "Jordi", "wave approval must be by Jordi")
    require_ref(approval, "approval_ref", "receipt.wave_approval")
    require_timestamp(approval.get("approved_at"), "receipt.wave_approval.approved_at")
    require(approval.get("manifest_sha256") == manifest_sha256, "Jordi wave approval manifest digest mismatch")
    require(approval.get("archive_target") == archive_target, "Jordi wave approval archive target mismatch")

    window = object_field(approval, "window", "receipt.wave_approval")
    window_start = require_timestamp(window.get("start"), "receipt.wave_approval.window.start")
    window_end = require_timestamp(window.get("end"), "receipt.wave_approval.window.end")
    require(window_start < window_end, "Jordi wave approval window must have start before end")

    approved_values = list_field(approval, "approved_candidates", "receipt.wave_approval")
    approved_by_id: dict[str, dict[str, Any]] = {}
    for index, approved_value in enumerate(approved_values):
        require(isinstance(approved_value, dict), f"receipt.wave_approval.approved_candidates[{index}] must be an object")
        candidate_id = text_field(approved_value, "candidate_id", f"receipt.wave_approval.approved_candidates[{index}]")
        require(candidate_id not in approved_by_id, f"wave approval repeats candidate_id {candidate_id}")
        approved_by_id[candidate_id] = approved_value
    require(set(approved_by_id) == manifest_ids, "Jordi wave approval candidate IDs must exactly match the manifest")

    for candidate in candidates:
        candidate_id = candidate["candidate_id"]
        approved = approved_by_id[candidate_id]
        require(approved.get("tenant_id") == candidate["tenant_id"], f"Jordi approval tenant mismatch for {candidate_id}")
        require(approved.get("classification") == candidate["classification"], f"Jordi approval classification mismatch for {candidate_id}")
        require(approved.get("outbound_key_rollback_ref") == outbound_refs[candidate_id], f"Jordi approval outbound-key rollback mismatch for {candidate_id}")

    return approval, proof_by_id


def build_plan(
    manifest: dict[str, Any],
    receipt: dict[str, Any],
    manifest_sha256: str,
    candidates: list[dict[str, Any]],
    approval: dict[str, Any],
    proof_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    plan_candidates = []
    for candidate in candidates:
        candidate_id = candidate["candidate_id"]
        proof = proof_by_id[candidate_id]
        snapshot = proof["rollback_checkpoint"]["snapshot"]
        actions: list[dict[str, Any]] = [
            {"order": 1, "action": "verify_snapshot_checksum", "production_mutation": False, "target": snapshot["archive_path"]},
        ]
        order = 2
        if candidate["watchdog_tokens"]:
            actions.append({"order": order, "action": "deregister_watchdog_tokens", "production_mutation": True, "targets": candidate["watchdog_tokens"]})
            order += 1
        actions.extend(
            [
                {"order": order, "action": "stop_dokploy_compose", "production_mutation": True, "target": candidate["dokploy_id"]},
                {"order": order + 1, "action": "delete_domain_records", "production_mutation": True, "targets": candidate["domain_ids"]},
                {"order": order + 2, "action": "delete_dokploy_compose_preserving_volume", "production_mutation": True, "target": candidate["dokploy_id"]},
                {"order": order + 3, "action": "remove_leftover_containers", "production_mutation": True, "targets": candidate["container_names"]},
                {"order": order + 4, "action": "remove_only_checksummed_volumes", "production_mutation": True, "targets": candidate["volume_names"]},
                {"order": order + 5, "action": "verify_old_route_unrouted_and_shared_host_continuous", "production_mutation": False, "targets": candidate["domains"] + [manifest["shared_host"]]},
            ]
        )
        plan_candidates.append(
            {
                "candidate_id": candidate_id,
                "slug": candidate["slug"],
                "tenant_id": candidate["tenant_id"],
                "classification": candidate["classification"],
                "snapshot_sha256": snapshot["sha256"],
                "rollback_checkpoint_ref": proof["rollback_checkpoint"]["checkpoint_ref"],
                "planned_sequence": actions,
            }
        )

    return {
        "schema_version": PLAN_SCHEMA,
        "mode": "dry-run-only",
        "production_mutation_permitted": False,
        "unit": "callisthenes",
        "manifest_sha256": manifest_sha256,
        "archive_target": manifest["archive_target"],
        "pilot_gate_receipt_ref": receipt["pilot_gate"]["receipt_ref"],
        "ca_mt_6_receipt_ref": receipt["ca_mt_6"]["receipt_ref"],
        "jordi_wave_approval_ref": approval["approval_ref"],
        "approved_window": approval["window"],
        "candidates": plan_candidates,
    }


def render_json(value: dict[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True) + "\n"


def write_new_atomic(path: Path, content: str) -> None:
    require(not path.exists(), f"refusing to overwrite existing plan output {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_name = ""
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False) as handle:
            temporary_name = handle.name
            handle.write(content)
            handle.flush()
        Path(temporary_name).replace(path)
    except OSError as exc:
        if temporary_name:
            Path(temporary_name).unlink(missing_ok=True)
        raise ValidationError(f"cannot write plan output {path}: {exc}") from exc


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True, help="Exact candidate manifest to validate")
    parser.add_argument("--receipt", type=Path, required=True, help="Completed evidence and Jordi approval receipt")
    parser.add_argument("--output", type=Path, help="Write a new dry-run plan file instead of stdout")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        manifest = load_json(args.manifest, "manifest")
        receipt = load_json(args.receipt, "receipt")
        manifest_sha256 = file_sha256(args.manifest)
        candidates, shared_host, archive_target = validate_manifest(manifest)
        approval, proof_by_id = validate_receipt(
            receipt,
            manifest_sha256,
            candidates,
            shared_host,
            archive_target,
        )
        plan = build_plan(manifest, receipt, manifest_sha256, candidates, approval, proof_by_id)
        rendered = render_json(plan)
        if args.output:
            write_new_atomic(args.output, rendered)
        else:
            sys.stdout.write(rendered)
    except ValidationError as exc:
        print(f"DX-4 validation refused: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
