import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import {
  PhylaxAllowanceLedger,
  type PhylaxLedgerMutation,
  type PhylaxPaidWork,
  type PhylaxUsageCostBasis,
} from "./phylaxAllowanceLedger.js";

// Provider work renews this short lease while active. A crashed runtime leaves
// at most a one-minute orphan before the durable channel job is woken again.
const DEFAULT_LEASE_MS = 60_000;
const LEASE_RENEW_INTERVAL_MS = 20_000;
const EXPIRED_WORK_SWEEP_MS = 5_000;

export class PhylaxUsagePausedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhylaxUsagePausedError";
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export interface PhylaxUsageTariff {
  version: string;
  transcriptionUnitsPerSecond: number;
  inboundMessageUnits: number;
  outboundMessageUnits: number;
}

export interface PhylaxTranscriptionUsageInput {
  tenantId: string;
  providerMessageId: string;
  custodyRef: string;
  durationSeconds: number | null;
  provider: string;
  model: string | null;
  /** A durable transcript already exists in the channel journal after restart. */
  persistedResult?: boolean;
}

export interface PhylaxDeliveryUsageInput {
  tenantId: string;
  /** Durable provider-intent identity, known before the delivery call. */
  providerMessageId: string;
  custodyRef: string;
  channel: "whatsapp" | "telegram";
}

export interface PhylaxUsageClaim {
  state: "processing" | "already_booked" | "compatibility_pending" | "paused" | "abandoned";
  tenantId: string;
  providerEventId: string;
  operation: string;
  amountUnits: number;
  provider: string;
  model: string | null;
  costBasis: PhylaxUsageCostBasis;
  work?: PhylaxPaidWork;
  /** Exact prior provider receipt when an irreversible operation must not replay. */
  providerReceiptId?: string;
}

interface PendingRow {
  tenant_id: string;
  provider_event_id: string;
  operation: string;
  amount_units: number;
  provider: string;
  model: string | null;
  cost_basis: PhylaxUsageCostBasis;
  occurred_at: number;
  paid_work_id: string | null;
  intent_provider_event_id: string | null;
}

/**
 * Phylax-local tariff and compatibility journal.
 *
 * The allowance ledger remains the accounting authority. The small journal is
 * only a rolling-upgrade and post-provider settlement buffer. It never calls
 * Zenod and never carries content, tokens, credentials or session state. For
 * irreversible provider operations it retains only exact receipt/accounting
 * identity tied to the original local paid-work row.
 */
export class PhylaxUsageMeter {
  readonly tariff: PhylaxUsageTariff;
  private readonly db: DatabaseSync;
  private readonly workerId: string;
  private readonly sweepTimer: ReturnType<typeof setInterval>;
  private workReadyCallback: (() => void) | null = null;

