import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { UnitTenant } from "./storage.js";

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const DEFAULT_USAGE_DB_NAME = "usage.sqlite";
const DEFAULT_REQUEST_KIND = "mcp.request";
const BACKFILL_CHUNK_ROWS = 50_000;
const DAY_MS = 86_400_000;
const DEFAULT_PRUNE_BATCH_ROWS = 1_000;
const DEFAULT_PRUNE_INTERVAL_MS = 3_600_000;
const DEFAULT_PRUNE_FIRST_RUN_DELAY_MS = 60_000;
const INCREMENTAL_VACUUM_PAGES = 1_000;
const EVENT_KIND_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export interface ChassisUsageStoreOptions {
  /** Unit data root. Usage rows live in a chassis-owned database under this root. */
  dataDir?: string;
  /** Usage database filename under dataDir. */
  filename?: string;
  /** SQLite busy timeout applied to the usage ledger. */
  busyTimeoutMs?: number;
  /**
   * Retention window in days for raw usage rows. Older rows are rolled into tenant_usage_daily
   * and deleted in small batches. Defaults to env USAGE_RETENTION_DAYS; unset/0 DISABLES
   * rollup+prune entirely (deleting data is an explicit opt-in).
   */
  retentionDays?: number;
  /** Rows per prune transaction (default 1000). */
  pruneBatchRows?: number;
  /** How often the background prune runs (default 1h). */
  pruneIntervalMs?: number;
  /** Delay before the first background prune after boot (default 60s). */
  pruneFirstRunDelayMs?: number;
  /** Operational notices (default console.warn). */
  onNotice?: (message: string) => void;
  /** Clock override for tests. */
  now?: () => number;
}

