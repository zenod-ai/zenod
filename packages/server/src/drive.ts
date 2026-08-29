import { createHash, createSign } from "node:crypto";
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
// Self-hosted OAuth and service-account setups retain their existing full-Drive
// behavior. Hosted uses drive.file only for files Zenod creates in its managed
// archive folder; Hosted beta does not offer Picker/source ingestion.
const SCOPE = "https://www.googleapis.com/auth/drive";
const HOSTED_SCOPE = "https://www.googleapis.com/auth/drive.file";
const USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const FILE_FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,parents,version,md5Checksum,appProperties,headRevisionId";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const MANAGED_ROOT_PROPERTY_KEY = "zenodManagedRoot";
const MANAGED_ROOT_PROPERTY_VERSION = "v2";
const MANAGED_FOLDER_FIELDS = `${FILE_FIELDS},appProperties,capabilities/canAddChildren`;
const VAULT_ROOT_PROPERTY_KEY = "zenodVaultBinding";
const VAULT_ROOT_PROPERTY_VERSION = "v1";

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
  version?: string;
  md5Checksum?: string;
  appProperties?: Record<string, string>;
  headRevisionId?: string;
}

export interface DriveFilePrecondition {
  expectedVersion?: string;
  expectedModifiedTime?: string;
  /** SHA-256 of the current content, used when metadata alone is insufficient. */
  expectedChecksum?: string;
}

