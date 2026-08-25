import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { MemoryContentType, Reply, StoreResult, Surface, TaskingReply, WorkResult } from "zenod";
import { openZenodSqlite } from "./sqlite.js";

/**
 * Durable queue for long-running agentic MCP jobs (task_brain → handleTasking,
 * run_task → work, store_memory → store) — its own SQLite file on the /data
 * volume. The MCP tools
 * enqueue and return a job id at once; a background worker (taskJobQueue.ts)
 * drains it one at a time, fully decoupled from the HTTP connection; the caller
 * polls get_task_result. This is the fix for concurrent MCP calls timing out:
 * each agentic turn runs a multi-minute LLM loop and the vault is a single
 * serialized writer, so holding the HTTP request open never scaled — fan-out
 * callers blew past the MCP client / reverse-proxy idle timeout. A restart
 * marks in-flight jobs "interrupted" (not stuck "running") so they're visible.
 */

export type TaskJobKind = "chat" | "task" | "work" | "store" | "media_ingest";

export type TaskJobStatus = "queued" | "running" | "done" | "error" | "interrupted";

/** Non-terminal state a boot-time restart should surface as interrupted. */
const IN_FLIGHT_STATE = "running" as const;

// C-27 / #580 and D21 — "acknowledged writes are never lost". Durable capture jobs
// (`store` and `media_ingest`) interrupted by a restart are RE-QUEUED so the worker
// resumes/retries them to completion with the normal receipt. The retry bound prevents
// a repeatedly crashing job from looping forever.
const MAX_CAPTURE_RESUME_ATTEMPTS = 3;
export const TASK_JOB_LEASE_MS = 4 * 60_000;

export interface TaskJobInput {
  /** chat/task: the instruction sent through the shared conversational/tasking loop. */
  text?: string;
  /** chat/task: correlation/thread key; defaults to "mcp". */
  conversationKey?: string;
  /** work: the objective to accomplish. */
  objective?: string;
  /** work: the user-approved plan (absent → propose mode). */
  plan?: string;
  /** store: the memory content to file through the librarian pipeline. */
  content?: string;
  /** store: optional filing hints. */
  hints?: string[];
  /** store: force verbatim evidence recording. */
  verbatim?: boolean;
  /** store: structural origin supplied by the integration. */
  source?: Surface;
  /** store: structural content type supplied by the integration. */
  contentType?: MemoryContentType;
  /** store: original source timestamp. */
  capturedAt?: string;
  /** store: stable source/provider entry identifier. */
  sourceId?: string;
  /** media_ingest: artifact class. */
  mediaType?: "audio" | "screenshot" | "image" | "pdf" | "document" | "link";
  /** media_ingest: fetchable raw artifact URL. */
  artifactUrl?: string;
  /** media_ingest: opaque staged-bytes reference from a transport/archive. */
  bytesRef?: string;
  /** media_ingest: original filename if known. */
  filename?: string;
  /** media_ingest: caller/source context. */
  sourceHint?: string;
  /** media_ingest: user filing/digest context. */
  contentHint?: string;
  /** media_ingest: original sender/source timestamp. */
  senderTimestamp?: string;
  /** media_ingest: optional filing hints. */
  mediaHints?: string[];
}

export interface MediaIngestReceipt {
  status: "done" | "error";
  code?: "media_ingest_processor_unavailable" | "unsupported_media_type";
  message: string;
  mediaType: string;
  source: {
    filename?: string;
    sourceHint?: string;
    senderTimestamp?: string;
    contentHint?: string;
    hints?: string[];
  };
  rawArtifact: {
    handle: string | null;
    archiveUrl: string | null;
    sha256?: string;
  };
  extraction: {
    handle: string | null;
    transcriptHandle?: string | null;
    ocrHandle?: string | null;
    archiveUrl?: string | null;
    provider: string | null;
  };
  digest: {
    evidenceRef: string | null;
    evidenceUrl?: string;
    pagesTouched: string[];
    pageUrls?: string[];
    commitSha: string | null;
    githubUrls: string[];
    filing?: "filed" | "uncertain" | "inbox" | "pending";
  };
  nextAdapterIssues?: string[];
}

export type TaskJobResult = Reply | TaskingReply | WorkResult | StoreResult | MediaIngestReceipt;

export interface TaskJob {
  id: string;
  kind: TaskJobKind;
  /** Durable caller identity for capture replay and legacy provenance recovery. */
  idempotencyKey: string | null;
  input: TaskJobInput;
  status: TaskJobStatus;
  result: TaskJobResult | null;
  error: string | null;
  /** How many times a boot-time restart resumed this job (C-27). */
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string;
  kind: string;
  idempotency_key: string | null;
  input_json: string;
  status: string;
  result_json: string | null;
  error: string | null;
  attempts: number | null;
  created_at: number;
  updated_at: number;
}

