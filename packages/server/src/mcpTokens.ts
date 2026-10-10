import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { openZenodSqlite } from "./sqlite.js";

/** Prefix that marks a user-created static MCP token (never used by OAuth or tenant tokens). */
export const MCP_TOKEN_PREFIX = "zmt_";
const LAST_USED_GRANULARITY_MS = 60_000;
const MAX_LABEL_LENGTH = 80;

export interface McpTokenRecord {
  id: string;
  accountId: string;
  tenantId: string;
  label: string;
  /** Masked preview, e.g. `zmt_…abcd`. The only token-derived value ever shown after creation. */
  preview: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** `zmt_` + 32 random bytes as base64url (43 chars, 256 bits). */
export function generateMcpToken(): string {
  return `${MCP_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isMcpToken(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith(MCP_TOKEN_PREFIX);
}

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function maskMcpToken(token: string): string {
  return `${MCP_TOKEN_PREFIX}…${token.slice(-4)}`;
}

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

interface Row {
  id: string;
  account_id: string;
  tenant_id: string;
  label: string;
  token_hash: string;
  preview: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

function toRecord(row: Row): McpTokenRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    tenantId: row.tenant_id,
    label: row.label,
    preview: row.preview,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

/**
 * Static, user-created MCP tokens. Only a SHA-256 hash is persisted; the plaintext
 * is returned exactly once by `create`. Lives in its own SQLite file so it never
 * contends with other stores.
 */
export class McpTokenStore {
  private readonly db;
  private closed = false;

  constructor(dataDir: string) {
    this.db = openZenodSqlite(join(dataDir, "mcp-tokens.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_tokens (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        label TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        preview TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_tokens_account ON mcp_tokens (account_id);
    `);
  }

  create(input: { accountId: string; tenantId: string; label: string; now?: number }): {
    token: string;
    record: McpTokenRecord;
  } {
    const label = input.label.trim().slice(0, MAX_LABEL_LENGTH);
    if (!label) throw new Error("label is required");
    const token = generateMcpToken();
    const row: Row = {
      id: randomUUID(),
      account_id: input.accountId,
      tenant_id: input.tenantId,
      label,
      token_hash: hashMcpToken(token),
      preview: maskMcpToken(token),
      created_at: input.now ?? Date.now(),
      last_used_at: null,
      revoked_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO mcp_tokens (id, account_id, tenant_id, label, token_hash, preview, created_at, last_used_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(row.id, row.account_id, row.tenant_id, row.label, row.token_hash, row.preview, row.created_at);
    return { token, record: toRecord(row) };
  }

  list(accountId: string): McpTokenRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM mcp_tokens WHERE account_id = ? ORDER BY created_at DESC, id")
      .all(accountId) as unknown as Row[];
    return rows.map(toRecord);
  }

  /** Revoke one token owned by the account. Returns false when it does not exist or is already revoked. */
  revoke(accountId: string, id: string, now = Date.now()): boolean {
    const result = this.db
      .prepare("UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL")
      .run(now, id, accountId);
    return Number(result.changes) > 0;
  }

  /**
   * Look up an active token by its SHA-256 hash. The hash is matched in SQL and then
   * re-compared in constant time. Revoked tokens resolve to null. Updates last_used_at
   * at most once a minute so authentication does not turn into a write per request.
   */
  resolveHash(tokenHash: string, now = Date.now()): McpTokenRecord | null {
    const row = this.db.prepare("SELECT * FROM mcp_tokens WHERE token_hash = ?").get(tokenHash) as unknown as
      | Row
      | undefined;
    if (!row || !hashesEqual(row.token_hash, tokenHash) || row.revoked_at !== null) return null;
    if (row.last_used_at === null || now - row.last_used_at >= LAST_USED_GRANULARITY_MS) {
      this.db.prepare("UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?").run(now, row.id);
      row.last_used_at = now;
    }
    return toRecord(row);
  }

  /** Test/inspection helper: the raw persisted columns, to prove nothing but the hash is stored. */
  rawRowsForTests(): Array<Record<string, unknown>> {
    return this.db.prepare("SELECT * FROM mcp_tokens").all() as Array<Record<string, unknown>>;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

/** In-memory sliding-window limiter for failed MCP-token attempts, keyed by client IP. */
export class FailedAttemptLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 5 * 60_000,
    private readonly maxKeys = 10_000,
  ) {}

  private prune(key: string, now: number): number[] {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length === 0) this.hits.delete(key);
    else this.hits.set(key, recent);
    return recent;
  }

  isBlocked(key: string, now = Date.now()): boolean {
    return this.prune(key, now).length >= this.maxFailures;
  }

  /** Seconds until the oldest counted failure leaves the window. */
  retryAfterSeconds(key: string, now = Date.now()): number {
    const recent = this.prune(key, now);
    if (recent.length === 0) return 0;
    return Math.max(1, Math.ceil((recent[0]! + this.windowMs - now) / 1000));
  }

  recordFailure(key: string, now = Date.now()): void {
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    const recent = this.prune(key, now);
    recent.push(now);
    this.hits.set(key, recent);
  }
}
