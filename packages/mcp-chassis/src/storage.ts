import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DATA_DIR = "/data";
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const TENANT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const PATH_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const VAULT_MASTER_KEY_ENV = "CHASSIS_VAULT_MASTER_KEY";
const VAULT_ENVELOPE_PREFIX = "mcp-chassis-vault:v1:";
const VAULT_KEY_BYTES = 32;
const VAULT_IV_BYTES = 12;
const VAULT_AUTH_TAG_BYTES = 16;
const VAULT_KDF_SALT = Buffer.from("zenod-mcp-chassis-vault-v1", "utf8");

export interface UnitTenant {
  /** Trusted tenant identity resolved by chassis auth, never from a tool argument. */
  id: string;
}

export interface ChassisStorageOptions {
  /** Unit data root. Hosted containers use /data; tests may pass a temp dir. */
  dataDir?: string;
  /** SQLite busy timeout applied to every chassis-opened database handle. */
  busyTimeoutMs?: number;
  /**
   * 32-byte tenant-vault master key (Uint8Array, 64-char hex, or 32-byte
   * base64/base64url). Defaults to CHASSIS_VAULT_MASTER_KEY. Never persisted.
   */
  vaultEncryptionKey?: string | Uint8Array;
}

export interface TenantStorage {
  readonly tenant: UnitTenant;
  readonly rootDir: string;
  readonly encryptionConfigured: boolean;
  dir(path?: string): string;
  db(name?: string): DatabaseSync;
  vault(name?: string): TenantVault;
  encryptedValues(namespace: string): TenantValueCipher;
}

export interface TenantValueCipher {
  encrypt(key: string, value: string): string;
  decrypt(key: string, encryptedValue: string): string;
}

export interface TenantVault {
  set(key: string, value: string): void;
  get(key: string): string | null;
  delete(key: string): number;
  listKeys(): string[];
  close(): void;
}

export class ChassisStorage {
  readonly dataDir: string;
  readonly busyTimeoutMs: number;
  private readonly vaultMasterKey: Buffer | null;

  constructor(options: ChassisStorageOptions = {}) {
    this.dataDir = resolve(
      options.dataDir ?? process.env.DATA_DIR ?? DEFAULT_DATA_DIR,
    );
    this.busyTimeoutMs = normalizeBusyTimeout(
      options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
    );
    const configuredVaultKey =
      options.vaultEncryptionKey ?? process.env[VAULT_MASTER_KEY_ENV];
    this.vaultMasterKey =
      configuredVaultKey === undefined
        ? null
        : normalizeVaultMasterKey(configuredVaultKey);
  }

  forTenant(tenant: UnitTenant): TenantStorage {
    const tenantId = normalizeTenantId(tenant.id);
    const rootDir = resolve(this.dataDir, tenantId);
    ensureContained(this.dataDir, rootDir);
    mkdirSync(rootDir, { recursive: true });
    return new TenantStorageHandle(
      { id: tenantId },
      rootDir,
      this.busyTimeoutMs,
      this.vaultMasterKey,
    );
  }
}

class SqliteTenantVault implements TenantVault {
  private readonly db: DatabaseSync;
  private readonly encryptionKey: Buffer;
  private readonly vaultName: string;