function rowToJob(row: Row): TaskJob {
  return {
    id: row.id,
    kind: row.kind as TaskJobKind,
    idempotencyKey: row.idempotency_key,
    input: JSON.parse(row.input_json || "{}") as TaskJobInput,
    status: row.status as TaskJobStatus,
    result: row.result_json ? (JSON.parse(row.result_json) as TaskJobResult) : null,
    error: row.error,
    attempts: row.attempts ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface TaskJobPatch {
  status?: TaskJobStatus;
  result?: TaskJobResult | null;
  error?: string | null;
}

export class TaskJobStore {
  private readonly db: DatabaseSync;
  private readonly tenantId: string;
  private readonly ownerId = randomUUID();

  constructor(path: string, tenantId = "standalone", now: () => number = Date.now) {
    const normalizedTenantId = tenantId.trim();
    if (!normalizedTenantId) throw new Error("TaskJobStore tenantId must not be empty");
    this.tenantId = normalizedTenantId;
    this.db = openZenodSqlite(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT 'standalone',
        idempotency_key TEXT,
        kind TEXT NOT NULL,
        input_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        result_json TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const migrations = [
      `ALTER TABLE task_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE task_jobs ADD COLUMN tenant_id TEXT`,
      `ALTER TABLE task_jobs ADD COLUMN idempotency_key TEXT`,
      `ALTER TABLE task_jobs ADD COLUMN owner_id TEXT`,
      `ALTER TABLE task_jobs ADD COLUMN lease_expires_at INTEGER`,
    ];
    for (const migration of migrations) {
      try {
        this.db.exec(migration);
      } catch {
        // column already exists
      }
    }
    // A legacy database belongs to the runtime opening it. New writes always set
    // tenant_id explicitly; this backfill is only for rows predating D14.
    this.db.prepare(`UPDATE task_jobs SET tenant_id=? WHERE tenant_id IS NULL OR tenant_id=''`).run(this.tenantId);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS task_jobs_tenant_status
        ON task_jobs(tenant_id, status, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS task_jobs_tenant_idempotency
        ON task_jobs(tenant_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `);
    this.recoverExpiredRunning(now());
  }

  /**
   * Recover only claims whose owner lease has expired. A rolling replacement
   * may open this database while the previous process is still serving, so
   * startup alone is not evidence that a running job was interrupted.
   */
  recoverExpiredRunning(now: number = Date.now()): void {
    // C-27 / #580 and D21 — expired durable-capture claims are re-queued so a
    // surviving worker resumes them, bounded by MAX_CAPTURE_RESUME_ATTEMPTS.
    this.db
      .prepare(
        `UPDATE task_jobs
         SET status='queued',
             attempts=attempts+1,
             owner_id=NULL,
             lease_expires_at=NULL,
             updated_at=?
         WHERE tenant_id=? AND status=? AND kind IN ('store', 'media_ingest') AND attempts < ?
           AND (lease_expires_at IS NULL OR lease_expires_at<=?)`,
      )
      .run(now, this.tenantId, IN_FLIGHT_STATE, MAX_CAPTURE_RESUME_ATTEMPTS, now);
    // Everything else still in-flight (non-write jobs — their durability lives in the
    // executor; and capture jobs that exhausted their retries) is surfaced as
    // interrupted so the caller's poll resolves instead of hanging.
    this.db
      .prepare(
        `UPDATE task_jobs
           SET status='interrupted',
               error=CASE WHEN kind IN ('store', 'media_ingest')
                          THEN 'interrupted by a server restart (gave up after ' || attempts || ' retries)'
                          ELSE 'interrupted by a server restart' END,
               owner_id=NULL,
               lease_expires_at=NULL,
               updated_at=?
         WHERE tenant_id=? AND status=?
           AND (lease_expires_at IS NULL OR lease_expires_at<=?)`,
      )
      .run(now, this.tenantId, IN_FLIGHT_STATE, now);
  }

  enqueue(
    kind: TaskJobKind,
    input: TaskJobInput,
    idempotencyKey?: string,
    now: number = Date.now(),
  ): TaskJob {
    const normalizedKey = idempotencyKey?.trim();
    if (idempotencyKey !== undefined && !normalizedKey) {
      throw new Error("idempotencyKey must not be empty");
    }
    if (normalizedKey && normalizedKey.length > 512) {
      throw new Error("idempotencyKey must be at most 512 characters");
    }
    if (normalizedKey && kind !== "chat" && kind !== "store" && kind !== "media_ingest") {
      throw new Error("idempotencyKey is only supported for durable channel/capture jobs");
    }

    const id = randomUUID();
    if (normalizedKey) {
      this.db
        .prepare(
          `INSERT INTO task_jobs
             (id, tenant_id, idempotency_key, kind, input_json, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)
           ON CONFLICT DO NOTHING`,
        )
        .run(id, this.tenantId, normalizedKey, kind, JSON.stringify(input), now, now);
      const existing = this.db
        .prepare(`SELECT * FROM task_jobs WHERE tenant_id=? AND idempotency_key=?`)
        .get(this.tenantId, normalizedKey) as Row | undefined;
      if (!existing) throw new Error("Failed to resolve idempotent capture job");
      return rowToJob(existing);
    }

    this.db
      .prepare(
        `INSERT INTO task_jobs
           (id, tenant_id, idempotency_key, kind, input_json, status, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, 'queued', ?, ?)`,
      )
      .run(id, this.tenantId, kind, JSON.stringify(input), now, now);
    return this.get(id)!;
  }

  /** Oldest queued job, or null. The worker drains these one at a time. */
  nextQueued(): TaskJob | null {
    const row = this.db
      .prepare(
        `SELECT * FROM task_jobs
         WHERE tenant_id=? AND status='queued'
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(this.tenantId) as Row | undefined;
    return row ? rowToJob(row) : null;
  }

  /**
   * Atomically take ownership of the oldest queued job. The status predicate is
   * repeated on the UPDATE so separate processes cannot both execute one row.
   */
  claimNextQueued(now: number = Date.now()): TaskJob | null {
    const row = this.db
      .prepare(
        `UPDATE task_jobs
         SET status='running', owner_id=?, lease_expires_at=?, updated_at=?
         WHERE tenant_id=? AND status='queued' AND id=(
           SELECT id FROM task_jobs
           WHERE tenant_id=? AND status='queued'
           ORDER BY created_at ASC
           LIMIT 1
         )
         RETURNING *`,
      )
      .get(this.ownerId, now + TASK_JOB_LEASE_MS, now, this.tenantId, this.tenantId) as Row | undefined;
    return row ? rowToJob(row) : null;
  }

  renewClaim(id: string, now: number = Date.now()): boolean {
    const result = this.db
      .prepare(
        `UPDATE task_jobs
         SET lease_expires_at=?, updated_at=?
         WHERE tenant_id=? AND id=? AND status='running' AND owner_id=?`,
      )
      .run(now + TASK_JOB_LEASE_MS, now, this.tenantId, id, this.ownerId);
    return result.changes === 1;
  }

  nextRunningLeaseExpiry(): number | null {
    const row = this.db
      .prepare(
        `SELECT MIN(lease_expires_at) AS lease_expires_at
         FROM task_jobs
         WHERE tenant_id=? AND status='running' AND lease_expires_at IS NOT NULL`,
      )
      .get(this.tenantId) as { lease_expires_at: number | null };
    return row.lease_expires_at;
  }

  get(id: string): TaskJob | null {
    const row = this.db
      .prepare(`SELECT * FROM task_jobs WHERE tenant_id=? AND id=?`)
      .get(this.tenantId, id) as Row | undefined;
    return row ? rowToJob(row) : null;
  }

  recent(limit = 25): TaskJob[] {
    const rows = this.db
      .prepare(`SELECT * FROM task_jobs WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?`)
      .all(this.tenantId, limit) as unknown as Row[];
    return rows.map(rowToJob);
  }

  update(id: string, patch: TaskJobPatch, now: number = Date.now()): void {
    this.applyPatch(id, patch, now, false);
  }

  /** Finish a job only while this store instance still owns its live claim. */
  updateClaimed(id: string, patch: TaskJobPatch, now: number = Date.now()): boolean {
    return this.applyPatch(id, patch, now, true);
  }

  private applyPatch(id: string, patch: TaskJobPatch, now: number, claimedOnly: boolean): boolean {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (col: string, val: unknown) => {
      sets.push(`${col}=?`);
      vals.push(val);
    };
    if (patch.status !== undefined) push("status", patch.status);
    if (patch.result !== undefined) push("result_json", patch.result ? JSON.stringify(patch.result) : null);
    if (patch.error !== undefined) push("error", patch.error);
    if (sets.length === 0) return false;
    if (claimedOnly && patch.status !== undefined && patch.status !== "running") {
      push("owner_id", null);
      push("lease_expires_at", null);
    }
    push("updated_at", now);
    vals.push(this.tenantId, id);
    if (claimedOnly) vals.push(this.ownerId);
    const result = this.db
      .prepare(
        `UPDATE task_jobs SET ${sets.join(", ")}
         WHERE tenant_id=? AND id=?${claimedOnly ? " AND status='running' AND owner_id=?" : ""}`,
      )
      .run(...(vals as never[]));
    return result.changes === 1;
  }

  close(): void {
    this.db.close();
  }
}
