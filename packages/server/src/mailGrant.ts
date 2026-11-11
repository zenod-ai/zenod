// EPIC-26 S11 round 2 (Jordi on ask E26-A6, 2026-11-11: "stuck at setting up domain
// delegation, this should be an agent doing for me interactive"): Zenod sends its mail
// as jordi@zenod.dev through one Google consent instead of a service account with
// domain-wide delegation. Jordi presses Connect mail sender on cloud.zenod.dev/admin/mail,
// signs in as jordi@zenod.dev and allows one scope, gmail.send, on Zenod's existing Google
// client (the Drive one, through its already registered callback, so Google Cloud needs no
// change). The refresh token is sealed with a key derived from CHASSIS_VAULT_MASTER_KEY
// and kept in one private file on Zenod's data volume; it never leaves the server and is
// never logged. Disconnect revokes it at Google and deletes the file.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AccessTokenSource } from "./zenodMail.js";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const DEFAULT_MAIL_SENDER = "jordi@zenod.dev";
export const MAIL_GRANT_FILE = "mail-sender-grant.json";
/** The Drive client's registered callback; mail consent states carry MAIL_GRANT_STATE_PREFIX. */
export const MAIL_GRANT_CALLBACK_PATH = "/api/vault/drive/oauth/callback";
export const MAIL_GRANT_STATE_PREFIX = "zms.";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export interface GoogleMailClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Zenod's Google client (the Drive one) and its registered callback, or null without it. */
export function googleMailClientFromEnv(env: NodeJS.ProcessEnv): GoogleMailClient | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const app = (env.CUSTOMER_APP_URL || "https://cloud.zenod.dev").replace(/\/$/, "");
  return {
    clientId,
    clientSecret,
    redirectUri: env.GOOGLE_DRIVE_VAULT_OAUTH_CALLBACK_URL?.trim() || `${app}${MAIL_GRANT_CALLBACK_PATH}`,
  };
}

/** The one address Zenod sends as. */
export function mailSenderFromEnv(env: NodeJS.ProcessEnv): string {
  return (env.ZENOD_MAIL_SENDER?.trim() || DEFAULT_MAIL_SENDER).toLowerCase();
}

interface Sealed {
  iv: string;
  ct: string;
  tag: string;
}

interface GrantFile {
  email: string;
  scope: string;
  connectedAt: string;
  /** Set when Google refused the refresh token (revoked in Google, password change). */
  refusedAt?: string;
  token: Sealed;
}

export interface MailGrantStatus {
  connected: boolean;
  email?: string;
  connectedAt?: string;
  refusedAt?: string;
}

export class MailGrantStore {
  readonly path: string;
  private readonly key: Buffer | null;

  constructor(dataDir: string, masterKey: string | undefined) {
    this.path = join(dataDir, MAIL_GRANT_FILE);
    const material = masterKey?.trim() ?? "";
    this.key = material.length >= 32
      ? Buffer.from(hkdfSync("sha256", material, "zenod-mail-sender", "gmail.send refresh token v1", 32))
      : null;
  }

  /** False without the master key: then nothing can be stored and the sender stays off. */
  get available(): boolean {
    return this.key !== null;
  }

