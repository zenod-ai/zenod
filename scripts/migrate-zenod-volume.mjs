#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const RECEIPT_SCHEMA_VERSION = 1;
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf8");
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/i;
const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const LEGACY_AUTH_SETTING_KEYS = [
  "admin_password_hash",
  "api_token",
  "session_secret",
];
const AUTH_DB_PATHS = new Set([
  "zenod.sqlite",
  "zenod.sqlite-shm",
  "zenod.sqlite-wal",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  const hash = createHash("sha256");
  const descriptor = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count = 0;
    while ((count = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

function normalizeTokenHash(tokenHash) {
  const normalized = String(tokenHash ?? "").trim().toLowerCase();
  if (!TOKEN_HASH_PATTERN.test(normalized)) {
    throw new Error("--token-hash must be a 64-character SHA-256 hex digest");
  }
  return normalized;
}

function assertTenantId(tenantId) {
  if (!TENANT_ID_PATTERN.test(String(tenantId ?? ""))) {
    throw new Error("--tenant must match the chassis tenant-id contract");
  }
}

function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function assertDisjointPaths(source, target) {
  if (isInside(source, target) || isInside(target, source)) {
    throw new Error(`source and target must be disjoint paths: ${source} <-> ${target}`);
  }
}

function modeBits(stat) {
  return stat.mode & 0o7777;
}

function walkManifest(root, relativeDir = "", entries = []) {
  const absoluteDir = relativeDir ? join(root, relativeDir) : root;
  const children = readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

  for (const child of children) {
    const relativePath = relativeDir ? join(relativeDir, child.name) : child.name;
    const absolutePath = join(root, relativePath);
    const stat = lstatSync(absolutePath);

    if (stat.isDirectory()) {
      entries.push({ path: relativePath, type: "directory", mode: modeBits(stat) });
      walkManifest(root, relativePath, entries);
      continue;
    }

    if (stat.isFile()) {
      entries.push({
        path: relativePath,
        type: "file",
        mode: modeBits(stat),
        size: stat.size,
        sha256: sha256File(absolutePath),
      });
      continue;
    }

    if (stat.isSymbolicLink()) {
      const target = readlinkSync(absolutePath);
      entries.push({ path: relativePath, type: "symlink", target, sha256: sha256(target) });
      continue;
    }

    throw new Error(`unsupported filesystem entry in legacy volume: ${relativePath}`);
  }

  return entries;
}

export function buildManifest(root) {
  const absoluteRoot = resolve(root);
  if (!existsSync(absoluteRoot) || !lstatSync(absoluteRoot).isDirectory()) {
    throw new Error(`source directory does not exist: ${absoluteRoot}`);
  }
  const entries = walkManifest(absoluteRoot);
  for (const entry of entries) {
    if (entry.type !== "symlink") continue;
    const resolvedTarget = resolve(dirname(join(absoluteRoot, entry.path)), entry.target);
    if (!isInside(absoluteRoot, resolvedTarget)) {
      throw new Error(`symlink escapes the tenant volume: ${entry.path} -> ${entry.target}`);
    }
  }
  return {
    root: absoluteRoot,
    entries,
    digest: sha256(JSON.stringify(entries)),
    files: entries.filter((entry) => entry.type === "file").length,
    directories: entries.filter((entry) => entry.type === "directory").length,
    symlinks: entries.filter((entry) => entry.type === "symlink").length,
    bytes: entries.reduce((total, entry) => total + (entry.type === "file" ? entry.size : 0), 0),
  };
}

function copyTree(source, target) {
  mkdirSync(target, { recursive: false });
  for (const child of readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const sourcePath = join(source, child.name);
    const targetPath = join(target, child.name);
    const stat = lstatSync(sourcePath);

    if (stat.isDirectory()) {
      copyTree(sourcePath, targetPath);
      chmodSync(targetPath, modeBits(stat));
      utimesSync(targetPath, stat.atime, stat.mtime);
      continue;
    }

    if (stat.isFile()) {
      copyFileSync(sourcePath, targetPath);
      chmodSync(targetPath, modeBits(stat));
      utimesSync(targetPath, stat.atime, stat.mtime);
      continue;
    }

    if (stat.isSymbolicLink()) {
      symlinkSync(readlinkSync(sourcePath), targetPath);
      continue;
    }

    throw new Error(`unsupported filesystem entry in legacy volume: ${sourcePath}`);
  }
}

function hasSqliteHeader(path) {
  const descriptor = openSync(path, "r");
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    const count = readSync(descriptor, header, 0, header.length, 0);
    return count === SQLITE_HEADER.length && header.equals(SQLITE_HEADER);
  } finally {
    closeSync(descriptor);
  }
}

function sqliteFiles(root, manifest) {
  return manifest.entries
    .filter((entry) => entry.type === "file")
    .map((entry) => entry.path)
    .filter((path) => hasSqliteHeader(join(root, path)));
}

export function verifySqlite(root, manifest = buildManifest(root)) {
  return sqliteFiles(root, manifest).map((relativePath) => {
    const sourcePath = join(root, relativePath);
    const scratch = mkdtempSync(join(tmpdir(), "zenod-sqlite-integrity-"));
    const scratchPath = join(scratch, basename(relativePath));
    copyFileSync(sourcePath, scratchPath);
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(`${sourcePath}${suffix}`)) copyFileSync(`${sourcePath}${suffix}`, `${scratchPath}${suffix}`);
    }
    let db = null;
    try {
      db = new DatabaseSync(scratchPath);
      const rows = db.prepare("PRAGMA integrity_check").all();
      const messages = rows.map((row) => String(row.integrity_check ?? Object.values(row)[0]));
      if (messages.length !== 1 || messages[0] !== "ok") {
        throw new Error(`SQLite integrity check failed for ${relativePath}: ${messages.join("; ")}`);
      }
      return { path: relativePath, integrityCheck: "ok" };
    } finally {
      db?.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}

function legacyAuthSettings(root) {
  const path = join(root, "zenod.sqlite");
  if (!existsSync(path)) return [];
  const scratch = mkdtempSync(join(tmpdir(), "zenod-auth-settings-"));
  const scratchPath = join(scratch, "zenod.sqlite");
  copyFileSync(path, scratchPath);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(`${path}${suffix}`))
      copyFileSync(`${path}${suffix}`, `${scratchPath}${suffix}`);
  }
  const db = new DatabaseSync(scratchPath);
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'")
      .get();
    if (!table) return [];
    const placeholders = LEGACY_AUTH_SETTING_KEYS.map(() => "?").join(", ");
    return db
      .prepare(`SELECT key FROM settings WHERE key IN (${placeholders}) ORDER BY key`)
      .all(...LEGACY_AUTH_SETTING_KEYS)
      .map((row) => String(row.key));
  } finally {
    db.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

function scrubLegacyAuthSettings(root) {
  const path = join(root, "zenod.sqlite");
  const keys = legacyAuthSettings(root);
  if (keys.length === 0) return keys;
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA secure_delete = ON");
    const placeholders = keys.map(() => "?").join(", ");
    db.prepare(`DELETE FROM settings WHERE key IN (${placeholders})`).run(...keys);
    db.exec("VACUUM");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
  return keys;
}

function comparableManifestEntries(manifest) {
  return manifest.entries.filter((entry) => !AUTH_DB_PATHS.has(entry.path));
}

function assertMigratedManifest(sourceManifest, targetManifest, scrubbedSettings) {
  if (scrubbedSettings.length === 0) {
    if (sourceManifest.digest !== targetManifest.digest) {
      throw new Error("target checksum manifest differs from source");
    }
    return;
  }
  if (
    JSON.stringify(comparableManifestEntries(sourceManifest)) !==
    JSON.stringify(comparableManifestEntries(targetManifest))
  ) {
    throw new Error(
      "target already exists with different content outside the authorized legacy-auth scrub",
    );
  }
}

function runGit(repository, args) {
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "git command failed").trim();
    throw new Error(`git ${args.join(" ")} failed in ${repository}: ${detail}`);
  }
  return result.stdout.trimEnd();
}

function gitRepositories(manifest) {
  return [...new Set(
    manifest.entries
      .filter((entry) => basename(entry.path) === ".git" && (entry.type === "directory" || entry.type === "file"))
      .map((entry) => dirname(entry.path) === "." ? "" : dirname(entry.path)),
  )].sort();
}

export function verifyGit(root, manifest = buildManifest(root)) {
  return gitRepositories(manifest).map((relativePath) => {
    const repository = relativePath ? join(root, relativePath) : root;
    const head = runGit(repository, ["rev-parse", "--verify", "HEAD"]);
    const status = runGit(repository, ["status", "--porcelain=v1", "--untracked-files=all"]);
    runGit(repository, ["fsck", "--no-dangling"]);
    return { path: relativePath || ".", head, status, fsck: "ok" };
  });
}

function compareGit(source, target) {
  const sourceByPath = new Map(source.map((entry) => [entry.path, entry]));
  const targetByPath = new Map(target.map((entry) => [entry.path, entry]));
  if (sourceByPath.size !== targetByPath.size) throw new Error("git repository count changed during migration");
  for (const [path, sourceEntry] of sourceByPath) {
    const targetEntry = targetByPath.get(path);
    if (!targetEntry || sourceEntry.head !== targetEntry.head || sourceEntry.status !== targetEntry.status || targetEntry.fsck !== "ok") {
      throw new Error(`git verification differs for ${path}`);
    }
  }
}

function registrySnapshot(registryPath, tenantId, tokenHash) {
  if (!existsSync(registryPath)) {
    return { exists: false, tableExists: false, compatible: true, tenant: null, tokenTenant: null };
  }

  const scratch = mkdtempSync(join(tmpdir(), "zenod-registry-snapshot-"));
  const scratchPath = join(scratch, basename(registryPath));
  copyFileSync(registryPath, scratchPath);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(`${registryPath}${suffix}`)) copyFileSync(`${registryPath}${suffix}`, `${scratchPath}${suffix}`);
  }
  let db = null;
  try {
    db = new DatabaseSync(scratchPath);
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tenants'").get();
    if (!table) return { exists: true, tableExists: false, compatible: true, tenant: null, tokenTenant: null };
    const columnInfo = db.prepare("PRAGMA table_info(tenants)").all();
    const columns = columnInfo.map((row) => String(row.name));
    const knownColumns = new Set([
      "tenant_id",
      "token_hash",
      "name",
      "status",
      "plan",
      "quota",
      "expires_at",
      "created_at",
      "updated_at",
    ]);
    const unsupportedRequiredColumns = columnInfo
      .filter((row) => Number(row.notnull) === 1 && row.dflt_value === null && Number(row.pk) === 0 && !knownColumns.has(String(row.name)))
      .map((row) => String(row.name));
    const uniqueColumns = new Set();
    const primaryKeyColumns = columnInfo.filter((row) => Number(row.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk));
    if (primaryKeyColumns.length === 1) uniqueColumns.add(String(primaryKeyColumns[0].name));
    for (const index of db.prepare("PRAGMA index_list(tenants)").all()) {
      if (Number(index.unique) !== 1) continue;
      const indexedColumns = db.prepare(`PRAGMA index_info(${JSON.stringify(String(index.name))})`).all();
      if (indexedColumns.length === 1) uniqueColumns.add(String(indexedColumns[0].name));
    }
    const compatible =
      columns.includes("tenant_id") &&
      columns.includes("token_hash") &&
      uniqueColumns.has("tenant_id") &&
      uniqueColumns.has("token_hash") &&
      unsupportedRequiredColumns.length === 0;
    if (!compatible) {
      return {
        exists: true,
        tableExists: true,
        compatible: false,
        columns,
        uniqueColumns: [...uniqueColumns].sort(),
        unsupportedRequiredColumns,
        tenant: null,
        tokenTenant: null,
      };
    }
    const tenant = db.prepare("SELECT tenant_id, token_hash FROM tenants WHERE tenant_id = ?").get(tenantId) ?? null;
    const tokenTenant = db.prepare("SELECT tenant_id, token_hash FROM tenants WHERE token_hash = ?").get(tokenHash) ?? null;
    return { exists: true, tableExists: true, compatible: true, columns, uniqueColumns: [...uniqueColumns].sort(), tenant, tokenTenant };
  } finally {
    db?.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

function assertRegistryCompatible(snapshot, tenantId, tokenHash) {
  if (!snapshot.compatible) {
    throw new Error(
      `tenants registry is incompatible; tenant_id and token_hash must both be unique and all required columns must be supported; ` +
        `columns=${snapshot.columns.join(",")}; unique=${snapshot.uniqueColumns.join(",")}; unsupported_required=${snapshot.unsupportedRequiredColumns.join(",")}`,
    );
  }
  if (snapshot.tenant && String(snapshot.tenant.token_hash) !== tokenHash) {
    throw new Error(`tenant ${tenantId} is already registered with a different token hash`);
  }
  if (snapshot.tokenTenant && String(snapshot.tokenTenant.tenant_id) !== tenantId) {
    throw new Error(`token hash is already registered to tenant ${snapshot.tokenTenant.tenant_id}`);
  }
}

function openRegistry(registryPath) {
  mkdirSync(dirname(registryPath), { recursive: true });
  const db = new DatabaseSync(registryPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 30000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      tenant_id TEXT PRIMARY KEY,
      name TEXT,
      plan TEXT,
      quota REAL,
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'deleted')),
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tenants_token_hash ON tenants (token_hash);
  `);
  const columns = db.prepare("PRAGMA table_info(tenants)").all().map((row) => String(row.name));
  if (!columns.includes("tenant_id") || !columns.includes("token_hash")) {
    db.close();
    throw new Error(`tenants registry is incompatible; required columns: tenant_id, token_hash; found: ${columns.join(", ")}`);
  }
  return db;
}

function insertRegistryTenant(registryPath, tenantId, tokenHash) {
  const db = openRegistry(registryPath);
  let inserted = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    const tenant = db.prepare("SELECT tenant_id, token_hash FROM tenants WHERE tenant_id = ?").get(tenantId);
    const tokenTenant = db.prepare("SELECT tenant_id, token_hash FROM tenants WHERE token_hash = ?").get(tokenHash);
    if (tenant && String(tenant.token_hash) !== tokenHash) {
      throw new Error(`tenant ${tenantId} is already registered with a different token hash`);
    }
    if (tokenTenant && String(tokenTenant.tenant_id) !== tenantId) {
      throw new Error(`token hash is already registered to tenant ${tokenTenant.tenant_id}`);
    }
    if (!tenant) {
      const availableColumns = new Set(db.prepare("PRAGMA table_info(tenants)").all().map((row) => String(row.name)));
      const now = Date.now();
      const values = new Map([
        ["tenant_id", tenantId],
        ["token_hash", tokenHash],
        ["name", tenantId],
        ["status", "active"],
        ["plan", null],
        ["quota", null],
        ["expires_at", null],
        ["created_at", now],
        ["updated_at", now],
      ]);
      const insertColumns = [...values.keys()].filter((column) => availableColumns.has(column));
      const placeholders = insertColumns.map(() => "?").join(", ");
      db.prepare(`INSERT INTO tenants (${insertColumns.join(", ")}) VALUES (${placeholders})`).run(
        ...insertColumns.map((column) => values.get(column)),
      );
      inserted = true;
    }
    db.exec("COMMIT");
    return inserted;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The transaction may not have started if schema validation failed.
    }
    throw error;
  } finally {
    db.close();
  }
}

function deleteRegistryTenant(registryPath, tenantId, tokenHash) {
  if (!existsSync(registryPath)) return false;
  const db = new DatabaseSync(registryPath);
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tenants'").get();
    if (!table) return false;
    const row = db.prepare("SELECT tenant_id, token_hash FROM tenants WHERE tenant_id = ?").get(tenantId);
    if (!row) return false;
    if (String(row.token_hash) !== tokenHash) {
      throw new Error(`refusing rollback: registry token hash changed for tenant ${tenantId}`);
    }
    db.prepare("DELETE FROM tenants WHERE tenant_id = ? AND token_hash = ?").run(tenantId, tokenHash);
    return true;
  } finally {
    db.close();
  }
}

function migrationPaths(options) {
  assertTenantId(options.tenantId);
  const source = resolve(options.source);
  const dataRoot = resolve(options.dataRoot);
  const target = resolve(dataRoot, options.tenantId);
  if (!isInside(dataRoot, target) || target === dataRoot) throw new Error("tenant target escaped the data root");
  assertDisjointPaths(source, target);
  const registry = resolve(
    options.registryPath ?? join(dataRoot, "chassis-tenants.sqlite"),
  );
  const receiptDir = resolve(options.receiptDir ?? join(dataRoot, "migration-receipts"));
  if (isInside(source, registry) || isInside(source, receiptDir)) {
    throw new Error("registry and receipt directory must be outside the legacy source");
  }
  if (isInside(target, registry) || isInside(target, receiptDir)) {
    throw new Error("registry and receipt directory must be outside the tenant target");
  }
  return { source, dataRoot, target, registry, receiptDir };
}

function planMigration(options) {
  const tokenHash = normalizeTokenHash(options.tokenHash);
  const paths = migrationPaths(options);
  const sourceManifest = buildManifest(paths.source);
  const sourceSqlite = verifySqlite(paths.source, sourceManifest);
  const sourceGit = verifyGit(paths.source, sourceManifest);
  const scrubbedSettings = legacyAuthSettings(paths.source);
  const registry = registrySnapshot(paths.registry, options.tenantId, tokenHash);
  assertRegistryCompatible(registry, options.tenantId, tokenHash);

  let target = null;
  if (existsSync(paths.target)) {
    const targetManifest = buildManifest(paths.target);
    assertMigratedManifest(sourceManifest, targetManifest, scrubbedSettings);
    if (legacyAuthSettings(paths.target).length > 0)
      throw new Error(`target still contains legacy auth settings: ${paths.target}`);
    target = { exists: true, manifestDigest: targetManifest.digest };
  } else {
    target = { exists: false, manifestDigest: null };
  }

  const actions = [];
  if (!target.exists) actions.push(`copy legacy volume to ${paths.target}`);
  else actions.push("reuse identical tenant target");
  if (scrubbedSettings.length > 0)
    actions.push(`scrub obsolete standalone auth settings: ${scrubbedSettings.join(", ")}`);
  if (!registry.tenant) actions.push(`insert token hash for tenant ${options.tenantId}`);
  else actions.push("reuse matching tenant registry row");
  actions.push("verify SHA-256 manifest, SQLite integrity, and git vault state");
  actions.push(`write apply receipt under ${paths.receiptDir}`);

  const plan = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    operation: "plan",
    mutation: false,
    tenantId: options.tenantId,
    tokenHash,
    paths,
    source: {
      manifestDigest: sourceManifest.digest,
      files: sourceManifest.files,
      directories: sourceManifest.directories,
      symlinks: sourceManifest.symlinks,
      bytes: sourceManifest.bytes,
      manifest: sourceManifest.entries,
      scrubbedSettings,
      sqlite: sourceSqlite,
      git: sourceGit,
    },
    target,
    registry,
    actions,
  };
  return { ...plan, planDigest: sha256(JSON.stringify(plan)) };
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeReceipt(receiptDir, tenantId, operation, runId, receipt) {
  mkdirSync(receiptDir, { recursive: true });
  const filename = `${timestampForFilename()}-${tenantId}-${runId}.${operation}.json`;
  const path = join(receiptDir, filename);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temporary, path);
  return path;
}

function verificationSummary(sourceManifest, targetManifest, scrubbedSettings, sourceSqlite, targetSqlite, sourceGit, targetGit, registry) {
  assertMigratedManifest(sourceManifest, targetManifest, scrubbedSettings);
  if (legacyAuthSettings(targetManifest.root).length > 0) {
    throw new Error("target retains obsolete standalone authentication secrets");
  }
  if (JSON.stringify(sourceSqlite) !== JSON.stringify(targetSqlite)) throw new Error("SQLite verification differs between source and target");
  compareGit(sourceGit, targetGit);
  return {
    checksums: "pass",
    sqliteIntegrity: "pass",
    gitVault: "pass",
    registry: registry.tenant ? "pass" : "fail",
  };
}

export function runMigration(options) {
  const mode = options.mode ?? "plan";
  if (mode === "plan") return planMigration(options);
  if (mode === "verify") return verifyMigration(options);
  if (mode !== "apply") throw new Error(`unsupported migration mode: ${mode}`);
  if (options.confirmSourceStopped !== true) {
    throw new Error("apply requires --confirm-source-stopped; stop the legacy container before copying its volume");
  }

  const plan = planMigration(options);
  if (!options.acceptPlan || options.acceptPlan !== plan.planDigest) {
    throw new Error(`apply requires --accept-plan ${plan.planDigest} from the current dry-run`);
  }
  const runId = randomUUID();
  const temporaryTarget = join(plan.paths.dataRoot, `.${options.tenantId}.migration-${runId}.tmp`);
  const registryExisted = existsSync(plan.paths.registry);
  let createdTarget = false;
  let insertedRegistry = false;

  try {
    mkdirSync(plan.paths.dataRoot, { recursive: true });
    if (!plan.target.exists) {
      if (existsSync(temporaryTarget)) throw new Error(`temporary migration target already exists: ${temporaryTarget}`);
      copyTree(plan.paths.source, temporaryTarget);
      const sourceAfterCopy = buildManifest(plan.paths.source);
      if (sourceAfterCopy.digest !== plan.source.manifestDigest) {
        throw new Error("legacy source changed while it was being copied; keep the source container stopped");
      }
      const temporaryManifest = buildManifest(temporaryTarget);
      if (temporaryManifest.digest !== plan.source.manifestDigest) throw new Error("temporary copy checksum verification failed");
      const scrubbed = scrubLegacyAuthSettings(temporaryTarget);
      if (JSON.stringify(scrubbed) !== JSON.stringify(plan.source.scrubbedSettings)) {
        throw new Error("legacy auth settings changed between plan and apply");
      }
      const migratedManifest = buildManifest(temporaryTarget);
      assertMigratedManifest(
        { digest: plan.source.manifestDigest, entries: plan.source.manifest },
        migratedManifest,
        plan.source.scrubbedSettings,
      );
      const temporarySqlite = verifySqlite(temporaryTarget, migratedManifest);
      const temporaryGit = verifyGit(temporaryTarget, migratedManifest);
      if (JSON.stringify(temporarySqlite) !== JSON.stringify(plan.source.sqlite)) throw new Error("temporary copy SQLite verification failed");
      compareGit(plan.source.git, temporaryGit);
      renameSync(temporaryTarget, plan.paths.target);
      createdTarget = true;
    }

    insertedRegistry = insertRegistryTenant(plan.paths.registry, options.tenantId, plan.tokenHash);
    const targetManifest = buildManifest(plan.paths.target);
    const targetSqlite = verifySqlite(plan.paths.target, targetManifest);
    const targetGit = verifyGit(plan.paths.target, targetManifest);
    const registry = registrySnapshot(plan.paths.registry, options.tenantId, plan.tokenHash);
    assertRegistryCompatible(registry, options.tenantId, plan.tokenHash);
    const verification = verificationSummary(
      { digest: plan.source.manifestDigest, entries: plan.source.manifest },
      targetManifest,
      plan.source.scrubbedSettings,
      plan.source.sqlite,
      targetSqlite,
      plan.source.git,
      targetGit,
      registry,
    );
    if (verification.registry !== "pass") throw new Error("tenant registry verification failed");

    const receipt = {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      operation: "apply",
      status: "success",
      runId,
      recordedAt: new Date().toISOString(),
      tenantId: options.tenantId,
      tokenHash: plan.tokenHash,
      paths: plan.paths,
      planDigest: plan.planDigest,
      acceptedPlanDigest: options.acceptPlan,
      idempotent: !createdTarget && !insertedRegistry,
      changes: { createdTarget, insertedRegistry, createdRegistry: !registryExisted },
      source: plan.source,
      target: { ...targetManifest, sqlite: targetSqlite, git: targetGit },
      registry,
      verification,
    };
    const receiptPath = writeReceipt(plan.paths.receiptDir, options.tenantId, "apply", runId, receipt);
    return { ...receipt, receiptPath };
  } catch (error) {
    if (existsSync(temporaryTarget)) rmSync(temporaryTarget, { recursive: true, force: true });
    if (insertedRegistry) {
      try {
        deleteRegistryTenant(plan.paths.registry, options.tenantId, plan.tokenHash);
      } catch {
        // Preserve the original failure; the operator can inspect the registry manually.
      }
    }
    if (createdTarget && existsSync(plan.paths.target)) rmSync(plan.paths.target, { recursive: true, force: true });
    throw error;
  }
}

export function verifyMigration(options) {
  const plan = planMigration(options);
  if (!plan.target.exists) throw new Error(`tenant target does not exist: ${plan.paths.target}`);
  if (!plan.registry.tenant) throw new Error(`tenant ${options.tenantId} is not present in the registry`);
  const targetManifest = buildManifest(plan.paths.target);
  const targetSqlite = verifySqlite(plan.paths.target, targetManifest);
  const targetGit = verifyGit(plan.paths.target, targetManifest);
  const verification = verificationSummary(
    { digest: plan.source.manifestDigest, entries: plan.source.manifest },
    targetManifest,
    plan.source.scrubbedSettings,
    plan.source.sqlite,
    targetSqlite,
    plan.source.git,
    targetGit,
    plan.registry,
  );
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    operation: "verify",
    mutation: false,
    tenantId: options.tenantId,
    tokenHash: plan.tokenHash,
    paths: plan.paths,
    planDigest: plan.planDigest,
    target: { manifestDigest: targetManifest.digest, sqlite: targetSqlite, git: targetGit },
    registry: plan.registry,
    verification,
  };
}

export function rollbackMigration(receiptPath) {
  const absoluteReceiptPath = resolve(receiptPath);
  const receipt = JSON.parse(readFileSync(absoluteReceiptPath, "utf8"));
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION || receipt.operation !== "apply" || receipt.status !== "success") {
    throw new Error("rollback requires a successful Z-MT-4 apply receipt");
  }
  assertTenantId(receipt.tenantId);
  const tokenHash = normalizeTokenHash(receipt.tokenHash);
  const dataRoot = resolve(receipt.paths.dataRoot);
  const target = resolve(receipt.paths.target);
  const registry = resolve(receipt.paths.registry);
  const receiptDir = resolve(receipt.paths.receiptDir);
  if (!isInside(dataRoot, target) || target === dataRoot) throw new Error("refusing rollback: receipt target escapes data root");

  let targetRemoved = false;
  let registryRowRemoved = false;
  if (receipt.changes.createdTarget && existsSync(target)) {
    const currentManifest = buildManifest(target);
    if (currentManifest.digest !== receipt.target.digest) {
      throw new Error("refusing rollback: tenant target changed after migration");
    }
  }
  if (receipt.changes.insertedRegistry) {
    const snapshot = registrySnapshot(registry, receipt.tenantId, tokenHash);
    assertRegistryCompatible(snapshot, receipt.tenantId, tokenHash);
    registryRowRemoved = deleteRegistryTenant(registry, receipt.tenantId, tokenHash);
  }
  if (receipt.changes.createdTarget && existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    targetRemoved = true;
  }

  const runId = randomUUID();
  const rollbackReceipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    operation: "rollback",
    status: "success",
    runId,
    recordedAt: new Date().toISOString(),
    applyReceipt: absoluteReceiptPath,
    applyRunId: receipt.runId,
    tenantId: receipt.tenantId,
    tokenHash,
    paths: receipt.paths,
    idempotent: !targetRemoved && !registryRowRemoved,
    changes: { targetRemoved, registryRowRemoved },
    verification: {
      targetAbsent: receipt.changes.createdTarget ? !existsSync(target) : "not-owned-by-apply-receipt",
      registryRowAbsent: receipt.changes.insertedRegistry
        ? !registrySnapshot(registry, receipt.tenantId, tokenHash).tenant
        : "not-owned-by-apply-receipt",
    },
  };
  const rollbackReceiptPath = writeReceipt(receiptDir, receipt.tenantId, "rollback", runId, rollbackReceipt);
  return { ...rollbackReceipt, receiptPath: rollbackReceiptPath };
}

function usage() {
  return `Usage:
  node scripts/migrate-zenod-volume.mjs --source <legacy-volume> --data-root <new-data-root> --tenant <id> --token-hash <sha256>
  node scripts/migrate-zenod-volume.mjs --apply --confirm-source-stopped --accept-plan <plan-digest> --source <legacy-volume> --data-root <new-data-root> --tenant <id> --token-hash <sha256>
  node scripts/migrate-zenod-volume.mjs --verify --source <legacy-volume> --data-root <new-data-root> --tenant <id> --token-hash <sha256>
  node scripts/migrate-zenod-volume.mjs --rollback <apply-receipt.json>

Default mode is a read-only dry run. The utility never accepts a raw token.
Optional: --registry <path> --receipt-dir <path>`;
}

function parseArguments(argv) {
  const options = { mode: "plan" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${argument} requires a value`);
      index += 1;
      return next;
    };
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--apply") options.mode = "apply";
    else if (argument === "--verify") options.mode = "verify";
    else if (argument === "--confirm-source-stopped") options.confirmSourceStopped = true;
    else if (argument === "--accept-plan") options.acceptPlan = value();
    else if (argument === "--source") options.source = value();
    else if (argument === "--data-root") options.dataRoot = value();
    else if (argument === "--tenant") options.tenantId = value();
    else if (argument === "--token-hash") options.tokenHash = value();
    else if (argument === "--registry") options.registryPath = value();
    else if (argument === "--receipt-dir") options.receiptDir = value();
    else if (argument === "--rollback") options.rollbackReceipt = value();
    else if (argument === "--token") throw new Error("raw tokens are forbidden; pass only --token-hash");
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (options.rollbackReceipt) return options;
  for (const field of ["source", "dataRoot", "tenantId", "tokenHash"]) {
    if (!options[field]) throw new Error(`missing required option: ${field}`);
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArguments(argv);
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    const result = options.rollbackReceipt ? rollbackMigration(options.rollbackReceipt) : runMigration(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "error", message: error instanceof Error ? error.message : String(error) })}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
