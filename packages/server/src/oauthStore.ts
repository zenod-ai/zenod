import { DatabaseSync } from "node:sqlite";
import { openZenodSqlite } from "./sqlite.js";

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: number;
}

export interface AuthCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  expiresAt: number;
}

export interface OAuthToken {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientName: string;
  resource: string;
  scope: string;
  expiresAt: number;
  createdAt: number;
}

/**
 * Storage for the OAuth 2.1 provider — its own SQLite file so it never
 * contends with the main settings/conversation DB.
 */
export class OAuthStore {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(path: string) {
    this.db = openZenodSqlite(path);
    this.db.exec(`
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
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        access_token TEXT PRIMARY KEY,
        refresh_token TEXT NOT NULL,
        client_id TEXT NOT NULL,
        client_name TEXT NOT NULL,
        resource TEXT NOT NULL,
        scope TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tokens_refresh ON oauth_tokens (refresh_token);
    `);
  }

  // --- clients ---

  createClient(client: OAuthClient): void {
    this.db
      .prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)")
      .run(client.clientId, client.clientName, JSON.stringify(client.redirectUris), client.createdAt);
  }

  getClient(clientId: string): OAuthClient | null {
    const row = this.db.prepare("SELECT * FROM oauth_clients WHERE client_id = ?").get(clientId) as
      | { client_id: string; client_name: string; redirect_uris: string; created_at: number }
      | undefined;
    if (!row) return null;
    return {
      clientId: row.client_id,
      clientName: row.client_name,
      redirectUris: JSON.parse(row.redirect_uris),
      createdAt: row.created_at,
    };
  }

  // --- authorization codes (one-time, short-lived) ---

  createCode(code: AuthCode): void {
    this.db
      .prepare(
        `INSERT INTO oauth_codes (code, client_id, redirect_uri, code_challenge, resource, scope, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(code.code, code.clientId, code.redirectUri, code.codeChallenge, code.resource, code.scope, code.expiresAt);
  }

  /** Fetch and delete an auth code (single use). Returns null if missing or expired. */
  consumeCode(code: string): AuthCode | null {
    const row = this.db.prepare("SELECT * FROM oauth_codes WHERE code = ?").get(code) as
      | {
          code: string;
          client_id: string;
          redirect_uri: string;
          code_challenge: string;
          resource: string;
          scope: string;
          expires_at: number;
        }
      | undefined;
    this.db.prepare("DELETE FROM oauth_codes WHERE code = ?").run(code);
    if (!row || row.expires_at < Date.now()) return null;
    return {
      code: row.code,
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      codeChallenge: row.code_challenge,
      resource: row.resource,
      scope: row.scope,
      expiresAt: row.expires_at,
    };
  }

  // --- tokens ---

  createToken(token: OAuthToken): void {
    this.db
      .prepare(
        `INSERT INTO oauth_tokens (access_token, refresh_token, client_id, client_name, resource, scope, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        token.accessToken,
        token.refreshToken,
        token.clientId,
        token.clientName,
        token.resource,
        token.scope,
        token.expiresAt,
        token.createdAt,
      );
  }

  getByAccessToken(accessToken: string): OAuthToken | null {
    return this.toToken(this.db.prepare("SELECT * FROM oauth_tokens WHERE access_token = ?").get(accessToken));
  }

  getByRefreshToken(refreshToken: string): OAuthToken | null {
    return this.toToken(this.db.prepare("SELECT * FROM oauth_tokens WHERE refresh_token = ?").get(refreshToken));
  }

  /** Replace an access token on refresh (rotates the access token, keeps the refresh token). */
  rotateAccessToken(refreshToken: string, newAccess: string, expiresAt: number): void {
    this.db
      .prepare("UPDATE oauth_tokens SET access_token = ?, expires_at = ? WHERE refresh_token = ?")
      .run(newAccess, expiresAt, refreshToken);
  }

  listTokens(): Array<{ clientName: string; clientId: string; createdAt: number; expiresAt: number }> {
    return this.db
      .prepare(
        "SELECT client_name AS clientName, client_id AS clientId, created_at AS createdAt, expires_at AS expiresAt FROM oauth_tokens ORDER BY created_at DESC",
      )
      .all() as Array<{ clientName: string; clientId: string; createdAt: number; expiresAt: number }>;
  }

  revokeClient(clientId: string): void {
    this.db.prepare("DELETE FROM oauth_tokens WHERE client_id = ?").run(clientId);
  }

  private toToken(row: unknown): OAuthToken | null {
    if (!row) return null;
    const r = row as Record<string, string | number>;
    return {
      accessToken: String(r.access_token),
      refreshToken: String(r.refresh_token),
      clientId: String(r.client_id),
      clientName: String(r.client_name),
      resource: String(r.resource),
      scope: String(r.scope),
      expiresAt: Number(r.expires_at),
      createdAt: Number(r.created_at),
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