  constructor(
    db: DatabaseSync,
    private readonly tenantId: string,
    encryptionKey: Buffer,
    vaultName = "vault.sqlite",
  ) {
    this.db = db;
    this.encryptionKey = encryptionKey;
    this.vaultName = vaultName;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vault_entries (
        tenant_id TEXT NOT NULL,
        key TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, key)
      );
      CREATE TABLE IF NOT EXISTS vault_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.migrateLegacyPlaintext();
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_vault_entries_tenant ON vault_entries (tenant_id, key)",
    );
  }

  set(key: string, value: string): void {
    const safeKey = normalizeVaultKey(key);
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO vault_entries (tenant_id, key, encrypted_value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, key) DO UPDATE SET
           encrypted_value = excluded.encrypted_value,
           updated_at = excluded.updated_at`,
      )
      .run(
        this.tenantId,
        safeKey,
        encryptVaultValue(
          value,
          this.encryptionKey,
          vaultAad(this.tenantId, this.vaultName, safeKey),
        ),
        now,
        now,
      );
  }

  get(key: string): string | null {
    const row = this.db
      .prepare(
        "SELECT encrypted_value FROM vault_entries WHERE tenant_id = ? AND key = ?",
      )
      .get(this.tenantId, normalizeVaultKey(key)) as
      | { encrypted_value: string }
      | undefined;
    if (!row) return null;
    return decryptVaultValue(
      row.encrypted_value,
      this.encryptionKey,
      vaultAad(this.tenantId, this.vaultName, normalizeVaultKey(key)),
    );
  }

  delete(key: string): number {
    const result = this.db
      .prepare("DELETE FROM vault_entries WHERE tenant_id = ? AND key = ?")
      .run(this.tenantId, normalizeVaultKey(key));
    return Number(result.changes);
  }

  listKeys(): string[] {
    const rows = this.db
      .prepare("SELECT key FROM vault_entries WHERE tenant_id = ? ORDER BY key")
      .all(this.tenantId) as Array<{ key: string }>;
    return rows.map((row) => row.key);
  }

  close(): void {
    this.db.close();
  }

  private migrateLegacyPlaintext(): void {
    const metadataKey = `encryption_state:${this.tenantId}`;
    const verifierKey = `key_verifier:${this.tenantId}`;
    let needsScrub = false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.db
        .prepare("SELECT value FROM vault_metadata WHERE key = ?")
        .get(metadataKey) as { value: string } | undefined;
      if (state?.value === "v1") {
        assertVaultV1Schema(this.db);
        verifyVaultKey(
          this.db,
          verifierKey,
          this.tenantId,
          this.vaultName,
          this.encryptionKey,
        );
        this.db.exec("COMMIT");
        return;
      }
      if (state && state.value !== "encrypted_pending_scrub") {
        throw new Error(
          `unsupported tenant vault encryption state ${state.value}`,
        );
      }
      if (state?.value !== "encrypted_pending_scrub") {
        const columns = tableColumns(this.db, "vault_entries");
        if (!columns.has("value")) {
          if (columns.has("encrypted_value")) {
            const count = this.db
              .prepare("SELECT count(*) AS count FROM vault_entries")
              .get() as { count: number };
            if (count.count > 0) {
              throw new Error(
                "tenant vault has encrypted-schema rows without migration state",
              );
            }
          } else {
            throw new Error("tenant vault schema is unsupported");
          }
        }
        const rows = this.db
          .prepare(
            columns.has("value")
              ? "SELECT tenant_id, key, value, created_at, updated_at FROM vault_entries"
              : "SELECT tenant_id, key, encrypted_value AS value, created_at, updated_at FROM vault_entries",
          )
          .all() as Array<{
          tenant_id: string;
          key: string;
          value: string;
          created_at: number;
          updated_at: number;
        }>;
        if (rows.some((row) => row.tenant_id !== this.tenantId)) {
          throw new Error(
            "legacy tenant vault migration requires one tenant per database",
          );
        }
        this.db.exec(`
          DROP TABLE IF EXISTS vault_entries_encrypted_migration;
          CREATE TABLE vault_entries_encrypted_migration (
            tenant_id TEXT NOT NULL,
            key TEXT NOT NULL,
            encrypted_value TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (tenant_id, key)
          );
        `);
        const insert = this.db.prepare(
          `INSERT INTO vault_entries_encrypted_migration
           (tenant_id, key, encrypted_value, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const row of rows) {
          const safeKey = normalizeVaultKey(row.key);
          insert.run(
            this.tenantId,
            safeKey,
            encryptVaultValue(
              row.value,
              this.encryptionKey,
              vaultAad(this.tenantId, this.vaultName, safeKey),
            ),
            row.created_at,
            row.updated_at,
          );
        }
        this.db.exec(`
          DROP TABLE vault_entries;
          ALTER TABLE vault_entries_encrypted_migration RENAME TO vault_entries;
          CREATE INDEX idx_vault_entries_tenant ON vault_entries (tenant_id, key);
        `);
        this.db
          .prepare(
            `INSERT INTO vault_metadata (key, value) VALUES (?, 'encrypted_pending_scrub')
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          )
          .run(metadataKey);
        this.db
          .prepare(
            `INSERT INTO vault_metadata (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          )
          .run(
            verifierKey,
            encryptVaultValue(
              VAULT_KEY_VERIFIER_VALUE,
              this.encryptionKey,
              vaultAad(this.tenantId, this.vaultName, VAULT_KEY_VERIFIER_KEY),
            ),
          );
      } else {
        assertVaultV1Schema(this.db);
        verifyVaultKey(
          this.db,
          verifierKey,
          this.tenantId,
          this.vaultName,
          this.encryptionKey,
        );
        const rows = this.db
          .prepare(
            "SELECT key, encrypted_value FROM vault_entries WHERE tenant_id = ?",
          )
          .all(this.tenantId) as Array<{
          key: string;
          encrypted_value: string;
        }>;
        for (const row of rows) {
          decryptVaultValue(
            row.encrypted_value,
            this.encryptionKey,
            vaultAad(this.tenantId, this.vaultName, normalizeVaultKey(row.key)),
          );
        }
      }
      needsScrub = true;
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    // The v1 marker is written only after plaintext pages are removed. If this
    // process is interrupted, pending_scrub makes the next open repeat cleanup
    // without re-encrypting ciphertext as if it were legacy plaintext.
    if (!needsScrub) return;
    securelyRewriteSqlite(this.db);
    this.db
      .prepare(
        `INSERT INTO vault_metadata (key, value) VALUES (?, 'v1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(metadataKey);
    assertWalCheckpoint(this.db);
  }
}

class TenantStorageHandle implements TenantStorage {
  constructor(
    readonly tenant: UnitTenant,
    readonly rootDir: string,
    private readonly busyTimeoutMs: number,
    private readonly vaultMasterKey: Buffer | null,
  ) {}

  get encryptionConfigured(): boolean {
    return this.vaultMasterKey !== null;
  }

  dir(path = "."): string {
    const target = safeTenantPath(this.rootDir, path);
    mkdirSync(target, { recursive: true });
    return target;
  }

  db(name = "unit.sqlite"): DatabaseSync {
    const target = safeTenantPath(this.rootDir, name);
    mkdirSync(dirname(target), { recursive: true });
    return openSqlite(target, this.busyTimeoutMs);
  }

  vault(name = "vault.sqlite"): TenantVault {
    if (!this.vaultMasterKey) {
      throw new Error(
        `tenant vault encryption requires storage.vaultEncryptionKey or ${VAULT_MASTER_KEY_ENV}`,
      );
    }
    safeTenantPath(this.rootDir, name);
    const vaultIdentity = normalizedTenantPath(name);
    const db = this.db(name);
    try {
      return new SqliteTenantVault(
        db,
        this.tenant.id,
        deriveTenantVaultKey(
          this.vaultMasterKey,
          this.tenant.id,
          vaultIdentity,
        ),
        vaultIdentity,
      );
    } catch (error) {
      db.close();
      throw error;
    }
  }

  encryptedValues(namespace: string): TenantValueCipher {
    if (!this.vaultMasterKey) {
      throw new Error(
        `tenant value encryption requires storage.vaultEncryptionKey or ${VAULT_MASTER_KEY_ENV}`,
      );
    }
    safeTenantPath(this.rootDir, namespace);
    const identity = normalizedTenantPath(namespace);
    return new TenantValueCipherHandle(
      this.tenant.id,
      identity,
      deriveTenantVaultKey(this.vaultMasterKey, this.tenant.id, identity),
    );
  }
}

class TenantValueCipherHandle implements TenantValueCipher {
  constructor(
    private readonly tenantId: string,
    private readonly namespace: string,
    private readonly encryptionKey: Buffer,
  ) {}

  encrypt(key: string, value: string): string {
    const safeKey = normalizeVaultKey(key);
    return encryptVaultValue(
      value,
      this.encryptionKey,
      vaultAad(this.tenantId, this.namespace, safeKey),
    );
  }

  decrypt(key: string, encryptedValue: string): string {
    const safeKey = normalizeVaultKey(key);
    return decryptVaultValue(
      encryptedValue,
      this.encryptionKey,
      vaultAad(this.tenantId, this.namespace, safeKey),
    );
  }
}

export function openSqlite(path: string, busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const timeout = normalizeBusyTimeout(busyTimeoutMs);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = ${timeout};
  `);
  return db;
}

