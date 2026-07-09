import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DATA_DIR = "/data";
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const TENANT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const PATH_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export interface UnitTenant {
  /** Trusted tenant identity resolved by chassis auth, never from a tool argument. */
  id: string;
}

export interface ChassisStorageOptions {
  /** Unit data root. Hosted containers use /data; tests may pass a temp dir. */
  dataDir?: string;
  /** SQLite busy timeout applied to every chassis-opened database handle. */
  busyTimeoutMs?: number;
}

export interface TenantStorage {
  readonly tenant: UnitTenant;
  readonly rootDir: string;
  dir(path?: string): string;
  db(name?: string): DatabaseSync;
  vault(name?: string): TenantVault;
}

export class ChassisStorage {
  readonly dataDir: string;
  readonly busyTimeoutMs: number;

  constructor(options: ChassisStorageOptions = {}) {
    this.dataDir = resolve(options.dataDir ?? process.env.DATA_DIR ?? DEFAULT_DATA_DIR);
    this.busyTimeoutMs = normalizeBusyTimeout(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS);
  }

  forTenant(tenant: UnitTenant): TenantStorage {
    const tenantId = normalizeTenantId(tenant.id);
    const rootDir = resolve(this.dataDir, tenantId);
    ensureContained(this.dataDir, rootDir);
    mkdirSync(rootDir, { recursive: true });
    return new TenantStorageHandle({ id: tenantId }, rootDir, this.busyTimeoutMs);
  }
}

export class TenantVault {
  private readonly db: DatabaseSync;

  constructor(
    db: DatabaseSync,
    private readonly tenantId: string,
  ) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vault_entries (
        tenant_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_vault_entries_tenant ON vault_entries (tenant_id, key);
    `);
  }

  set(key: string, value: string): void {
    const safeKey = normalizeVaultKey(key);
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO vault_entries (tenant_id, key, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(this.tenantId, safeKey, value, now, now);
  }

  get(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM vault_entries WHERE tenant_id = ? AND key = ?")
      .get(this.tenantId, normalizeVaultKey(key)) as { value: string } | undefined;
    return row?.value ?? null;
  }

  delete(key: string): number {
    const result = this.db
      .prepare("DELETE FROM vault_entries WHERE tenant_id = ? AND key = ?")
      .run(this.tenantId, normalizeVaultKey(key));
    return Number(result.changes);
  }

  listKeys(): string[] {
    const rows = this.db
      .prepare("SELECT key FROM vault_entries WHERE tenant_id = ? ORDER BY key")
      .all(this.tenantId) as Array<{ key: string }>;
    return rows.map((row) => row.key);
  }

  close(): void {
    this.db.close();
  }
}

class TenantStorageHandle implements TenantStorage {
  constructor(
    readonly tenant: UnitTenant,
    readonly rootDir: string,
    private readonly busyTimeoutMs: number,
  ) {}

  dir(path = "."): string {
    const target = safeTenantPath(this.rootDir, path);
    mkdirSync(target, { recursive: true });
    return target;
  }

  db(name = "unit.sqlite"): DatabaseSync {
    const target = safeTenantPath(this.rootDir, name);
    mkdirSync(dirname(target), { recursive: true });
    return openSqlite(target, this.busyTimeoutMs);
  }

  vault(name = "vault.sqlite"): TenantVault {
    return new TenantVault(this.db(name), this.tenant.id);
  }
}

export function openSqlite(path: string, busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const timeout = normalizeBusyTimeout(busyTimeoutMs);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = ${timeout};
  `);
  return db;
}

function normalizeTenantId(id: string): string {
  const trimmed = id.trim();
  if (!TENANT_ID_RE.test(trimmed)) {
    throw new Error("tenant id must be 1-128 chars of A-Z, a-z, 0-9, _, ., or - and cannot start with punctuation");
  }
  return trimmed;
}

function normalizeBusyTimeout(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("busyTimeoutMs must be a non-negative finite number");
  return Math.trunc(value);
}

function normalizeVaultKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed || trimmed.length > 256) throw new Error("vault key must be 1-256 non-whitespace characters");
  return trimmed;
}

function safeTenantPath(rootDir: string, requested: string): string {
  if (isAbsolute(requested)) throw new Error("tenant storage paths must be relative");
  const parts = requested.split(/[\\/]+/).filter((part) => part.length > 0 && part !== ".");
  if (parts.some((part) => part === ".." || !PATH_SEGMENT_RE.test(part))) {
    throw new Error("tenant storage path contains an unsafe segment");
  }
  const target = resolve(rootDir, ...parts);
  ensureContained(rootDir, target);
  return target;
}

function ensureContained(rootDir: string, target: string): void {
  const rel = relative(rootDir, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("tenant storage path escaped data root");
  }
}
