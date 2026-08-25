import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { openZenodSqlite } from "./sqlite.js";
import type { ManagedAiAdmissionInput } from "./customerManagedAiAdmission.js";

const DEFAULT_LEASE_MS = 4 * 60_000;

interface OutboxRow {
  tenant_id: string;
  idempotency_key: string;
  request_hash: string;
  status: "processing" | "completed" | "failed" | "interrupted";
  owner_id: string | null;
  lease_expires_at: number | null;
  status_code: number | null;
  content_type: string | null;
  body: string | null;
}

export interface ManagedAiDownstreamOutboxOptions {
  now?: () => number;
  leaseMs?: number;
  /** Fault-injection seam: models a process death after downstream commit. */
  afterProcessorBeforePersist?: () => void | Promise<void>;
}

/**
 * Durable idempotency boundary immediately around paid/mutating downstream work.
 * Admission can crash after this boundary without executing the operation again.
 * If the process dies inside the boundary, the expired claim becomes a terminal,
 * truthful interruption instead of being replayed speculatively.
 */
export class ManagedAiDownstreamOutbox {
  private readonly db: DatabaseSync;
  private readonly ownerId = randomUUID();
  private readonly now: () => number;
  private readonly leaseMs: number;

  constructor(path: string, private readonly options: ManagedAiDownstreamOutboxOptions = {}) {
    this.db = openZenodSqlite(path);
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS managed_ai_downstream_outbox (
        tenant_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        owner_id TEXT,
        lease_expires_at INTEGER,
        status_code INTEGER,
        content_type TEXT,
        body TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, idempotency_key)
      );
    `);
  }

  async execute(input: ManagedAiAdmissionInput, processor: () => Promise<Response>): Promise<Response> {
    const hash = requestHash(input);
    const now = this.now();
    this.db.prepare(
      `INSERT INTO managed_ai_downstream_outbox
         (tenant_id, idempotency_key, request_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, 'processing', ?, ?)
       ON CONFLICT DO NOTHING`,
    ).run(input.tenantId, input.idempotencyKey, hash, now, now);

    let row = this.get(input.tenantId, input.idempotencyKey)!;
    if (row.request_hash !== hash) {
      return Response.json({ error: "idempotency key was already used for different input" }, { status: 409 });
    }
    if (row.status !== "processing") return responseFromRow(row);
    if (row.owner_id !== null) {
      return row.lease_expires_at !== null && row.lease_expires_at <= now
        ? this.interrupted(input, now)
        : Response.json({ error: "managed operation is already processing" }, { status: 425 });
    }

    const claimed = this.db.prepare(
      `UPDATE managed_ai_downstream_outbox
       SET owner_id=?, lease_expires_at=?, updated_at=?
       WHERE tenant_id=? AND idempotency_key=? AND status='processing'
         AND owner_id IS NULL`,
    ).run(this.ownerId, now + this.leaseMs, now, input.tenantId, input.idempotencyKey);

    if (claimed.changes !== 1) {
      row = this.get(input.tenantId, input.idempotencyKey)!;
      // A concurrent owner is still live. Do not start a second paid invocation;
      // the caller receives a stable non-terminal response and admission retries.
      return Response.json({ error: "managed operation is already processing" }, { status: 425 });
    }

    try {
      const response = await processor();
      await this.options.afterProcessorBeforePersist?.();
      const body = await response.clone().text();
      const status = response.ok ? "completed" : "failed";
      this.db.prepare(
        `UPDATE managed_ai_downstream_outbox
         SET status=?, status_code=?, content_type=?, body=?, owner_id=NULL,
             lease_expires_at=NULL, updated_at=?
         WHERE tenant_id=? AND idempotency_key=? AND status='processing' AND owner_id=?`,
      ).run(
        status,
        response.status,
        response.headers.get("content-type"),
        body,
        this.now(),
        input.tenantId,
        input.idempotencyKey,
        this.ownerId,
      );
      return responseFromRow(this.get(input.tenantId, input.idempotencyKey)!);
    } catch (error) {
      // A thrown processor may have crossed a mutation boundary. Retain the live
      // claim; after lease expiry it becomes a terminal interruption, never replay.
      throw error;
    }
  }

  private interrupted(input: ManagedAiAdmissionInput, now: number): Response {
    const body = JSON.stringify({
      error: "managed operation was interrupted after dispatch; it was not replayed",
      code: "downstream_interrupted",
    });
    this.db.prepare(
      `UPDATE managed_ai_downstream_outbox
       SET status='interrupted', status_code=503, content_type='application/json', body=?,
           owner_id=NULL, lease_expires_at=NULL, updated_at=?
       WHERE tenant_id=? AND idempotency_key=? AND status='processing'
         AND (owner_id IS NULL OR owner_id=? OR lease_expires_at<=?)`,
    ).run(body, now, input.tenantId, input.idempotencyKey, this.ownerId, now);
    return responseFromRow(this.get(input.tenantId, input.idempotencyKey)!);
  }

  private get(tenantId: string, idempotencyKey: string): OutboxRow | null {
    return this.db.prepare(
      `SELECT * FROM managed_ai_downstream_outbox WHERE tenant_id=? AND idempotency_key=?`,
    ).get(tenantId, idempotencyKey) as OutboxRow | undefined ?? null;
  }

  close(): void {
    this.db.close();
  }
}

function requestHash(input: ManagedAiAdmissionInput): string {
  return createHash("sha256")
    .update(`${input.method}\0${input.path}\0${input.contentType ?? ""}\0${input.kind}\0`)
    .update(input.raw)
    .digest("hex");
}

function responseFromRow(row: OutboxRow): Response {
  return new Response(row.body ?? "", {
    status: row.status_code ?? 503,
    headers: row.content_type ? { "content-type": row.content_type } : undefined,
  });
}
