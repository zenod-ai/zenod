#!/usr/bin/env python3
from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "epic37-dx4-callisthenes-dry-run.py"
REPO_MANIFEST = ROOT / "docs" / "EPIC-3.7-DX4-CALLISTHENES-CANDIDATES.json"
RECEIPT_SCHEMA = ROOT / "docs" / "EPIC-3.7-DX4-CALLISTHENES-RECEIPT.schema.json"
STAMP = "2026-07-10T05:00:00+02:00"
CANDIDATE_ID = "NR_px8Ul2L2w_RaM4-DWe"
TENANT_ID = "tenant-callisthenes-jordi"
ARCHIVE_TARGET = "/srv/zenod-archives/epic37/dx4/20260710"
EVIDENCE_REF = "https://github.com/zenod-ai/zenod/issues/729#issuecomment-test-evidence"
APPROVAL_REF = "https://github.com/zenod-ai/zenod/issues/729#issuecomment-test-approval"
OUTBOUND_ROLLBACK_REF = "https://github.com/zenod-ai/zenod/issues/729#outbound-key-rollback-test"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def eligible_manifest() -> dict[str, Any]:
    manifest = json.loads(REPO_MANIFEST.read_text(encoding="utf-8"))
    manifest["archive_target"] = ARCHIVE_TARGET
    candidate = manifest["candidates"][0]
    candidate["classification"] = "live-paying"
    candidate["classification_source_ref"] = EVIDENCE_REF
    candidate["tenant_id"] = TENANT_ID
    candidate["domain_ids"] = ["domain-callisthenes-jordi"]
    candidate["inventory_gaps"] = []
    return manifest


def complete_receipt(manifest_digest: str) -> dict[str, Any]:
    return {
        "schema_version": "epic37-dx4-receipt-v1",
        "receipt_state": "complete",
        "unit": "callisthenes",
        "manifest_sha256": manifest_digest,
        "archive_target": ARCHIVE_TARGET,
        "pilot_gate": {
            "status": "accepted",
            "receipt_ref": EVIDENCE_REF,
            "accepted_at": STAMP,
        },
        "ca_mt_6": {
            "status": "accepted",
            "receipt_ref": EVIDENCE_REF,
            "accepted_at": STAMP,
            "commit_sha": "a" * 40,
        },
        "candidate_receipts": [
            {
                "candidate_id": CANDIDATE_ID,
                "tenant_id": TENANT_ID,
                "classification_confirmation": {
                    "classification": "live-paying",
                    "confirmed_by": "Jordi",
                    "evidence_ref": EVIDENCE_REF,
                    "confirmed_at": STAMP,
                },
                "tenant_scoped_credentials": {
                    "status": "verified",
                    "tenant_id": TENANT_ID,
                    "evidence_ref": EVIDENCE_REF,
                    "verified_at": STAMP,
                },
                "tenant_scoped_receipts": {
                    "status": "verified",
                    "tenant_id": TENANT_ID,
                    "receipt_count": 1,
                    "evidence_ref": EVIDENCE_REF,
                    "verified_at": STAMP,
                },
                "shared_host_token_continuity": {
                    "status": "passed",
                    "tenant_id": TENANT_ID,
                    "shared_host": "calli.zenod.dev",
                    "old_token_fingerprint_sha256": "b" * 64,
                    "evidence_ref": EVIDENCE_REF,
                    "verified_at": STAMP,
                },
                "rollback_checkpoint": {
                    "status": "ready",
                    "checkpoint_ref": EVIDENCE_REF,
                    "captured_at": STAMP,
                    "outbound_key_rollback_ref": OUTBOUND_ROLLBACK_REF,
                    "snapshot": {
                        "status": "verified",
                        "archive_target": ARCHIVE_TARGET,
                        "archive_path": f"{ARCHIVE_TARGET}/callisthenes-jordi__volume-data__20260710T030000Z.tgz",
                        "sha256": "c" * 64,
                        "evidence_ref": EVIDENCE_REF,
                        "verified_at": STAMP,
                    },
                },
            }
        ],
        "wave_approval": {
            "status": "approved",
            "approved_by": "Jordi",
            "approval_ref": APPROVAL_REF,
            "approved_at": STAMP,
            "manifest_sha256": manifest_digest,
            "archive_target": ARCHIVE_TARGET,
            "window": {
                "start": "2026-07-10T06:00:00+02:00",
                "end": "2026-07-10T06:30:00+02:00",
            },
            "approved_candidates": [
                {
                    "candidate_id": CANDIDATE_ID,
                    "tenant_id": TENANT_ID,
                    "classification": "live-paying",
                    "outbound_key_rollback_ref": OUTBOUND_ROLLBACK_REF,
                }
            ],
        },
    }


