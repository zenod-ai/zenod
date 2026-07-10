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
SCRIPT = ROOT / "scripts" / "epic37-dx1b-validate-duplicate.py"
MANIFEST = ROOT / "docs" / "EPIC-3.7-DX1B-CALLISTHENES-DUPLICATE-CANDIDATE.json"
CURRENT_STATE = ROOT / "docs" / "EPIC-3.7-DX1B-CURRENT-STATE.json"
CANDIDATE_ID = "Us9aDVdhvlObXLDfDwW0I"
CAUSATION_REF = "https://github.com/zenod-ai/cloud/issues/62#issuecomment-4931765367"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def valid_approval(manifest_digest: str) -> dict[str, Any]:
    return {
        "schema_version": "epic37-dx1b-record-only-approval-v1",
        "status": "approved",
        "approved_by": "Jordi",
        "approved_at": "2026-07-10T06:00:00+02:00",
        "approval_ref": "https://github.com/zenod-ai/zenod/issues/793#issuecomment-approval-test",
        "manifest_sha256": manifest_digest,
        "approved_candidate_ids": [CANDIDATE_ID],
        "window": {
            "start": "2026-07-10T06:00:00+02:00",
            "end": "2026-07-10T06:15:00+02:00"
        },
        "metadata_export_ref": "/private/epic37/dx1b/compose-domain-export.json",
        "rollback_plan_ref": "https://github.com/zenod-ai/zenod/issues/793#record-only-rollback-test"
    }


class DuplicateCandidateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.tmp = Path(self.tempdir.name)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def run_validator(self, manifest: Path, approval: dict[str, Any]) -> tuple[subprocess.CompletedProcess[str], Path]:
        approval_path = self.tmp / "approval.json"
        output = self.tmp / "plan.json"
        write_json(approval_path, approval)
        result = subprocess.run(
            ["python3", str(SCRIPT), "--manifest", str(manifest), "--approval", str(approval_path), "--output", str(output)],
            check=False,
            capture_output=True,
            text=True,
        )
        return result, output

    def assert_refused(self, result: subprocess.CompletedProcess[str], output: Path, message: str) -> None:
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn(message, result.stderr)
        self.assertFalse(output.exists())

    def test_repository_manifest_binds_exact_record_only_duplicate(self) -> None:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.assertFalse(manifest["production_mutation_permitted"])
        self.assertFalse(manifest["apply_path_present"])
        candidate = manifest["candidates"][0]
        self.assertEqual(candidate["candidate_id"], CANDIDATE_ID)
        self.assertEqual(candidate["classification"], "duplicate")
        self.assertEqual(candidate["materialization"], "record-only")
        self.assertEqual(candidate["deployment_count"], 0)
        self.assertEqual(candidate["container_names"], [])
        self.assertEqual(candidate["volume_names"], [])
        self.assertEqual(candidate["causation_evidence_ref"], CAUSATION_REF)
        self.assertIn("status-reconcile GET directly wrote", manifest["causation_statement"])
        self.assertIn("recovery timer was not deployed and was not causal", manifest["causation_statement"])

        current_state = json.loads(CURRENT_STATE.read_text(encoding="utf-8"))
        audit = current_state["causation_audit"]
        self.assertEqual(audit["status"], "established")
        self.assertEqual(audit["evidence_ref"], CAUSATION_REF)
        self.assertIn("status-reconcile GET directly wrote", audit["statement"])

    def test_missing_approval_fails_closed(self) -> None:
        result, output = self.run_validator(MANIFEST, {})
        self.assert_refused(result, output, "approval.schema_version")

    def test_digest_candidate_window_and_rollback_are_exact_gates(self) -> None:
        mutations = [
            (lambda value: value.update(manifest_sha256="0" * 64), "manifest_sha256 does not match"),
            (lambda value: value.update(approved_candidate_ids=[]), "exact candidate ID"),
            (lambda value: value["window"].update(end=value["window"]["start"]), "start before end"),
            (lambda value: value.update(metadata_export_ref=""), "metadata_export_ref must be non-empty"),
            (lambda value: value.update(rollback_plan_ref=""), "rollback_plan_ref must be non-empty"),
        ]
        for mutate, message in mutations:
            with self.subTest(message=message):
                approval = valid_approval(digest(MANIFEST))
                mutate(approval)
                result, output = self.run_validator(MANIFEST, approval)
                self.assert_refused(result, output, message)

    def test_identity_or_materialization_drift_fails_closed(self) -> None:
        for field, value, message in (
            ("candidate_id", "wrong", "candidate_id drifted"),
            ("runtime_project", "wrong", "runtime_project drifted"),
            ("classification", "test", "classification must be duplicate"),
            ("materialization", "running", "materialization must be record-only"),
            ("deployment_count", 1, "zero deployments"),
            ("volume_names", ["unexpected"], "zero volumes"),
        ):
            with self.subTest(field=field):
                manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
                manifest["candidates"][0][field] = value
                path = self.tmp / f"manifest-{field}.json"
                write_json(path, manifest)
                result, output = self.run_validator(path, valid_approval(digest(path)))
                self.assert_refused(result, output, message)

    def test_incorrect_causation_fails_closed(self) -> None:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        manifest["causation_statement"] = "Causation pending."
        path = self.tmp / "manifest-causation.json"
        write_json(path, manifest)
        result, output = self.run_validator(path, valid_approval(digest(path)))
        self.assert_refused(result, output, "must preserve the established live GET path")

    def test_valid_approval_emits_review_only_plan(self) -> None:
        result, output = self.run_validator(MANIFEST, valid_approval(digest(MANIFEST)))
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(plan["mode"], "review-only")
        self.assertFalse(plan["production_mutation_permitted"])
        self.assertEqual(plan["candidate_id"], CANDIDATE_ID)

    def test_validator_exposes_no_live_control_path(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        for forbidden in ("subprocess", "requests", "socket", "paramiko", "compose.delete", "domain.delete"):
            self.assertNotIn(forbidden, source)
        help_result = subprocess.run(["python3", str(SCRIPT), "--help"], check=False, capture_output=True, text=True)
        self.assertEqual(help_result.returncode, 0)
        self.assertNotIn("--apply", help_result.stdout)
        self.assertNotIn("--execute", help_result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
