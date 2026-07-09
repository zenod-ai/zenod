import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DeliverableManifest, ExecState, ExecutionEffort, ExecutionTicket } from "./executionQueue.js";

/**
 * Durable state for Epaminon's execution queue. The queue remains the state
 * machine; this store is only the persistence boundary used to survive restarts.
 */

const ACTIVE_STATES: ExecState[] = ["queued", "running", "needs-review", "approved", "blocked"];

interface Row {
  execution_id: string;
  target: string;
  context: string;
  effort: string | null;
  state: string;
  evidence_url: string | null;
  note: string | null;
  final_content: string | null;
  outward: number | null;
  deliverable: string | null;
  started_at: number | null;
  phase: string | null;
  progress_note: string | null;
  recent_events: string | null;
  transcript_url: string | null;
  updated_at: number;
}

function parseRecentEvents(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((e) => String(e)) : undefined;
  } catch {
    return undefined;
  }
}

function parseDeliverable(raw: string | null): DeliverableManifest | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as DeliverableManifest) : undefined;
  } catch {
    return undefined;
  }
}

function rowToTicket(row: Row): ExecutionTicket {
  const deliverable = parseDeliverable(row.deliverable);
  return {
    executionId: row.execution_id,
    target: row.target,
    context: row.context,
    ...(row.effort ? { effort: row.effort as ExecutionEffort } : {}),
    state: row.state as ExecState,
    ...(row.evidence_url ? { evidenceUrl: row.evidence_url } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.final_content ? { finalContent: row.final_content } : {}),
    ...(row.outward === null ? {} : { outward: row.outward === 1 }),
    ...(deliverable ? { deliverable } : {}),
    ...(row.started_at != null ? { startedAt: row.started_at } : {}),
    ...(row.phase ? { phase: row.phase } : {}),
    ...(row.progress_note ? { progressNote: row.progress_note } : {}),
    ...(parseRecentEvents(row.recent_events) ? { recentEvents: parseRecentEvents(row.recent_events) } : {}),
    ...(row.transcript_url ? { transcriptUrl: row.transcript_url } : {}),
    updatedAt: row.updated_at,
  };
}

export class ExecutionStore {
  private readonly db: DatabaseSync;

  constructor(path: string, now: () => number = Date.now) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS execution_tickets (
        execution_id TEXT PRIMARY KEY,
        target TEXT NOT NULL,
        context TEXT NOT NULL,
        effort TEXT,
        state TEXT NOT NULL,
        evidence_url TEXT,
        note TEXT,
        final_content TEXT,
        outward INTEGER,
        deliverable TEXT,
        started_at INTEGER,
        phase TEXT,
        progress_note TEXT,
        recent_events TEXT,
        transcript_url TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS execution_tickets_state ON execution_tickets(state, updated_at);
    `);
    // Migration for DBs created before the deliverable manifest (R1-T1). Adding a
    // column is idempotent-by-guard: only ALTER when it's absent.
    const cols = this.db.prepare(`PRAGMA table_info(execution_tickets)`).all() as unknown as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "deliverable")) {
      this.db.exec(`ALTER TABLE execution_tickets ADD COLUMN deliverable TEXT`);
    }
    if (!cols.some((c) => c.name === "effort")) {
      this.db.exec(`ALTER TABLE execution_tickets ADD COLUMN effort TEXT`);
    }
    // Migration (F-2 / C-09): mid-run telemetry columns — started_at (elapsed basis) +
    // the controller-observed coarse phase/partial. Additive, guard-idempotent.
    if (!cols.some((c) => c.name === "started_at")) {
      this.db.exec(`ALTER TABLE execution_tickets ADD COLUMN started_at INTEGER`);
    }
    if (!cols.some((c) => c.name === "phase")) {
      this.db.exec(`ALTER TABLE execution_tickets ADD COLUMN phase TEXT`);
    }
    if (!cols.some((c) => c.name === "progress_note")) {
      this.db.exec(`ALTER TABLE execution_tickets ADD COLUMN progress_note TEXT`);
    }
    // Migration (S-1): the last-N observed events (JSON array) + the durable transcript URL.
    if (!cols.some((c) => c.name === "recent_events")) {
      this.db.exec(`ALTER TABLE execution_tickets ADD COLUMN recent_events TEXT`);
    }
    if (!cols.some((c) => c.name === "transcript_url")) {
      this.db.exec(`ALTER TABLE execution_tickets ADD COLUMN transcript_url TEXT`);
    }
    // A restart means any in-process runner callback was lost. Preserve the row
    // visibly as blocked instead of pretending it is still running.
    this.db
      .prepare(
        `UPDATE execution_tickets
         SET state='blocked',
             note=COALESCE(note, 'interrupted by a server restart'),
             updated_at=?
         WHERE state='running'`,
      )
      .run(now());
  }

  upsert(ticket: ExecutionTicket): void {
    this.db
      .prepare(
        `INSERT INTO execution_tickets (
           execution_id, target, context, effort, state, evidence_url, note,
           final_content, outward, deliverable, started_at, phase, progress_note,
           recent_events, transcript_url, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(execution_id) DO UPDATE SET
           target=excluded.target,
           context=excluded.context,
           effort=excluded.effort,
           state=excluded.state,
           evidence_url=excluded.evidence_url,
           note=excluded.note,
           final_content=excluded.final_content,
           outward=excluded.outward,
           deliverable=excluded.deliverable,
           started_at=excluded.started_at,
           phase=excluded.phase,
           progress_note=excluded.progress_note,
           recent_events=excluded.recent_events,
           transcript_url=excluded.transcript_url,
           updated_at=excluded.updated_at`,
      )
      .run(
        ticket.executionId,
        ticket.target,
        ticket.context,
        ticket.effort ?? null,
        ticket.state,
        ticket.evidenceUrl ?? null,
        ticket.note ?? null,
        ticket.finalContent ?? null,
        ticket.outward === undefined ? null : ticket.outward ? 1 : 0,
        ticket.deliverable ? JSON.stringify(ticket.deliverable) : null,
        ticket.startedAt ?? null,
        ticket.phase ?? null,
        ticket.progressNote ?? null,
        ticket.recentEvents ? JSON.stringify(ticket.recentEvents) : null,
        ticket.transcriptUrl ?? null,
        ticket.updatedAt,
      );
  }

  get(executionId: string): ExecutionTicket | null {
    const row = this.db
      .prepare(`SELECT * FROM execution_tickets WHERE execution_id=?`)
      .get(executionId) as Row | undefined;
    return row ? rowToTicket(row) : null;
  }

  active(): ExecutionTicket[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM execution_tickets
         WHERE state IN (${ACTIVE_STATES.map(() => "?").join(",")})
         ORDER BY updated_at ASC`,
      )
      .all(...ACTIVE_STATES) as unknown as Row[];
    return rows.map(rowToTicket);
  }

  recent(limit = 50): ExecutionTicket[] {
    const rows = this.db
      .prepare(`SELECT * FROM execution_tickets ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as unknown as Row[];
    return rows.map(rowToTicket);
  }

  close(): void {
    this.db.close();
  }
}
