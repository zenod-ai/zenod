import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Durable queue for Drive ingestion jobs — its own SQLite file on the /data
 * volume so a long transcription survives navigation, refresh, and (via boot
 * recovery) container redeploys. The chat/MCP tools enqueue; a background
 * worker (ingestQueue.ts) drains it independent of any HTTP connection; the
 * UI polls for live status.
 */

export type IngestStatus =
  | "queued"
  | "downloading"
  | "transcribing"
  | "filing"
  | "done"
  | "error"
  | "interrupted";

/** Non-terminal states a boot-time restart should reset. */
const ACTIVE_STATES = ["queued", "downloading", "transcribing", "filing"] as const;
const IN_FLIGHT_STATES = ["downloading", "transcribing", "filing"] as const;

export interface IngestJob {
  id: string;
  driveFileId: string;
  fileName: string;
  hints: string[];
  status: IngestStatus;
  /** 0–100, meaningful while transcribing. */
  progress: number;
  /** Human-facing current step, e.g. "Transcribing Zenod 3.m4a". */
  step: string | null;
  error: string | null;
  evidenceRef: string | null;
  pages: string[];
  commitSha: string | null;
  archived: boolean;
  cached: boolean;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string;
  drive_file_id: string;
  file_name: string;
  hints: string;
  status: string;
  progress: number;
  step: string | null;
  error: string | null;
  evidence_ref: string | null;
  pages: string | null;
  commit_sha: string | null;
  archived: number;
  cached_body: string | null;
  cached_provider: string | null;
  cached_source_link: string | null;
  created_at: number;
  updated_at: number;
}

function rowToJob(row: Row): IngestJob {
  return {
    id: row.id,
    driveFileId: row.drive_file_id,
    fileName: row.file_name,
    hints: JSON.parse(row.hints || "[]") as string[],
    status: row.status as IngestStatus,
    progress: row.progress,
    step: row.step,
    error: row.error,
    evidenceRef: row.evidence_ref,
    pages: JSON.parse(row.pages || "[]") as string[],
    commitSha: row.commit_sha,
    archived: row.archived === 1,
    cached: row.cached_body !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CachedIngestPayload {
  body: string;
  provider: string | null;
  sourceLink: string | null;
}

export interface JobPatch {
  status?: IngestStatus;
  progress?: number;
  step?: string | null;
  error?: string | null;
  evidenceRef?: string | null;
  pages?: string[];
  commitSha?: string | null;
  archived?: boolean;
  cachedBody?: string | null;
  cachedProvider?: string | null;
  cachedSourceLink?: string | null;
}

export class IngestStore {
  private readonly db: DatabaseSync;

  constructor(path: string, now: () => number = Date.now) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ingest_jobs (
        id TEXT PRIMARY KEY,
        drive_file_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        hints TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        step TEXT,
        error TEXT,
        evidence_ref TEXT,
        pages TEXT NOT NULL DEFAULT '[]',
        commit_sha TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        cached_body TEXT,
        cached_provider TEXT,
        cached_source_link TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ingest_jobs_status ON ingest_jobs(status, created_at);
    `);
    this.migrate();
    // A restart killed any in-flight whisper process — surface those jobs as
    // interrupted (not stuck "running") so the user can retry them.
    const stmt = this.db.prepare(
      `UPDATE ingest_jobs SET status='interrupted', step='interrupted by a server restart', updated_at=?
       WHERE status IN (${IN_FLIGHT_STATES.map(() => "?").join(",")})`,
    );
    stmt.run(now(), ...IN_FLIGHT_STATES);
  }

  private migrate(): void {
    for (const statement of [
      `ALTER TABLE ingest_jobs ADD COLUMN cached_body TEXT`,
      `ALTER TABLE ingest_jobs ADD COLUMN cached_provider TEXT`,
      `ALTER TABLE ingest_jobs ADD COLUMN cached_source_link TEXT`,
    ]) {
      try {
        this.db.exec(statement);
      } catch {
        // Column already exists.
      }
    }
  }

  enqueue(driveFileId: string, fileName: string, hints: string[] = [], now: number = Date.now()): IngestJob {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO ingest_jobs (id, drive_file_id, file_name, hints, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
      )
      .run(id, driveFileId, fileName, JSON.stringify(hints), now, now);
    return this.get(id)!;
  }

  /** Oldest queued job, or null. The worker drains these one at a time. */
  nextQueued(): IngestJob | null {
    const row = this.db
      .prepare(`SELECT * FROM ingest_jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1`)
      .get() as Row | undefined;
    return row ? rowToJob(row) : null;
  }

  /** A file already queued or in flight — used to avoid double-queueing. */
  activeForFile(driveFileId: string): IngestJob | null {
    const row = this.db
      .prepare(
        `SELECT * FROM ingest_jobs WHERE drive_file_id=? AND status IN (${ACTIVE_STATES.map(() => "?").join(",")})
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(driveFileId, ...ACTIVE_STATES) as Row | undefined;
    return row ? rowToJob(row) : null;
  }

  get(id: string): IngestJob | null {
    const row = this.db.prepare(`SELECT * FROM ingest_jobs WHERE id=?`).get(id) as Row | undefined;
    return row ? rowToJob(row) : null;
  }

  recent(limit = 25): IngestJob[] {
    const rows = this.db
      .prepare(`SELECT * FROM ingest_jobs ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as unknown as Row[];
    return rows.map(rowToJob);
  }

  cachedPayload(id: string): CachedIngestPayload | null {
    const row = this.db
      .prepare(`SELECT cached_body, cached_provider, cached_source_link FROM ingest_jobs WHERE id=?`)
      .get(id) as Pick<Row, "cached_body" | "cached_provider" | "cached_source_link"> | undefined;
    if (!row?.cached_body) return null;
    return {
      body: row.cached_body,
      provider: row.cached_provider,
      sourceLink: row.cached_source_link,
    };
  }

  update(id: string, patch: JobPatch, now: number = Date.now()): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (col: string, val: unknown) => {
      sets.push(`${col}=?`);
      vals.push(val);
    };
    if (patch.status !== undefined) push("status", patch.status);
    if (patch.progress !== undefined) push("progress", Math.max(0, Math.min(100, Math.round(patch.progress))));
    if (patch.step !== undefined) push("step", patch.step);
    if (patch.error !== undefined) push("error", patch.error);
    if (patch.evidenceRef !== undefined) push("evidence_ref", patch.evidenceRef);
    if (patch.pages !== undefined) push("pages", JSON.stringify(patch.pages));
    if (patch.commitSha !== undefined) push("commit_sha", patch.commitSha);
    if (patch.archived !== undefined) push("archived", patch.archived ? 1 : 0);
    if (patch.cachedBody !== undefined) push("cached_body", patch.cachedBody);
    if (patch.cachedProvider !== undefined) push("cached_provider", patch.cachedProvider);
    if (patch.cachedSourceLink !== undefined) push("cached_source_link", patch.cachedSourceLink);
    if (sets.length === 0) return;
    push("updated_at", now);
    vals.push(id);
    this.db.prepare(`UPDATE ingest_jobs SET ${sets.join(", ")} WHERE id=?`).run(...(vals as never[]));
  }

  /** Re-queue a finished/errored/interrupted job (the retry action). */
  requeue(id: string, now: number = Date.now()): IngestJob | null {
    const job = this.get(id);
    if (!job) return null;
    this.update(
      id,
      { status: "queued", progress: job.cached ? 100 : 0, step: null, error: null },
      now,
    );
    return this.get(id);
  }

  close(): void {
    this.db.close();
  }
}
