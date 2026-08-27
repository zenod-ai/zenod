import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { openZenodSqlite } from "./sqlite.js";

/**
 * Phylax-local accounting uses integer internal units. A unit is deliberately
 * not a provider token, provider balance, OAuth credential, MCP credential, or
 * currency amount. The tariff version is the only authority that translates a
 * paid operation into units.
 */
export type PhylaxAllowanceEntryKind =
  | "grant"
  | "adjustment"
  | "expiry"
  | "usage"
  | "suspend"
  | "resume";

export type PhylaxUsageCostBasis =
  | "actual"
  | "estimated"
  | "service_included"
  | "unavailable";

export interface PhylaxAllowancePeriod {
  tenantId: string;
  periodId: string;
  startsAt: number;
  endsAt: number;
}

export interface PhylaxAllowanceEntry {
  sequence: number;
  tenantId: string;
  periodId: string | null;
  kind: PhylaxAllowanceEntryKind;
  /** Positive grants, signed adjustments, negative expiry/usage, zero controls. */
  amountUnits: number;
  source: string;
  idempotencyKey: string;
  tariffVersion: string;
  auditReason: string;
  providerEventId: string | null;
  operation: string | null;
  provider: string | null;
  model: string | null;
  costBasis: PhylaxUsageCostBasis | null;
  occurredAt: number;
  createdAt: number;
}

export interface PhylaxLedgerMutation {
  entry: PhylaxAllowanceEntry;
  replayed: boolean;
}

export interface PhylaxCustomerMeteringProjection {
  tenantId: string;
  periodId: string | null;
  state: "active" | "paused" | "suspended" | "unavailable";
  allocatedUnits: number;
  usedUnits: number;
  reservedUnits: number;
  remainingUnits: number;
  /** Integer basis points in [0, 10_000], suitable for a customer percentage. */
  usageBasisPoints: number;
  resetsAt: number | null;
}

export interface PhylaxOperatorUsageBucket {
  operation: string;
  provider: string;
  model: string;
  tariffVersion: string;
  costBasis: PhylaxUsageCostBasis;
  events: number;
  units: number;
}

export interface PhylaxOperatorLedgerProjection {
  tenantId: string;
  periodId: string | null;
  grantedUnits: number;
  adjustedUnits: number;
  expiredUnits: number;
  usedUnits: number;
  byUsage: PhylaxOperatorUsageBucket[];
  entries: PhylaxAllowanceEntry[];
}

export type PhylaxPaidWorkState =
  | "captured"
  | "ready"
  | "paused"
  | "processing"
  | "done"
  | "cancelled";

export interface PhylaxPaidWork {
  id: string;
  tenantId: string;
  periodId: string;
  idempotencyKey: string;
  providerEventId: string;
  operation: string;
  custodyRef: string;
  estimatedUnits: number;
  reservedUnits: number;
  state: PhylaxPaidWorkState;
  pauseReason: "insufficient_allowance" | "suspended" | "period_inactive" | null;
  leaseOwner: string | null;
  /** Opaque claim generation. Completion must present this exact token. */
  leaseToken: string | null;
  leaseUntil: number | null;
  usageEntrySequence: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PhylaxPaidWorkAdmission {
  state: "ready" | "paused" | "replayed";
  work: PhylaxPaidWork;
}

interface PeriodRow {
  tenant_id: string;
  period_id: string;
  starts_at: number;
  ends_at: number;
  created_at: number;
}

interface EntryRow {
  sequence: number;
  tenant_id: string;
  period_id: string | null;
  kind: PhylaxAllowanceEntryKind;
  amount_units: number;
  source: string;
  idempotency_key: string;
  payload_hash: string;
  tariff_version: string;
  audit_reason: string;
  provider_event_id: string | null;
  operation: string | null;
  provider: string | null;
  model: string | null;
  cost_basis: PhylaxUsageCostBasis | null;
  occurred_at: number;
  created_at: number;
}

interface PaidWorkRow {
  id: string;
  tenant_id: string;
  period_id: string;
  idempotency_key: string;
  payload_hash: string;
  provider_event_id: string;
  operation: string;
  custody_ref: string;
  estimated_units: number;
  reserved_units: number;
  state: PhylaxPaidWorkState;
  pause_reason: PhylaxPaidWork["pauseReason"];
  lease_owner: string | null;
  lease_token: string | null;
  lease_until: number | null;
  completed_lease_owner: string | null;
  completed_lease_token: string | null;
  usage_entry_sequence: number | null;
  created_at: number;
  updated_at: number;
}

type UsageMutationAttempt =
  | { ok: true; usage: PhylaxLedgerMutation }
  | { ok: false; error: Error };

export class PhylaxLedgerConflictError extends Error {
  readonly code = "phylax_ledger_idempotency_conflict";

  constructor(message: string) {
    super(message);
    this.name = "PhylaxLedgerConflictError";
  }
}

function required(value: string, field: string, max = 512): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  if (normalized.length > max) throw new Error(`${field} must be at most ${max} characters`);
  return normalized;
}

function units(value: number, field: string, options: { positive?: boolean; nonNegative?: boolean } = {}): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${field} must be a safe integer`);
  if (options.positive && value <= 0) throw new Error(`${field} must be positive`);
  if (options.nonNegative && value < 0) throw new Error(`${field} must not be negative`);
  return value;
}

function timestamp(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer timestamp`);
  return value;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

function payloadHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function entry(row: EntryRow): PhylaxAllowanceEntry {
  return {
    sequence: row.sequence,
    tenantId: row.tenant_id,
    periodId: row.period_id,
    kind: row.kind,
    amountUnits: row.amount_units,
    source: row.source,
    idempotencyKey: row.idempotency_key,
    tariffVersion: row.tariff_version,
    auditReason: row.audit_reason,
    providerEventId: row.provider_event_id,
    operation: row.operation,
    provider: row.provider,
    model: row.model,
    costBasis: row.cost_basis,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

function paidWork(row: PaidWorkRow): PhylaxPaidWork {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    periodId: row.period_id,
    idempotencyKey: row.idempotency_key,
    providerEventId: row.provider_event_id,
    operation: row.operation,
    custodyRef: row.custody_ref,
    estimatedUnits: row.estimated_units,
    reservedUnits: row.reserved_units,
    state: row.state,
    pauseReason: row.pause_reason,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseUntil: row.lease_until,
    usageEntrySequence: row.usage_entry_sequence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Phylax's authoritative local allowance and channel-cost ledger.
 *
 * It intentionally has no dependency on Zenod's UsageStore or customer billing
 * tables. Host products and native Phylax billing are merely allowance issuers.
 * Raw bytes remain in the existing channel custody store; paid work can enter
 * this queue only with a durable `custodyRef`, and a cap pauses the work rather
 * than deleting or rejecting that custody record.
 */
export class PhylaxAllowanceLedger {
  private readonly db: DatabaseSync;

  constructor(
    path: string,
    private readonly now: () => number = Date.now,
  ) {
    this.db = openZenodSqlite(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS phylax_allowance_periods (
        tenant_id TEXT NOT NULL,
        period_id TEXT NOT NULL,
        starts_at INTEGER NOT NULL,
        ends_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, period_id)
      );

      CREATE TABLE IF NOT EXISTS phylax_allowance_entries (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        period_id TEXT,
        kind TEXT NOT NULL,
        amount_units INTEGER NOT NULL,
        source TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        tariff_version TEXT NOT NULL,
        audit_reason TEXT NOT NULL,
        provider_event_id TEXT,
        operation TEXT,
        provider TEXT,
        model TEXT,
        cost_basis TEXT,
        occurred_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (tenant_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS phylax_allowance_entries_period
        ON phylax_allowance_entries (tenant_id, period_id, sequence);
      CREATE UNIQUE INDEX IF NOT EXISTS phylax_allowance_usage_event
        ON phylax_allowance_entries (tenant_id, provider_event_id, operation)
        WHERE kind='usage' AND provider_event_id IS NOT NULL AND operation IS NOT NULL;

      CREATE TABLE IF NOT EXISTS phylax_paid_work (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        period_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        provider_event_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        custody_ref TEXT NOT NULL,
        estimated_units INTEGER NOT NULL,
        reserved_units INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL,
        pause_reason TEXT,
        lease_owner TEXT,
        lease_token TEXT,
        lease_until INTEGER,
        completed_lease_owner TEXT,
        completed_lease_token TEXT,
        usage_entry_sequence INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (tenant_id, idempotency_key),
        UNIQUE (tenant_id, provider_event_id, operation)
      );
      CREATE INDEX IF NOT EXISTS phylax_paid_work_queue
        ON phylax_paid_work (tenant_id, state, created_at);
    `);
    const paidWorkColumns = new Set(
      (this.db.prepare("PRAGMA table_info(phylax_paid_work)").all() as unknown as Array<{ name: string }>)
        .map((column) => column.name),
    );
    for (const column of ["lease_token", "completed_lease_owner", "completed_lease_token"]) {
      if (!paidWorkColumns.has(column)) this.db.exec(`ALTER TABLE phylax_paid_work ADD COLUMN ${column} TEXT`);
    }
  }

  private transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = run();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private period(tenantId: string, periodId: string): PeriodRow | null {
    return this.db.prepare(
      "SELECT * FROM phylax_allowance_periods WHERE tenant_id=? AND period_id=?",
    ).get(tenantId, periodId) as unknown as PeriodRow | undefined ?? null;
  }

  private ensurePeriod(input: PhylaxAllowancePeriod, createdAt: number): PeriodRow {
    const tenantId = required(input.tenantId, "tenantId");
    const periodId = required(input.periodId, "periodId");
    const startsAt = timestamp(input.startsAt, "startsAt");
    const endsAt = timestamp(input.endsAt, "endsAt");
    if (endsAt <= startsAt) throw new Error("endsAt must be after startsAt");
    this.db.prepare(
      `INSERT OR IGNORE INTO phylax_allowance_periods
       (tenant_id, period_id, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(tenantId, periodId, startsAt, endsAt, createdAt);
    const existing = this.period(tenantId, periodId)!;
    if (existing.starts_at !== startsAt || existing.ends_at !== endsAt) {
      throw new PhylaxLedgerConflictError("period identity was reused with different boundaries");
    }
    return existing;
  }

  private assertPeriodOpen(period: PeriodRow, at: number): void {
    if (period.ends_at <= at) {
      throw new Error("allowance period is closed");
    }
  }

  private entryByIdempotency(tenantId: string, idempotencyKey: string): EntryRow | null {
    return this.db.prepare(
      "SELECT * FROM phylax_allowance_entries WHERE tenant_id=? AND idempotency_key=?",
    ).get(tenantId, idempotencyKey) as unknown as EntryRow | undefined ?? null;
  }

  private usageByProviderEvent(tenantId: string, providerEventId: string, operation: string): EntryRow | null {
    return this.db.prepare(
      `SELECT * FROM phylax_allowance_entries
       WHERE tenant_id=? AND kind='usage' AND provider_event_id=? AND operation=?`,
    ).get(tenantId, providerEventId, operation) as unknown as EntryRow | undefined ?? null;
  }

  private replayOrConflict(existing: EntryRow, expectedHash: string): PhylaxLedgerMutation {
    if (existing.payload_hash !== expectedHash) {
      throw new PhylaxLedgerConflictError("idempotency identity was reused with different ledger input");
    }
    return { entry: entry(existing), replayed: true };
  }

  private insertEntry(input: {
    tenantId: string;
    periodId: string | null;
    kind: PhylaxAllowanceEntryKind;
    amountUnits: number;
    source: string;
    idempotencyKey: string;
    hash: string;
    tariffVersion: string;
    auditReason: string;
    providerEventId?: string | null;
    operation?: string | null;
    provider?: string | null;
    model?: string | null;
    costBasis?: PhylaxUsageCostBasis | null;
    occurredAt: number;
    createdAt: number;
  }): EntryRow {
    const result = this.db.prepare(
      `INSERT INTO phylax_allowance_entries
       (tenant_id, period_id, kind, amount_units, source, idempotency_key,
        payload_hash, tariff_version, audit_reason, provider_event_id, operation,
        provider, model, cost_basis, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.tenantId,
      input.periodId,
      input.kind,
      input.amountUnits,
      input.source,
      input.idempotencyKey,
      input.hash,
      input.tariffVersion,
      input.auditReason,
      input.providerEventId ?? null,
      input.operation ?? null,
      input.provider ?? null,
      input.model ?? null,
      input.costBasis ?? null,
      input.occurredAt,
      input.createdAt,
    );
    return this.db.prepare(
      "SELECT * FROM phylax_allowance_entries WHERE sequence=?",
    ).get(Number(result.lastInsertRowid)) as unknown as EntryRow;
  }

  grantAllowance(input: PhylaxAllowancePeriod & {
    amountUnits: number;
    source: string;
    idempotencyKey: string;
    tariffVersion: string;
    auditReason: string;
    occurredAt?: number;
  }): PhylaxLedgerMutation {
    const normalized = {
      tenantId: required(input.tenantId, "tenantId"),
      periodId: required(input.periodId, "periodId"),
      startsAt: timestamp(input.startsAt, "startsAt"),
      endsAt: timestamp(input.endsAt, "endsAt"),
      amountUnits: units(input.amountUnits, "amountUnits", { positive: true }),
      source: required(input.source, "source"),
      idempotencyKey: required(input.idempotencyKey, "idempotencyKey"),
      tariffVersion: required(input.tariffVersion, "tariffVersion"),
      auditReason: required(input.auditReason, "auditReason", 2_000),
      occurredAt: timestamp(input.occurredAt ?? this.now(), "occurredAt"),
    };
    const hash = payloadHash({ ...normalized, idempotencyKey: undefined, occurredAt: undefined });
    return this.transaction(() => {
      const existing = this.entryByIdempotency(normalized.tenantId, normalized.idempotencyKey);
      if (existing) return this.replayOrConflict(existing, hash);
      const createdAt = this.now();
      const period = this.ensurePeriod(normalized, createdAt);
      this.assertPeriodOpen(period, createdAt);
      return {
        entry: entry(this.insertEntry({ ...normalized, kind: "grant", hash, createdAt })),
        replayed: false,
      };
    });
  }

  adjustAllowance(input: {
    tenantId: string;
    periodId: string;
    amountUnits: number;
    source: string;
    idempotencyKey: string;
    tariffVersion: string;
    auditReason: string;
    occurredAt?: number;
  }): PhylaxLedgerMutation {
    const normalized = {
      tenantId: required(input.tenantId, "tenantId"),
      periodId: required(input.periodId, "periodId"),
      amountUnits: units(input.amountUnits, "amountUnits"),
      source: required(input.source, "source"),
      idempotencyKey: required(input.idempotencyKey, "idempotencyKey"),
      tariffVersion: required(input.tariffVersion, "tariffVersion"),
      auditReason: required(input.auditReason, "auditReason", 2_000),
      occurredAt: timestamp(input.occurredAt ?? this.now(), "occurredAt"),
    };
    if (normalized.amountUnits === 0) throw new Error("amountUnits must not be zero");
    const hash = payloadHash({ ...normalized, idempotencyKey: undefined, occurredAt: undefined });
    return this.transaction(() => {
      const existing = this.entryByIdempotency(normalized.tenantId, normalized.idempotencyKey);
      if (existing) return this.replayOrConflict(existing, hash);
      const period = this.period(normalized.tenantId, normalized.periodId);
      if (!period) throw new Error("allowance period does not exist");
      this.assertPeriodOpen(period, this.now());
      if (normalized.amountUnits < 0) {
        const available = this.availableInPeriod(normalized.tenantId, normalized.periodId);
        if (-normalized.amountUnits > available) {
          throw new Error("negative adjustment may reclaim only unused allowance");
        }
      }
      return {
        entry: entry(this.insertEntry({ ...normalized, kind: "adjustment", hash, createdAt: this.now() })),
        replayed: false,
      };
    });
  }

  recordUsage(input: {
    tenantId: string;
    periodId: string;
    amountUnits: number;
    providerEventId: string;
    operation: string;
    provider: string;
    model?: string | null;
    costBasis: PhylaxUsageCostBasis;
    idempotencyKey: string;
    tariffVersion: string;
    auditReason: string;
    occurredAt?: number;
  }): PhylaxLedgerMutation {
    const acceptedAt = timestamp(this.now(), "acceptedAt");
    const normalized = {
      tenantId: required(input.tenantId, "tenantId"),
      periodId: required(input.periodId, "periodId"),
      amountUnits: units(input.amountUnits, "amountUnits", { nonNegative: true }),
      providerEventId: required(input.providerEventId, "providerEventId"),
      operation: required(input.operation, "operation"),
      provider: required(input.provider, "provider"),
      model: input.model?.trim() || null,
      costBasis: input.costBasis,
      idempotencyKey: required(input.idempotencyKey, "idempotencyKey"),
      tariffVersion: required(input.tariffVersion, "tariffVersion"),
      auditReason: required(input.auditReason, "auditReason", 2_000),
      occurredAt: timestamp(input.occurredAt ?? acceptedAt, "occurredAt"),
    };
    if (!["actual", "estimated", "service_included", "unavailable"].includes(normalized.costBasis)) {
      throw new Error("costBasis is invalid");
    }
    const hash = payloadHash({ ...normalized, amountUnits: -normalized.amountUnits, idempotencyKey: undefined, occurredAt: undefined });
    const attempt = this.transaction(() => this.attemptUsageInTransaction(normalized, hash, acceptedAt));
    if (!attempt.ok) throw attempt.error;
    return attempt.usage;
  }

  private attemptUsageInTransaction(
    normalized: {
      tenantId: string;
      periodId: string;
      amountUnits: number;
      providerEventId: string;
      operation: string;
      provider: string;
      model: string | null;
      costBasis: PhylaxUsageCostBasis;
      idempotencyKey: string;
      tariffVersion: string;
      auditReason: string;
      occurredAt: number;
    },
    hash: string,
    acceptedAt: number,
    ownedReservationUnits = 0,
  ): UsageMutationAttempt {
    this.reconcileExpiredPeriodsInTransaction(acceptedAt);
    const byIdempotency = this.entryByIdempotency(normalized.tenantId, normalized.idempotencyKey);
    if (byIdempotency) return { ok: true, usage: this.replayOrConflict(byIdempotency, hash) };
    const byProvider = this.usageByProviderEvent(
      normalized.tenantId,
      normalized.providerEventId,
      normalized.operation,
    );
    if (byProvider) return { ok: true, usage: this.replayOrConflict(byProvider, hash) };
    const period = this.period(normalized.tenantId, normalized.periodId);
    if (!period) throw new Error("allowance period does not exist");
    const acceptedOutsidePeriod = acceptedAt < period.starts_at || acceptedAt >= period.ends_at;
    const eventOutsidePeriod = normalized.occurredAt < period.starts_at || normalized.occurredAt >= period.ends_at;
    if (acceptedOutsidePeriod || eventOutsidePeriod) {
      return { ok: false, error: new Error("usage requires an active allowance period") };
    }
    const spendableUnits = this.availableInPeriod(normalized.tenantId, normalized.periodId)
      + units(ownedReservationUnits, "ownedReservationUnits", { nonNegative: true });
    if (normalized.amountUnits > spendableUnits) {
      return { ok: false, error: new Error("usage exceeds currently unreserved allowance") };
    }
    return {
      ok: true,
      usage: {
        entry: entry(this.insertEntry({
          ...normalized,
          kind: "usage",
          amountUnits: -normalized.amountUnits,
          source: normalized.provider,
          hash,
          createdAt: acceptedAt,
        })),
        replayed: false,
      },
    };
  }

  suspendTenant(input: {
    tenantId: string;
    source: string;
    idempotencyKey: string;
    auditReason: string;
    occurredAt?: number;
  }): PhylaxLedgerMutation {
    return this.control(input, "suspend");
  }

  resumeTenant(input: {
    tenantId: string;
    source: string;
    idempotencyKey: string;
    auditReason: string;
    occurredAt?: number;
  }): PhylaxLedgerMutation {
    return this.control(input, "resume");
  }

  private control(
    input: {
      tenantId: string;
      source: string;
      idempotencyKey: string;
      auditReason: string;
      occurredAt?: number;
    },
    kind: "suspend" | "resume",
  ): PhylaxLedgerMutation {
    const normalized = {
      tenantId: required(input.tenantId, "tenantId"),
      source: required(input.source, "source"),
      idempotencyKey: required(input.idempotencyKey, "idempotencyKey"),
      auditReason: required(input.auditReason, "auditReason", 2_000),
      occurredAt: timestamp(input.occurredAt ?? this.now(), "occurredAt"),
    };
    const hash = payloadHash({ ...normalized, kind, idempotencyKey: undefined, occurredAt: undefined });
    return this.transaction(() => {
      const existing = this.entryByIdempotency(normalized.tenantId, normalized.idempotencyKey);
      if (existing) return this.replayOrConflict(existing, hash);
      const result = {
        entry: entry(this.insertEntry({
          ...normalized,
          periodId: null,
          kind,
          amountUnits: 0,
          tariffVersion: "control-v1",
          hash,
          createdAt: this.now(),
        })),
        replayed: false,
      };
      if (kind === "suspend") {
        this.db.prepare(
          `UPDATE phylax_paid_work
           SET state='paused', pause_reason='suspended', reserved_units=0,
               lease_owner=NULL, lease_token=NULL, lease_until=NULL, updated_at=?
           WHERE tenant_id=? AND state IN ('captured', 'ready')`,
        ).run(this.now(), normalized.tenantId);
      }
      return result;
    });
  }

  private isSuspended(tenantId: string): boolean {
    const latest = this.db.prepare(
      `SELECT kind FROM phylax_allowance_entries
       WHERE tenant_id=? AND kind IN ('suspend', 'resume')
       ORDER BY sequence DESC LIMIT 1`,
    ).get(tenantId) as unknown as { kind: "suspend" | "resume" } | undefined;
    return latest?.kind === "suspend";
  }

  private periodBalance(tenantId: string, periodId: string): number {
    const row = this.db.prepare(
      `SELECT COALESCE(SUM(amount_units), 0) AS units
       FROM phylax_allowance_entries WHERE tenant_id=? AND period_id=?`,
    ).get(tenantId, periodId) as unknown as { units: number };
    return Number(row.units);
  }

  private reservedInPeriod(tenantId: string, periodId: string): number {
    const row = this.db.prepare(
      `SELECT COALESCE(SUM(reserved_units), 0) AS units
       FROM phylax_paid_work
       WHERE tenant_id=? AND period_id=? AND state IN ('ready', 'processing')`,
    ).get(tenantId, periodId) as unknown as { units: number };
    return Number(row.units);
  }

  private availableInPeriod(tenantId: string, periodId: string): number {
    return Math.max(0, this.periodBalance(tenantId, periodId) - this.reservedInPeriod(tenantId, periodId));
  }

  reconcileExpiredPeriods(at: number = this.now()): number {
    const now = timestamp(at, "at");
    return this.transaction(() => this.reconcileExpiredPeriodsInTransaction(now));
  }

  private reconcileExpiredPeriodsInTransaction(now: number): number {
    const periods = this.db.prepare(
      `SELECT * FROM phylax_allowance_periods
       WHERE ends_at <= ? ORDER BY ends_at, tenant_id, period_id`,
    ).all(now) as unknown as PeriodRow[];
    let inserted = 0;
    for (const period of periods) {
      this.db.prepare(
        `UPDATE phylax_paid_work
         SET state='paused', pause_reason='period_inactive', reserved_units=0,
             lease_owner=NULL, lease_token=NULL, lease_until=NULL, updated_at=?
         WHERE tenant_id=? AND period_id=? AND state IN ('captured', 'ready')`,
      ).run(now, period.tenant_id, period.period_id);
      const processing = this.db.prepare(
        `SELECT COALESCE(SUM(reserved_units), 0) AS units
         FROM phylax_paid_work
         WHERE tenant_id=? AND period_id=? AND state='processing'`,
      ).get(period.tenant_id, period.period_id) as unknown as { units: number };
      const reclaimable = Math.max(0, this.periodBalance(period.tenant_id, period.period_id) - Number(processing.units));
      if (reclaimable === 0) continue;
      const anchor = this.db.prepare(
        `SELECT COALESCE(MAX(sequence), 0) AS sequence
         FROM phylax_allowance_entries WHERE tenant_id=? AND period_id=?`,
      ).get(period.tenant_id, period.period_id) as unknown as { sequence: number };
      const idempotencyKey = `system:expiry:${period.period_id}:through:${Number(anchor.sequence)}`;
      if (this.entryByIdempotency(period.tenant_id, idempotencyKey)) continue;
      const hash = payloadHash({
        tenantId: period.tenant_id,
        periodId: period.period_id,
        amountUnits: -reclaimable,
        kind: "expiry",
      });
      this.insertEntry({
        tenantId: period.tenant_id,
        periodId: period.period_id,
        kind: "expiry",
        amountUnits: -reclaimable,
        source: "phylax",
        idempotencyKey,
        hash,
        tariffVersion: "expiry-v1",
        auditReason: "allowance period ended; unused allocation expired",
        occurredAt: period.ends_at,
        createdAt: now,
      });
      inserted += 1;
    }
    return inserted;
  }

  customerProjection(tenantIdInput: string, at: number = this.now()): PhylaxCustomerMeteringProjection {
    const tenantId = required(tenantIdInput, "tenantId");
    const now = timestamp(at, "at");
    return this.transaction(() => {
      this.reconcileExpiredPeriodsInTransaction(now);
      const period = this.db.prepare(
        `SELECT * FROM phylax_allowance_periods
         WHERE tenant_id=? AND starts_at <= ? AND ends_at > ?
         ORDER BY ends_at, period_id LIMIT 1`,
      ).get(tenantId, now, now) as unknown as PeriodRow | undefined;
      if (!period) {
        return {
          tenantId,
          periodId: null,
          state: this.isSuspended(tenantId) ? "suspended" : "unavailable",
          allocatedUnits: 0,
          usedUnits: 0,
          reservedUnits: 0,
          remainingUnits: 0,
          usageBasisPoints: 0,
          resetsAt: null,
        };
      }
      const totals = this.db.prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN kind IN ('grant', 'adjustment', 'expiry') THEN amount_units ELSE 0 END), 0) AS allocated,
           COALESCE(-SUM(CASE WHEN kind='usage' THEN amount_units ELSE 0 END), 0) AS used
         FROM phylax_allowance_entries WHERE tenant_id=? AND period_id=?`,
      ).get(tenantId, period.period_id) as unknown as { allocated: number; used: number };
      const allocatedUnits = Number(totals.allocated);
      const usedUnits = Number(totals.used);
      const reservedUnits = this.reservedInPeriod(tenantId, period.period_id);
      const remainingUnits = Math.max(0, allocatedUnits - usedUnits - reservedUnits);
      const usageBasisPoints = allocatedUnits <= 0
        ? (usedUnits > 0 ? 10_000 : 0)
        : Math.min(10_000, Math.max(0, Math.round(usedUnits / allocatedUnits * 10_000)));
      return {
        tenantId,
        periodId: period.period_id,
        state: this.isSuspended(tenantId)
          ? "suspended"
          : remainingUnits <= 0 ? "paused" : "active",
        allocatedUnits,
        usedUnits,
        reservedUnits,
        remainingUnits,
        usageBasisPoints,
        resetsAt: period.ends_at,
      };
    });
  }

  operatorProjection(tenantIdInput: string, periodIdInput?: string): PhylaxOperatorLedgerProjection {
    const tenantId = required(tenantIdInput, "tenantId");
    const periodId = periodIdInput ? required(periodIdInput, "periodId") : null;
    const clauses = ["tenant_id=?"];
    const params: string[] = [tenantId];
    if (periodId) {
      clauses.push("period_id=?");
      params.push(periodId);
    }
    const rows = this.db.prepare(
      `SELECT * FROM phylax_allowance_entries WHERE ${clauses.join(" AND ")} ORDER BY sequence`,
    ).all(...params) as unknown as EntryRow[];
    const usageRows = this.db.prepare(
      `SELECT operation, provider, COALESCE(model, 'unknown') AS model,
              tariff_version, cost_basis, COUNT(*) AS events,
              COALESCE(-SUM(amount_units), 0) AS units
       FROM phylax_allowance_entries
       WHERE ${clauses.join(" AND ")} AND kind='usage'
       GROUP BY operation, provider, model, tariff_version, cost_basis
       ORDER BY units DESC, operation, provider, model`,
    ).all(...params) as unknown as Array<{
      operation: string;
      provider: string;
      model: string;
      tariff_version: string;
      cost_basis: PhylaxUsageCostBasis;
      events: number;
      units: number;
    }>;
    return {
      tenantId,
      periodId,
      grantedUnits: rows.filter((row) => row.kind === "grant").reduce((sum, row) => sum + row.amount_units, 0),
      adjustedUnits: rows.filter((row) => row.kind === "adjustment").reduce((sum, row) => sum + row.amount_units, 0),
      expiredUnits: Math.max(0, -rows.filter((row) => row.kind === "expiry").reduce((sum, row) => sum + row.amount_units, 0)),
      usedUnits: Math.max(0, -rows.filter((row) => row.kind === "usage").reduce((sum, row) => sum + row.amount_units, 0)),
      byUsage: usageRows.map((row) => ({
        operation: row.operation,
        provider: row.provider,
        model: row.model,
        tariffVersion: row.tariff_version,
        costBasis: row.cost_basis,
        events: Number(row.events),
        units: Number(row.units),
      })),
      entries: rows.map(entry),
    };
  }

  admitPaidWork(input: {
    tenantId: string;
    periodId: string;
    idempotencyKey: string;
    providerEventId: string;
    operation: string;
    custodyRef: string;
    estimatedUnits: number;
    capturedAt?: number;
  }): PhylaxPaidWorkAdmission {
    const normalized = {
      tenantId: required(input.tenantId, "tenantId"),
      periodId: required(input.periodId, "periodId"),
      idempotencyKey: required(input.idempotencyKey, "idempotencyKey"),
      providerEventId: required(input.providerEventId, "providerEventId"),
      operation: required(input.operation, "operation"),
      custodyRef: required(input.custodyRef, "custodyRef", 4_096),
      estimatedUnits: units(input.estimatedUnits, "estimatedUnits", { nonNegative: true }),
      capturedAt: timestamp(input.capturedAt ?? this.now(), "capturedAt"),
    };
    const hash = payloadHash({ ...normalized, idempotencyKey: undefined, capturedAt: undefined });
    return this.transaction(() => {
      this.reconcileExpiredPeriodsInTransaction(this.now());
      const byIdempotency = this.workByIdempotency(normalized.tenantId, normalized.idempotencyKey);
      const byProvider = this.workByProviderEvent(
        normalized.tenantId,
        normalized.providerEventId,
        normalized.operation,
      );
      const existing = byIdempotency ?? byProvider;
      if (existing) {
        if (existing.payload_hash !== hash) {
          throw new PhylaxLedgerConflictError("paid-work identity was reused with different input");
        }
        if (existing.state === "paused" || existing.state === "captured") this.evaluateWork(existing.id, this.now());
        return { state: "replayed", work: paidWork(this.work(existing.id)!) };
      }
      const now = this.now();
      const id = randomUUID();
      this.db.prepare(
        `INSERT INTO phylax_paid_work
         (id, tenant_id, period_id, idempotency_key, payload_hash,
          provider_event_id, operation, custody_ref, estimated_units,
          reserved_units, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'captured', ?, ?)`,
      ).run(
        id,
        normalized.tenantId,
        normalized.periodId,
        normalized.idempotencyKey,
        hash,
        normalized.providerEventId,
        normalized.operation,
        normalized.custodyRef,
        normalized.estimatedUnits,
        normalized.capturedAt,
        now,
      );
      const evaluated = this.evaluateWork(id, now);
      return { state: evaluated.state === "ready" ? "ready" : "paused", work: paidWork(evaluated) };
    });
  }

  private work(id: string): PaidWorkRow | null {
    return this.db.prepare("SELECT * FROM phylax_paid_work WHERE id=?").get(id) as unknown as PaidWorkRow | undefined ?? null;
  }

  private workByIdempotency(tenantId: string, idempotencyKey: string): PaidWorkRow | null {
    return this.db.prepare(
      "SELECT * FROM phylax_paid_work WHERE tenant_id=? AND idempotency_key=?",
    ).get(tenantId, idempotencyKey) as unknown as PaidWorkRow | undefined ?? null;
  }

  private workByProviderEvent(tenantId: string, providerEventId: string, operation: string): PaidWorkRow | null {
    return this.db.prepare(
      "SELECT * FROM phylax_paid_work WHERE tenant_id=? AND provider_event_id=? AND operation=?",
    ).get(tenantId, providerEventId, operation) as unknown as PaidWorkRow | undefined ?? null;
  }

  private evaluateWork(id: string, now: number): PaidWorkRow {
    const current = this.work(id);
    if (!current) throw new Error("paid work does not exist");
    if (["ready", "processing", "done", "cancelled"].includes(current.state)) return current;
    const period = this.period(current.tenant_id, current.period_id);
    let state: "ready" | "paused" = "ready";
    let pauseReason: PhylaxPaidWork["pauseReason"] = null;
    if (this.isSuspended(current.tenant_id)) {
      state = "paused";
      pauseReason = "suspended";
    } else if (!period || period.starts_at > now || period.ends_at <= now) {
      state = "paused";
      pauseReason = "period_inactive";
    } else if (this.availableInPeriod(current.tenant_id, current.period_id) < current.estimated_units) {
      state = "paused";
      pauseReason = "insufficient_allowance";
    }
    this.db.prepare(
      `UPDATE phylax_paid_work
       SET state=?, pause_reason=?, reserved_units=?, lease_owner=NULL,
           lease_token=NULL, lease_until=NULL, updated_at=? WHERE id=?`,
    ).run(state, pauseReason, state === "ready" ? current.estimated_units : 0, now, id);
    return this.work(id)!;
  }

  resumePaused(tenantIdInput: string, at: number = this.now()): number {
    const tenantId = required(tenantIdInput, "tenantId");
    const now = timestamp(at, "at");
    return this.transaction(() => {
      this.reconcileExpiredPeriodsInTransaction(now);
      const candidates = this.db.prepare(
        `SELECT id FROM phylax_paid_work
         WHERE tenant_id=? AND state IN ('captured', 'paused')
         ORDER BY created_at, id`,
      ).all(tenantId) as unknown as Array<{ id: string }>;
      let ready = 0;
      for (const candidate of candidates) {
        if (this.evaluateWork(candidate.id, now).state === "ready") ready += 1;
      }
      return ready;
    });
  }

  claimNextPaidWork(tenantIdInput: string, workerIdInput: string, leaseMs: number, at: number = this.now()): PhylaxPaidWork | null {
    const tenantId = required(tenantIdInput, "tenantId");
    const workerId = required(workerIdInput, "workerId");
    const now = timestamp(at, "at");
    const lease = units(leaseMs, "leaseMs", { positive: true });
    return this.transaction(() => {
      const expired = this.db.prepare(
        `SELECT id FROM phylax_paid_work
         WHERE tenant_id=? AND state='processing' AND lease_until <= ?
         ORDER BY created_at, id`,
      ).all(tenantId, now) as unknown as Array<{ id: string }>;
      for (const item of expired) {
        const released = this.db.prepare(
          `UPDATE phylax_paid_work
           SET state='captured', pause_reason=NULL, reserved_units=0,
               lease_owner=NULL, lease_token=NULL, lease_until=NULL, updated_at=?
           WHERE id=? AND state='processing' AND lease_until <= ?`,
        ).run(now, item.id, now);
        if (Number(released.changes) === 1) this.evaluateWork(item.id, now);
      }
      this.reconcileExpiredPeriodsInTransaction(now);
      const candidate = this.db.prepare(
        `SELECT * FROM phylax_paid_work
         WHERE tenant_id=? AND state='ready'
         ORDER BY created_at, id LIMIT 1`,
      ).get(tenantId) as unknown as PaidWorkRow | undefined;
      if (!candidate) return null;
      const leaseToken = randomUUID();
      const result = this.db.prepare(
        `UPDATE phylax_paid_work
         SET state='processing', lease_owner=?, lease_token=?, lease_until=?, updated_at=?
         WHERE id=? AND state='ready'`,
      ).run(workerId, leaseToken, now + lease, now, candidate.id);
      return Number(result.changes) === 1 ? paidWork(this.work(candidate.id)!) : null;
    });
  }

  completePaidWork(input: {
    workId: string;
    tenantId: string;
    leaseOwner: string;
    leaseToken: string;
    amountUnits: number;
    providerEventId: string;
    provider: string;
    model?: string | null;
    costBasis: PhylaxUsageCostBasis;
    idempotencyKey: string;
    tariffVersion: string;
    auditReason: string;
    occurredAt?: number;
  }): { work: PhylaxPaidWork; usage: PhylaxLedgerMutation } {
    const workId = required(input.workId, "workId");
    const tenantId = required(input.tenantId, "tenantId");
    const attempt = this.transaction<
      | { result: { work: PhylaxPaidWork; usage: PhylaxLedgerMutation } }
      | { error: Error }
    >(() => {
      const current = this.work(workId);
      if (!current || current.tenant_id !== tenantId) throw new Error("paid work does not exist for tenant");
      if (current.provider_event_id !== required(input.providerEventId, "providerEventId")) {
        throw new PhylaxLedgerConflictError("paid work provider event does not match usage event");
      }
      const leaseOwner = required(input.leaseOwner, "leaseOwner");
      const leaseToken = required(input.leaseToken, "leaseToken");
      const completedAt = timestamp(this.now(), "completedAt");
      const normalized = {
        tenantId,
        periodId: current.period_id,
        amountUnits: units(input.amountUnits, "amountUnits", { nonNegative: true }),
        providerEventId: current.provider_event_id,
        operation: current.operation,
        provider: required(input.provider, "provider"),
        model: input.model?.trim() || null,
        costBasis: input.costBasis,
        idempotencyKey: required(input.idempotencyKey, "idempotencyKey"),
        tariffVersion: required(input.tariffVersion, "tariffVersion"),
        auditReason: required(input.auditReason, "auditReason", 2_000),
        occurredAt: timestamp(input.occurredAt ?? completedAt, "occurredAt"),
      };
      const hash = payloadHash({ ...normalized, amountUnits: -normalized.amountUnits, idempotencyKey: undefined, occurredAt: undefined });
      if (current.state === "done") {
        if (current.completed_lease_owner !== leaseOwner || current.completed_lease_token !== leaseToken) {
          throw new PhylaxLedgerConflictError("paid work completion lease does not match the completed claim");
        }
        const usageAttempt = this.attemptUsageInTransaction(normalized, hash, completedAt);
        if (!usageAttempt.ok) return { error: usageAttempt.error };
        const usage = usageAttempt.usage;
        if (current.usage_entry_sequence !== usage.entry.sequence) {
          throw new PhylaxLedgerConflictError("paid work already completed with a different usage entry");
        }
        return { result: { work: paidWork(current), usage } };
      }
      if (current.state !== "processing") throw new Error("paid work is not actively leased for completion");
      if (current.lease_owner !== leaseOwner || current.lease_token !== leaseToken) {
        throw new PhylaxLedgerConflictError("paid work completion lease does not match the active claim");
      }
      if (current.lease_until === null || current.lease_until <= completedAt) {
        throw new Error("paid work lease expired before completion");
      }
      const usageAttempt = this.attemptUsageInTransaction(
        normalized,
        hash,
        completedAt,
        current.reserved_units,
      );
      if (!usageAttempt.ok) return { error: usageAttempt.error };
      const usage = usageAttempt.usage;
      if (current.usage_entry_sequence !== null && current.usage_entry_sequence !== usage.entry.sequence) {
        throw new PhylaxLedgerConflictError("paid work already completed with a different usage entry");
      }
      this.db.prepare(
        `UPDATE phylax_paid_work
         SET state='done', pause_reason=NULL, reserved_units=0,
             lease_owner=NULL, lease_token=NULL, lease_until=NULL,
             completed_lease_owner=?, completed_lease_token=?,
             usage_entry_sequence=?, updated_at=?
         WHERE id=? AND state='processing' AND lease_owner=? AND lease_token=? AND lease_until > ?`,
      ).run(
        leaseOwner,
        leaseToken,
        usage.entry.sequence,
        completedAt,
        current.id,
        leaseOwner,
        leaseToken,
        completedAt,
      );
      const completed = this.work(current.id)!;
      if (completed.state !== "done" || completed.usage_entry_sequence !== usage.entry.sequence) {
        throw new Error("paid work lease changed before completion");
      }
      return { result: { work: paidWork(completed), usage } };
    });
    if ("error" in attempt) throw attempt.error;
    return attempt.result;
  }

  pendingWork(tenantIdInput: string): PhylaxPaidWork[] {
    const tenantId = required(tenantIdInput, "tenantId");
    return (this.db.prepare(
      `SELECT * FROM phylax_paid_work
       WHERE tenant_id=? AND state NOT IN ('done', 'cancelled')
       ORDER BY created_at, id`,
    ).all(tenantId) as unknown as PaidWorkRow[]).map(paidWork);
  }

  close(): void {
    this.db.close();
  }
}
