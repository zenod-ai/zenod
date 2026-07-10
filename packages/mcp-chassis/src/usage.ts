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
  used: number;
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
      CREATE INDEX IF NOT EXISTS idx_tenant_usage_tenant_kind_ts ON tenant_usage (tenant_id, kind, ts);
    `);
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
    const result = this.db
      .prepare("INSERT INTO tenant_usage (tenant_id, ts, kind, units, metadata_json) VALUES (?, ?, ?, ?, ?)")
      .run(tenantId, ts, kind, units, metadataJson);
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
    const used = this.summary(tenant).units;
    if (normalizedQuota === null) {
      return { allowed: true, quota: null, used, requested, remaining: null };
    }
    const remaining = Math.max(normalizedQuota - used, 0);
    return {
      allowed: remaining >= requested,
      quota: normalizedQuota,
      used,
      requested,
      remaining,
    };
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
