import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TenantContext, TenantOAuthAccessToken } from "./index.js";
import type {
  OAuthAuthorizationCode,
  OAuthClient,
  OAuthProviderState,
  OAuthServerToken,
  OAuthStore,
} from "./oauth.js";

const DEFAULT_DATA_DIR = "/data";
const DEFAULT_DB_NAME = "chassis-oauth.sqlite";
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export interface SqliteOAuthStoreOptions {
  dataDir?: string;
  path?: string;
  busyTimeoutMs?: number;
}

/**
 * Durable {@link OAuthStore} backing the chassis authorization server. The default
 * {@link import("./oauth.js").MemoryOAuthStore} loses every dynamically-registered
 * client and issued token on process exit, so each redeploy would strand connected
 * MCP clients ("unknown client_id" on the next authorize). Persisting to SQLite keeps
 * DCR registrations and refresh tokens valid across restarts.
 */
export class SqliteOAuthStore implements OAuthStore {
  readonly path: string;
  private readonly db: DatabaseSync;

  constructor(options: SqliteOAuthStoreOptions = {}) {
    this.path =
      options.path ??
      resolve(
        options.dataDir ?? process.env.DATA_DIR ?? DEFAULT_DATA_DIR,
        DEFAULT_DB_NAME,
      );
    if (this.path !== ":memory:") mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
    const busyTimeoutMs = normalizeBusyTimeout(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = ${busyTimeoutMs};
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        client_name TEXT NOT NULL,
        redirect_uris TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_codes (
        code TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        resource TEXT NOT NULL,
        scope TEXT NOT NULL,
        tenant TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        access_token TEXT PRIMARY KEY,
        refresh_token TEXT NOT NULL UNIQUE,
        client_id TEXT NOT NULL,
        client_name TEXT NOT NULL,
        resource TEXT NOT NULL,
        scope TEXT NOT NULL,
        tenant TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh ON oauth_tokens (refresh_token);
      CREATE TABLE IF NOT EXISTS oauth_provider_states (
        state TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  createClient(client: OAuthClient): void {
    this.db
      .prepare(
        `INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(client_id) DO UPDATE SET
           client_name = excluded.client_name,
           redirect_uris = excluded.redirect_uris`,
      )
      .run(client.clientId, client.clientName, JSON.stringify(client.redirectUris), client.createdAt);
  }

  getClient(clientId: string): OAuthClient | null {
    const row = this.db
      .prepare(
        `SELECT client_id, client_name, redirect_uris, created_at FROM oauth_clients WHERE client_id = ?`,
      )
      .get(clientId) as ClientRow | undefined;
    if (!row) return null;
    return {
      clientId: row.client_id,
      clientName: row.client_name,
      redirectUris: parseStringArray(row.redirect_uris),
      createdAt: Number(row.created_at),
    };
  }

  createCode(code: OAuthAuthorizationCode): void {
    this.db
      .prepare(
        `INSERT INTO oauth_codes (code, client_id, redirect_uri, code_challenge, resource, scope, tenant, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        code.code,
        code.clientId,
        code.redirectUri,
        code.codeChallenge,
        code.resource,
        code.scope,
        JSON.stringify(code.tenant),
        code.expiresAt,
      );
  }

  consumeCode(code: string): OAuthAuthorizationCode | null {
    const row = this.db
      .prepare(
        `SELECT code, client_id, redirect_uri, code_challenge, resource, scope, tenant, expires_at
         FROM oauth_codes WHERE code = ?`,
      )
      .get(code) as CodeRow | undefined;
    this.db.prepare(`DELETE FROM oauth_codes WHERE code = ?`).run(code);
    if (!row || Number(row.expires_at) < Date.now()) return null;
    return {
      code: row.code,
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      codeChallenge: row.code_challenge,
      resource: row.resource,
      scope: row.scope,
      tenant: parseTenant(row.tenant),
      expiresAt: Number(row.expires_at),
    };
  }

  createToken(token: OAuthServerToken): void {
    this.db
      .prepare(
        `INSERT INTO oauth_tokens (
           access_token, refresh_token, client_id, client_name, resource, scope, tenant, expires_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        token.accessToken,
        token.refreshToken,
        token.clientId,
        token.clientName,
        token.resource,
        token.scope,
        JSON.stringify(token.tenant),
        token.expiresAt,
        token.createdAt,
      );
  }

  resolveOAuthAccessToken(accessToken: string): TenantOAuthAccessToken | null {
    const row = this.db
      .prepare(
        `SELECT client_id, client_name, scope, tenant, expires_at FROM oauth_tokens WHERE access_token = ?`,
      )
      .get(accessToken) as AccessRow | undefined;
    if (!row || Number(row.expires_at) < Date.now()) return null;
    return {
      tenant: parseTenant(row.tenant),
      clientId: row.client_id,
      clientName: row.client_name,
      scope: row.scope,
      expiresAt: Number(row.expires_at),
    };
  }

  getByRefreshToken(refreshToken: string): OAuthServerToken | null {
    const row = this.db
      .prepare(
        `SELECT access_token, refresh_token, client_id, client_name, resource, scope, tenant, expires_at, created_at
         FROM oauth_tokens WHERE refresh_token = ?`,
      )
      .get(refreshToken) as TokenRow | undefined;
    if (!row) return null;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      clientId: row.client_id,
      clientName: row.client_name,
      resource: row.resource,
      scope: row.scope,
      tenant: parseTenant(row.tenant),
      expiresAt: Number(row.expires_at),
      createdAt: Number(row.created_at),
    };
  }

  rotateAccessToken(refreshToken: string, newAccessToken: string, expiresAt: number): void {
    this.db
      .prepare(
        `UPDATE oauth_tokens SET access_token = ?, expires_at = ? WHERE refresh_token = ?`,
      )
      .run(newAccessToken, expiresAt, refreshToken);
  }

  createProviderState(state: OAuthProviderState): void {
    this.db
      .prepare(
        `INSERT INTO oauth_provider_states (state, provider_id, tenant_id, redirect_uri, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(state.state, state.providerId, state.tenantId, state.redirectUri, state.expiresAt);
  }

  consumeProviderState(state: string): OAuthProviderState | null {
    const row = this.db
      .prepare(
        `SELECT state, provider_id, tenant_id, redirect_uri, expires_at FROM oauth_provider_states WHERE state = ?`,
      )
      .get(state) as ProviderStateRow | undefined;
    this.db.prepare(`DELETE FROM oauth_provider_states WHERE state = ?`).run(state);
    if (!row || Number(row.expires_at) < Date.now()) return null;
    return {
      state: row.state,
      providerId: row.provider_id,
      tenantId: row.tenant_id,
      redirectUri: row.redirect_uri,
      expiresAt: Number(row.expires_at),
    };
  }

  close(): void {
    this.db.close();
  }
}

export function createSqliteOAuthStore(options: SqliteOAuthStoreOptions = {}): SqliteOAuthStore {
  return new SqliteOAuthStore(options);
}

interface ClientRow {
  client_id: string;
  client_name: string;
  redirect_uris: string;
  created_at: number | bigint;
}

interface CodeRow {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  scope: string;
  tenant: string;
  expires_at: number | bigint;
}

interface AccessRow {
  client_id: string;
  client_name: string;
  scope: string;
  tenant: string;
  expires_at: number | bigint;
}

interface TokenRow extends CodeRow {
  access_token: string;
  refresh_token: string;
  client_name: string;
  created_at: number | bigint;
}

interface ProviderStateRow {
  state: string;
  provider_id: string;
  tenant_id: string;
  redirect_uri: string;
  expires_at: number | bigint;
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
}

function parseTenant(value: string): TenantContext {
  const parsed = JSON.parse(value) as TenantContext;
  return { ...parsed };
}

function normalizeBusyTimeout(value: number): number {
  if (!Number.isFinite(value) || value < 0)
    throw new Error("busyTimeoutMs must be a non-negative finite number");
  return Math.trunc(value);
}