function normalizeTenantId(id: string): string {
  const trimmed = id.trim();
  if (!TENANT_ID_RE.test(trimmed)) {
    throw new Error("tenant id must be 1-128 chars of A-Z, a-z, 0-9, _, ., or - and cannot start with punctuation");
  }
  return trimmed;
}

function normalizeBusyTimeout(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("busyTimeoutMs must be a non-negative finite number");
  return Math.trunc(value);
}

function normalizeVaultKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed || trimmed.length > 256) throw new Error("vault key must be 1-256 non-whitespace characters");
  return trimmed;
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return new Set(rows.map((row) => row.name));
}

function assertVaultV1Schema(db: DatabaseSync): void {
  const columns = tableColumns(db, "vault_entries");
  if (!columns.has("encrypted_value") || columns.has("value")) {
    throw new Error("tenant vault encryption state does not match its schema");
  }
}

const VAULT_KEY_VERIFIER_KEY = "__chassis_key_verifier__";
const VAULT_KEY_VERIFIER_VALUE = "mcp-chassis-vault-key-verifier:v1";

function verifyVaultKey(
  db: DatabaseSync,
  metadataKey: string,
  tenantId: string,
  vaultName: string,
  encryptionKey: Buffer,
): void {
  const row = db
    .prepare("SELECT value FROM vault_metadata WHERE key = ?")
    .get(metadataKey) as { value: string } | undefined;
  if (!row) throw new Error("tenant vault key verifier is missing");
  const value = decryptVaultValue(
    row.value,
    encryptionKey,
    vaultAad(tenantId, vaultName, VAULT_KEY_VERIFIER_KEY),
  );
  if (value !== VAULT_KEY_VERIFIER_VALUE) {
    throw new Error("tenant vault key verifier is invalid");
  }
}

