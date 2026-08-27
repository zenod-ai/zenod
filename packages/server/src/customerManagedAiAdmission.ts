import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { CustomerUsageProjection } from "./customerMetering.js";
import { openZenodSqlite } from "./sqlite.js";

export type ManagedAiRawKind = "text" | "audio" | "image";
export type ManagedAiAdmissionStatus =
  | "queued"
  | "processing"
  | "paused_at_cap"
  | "waiting_for_usage"
  | "resume_pending"
  | "done"
  | "error";

export interface ManagedAiTerminalReceipt {
  state: "completed" | "failed";
  statusCode: number;
  contentType: string | null;
  body: string;
  completedAt: string;
}

export type ManagedAiAdmissionNoticeKind = "paused" | "terminal";
export type ManagedAiAdmissionNoticeState = "pending" | "sending" | "sent" | "failed";

export interface ManagedAiAdmissionNotice {
  state: ManagedAiAdmissionNoticeState;
  updatedAt: number;
}

export interface ManagedAiAdmissionJob {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  kind: ManagedAiRawKind;
  method: string;
  path: string;
  contentType: string | null;
  status: ManagedAiAdmissionStatus;
  resetsAt: string | null;
  attempts: number;
  leaseUntil: number | null;
  terminalReceipt: ManagedAiTerminalReceipt | null;
  pausedNotice: ManagedAiAdmissionNotice | null;
  terminalNotice: ManagedAiAdmissionNotice | null;
  createdAt: number;
  updatedAt: number;
}

export interface ManagedAiAdmissionInput {
  tenantId: string;
  idempotencyKey: string;
  kind: ManagedAiRawKind;
  method: string;
  path: string;
  contentType: string | null;
  raw: Uint8Array;
}

interface Row {
  id: string;
  tenant_id: string;
  idempotency_key: string;
  kind: ManagedAiRawKind;
  method: string;
  path: string;
  content_type: string | null;
  raw_body: Uint8Array;
  status: ManagedAiAdmissionStatus;
  resets_at: string | null;
  attempts: number;
  lease_owner: string | null;
  lease_until: number | null;
  terminal_receipt: string | null;
  paused_notice_state: ManagedAiAdmissionNoticeState | null;
  paused_notice_updated_at: number | null;
  terminal_notice_state: ManagedAiAdmissionNoticeState | null;
  terminal_notice_updated_at: number | null;
  created_at: number;
  updated_at: number;
}