export interface PruneResult {
  /** Raw rows rolled into tenant_usage_daily and deleted. */
  rowsPruned: number;
  batches: number;
  /** Slowest single batch transaction, ms. */
  maxBatchMs: number;
  /** 95th percentile batch transaction time, ms. */
  p95BatchMs: number;
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
  private readonly retentionMs: number | null;
  private readonly pruneBatchRows: number;
  private readonly now: () => number;
  private readonly notice: (message: string) => void;
  private pruneTimer: ReturnType<typeof setTimeout> | null = null;
  private pruning = false;
  private closed = false;
  private warnedNoIncrementalVacuum = false;

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
      PRAGMA synchronous = NORMAL;
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
    this.now = options.now ?? Date.now;
    this.notice = options.onNotice ?? ((message) => console.warn(`[usage] ${message}`));
    this.pruneBatchRows = Math.max(1, Math.trunc(options.pruneBatchRows ?? DEFAULT_PRUNE_BATCH_ROWS));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tenant_usage_daily (
        tenant_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        kind TEXT NOT NULL,
        events INTEGER NOT NULL DEFAULT 0,
        units INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (tenant_id, day, kind)
      ) WITHOUT ROWID;
    `);
    this.migrateCoveringIndexAndTotals();
    const retentionDays = resolveRetentionDays(options.retentionDays, this.notice);
    this.retentionMs = retentionDays === null ? null : retentionDays * DAY_MS;
    if (this.retentionMs !== null) {
      // Global ts index so the prune scan is O(batch), not O(table). Only built when retention is on.
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_tenant_usage_ts ON tenant_usage (ts);");
      this.scheduleBackgroundPrune(
        options.pruneFirstRunDelayMs ?? DEFAULT_PRUNE_FIRST_RUN_DELAY_MS,
        options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS,
      );
    }
  }

  get retentionEnabled(): boolean {
    return this.retentionMs !== null;
  }

  private scheduleBackgroundPrune(firstDelayMs: number, intervalMs: number): void {
    const tick = (): void => {
      void this.pruneOnce()
        .catch((error) => this.notice(`prune failed: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => {
          if (this.closed) return;
          this.pruneTimer = setTimeout(tick, intervalMs);
          this.pruneTimer.unref();
        });
    };
    this.pruneTimer = setTimeout(tick, firstDelayMs);
    this.pruneTimer.unref();
  }

  /**
   * Roll raw rows older than the retention window into tenant_usage_daily and delete them, in
   * batches of at most `pruneBatchRows`, yielding to the event loop (setImmediate) between batches.
   * The cutoff is aligned down to a UTC day boundary, so only complete days are rolled up. Only rows
   * with id <= the totals watermark are ever touched (totals already include them), and
   * tenant_usage_totals is never modified: it stays the all-time figure. No-op when retention is off.
   */
  async pruneOnce(): Promise<PruneResult> {
    const result: PruneResult = { rowsPruned: 0, batches: 0, maxBatchMs: 0, p95BatchMs: 0 };
    const durations: number[] = [];
    if (this.retentionMs === null || this.pruning || this.closed) return result;
    this.pruning = true;
    try {
      const cutoffTs = Math.floor((this.now() - this.retentionMs) / DAY_MS) * DAY_MS;
      for (;;) {
        if (this.closed) break;
        const started = performance.now();
        const pruned = this.pruneBatch(cutoffTs);
        const elapsed = performance.now() - started;
        if (pruned === 0) break;
        result.rowsPruned += pruned;
        result.batches += 1;
        result.maxBatchMs = Math.max(result.maxBatchMs, elapsed);
        durations.push(elapsed);
        this.reclaimSpace();
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } finally {
      this.pruning = false;
    }
    durations.sort((x, y) => x - y);
    result.p95BatchMs = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] ?? 0;
    return result;
  }

  /** One bounded prune transaction. Returns the number of raw rows moved into the daily rollup. */
  private pruneBatch(cutoffTs: number): number {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Watermark read inside the write lock: pruned rows are always already counted in totals.
      const watermark = this.getWatermark() ?? 0;
      const rows = this.db
        .prepare("SELECT id FROM tenant_usage WHERE ts < ? AND id <= ? ORDER BY ts, id LIMIT ?")
        .all(cutoffTs, watermark, this.pruneBatchRows) as Array<{ id: number }>;
      if (rows.length === 0) {
        this.db.exec("COMMIT");
        return 0;
      }
      const ids = JSON.stringify(rows.map((row) => row.id));
      this.db
        .prepare(
          `INSERT INTO tenant_usage_daily (tenant_id, day, kind, events, units)
             SELECT tenant_id, ts / ${DAY_MS}, kind, COUNT(*), COALESCE(SUM(units), 0)
             FROM tenant_usage WHERE id IN (SELECT value FROM json_each(?))
             GROUP BY tenant_id, ts / ${DAY_MS}, kind
           ON CONFLICT (tenant_id, day, kind) DO UPDATE SET events = events + excluded.events, units = units + excluded.units`,
        )
        .run(ids);
      this.db.prepare("DELETE FROM tenant_usage WHERE id IN (SELECT value FROM json_each(?))").run(ids);
      this.db.exec("COMMIT");
      return rows.length;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Reclaim freed pages without ever running a blocking full VACUUM. Incremental vacuum only works
   * when the file was created/converted with auto_vacuum=INCREMENTAL, which needs a one-time offline
   * `PRAGMA auto_vacuum=INCREMENTAL; VACUUM;`. Otherwise log once and leave the file size as is.
   */
  private reclaimSpace(): void {
    const mode = (this.db.prepare("PRAGMA auto_vacuum").get() as { auto_vacuum: number }).auto_vacuum;
    if (mode === 2) {
      this.db.exec(`PRAGMA incremental_vacuum(${INCREMENTAL_VACUUM_PAGES})`);
    } else if (!this.warnedNoIncrementalVacuum) {
      this.warnedNoIncrementalVacuum = true;
      this.notice(
        "usage.sqlite auto_vacuum is not INCREMENTAL; pruned pages are reused but the file will not shrink. " +
          "Run once, offline: sqlite3 usage.sqlite 'PRAGMA auto_vacuum=INCREMENTAL; VACUUM;'",
      );
    }
  }

  /**
   * Self-healing running totals. usage_meta 'totals_watermark' holds the max tenant_usage.id already
   * counted in tenant_usage_totals. On boot every row with id > watermark is added to the totals in
   * chunked transactions (each chunk advances the watermark atomically, so a crash resumes cleanly).
   * With no watermark (first boot of this scheme) the totals are rebuilt from scratch, which also
   * repairs any drift left by earlier versions. Inserts update totals + watermark in one transaction
   * (see record()). Pruning (A1) only ever deletes rows with id <= watermark.
   */
  private migrateCoveringIndexAndTotals(): void {
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_tenant_usage_covering ON tenant_usage (tenant_id, kind, ts, units);");
    this.db.exec("DROP INDEX IF EXISTS idx_tenant_usage_tenant_kind_ts;");
    let watermark = this.getWatermark();
    if (watermark === null) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec("DELETE FROM tenant_usage_totals;");
        this.db.exec("INSERT OR REPLACE INTO usage_meta (key, value) VALUES ('totals_watermark', '0')");
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      watermark = 0;
    }
    const bound = this.db.prepare("SELECT MAX(id) AS hi FROM (SELECT id FROM tenant_usage WHERE id > ? ORDER BY id LIMIT ?)");
    const add = this.db.prepare(
      `INSERT INTO tenant_usage_totals (tenant_id, kind, events, units)
         SELECT tenant_id, kind, COUNT(*), COALESCE(SUM(units), 0) FROM tenant_usage WHERE id > ? AND id <= ? GROUP BY tenant_id, kind
       ON CONFLICT (tenant_id, kind) DO UPDATE SET events = events + excluded.events, units = units + excluded.units`,
    );
    for (;;) {
      const row = bound.get(watermark, BACKFILL_CHUNK_ROWS) as { hi: number | null };
      const hi = row.hi;
      if (hi === null) break;
      this.db.exec("BEGIN IMMEDIATE");
      try {
        // Re-read inside the write lock: another process may have advanced the watermark.
        const current = this.getWatermark() ?? 0;
        if (current < hi) {
          add.run(Math.max(current, watermark), hi);
          this.setWatermark(hi);
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      watermark = hi;
    }
  }

  private getWatermark(): number | null {
    const row = this.db.prepare("SELECT value FROM usage_meta WHERE key = 'totals_watermark'").get() as
      | { value: string }
      | undefined;
    return row ? Number(row.value) : null;
  }

  private setWatermark(id: number): void {
    this.db.prepare("INSERT OR REPLACE INTO usage_meta (key, value) VALUES ('totals_watermark', ?)").run(String(id));
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
      this.setWatermark(Number(result.lastInsertRowid));
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
    const rawBuckets = this.db
      .prepare(
        `SELECT kind, COUNT(*) AS events, COALESCE(SUM(units), 0) AS units
         FROM tenant_usage
         WHERE ${where}
         GROUP BY kind
         ORDER BY kind`,
      )
      .all(...params) as unknown as UsageBucket[];
    // Pruned history lives in tenant_usage_daily (UTC day granularity). A rolled-up day is included
    // when it overlaps [since, now): for a `since` that falls mid-day this can include up to one UTC
    // day of already-pruned events from before `since`. Raw rows are exact. Empty when pruning is off.
    const dailyClauses = ["tenant_id = ?", "day >= ?"];
    const dailyParams: Array<string | number> = [tenantId, Math.floor(since / DAY_MS)];
    if (query.kind) {
      dailyClauses.push("kind = ?");
      dailyParams.push(normalizeKind(query.kind));
    }
    const dailyBuckets = this.db
      .prepare(
        `SELECT kind, SUM(events) AS events, SUM(units) AS units
         FROM tenant_usage_daily WHERE ${dailyClauses.join(" AND ")} GROUP BY kind`,
      )
      .all(...dailyParams) as unknown as UsageBucket[];
    const merged = new Map<string, UsageBucket>();
    for (const bucket of [...rawBuckets, ...dailyBuckets]) {
      const existing = merged.get(bucket.kind);
      if (existing) {
        existing.events += bucket.events;
        existing.units += bucket.units;
      } else {
        merged.set(bucket.kind, { kind: bucket.kind, events: bucket.events, units: bucket.units });
      }
    }
    const buckets = [...merged.values()].sort((x, y) => (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0));
    return {
      tenantId,
      since,
      events: totals.events + dailyBuckets.reduce((sum, b) => sum + b.events, 0),
      units: totals.units + dailyBuckets.reduce((sum, b) => sum + b.units, 0),
      byKind: buckets,
    };
  }

  /** Individual events. Only raw rows exist here: events older than the retention window are pruned. */
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
    this.closed = true;
    if (this.pruneTimer) clearTimeout(this.pruneTimer);
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

function resolveRetentionDays(option: number | undefined, notice: (message: string) => void): number | null {
  const raw = option ?? (process.env.USAGE_RETENTION_DAYS?.trim() ? Number(process.env.USAGE_RETENTION_DAYS) : undefined);
  if (raw === undefined || raw === 0) return null;
  if (!Number.isFinite(raw) || raw < 1) {
    notice(`ignoring invalid USAGE_RETENTION_DAYS=${String(raw)}; usage retention stays disabled`);
    return null;
  }
  return Math.trunc(raw);
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
