import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { openZenodSqlite } from "./sqlite.js";

export interface ManagedAiDesiredState {
  accountId: string;
  desiredEnabled: boolean;
  revision: number;
  lockOwner: string | null;
  lockUntil: number | null;
  updatedAt: number;
}

interface Row {
  account_id: string;
  desired_enabled: number;
  revision: number;
  lock_owner: string | null;
  lock_until: number | null;
  updated_at: number;
}

function state(row: Row): ManagedAiDesiredState {
  return {
    accountId: row.account_id,
    desiredEnabled: row.desired_enabled === 1,
    revision: row.revision,
    lockOwner: row.lock_owner,
    lockUntil: row.lock_until,
    updatedAt: row.updated_at,
  };
}

/** Durable desired state + lease used by every lifecycle instance/process. */
export class CustomerManagedAiCoordinator {
  readonly ownerId = randomUUID();
  private readonly db: DatabaseSync;

  constructor(
    path: string,
    private readonly now: () => number = Date.now,
  ) {
    this.db = openZenodSqlite(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS customer_managed_ai_desired (
        account_id TEXT PRIMARY KEY,
        desired_enabled INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        lock_owner TEXT,
        lock_until INTEGER,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  request(accountId: string, desiredEnabled: boolean): ManagedAiDesiredState {
    const now = this.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.row(accountId);
      if (!existing) {
        this.db.prepare(
          `INSERT INTO customer_managed_ai_desired
             (account_id, desired_enabled, revision, lock_owner, lock_until, updated_at)
           VALUES (?, ?, 1, NULL, NULL, ?)`,
        ).run(accountId, desiredEnabled ? 1 : 0, now);
      } else if (existing.desired_enabled !== (desiredEnabled ? 1 : 0)) {
        this.db.prepare(
          `UPDATE customer_managed_ai_desired
           SET desired_enabled=?, revision=revision+1, updated_at=?
           WHERE account_id=?`,
        ).run(desiredEnabled ? 1 : 0, now, accountId);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.snapshot(accountId)!;
  }

  claim(accountId: string, leaseMs = 120_000): ManagedAiDesiredState | null {
    const now = this.now();
    const result = this.db.prepare(
      `UPDATE customer_managed_ai_desired
       SET lock_owner=?, lock_until=?, updated_at=?
       WHERE account_id=? AND (lock_owner IS NULL OR lock_until<=?)`,
    ).run(this.ownerId, now + leaseMs, now, accountId, now);
    return Number(result.changes) === 1 ? this.snapshot(accountId) : null;
  }

  renew(accountId: string, leaseMs = 120_000): boolean {
    const now = this.now();
    const result = this.db.prepare(
      `UPDATE customer_managed_ai_desired
       SET lock_until=?, updated_at=?
       WHERE account_id=? AND lock_owner=? AND lock_until>?`,
    ).run(now + leaseMs, now, accountId, this.ownerId, now);
    return Number(result.changes) === 1;
  }

  owns(accountId: string): boolean {
    const snapshot = this.snapshot(accountId);
    return snapshot?.lockOwner === this.ownerId && (snapshot.lockUntil ?? 0) > this.now();
  }

  release(accountId: string): void {
    this.db.prepare(
      `UPDATE customer_managed_ai_desired
       SET lock_owner=NULL, lock_until=NULL, updated_at=?
       WHERE account_id=? AND lock_owner=?`,
    ).run(this.now(), accountId, this.ownerId);
  }

  snapshot(accountId: string): ManagedAiDesiredState | null {
    const row = this.row(accountId);
    return row ? state(row) : null;
  }

  close(): void {
    this.db.close();
  }

  private row(accountId: string): Row | null {
    return (this.db.prepare(
      `SELECT account_id, desired_enabled, revision, lock_owner, lock_until, updated_at
       FROM customer_managed_ai_desired WHERE account_id=?`,
    ).get(accountId) as Row | undefined) ?? null;
  }
}
