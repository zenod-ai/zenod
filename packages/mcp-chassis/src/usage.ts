import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { UnitTenant } from "./storage.js";

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const DEFAULT_USAGE_DB_NAME = "usage.sqlite";
const DEFAULT_REQUEST_KIND = "mcp.request";
const EVENT_KIND_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export interface ChassisUsageStoreOptions {
  /** Unit data root. Usage rows live in a chassis-owned database under this root. */
  dataDir?: string;
  /** Usage database filename under dataDir. */
  filename?: string;
  /** SQLite busy timeout applied to the usage ledger. */
  busyTimeoutMs?: number;
}

export interface UsageRecordInput {
  tenant: UnitTenant;
  kind?: string;
  units?: number;
  at?: number;
  metadata?: Record<string, unknown> | null;
}

export interface UsageEvent {
  id: number;
  tenantId: string;
  ts: number;
  kind: string;
  units: number;
  metadata: Record<string, unknown> | null;
}

export interface UsageBucket {
  kind: string;
  events: number;
  units: number;
}

export interface TenantUsageSummary {
  tenantId: string;
  since: number;
  events: number;
  units: number;
  byKind: UsageBucket[];
}

export interface UsageQuery {
  since?: number;
  kind?: string;
  limit?: number;
}

export interface QuotaDecision {
  allowed: boolean;
  quota: number | null;
  /** Total units used; null when no quota applies (usage is not computed on the hot path). */
  used: number | null;
  requested: number;
  remaining: number | null;
}

export class ChassisUsageStore {
  private readonly db: DatabaseSync;

