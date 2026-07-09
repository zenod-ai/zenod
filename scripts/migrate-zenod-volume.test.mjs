import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { buildManifest, rollbackMigration, runMigration } from "./migrate-zenod-volume.mjs";

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(repository, args) {
  const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function createSqlite(path, marker) {
  mkdirSync(join(path, ".."), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE evidence (marker TEXT NOT NULL)");
  db.prepare("INSERT INTO evidence (marker) VALUES (?)").run(marker);
  db.close();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "zenod-zmt4-"));
  temporaryRoots.push(root);
  const source = join(root, "legacy-volume");
  const dataRoot = join(root, "new-data");
  const receiptDir = join(root, "receipts");
  mkdirSync(source, { recursive: true });
  createSqlite(join(source, "zenod.sqlite"), "settings");
  createSqlite(join(source, "oauth.sqlite"), "oauth");
  createSqlite(join(source, "ingest.sqlite"), "ingest");
  createSqlite(join(source, "tasks.sqlite"), "tasks");
  createSqlite(join(source, "execution.sqlite"), "execution");
  createSqlite(join(source, "journeys.sqlite"), "journeys");
  createSqlite(join(source, "usage.sqlite"), "usage");
  createSqlite(join(source, "notifications.sqlite"), "notifications");
  createSqlite(join(source, "whatsapp", "whatsapp.sqlite"), "whatsapp");
  mkdirSync(join(source, "transcripts", "run-1"), { recursive: true });
  writeFileSync(join(source, "transcripts", "run-1", "events.jsonl"), '{"type":"done"}\n');
  mkdirSync(join(source, "artifacts", "2026", "07"), { recursive: true });
  writeFileSync(join(source, "artifacts", "2026", "07", "evidence.txt"), "evidence bytes\n");
  mkdirSync(join(source, "integrations"), { recursive: true });
  writeFileSync(join(source, "integrations", "drive.json"), '{"folder":"fixture"}\n');

  const vault = join(source, "vault");
  mkdirSync(vault, { recursive: true });
  git(vault, ["init", "-b", "main"]);
  git(vault, ["config", "user.email", "migration-test@zenod.dev"]);
  git(vault, ["config", "user.name", "Migration Test"]);
  writeFileSync(join(vault, "Memory.md"), "# Durable memory\n");
  git(vault, ["add", "Memory.md"]);
  git(vault, ["commit", "-m", "seed vault"]);
  writeFileSync(join(vault, "Untracked.md"), "preserve working tree status\n");

  const tokenHash = createHash("sha256").update("legacy-token-never-passed-to-tool").digest("hex");
  return { root, source, dataRoot, receiptDir, tenantId: "tenant-fixture", tokenHash };
}

function options(value, mode = "plan") {
  return {
    mode,
    source: value.source,
    dataRoot: value.dataRoot,
    tenantId: value.tenantId,
    tokenHash: value.tokenHash,
    receiptDir: value.receiptDir,
    confirmSourceStopped: mode === "apply",
  };
}

function applyOptions(value) {
  const plan = runMigration(options(value));
  return { ...options(value, "apply"), acceptPlan: plan.planDigest };
}

test("dry-run verifies the source and reports changes without mutation", () => {
  const value = fixture();
  const sourceBefore = buildManifest(value.source);
  const result = runMigration(options(value));

  assert.equal(result.operation, "plan");
  assert.equal(result.mutation, false);
  assert.equal(result.source.sqlite.length, 9);
  assert.equal(result.source.git.length, 1);
  assert.equal(result.source.git[0].status, "?? Untracked.md");
  assert.equal(existsSync(value.dataRoot), false);
  assert.equal(existsSync(value.receiptDir), false);
  assert.deepEqual(buildManifest(value.source), sourceBefore);
});

test("apply copies all state, inserts only the token hash, verifies evidence, and is idempotent", () => {
  const value = fixture();
  const first = runMigration(applyOptions(value));
  const target = join(value.dataRoot, value.tenantId);

  assert.equal(first.status, "success");
  assert.equal(first.idempotent, false);
  assert.deepEqual(first.verification, {
    checksums: "pass",
    sqliteIntegrity: "pass",
    gitVault: "pass",
    registry: "pass",
  });
  assert.equal(buildManifest(target).digest, buildManifest(value.source).digest);
  assert.equal(readFileSync(join(target, "artifacts", "2026", "07", "evidence.txt"), "utf8"), "evidence bytes\n");
  assert.equal(existsSync(first.receiptPath), true);

  const registry = new DatabaseSync(join(value.dataRoot, "chassis.sqlite"), { readOnly: true });
  const rows = registry.prepare("SELECT tenant_id, token_hash FROM tenants").all();
  registry.close();
  assert.deepEqual(rows.map((row) => ({ ...row })), [{ tenant_id: value.tenantId, token_hash: value.tokenHash }]);
  assert.equal(readFileSync(first.receiptPath, "utf8").includes("legacy-token-never-passed-to-tool"), false);

  const second = runMigration(applyOptions(value));
  assert.equal(second.idempotent, true);
  assert.deepEqual(second.changes, { createdTarget: false, insertedRegistry: false, createdRegistry: false });
  const verified = runMigration(options(value, "verify"));
  assert.equal(verified.verification.registry, "pass");

  const dataBeforePlan = buildManifest(value.dataRoot);
  runMigration(options(value));
  assert.deepEqual(buildManifest(value.dataRoot), dataBeforePlan);
});

