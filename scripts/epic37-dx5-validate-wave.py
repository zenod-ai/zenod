#!/usr/bin/env python3
"""Fail-closed validator for the Epic 3.7 DX-5 Epaminon retirement packet."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


PACKAGE_FILES = {
    "manifest": "scope-manifest.json",
    "inventory": "fleet-reinventory.json",
    "postflight": "postflight-reinventory.json",
    "receipts": "retirement-receipts.json",
    "cutover": "em-t7-receipt.json",
    "sandbox": "sandbox-proof.json",
    "approval": "approval.json",
}
REQUIRED_COLLECTORS = {
    "dokploy-project-all",
    "docker-ps-a",
    "docker-volumes",
    "watchdog-map",
}
RETIREMENT_TOPOLOGIES = {"separate-per-user", "suite-bundled"}
ALLOWED_CURRENT_TOPOLOGIES = {"canonical-shared", "ephemeral-sandbox"}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
IMAGE_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
LEGACY_PATTERNS = {
    "ZENOD_AWAIT_PROVISION": re.compile(r"ZENOD_AWAIT_PROVISION"),
    "awaitingProvision": re.compile(r"\bawaitingProvision\s*\("),
    "applyProvision": re.compile(r"\bapplyProvision\s*\("),
    "/api/provision": re.compile(r"/api/provision"),
}


class PacketValidator:
    def __init__(self, package_dir: Path, repo_root: Path, now: datetime, max_age_hours: int):
        self.package_dir = package_dir
        self.repo_root = repo_root
        self.now = now
        self.max_age = timedelta(hours=max_age_hours)
        self.errors: list[str] = []
        self.paths = {name: package_dir / filename for name, filename in PACKAGE_FILES.items()}
        self.docs: dict[str, dict[str, Any]] = {}

    def error(self, message: str) -> None:
        self.errors.append(message)

    def require(self, condition: bool, message: str) -> None:
        if not condition:
            self.error(message)

    def load_documents(self) -> None:
        for name, path in self.paths.items():
            if not path.is_file():
                self.error(f"missing packet file: {path}")
                continue
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                self.error(f"cannot read {path}: {exc}")
                continue
            if not isinstance(value, dict):
                self.error(f"{path} must contain a JSON object")
                continue
            self.docs[name] = value

    def parse_time(self, value: Any, label: str) -> datetime | None:
        if not isinstance(value, str) or not value:
            self.error(f"{label} must be a non-empty ISO-8601 timestamp")
            return None
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            self.error(f"{label} is not a valid ISO-8601 timestamp: {value}")
            return None
        if parsed.tzinfo is None:
            self.error(f"{label} must include a timezone: {value}")
            return None
        return parsed.astimezone(timezone.utc)

    def file_sha256(self, path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def validate_common_contract(self) -> None:
        for name, doc in self.docs.items():
            self.require(doc.get("schema_version") == 1, f"{name} schema_version must be 1")
            self.require(doc.get("wave") == "DX-5", f"{name} wave must be DX-5")

    def validate_commit_binding(self) -> str | None:
        try:
            result = subprocess.run(
                ["git", "-C", str(self.repo_root), "rev-parse", "HEAD"],
                check=True,
                capture_output=True,
                text=True,
            )
            checkout_commit = result.stdout.strip()
        except (OSError, subprocess.CalledProcessError) as exc:
            self.error(f"cannot resolve repository HEAD at {self.repo_root}: {exc}")
            return None

        self.require(bool(COMMIT_RE.fullmatch(checkout_commit)), "repository HEAD must be a full commit SHA")
        for name in ("inventory", "postflight", "receipts", "cutover", "sandbox"):
            doc = self.docs.get(name, {})
            commit = doc.get("commit_sha")
            self.require(
                commit == checkout_commit,
                f"{name} commit_sha must match checked-out commit {checkout_commit}",
            )
        return checkout_commit

    def validate_collectors(self, doc: dict[str, Any], label: str) -> None:
        collectors = doc.get("collectors")
        if not isinstance(collectors, list):
            self.error(f"{label} collectors must be a list")
            collectors = []
        collector_names: set[str] = set()
        for index, collector in enumerate(collectors):
            if not isinstance(collector, dict):
                self.error(f"{label} collector {index} must be an object")
                continue
            name = collector.get("name")
            if isinstance(name, str):
                collector_names.add(name)
            self.require(bool(collector.get("evidence_ref")), f"{label} collector {name or index} lacks evidence_ref")
            self.require(
                bool(SHA256_RE.fullmatch(str(collector.get("sha256", "")))),
                f"{label} collector {name or index} lacks an exact SHA-256 digest",
            )
        missing_collectors = REQUIRED_COLLECTORS - collector_names
        self.require(not missing_collectors, f"{label} is incomplete; missing collectors: {sorted(missing_collectors)}")

    def validate_inventory(self) -> tuple[dict[str, dict[str, Any]], datetime | None]:
        inventory = self.docs.get("inventory", {})
        captured_at = self.parse_time(inventory.get("captured_at"), "inventory captured_at")
        if captured_at is not None:
            age = self.now - captured_at
            self.require(age >= timedelta(minutes=-5), "fleet inventory is dated more than five minutes in the future")
            self.require(age <= self.max_age, f"fleet inventory is stale: age {age} exceeds {self.max_age}")

        self.validate_collectors(inventory, "fleet re-inventory")
        rows = self.validate_rows(inventory.get("rows"), "fleet re-inventory rows")
        allowed_topologies = RETIREMENT_TOPOLOGIES | ALLOWED_CURRENT_TOPOLOGIES
        for row_id, row in rows.items():
            topology = row.get("topology")
            self.require(
                topology in allowed_topologies,
                f"fleet re-inventory row {row_id} has unsupported topology {topology!r}",
            )
            self.require(bool(row.get("classification")), f"fleet re-inventory row {row_id} lacks classification")
            if topology == "suite-bundled":
                self.require(row.get("owner_unit") == "ring", f"suite-bundled row {row_id} owner_unit must be ring")
                self.require(bool(row.get("tenant_ref")), f"suite-bundled row {row_id} lacks Ring tenant_ref")
                self.require(
                    row.get("epaminon_tenant_ref") in (None, ""),
                    f"suite-bundled row {row_id} must not invent an Epaminon tenant",
                )
        discovered = {
            row_id: row
            for row_id, row in rows.items()
            if row.get("topology") in RETIREMENT_TOPOLOGIES
        }
        return discovered, captured_at

    def validate_postflight(
        self,
        inventory_at: datetime | None,
        approval_at: datetime | None,
        receipts_at: datetime | None,
    ) -> datetime | None:
        postflight = self.docs.get("postflight", {})
        captured_at = self.parse_time(postflight.get("captured_at"), "postflight captured_at")
        if captured_at is not None:
            age = self.now - captured_at
            self.require(age >= timedelta(minutes=-5), "postflight inventory is dated more than five minutes in the future")
            self.require(age <= self.max_age, f"postflight inventory is stale: age {age} exceeds {self.max_age}")
            if inventory_at is not None:
                self.require(captured_at >= inventory_at, "postflight inventory predates fleet re-inventory")
            if approval_at is not None:
                self.require(captured_at >= approval_at, "postflight inventory predates Jordi approval")
            if receipts_at is not None:
                self.require(captured_at >= receipts_at, "postflight inventory predates retirement receipts")

        self.validate_collectors(postflight, "postflight re-inventory")
        current = self.validate_rows(postflight.get("rows"), "postflight rows")
        current_retirement_rows = {
            row_id
            for row_id, row in current.items()
            if row.get("topology") in RETIREMENT_TOPOLOGIES
        }
        self.require(
            not current_retirement_rows,
            f"unexpected current retirement rows remain: {sorted(current_retirement_rows)}",
        )
        for row_id, row in current.items():
            topology = row.get("topology")
            self.require(
                topology in ALLOWED_CURRENT_TOPOLOGIES,
                f"current row {row_id} has unsupported topology {topology!r}",
            )
            if topology == "ephemeral-sandbox":
                for field in ("job_id", "tenant_ref", "started_at", "expected_teardown_at"):
                    self.require(bool(row.get(field)), f"ephemeral sandbox {row_id} lacks {field}")

        return captured_at

    def validate_rows(self, value: Any, label: str) -> dict[str, dict[str, Any]]:
        if not isinstance(value, list):
            self.error(f"inventory {label} must be a list")
            return {}
        rows: dict[str, dict[str, Any]] = {}
        for index, row in enumerate(value):
            if not isinstance(row, dict):
                self.error(f"inventory {label}[{index}] must be an object")
                continue
            row_id = row.get("row_id")
            if not isinstance(row_id, str) or not row_id:
                self.error(f"inventory {label}[{index}] lacks row_id")
                continue
            if row_id in rows:
                self.error(f"inventory {label} repeats row_id {row_id}")
                continue
            rows[row_id] = row
        return rows

    def validate_manifest(self, discovered: dict[str, dict[str, Any]]) -> set[str]:
        manifest = self.docs.get("manifest", {})
        candidates = manifest.get("candidates")
        if not isinstance(candidates, list):
            self.error("scope manifest candidates must be a list")
            candidates = []

        candidate_ids: set[str] = set()
        for index, candidate in enumerate(candidates):
            if not isinstance(candidate, dict):
                self.error(f"manifest candidate {index} must be an object")
                continue
            row_id = candidate.get("row_id")
            if not isinstance(row_id, str) or not row_id:
                self.error(f"manifest candidate {index} lacks row_id")
                continue
            self.require(row_id not in candidate_ids, f"scope manifest repeats candidate row {row_id}")
            candidate_ids.add(row_id)
            self.require(
                candidate.get("topology") in RETIREMENT_TOPOLOGIES,
                f"candidate {row_id} must be separate-per-user or suite-bundled",
            )
            for field in ("tenant_ref", "job_history_evidence_ref"):
                self.require(bool(candidate.get(field)), f"candidate {row_id} lacks {field}")
            if candidate.get("topology") == "suite-bundled":
                self.require(candidate.get("owner_unit") == "ring", f"suite-bundled candidate {row_id} owner_unit must be ring")
                self.require(
                    candidate.get("epaminon_tenant_ref") in (None, ""),
                    f"suite-bundled candidate {row_id} must not invent an Epaminon tenant",
                )
            inventory_row = discovered.get(row_id)
            if inventory_row is not None:
                for field in ("topology", "classification", "tenant_ref", "owner_unit", "epaminon_tenant_ref"):
                    self.require(
                        candidate.get(field) == inventory_row.get(field),
                        f"candidate {row_id} {field} does not match fleet re-inventory",
                    )

        discovered_ids = set(discovered)
        self.require(
            candidate_ids == discovered_ids,
            "scope manifest candidate rows do not exactly match fleet re-inventory rows: "
            f"manifest={sorted(candidate_ids)} inventory={sorted(discovered_ids)}",
        )

        zero_proof = manifest.get("zero_instance_proof")
        if not candidate_ids:
            if not isinstance(zero_proof, dict):
                self.error("zero-row wave requires zero_instance_proof")
            else:
                self.require(zero_proof.get("status") == "proven", "zero_instance_proof status must be proven")
                refs = zero_proof.get("basis_refs")
                self.require(isinstance(refs, list) and bool(refs), "zero_instance_proof requires basis_refs")
        return candidate_ids

    def validate_retirement_receipts(
        self,
        candidate_ids: set[str],
        approval_at: datetime | None,
    ) -> datetime | None:
        receipt_doc = self.docs.get("receipts", {})
        captured_at = self.parse_time(receipt_doc.get("captured_at"), "retirement receipts captured_at")
        if captured_at is not None and approval_at is not None:
            self.require(captured_at >= approval_at, "retirement receipts predate Jordi approval")
        rows = receipt_doc.get("rows")
        if not isinstance(rows, list):
            self.error("retirement receipts rows must be a list")
            rows = []
        receipt_ids: set[str] = set()
        for index, receipt in enumerate(rows):
            if not isinstance(receipt, dict):
                self.error(f"retirement receipt {index} must be an object")
                continue
            row_id = receipt.get("row_id")
            if not isinstance(row_id, str) or not row_id:
                self.error(f"retirement receipt {index} lacks row_id")
                continue
            self.require(row_id not in receipt_ids, f"retirement receipts repeat row {row_id}")
            receipt_ids.add(row_id)
            archive = receipt.get("archive")
            if not isinstance(archive, dict):
                self.error(f"candidate {row_id} lacks archive evidence")
            else:
                self.require(bool(archive.get("evidence_ref")), f"candidate {row_id} archive lacks evidence_ref")
                self.require(
                    bool(SHA256_RE.fullmatch(str(archive.get("sha256", "")))),
                    f"candidate {row_id} archive lacks exact SHA-256 digest",
                )

            rollback = receipt.get("rollback")
            if not isinstance(rollback, dict):
                self.error(f"candidate {row_id} lacks rollback evidence")
            else:
                self.require(rollback.get("status") == "passed", f"candidate {row_id} rollback status must be passed")
                self.require(bool(rollback.get("evidence_ref")), f"candidate {row_id} rollback lacks evidence_ref")

            removal = receipt.get("removal")
            if not isinstance(removal, dict):
                self.error(f"candidate {row_id} lacks removal evidence")
            else:
                self.require(removal.get("status") == "removed", f"candidate {row_id} removal status must be removed")
                self.require(bool(removal.get("evidence_ref")), f"candidate {row_id} removal lacks evidence_ref")
        self.require(
            receipt_ids == candidate_ids,
            f"retirement receipt rows must exactly match candidates: {sorted(candidate_ids)}",
        )
        return captured_at

    def validate_cutover(self) -> datetime | None:
        cutover = self.docs.get("cutover", {})
        self.require(cutover.get("status") == "accepted", "E-MT-7 receipt status must be accepted")
        self.require(cutover.get("await_provision_removed") is True, "E-MT-7 receipt must prove await_provision_removed=true")
        for field in (
            "accepted_by",
            "acceptance_ref",
            "pilot_gate_ref",
            "spawner_decision_ref",
            "cutover_proof_ref",
            "old_token_proof_ref",
        ):
            self.require(bool(cutover.get(field)), f"E-MT-7 receipt lacks {field}")
        return self.parse_time(cutover.get("accepted_at"), "E-MT-7 accepted_at")

    def validate_sandbox(self) -> None:
        sandbox = self.docs.get("sandbox", {})
        self.require(sandbox.get("status") == "accepted", "ephemeral sandbox proof status must be accepted")
        self.require(bool(sandbox.get("evidence_ref")), "ephemeral sandbox proof lacks evidence_ref")
        self.require(
            bool(IMAGE_DIGEST_RE.fullmatch(str(sandbox.get("worker_image_digest", "")))),
            "ephemeral sandbox proof requires a pinned sha256 worker_image_digest",
        )
        self.require(isinstance(sandbox.get("jobs_proven"), int) and sandbox.get("jobs_proven", 0) > 0, "ephemeral sandbox proof requires jobs_proven > 0")
        lifecycle = sandbox.get("lifecycle")
        if not isinstance(lifecycle, dict):
            self.error("ephemeral sandbox proof lacks lifecycle evidence")
        else:
            for field in ("spawned", "ran", "persisted", "torn_down"):
                self.require(lifecycle.get(field) is True, f"ephemeral sandbox lifecycle {field} must be true")
        self.require(sandbox.get("crash_orphan_count") == 0, "ephemeral sandbox crash proof must report zero orphans")

    def validate_approval(
        self,
        candidate_ids: set[str],
        inventory_at: datetime | None,
        cutover_at: datetime | None,
    ) -> datetime | None:
        approval = self.docs.get("approval", {})
        self.require(approval.get("status") == "approved", "Jordi approval status must be approved")
        self.require(approval.get("approved_by") == "Jordi", "DX-5 approval must be issued by Jordi")
        for field in ("approval_ref", "window", "rollback_plan_ref"):
            self.require(bool(approval.get(field)), f"DX-5 approval lacks {field}")

        manifest_digest = self.file_sha256(self.paths["manifest"]) if self.paths["manifest"].is_file() else ""
        inventory_digest = self.file_sha256(self.paths["inventory"]) if self.paths["inventory"].is_file() else ""
        self.require(
            approval.get("manifest_sha256") == manifest_digest,
            f"approval manifest_sha256 does not match exact manifest digest {manifest_digest}",
        )
        self.require(
            approval.get("inventory_sha256") == inventory_digest,
            f"approval inventory_sha256 does not match exact inventory digest {inventory_digest}",
        )
        approved_rows = approval.get("approved_row_ids")
        self.require(
            isinstance(approved_rows, list) and set(approved_rows) == candidate_ids and len(approved_rows) == len(candidate_ids),
            f"approval row list must exactly match candidates: {sorted(candidate_ids)}",
        )

        approved_at = self.parse_time(approval.get("approved_at"), "approval approved_at")
        if approved_at is not None:
            if inventory_at is not None:
                self.require(approved_at >= inventory_at, "approval predates the current fleet re-inventory")
            if cutover_at is not None:
                self.require(approved_at >= cutover_at, "approval predates accepted E-MT-7 evidence")
        return approved_at

    def scan_legacy_paths(self) -> None:
        files: set[Path] = set()
        for relative in ("packages/server/src", "packages/server/test", "units"):
            root = self.repo_root / relative
            if not root.is_dir():
                self.error(f"legacy-path scan root is missing: {relative}")
                continue
            files.update(path for path in root.rglob("*") if path.is_file())
        files.update(path for path in self.repo_root.glob("docker-compose*.yml") if path.is_file())
        files.update(path for path in self.repo_root.glob("docker-compose*.yaml") if path.is_file())

        matches: list[str] = []
        for path in sorted(files):
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            for line_number, line in enumerate(text.splitlines(), start=1):
                for label, pattern in LEGACY_PATTERNS.items():
                    if pattern.search(line):
                        matches.append(f"{path.relative_to(self.repo_root)}:{line_number}:{label}")
        self.require(not matches, "remaining AWAIT_PROVISION path(s) found: " + ", ".join(matches[:20]))

    def run(self) -> list[str]:
        self.load_documents()
        if self.errors:
            return self.errors
        self.validate_common_contract()
        self.validate_commit_binding()
        discovered, inventory_at = self.validate_inventory()
        candidate_ids = self.validate_manifest(discovered)
        cutover_at = self.validate_cutover()
        self.validate_sandbox()
        approval_at = self.validate_approval(candidate_ids, inventory_at, cutover_at)
        receipts_at = self.validate_retirement_receipts(candidate_ids, approval_at)
        self.validate_postflight(inventory_at, approval_at, receipts_at)
        self.scan_legacy_paths()
        return self.errors


def parse_timestamp(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"invalid ISO-8601 timestamp: {value}") from exc
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError("timestamp must include a timezone")
    return parsed.astimezone(timezone.utc)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-dir", required=True, type=Path)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--now", type=parse_timestamp, default=datetime.now(timezone.utc))
    parser.add_argument("--max-inventory-age-hours", type=int, default=24)
    args = parser.parse_args()

    if args.max_inventory_age_hours <= 0:
        parser.error("--max-inventory-age-hours must be positive")

    validator = PacketValidator(
        package_dir=args.package_dir.resolve(),
        repo_root=args.repo_root.resolve(),
        now=args.now,
        max_age_hours=args.max_inventory_age_hours,
    )
    errors = validator.run()
    if errors:
        print("DX-5 wave validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("DX-5 wave packet accepted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