  constructor(options: ChassisUsageStoreOptions = {}) {
    const dataDir = resolve(options.dataDir ?? process.env.DATA_DIR ?? "/data");
    const filename = options.filename?.trim() || DEFAULT_USAGE_DB_NAME;
    if (filename.includes("/") || filename.includes("\\")) throw new Error("usage filename must be a single path segment");
    const path = join(dataDir, filename);
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    const timeout = normalizeBusyTimeout(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = ${timeout};
      CREATE TABLE IF NOT EXISTS tenant_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        units INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tenant_usage_tenant_ts ON tenant_usage (tenant_id, ts);
      CREATE TABLE IF NOT EXISTS tenant_usage_totals (
        tenant_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        events INTEGER NOT NULL DEFAULT 0,
        units INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (tenant_id, kind)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS usage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
    `);
    this.migrateCoveringIndexAndTotals();
  }

  /**
   * One-time, idempotent migration for ledgers that predate the running totals.
   * Builds a covering (tenant, kind, ts, units) index (replacing the old non-covering
   * kind index) and backfills tenant_usage_totals in a single GROUP BY pass, inside one
   * IMMEDIATE transaction so no writer can slip a row between the scan and the flag.
   */
  private migrateCoveringIndexAndTotals(): void {
    const done = this.db.prepare("SELECT value FROM usage_meta WHERE key = 'totals_backfilled'").get();
    if (done) {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_tenant_usage_covering ON tenant_usage (tenant_id, kind, ts, units);");
      return;
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tenant_usage_covering ON tenant_usage (tenant_id, kind, ts, units);
        DROP INDEX IF EXISTS idx_tenant_usage_tenant_kind_ts;
        DELETE FROM tenant_usage_totals;
        INSERT INTO tenant_usage_totals (tenant_id, kind, events, units)
          SELECT tenant_id, kind, COUNT(*), COALESCE(SUM(units), 0) FROM tenant_usage GROUP BY tenant_id, kind;
        INSERT OR REPLACE INTO usage_meta (key, value) VALUES ('totals_backfilled', '1');
      `);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  forTenant(tenant: UnitTenant): TenantUsageMeter {
    return new TenantUsageMeter(this, tenant);
  }

  record(input: UsageRecordInput): UsageEvent {
    const tenantId = normalizeTenantId(input.tenant.id);
    const kind = normalizeKind(input.kind ?? DEFAULT_REQUEST_KIND);
    const units = normalizeUnits(input.units ?? 1);
    const ts = normalizeTimestamp(input.at ?? Date.now());
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
    let result: { lastInsertRowid: number | bigint };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      result = this.db
        .prepare("INSERT INTO tenant_usage (tenant_id, ts, kind, units, metadata_json) VALUES (?, ?, ?, ?, ?)")
        .run(tenantId, ts, kind, units, metadataJson);
      this.db
        .prepare(
          `INSERT INTO tenant_usage_totals (tenant_id, kind, events, units) VALUES (?, ?, 1, ?)
           ON CONFLICT (tenant_id, kind) DO UPDATE SET events = events + 1, units = units + excluded.units`,
        )
        .run(tenantId, kind, units);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return {
      id: Number(result.lastInsertRowid),
      tenantId,
      ts,
      kind,
      units,
      metadata: input.metadata ?? null,
    };
  }

  summary(tenant: UnitTenant, query: Pick<UsageQuery, "since" | "kind"> = {}): TenantUsageSummary {
    const tenantId = normalizeTenantId(tenant.id);
    const since = normalizeTimestamp(query.since ?? 0);
    const clauses = ["tenant_id = ?", "ts >= ?"];
    const params: Array<string | number> = [tenantId, since];
    if (query.kind) {
      clauses.push("kind = ?");
      params.push(normalizeKind(query.kind));
    }
    if (!query.kind && since === 0) {
      // All-time summary is served from the maintained running totals: O(kinds), not O(rows).
      const buckets = this.db
        .prepare("SELECT kind, events, units FROM tenant_usage_totals WHERE tenant_id = ? ORDER BY kind")
        .all(tenantId) as unknown as UsageBucket[];
      return {
        tenantId,
        since,
        events: buckets.reduce((sum, b) => sum + b.events, 0),
        units: buckets.reduce((sum, b) => sum + b.units, 0),
        byKind: buckets,
      };
    }
    const where = clauses.join(" AND ");
    const totals = this.db
      .prepare(`SELECT COUNT(*) AS events, COALESCE(SUM(units), 0) AS units FROM tenant_usage WHERE ${where}`)
      .get(...params) as { events: number; units: number };
    const buckets = this.db
      .prepare(
        `SELECT kind, COUNT(*) AS events, COALESCE(SUM(units), 0) AS units
         FROM tenant_usage
         WHERE ${where}
         GROUP BY kind
         ORDER BY kind`,
      )
      .all(...params) as unknown as UsageBucket[];
    return {
      tenantId,
      since,
      events: totals.events,
      units: totals.units,
      byKind: buckets,
    };
  }

  timeline(tenant: UnitTenant, query: UsageQuery = {}): UsageEvent[] {
    const tenantId = normalizeTenantId(tenant.id);
    const since = normalizeTimestamp(query.since ?? 0);
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 2_000);
    const clauses = ["tenant_id = ?", "ts >= ?"];
    const params: Array<string | number> = [tenantId, since];
    if (query.kind) {
      clauses.push("kind = ?");
      params.push(normalizeKind(query.kind));
    }
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT id, tenant_id, ts, kind, units, metadata_json
         FROM tenant_usage
         WHERE ${clauses.join(" AND ")}
         ORDER BY ts DESC, id DESC
         LIMIT ?`,
      )
      .all(...params) as Array<{
      id: number;
      tenant_id: string;
      ts: number;
      kind: string;
      units: number;
      metadata_json: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      ts: row.ts,
      kind: row.kind,
      units: row.units,
      metadata: parseMetadata(row.metadata_json),
    }));
  }

  checkQuota(tenant: UnitTenant, quota: number | null | undefined, requestedUnits = 1): QuotaDecision {
    const requested = normalizeUnits(requestedUnits);
    const normalizedQuota = normalizeQuota(quota);
    if (normalizedQuota === null) {
      // No quota: nothing to enforce, so do not touch the ledger at all.
      return { allowed: true, quota: null, used: null, requested, remaining: null };
    }
    const used = this.totalUnits(tenant);
    const remaining = Math.max(normalizedQuota - used, 0);
    return {
      allowed: remaining >= requested,
      quota: normalizedQuota,
      used,
      requested,
      remaining,
    };
  }

  /** All-time units for a tenant from the running totals (O(kinds)). */
  private totalUnits(tenant: UnitTenant): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(units), 0) AS units FROM tenant_usage_totals WHERE tenant_id = ?")
      .get(normalizeTenantId(tenant.id)) as { units: number };
    return row.units;
  }

  close(): void {
    this.db.close();
  }
}

export class TenantUsageMeter {
  constructor(
    private readonly store: ChassisUsageStore,
    readonly tenant: UnitTenant,
  ) {}

  record(input: Omit<UsageRecordInput, "tenant"> = {}): UsageEvent {
    return this.store.record({ tenant: this.tenant, ...input });
  }

  summary(query: Pick<UsageQuery, "since" | "kind"> = {}): TenantUsageSummary {
    return this.store.summary(this.tenant, query);
  }

  timeline(query: UsageQuery = {}): UsageEvent[] {
    return this.store.timeline(this.tenant, query);
  }

  checkQuota(quota: number | null | undefined, requestedUnits = 1): QuotaDecision {
    return this.store.checkQuota(this.tenant, quota, requestedUnits);
  }
}

function normalizeTenantId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) throw new Error("tenant id is required for usage metering");
  return trimmed;
}

function normalizeKind(kind: string): string {
  const trimmed = kind.trim();
  if (!EVENT_KIND_RE.test(trimmed)) {
    throw new Error("usage kind must be 1-128 chars of A-Z, a-z, 0-9, _, ., :, or - and cannot start with punctuation");
  }
  return trimmed;
}

function normalizeUnits(units: number): number {
  if (!Number.isInteger(units) || units <= 0) throw new Error("usage units must be a positive integer");
  return units;
}

function normalizeTimestamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("usage timestamp must be a non-negative finite number");
  return Math.trunc(value);
}

function normalizeQuota(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) throw new Error("tenant quota must be a non-negative finite number");
  return Math.trunc(value);
}

function normalizeBusyTimeout(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("busyTimeoutMs must be a non-negative finite number");
  return Math.trunc(value);
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
}
