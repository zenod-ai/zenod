import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TaskingReply, WorkResult } from "zenod";

/**
 * Durable queue for long-running agentic MCP jobs (task_brain → handleTasking,
 * run_task → work) — its own SQLite file on the /data volume. The MCP tools
 * enqueue and return a job id at once; a background worker (taskJobQueue.ts)
 * drains it one at a time, fully decoupled from the HTTP connection; the caller
 * polls get_task_result. This is the fix for concurrent MCP calls timing out:
 * each agentic turn runs a multi-minute LLM loop and the vault is a single
 * serialized writer, so holding the HTTP request open never scaled — fan-out
 * callers blew past the MCP client / reverse-proxy idle timeout. A restart
 * marks in-flight jobs "interrupted" (not stuck "running") so they're visible.
 */

export type TaskJobKind = "task" | "work";

export type TaskJobStatus = "queued" | "running" | "done" | "error" | "interrupted";

/** Non-terminal state a boot-time restart should surface as interrupted. */
const IN_FLIGHT_STATE = "running" as const;

export interface TaskJobInput {
  /** task: the instruction sent through the shared tasking loop. */
  text?: string;
  /** task: correlation/thread key; defaults to "mcp". */
  conversationKey?: string;
  /** work: the objective to accomplish. */
  objective?: string;
  /** work: the user-approved plan (absent → propose mode). */
  plan?: string;
}

export type TaskJobResult = TaskingReply | WorkResult;

export interface TaskJob {
  id: string;
  kind: TaskJobKind;
  input: TaskJobInput;
  status: TaskJobStatus;
  result: TaskJobResult | null;
  error: string | null;
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
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
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
    // A restart killed any in-flight loop — surface those jobs as interrupted
    // (not stuck "running") so the caller's poll resolves instead of hanging.
    this.db
      .prepare(
        `UPDATE task_jobs SET status='interrupted', error='interrupted by a server restart', updated_at=?
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
