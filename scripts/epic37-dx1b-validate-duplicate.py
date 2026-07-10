#!/usr/bin/env python3
"""Validate exact DX-1B duplicate evidence and emit a review-only plan."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


MANIFEST_SCHEMA = "epic37-dx1b-record-only-candidate-v1"
APPROVAL_SCHEMA = "epic37-dx1b-record-only-approval-v1"
EXPECTED_CANDIDATE_ID = "Us9aDVdhvlObXLDfDwW0I"
EXPECTED_DUPLICATE_OF = "NR_px8Ul2L2w_RaM4-DWe"
EXPECTED_RUNTIME_PROJECT = "compose-hack-redundant-driver-nu1cex"
EXPECTED_DOMAIN_ID = "injtaVSszHyvNqLDEmJ88"
CAUSATION_EVIDENCE_REF = "https://github.com/zenod-ai/cloud/issues/62#issuecomment-4931765367"
CAUSATION_STATEMENT = (
    "Duplicate cross-environment Traefik ownership sent the cloud-test status GET to live. "
    "The deployed live status-reconcile GET directly wrote the account and queue, spawned the provisioner, "
    "created the compose and domain, then falsely accepted the original shared hostname. "
    "The recovery timer was not deployed and was not causal."
)


class ValidationError(Exception):
    """A fail-closed candidate-package validation error."""


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


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def text(value: dict[str, Any], key: str, label: str) -> str:
    field = value.get(key)
    require(isinstance(field, str) and field.strip(), f"{label}.{key} must be non-empty")
    return field


def timestamp(value: Any, label: str) -> datetime:
    require(isinstance(value, str) and value, f"{label} must be an ISO-8601 timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError(f"{label} must be an ISO-8601 timestamp") from exc
    require(parsed.tzinfo is not None, f"{label} must include a timezone")
    return parsed


def validate_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    require(manifest.get("schema_version") == MANIFEST_SCHEMA, f"manifest.schema_version must be {MANIFEST_SCHEMA}")
    require(manifest.get("package_mode") == "preparation-only", "manifest.package_mode must be preparation-only")
    require(manifest.get("production_mutation_permitted") is False, "manifest must forbid production mutation")
    require(manifest.get("apply_path_present") is False, "manifest must declare no apply path")
    timestamp(manifest.get("observed_at"), "manifest.observed_at")

    candidates = manifest.get("candidates")
    require(isinstance(candidates, list) and len(candidates) == 1, "manifest must contain exactly one candidate")
    candidate = candidates[0]
    require(isinstance(candidate, dict), "manifest candidate must be an object")
    require(candidate.get("candidate_id") == EXPECTED_CANDIDATE_ID, "candidate_id drifted from the observed duplicate")
    require(candidate.get("duplicate_of") == EXPECTED_DUPLICATE_OF, "duplicate_of drifted from the materialized row")
    require(candidate.get("runtime_project") == EXPECTED_RUNTIME_PROJECT, "runtime_project drifted from the observed duplicate")
    require(candidate.get("status") == "idle", "duplicate status must remain idle")
    require(candidate.get("deployment_count") == 0, "duplicate must have zero deployments")
    require(candidate.get("classification") == "duplicate", "candidate classification must be duplicate")
    require(candidate.get("materialization") == "record-only", "candidate materialization must be record-only")
    require(candidate.get("domain_ids") == [EXPECTED_DOMAIN_ID], "candidate domain_ids must bind the exact observed domain")
    require(candidate.get("container_names") == [], "record-only candidate must have zero containers")
    require(candidate.get("volume_names") == [], "record-only candidate must have zero volumes")
    require(candidate.get("watchdog_tokens") == [], "record-only candidate must have zero watchdog tokens")
    text(candidate, "classification_evidence_ref", "candidate")
    require(candidate.get("recovery_defect_ref") == "https://github.com/zenod-ai/cloud/issues/62", "candidate must link cloud recovery defect #62")
    require(candidate.get("causation_evidence_ref") == CAUSATION_EVIDENCE_REF, "candidate must link the conclusive cloud #62 causation audit")
    require(manifest.get("causation_statement") == CAUSATION_STATEMENT, "manifest causation statement must preserve the established live GET path")
    return candidate


def validate_approval(approval: dict[str, Any], manifest_digest: str) -> dict[str, Any]:
    require(approval.get("schema_version") == APPROVAL_SCHEMA, f"approval.schema_version must be {APPROVAL_SCHEMA}")
    require(approval.get("status") == "approved", "record-only cleanup approval status must be approved")
    require(approval.get("approved_by") == "Jordi", "record-only cleanup approval must be issued by Jordi")
    timestamp(approval.get("approved_at"), "approval.approved_at")
    text(approval, "approval_ref", "approval")
    require(approval.get("manifest_sha256") == manifest_digest, "approval manifest_sha256 does not match exact candidate manifest")
    require(approval.get("approved_candidate_ids") == [EXPECTED_CANDIDATE_ID], "approval must bind the exact candidate ID")
    text(approval, "metadata_export_ref", "approval")
    text(approval, "rollback_plan_ref", "approval")

    window = approval.get("window")
    require(isinstance(window, dict), "approval.window must be an object")
    start = timestamp(window.get("start"), "approval.window.start")
    end = timestamp(window.get("end"), "approval.window.end")
    require(start < end, "approval window must have start before end")
    return window


def build_plan(candidate: dict[str, Any], manifest_digest: str, approval: dict[str, Any], window: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": "epic37-dx1b-record-only-review-plan-v1",
        "mode": "review-only",
        "production_mutation_permitted": False,
        "manifest_sha256": manifest_digest,
        "approval_ref": approval["approval_ref"],
        "approved_window": window,
        "candidate_id": candidate["candidate_id"],
        "review_sequence": [
            "refresh exact Dokploy, domain, Docker, volume, and watchdog evidence",
            "prove the row remains idle with zero deployments, containers, and volumes",
            "export exact compose and domain metadata to the approved rollback location",
            "reconcile the candidate digest and window with Jordi approval",
            "hand off to a separately reviewed operator ticket; this plan cannot mutate production",
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--approval", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        require(not args.output.exists(), f"refusing to overwrite existing output {args.output}")
        manifest = load_json(args.manifest, "manifest")
        approval = load_json(args.approval, "approval")
        candidate = validate_manifest(manifest)
        manifest_digest = sha256(args.manifest)
        window = validate_approval(approval, manifest_digest)
        plan = build_plan(candidate, manifest_digest, approval, window)
        args.output.write_text(json.dumps(plan, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except (OSError, ValidationError) as exc:
        print(f"DX-1B duplicate package refused: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
