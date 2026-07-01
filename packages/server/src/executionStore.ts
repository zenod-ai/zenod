import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DeliverableManifest, ExecState, ExecutionTicket } from "./executionQueue.js";

/**
 * Durable state for Epaminon's execution queue. The queue remains the state
 * machine; this store is only the persistence boundary used to survive restarts.
 */

const ACTIVE_STATES: ExecState[] = ["queued", "running", "needs-review", "approved", "blocked"];

interface Row {
  execution_id: string;
  target: string;
  context: string;
  state: string;
  evidence_url: string | null;
  note: string | null;
  final_content: string | null;
  outward: number | null;
  deliverable: string | null;
  updated_at: number;
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
    state: row.state as ExecState,
    ...(row.evidence_url ? { evidenceUrl: row.evidence_url } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.final_content ? { finalContent: row.final_content } : {}),
    ...(row.outward === null ? {} : { outward: row.outward === 1 }),
    ...(deliverable ? { deliverable } : {}),
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
        state TEXT NOT NULL,
        evidence_url TEXT,
        note TEXT,
        final_content TEXT,
        outward INTEGER,
        deliverable TEXT,
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
           execution_id, target, context, state, evidence_url, note,
           final_content, outward, deliverable, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(execution_id) DO UPDATE SET
           target=excluded.target,
           context=excluded.context,
           state=excluded.state,
           evidence_url=excluded.evidence_url,
           note=excluded.note,
           final_content=excluded.final_content,
           outward=excluded.outward,
           deliverable=excluded.deliverable,
           updated_at=excluded.updated_at`,
      )
      .run(
        ticket.executionId,
        ticket.target,
        ticket.context,
        ticket.state,
        ticket.evidenceUrl ?? null,
        ticket.note ?? null,
        ticket.finalContent ?? null,
        ticket.outward === undefined ? null : ticket.outward ? 1 : 0,
        ticket.deliverable ? JSON.stringify(ticket.deliverable) : null,
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
