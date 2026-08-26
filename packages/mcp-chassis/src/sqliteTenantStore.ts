import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ProvisionTenantInput,
  ProvisionTenantResult,
  TenantContext,
  TenantProvisioningStore,
  TenantStatus,
  TenantTokenRecord,
} from "./index.js";

const DEFAULT_DATA_DIR = "/data";
const DEFAULT_DB_NAME = "chassis-tenants.sqlite";
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const TOKEN_HASH_RE = /^[a-f0-9]{64}$/;

export interface SqliteTenantStoreOptions {
  dataDir?: string;
  path?: string;
  busyTimeoutMs?: number;
}

export interface ImportTenantTokenHashInput {
  tokenHash: string;
  tenant: TenantContext;
  status?: TenantStatus;
  expiresAt?: Date | string | number | null;
}

export class SqliteTenantStore implements TenantProvisioningStore {
  readonly path: string;
  private readonly db: DatabaseSync;

  constructor(options: SqliteTenantStoreOptions = {}) {
    this.path =
      options.path ??
      resolve(
        options.dataDir ?? process.env.DATA_DIR ?? DEFAULT_DATA_DIR,
        DEFAULT_DB_NAME,
      );
    if (this.path !== ":memory:")
      mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
    const busyTimeoutMs = normalizeBusyTimeout(
      options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
    );
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = ${busyTimeoutMs};
      CREATE TABLE IF NOT EXISTS tenants (
        tenant_id TEXT PRIMARY KEY,
        name TEXT,
        plan TEXT,
        quota REAL,
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'deleted')),
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tenants_token_hash ON tenants (token_hash);
      CREATE TABLE IF NOT EXISTS tenant_primary_token_aliases (
        token_hash TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id)
      );
      CREATE INDEX IF NOT EXISTS idx_tenant_primary_token_aliases_tenant_id
        ON tenant_primary_token_aliases (tenant_id);
      CREATE TABLE IF NOT EXISTS tenant_token_aliases (
        token_hash TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id),
        UNIQUE (tenant_id, profile)
      );
      CREATE INDEX IF NOT EXISTS idx_tenant_token_aliases_tenant_id
        ON tenant_token_aliases (tenant_id);
    `);
  }

  resolveTokenHash(tokenHash: string): TenantTokenRecord | null {
    const normalized = normalizeTokenHash(tokenHash);
    const row = this.db
      .prepare(
        `SELECT tenant_id, name, plan, quota, token_hash, status, expires_at, NULL AS profile
         FROM tenants WHERE token_hash = ?`,
      )
      .get(normalized) as TenantRow | undefined;
    if (row) return rowToRecord(row);
    const primaryAlias = this.db
      .prepare(
        `SELECT tenants.tenant_id, tenants.name, tenants.plan, tenants.quota,
                aliases.token_hash, tenants.status, tenants.expires_at, NULL AS profile
         FROM tenant_primary_token_aliases AS aliases
         JOIN tenants ON tenants.tenant_id = aliases.tenant_id
         WHERE aliases.token_hash = ?`,
      )
      .get(normalized) as TenantRow | undefined;
    if (primaryAlias) return rowToRecord(primaryAlias);
    const alias = this.db
      .prepare(
        `SELECT tenants.tenant_id, tenants.name, tenants.plan, tenants.quota,
                aliases.token_hash, tenants.status, tenants.expires_at, aliases.profile
         FROM tenant_token_aliases AS aliases
         JOIN tenants ON tenants.tenant_id = aliases.tenant_id
         WHERE aliases.token_hash = ?`,
      )
      .get(normalized) as TenantRow | undefined;
    return alias ? rowToRecord(alias) : null;
  }

  provisionTenant(input: ProvisionTenantInput = {}): ProvisionTenantResult {
    const ordinal =
      Number(
        (
          this.db.prepare("SELECT COUNT(*) AS count FROM tenants").get() as {
            count: number | bigint;
          }
        ).count,
      ) + 1;
    const tenant = normalizeTenant(input, ordinal);
    const token = input.token?.trim() || generateTenantToken();
    const record = this.writeRecord({
      tokenHash: hashToken(token),
      tenant,
      status: input.status ?? "active",
      expiresAt: input.expiresAt ?? null,
    }, true);
    return { token, record };
  }

  importTenantTokenHash(input: ImportTenantTokenHashInput): TenantTokenRecord {
    return this.writeRecord({
      tokenHash: normalizeTokenHash(input.tokenHash),
      tenant: normalizeTenantContext(input.tenant),
      status: input.status ?? "active",
      expiresAt: input.expiresAt ?? null,
    }, true);
  }

  rotateTenantToken(tenantId: string): ProvisionTenantResult | null {
    const existing = this.findTenant(tenantId);
    if (!existing) return null;
    const token = generateTenantToken();
    const record = this.writeRecord({
      tokenHash: hashToken(token),
      tenant: existing.tenant,
      status: "active",
      expiresAt: existing.expiresAt ?? null,
    }, false);
    return { token, record };
  }

  provisionTenantToken(
    tenantId: string,
    profile: string,
  ): ProvisionTenantResult | null {
    const existing = this.findTenant(tenantId);
    if (!existing) return null;
    const normalizedProfile = normalizeCredentialProfile(profile);
    const token = generateTenantToken();
    const tokenHash = hashToken(token);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO tenant_token_aliases (token_hash, tenant_id, profile, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(tenant_id, profile) DO UPDATE SET
             token_hash = excluded.token_hash,
             created_at = excluded.created_at`,
        )
        .run(tokenHash, existing.tenant.id, normalizedProfile, Date.now());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return {
      token,
      record: {
        ...existing,
        tokenHash,
        profile: normalizedProfile,
      },
    };
  }

  setTenantStatus(
    tenantId: string,
    status: TenantStatus,
  ): TenantTokenRecord | null {
    const existing = this.findTenant(tenantId);
    if (!existing) return null;
    return this.writeRecord({ ...existing, status });
  }

  preserveTenantTokenHash(
    tenantId: string,
    tokenHash: string,
  ): TenantTokenRecord | null {
    const existing = this.findTenant(tenantId);
    if (!existing) return null;
    const normalizedHash = normalizeTokenHash(tokenHash);
    const bound = this.resolveTokenHash(normalizedHash);
    if (bound) {
      if (
        bound.tenant.id !== existing.tenant.id ||
        (bound.profile !== null && bound.profile !== undefined)
      ) {
        throw new Error("token hash is already bound to another credential");
      }
      return bound;
    }
    this.db
      .prepare(
        `INSERT INTO tenant_primary_token_aliases (token_hash, tenant_id, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(normalizedHash, existing.tenant.id, Date.now());
    return {
      ...existing,
      tokenHash: normalizedHash,
      tenant: { ...existing.tenant },
      profile: null,
    };
  }

  snapshot(): TenantTokenRecord[] {
    const rows = this.db
      .prepare(
        `SELECT tenant_id, name, plan, quota, token_hash, status, expires_at
         FROM tenants ORDER BY tenant_id`,
      )
      .all() as unknown as TenantRow[];
    return rows.map(rowToRecord);
  }

  close(): void {
    this.db.close();
  }

  private findTenant(tenantId: string): TenantTokenRecord | null {
    const id = tenantId.trim();
    if (!id) return null;
    const row = this.db
      .prepare(
        `SELECT tenant_id, name, plan, quota, token_hash, status, expires_at
         FROM tenants WHERE tenant_id = ?`,
      )
      .get(id) as TenantRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  private writeRecord(
    record: TenantTokenRecord,
    preservePriorPrimary = true,
  ): TenantTokenRecord {
    const tenant = normalizeTenantContext(record.tenant);
    const tokenHash = normalizeTokenHash(record.tokenHash);
    const status = record.status ?? "active";
    const expiresAt = normalizeExpiresAt(record.expiresAt);
    const now = Date.now();
    const bound = this.resolveTokenHash(tokenHash);
    if (
      bound &&
      (bound.tenant.id !== tenant.id ||
        (bound.profile !== null && bound.profile !== undefined))
    ) {
      throw new Error("token hash is already bound to another credential");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.db
        .prepare("SELECT token_hash FROM tenants WHERE tenant_id = ?")
        .get(tenant.id) as { token_hash: string } | undefined;
      if (prior?.token_hash !== tokenHash) {
        if (preservePriorPrimary && prior) {
          this.db
            .prepare(
              `INSERT OR IGNORE INTO tenant_primary_token_aliases
                 (token_hash, tenant_id, created_at)
               VALUES (?, ?, ?)`,
            )
            .run(prior.token_hash, tenant.id, now);
        } else if (!preservePriorPrimary) {
          this.db
            .prepare("DELETE FROM tenant_primary_token_aliases WHERE tenant_id = ?")
            .run(tenant.id);
        }
        this.db
          .prepare(
            "DELETE FROM tenant_primary_token_aliases WHERE tenant_id = ? AND token_hash = ?",
          )
          .run(tenant.id, tokenHash);
      }
      this.db
        .prepare(
          `INSERT INTO tenants (
             tenant_id, name, plan, quota, token_hash, status, expires_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id) DO UPDATE SET
             name = excluded.name,
             plan = excluded.plan,
             quota = excluded.quota,
             token_hash = excluded.token_hash,
             status = excluded.status,
             expires_at = excluded.expires_at,
             updated_at = excluded.updated_at`,
        )
        .run(
          tenant.id,
          tenant.name ?? null,
          tenant.plan ?? null,
          tenant.quota ?? null,
          tokenHash,
          status,
          expiresAt,
          now,
          now,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return {
      tokenHash,
      tenant,
      status,
      expiresAt,
    };
  }
}

export function createSqliteTenantStore(
  options: SqliteTenantStoreOptions = {},
): SqliteTenantStore {
  return new SqliteTenantStore(options);
}

interface TenantRow {
  tenant_id: string;
  name: string | null;
  plan: string | null;
  quota: number | null;
  token_hash: string;
  status: TenantStatus;
  expires_at: number | null;
  profile?: string | null;
}

function rowToRecord(row: TenantRow): TenantTokenRecord {
  return {
    tokenHash: row.token_hash,
    tenant: {
      id: row.tenant_id,
      ...(row.name !== null ? { name: row.name } : {}),
      ...(row.plan !== null ? { plan: row.plan } : {}),
      ...(row.quota !== null ? { quota: row.quota } : {}),
    },
    ...(typeof row.profile === "string" ? { profile: row.profile } : {}),
    status: row.status,
    expiresAt: row.expires_at,
  };
}

function normalizeCredentialProfile(profile: string): string {
  const normalized = profile.trim();
  if (!normalized) throw new Error("credential profile must be non-empty");
  if (normalized.length > 100)
    throw new Error("credential profile must be at most 100 characters");
  return normalized;
}

function normalizeTenant(
  input: ProvisionTenantInput,
  ordinal: number,
): TenantContext {
  const tenant = input.tenant ?? {};
  return normalizeTenantContext({
    id: input.tenantId ?? tenant.id ?? `tenant-${ordinal}`,
    name: input.name ?? tenant.name,
    plan: input.plan ?? tenant.plan,
    quota: input.quota ?? tenant.quota,
  });
}

function normalizeTenantContext(tenant: TenantContext): TenantContext {
  const id = tenant.id.trim();
  if (!id) throw new Error("tenant id must be non-empty");
  return {
    id,
    ...(tenant.name?.trim() ? { name: tenant.name.trim() } : {}),
    ...(tenant.plan?.trim() ? { plan: tenant.plan.trim() } : {}),
    ...(tenant.quota !== undefined ? { quota: tenant.quota } : {}),
  };
}

function normalizeTokenHash(tokenHash: string): string {
  const normalized = tokenHash.trim().toLowerCase();
  if (!TOKEN_HASH_RE.test(normalized))
    throw new Error("token hash must be a SHA-256 hex digest");
  return normalized;
}

function normalizeExpiresAt(
  value: TenantTokenRecord["expiresAt"],
): number | null {
  if (value === null || value === undefined) return null;
  const timestamp =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(timestamp))
    throw new Error("expiresAt must be a valid date or timestamp");
  return Math.trunc(timestamp);
}

function normalizeBusyTimeout(value: number): number {
  if (!Number.isFinite(value) || value < 0)
    throw new Error("busyTimeoutMs must be a non-negative finite number");
  return Math.trunc(value);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function generateTenantToken(): string {
  return `zenod_${randomBytes(24).toString("hex")}`;
}
