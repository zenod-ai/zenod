import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as sqlite from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const snapshotScript = join(scriptsDir, "zenod-live-snapshot.mjs");

test("zenod-volume-backup.sh safety tests (mocked docker)", () => {
  execFileSync("bash", [join(scriptsDir, "zenod-volume-backup.test.sh")], { stdio: "pipe" });
});

test("live snapshot: online SQLite backup, delta and JSON repair", { skip: !sqlite.backup && "node:sqlite backup unavailable" }, () => {
  const root = mkdtempSync(join(tmpdir(), "zenod-live-snapshot-"));
  try {
    const source = join(root, "source");
    const snapshot = join(root, "snapshot");
    mkdirSync(join(source, "whatsapp", "session"), { recursive: true });
    const writer = new sqlite.DatabaseSync(join(source, "data.sqlite"));
    writer.exec("PRAGMA journal_mode=WAL; CREATE TABLE t(v TEXT)");
    writer.prepare("INSERT INTO t(v) VALUES (?)").run("before");
    writeFileSync(join(source, "whatsapp", "session", "creds.json"), JSON.stringify({ n: 1 }));
    writeFileSync(join(source, "gone.json"), "{}");
    assert.ok(existsSync(join(source, "data.sqlite-wal")), "writer keeps a live WAL");

    const run = (...args) => JSON.parse(execFileSync(process.execPath, [snapshotScript, ...args], { encoding: "utf8" }));
    const full = run("full", source, snapshot);
    assert.equal(full.sqlite, 1);
    assert.ok(!existsSync(join(snapshot, "data.sqlite-wal")), "sidecars are not copied");
    assert.deepEqual(JSON.parse(readFileSync(`${snapshot}.sqlite-list`, "utf8")), ["data.sqlite"]);

    // Changes after the live pass: written, added and deleted files.
    writer.prepare("INSERT INTO t(v) VALUES (?)").run("after");
    writeFileSync(join(source, "whatsapp", "session", "creds.json"), JSON.stringify({ n: 2 }));
    writeFileSync(join(source, "new.json"), "[]");
    rmSync(join(source, "gone.json"));
    const delta = run("delta", source, snapshot, String(full.started_ms));
    assert.equal(delta.removed, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(snapshot, "whatsapp", "session", "creds.json"), "utf8")), { n: 2 });
    assert.ok(existsSync(join(snapshot, "new.json")));
    assert.ok(!existsSync(join(snapshot, "gone.json")));

    const copy = new sqlite.DatabaseSync(join(snapshot, "data.sqlite"), { readOnly: true });
    assert.deepEqual(copy.prepare("SELECT v FROM t").all().map((row) => row.v), ["before"]);
    assert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    copy.close();

    // A pause froze a writer mid-rewrite: the repair pass re-copies the live file.
    writeFileSync(join(snapshot, "whatsapp", "session", "creds.json"), '{"n":');
    const repair = run("repair", source, snapshot);
    assert.equal(repair.repaired, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(snapshot, "whatsapp", "session", "creds.json"), "utf8")), { n: 2 });
    writer.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
