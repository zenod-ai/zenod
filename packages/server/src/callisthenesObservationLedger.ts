import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type HeldActionStatus = "pending" | "dispatching" | "deferred" | "sent" | "unknown" | "expired";

export interface ObservedDraft {
  id: string;
  text: string;
  status: HeldActionStatus;
  created_at: string;
  expires_at: string;
  sent_at?: string;
  unknown_at?: string;
  unknown_reason?: string;
  dispatch_started_at?: string;
  retry_at?: string;
}

export interface ObservedReceipt {
  id: string;
  draft_id: string;
  text: string;
  url: string;
  created_at: string;
}

interface TenantObservations {
  drafts: ObservedDraft[];
  receipts: ObservedReceipt[];
  usage: { calls: number; sends: number; rejected_drafts: number; throttled: number };
}

interface LegacyStore { [tenantId: string]: TenantObservations }

export interface HeldActionApproval {
  actionId?: string;
  text: string;
}

export type PublicationClaim =
  | { state: "claimed"; action: ObservedDraft; owner: string }
  | { state: "dispatching"; action: ObservedDraft }
  | { state: "sent"; action: ObservedDraft; receipt: ObservedReceipt }
  | { state: "unknown"; action: ObservedDraft }
  | { state: "deferred"; action: ObservedDraft }
  | { state: "missing" };

export interface HeldActionStore {
  hold(tenantId: string, text: string): ObservedDraft;
  claim(tenantId: string, approval: HeldActionApproval): PublicationClaim;
  publicationState(tenantId: string, approval: HeldActionApproval): PublicationClaim;
  recordReceipt(tenantId: string, actionId: string, owner: string, receiptText: string, url: string): ObservedReceipt;
  markUnknown(tenantId: string, actionId: string, owner: string, reason: string): void;
  markDeferred(tenantId: string, actionId: string, owner: string, reason: string, retryAt: Date, countThrottle?: boolean): ObservedDraft;
  reconcileSent(tenantId: string, approval: HeldActionApproval, receiptText: string, url: string): ObservedReceipt | null;
}

export interface CallisthenesObservationLedgerOptions {
  pendingTtlMs?: number;
  dispatchLeaseMs?: number;
  now?: () => Date;
}

interface ActionRow {
  tenant_id: string;
  id: string;
  text: string;
  status: HeldActionStatus;
  created_at: string;
  expires_at: string;
  sent_at: string | null;
  unknown_at: string | null;
  unknown_reason: string | null;
  dispatch_owner: string | null;
  dispatch_started_at: string | null;
  lease_until: string | null;
  retry_at: string | null;
}

interface ReceiptRow {
  id: string;
  action_id: string;
  text: string;
  url: string;
  created_at: string;
}

function empty(): TenantObservations {
  return { drafts: [], receipts: [], usage: { calls: 0, sends: 0, rejected_drafts: 0, throttled: 0 } };
}

export function observedContentId(tenantId: string, text: string): string {
  return createHash("sha256").update(`${tenantId}\0${text}`).digest("hex").slice(0, 24);
}

function actionFromRow(row: ActionRow): ObservedDraft {
  return {
    id: row.id,
    text: row.text,
    status: row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    ...(row.sent_at ? { sent_at: row.sent_at } : {}),
    ...(row.unknown_at ? { unknown_at: row.unknown_at } : {}),
    ...(row.unknown_reason ? { unknown_reason: row.unknown_reason } : {}),
    ...(row.dispatch_started_at ? { dispatch_started_at: row.dispatch_started_at } : {}),
    ...(row.retry_at ? { retry_at: row.retry_at } : {}),
  };
}

function receiptFromRow(row: ReceiptRow): ObservedReceipt {
  return { id: row.id, draft_id: row.action_id, text: row.text, url: row.url, created_at: row.created_at };
}