  constructor(
    dataDir: string,
    private readonly ledger: PhylaxAllowanceLedger,
    env: NodeJS.ProcessEnv,
    options: { workerId?: string; now?: () => number } = {},
  ) {
    this.tariff = {
      version: env.PHYLAX_TARIFF_VERSION?.trim()
        || env.ZENOD_PHYLAX_TARIFF_VERSION?.trim()
        || "phylax-runtime-v1",
      transcriptionUnitsPerSecond: positiveInteger(
        env.PHYLAX_TRANSCRIPTION_UNITS_PER_SECOND,
        1,
      ),
      inboundMessageUnits: positiveInteger(env.PHYLAX_INBOUND_MESSAGE_UNITS, 1),
      outboundMessageUnits: positiveInteger(env.PHYLAX_OUTBOUND_MESSAGE_UNITS, 1),
    };
    // A boot-unique identity lets the same durable channel event take over an
    // orphaned lease immediately after process/container restart. PID alone is
    // not restart-unique inside containers (the runtime is commonly PID 1).
    this.workerId = options.workerId?.trim() || `phylax-runtime-${randomUUID()}`;
    this.now = options.now ?? Date.now;
    this.db = new DatabaseSync(join(dataDir, "phylax-usage-compat.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 30000;
      CREATE TABLE IF NOT EXISTS phylax_usage_compat (
        tenant_id TEXT NOT NULL,
        provider_event_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        amount_units INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        cost_basis TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        booked_at INTEGER,
        paid_work_id TEXT,
        intent_provider_event_id TEXT,
        PRIMARY KEY (tenant_id, provider_event_id, operation)
      );
    `);
    const compatibilityColumns = new Set(
      (this.db.prepare("PRAGMA table_info(phylax_usage_compat)").all() as unknown as Array<{ name: string }>)
        .map((column) => column.name),
    );
    for (const column of ["paid_work_id", "intent_provider_event_id"]) {
      if (!compatibilityColumns.has(column)) {
        this.db.exec(`ALTER TABLE phylax_usage_compat ADD COLUMN ${column} TEXT`);
      }
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS phylax_usage_compat_intent
      ON phylax_usage_compat (tenant_id, intent_provider_event_id, operation)
      WHERE intent_provider_event_id IS NOT NULL
    `);
    this.reconcileAllPending();
    this.sweepTimer = setInterval(() => {
      try {
        if (this.ledger.reconcileExpiredPaidWork() > 0) this.workReadyCallback?.();
      } catch {
        // A subsequent sweep retries; channel custody remains durable.
      }
    }, EXPIRED_WORK_SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  private readonly now: () => number;

  beginTranscription(input: PhylaxTranscriptionUsageInput): PhylaxUsageClaim {
    this.reconcilePending(input.tenantId);
    const seconds = input.durationSeconds === null || !Number.isFinite(input.durationSeconds)
      ? 1
      : Math.max(1, Math.ceil(input.durationSeconds));
    const amountUnits = Math.max(1, seconds * this.tariff.transcriptionUnitsPerSecond);
    const projection = this.ledger.customerProjection(input.tenantId);
    const common = {
      tenantId: input.tenantId,
      providerEventId: input.providerMessageId,
      operation: "transcription.audio",
      amountUnits,
      provider: input.provider,
      model: input.model,
      costBasis: "estimated" as const,
    };
    if (!projection.periodId || projection.state === "unavailable") {
      // Raw custody already exists at the channel seam. Missing provisioning
      // is not permission to spend: paid work remains paused until a grant is
      // present, including during a consumer-first rolling upgrade.
      return { state: "paused", ...common };
    }
    const admission = this.ledger.admitPaidWork({
      tenantId: input.tenantId,
      periodId: projection.periodId,
      idempotencyKey: `paid:${input.providerMessageId}:transcription.audio`,
      providerEventId: input.providerMessageId,
      operation: "transcription.audio",
      custodyRef: input.custodyRef,
      estimatedUnits: amountUnits,
    });
    if (admission.work.state === "done") return { state: "already_booked", ...common, work: admission.work };
    if (
      admission.work.state === "processing"
      && input.persistedResult
      && admission.work.leaseOwner
      && admission.work.leaseToken
      && admission.work.leaseUntil !== null
      && admission.work.leaseUntil > this.now()
    ) {
      // The transcript is the durable proof that the provider call completed.
      // Reusing the exact persisted lease settles the crash seam without a
      // second provider call and remains protected by completion idempotency.
      return { state: "processing", ...common, work: admission.work };
    }
    if (
      admission.work.state !== "ready"
      && !(admission.work.state === "processing" && input.persistedResult)
    ) return { state: "paused", ...common, work: admission.work };
    const claimed = this.ledger.claimPaidWork(
      admission.work.id,
      input.tenantId,
      this.workerId,
      DEFAULT_LEASE_MS,
      this.now(),
    );
    return claimed
      ? { state: "processing", ...common, work: claimed }
      : { state: "paused", ...common, work: admission.work };
  }

  completeTranscription(claim: PhylaxUsageClaim, succeeded: boolean): void {
    if (claim.state === "already_booked") return;
    const amountUnits = succeeded ? claim.amountUnits : 0;
    const costBasis: PhylaxUsageCostBasis = succeeded ? claim.costBasis : "unavailable";
    if (claim.state === "paused" && claim.work) {
      // Some channel paths intentionally forward raw custody instead of
      // retaining a resumable STT job. Terminalize that abandoned admission so
      // a later grant cannot reserve allowance for work nobody will claim.
      try {
        this.ledger.cancelPaidWork({ workId: claim.work.id, tenantId: claim.tenantId });
      } catch {
        // Raw custody/forwarding must not be lost because local cancellation
        // raced another ledger mutation. An actively claimed worker owns any
        // resulting terminal settlement.
      }
      return;
    }
    if (claim.state === "compatibility_pending") {
      this.buffer({ ...claim, amountUnits, costBasis });
      return;
    }
    if (claim.state !== "processing" || !claim.work?.leaseOwner || !claim.work.leaseToken) return;
    try {
      this.ledger.completePaidWork({
        workId: claim.work.id,
        tenantId: claim.tenantId,
        leaseOwner: claim.work.leaseOwner,
        leaseToken: claim.work.leaseToken,
        amountUnits,
        providerEventId: claim.providerEventId,
        provider: claim.provider,
        model: claim.model,
        costBasis,
        idempotencyKey: `usage:${claim.providerEventId}:${claim.operation}`,
        tariffVersion: this.tariff.version,
        auditReason: "Phylax-local transcription usage",
      });
    } catch {
      // The provider result/raw custody is already durable. Tie fallback
      // settlement to the original reservation so cancellation/restart cannot
      // leak it or call STT again.
      this.bufferPaidWork(claim, claim.providerEventId, amountUnits, costBasis);
    }
  }

  beginDelivery(input: PhylaxDeliveryUsageInput): PhylaxUsageClaim {
    this.reconcilePending(input.tenantId);
    const common = {
      tenantId: input.tenantId,
      providerEventId: input.providerMessageId,
      operation: `channel.outbound.${input.channel}`,
      amountUnits: this.tariff.outboundMessageUnits,
      provider: input.channel,
      model: null,
      costBasis: "estimated" as const,
    };
    const bufferedReceipt = this.deliveryReceipt(input.tenantId, input.providerMessageId, common.operation);
    if (bufferedReceipt) {
      return { state: "already_booked", ...common, providerReceiptId: bufferedReceipt };
    }
    const projection = this.ledger.customerProjection(input.tenantId);
    if (!projection.periodId || projection.state === "unavailable") {
      return { state: "paused", ...common };
    }
    const admission = this.ledger.admitPaidWork({
      tenantId: input.tenantId,
      periodId: projection.periodId,
      idempotencyKey: `paid:${input.providerMessageId}:${common.operation}`,
      providerEventId: input.providerMessageId,
      operation: common.operation,
      custodyRef: input.custodyRef,
      estimatedUnits: common.amountUnits,
    });
    if (admission.work.state === "done") {
      return {
        state: "already_booked",
        ...common,
        work: admission.work,
        ...(admission.work.providerReceiptId
          ? { providerReceiptId: admission.work.providerReceiptId }
          : {}),
      };
    }
    if (admission.work.state === "cancelled") {
      return { state: "abandoned", ...common, work: admission.work };
    }
    if (
      admission.work.state !== "ready"
    ) {
      return { state: "paused", ...common, work: admission.work };
    }
    const claimed = this.ledger.claimPaidWork(
      admission.work.id,
      input.tenantId,
      this.workerId,
      DEFAULT_LEASE_MS,
      this.now(),
    );
    return claimed
      ? { state: "processing", ...common, work: claimed }
      : { state: "paused", ...common, work: admission.work };
  }

  completeDelivery(
    claim: PhylaxUsageClaim,
    providerReceiptId: string | null,
  ): PhylaxLedgerMutation | void {
    if (claim.state === "already_booked") return;
    const succeeded = Boolean(providerReceiptId?.trim());
    const amountUnits = succeeded ? claim.amountUnits : 0;
    const costBasis: PhylaxUsageCostBasis = succeeded ? claim.costBasis : "unavailable";
    if (claim.state === "compatibility_pending") {
      if (providerReceiptId?.trim()) {
        this.bufferDelivery(claim, providerReceiptId.trim(), amountUnits, costBasis);
      }
      return;
    }
    if (claim.state !== "processing" || !claim.work?.leaseOwner || !claim.work.leaseToken) return;
    if (providerReceiptId?.trim()) {
      try {
        return this.ledger.completePaidWorkFromDurableReceipt({
          workId: claim.work.id,
          tenantId: claim.tenantId,
          admissionProviderEventId: claim.providerEventId,
          providerReceiptId: providerReceiptId.trim(),
          amountUnits,
          provider: claim.provider,
          model: null,
          costBasis,
          tariffVersion: this.tariff.version,
          auditReason: "Phylax-local outbound channel usage",
        }).usage;
      } catch {
        // The exact provider receipt is irreversible. Persist it with the
        // original paid-work identity before returning to the channel seam;
        // beginDelivery will suppress replay even until ledger reconciliation.
        this.bufferPaidWork(claim, providerReceiptId.trim(), amountUnits, costBasis);
        return;
      }
    }
    try {
      this.ledger.releasePaidWorkForRetry({
        workId: claim.work.id,
        tenantId: claim.tenantId,
        leaseOwner: claim.work.leaseOwner,
        leaseToken: claim.work.leaseToken,
      });
    } catch {
      // No provider receipt exists, so a future lease may safely retry.
    }
    return;
  }

  /** Abandon an admitted delivery representation before any provider receipt. */
  abandonDelivery(claim: PhylaxUsageClaim): void {
    if (claim.state !== "processing" || !claim.work?.leaseOwner || !claim.work.leaseToken) return;
    this.ledger.cancelPaidWork({
      workId: claim.work.id,
      tenantId: claim.tenantId,
      leaseOwner: claim.work.leaseOwner,
      leaseToken: claim.work.leaseToken,
    });
  }

  /** Read-only crash recovery; never admits, reserves, claims or sends work. */
  recoverDeliveryReceipt(input: {
    tenantId: string;
    providerMessageId: string;
    channel: "whatsapp" | "telegram";
  }): string | null {
    const operation = `channel.outbound.${input.channel}`;
    return this.deliveryReceipt(input.tenantId, input.providerMessageId, operation)
      ?? this.ledger.paidWorkReceipt(input.tenantId, input.providerMessageId, operation);
  }

  setWorkReadyCallback(callback: (() => void) | null): void {
    this.workReadyCallback = callback;
    if (callback && this.ledger.reconcileExpiredPaidWork() > 0) callback();
  }

  /** Keep a long-running STT lease live; stopping never mutates its outcome. */
  maintainTranscriptionLease(claim: PhylaxUsageClaim): () => void {
    if (claim.state !== "processing" || !claim.work?.leaseOwner || !claim.work.leaseToken) {
      return () => {};
    }
    const timer = setInterval(() => {
      try {
        this.ledger.renewPaidWorkLease({
          workId: claim.work!.id,
          tenantId: claim.tenantId,
          leaseOwner: claim.work!.leaseOwner!,
          leaseToken: claim.work!.leaseToken!,
          leaseMs: DEFAULT_LEASE_MS,
        });
      } catch {
        // Completion/recovery owns the durable result if renewal races a local
        // ledger outage or terminal cancellation.
      }
    }, LEASE_RENEW_INTERVAL_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  recordInboundMessage(input: {
    tenantId: string;
    providerMessageId: string;
    channel: "whatsapp" | "telegram";
  }): void {
    const event = {
      tenantId: input.tenantId,
      providerEventId: input.providerMessageId,
      operation: `channel.inbound.${input.channel}`,
      amountUnits: this.tariff.inboundMessageUnits,
      provider: input.channel,
      model: null,
      costBasis: "estimated" as const,
    };
    this.reconcilePending(input.tenantId);
    const projection = this.ledger.customerProjection(input.tenantId);
    if (!projection.periodId || projection.state === "unavailable") {
      this.buffer(event);
      return;
    }
    try {
      this.ledger.recordUsage({
        tenantId: event.tenantId,
        periodId: projection.periodId,
        amountUnits: event.amountUnits,
        providerEventId: event.providerEventId,
        operation: event.operation,
        provider: event.provider,
        model: null,
        costBasis: event.costBasis,
        idempotencyKey: `usage:${event.providerEventId}:${event.operation}`,
        tariffVersion: this.tariff.version,
        auditReason: "Phylax-local inbound channel usage",
      });
    } catch {
      // The provider message already exists. Preserve accounting for a later
      // allowance reconciliation without turning it into a duplicate delivery.
      this.buffer(event);
    }
  }

  pending(tenantId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS total FROM phylax_usage_compat WHERE tenant_id=? AND booked_at IS NULL",
    ).get(tenantId) as { total: number };
    return Number(row.total);
  }

  reconcileAllPending(): number {
    const tenants = this.db.prepare(
      "SELECT DISTINCT tenant_id FROM phylax_usage_compat WHERE booked_at IS NULL ORDER BY tenant_id",
    ).all() as unknown as Array<{ tenant_id: string }>;
    return tenants.reduce((total, row) => total + this.reconcilePending(row.tenant_id), 0);
  }

  reconcilePending(tenantId: string): number {
    const rows = this.db.prepare(
      `SELECT tenant_id, provider_event_id, operation, amount_units,
              provider, model, cost_basis, occurred_at,
              paid_work_id, intent_provider_event_id
       FROM phylax_usage_compat
       WHERE tenant_id=? AND booked_at IS NULL
       ORDER BY occurred_at, provider_event_id, operation`,
    ).all(tenantId) as unknown as PendingRow[];
    const projection = this.ledger.customerProjection(tenantId);
    let booked = 0;
    for (const row of rows) {
      try {
        if (row.paid_work_id && row.intent_provider_event_id) {
          this.ledger.completePaidWorkFromDurableReceipt({
            workId: row.paid_work_id,
            tenantId: row.tenant_id,
            admissionProviderEventId: row.intent_provider_event_id,
            providerReceiptId: row.provider_event_id,
            amountUnits: row.amount_units,
            provider: row.provider,
            model: row.model,
            costBasis: row.cost_basis,
            tariffVersion: this.tariff.version,
            auditReason: "Reconciled Phylax provider receipt",
          });
        } else {
          if (!projection.periodId || projection.state === "unavailable") continue;
          this.ledger.recordUsage({
            tenantId: row.tenant_id,
            periodId: projection.periodId,
            amountUnits: row.amount_units,
            providerEventId: row.provider_event_id,
            operation: row.operation,
            provider: row.provider,
            model: row.model,
            costBasis: row.cost_basis,
            idempotencyKey: `usage:${row.provider_event_id}:${row.operation}`,
            tariffVersion: this.tariff.version,
            auditReason: "Reconciled Phylax rolling-upgrade usage",
          });
        }
        this.db.prepare(
          `UPDATE phylax_usage_compat SET booked_at=?
           WHERE tenant_id=? AND provider_event_id=? AND operation=? AND booked_at IS NULL`,
        ).run(this.now(), row.tenant_id, row.provider_event_id, row.operation);
        booked += 1;
      } catch {
        // A future grant/adjustment or matching billing period may make it
        // bookable. Leave the exact event pending; never invent another key.
      }
    }
    return booked;
  }

  close(): void {
    clearInterval(this.sweepTimer);
    this.db.close();
  }

  private buffer(input: {
    tenantId: string;
    providerEventId: string;
    operation: string;
    amountUnits: number;
    provider: string;
    model: string | null;
    costBasis: PhylaxUsageCostBasis;
  }): void {
    this.db.prepare(
      `INSERT INTO phylax_usage_compat
       (tenant_id, provider_event_id, operation, amount_units, provider,
        model, cost_basis, occurred_at, booked_at, paid_work_id, intent_provider_event_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
       ON CONFLICT (tenant_id, provider_event_id, operation) DO NOTHING`,
    ).run(
      input.tenantId,
      input.providerEventId,
      input.operation,
      input.amountUnits,
      input.provider,
      input.model,
      input.costBasis,
      this.now(),
    );
  }

  private bufferPaidWork(
    claim: PhylaxUsageClaim,
    providerReceiptId: string,
    amountUnits: number,
    costBasis: PhylaxUsageCostBasis,
  ): void {
    this.db.prepare(
      `INSERT INTO phylax_usage_compat
       (tenant_id, provider_event_id, operation, amount_units, provider,
        model, cost_basis, occurred_at, booked_at, paid_work_id, intent_provider_event_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT (tenant_id, provider_event_id, operation) DO NOTHING`,
    ).run(
      claim.tenantId,
      providerReceiptId,
      claim.operation,
      amountUnits,
      claim.provider,
      claim.model,
      costBasis,
      this.now(),
      claim.work?.id ?? null,
      claim.providerEventId,
    );
  }

  private bufferDelivery(
    claim: PhylaxUsageClaim,
    providerReceiptId: string,
    amountUnits: number,
    costBasis: PhylaxUsageCostBasis,
  ): void {
    this.bufferPaidWork(claim, providerReceiptId, amountUnits, costBasis);
  }

  private deliveryReceipt(tenantId: string, intentProviderEventId: string, operation: string): string | null {
    const row = this.db.prepare(
      `SELECT provider_event_id FROM phylax_usage_compat
       WHERE tenant_id=? AND intent_provider_event_id=? AND operation=?
       ORDER BY occurred_at DESC LIMIT 1`,
    ).get(tenantId, intentProviderEventId, operation) as { provider_event_id?: unknown } | undefined;
    return typeof row?.provider_event_id === "string" && row.provider_event_id.trim()
      ? row.provider_event_id.trim()
      : null;
  }
}