function normalizeVaultMasterKey(value: string | Uint8Array): Buffer {
  if (value instanceof Uint8Array) {
    if (value.byteLength !== VAULT_KEY_BYTES) {
      throw new Error("vault encryption key must contain exactly 32 bytes");
    }
    return Buffer.from(value);
  }
  const trimmed = value.trim();
  let key: Buffer;
  if (/^[A-Fa-f0-9]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "hex");
  } else if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed)) {
    key = Buffer.from(trimmed, "base64");
  } else if (/^[A-Za-z0-9_-]{43}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "base64url");
  } else {
    throw new Error(
      "vault encryption key must be 64-char hex or a 32-byte base64/base64url value",
    );
  }
  if (key.byteLength !== VAULT_KEY_BYTES) {
    throw new Error("vault encryption key must contain exactly 32 bytes");
  }
  return key;
}

function deriveTenantVaultKey(
  masterKey: Buffer,
  tenantId: string,
  vaultIdentity: string,
): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      masterKey,
      VAULT_KDF_SALT,
      Buffer.from(`${tenantId}\0${vaultIdentity}`, "utf8"),
      VAULT_KEY_BYTES,
    ),
  );
}

function vaultAad(tenantId: string, vaultName: string, key: string): Buffer {
  return Buffer.from(`${tenantId}\0${vaultName}\0${key}`, "utf8");
}

function encryptVaultValue(value: string, key: Buffer, aad: Buffer): string {
  const iv = randomBytes(VAULT_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return `${VAULT_ENVELOPE_PREFIX}${iv.toString("base64url")}.${cipher
    .getAuthTag()
    .toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decryptVaultValue(value: string, key: Buffer, aad: Buffer): string {
  if (!value.startsWith(VAULT_ENVELOPE_PREFIX)) {
    throw new Error("tenant vault contains an unencrypted value");
  }
  const fields = value.slice(VAULT_ENVELOPE_PREFIX.length).split(".");
  if (fields.length !== 3) throw new Error("tenant vault entry is malformed");
  const [encodedIv, encodedTag, encodedCiphertext] = fields;
  if (!encodedIv || !encodedTag || encodedCiphertext === undefined) {
    throw new Error("tenant vault entry is malformed");
  }
  const iv = Buffer.from(encodedIv, "base64url");
  const authTag = Buffer.from(encodedTag, "base64url");
  const ciphertext = Buffer.from(encodedCiphertext, "base64url");
  if (
    iv.byteLength !== VAULT_IV_BYTES ||
    authTag.byteLength !== VAULT_AUTH_TAG_BYTES
  ) {
    throw new Error("tenant vault entry is malformed");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("tenant vault entry could not be decrypted");
  }
}

export function securelyRewriteSqlite(db: DatabaseSync): void {
  assertWalCheckpoint(db);
  db.exec("VACUUM");
  assertWalCheckpoint(db);
}

function assertWalCheckpoint(db: DatabaseSync): void {
  const deadline = Date.now() + DEFAULT_BUSY_TIMEOUT_MS;
  do {
    const result = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as
      | { busy: number }
      | undefined;
    if (!result?.busy) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  } while (Date.now() < deadline);
  throw new Error("tenant vault migration could not securely truncate the WAL");
}

function safeTenantPath(rootDir: string, requested: string): string {
  if (isAbsolute(requested)) throw new Error("tenant storage paths must be relative");
  const parts = requested.split(/[\\/]+/).filter((part) => part.length > 0 && part !== ".");
  if (parts.some((part) => part === ".." || !PATH_SEGMENT_RE.test(part))) {
    throw new Error("tenant storage path contains an unsafe segment");
  }
  const target = resolve(rootDir, ...parts);
  ensureContained(rootDir, target);
  return target;
}

function normalizedTenantPath(requested: string): string {
  return requested
    .split(/[\\/]+/)
    .filter((part) => part.length > 0 && part !== ".")
    .join("/");
}

function ensureContained(rootDir: string, target: string): void {
  const rel = relative(rootDir, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("tenant storage path escaped data root");
  }
}
