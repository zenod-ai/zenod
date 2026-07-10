import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openSqlite, type TenantStorage, type TenantVault } from "@zenod/mcp-chassis";

const HANDLE_PREFIX = "zenod-secret:v1:";
const HANDLE_RE = /^zenod-secret:v1:[a-f0-9]{48}$/;
const LOCAL_KEY_FILE = ".zenod-vault-key";
const CHASSIS_RECORD_PREFIX = "zenod.credential.";
const CHASSIS_RECORD_OWNER = "zenod";

export interface CredentialMetadata {
  key: string;
  handle: string;
  updatedAt: number;
}

/**
 * Zenod's compatibility boundary for chassis-owned secret custody. Implementations
 * are tenant-bound; callers must provide both the expected key class and handle.
 */
export interface CredentialVault {
  put(key: string, value: string): string;
  materialize(key: string, handle: string): string | null;
  delete(key: string, handle: string): boolean;
  list(): CredentialMetadata[];
  close(): void;
}

export interface SqliteCredentialVaultOptions {
  dataDir: string;
  tenantId: string;
  masterKey?: string;
}

interface ChassisCredentialEnvelope {
  version: 1;
  owner: typeof CHASSIS_RECORD_OWNER;
  tenantId: string;
  key: string;
  handle: string;
  value: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChassisCredentialVaultOptions {
  vaultName?: string;
}

/**
 * Hosted adapter over the vault handle supplied by an authenticated chassis
 * UnitContext. Tenant identity is accepted only from TenantStorage, never input.
 */
export class ChassisCredentialVault implements CredentialVault {
  private readonly tenantId: string;
  private readonly vault: TenantVault;
  private closed = false;

  constructor(storage: TenantStorage, options: ChassisCredentialVaultOptions = {}) {
    this.tenantId = storage.tenant.id;
    assertTenantId(this.tenantId);
    this.vault = options.vaultName ? storage.vault(options.vaultName) : storage.vault();
  }

  put(key: string, value: string): string {
    this.assertOpen();
    const safeKey = assertCredentialKey(key);
    if (!value) throw new Error("credential value must not be empty");
    const existing = this.readEnvelope(safeKey);
    const now = Date.now();
    const envelope: ChassisCredentialEnvelope = {
      version: 1,
      owner: CHASSIS_RECORD_OWNER,
      tenantId: this.tenantId,
      key: safeKey,
      handle: existing?.handle ?? newCredentialHandle(),
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.vault.set(chassisRecordKey(safeKey), JSON.stringify(envelope));
    return envelope.handle;
  }

  materialize(key: string, handle: string): string | null {
    this.assertOpen();
    if (!isCredentialHandle(handle)) return null;
    const envelope = this.readEnvelope(assertCredentialKey(key));
    return envelope?.handle === handle ? envelope.value : null;
  }

  delete(key: string, handle: string): boolean {
    this.assertOpen();
    const safeKey = assertCredentialKey(key);
    const envelope = this.readEnvelope(safeKey);
    if (!envelope || envelope.handle !== handle) return false;
    return this.vault.delete(chassisRecordKey(safeKey)) > 0;
  }

  list(): CredentialMetadata[] {
    this.assertOpen();
    return this.vault
      .listKeys()
      .filter((key) => key.startsWith(CHASSIS_RECORD_PREFIX))
      .map((key) => this.readEnvelope(key.slice(CHASSIS_RECORD_PREFIX.length)))
      .filter((entry): entry is ChassisCredentialEnvelope => entry !== null)
      .map((entry) => ({ key: entry.key, handle: entry.handle, updatedAt: entry.updatedAt }));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.vault.close();
  }

  private readEnvelope(key: string): ChassisCredentialEnvelope | null {
    const safeKey = assertCredentialKey(key);
    const stored = this.vault.get(chassisRecordKey(safeKey));
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored) as Partial<ChassisCredentialEnvelope>;
      if (
        parsed.version !== 1 ||
        parsed.owner !== CHASSIS_RECORD_OWNER ||
        parsed.tenantId !== this.tenantId ||
        parsed.key !== safeKey ||
        typeof parsed.handle !== "string" ||
        !isCredentialHandle(parsed.handle) ||
        typeof parsed.value !== "string" ||
        !parsed.value ||
        typeof parsed.createdAt !== "number" ||
        !Number.isFinite(parsed.createdAt) ||
        typeof parsed.updatedAt !== "number" ||
        !Number.isFinite(parsed.updatedAt)
      ) {
        return null;
      }
      return parsed as ChassisCredentialEnvelope;
    } catch {
      return null;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("credential vault is closed");
  }
}

/**
 * Encrypted standalone fallback. Hosted chassis integration can inject its own
 * CredentialVault without changing Settings or any credential consumer.
 */
export class SqliteCredentialVault implements CredentialVault {
  private readonly db: DatabaseSync;
  private readonly encryptionKey: Buffer;