test("apply rejects conflicting target content without overwriting it", () => {
  const value = fixture();
  const target = join(value.dataRoot, value.tenantId);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "foreign.txt"), "do not overwrite\n");

  assert.throws(() => runMigration({ ...options(value, "apply"), acceptPlan: "stale-plan" }), /target already exists with different content/);
  assert.equal(readFileSync(join(target, "foreign.txt"), "utf8"), "do not overwrite\n");
  assert.equal(existsSync(join(value.dataRoot, "chassis.sqlite")), false);
});

test("rollback removes only state owned by the apply receipt and is repeatable", () => {
  const value = fixture();
  const applied = runMigration(applyOptions(value));
  const first = rollbackMigration(applied.receiptPath);

  assert.equal(first.status, "success");
  assert.deepEqual(first.changes, { targetRemoved: true, registryRowRemoved: true });
  assert.equal(existsSync(join(value.dataRoot, value.tenantId)), false);
  assert.equal(existsSync(first.receiptPath), true);

  const second = rollbackMigration(applied.receiptPath);
  assert.equal(second.idempotent, true);
  assert.deepEqual(second.changes, { targetRemoved: false, registryRowRemoved: false });
});

test("rollback refuses to remove a tenant target changed after migration", () => {
  const value = fixture();
  const applied = runMigration(applyOptions(value));
  const target = join(value.dataRoot, value.tenantId);
  writeFileSync(join(target, "post-migration.txt"), "new state\n");

  assert.throws(() => rollbackMigration(applied.receiptPath), /target changed after migration/);
  assert.equal(existsSync(target), true);
  const registry = new DatabaseSync(join(value.dataRoot, "chassis.sqlite"), { readOnly: true });
  assert.equal(registry.prepare("SELECT COUNT(*) AS count FROM tenants").get().count, 1);
  registry.close();
});

test("the same token hash cannot be registered to a second tenant", () => {
  const value = fixture();
  runMigration(applyOptions(value));
  const second = { ...value, tenantId: "tenant-other" };

  assert.throws(() => runMigration(options(second)), /token hash is already registered/);
  assert.equal(existsSync(join(value.dataRoot, second.tenantId)), false);
});

test("a symlink escaping the legacy volume is rejected before mutation", () => {
  const value = fixture();
  symlinkSync("../outside", join(value.source, "escaped-link"));

  assert.throws(() => runMigration(options(value)), /symlink escapes the tenant volume/);
  assert.equal(existsSync(value.dataRoot), false);
});

test("apply rejects a stale or missing dry-run digest", () => {
  const value = fixture();
  assert.throws(() => runMigration(options(value, "apply")), /apply requires --accept-plan/);
  assert.throws(() => runMigration({ ...options(value, "apply"), acceptPlan: "stale" }), /apply requires --accept-plan/);
  assert.equal(existsSync(value.dataRoot), false);
});

test("apply supports the chassis-spec registry without the optional name column", () => {
  const value = fixture();
  mkdirSync(value.dataRoot, { recursive: true });
  const registry = new DatabaseSync(join(value.dataRoot, "chassis.sqlite"));
  registry.exec(`
    CREATE TABLE tenants (
      token_hash TEXT NOT NULL UNIQUE,
      tenant_id TEXT PRIMARY KEY,
      plan TEXT,
      quota INTEGER,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  registry.close();

  const applied = runMigration(applyOptions(value));
  assert.equal(applied.verification.registry, "pass");
  assert.equal(applied.registry.columns.includes("name"), false);
});

test("corrupt SQLite fails integrity preflight before target or registry mutation", () => {
  const value = fixture();
  truncateSync(join(value.source, "zenod.sqlite"), 100);

  assert.throws(() => runMigration(options(value)), /malformed|database|SQLite/i);
  assert.equal(existsSync(value.dataRoot), false);
  assert.equal(existsSync(value.receiptDir), false);
});

test("registry and receipts cannot mutate the legacy source tree", () => {
  const value = fixture();
  assert.throws(
    () => runMigration({ ...options(value), receiptDir: join(value.source, "receipts") }),
    /outside the legacy source/,
  );
  assert.throws(
    () => runMigration({ ...options(value), registryPath: join(value.source, "chassis.sqlite") }),
    /outside the legacy source/,
  );
});