  private read(): GrantFile | null {
    if (!existsSync(this.path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<GrantFile>;
      if (typeof parsed.email !== "string" || typeof parsed.connectedAt !== "string" || !parsed.token?.ct) return null;
      return parsed as GrantFile;
    } catch {
      return null;
    }
  }

  private write(grant: GrantFile): void {
    mkdirSync(join(this.path, ".."), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(grant, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.path);
  }

  status(): MailGrantStatus {
    const grant = this.read();
    if (!grant) return { connected: false };
    return {
      connected: !grant.refusedAt,
      email: grant.email,
      connectedAt: grant.connectedAt,
      ...(grant.refusedAt ? { refusedAt: grant.refusedAt } : {}),
    };
  }

  /** The stored refresh token, or null when there is none or it cannot be opened. */
  refreshToken(): string | null {
    const grant = this.read();
    if (!grant || !this.key) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(grant.token.iv, "base64url"));
      decipher.setAAD(Buffer.from(`mail-sender:${grant.email}`, "utf8"));
      decipher.setAuthTag(Buffer.from(grant.token.tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(grant.token.ct, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  }

  save(email: string, refreshToken: string, scope: string, now = new Date()): void {
    if (!this.key) throw new Error("the mail sender cannot be stored without the vault key");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`mail-sender:${email}`, "utf8"));
    const ct = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
    this.write({
      email,
      scope,
      connectedAt: now.toISOString(),
      token: { iv: iv.toString("base64url"), ct: ct.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") },
    });
  }

  markRefused(now = new Date()): void {
    const grant = this.read();
    if (grant && !grant.refusedAt) this.write({ ...grant, refusedAt: now.toISOString() });
  }

  clear(): void {
    rmSync(this.path, { force: true });
  }
}

/** Google's consent page for gmail.send on the sender mailbox (offline, so a refresh token comes back). */
export function mailGrantAuthorizeUrl(client: GoogleMailClient, state: string, codeChallenge: string, loginHint: string): string {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: `openid email ${GMAIL_SEND_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    login_hint: loginHint,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params}`;
}

export interface MailGrantExchange {
  refreshToken: string | null;
  email: string | null;
  emailVerified: boolean;
  scopes: string[];
}

/**
 * Trades the consent code for tokens. The ID token comes straight from Google's token
 * endpoint over TLS, so its email claim is read without a signature check (OIDC 3.1.3.7).
 */
export async function exchangeMailGrant(
  client: GoogleMailClient,
  code: string,
  codeVerifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MailGrantExchange> {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: client.redirectUri,
    }).toString(),
  });
  // Never echo the body: it holds tokens on success and can name the account on failure.
  if (!response.ok) throw new Error(`mail consent exchange answered ${response.status}`);
  const body = (await response.json()) as { refresh_token?: string; id_token?: string; scope?: string };
  let claims: { email?: string; email_verified?: boolean } = {};
  try {
    claims = JSON.parse(Buffer.from(body.id_token?.split(".")[1] ?? "", "base64url").toString("utf8")) as typeof claims;
  } catch {
    claims = {};
  }
  return {
    refreshToken: body.refresh_token ?? null,
    email: typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null,
    emailVerified: claims.email_verified === true,
    scopes: (body.scope ?? "").split(/\s+/).filter(Boolean),
  };
}

/** Revokes a token at Google; true when Google confirms (an already dead token counts as gone). */
export async function revokeGoogleToken(token: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return response.ok || response.status === 400;
  } catch {
    return false;
  }
}

/** Access tokens for gmail.send from the stored grant, cached for their hour. */
export function grantAccessToken(
  store: MailGrantStore,
  client: GoogleMailClient,
  sender: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): AccessTokenSource {
  let cached: { token: string; until: number; connectedAt: string } | null = null;
  const ready = () => {
    const status = store.status();
    return status.connected && status.email === sender;
  };
  return {
    ready,
    async token(fresh = false) {
      const status = store.status();
      if (!status.connected || status.email !== sender) throw new Error("the mail sender is not connected");
      const nowMs = now();
      if (!fresh && cached && cached.connectedAt === status.connectedAt && cached.until > nowMs + 60_000) return cached.token;
      const refreshToken = store.refreshToken();
      if (!refreshToken) throw new Error("the mail sender grant cannot be opened");
      const response = await fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: client.clientId,
          client_secret: client.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }).toString(),
      });
      if (!response.ok) {
        const error = await response.json().then((b) => (b as { error?: unknown } | null)?.error, () => null);
        if (error === "invalid_grant") store.markRefused();
        throw new Error(`mail sign-in answered ${response.status}${error === "invalid_grant" ? ", the permission was withdrawn" : ""}`);
      }
      const body = (await response.json()) as { access_token?: string; expires_in?: number };
      if (!body.access_token) throw new Error("mail sign-in gave no token");
      cached = { token: body.access_token, until: nowMs + (body.expires_in ?? 3600) * 1000, connectedAt: status.connectedAt! };
      return cached.token;
    },
  };
}
