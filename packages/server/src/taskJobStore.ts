import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { StoreResult, TaskingReply, WorkResult } from "zenod";
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

export type TaskJobKind = "task" | "work" | "store" | "media_ingest";

export type TaskJobStatus = "queued" | "running" | "done" | "error" | "interrupted";

/** Non-terminal state a boot-time restart should surface as interrupted. */
const IN_FLIGHT_STATE = "running" as const;

// C-27 / #580 — "acknowledged writes are never lost". A `store` job (vault filing +
// add_memory) that a restart interrupts is RE-QUEUED on boot so the worker resumes/retries
// it to completion with the normal receipt — bounded so a job that keeps crashing the
// server eventually fails honestly instead of looping forever.
const MAX_STORE_RESUME_ATTEMPTS = 3;

export interface ProvidedTranscript {
  text: string;
  source: string;
  version: string;
}

export interface TaskJobInput {
  /** task: the instruction sent through the shared tasking loop. */
  text?: string;
  /** task: correlation/thread key; defaults to "mcp". */
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
  /** media_ingest: upstream transcript that bypasses Zenod STT. */
  transcript?: ProvidedTranscript;
}

export interface MediaIngestReceipt {
  status: "done" | "error";
  code?: "media_ingest_processor_unavailable" | "unsupported_media_type";
  message: string;
  mediaType: string;
  source: {
    artifactUrl?: string;
    bytesRef?: string;
    filename?: string;
    sourceHint?: string;
    senderTimestamp?: string;
    contentHint?: string;
    hints?: string[];
    transcript?: {
      source: string;
      version: string;
    };
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
    pagesTouched: string[];
    commitSha: string | null;
    githubUrls: string[];
  };
  transcription?: "provided" | "performed";
  nextAdapterIssues?: string[];
}

export type TaskJobResult = TaskingReply | WorkResult | StoreResult | MediaIngestReceipt;

export interface TaskJob {
  id: string;
  kind: TaskJobKind;
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

  constructor(path: string, now: () => number = Date.now) {
    this.db = openZenodSqlite(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        input_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        result_json TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS task_jobs_status ON task_jobs(status, created_at);
    `);
    // C-27 migration: the resume-attempt counter (older DBs won't have it).
    try {
      this.db.exec(`ALTER TABLE task_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`);
    } catch {
      // column already exists
    }
    // C-27 / #580 — a restart killed any in-flight loop. WRITE jobs (kind 'store' — vault
    // filing + add_memory) must never be lost: RE-QUEUE them so the worker resumes/retries
    // to completion with the normal receipt, bounded by MAX_STORE_RESUME_ATTEMPTS.
    this.db
      .prepare(
        `UPDATE task_jobs SET status='queued', attempts=attempts+1, updated_at=?
         WHERE status=? AND kind='store' AND attempts < ?`,
      )
      .run(now(), IN_FLIGHT_STATE, MAX_STORE_RESUME_ATTEMPTS);
    // Everything else still in-flight (non-write jobs — their durability lives in the
    // executor; and 'store' jobs that already exhausted their retries) is surfaced as
    // interrupted so the caller's poll resolves instead of hanging.
    this.db
      .prepare(
        `UPDATE task_jobs
           SET status='interrupted',
               error=CASE WHEN kind='store'
                          THEN 'interrupted by a server restart (gave up after ' || attempts || ' retries)'
                          ELSE 'interrupted by a server restart' END,
               updated_at=?
         WHERE status=?`,
      )
      .run(now(), IN_FLIGHT_STATE);
  }

  enqueue(kind: TaskJobKind, input: TaskJobInput, now: number = Date.now()): TaskJob {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO task_jobs (id, kind, input_json, status, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', ?, ?)`,
      )
      .run(id, kind, JSON.stringify(input), now, now);
    return this.get(id)!;
  }

  /** Oldest queued job, or null. The worker drains these one at a time. */
  nextQueued(): TaskJob | null {
    const row = this.db
      .prepare(`SELECT * FROM task_jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1`)
      .get() as Row | undefined;
    return row ? rowToJob(row) : null;
  }

  get(id: string): TaskJob | null {
    const row = this.db.prepare(`SELECT * FROM task_jobs WHERE id=?`).get(id) as Row | undefined;
    return row ? rowToJob(row) : null;
  }

  recent(limit = 25): TaskJob[] {
    const rows = this.db
      .prepare(`SELECT * FROM task_jobs ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as unknown as Row[];
    return rows.map(rowToJob);
  }

  update(id: string, patch: TaskJobPatch, now: number = Date.now()): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (col: string, val: unknown) => {
      sets.push(`${col}=?`);
      vals.push(val);
    };
    if (patch.status !== undefined) push("status", patch.status);
    if (patch.result !== undefined) push("result_json", patch.result ? JSON.stringify(patch.result) : null);
    if (patch.error !== undefined) push("error", patch.error);
    if (sets.length === 0) return;
    push("updated_at", now);
    vals.push(id);
    this.db.prepare(`UPDATE task_jobs SET ${sets.join(", ")} WHERE id=?`).run(...(vals as never[]));
  }

  close(): void {
    this.db.close();
  }
}
