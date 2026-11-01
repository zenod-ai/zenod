#!/usr/bin/env node

// Copies a live Zenod/Phylax /data volume into a staging directory without
// stopping the workload. Used by zenod-volume-backup.sh (ZENOD_BACKUP_MODE=live).
//
//   full   <source> <snapshot>            live pass: SQLite online backup for every
//                                         database, plain copy for everything else;
//                                         records the databases in <snapshot>.sqlite-list
//   delta  <source> <snapshot> <sinceMs>  re-copy non-SQLite files changed since
//                                         <sinceMs> (the previous pass's start) and
//                                         drop deleted ones; run once live to catch
//                                         up, then once with the workload paused
//                                         for the seconds the remainder takes
//   repair <source> <snapshot>            after resuming: a pause can freeze a writer
//                                         halfway through a non-atomic JSON rewrite
//                                         (e.g. WhatsApp creds.json); re-copy any
//                                         snapshot JSON that does not parse until the
//                                         live file parses again
//
// SQLite databases are copied with the online backup API through a read-only
// connection that takes normal SQLite locks, in a single step, so each copy is a
// consistent snapshot. WAL databases keep accepting writes during the copy; a
// rollback-journal database delays its writer's commit for the copy's duration
// (milliseconds for the small Phylax secrets databases). Their -wal/-shm/-journal
// sidecars are not copied: each backup is self-contained.
//
// File system calls are synchronous on purpose: the paused pass stats thousands
// of files, and a thread-pool round trip per call multiplies the pause.

import { backup, DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  lchownSync,
  lstatSync,
  lutimesSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "latin1");
const SIDECAR = /-(wal|shm|journal)$/;
// Files modified this close to a pass start are re-copied by the next pass, so
// a same-size rewrite within one timestamp tick is not missed.
const MTIME_SLACK_MS = 2000;

const [command, sourceRoot, snapshotRoot, sinceArg] = process.argv.slice(2);
const sqliteListPath = `${snapshotRoot}.sqlite-list`;
const summary = { command, files: 0, sqlite: 0, copied: 0, removed: 0, new_sqlite_raw: 0 };

function statOrUndefined(path) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function isSqlite(path, size) {
  if (size < SQLITE_HEADER.length) return false;
  const descriptor = openSync(path, "r");
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    readSync(descriptor, header, 0, header.length, 0);
    return header.equals(SQLITE_HEADER);
  } finally {
    closeSync(descriptor);
  }
}

function preserveMetadata(path, info) {
  if (!info.isSymbolicLink()) chmodSync(path, info.mode & 0o7777);
  lchownSync(path, info.uid, info.gid);
  lutimesSync(path, info.atime, info.mtime);
}

function copyEntry(sourcePath, targetPath, info) {
  rmSync(targetPath, { force: true, recursive: true });
  if (info.isSymbolicLink()) {
    symlinkSync(readlinkSync(sourcePath), targetPath);
  } else {
    copyFileSync(sourcePath, targetPath);
  }
  preserveMetadata(targetPath, info);
  summary.copied += 1;
}

async function backupSqlite(sourcePath, targetPath, info) {
  rmSync(targetPath, { force: true });
  let lastError;
  // Read-only first; a database nobody has open may need a writable connection
  // to replay a leftover WAL, which is ordinary SQLite recovery.
  for (const readOnly of [true, false]) {
    let database;
    try {
      database = new DatabaseSync(sourcePath, { readOnly, timeout: 10000 });
      // One step = one read transaction: a WAL writer keeps committing, and the
      // copy cannot restart forever on a busy database the way small steps do.
      await backup(database, targetPath, { rate: 2147483647 });
      database.close();
      preserveMetadata(targetPath, info);
      for (const suffix of ["-wal", "-shm", "-journal"]) rmSync(targetPath + suffix, { force: true });
      summary.sqlite += 1;
      return;
    } catch (error) {
      lastError = error;
      try {
        database?.close();
      } catch {}
      rmSync(targetPath, { force: true });
    }
  }
  throw new Error(`${sourcePath}: SQLite online backup failed (${lastError?.message})`);
}

// Pass 1: find every database first, so sidecars are recognised by name.
function findDatabases(dir, found) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) findDatabases(path, found);
    else if (entry.isFile() && isSqlite(path, lstatSync(path).size)) found.add(relative(sourceRoot, path));
  }
  return found;
}

function isSidecar(databases, path) {
  return SIDECAR.test(path) && databases.has(relative(sourceRoot, path).replace(SIDECAR, ""));
}