export interface DriveRevision {
  id: string;
  modifiedTime?: string;
  md5Checksum?: string;
  keepForever?: boolean;
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

async function fetchWithNetworkRetry(input: string | URL, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export class DriveClient {
  private readonly auth: DriveAuth;
  private readonly account: ServiceAccount | null;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    auth: string | DriveAuth,
    initialToken?: { accessToken: string; expiresInSeconds?: number },
  ) {
    this.auth = typeof auth === "string" ? { kind: "service_account", serviceAccountJson: auth } : auth;
    this.account = this.auth.kind === "service_account" ? parseServiceAccount(this.auth.serviceAccountJson) : null;
    if (initialToken?.accessToken) {
      this.accessToken = initialToken.accessToken;
      this.tokenExpiresAt = Date.now() + (initialToken.expiresInSeconds ?? 3600) * 1000;
    }
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

    const response = await fetchWithNetworkRetry(TOKEN_URL, {
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
    const response = await fetchWithNetworkRetry(TOKEN_URL, {
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
    options: { folderId?: string; nameContains?: string; pageSize?: number; foldersOnly?: boolean; allPages?: boolean } = {},
  ): Promise<DriveFile[]> {
    const clauses = ["trashed = false", `mimeType ${options.foldersOnly ? "=" : "!="} '${FOLDER_MIME}'`];
    if (options.folderId) clauses.push(`'${options.folderId.replaceAll("'", "\\'")}' in parents`);
    if (options.nameContains) clauses.push(`name contains '${options.nameContains.replaceAll("'", "\\'")}'`);
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const response = await this.request("/files", {
        q: clauses.join(" and "),
        orderBy: "modifiedTime desc",
        pageSize: String(options.pageSize ?? 50),
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        includeItemsFromAllDrives: "true",
        corpora: "allDrives",
        ...(pageToken ? { pageToken } : {}),
      });
      const data = (await response.json()) as { files?: DriveFile[]; nextPageToken?: string };
      files.push(...(data.files ?? []));
      pageToken = options.allPages ? data.nextPageToken : undefined;
    } while (pageToken);
    return files;
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
   * Reuse a writable stored Hosted root when possible, otherwise recover the
   * app-owned root by its private marker or create it in My Drive. With
   * drive.file, the query can only see files this OAuth client created/opened.
   */
  async ensureManagedRootFolder(tenantMarker: string, storedFolderId?: string | null): Promise<string> {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(tenantMarker)) {
      throw new Error("Hosted Drive folder marker is invalid");
    }
    const markerValue = `${MANAGED_ROOT_PROPERTY_VERSION}:${tenantMarker}`;
    const folderName = `Zenod archive ${tenantMarker.slice(0, 10)}`;
    type ManagedFolder = DriveFile & {
      appProperties?: Record<string, string>;
      capabilities?: { canAddChildren?: boolean };
    };
    const isManagedWritableFolder = (folder: ManagedFolder | null): folder is ManagedFolder =>
      folder?.mimeType === FOLDER_MIME &&
      folder.name === folderName &&
      folder.appProperties?.[MANAGED_ROOT_PROPERTY_KEY] === markerValue &&
      folder.capabilities?.canAddChildren === true;

    if (storedFolderId) {
      const storedResponse = await this.request(`/files/${encodeURIComponent(storedFolderId)}`, {
        fields: MANAGED_FOLDER_FIELDS,
      }).catch(() => null);
      const stored = storedResponse
        ? await storedResponse.json().catch(() => null) as ManagedFolder | null
        : null;
      if (isManagedWritableFolder(stored)) {
        return storedFolderId;
      }
    }

    const response = await this.request("/files", {
      q: `trashed = false and mimeType = '${FOLDER_MIME}' and appProperties has { key='${MANAGED_ROOT_PROPERTY_KEY}' and value='${markerValue}' }`,
      orderBy: "createdTime asc",
      pageSize: "10",
      spaces: "drive",
      fields: `files(${MANAGED_FOLDER_FIELDS})`,
    });
    const data = (await response.json()) as { files?: ManagedFolder[] };
    const recovered = data.files?.find(isManagedWritableFolder);
    if (recovered?.id) return recovered.id;

    const created = await this.request(
      "/files",
      { fields: FILE_FIELDS },
      {
        method: "POST",
        body: {
          name: folderName,
          mimeType: FOLDER_MIME,
          appProperties: { [MANAGED_ROOT_PROPERTY_KEY]: markerValue },
        },
      },
    );
    const folder = (await created.json()) as { id?: unknown };
    if (typeof folder.id !== "string" || !folder.id) {
      throw new Error("Drive API did not return the managed archive folder ID");
    }
    return folder.id;
  }

  /** Recover or create the app-owned ordinary-file root for one Drive vault binding. */
  async ensureVaultRootFolder(vaultBindingId: string, storedFolderId?: string | null): Promise<string> {
    if (!vaultBindingId || vaultBindingId.length > 100) throw new Error("Drive vault binding ID is invalid");
    const markerValue = `${VAULT_ROOT_PROPERTY_VERSION}:${vaultBindingId}`;
    type VaultFolder = DriveFile & { capabilities?: { canAddChildren?: boolean } };
    const matches = (folder: VaultFolder | null): folder is VaultFolder =>
      folder?.mimeType === FOLDER_MIME
      && folder.name === "Zenod Vault"
      && folder.appProperties?.[VAULT_ROOT_PROPERTY_KEY] === markerValue
      && folder.capabilities?.canAddChildren === true;

    if (storedFolderId) {
      const response = await this.request(`/files/${encodeURIComponent(storedFolderId)}`, { fields: MANAGED_FOLDER_FIELDS }).catch(() => null);
      const stored = response ? await response.json().catch(() => null) as VaultFolder | null : null;
      if (matches(stored)) return storedFolderId;
    }
    const response = await this.request("/files", {
      q: `trashed = false and mimeType = '${FOLDER_MIME}' and appProperties has { key='${VAULT_ROOT_PROPERTY_KEY}' and value='${markerValue.replaceAll("'", "\\'")}' }`,
      orderBy: "createdTime asc",
      pageSize: "10",
      spaces: "drive",
      fields: `files(${MANAGED_FOLDER_FIELDS})`,
    });
    const recovered = ((await response.json()) as { files?: VaultFolder[] }).files?.find(matches);
    if (recovered) return recovered.id;
    const created = await this.request("/files", { fields: MANAGED_FOLDER_FIELDS }, {
      method: "POST",
      body: {
        name: "Zenod Vault",
        mimeType: FOLDER_MIME,
        appProperties: { [VAULT_ROOT_PROPERTY_KEY]: markerValue },
      },
    });
    const folder = await created.json() as VaultFolder;
    if (!folder.id) throw new Error("Drive API did not return the Zenod Vault folder ID");
    return folder.id;
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
    options: { appProperties?: Record<string, string> } = {},
  ): Promise<DriveFile> {
    const boundary = `zenod-${base64url(name).slice(0, 16)}-boundary`;
    const metadata = JSON.stringify({ name, mimeType, parents: [parentFolderId], ...options });
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

  private async assertFilePrecondition(fileId: string, precondition: DriveFilePrecondition): Promise<DriveFile> {
    const current = await this.getFile(fileId);
    if (precondition.expectedVersion && current.version !== precondition.expectedVersion) {
      throw new Error(`Drive file conflict: version changed for ${fileId}`);
    }
    if (precondition.expectedModifiedTime && current.modifiedTime !== precondition.expectedModifiedTime) {
      throw new Error(`Drive file conflict: modified time changed for ${fileId}`);
    }
    if (precondition.expectedChecksum) {
      const checksum = createHash("sha256").update(await this.download(fileId)).digest("hex");
      if (checksum !== precondition.expectedChecksum) throw new Error(`Drive file conflict: checksum changed for ${fileId}`);
    }
    return current;
  }

  /** Replace one ordinary file after verifying its captured Drive version/content. */
  async updateFile(
    fileId: string,
    mimeType: string,
    data: Buffer,
    precondition: DriveFilePrecondition,
  ): Promise<DriveFile> {
    await this.assertFilePrecondition(fileId, precondition);
    const boundary = `zenod-update-${fileId.slice(0, 12)}-boundary`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n`
        + `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const url = new URL(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set("uploadType", "multipart");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("fields", FILE_FIELDS);
    const response = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Drive update failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    return await response.json() as DriveFile;
  }

  /** Move a file into a folder (e.g. inbox → Archive). The file ID — and so its webViewLink — is unchanged. */
  async moveFile(
    fileId: string,
    toFolderId: string,
    precondition: DriveFilePrecondition = {},
    newName?: string,
  ): Promise<DriveFile> {
    const { parents } = await this.assertFilePrecondition(fileId, precondition);
    const moved = await this.request(
      `/files/${encodeURIComponent(fileId)}`,
      {
        addParents: toFolderId,
        ...(parents?.length ? { removeParents: parents.join(",") } : {}),
        fields: FILE_FIELDS,
      },
      { method: "PATCH", body: newName ? { name: newName } : {} },
    );
    return await moved.json() as DriveFile;
  }

  /** List the complete API-visible blob revision history (pagination included). */
  async listRevisions(fileId: string): Promise<DriveRevision[]> {
    const revisions: DriveRevision[] = [];
    let pageToken: string | undefined;
    do {
      const response = await this.request(`/files/${encodeURIComponent(fileId)}/revisions`, {
        fields: "nextPageToken,revisions(id,modifiedTime,md5Checksum,keepForever)",
        pageSize: "1000",
        ...(pageToken ? { pageToken } : {}),
      });
      const page = await response.json() as { revisions?: DriveRevision[]; nextPageToken?: string };
      revisions.push(...(page.revisions ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return revisions;
  }

  /** Pin a non-head blob revision before downloading it for conflict preservation. */
  async keepRevision(fileId: string, revisionId: string): Promise<void> {
    await this.request(
      `/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}`,
      { fields: "id,keepForever" },
      { method: "PATCH", body: { keepForever: true } },
    );
  }

  async downloadRevision(fileId: string, revisionId: string): Promise<Buffer> {
    const response = await this.request(
      `/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}`,
      { alt: "media" },
    );
    return Buffer.from(await response.arrayBuffer());
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
export function googleDriveOAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  mode?: "self-hosted" | "hosted-managed";
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    `${input.mode === "hosted-managed" ? HOSTED_SCOPE : SCOPE} ${USERINFO_EMAIL_SCOPE}`,
  );
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
}): Promise<{ refreshToken: string; accessToken: string | null; email: string | null }> {
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
  return { refreshToken: data.refresh_token, accessToken: data.access_token ?? null, email };
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
