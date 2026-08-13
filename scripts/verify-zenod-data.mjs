#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const root = resolve(process.argv[2] || "/data");
const failures = [];
let files = 0;
let jsonFiles = 0;
let sqliteFiles = 0;

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!entry.isFile()) continue;
    files += 1;
    const extension = extname(entry.name).toLowerCase();
    if (extension === ".json") {
      jsonFiles += 1;
      try {
        JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        failures.push(`${path}: invalid JSON (${error.message})`);
      }
      continue;
    }
    if (extension !== ".sqlite" && extension !== ".db") continue;
    if ((await stat(path)).size === 0) continue;
    sqliteFiles += 1;
    try {
      const database = new DatabaseSync(path, { readOnly: true });
      const rows = database.prepare("PRAGMA integrity_check").all();
      database.close();
      if (rows.length !== 1 || rows[0].integrity_check !== "ok") {
        failures.push(`${path}: SQLite integrity_check failed (${JSON.stringify(rows)})`);
      }
    } catch (error) {
      failures.push(`${path}: SQLite validation failed (${error.message})`);
    }
  }
}

try {
  await walk(root);
} catch (error) {
  failures.push(`${root}: cannot inspect restored data (${error.message})`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, root, files, json_files: jsonFiles, sqlite_files: sqliteFiles }));
}
