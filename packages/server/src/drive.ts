import { createSign } from "node:crypto";
import type { Settings } from "./settings.js";

/**
 * Small Google Drive REST client. It supports the original service-account
 * path and a user OAuth path; the Drive API calls stay identical once we have
 * a bearer token.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
// Full (not readonly) scope: ingestion archives consumed files into an
// Archive/ subfolder. The service account still only ever sees what the
// user explicitly shared with it.
const SCOPE = "https://www.googleapis.com/auth/drive";
const OAUTH_SCOPE = `${SCOPE} https://www.googleapis.com/auth/userinfo.email`;
const FILE_FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,parents";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export type DriveAuth =
  | { kind: "service_account"; serviceAccountJson: string }
  | { kind: "oauth"; clientId: string; clientSecret: string; refreshToken: string; email?: string | null };

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** Bytes, as the API returns it (absent for Google-native files). */
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
}

export function parseServiceAccount(json: string): ServiceAccount {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error("service account is not valid JSON — paste the full key file from Google Cloud");
  }
  const email = parsed.client_email;
  const key = parsed.private_key;
  if (typeof email !== "string" || typeof key !== "string") {
    throw new Error("service account JSON is missing client_email or private_key");
  }
  return { client_email: email, private_key: key };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export class DriveClient {
  private readonly auth: DriveAuth;
  private readonly account: ServiceAccount | null;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(auth: string | DriveAuth) {
    this.auth = typeof auth === "string" ? { kind: "service_account", serviceAccountJson: auth } : auth;
    this.account = this.auth.kind === "service_account" ? parseServiceAccount(this.auth.serviceAccountJson) : null;
  }

  get accountLabel(): string {
    if (this.account) return this.account.client_email;
    return this.auth.kind === "oauth" && this.auth.email ? this.auth.email : "Google OAuth user";
  }

  get clientEmail(): string | null {
    return this.account?.client_email ?? null;
  }

  /** Mint/refresh (and cache) an access token. */
  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) return this.accessToken;
    return this.auth.kind === "oauth" ? this.oauthToken() : this.serviceAccountToken();
  }

  /** Mint (and cache) an access token via the signed-JWT grant. */
  private async serviceAccountToken(): Promise<string> {
    if (!this.account) throw new Error("service account is not configured");
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = base64url(
      JSON.stringify({
        iss: this.account.client_email,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      }),
    );
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    const signature = signer.sign(this.account.private_key).toString("base64url");
    const assertion = `${header}.${claims}.${signature}`;

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Google token exchange failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  /** Refresh a Google user OAuth token. Uploads then use the user's quota. */
  private async oauthToken(): Promise<string> {
    if (this.auth.kind !== "oauth") throw new Error("Google OAuth is not configured");
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.auth.clientId,
        client_secret: this.auth.clientSecret,
        refresh_token: this.auth.refreshToken,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Google OAuth refresh failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    const data = (await response.json()) as { access_token: string; expires_in?: number };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  private async request(
    path: string,
    params: Record<string, string>,
    init: { method?: string; body?: unknown } = {},
  ): Promise<Response> {
    const url = new URL(`${DRIVE_API}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    // Shared drives need these on every call; harmless on My Drive files.
    url.searchParams.set("supportsAllDrives", "true");
    const response = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Drive API ${path} failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    return response;
  }

  /**
   * List files visible to the service account, newest first. Scoped to
   * folderId when given; nameContains filters by name substring.
   */
  async listFiles(
    options: { folderId?: string; nameContains?: string; pageSize?: number; foldersOnly?: boolean } = {},
  ): Promise<DriveFile[]> {
    const clauses = ["trashed = false", `mimeType ${options.foldersOnly ? "=" : "!="} '${FOLDER_MIME}'`];
    if (options.folderId) clauses.push(`'${options.folderId.replaceAll("'", "\\'")}' in parents`);
    if (options.nameContains) clauses.push(`name contains '${options.nameContains.replaceAll("'", "\\'")}'`);
    const response = await this.request("/files", {
      q: clauses.join(" and "),
      orderBy: "modifiedTime desc",
      pageSize: String(options.pageSize ?? 50),
      fields: `files(${FILE_FIELDS})`,
      includeItemsFromAllDrives: "true",
      corpora: "allDrives",
    });
    const data = (await response.json()) as { files: DriveFile[] };
    return data.files;
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const response = await this.request(`/files/${encodeURIComponent(fileId)}`, { fields: FILE_FIELDS });
    return (await response.json()) as DriveFile;
  }

  /** Download a binary file's content (alt=media). */
  async download(fileId: string): Promise<Buffer> {
    const response = await this.request(`/files/${encodeURIComponent(fileId)}`, { alt: "media" });
    return Buffer.from(await response.arrayBuffer());
  }

  /** Export a Google-native file (Doc, Sheet, Slides) as plain text. */
  async exportText(fileId: string): Promise<string> {
    const response = await this.request(`/files/${encodeURIComponent(fileId)}/export`, { mimeType: "text/plain" });
    return response.text();
  }

  /** Whether the connected account can create/move files inside this folder. */
  async canWrite(folderId: string): Promise<boolean> {
    const response = await this.request(`/files/${encodeURIComponent(folderId)}`, {
      fields: "capabilities/canAddChildren",
    });
    const data = (await response.json()) as { capabilities?: { canAddChildren?: boolean } };
    return data.capabilities?.canAddChildren === true;
  }

  /** Find (or create) a subfolder by name — e.g. the Archive/ inside the inbox. */
  async ensureFolder(name: string, parentId: string): Promise<string> {
    const existing = await this.listFiles({ folderId: parentId, nameContains: name, foldersOnly: true });
    const match = existing.find((f) => f.name === name);
    if (match) return match.id;
    const response = await this.request(
      "/files",
      { fields: "id" },
      { method: "POST", body: { name, mimeType: FOLDER_MIME, parents: [parentId] } },
    );
    return ((await response.json()) as { id: string }).id;
  }

  /**
   * Upload a new binary file into a folder. Uses the multipart upload endpoint
   * (metadata + media in one request), which the JSON-only `request()` helper
   * can't express, so it builds the multipart/related body and fetches directly.
   */
  async uploadFile(
    name: string,
    mimeType: string,
    data: Buffer,
    parentFolderId: string,
  ): Promise<DriveFile> {
    const boundary = `zenod-${base64url(name).slice(0, 16)}-boundary`;
    const metadata = JSON.stringify({ name, mimeType, parents: [parentFolderId] });
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
          `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
    url.searchParams.set("uploadType", "multipart");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("fields", FILE_FIELDS);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Drive upload failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    return (await response.json()) as DriveFile;
  }

  /** Move a file into a folder (e.g. inbox → Archive). The file ID — and so its webViewLink — is unchanged. */
  async moveFile(fileId: string, toFolderId: string): Promise<void> {
    const response = await this.request(`/files/${encodeURIComponent(fileId)}`, { fields: "parents" });
    const { parents } = (await response.json()) as { parents?: string[] };
    await this.request(
      `/files/${encodeURIComponent(fileId)}`,
      {
        addParents: toFolderId,
        ...(parents?.length ? { removeParents: parents.join(",") } : {}),
        fields: "id",
      },
      { method: "PATCH", body: {} },
    );
  }
}

export function driveAuthFromSettings(settings: Settings): DriveAuth | null {
  const authority = settings.googleDriveOAuthAuthority();
  if (authority.mode === "hosted-managed") {
    const refreshToken = settings.getRaw("google_oauth_refresh_token");
    return authority.credentials && refreshToken
      ? {
          kind: "oauth",
          ...authority.credentials,
          refreshToken,
          email: settings.getRaw("google_oauth_email"),
        }
      : null;
  }
  const clientId = settings.get("google_oauth_client_id");
  const clientSecret = settings.get("google_oauth_client_secret");
  if (clientId && clientSecret) {
    const refreshToken = settings.getRaw("google_oauth_refresh_token");
    if (refreshToken) {
      return { kind: "oauth", clientId, clientSecret, refreshToken, email: settings.getRaw("google_oauth_email") };
    }
  }
  const serviceAccountJson = settings.get("google_service_account_json");
  return serviceAccountJson ? { kind: "service_account", serviceAccountJson } : null;
}

export function driveClientFromSettings(settings: Settings): DriveClient | null {
  const auth = driveAuthFromSettings(settings);
  return auth ? new DriveClient(auth) : null;
}

/** Build the Google consent-screen URL for the Connect button. */
export function googleDriveOAuthUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OAUTH_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export async function exchangeGoogleDriveOAuthCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<{ refreshToken: string; email: string | null }> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google OAuth code exchange failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await response.json()) as { access_token?: string; refresh_token?: string };
  if (!data.refresh_token) {
    throw new Error("Google did not return a refresh token; reconnect and approve offline Drive access");
  }
  let email: string | null = null;
  if (data.access_token) email = await fetchGoogleUserEmail(data.access_token).catch(() => null);
  return { refreshToken: data.refresh_token, email };
}

async function fetchGoogleUserEmail(accessToken: string): Promise<string | null> {
  const response = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  const data = (await response.json()) as { email?: unknown };
  return typeof data.email === "string" ? data.email : null;
}

/** Verify the configured Drive auth works and can see files (the Test button). */
export async function testDrive(auth: string | DriveAuth, folderId?: string): Promise<{ ok: boolean; message: string }> {
  try {
    const client = new DriveClient(auth);
    const files = await client.listFiles({ ...(folderId ? { folderId } : {}), pageSize: 5 });

    // Archiving needs write access on the folder; warn early when it's view-only.
    let writeNote = "";
    if (folderId) {
      const writable = await client.canWrite(folderId).catch(() => null);
      if (writable === false) writeNote = " — shared view-only: ingestion works, but archiving needs Editor access";
    }

    if (files.length === 0) {
      return {
        ok: true,
        message: `connected as ${client.accountLabel}, but no files are visible yet — pick a Zenod Drive folder or drop a file in the root/Inbox`,
      };
    }
    return {
      ok: true,
      message: `connected as ${client.accountLabel} — ${files.length === 5 ? "5+" : files.length} file(s) in the Zenod Drive folder, newest: ${files[0]!.name}${writeNote}`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
