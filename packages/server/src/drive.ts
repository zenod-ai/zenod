import { createSign } from "node:crypto";

/**
 * Google Drive client over a service account — the M1.5 design
 * (docs/ROADMAP.md), chosen because it is the cheapest durable path for a
 * self-hosted instance: the user creates a service account, shares a Drive
 * folder with its email, and pastes the JSON key in the Connections tab. No
 * OAuth consent screen, no app-verification dance, no 7-day token expiry —
 * and no googleapis dependency: a hand-rolled RS256 JWT and the Drive v3
 * REST API are all that read-only access needs.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
// Full (not readonly) scope: ingestion archives consumed files into an
// Archive/ subfolder. The service account still only ever sees what the
// user explicitly shared with it.
const SCOPE = "https://www.googleapis.com/auth/drive";
const FILE_FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** Bytes, as the API returns it (absent for Google-native files). */
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
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
  private readonly account: ServiceAccount;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(serviceAccountJson: string) {
    this.account = parseServiceAccount(serviceAccountJson);
  }

  get clientEmail(): string {
    return this.account.client_email;
  }

  /** Mint (and cache) an access token via the signed-JWT grant. */
  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) return this.accessToken;

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

/** Verify the service account works and can see files (the Test button). */
export async function testDrive(
  serviceAccountJson: string,
  folderId?: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const client = new DriveClient(serviceAccountJson);
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
        message: `connected as ${client.clientEmail}, but no files are visible yet — share your Drive folder with that email (Editor, so ingested files can be archived)`,
      };
    }
    return {
      ok: true,
      message: `connected as ${client.clientEmail} — ${files.length === 5 ? "5+" : files.length} file(s) in the inbox, newest: ${files[0]!.name}${writeNote}`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