function job(row: Row): ManagedAiAdmissionJob {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    idempotencyKey: row.idempotency_key,
    kind: row.kind,
    method: row.method,
    path: row.path,
    contentType: row.content_type,
    status: row.status,
    resetsAt: row.resets_at,
    attempts: row.attempts,
    leaseUntil: row.lease_until,
    terminalReceipt: row.terminal_receipt
      ? JSON.parse(row.terminal_receipt) as ManagedAiTerminalReceipt
      : null,
    pausedNotice: row.paused_notice_state && row.paused_notice_updated_at !== null
      ? { state: row.paused_notice_state, updatedAt: row.paused_notice_updated_at }
      : null,
    terminalNotice: row.terminal_notice_state && row.terminal_notice_updated_at !== null
      ? { state: row.terminal_notice_state, updatedAt: row.terminal_notice_updated_at }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ManagedAiPaidWorkResult<T> {
  value: T;
  receipt: ManagedAiTerminalReceipt;
}

export type ManagedAiAdmissionOutcome<T> =
  | { state: "processed"; job: ManagedAiAdmissionJob; value: T }
  | { state: "failed"; job: ManagedAiAdmissionJob; receipt: ManagedAiTerminalReceipt }
  | { state: "replayed"; job: ManagedAiAdmissionJob; receipt: ManagedAiTerminalReceipt }
  | { state: "processing" | "paused_at_cap" | "waiting_for_usage"; job: ManagedAiAdmissionJob };

/**
 * Durable raw-evidence admission queue. The INSERT happens before any paid
 * processor is invoked; terminal receipts are compare-and-set exactly once.
 */
export class CustomerManagedAiAdmissionQueue {
  private readonly db: DatabaseSync;
  private readonly ownerId = randomUUID();

  constructor(
    path: string,
    private readonly now: () => number = Date.now,
    private readonly afterProcessorBeforeReceipt?: () => void | Promise<void>,
    private readonly beforeJournal?: () => void,
  ) {
    this.db = openZenodSqlite(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS customer_managed_ai_admission (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        content_type TEXT,
        raw_body BLOB NOT NULL,
        status TEXT NOT NULL,
        resets_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        lease_owner TEXT,
        lease_until INTEGER,
        terminal_receipt TEXT,
        paused_notice_state TEXT,
        paused_notice_updated_at INTEGER,
        terminal_notice_state TEXT,
        terminal_notice_updated_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(tenant_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS customer_managed_ai_admission_pending
        ON customer_managed_ai_admission(status, resets_at, created_at);
    `);
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(customer_managed_ai_admission)").all() as Array<{ name: string }>)
        .map((column) => column.name),
    );
    if (!columns.has("lease_owner")) {
      this.db.exec("ALTER TABLE customer_managed_ai_admission ADD COLUMN lease_owner TEXT");
    }
    if (!columns.has("lease_until")) {
      this.db.exec("ALTER TABLE customer_managed_ai_admission ADD COLUMN lease_until INTEGER");
    }
    if (!columns.has("paused_notice_state")) {
      this.db.exec("ALTER TABLE customer_managed_ai_admission ADD COLUMN paused_notice_state TEXT");
    }
    if (!columns.has("paused_notice_updated_at")) {
      this.db.exec("ALTER TABLE customer_managed_ai_admission ADD COLUMN paused_notice_updated_at INTEGER");
    }
    if (!columns.has("terminal_notice_state")) {
      this.db.exec("ALTER TABLE customer_managed_ai_admission ADD COLUMN terminal_notice_state TEXT");
    }
    if (!columns.has("terminal_notice_updated_at")) {
      this.db.exec("ALTER TABLE customer_managed_ai_admission ADD COLUMN terminal_notice_updated_at INTEGER");
    }
  }

  async submit<T>(
    input: ManagedAiAdmissionInput,
    usage: CustomerUsageProjection,
    processor: (input: ManagedAiAdmissionInput) => Promise<ManagedAiPaidWorkResult<T>>,
  ): Promise<ManagedAiAdmissionOutcome<T>> {
    const existing = this.journal(input, usage);
    if (existing.terminalReceipt) return { state: "replayed", job: existing, receipt: existing.terminalReceipt };
    if (existing.status === "processing" && (existing.leaseUntil ?? 0) > this.now()) {
      return { state: "processing", job: existing };
    }
    if (usage.state === "paused") {
      const paused = this.setWaiting(existing.id, "paused_at_cap", usage.resetsAt);
      return { state: "paused_at_cap", job: paused };
    }
    if (usage.state === "setting_up" || usage.state === "unavailable") {
      const waiting = this.setWaiting(existing.id, "waiting_for_usage", usage.resetsAt);
      return { state: "waiting_for_usage", job: waiting };
    }
    if (!this.claim(existing.id)) return { state: "processing", job: this.get(existing.id)! };
    const heartbeat = this.startHeartbeat(existing.id);
    let receiptFaultSeamReached = false;
    try {
      const result = await processor(this.input(existing.id));
      receiptFaultSeamReached = true;
      await this.afterProcessorBeforeReceipt?.();
      const completed = this.completeOnce(existing.id, result.receipt);
      return { state: "processed", job: completed, value: result.value };
    } catch {
      // A test-only process-death seam must leave the durable processing claim
      // intact so restart/lease recovery exercises the real crash window.
      if (receiptFaultSeamReached && this.afterProcessorBeforeReceipt) throw new Error("simulated admission process death");
      const receipt: ManagedAiTerminalReceipt = {
        state: "failed",
        statusCode: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "managed processing failed" }),
        completedAt: new Date(this.now()).toISOString(),
      };
      const failed = this.completeOnce(existing.id, receipt);
      return { state: "failed", job: failed, receipt: failed.terminalReceipt ?? receipt };
    } finally {
      clearInterval(heartbeat);
    }
  }

  async resume(
    usageForTenant: (tenantId: string) => Promise<CustomerUsageProjection>,
    processor: (input: ManagedAiAdmissionInput) => Promise<ManagedAiPaidWorkResult<unknown>>,
  ): Promise<number> {
    let completed = 0;
    for (const pending of this.pending()) {
      if (pending.status === "paused_at_cap" && pending.resetsAt) {
        const reset = Date.parse(pending.resetsAt);
        if (Number.isFinite(reset) && reset > this.now()) continue;
      }
      const usage = await usageForTenant(pending.tenantId);
      if (usage.state === "paused") {
        this.setWaiting(pending.id, "paused_at_cap", usage.resetsAt);
        continue;
      }
      if (usage.state === "setting_up" || usage.state === "unavailable") {
        this.setWaiting(pending.id, "waiting_for_usage", usage.resetsAt);
        continue;
      }
      if (!this.claim(pending.id)) continue;
      const heartbeat = this.startHeartbeat(pending.id);
      try {
        const result = await processor(this.input(pending.id));
        this.completeOnce(pending.id, result.receipt);
      } catch {
        this.completeOnce(pending.id, {
          state: "failed",
          statusCode: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "managed processing failed" }),
          completedAt: new Date(this.now()).toISOString(),
        });
      } finally {
        clearInterval(heartbeat);
      }
      completed += 1;
    }
    return completed;
  }

  get(id: string): ManagedAiAdmissionJob | null {
    const row = this.row(id);
    return row ? job(row) : null;
  }

  getForTenant(id: string, tenantId: string): ManagedAiAdmissionJob | null {
    const row = this.db.prepare(
      `SELECT * FROM customer_managed_ai_admission WHERE id=? AND tenant_id=?`,
    ).get(id, tenantId) as unknown as Row | undefined;
    return row ? job(row) : null;
  }

  getByIdempotencyKey(tenantId: string, idempotencyKey: string): ManagedAiAdmissionJob | null {
    const row = this.db.prepare(
      `SELECT * FROM customer_managed_ai_admission WHERE tenant_id=? AND idempotency_key=?`,
    ).get(tenantId, idempotencyKey) as unknown as Row | undefined;
    return row ? job(row) : null;
  }

  raw(id: string): Uint8Array | null {
    return this.row(id)?.raw_body ?? null;
  }

  noticeCandidates(): ManagedAiAdmissionJob[] {
    const rows = this.db.prepare(
      `SELECT * FROM customer_managed_ai_admission
       WHERE path='/internal/telegram'
         AND (paused_notice_state='pending' OR terminal_notice_state='pending')
       ORDER BY created_at ASC`,
    ).all() as unknown as Row[];
    return rows.map(job);
  }

  /**
   * Atomically claims a provider delivery intent. A claim is deliberately
   * attempt-once: if a process dies after Telegram accepts the message but
   * before we persist `sent`, restart leaves `sending` untouched rather than
   * risking a duplicate customer notice.
   */
  claimNotice(id: string, kind: ManagedAiAdmissionNoticeKind): ManagedAiAdmissionJob | null {
    const prefix = kind === "paused" ? "paused" : "terminal";
    const result = this.db.prepare(
      `UPDATE customer_managed_ai_admission
       SET ${prefix}_notice_state='sending', ${prefix}_notice_updated_at=?, updated_at=?
       WHERE id=? AND ${prefix}_notice_state='pending'`,
    ).run(this.now(), this.now(), id);
    return Number(result.changes) === 1 ? this.get(id) : null;
  }

  completeNotice(id: string, kind: ManagedAiAdmissionNoticeKind, sent: boolean): ManagedAiAdmissionJob {
    const prefix = kind === "paused" ? "paused" : "terminal";
    this.db.prepare(
      `UPDATE customer_managed_ai_admission
       SET ${prefix}_notice_state=?, ${prefix}_notice_updated_at=?, updated_at=?
       WHERE id=? AND ${prefix}_notice_state='sending'`,
    ).run(sent ? "sent" : "failed", this.now(), this.now(), id);
    const stored = this.get(id);
    if (!stored) throw new Error("managed AI admission job disappeared during notice delivery");
    return stored;
  }

  close(): void {
    this.db.close();
  }

  private journal(input: ManagedAiAdmissionInput, usage: CustomerUsageProjection): ManagedAiAdmissionJob {
    this.beforeJournal?.();
    const now = this.now();
    const initial: ManagedAiAdmissionStatus =
      usage.state === "paused" ? "paused_at_cap" : usage.state === "unavailable" ? "waiting_for_usage" : "queued";
    this.db.prepare(
      `INSERT OR IGNORE INTO customer_managed_ai_admission
       (id, tenant_id, idempotency_key, kind, method, path, content_type, raw_body,
        status, resets_at, paused_notice_state, paused_notice_updated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      input.tenantId,
      input.idempotencyKey,
      input.kind,
      input.method.toUpperCase(),
      input.path,
      input.contentType,
      Buffer.from(input.raw),
      initial,
      usage.resetsAt,
      initial === "paused_at_cap" && input.path === "/internal/telegram" ? "pending" : null,
      initial === "paused_at_cap" && input.path === "/internal/telegram" ? now : null,
      now,
      now,
    );
    const row = this.db.prepare(
      `SELECT * FROM customer_managed_ai_admission WHERE tenant_id=? AND idempotency_key=?`,
    ).get(input.tenantId, input.idempotencyKey) as unknown as Row;
    return job(row);
  }

  private claim(id: string, leaseMs = 5 * 60_000): boolean {
    const now = this.now();
    const result = this.db.prepare(
      `UPDATE customer_managed_ai_admission
       SET status='processing', attempts=attempts+1, lease_owner=?, lease_until=?, updated_at=?
       WHERE id=? AND terminal_receipt IS NULL
         AND (
           status IN ('queued','paused_at_cap','waiting_for_usage','resume_pending')
           OR (status='processing' AND (lease_until IS NULL OR lease_until<=?))
         )`,
    ).run(this.ownerId, now + leaseMs, now, id, now);
    return Number(result.changes) === 1;
  }

  private renew(id: string, leaseMs = 5 * 60_000): boolean {
    const now = this.now();
    const result = this.db.prepare(
      `UPDATE customer_managed_ai_admission
       SET lease_until=?, updated_at=?
       WHERE id=? AND terminal_receipt IS NULL AND status='processing'
         AND lease_owner=? AND lease_until>?`,
    ).run(now + leaseMs, now, id, this.ownerId, now);
    return Number(result.changes) === 1;
  }

  private startHeartbeat(id: string): ReturnType<typeof setInterval> {
    const timer = setInterval(() => {
      this.renew(id);
    }, 60_000);
    timer.unref?.();
    return timer;
  }

  private setWaiting(
    id: string,
    status: "paused_at_cap" | "waiting_for_usage",
    resetsAt: string | null,
  ): ManagedAiAdmissionJob {
    this.db.prepare(
      `UPDATE customer_managed_ai_admission
       SET status=?, resets_at=?, lease_owner=NULL, lease_until=NULL,
           paused_notice_state=CASE
             WHEN ?='paused_at_cap' AND path='/internal/telegram' AND paused_notice_state IS NULL THEN 'pending'
             ELSE paused_notice_state
           END,
           paused_notice_updated_at=CASE
             WHEN ?='paused_at_cap' AND path='/internal/telegram' AND paused_notice_state IS NULL THEN ?
             ELSE paused_notice_updated_at
           END,
           updated_at=?
       WHERE id=? AND terminal_receipt IS NULL
         AND (status!='processing' OR lease_owner=? OR lease_until IS NULL OR lease_until<=?)`,
    ).run(status, resetsAt, status, status, this.now(), this.now(), id, this.ownerId, this.now());
    return this.get(id)!;
  }

  private completeOnce(id: string, receipt: ManagedAiTerminalReceipt): ManagedAiAdmissionJob {
    const result = this.db.prepare(
      `UPDATE customer_managed_ai_admission
       SET status=?, terminal_receipt=?, lease_owner=NULL, lease_until=NULL,
           terminal_notice_state=CASE WHEN path='/internal/telegram' THEN 'pending' ELSE terminal_notice_state END,
           terminal_notice_updated_at=CASE WHEN path='/internal/telegram' THEN ? ELSE terminal_notice_updated_at END,
           updated_at=?
       WHERE id=? AND terminal_receipt IS NULL AND status='processing' AND lease_owner=?`,
    ).run(
      receipt.state === "completed" ? "done" : "error",
      JSON.stringify(receipt),
      this.now(),
      this.now(),
      id,
      this.ownerId,
    );
    const stored = this.get(id)!;
    if (Number(result.changes) !== 1 && !stored.terminalReceipt) {
      throw new Error("managed AI admission lease was lost before completion");
    }
    return stored;
  }

  private input(id: string): ManagedAiAdmissionInput {
    const row = this.row(id);
    if (!row) throw new Error("managed AI admission job disappeared");
    return {
      tenantId: row.tenant_id,
      idempotencyKey: row.idempotency_key,
      kind: row.kind,
      method: row.method,
      path: row.path,
      contentType: row.content_type,
      raw: row.raw_body,
    };
  }

  private pending(): ManagedAiAdmissionJob[] {
    const rows = this.db.prepare(
      `SELECT * FROM customer_managed_ai_admission
       WHERE terminal_receipt IS NULL
         AND (
           status IN ('queued','paused_at_cap','waiting_for_usage','resume_pending')
           OR (status='processing' AND (lease_until IS NULL OR lease_until<=?))
         )
       ORDER BY created_at ASC`,
    ).all(this.now()) as unknown as Row[];
    return rows.map(job);
  }

  private row(id: string): Row | null {
    return (this.db.prepare(
      `SELECT * FROM customer_managed_ai_admission WHERE id=?`,
    ).get(id) as unknown as Row | undefined) ?? null;
  }
}
