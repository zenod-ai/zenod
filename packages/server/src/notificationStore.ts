import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Durable journal for every proactive notification event that passes through the
 * single notification authority (R2-T1). One row per emitted event: what it was,
 * what it keyed on, the composed text actually sent, to whom, and the outcome. This
 * is the substrate the dedup/coalesce/ordering logic (R2-T2/T3) reads and writes,
 * and the audit trail for "was this actually sent" that the live path lacked.
 */

export type NotificationStatus = "sent" | "failed" | "suppressed";

export interface NotificationRecordInput {
  id: string;
  eventType: string;
  surface: string;
  targetIssue?: string | null;
  executionId?: string | null;
  runId?: string | null;
  severity?: string | null;
  dedupeKey?: string | null;
  composedText: string;
  recipients: string[];
  status: NotificationStatus;
  /** When suppressed/deduped, the id of the record that superseded this one (R2-T2). */
  suppressedBy?: string | null;
}

export interface NotificationRecord extends NotificationRecordInput {
  createdAt: number;
}

interface Row {
  id: string;
  event_type: string;
  surface: string;
  target_issue: string | null;
  execution_id: string | null;
  run_id: string | null;
  severity: string | null;
  dedupe_key: string | null;
  composed_text: string;
  recipients: string;
  status: string;
  suppressed_by: string | null;
  created_at: number;
}

function rowToRecord(row: Row): NotificationRecord {
  let recipients: string[] = [];
  try {
    const parsed = JSON.parse(row.recipients) as unknown;
    if (Array.isArray(parsed)) recipients = parsed.filter((r): r is string => typeof r === "string");
  } catch {
    recipients = [];
  }
  return {
    id: row.id,
    eventType: row.event_type,
    surface: row.surface,
    targetIssue: row.target_issue,
    executionId: row.execution_id,
    runId: row.run_id,
    severity: row.severity,
    dedupeKey: row.dedupe_key,
    composedText: row.composed_text,
    recipients,
    status: row.status as NotificationStatus,
    suppressedBy: row.suppressed_by,
    createdAt: row.created_at,
  };
}

export class NotificationStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        surface TEXT NOT NULL,
        target_issue TEXT,
        execution_id TEXT,
        run_id TEXT,
        severity TEXT,
        dedupe_key TEXT,
        composed_text TEXT NOT NULL,
        recipients TEXT NOT NULL,
        status TEXT NOT NULL,
        suppressed_by TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notifications_created ON notifications(created_at);
      CREATE INDEX IF NOT EXISTS notifications_dedupe ON notifications(dedupe_key, created_at);
    `);
  }

  record(input: NotificationRecordInput, now: number = Date.now()): NotificationRecord {
    this.db
      .prepare(
        `INSERT INTO notifications (
           id, event_type, surface, target_issue, execution_id, run_id, severity,
           dedupe_key, composed_text, recipients, status, suppressed_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.eventType,
        input.surface,
        input.targetIssue ?? null,
        input.executionId ?? null,
        input.runId ?? null,
        input.severity ?? null,
        input.dedupeKey ?? null,
        input.composedText,
        JSON.stringify(input.recipients ?? []),
        input.status,
        input.suppressedBy ?? null,
        now,
      );
    return { ...input, createdAt: now };
  }

  /** Most recent record carrying this dedupe key, if any (for R2-T2 suppression). */
  latestByDedupeKey(dedupeKey: string): NotificationRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM notifications WHERE dedupe_key=? ORDER BY created_at DESC LIMIT 1`)
      .get(dedupeKey) as Row | undefined;
    return row ? rowToRecord(row) : null;
  }

  /** Most recent SENT record for this key — the anchor coalescing suppresses against
   *  (R2-T2). Ignores prior suppressed rows so a run of siblings collapses to one. */
  latestSentByDedupeKey(dedupeKey: string): NotificationRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM notifications WHERE dedupe_key=? AND status='sent' ORDER BY created_at DESC LIMIT 1`)
      .get(dedupeKey) as Row | undefined;
    return row ? rowToRecord(row) : null;
  }

  /** Most recent SENT record for a (targetIssue, runId) group across event types —
   *  the anchor for the state-machine ordering guard (R2-T3). runId null matches the
   *  keyless "-" group used when the runner does not supply one. */
  latestSentForGroup(targetIssue: string, runId: string | null): NotificationRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM notifications
         WHERE status='sent' AND target_issue=? AND COALESCE(run_id,'-')=?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(targetIssue, runId ?? "-") as Row | undefined;
    return row ? rowToRecord(row) : null;
  }

  recent(limit = 100): NotificationRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as unknown as Row[];
    return rows.map(rowToRecord);
  }

  close(): void {
    this.db.close();
  }
}