class DX4DryRunTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.tmp = Path(self.tempdir.name)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def write_eligible_package(self) -> tuple[Path, Path, dict[str, Any]]:
        manifest_path = self.tmp / "manifest.json"
        receipt_path = self.tmp / "receipt.json"
        write_json(manifest_path, eligible_manifest())
        receipt = complete_receipt(sha256(manifest_path))
        write_json(receipt_path, receipt)
        return manifest_path, receipt_path, receipt

    def run_validator(self, manifest: Path, receipt: Path, name: str = "plan.json") -> tuple[subprocess.CompletedProcess[str], Path]:
        output = self.tmp / name
        result = subprocess.run(
            [
                "python3",
                str(SCRIPT),
                "--manifest",
                str(manifest),
                "--receipt",
                str(receipt),
                "--output",
                str(output),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        return result, output

    def assert_refused_before_plan(self, result: subprocess.CompletedProcess[str], output: Path, expected: str) -> None:
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertIn(expected, result.stderr)
        self.assertFalse(output.exists(), "a refused package must not create a plan")

    def test_repository_manifest_keeps_remaining_row_unknown(self) -> None:
        manifest = json.loads(REPO_MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(manifest["package_mode"], "preparation-only")
        self.assertIsNone(manifest["archive_target"])
        self.assertEqual(len(manifest["candidates"]), 1)
        candidate = manifest["candidates"][0]
        self.assertEqual(candidate["candidate_id"], CANDIDATE_ID)
        self.assertEqual(candidate["classification"], "unknown")
        self.assertIsNone(candidate["tenant_id"])
        self.assertEqual(candidate["domain_ids"], [])

    def test_unknown_classification_refuses_before_plan(self) -> None:
        receipt_path = self.tmp / "receipt.json"
        write_json(receipt_path, {})
        result, output = self.run_validator(REPO_MANIFEST, receipt_path)
        self.assert_refused_before_plan(result, output, "classification is unknown")

    def test_unaccepted_ca_mt_6_refuses_before_plan(self) -> None:
        manifest_path, receipt_path, receipt = self.write_eligible_package()
        receipt["ca_mt_6"]["status"] = "pending"
        write_json(receipt_path, receipt)
        result, output = self.run_validator(manifest_path, receipt_path)
        self.assert_refused_before_plan(result, output, "CA-MT-6 receipt status must be accepted")

    def test_manifest_digest_mismatch_refuses_before_plan(self) -> None:
        manifest_path, receipt_path, receipt = self.write_eligible_package()
        receipt["manifest_sha256"] = "0" * 64
        receipt["wave_approval"]["manifest_sha256"] = "0" * 64
        write_json(receipt_path, receipt)
        result, output = self.run_validator(manifest_path, receipt_path)
        self.assert_refused_before_plan(result, output, "manifest digest does not match")

    def test_each_evidence_and_approval_gate_is_fail_closed(self) -> None:
        mutations = [
            (lambda receipt: receipt["pilot_gate"].update(status="pending"), "pilot gate receipt status must be accepted"),
            (lambda receipt: receipt["candidate_receipts"][0]["tenant_scoped_credentials"].update(status="pending"), "tenant-scoped credentials must be verified"),
            (lambda receipt: receipt["candidate_receipts"][0]["tenant_scoped_receipts"].update(receipt_count=0), "receipt_count must be positive"),
            (lambda receipt: receipt["candidate_receipts"][0]["shared_host_token_continuity"].update(shared_host="wrong.zenod.dev"), "shared-host mismatch"),
            (lambda receipt: receipt["candidate_receipts"][0]["rollback_checkpoint"].update(status="pending"), "rollback checkpoint must be ready"),
            (lambda receipt: receipt["candidate_receipts"][0]["rollback_checkpoint"]["snapshot"].update(archive_target="/wrong/archive"), "snapshot.archive_target does not match"),
            (lambda receipt: receipt["candidate_receipts"][0]["classification_confirmation"].update(classification="test"), "classification confirmation mismatch"),
            (lambda receipt: receipt["wave_approval"].update(status="pending"), "Jordi wave approval status must be approved"),
            (lambda receipt: receipt["wave_approval"].update(archive_target="/wrong/archive"), "wave approval archive target mismatch"),
            (lambda receipt: receipt["wave_approval"]["approved_candidates"][0].update(tenant_id="wrong-tenant"), "approval tenant mismatch"),
            (lambda receipt: receipt["wave_approval"]["approved_candidates"][0].update(outbound_key_rollback_ref="https://example.invalid/wrong"), "outbound-key rollback mismatch"),
        ]
        for index, (mutate, expected) in enumerate(mutations):
            with self.subTest(expected=expected):
                manifest_path, receipt_path, receipt = self.write_eligible_package()
                mutate(receipt)
                write_json(receipt_path, receipt)
                result, output = self.run_validator(manifest_path, receipt_path, f"plan-{index}.json")
                self.assert_refused_before_plan(result, output, expected)

    def test_complete_exact_package_emits_dry_run_only_plan(self) -> None:
        manifest_path, receipt_path, _receipt = self.write_eligible_package()
        result, output = self.run_validator(manifest_path, receipt_path)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")
        plan = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(plan["mode"], "dry-run-only")
        self.assertFalse(plan["production_mutation_permitted"])
        self.assertEqual(plan["manifest_sha256"], sha256(manifest_path))
        first_action = plan["candidates"][0]["planned_sequence"][0]
        self.assertEqual(first_action["action"], "verify_snapshot_checksum")
        self.assertFalse(first_action["production_mutation"])

    def test_helper_exposes_no_apply_or_live_control_path(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        for forbidden in ("subprocess", "requests", "socket", "paramiko", "docker ", "compose.stop", "domain.delete"):
            self.assertNotIn(forbidden, source)
        help_result = subprocess.run(["python3", str(SCRIPT), "--help"], check=False, capture_output=True, text=True)
        self.assertEqual(help_result.returncode, 0)
        self.assertNotIn("--apply", help_result.stdout)
        self.assertNotIn("--execute", help_result.stdout)

    def test_json_artifacts_parse(self) -> None:
        json.loads(REPO_MANIFEST.read_text(encoding="utf-8"))
        schema = json.loads(RECEIPT_SCHEMA.read_text(encoding="utf-8"))
        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")


if __name__ == "__main__":
    unittest.main(verbosity=2)