function retrySqliteBusy<T>(operation: () => T, timeoutMs = 30_000): T {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return operation();
    } catch (error) {
      const busy = error instanceof Error && /database is (?:locked|busy)/i.test(error.message);
      if (!busy || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}

export class CallisthenesObservationLedger implements HeldActionStore {
  readonly path: string;
  readonly legacyPath: string;
  private readonly db: DatabaseSync;
  private readonly pendingTtlMs: number;
  private readonly dispatchLeaseMs: number;
  private readonly now: () => Date;

  constructor(dataDir: string, options: CallisthenesObservationLedgerOptions = {}) {
    this.path = join(dataDir, "callisthenes-observations.sqlite");
    this.legacyPath = join(dataDir, "callisthenes-observations.json");
    this.pendingTtlMs = options.pendingTtlMs ?? 24 * 60 * 60 * 1_000;
    this.dispatchLeaseMs = options.dispatchLeaseMs ?? 30_000;
    this.now = options.now ?? (() => new Date());
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
    this.db.exec("PRAGMA busy_timeout = 30000;");
    // SQLite's journal_mode transition can return SQLITE_BUSY immediately on
    // simultaneous first opens even after busy_timeout is installed. Retry
    // that one-time transition before entering the transactional schema gate.
    retrySqliteBusy(() => this.db.exec("PRAGMA journal_mode = WAL;"));
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.transaction(() => this.db.exec(`
      CREATE TABLE IF NOT EXISTS calli_actions (
        tenant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','dispatching','deferred','sent','unknown','expired')),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        sent_at TEXT,
        unknown_at TEXT,
        unknown_reason TEXT,
        dispatch_owner TEXT,
        dispatch_started_at TEXT,
        lease_until TEXT,
        retry_at TEXT,
        PRIMARY KEY (tenant_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS calli_one_active_text_v2
        ON calli_actions(tenant_id, text) WHERE status IN ('pending','dispatching','deferred','unknown');
      CREATE INDEX IF NOT EXISTS calli_actions_lookup
        ON calli_actions(tenant_id, status, text, created_at DESC);
      CREATE TABLE IF NOT EXISTS calli_receipts (
        tenant_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        id TEXT NOT NULL,
        text TEXT NOT NULL,
        url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, action_id),
        FOREIGN KEY (tenant_id, action_id) REFERENCES calli_actions(tenant_id, id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS calli_one_provider_receipt_v1 ON calli_receipts(tenant_id, url);
      CREATE TABLE IF NOT EXISTS calli_usage (
        tenant_id TEXT PRIMARY KEY,
        calls INTEGER NOT NULL DEFAULT 0,
        sends INTEGER NOT NULL DEFAULT 0,
        rejected_drafts INTEGER NOT NULL DEFAULT 0,
        throttled INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS calli_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `));
    this.migrateLegacyJson();
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private migrateLegacyJson(): void {
    let legacy: LegacyStore = {};
    if (existsSync(this.legacyPath)) {
      try { legacy = JSON.parse(readFileSync(this.legacyPath, "utf8")) as LegacyStore; } catch { legacy = {}; }
    }
    this.transaction(() => {
      // The marker check belongs under the same immediate write lock as the
      // import. Two front instances may start against one shared volume.
      if (this.db.prepare("SELECT value FROM calli_metadata WHERE key = 'legacy_json_v1'").get()) return;
      for (const tenantId of Object.keys(legacy).sort()) {
        const state = legacy[tenantId] ?? empty();
        this.ensureUsage(tenantId);
        this.db.prepare(`UPDATE calli_usage SET calls=?, sends=?, rejected_drafts=?, throttled=? WHERE tenant_id=?`).run(
          state.usage?.calls ?? 0, state.usage?.sends ?? 0, state.usage?.rejected_drafts ?? 0, state.usage?.throttled ?? 0, tenantId,
        );
        for (const draft of state.drafts ?? []) {
          const created = draft.created_at || this.now().toISOString();
          const expires = draft.expires_at || new Date(new Date(created).getTime() + this.pendingTtlMs).toISOString();
          this.db.prepare(`INSERT OR IGNORE INTO calli_actions
            (tenant_id,id,text,status,created_at,expires_at,sent_at) VALUES (?,?,?,?,?,?,?)`).run(
            tenantId, draft.id, draft.text, draft.status, created, expires, draft.sent_at ?? null,
          );
        }
        for (const receipt of state.receipts ?? []) {
          const action = this.actionRow(tenantId, receipt.draft_id);
          if (!action) {
            this.db.prepare(`INSERT OR IGNORE INTO calli_actions
              (tenant_id,id,text,status,created_at,expires_at,sent_at) VALUES (?,?,?,?,?,?,?)`).run(
              tenantId, receipt.draft_id, "", "sent", receipt.created_at, receipt.created_at, receipt.created_at,
            );
          }
          this.db.prepare(`INSERT OR IGNORE INTO calli_receipts
            (tenant_id,action_id,id,text,url,created_at) VALUES (?,?,?,?,?,?)`).run(
            tenantId, receipt.draft_id, receipt.id, receipt.text, receipt.url, receipt.created_at,
          );
        }
      }
      this.db.prepare("INSERT INTO calli_metadata(key,value) VALUES('legacy_json_v1',?)").run(this.now().toISOString());
    });
  }

  private ensureUsage(tenantId: string): void {
    this.db.prepare("INSERT OR IGNORE INTO calli_usage(tenant_id) VALUES(?)").run(tenantId);
  }

  private actionRow(tenantId: string, actionId: string): ActionRow | null {
    return (this.db.prepare("SELECT * FROM calli_actions WHERE tenant_id=? AND id=?").get(tenantId, actionId) as ActionRow | undefined) ?? null;
  }

  private receiptRow(tenantId: string, actionId: string): ReceiptRow | null {
    return (this.db.prepare("SELECT * FROM calli_receipts WHERE tenant_id=? AND action_id=?").get(tenantId, actionId) as ReceiptRow | undefined) ?? null;
  }

  private expireAndRecover(tenantId: string): void {
    const now = this.now().toISOString();
    this.db.prepare(`UPDATE calli_actions SET status='unknown', unknown_at=?, unknown_reason='dispatch lease expired before a verified receipt', dispatch_owner=NULL, lease_until=NULL
      WHERE tenant_id=? AND status='dispatching' AND lease_until<=?`).run(now, tenantId, now);
    this.db.prepare("UPDATE calli_actions SET status='pending', retry_at=NULL, unknown_reason=NULL WHERE tenant_id=? AND status='deferred' AND retry_at<=?").run(tenantId, now);
    this.db.prepare("UPDATE calli_actions SET status='expired' WHERE tenant_id=? AND status='pending' AND expires_at<=?").run(tenantId, now);
  }

  private resolveActionRow(tenantId: string, approval: HeldActionApproval): ActionRow | null {
    if (approval.actionId) {
      const row = this.actionRow(tenantId, approval.actionId);
      if (row?.text === approval.text) return row;
      // Receipt-only W-C1 predecessors keyed the row by tenant+text without
      // retaining the original text. The deterministic id proves the exact
      // legacy binding without exposing it to another tenant.
      if (row?.text === "" && row.id === observedContentId(tenantId, approval.text) && this.receiptRow(tenantId, row.id)) return row;
      return null;
    }
    const rows = this.db.prepare(`SELECT * FROM calli_actions WHERE tenant_id=? AND text=? AND status IN ('pending','dispatching','deferred','unknown') ORDER BY created_at DESC`).all(
      tenantId, approval.text,
    ) as unknown as ActionRow[];
    if (rows.length === 1) return rows[0]!;
    if (rows.length > 1) return null;
    const legacy = this.actionRow(tenantId, observedContentId(tenantId, approval.text));
    if (legacy?.text === "" && legacy.status === "sent" && this.receiptRow(tenantId, legacy.id)) return legacy;
    const sent = this.db.prepare("SELECT * FROM calli_actions WHERE tenant_id=? AND text=? AND status='sent' ORDER BY created_at DESC").all(
      tenantId, approval.text,
    ) as unknown as ActionRow[];
    return sent.length === 1 ? sent[0]! : null;
  }

  observeCall(tenantId: string, resultText: string): void {
    this.transaction(() => {
      this.ensureUsage(tenantId);
      this.db.prepare("UPDATE calli_usage SET calls=calls+1, throttled=throttled+? WHERE tenant_id=?").run(
        resultText.includes("[throttle_exceeded]") ? 1 : 0, tenantId,
      );
    });
  }

  hold(tenantId: string, text: string): ObservedDraft {
    return this.transaction(() => {
      this.expireAndRecover(tenantId);
      // An unknown action may already have published. Reuse it so callers
      // cannot mint a fresh id and route around mandatory reconciliation.
      const existing = this.db.prepare("SELECT * FROM calli_actions WHERE tenant_id=? AND text=? AND status IN ('pending','dispatching','deferred','unknown') ORDER BY created_at DESC LIMIT 1").get(tenantId, text) as ActionRow | undefined;
      if (existing) return actionFromRow(existing);
      const created = this.now();
      const row: ActionRow = {
        tenant_id: tenantId, id: `act_${randomUUID().replaceAll("-", "")}`, text, status: "pending",
        created_at: created.toISOString(), expires_at: new Date(created.getTime() + this.pendingTtlMs).toISOString(),
        sent_at: null, unknown_at: null, unknown_reason: null, dispatch_owner: null, dispatch_started_at: null, lease_until: null, retry_at: null,
      };
      this.db.prepare(`INSERT INTO calli_actions(tenant_id,id,text,status,created_at,expires_at) VALUES(?,?,?,?,?,?)`).run(
        tenantId, row.id, text, "pending", row.created_at, row.expires_at,
      );
      this.ensureUsage(tenantId);
      this.db.prepare("UPDATE calli_usage SET rejected_drafts=rejected_drafts+1 WHERE tenant_id=?").run(tenantId);
      return actionFromRow(row);
    });
  }

  observeRejectedDraft(tenantId: string, text: string): ObservedDraft { return this.hold(tenantId, text); }

  publicationState(tenantId: string, approval: HeldActionApproval): PublicationClaim {
    return this.transaction(() => {
      this.expireAndRecover(tenantId);
      const row = this.resolveActionRow(tenantId, approval);
      if (!row) return { state: "missing" };
      const fresh = this.actionRow(tenantId, row.id)!;
      if (fresh.status === "sent") {
        const receipt = this.receiptRow(tenantId, fresh.id);
        return receipt ? { state: "sent", action: actionFromRow(fresh), receipt: receiptFromRow(receipt) } : { state: "unknown", action: actionFromRow(fresh) };
      }
      if (fresh.status === "dispatching") return { state: "dispatching", action: actionFromRow(fresh) };
      if (fresh.status === "deferred") return { state: "deferred", action: actionFromRow(fresh) };
      if (fresh.status === "unknown") return { state: "unknown", action: actionFromRow(fresh) };
      return { state: "missing" };
    });
  }

  claim(tenantId: string, approval: HeldActionApproval): PublicationClaim {
    return this.transaction(() => {
      this.expireAndRecover(tenantId);
      const row = this.resolveActionRow(tenantId, approval);
      if (!row) return { state: "missing" };
      if (row.status !== "pending") return this.publicationStateWithoutTransaction(tenantId, row);
      const owner = randomUUID();
      const leaseUntil = new Date(this.now().getTime() + this.dispatchLeaseMs).toISOString();
      const dispatchStarted = this.now().toISOString();
      const changed = this.db.prepare(`UPDATE calli_actions SET status='dispatching', dispatch_owner=?, dispatch_started_at=?, lease_until=?
        WHERE tenant_id=? AND id=? AND status='pending'`).run(owner, dispatchStarted, leaseUntil, tenantId, row.id);
      if (Number(changed.changes) !== 1) return this.publicationStateWithoutTransaction(tenantId, this.actionRow(tenantId, row.id)!);
      return { state: "claimed", action: actionFromRow({ ...row, status: "dispatching", dispatch_owner: owner, dispatch_started_at: dispatchStarted, lease_until: leaseUntil }), owner };
    });
  }

  private publicationStateWithoutTransaction(tenantId: string, row: ActionRow): PublicationClaim {
    if (row.status === "sent") {
      const receipt = this.receiptRow(tenantId, row.id);
      return receipt ? { state: "sent", action: actionFromRow(row), receipt: receiptFromRow(receipt) } : { state: "unknown", action: actionFromRow(row) };
    }
    if (row.status === "dispatching") return { state: "dispatching", action: actionFromRow(row) };
    if (row.status === "deferred") return { state: "deferred", action: actionFromRow(row) };
    if (row.status === "unknown") return { state: "unknown", action: actionFromRow(row) };
    return { state: "missing" };
  }

  recordReceipt(tenantId: string, actionId: string, owner: string, receiptText: string, url: string): ObservedReceipt {
    return this.transaction(() => {
      const existing = this.receiptRow(tenantId, actionId);
      if (existing) return receiptFromRow(existing);
      const action = this.actionRow(tenantId, actionId);
      if (!action || action.status !== "dispatching" || action.dispatch_owner !== owner) throw new Error("publication claim is no longer owned");
      const now = this.now().toISOString();
      const receipt: ReceiptRow = { id: observedContentId(tenantId, url), action_id: actionId, text: receiptText, url, created_at: now };
      this.db.prepare("INSERT INTO calli_receipts(tenant_id,action_id,id,text,url,created_at) VALUES(?,?,?,?,?,?)").run(
        tenantId, actionId, receipt.id, receipt.text, url, now,
      );
      this.db.prepare("UPDATE calli_actions SET status='sent', sent_at=?, dispatch_owner=NULL, lease_until=NULL WHERE tenant_id=? AND id=?").run(now, tenantId, actionId);
      this.ensureUsage(tenantId);
      this.db.prepare("UPDATE calli_usage SET sends=sends+1 WHERE tenant_id=?").run(tenantId);
      return receiptFromRow(receipt);
    });
  }

  markUnknown(tenantId: string, actionId: string, owner: string, reason: string): void {
    this.transaction(() => {
      const now = this.now().toISOString();
      this.db.prepare(`UPDATE calli_actions SET status='unknown', unknown_at=?, unknown_reason=?, dispatch_owner=NULL, lease_until=NULL
        WHERE tenant_id=? AND id=? AND status='dispatching' AND dispatch_owner=?`).run(now, reason.slice(0, 500), tenantId, actionId, owner);
    });
  }

  markDeferred(tenantId: string, actionId: string, owner: string, reason: string, retryAt: Date, countThrottle = false): ObservedDraft {
    return this.transaction(() => {
      const changed = this.db.prepare(`UPDATE calli_actions SET status='deferred', unknown_reason=?, retry_at=?, dispatch_owner=NULL, lease_until=NULL
        WHERE tenant_id=? AND id=? AND status='dispatching' AND dispatch_owner=?`).run(
        reason.slice(0, 500), retryAt.toISOString(), tenantId, actionId, owner,
      );
      if (Number(changed.changes) !== 1) throw new Error("publication claim is no longer owned");
      if (countThrottle) {
        this.ensureUsage(tenantId);
        this.db.prepare("UPDATE calli_usage SET throttled=throttled+1 WHERE tenant_id=?").run(tenantId);
      }
      return actionFromRow(this.actionRow(tenantId, actionId)!);
    });
  }

  reconcileSent(tenantId: string, approval: HeldActionApproval, receiptText: string, url: string): ObservedReceipt | null {
    return this.transaction(() => {
      const row = this.resolveActionRow(tenantId, approval);
      if (!row) return null;
      if (row.status === "sent") {
        const existing = this.receiptRow(tenantId, row.id);
        return existing ? receiptFromRow(existing) : null;
      }
      if (row.status !== "unknown") return null;
      const providerReceipt = this.db.prepare("SELECT action_id FROM calli_receipts WHERE tenant_id=? AND url=?").get(tenantId, url) as { action_id: string } | undefined;
      if (providerReceipt && providerReceipt.action_id !== row.id) return null;
      const now = this.now().toISOString();
      const receipt: ReceiptRow = { id: observedContentId(tenantId, url), action_id: row.id, text: receiptText, url, created_at: now };
      this.db.prepare("INSERT OR IGNORE INTO calli_receipts(tenant_id,action_id,id,text,url,created_at) VALUES(?,?,?,?,?,?)").run(
        tenantId, row.id, receipt.id, receipt.text, url, now,
      );
      this.db.prepare("UPDATE calli_actions SET status='sent', sent_at=?, unknown_at=NULL, unknown_reason=NULL WHERE tenant_id=? AND id=? AND status='unknown'").run(
        now, tenantId, row.id,
      );
      this.ensureUsage(tenantId);
      this.db.prepare("UPDATE calli_usage SET sends=sends+1 WHERE tenant_id=?").run(tenantId);
      return receiptFromRow(this.receiptRow(tenantId, row.id)!);
    });
  }

  // W-C1 compatibility helpers retained for callers/tests while publication uses claim().
  resolve(tenantId: string, approval: HeldActionApproval): ObservedDraft | null {
    return this.transaction(() => {
      this.expireAndRecover(tenantId);
      const row = this.resolveActionRow(tenantId, approval);
      return row?.status === "pending" ? actionFromRow(row) : null;
    });
  }

  receiptForAction(tenantId: string, actionId: string): ObservedReceipt | null {
    const row = this.receiptRow(tenantId, actionId);
    return row ? receiptFromRow(row) : null;
  }

  replayReceipt(tenantId: string, approval: HeldActionApproval): ObservedReceipt | null {
    const state = this.publicationState(tenantId, approval);
    return state.state === "sent" ? state.receipt : null;
  }

  read(tenantId: string): TenantObservations {
    const drafts = (this.db.prepare("SELECT * FROM calli_actions WHERE tenant_id=? ORDER BY created_at DESC").all(tenantId) as unknown as ActionRow[]).map(actionFromRow);
    const receipts = (this.db.prepare("SELECT * FROM calli_receipts WHERE tenant_id=? ORDER BY created_at DESC").all(tenantId) as unknown as ReceiptRow[]).map(receiptFromRow);
    const usage = this.db.prepare("SELECT calls,sends,rejected_drafts,throttled FROM calli_usage WHERE tenant_id=?").get(tenantId) as TenantObservations["usage"] | undefined;
    return { drafts, receipts, usage: usage ?? empty().usage };
  }

  close(): void { this.db.close(); }
}
