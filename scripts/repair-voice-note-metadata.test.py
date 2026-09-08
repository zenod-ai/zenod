import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("repair", Path(__file__).with_name("repair-voice-note-metadata.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class MetadataRepairTest(unittest.TestCase):
    def test_scoped_idempotent_metadata_only_repair_and_mismatch_refusal(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tasks.sqlite"
            db = sqlite3.connect(path)
            db.execute("CREATE TABLE task_jobs (id,tenant_id,idempotency_key,kind,status,input_json,result_json,updated_at)")
            manifest = []
            for i, kind in enumerate(("voice_note", "audio")):
                ref = f"Log/2026-09-08.md#^e-{i}"
                item = dict(sourceId=f"ID{i}", evidenceRef=ref, contentType=kind, senderTimestamp="2026-09-08T11:47:18Z")
                manifest.append(item)
                db.execute("INSERT INTO task_jobs VALUES(?,?,?,?,?,?,?,?)", (str(i), "tenant", f"tenant:whatsapp:ID{i}", "media_ingest", "done", json.dumps(dict(mediaType="audio", providedTranscript="immutable transcript")), json.dumps(dict(digest=dict(evidenceRef=ref))), 123))
            db.commit()
            before = db.execute("SELECT * FROM task_jobs").fetchall()
            self.assertEqual(module.repair(path, manifest, "tenant")["changed"], 2)
            self.assertEqual(db.execute("SELECT * FROM task_jobs").fetchall(), before)
            invalid = [manifest[0], dict(manifest[1], evidenceRef="Log/2026-09-08.md#^e-mismatch")]
            with self.assertRaises(ValueError):
                module.repair(path, invalid, "tenant", str(Path(directory) / "bad.json"))
            self.assertEqual(db.execute("SELECT * FROM task_jobs").fetchall(), before)
            receipt = Path(directory) / "undo.json"
            self.assertEqual(module.repair(path, manifest, "tenant", str(receipt))["changed"], 2)
            after = db.execute("SELECT * FROM task_jobs").fetchall()
            for old, new, expected in zip(before, after, ("voice_note", "audio")):
                self.assertEqual(old[:5], new[:5])
                self.assertEqual(old[6:], new[6:])
                self.assertEqual(json.loads(new[5])["contentType"], expected)
                self.assertEqual(json.loads(new[5])["providedTranscript"], "immutable transcript")
            self.assertEqual(receipt.stat().st_mode & 0o777, 0o600)
            self.assertEqual(module.repair(path, manifest, "tenant", str(receipt))["changed"], 0)
            with self.assertRaises(ValueError):
                module.repair(path, manifest, "different-tenant")
            db.close()

if __name__ == "__main__":
    unittest.main()