  constructor(private readonly options: SqliteCredentialVaultOptions) {
    assertTenantId(options.tenantId);
    mkdirSync(options.dataDir, { recursive: true });
    this.encryptionKey = deriveEncryptionKey(options);
    this.db = openSqlite(join(options.dataDir, "vault.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS credential_entries (
        handle TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        key_name TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        iv BLOB NOT NULL,
        auth_tag BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (tenant_id, key_name)
      );
      CREATE INDEX IF NOT EXISTS idx_credential_entries_tenant_key
        ON credential_entries (tenant_id, key_name);
    `);
  }

  put(key: string, value: string): string {
    const safeKey = assertCredentialKey(key);
    if (!value) throw new Error("credential value must not be empty");
    const existing = this.db
      .prepare("SELECT handle, created_at FROM credential_entries WHERE tenant_id = ? AND key_name = ?")
      .get(this.options.tenantId, safeKey) as { handle: string; created_at: number } | undefined;
    const handle = existing?.handle ?? newCredentialHandle();
    const encrypted = encrypt(value, this.encryptionKey, aad(this.options.tenantId, safeKey, handle));
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO credential_entries (
           handle, tenant_id, key_name, ciphertext, iv, auth_tag, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, key_name) DO UPDATE SET
           handle = excluded.handle,
           ciphertext = excluded.ciphertext,
           iv = excluded.iv,
           auth_tag = excluded.auth_tag,
           updated_at = excluded.updated_at`,
      )
      .run(
        handle,
        this.options.tenantId,
        safeKey,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        existing?.created_at ?? now,
        now,
      );
    return handle;
  }

  materialize(key: string, handle: string): string | null {
    const safeKey = assertCredentialKey(key);
    if (!isCredentialHandle(handle)) return null;
    const row = this.db
      .prepare(
        `SELECT ciphertext, iv, auth_tag
           FROM credential_entries
          WHERE tenant_id = ? AND key_name = ? AND handle = ?`,
      )
      .get(this.options.tenantId, safeKey, handle) as
      | { ciphertext: Uint8Array; iv: Uint8Array; auth_tag: Uint8Array }
      | undefined;
    if (!row) return null;
    return decrypt(
      row.ciphertext,
      row.iv,
      row.auth_tag,
      this.encryptionKey,
      aad(this.options.tenantId, safeKey, handle),
    );
  }

  delete(key: string, handle: string): boolean {
    const result = this.db
      .prepare("DELETE FROM credential_entries WHERE tenant_id = ? AND key_name = ? AND handle = ?")
      .run(this.options.tenantId, assertCredentialKey(key), handle);
    return Number(result.changes) > 0;
  }

  list(): CredentialMetadata[] {
    const rows = this.db
      .prepare(
        `SELECT key_name, handle, updated_at
           FROM credential_entries
          WHERE tenant_id = ?
          ORDER BY key_name`,
      )
      .all(this.options.tenantId) as Array<{ key_name: string; handle: string; updated_at: number }>;
    return rows.map((row) => ({ key: row.key_name, handle: row.handle, updatedAt: row.updated_at }));
  }

  close(): void {
    this.db.close();
  }
}

export function isCredentialHandle(value: string): boolean {
  return HANDLE_RE.test(value);
}

function newCredentialHandle(): string {
  return `${HANDLE_PREFIX}${randomBytes(24).toString("hex")}`;
}

function chassisRecordKey(key: string): string {
  return `${CHASSIS_RECORD_PREFIX}${key}`;
}

function assertTenantId(tenantId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(tenantId)) {
    throw new Error("credential vault tenant id is invalid");
  }
}

function assertCredentialKey(key: string): string {
  const trimmed = key.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(trimmed)) {
    throw new Error("credential key is invalid");
  }
  return trimmed;
}

function deriveEncryptionKey(options: SqliteCredentialVaultOptions): Buffer {
  const masterKey = options.masterKey ?? process.env.ZENOD_CREDENTIAL_MASTER_KEY;
  if (masterKey) {
    return createHash("sha256")
      .update("zenod-credential-vault\0")
      .update(options.tenantId)
      .update("\0")
      .update(masterKey)
      .digest();
  }

  const keyPath = join(options.dataDir, LOCAL_KEY_FILE);
  try {
    const existing = readFileSync(keyPath);
    if (existing.length !== 32) throw new Error(`${LOCAL_KEY_FILE} must contain exactly 32 bytes`);
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const generated = randomBytes(32);
  try {
    writeFileSync(keyPath, generated, { flag: "wx", mode: 0o600 });
    return generated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = readFileSync(keyPath);
    if (existing.length !== 32) throw new Error(`${LOCAL_KEY_FILE} must contain exactly 32 bytes`);
    return existing;
  }
}

function aad(tenantId: string, key: string, handle: string): Buffer {
  return Buffer.from(`${tenantId}\0${key}\0${handle}`, "utf8");
}

function encrypt(value: string, key: Buffer, additionalData: Buffer): {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(additionalData);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function decrypt(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  authTag: Uint8Array,
  key: Buffer,
  additionalData: Buffer,
): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv));
  decipher.setAAD(additionalData);
  decipher.setAuthTag(Buffer.from(authTag));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]).toString("utf8");
}