async function fullPass(sourceDir, targetDir, databases) {
  const dirInfo = lstatSync(sourceDir);
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    const info = statOrUndefined(sourcePath);
    if (!info) continue; // deleted while walking
    if (info.isDirectory()) {
      await fullPass(sourcePath, targetPath, databases);
      continue;
    }
    if (!info.isFile() && !info.isSymbolicLink()) continue;
    summary.files += 1;
    if (databases.has(relative(sourceRoot, sourcePath))) {
      await backupSqlite(sourcePath, targetPath, info);
    } else if (!isSidecar(databases, sourcePath)) {
      copyEntry(sourcePath, targetPath, info);
    }
  }
  preserveMetadata(targetDir, dirInfo);
}

function deltaPass(sourceDir, targetDir, sinceMs, databases) {
  const dirInfo = lstatSync(sourceDir);
  mkdirSync(targetDir, { recursive: true });
  const seen = new Set();
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    const info = statOrUndefined(sourcePath);
    if (!info) continue;
    seen.add(entry.name);
    if (info.isDirectory()) {
      deltaPass(sourcePath, targetPath, sinceMs, databases);
      continue;
    }
    if (!info.isFile() && !info.isSymbolicLink()) continue;
    summary.files += 1;
    // Databases already hold a consistent online backup; sidecars are not copied.
    if (databases.has(relative(sourceRoot, sourcePath)) || isSidecar(databases, sourcePath)) continue;
    const target = statOrUndefined(targetPath);
    // Untouched since before the pass that copied it, so the copy is current.
    // (Copied mtimes are not compared: lutimes rounds through float seconds.)
    if (
      target &&
      target.size === info.size &&
      info.mtimeMs < sinceMs - MTIME_SLACK_MS &&
      info.ctimeMs < sinceMs - MTIME_SLACK_MS
    ) {
      continue;
    }
    if (!target && info.isFile() && isSqlite(sourcePath, info.size)) {
      // Created after the full pass. With the workload paused, the file and its
      // sidecars form a crash-consistent set that SQLite recovers on open.
      copyEntry(sourcePath, targetPath, info);
      for (const suffix of ["-wal", "-journal"]) {
        const sidecarInfo = statOrUndefined(sourcePath + suffix);
        if (sidecarInfo?.isFile()) copyEntry(sourcePath + suffix, targetPath + suffix, sidecarInfo);
      }
      databases.add(relative(sourceRoot, sourcePath));
      summary.new_sqlite_raw += 1;
      continue;
    }
    copyEntry(sourcePath, targetPath, info);
  }
  for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
    if (seen.has(entry.name)) continue;
    if (SIDECAR.test(entry.name) && seen.has(entry.name.replace(SIDECAR, ""))) continue;
    rmSync(join(targetDir, entry.name), { force: true, recursive: true });
    summary.removed += 1;
  }
  preserveMetadata(targetDir, dirInfo);
}

function parsesAsJson(path) {
  try {
    JSON.parse(readFileSync(path, "utf8"));
    return true;
  } catch {
    return false;
  }
}

async function repairPass(sourceDir, targetDir) {
  for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await repairPass(join(sourceDir, entry.name), targetPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json") || parsesAsJson(targetPath)) continue;
    const sourcePath = join(sourceDir, entry.name);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const info = statOrUndefined(sourcePath);
      if (!info?.isFile()) break;
      copyEntry(sourcePath, targetPath, info);
      if (parsesAsJson(targetPath)) {
        summary.repaired = (summary.repaired || 0) + 1;
        break;
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    // Still invalid: left as is, so the restore verifier reports it.
  }
}

function usage() {
  console.error(
    "Usage: zenod-live-snapshot.mjs full <source> <snapshot> | delta <source> <snapshot> <sinceMs> | repair <source> <snapshot>",
  );
  process.exit(2);
}

if (!sourceRoot || !snapshotRoot || relative(sourceRoot, snapshotRoot) === "") usage();
const started = Date.now();
summary.started_ms = started;
if (command === "full") {
  const databases = findDatabases(sourceRoot, new Set());
  await fullPass(sourceRoot, snapshotRoot, databases);
  writeFileSync(sqliteListPath, JSON.stringify([...databases]), { mode: 0o600 });
} else if (command === "delta") {
  const sinceMs = Number(sinceArg);
  if (!Number.isFinite(sinceMs) || sinceMs <= 0) usage();
  const databases = new Set(JSON.parse(readFileSync(sqliteListPath, "utf8")));
  deltaPass(sourceRoot, snapshotRoot, sinceMs, databases);
  writeFileSync(sqliteListPath, JSON.stringify([...databases]), { mode: 0o600 });
} else if (command === "repair") {
  await repairPass(sourceRoot, snapshotRoot);
} else {
  usage();
}
summary.elapsed_ms = Date.now() - started;
console.log(JSON.stringify(summary));
