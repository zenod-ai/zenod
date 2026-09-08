#!/usr/bin/env python3
"""Repair completed audio capture metadata from a source-verified manifest; dry-run by default.

Manifest: [{sourceId, evidenceRef, contentType: voice_note|audio, senderTimestamp}].
Only existing task input metadata changes. Evidence, results, status and ordering fields
are preserved. A protected undo receipt is written before the transaction commits.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import sqlite3


def plan(db, manifest, tenant):
    if not manifest or len(manifest) > 100:
        raise ValueError("Require 1–100 explicitly source-verified captures")
    changes, seen = [], set()
    for capture in manifest:
        source_id = capture["sourceId"]
        if source_id in seen or not re.fullmatch(r"[A-Za-z0-9_-]+", source_id):
            raise ValueError("Invalid or duplicate source identity")
        seen.add(source_id)
        if capture["contentType"] not in ("voice_note", "audio"):
            raise ValueError("Invalid content type")
        if not re.fullmatch(r"Log/\d{4}-\d{2}-\d{2}\.md#\^e-[a-zA-Z0-9]+", capture["evidenceRef"]):
            raise ValueError("Invalid exact evidence reference")
        timestamp = capture["senderTimestamp"]
        if not timestamp.endswith("Z"):
            raise ValueError("Source time must be UTC")
        datetime.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        rows = db.execute("SELECT id,kind,status,input_json,result_json FROM task_jobs WHERE tenant_id=? AND idempotency_key=?",
                          (tenant, f"{tenant}:whatsapp:{source_id}")).fetchall()
        if len(rows) != 1:
            raise ValueError(f"Expected one exact capture job for {source_id}, found {len(rows)}")
        row = rows[0]
        source = json.loads(row[3])
        result = json.loads(row[4] or "null") or {}
        if row[1:3] != ("media_ingest", "done") or source.get("mediaType") != "audio":
            raise ValueError(f"Refusing nonterminal/non-audio job {row[0]}")
        if result.get("digest", {}).get("evidenceRef") != capture["evidenceRef"]:
            raise ValueError(f"Evidence mismatch for {source_id}")
        corrected = dict(source, contentType=capture["contentType"], senderTimestamp=timestamp)
        if corrected == source:
            continue
        changes.append(dict(id=row[0], before=row[3], after=json.dumps(corrected, ensure_ascii=False, separators=(",", ":")),
                            evidenceRef=capture["evidenceRef"], sourceId=source_id))
    return changes


def repair(database, manifest, tenant, receipt=None):
    db = sqlite3.connect(f"file:{Path(database).resolve()}?mode={'rw' if receipt else 'ro'}", uri=True, timeout=10)
    try:
        db.execute("BEGIN IMMEDIATE" if receipt else "BEGIN")
        changes = plan(db, manifest, tenant)
        if receipt and changes:
            # Never clobber a previous receipt; caller retains it outside the repo.
            fd = os.open(receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as output:
                json.dump(dict(tenant=tenant, changes=changes), output, indent=2)
                output.flush()
                os.fsync(output.fileno())
            for change in changes:
                count = db.execute("UPDATE task_jobs SET input_json=? WHERE tenant_id=? AND id=? AND input_json=? AND status='done'",
                                   (change["after"], tenant, change["id"], change["before"])).rowcount
                if count != 1:
                    raise ValueError("Concurrent change; entire repair rolled back")
            db.commit()
        else:
            db.rollback()
        return dict(mode="apply" if receipt else "dry-run", checked=len(manifest), changed=len(changes),
                    voiceNotes=sum(c["contentType"] == "voice_note" for c in manifest),
                    audio=sum(c["contentType"] == "audio" for c in manifest))
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database")
    parser.add_argument("manifest")
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--apply", metavar="PRIVATE_UNDO_RECEIPT")
    args = parser.parse_args()
    print(json.dumps(repair(args.database, json.loads(Path(args.manifest).read_text()), args.tenant, args.apply)))
