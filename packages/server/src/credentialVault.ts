import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openSqlite, type TenantStorage, type TenantVault } from "@zenod/mcp-chassis";

const HANDLE_PREFIX = "zenod-secret:v1:";
const HANDLE_RE = /^zenod-secret:v1:[a-f0-9]{48}$/;
const LOCAL_KEY_FILE = ".zenod-vault-key";
const CHASSIS_RECORD_PREFIX = "zenod.credential.";
const CHASSIS_RECORD_OWNER = "zenod";
const CHASSIS_MIGRATION_MARKER = "zenod.credential-migration.v1";

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
  legacyMasterKey?: string;
}

interface LegacyCredentialRow {
  handle: string;
  tenantId: string;
  key: string;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
  createdAt: number;
  updatedAt: number;
}

interface DecryptedLegacyCredential extends Omit<LegacyCredentialRow, "ciphertext" | "iv" | "authTag"> {
  value: string;
}

interface CredentialReference {
  key: string;
  handle: string;
}

interface LegacyCredentialSnapshot {
  databasePath: string;
  keyPath: string;
  credentials: DecryptedLegacyCredential[];
  references: CredentialReference[];
  unresolvedReferences: CredentialReference[];
}

interface CredentialMigrationMarker {
  version: 1;
  state: "pending_scrub" | "complete";
  credentials: CredentialReference[];
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
    this.vault = openMigratedChassisVault(storage, options);
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
      return parseChassisEnvelope(stored, this.tenantId, safeKey);
    } catch {
      return null;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("credential vault is closed");
  }
}

function openMigratedChassisVault(
  storage: TenantStorage,
  options: ChassisCredentialVaultOptions,
): TenantVault {
  const vaultName = options.vaultName ?? "vault.sqlite";
  const snapshot = readLegacyCredentialSnapshot(
    storage.rootDir,
    options.legacyMasterKey,
  );
  const references = snapshot?.references ?? readCredentialReferences(storage.rootDir);
  let vault = storage.vault(vaultName);
  let vaultOpen = true;

  try {
    if (snapshot) {
      importLegacyCredentials(vault, storage.tenant.id, snapshot.credentials);
      if (snapshot.unresolvedReferences.length > 0) {
        // A dangling legacy settings handle is not recoverable from the legacy
        // database. Keep both sources untouched, expose any independently
        // recoverable credentials through chassis custody, and let the missing
        // secret fail closed at materialization time. Retrying construction is
        // safe because importing the matching rows is idempotent.
        return vault;
      }
      verifyCredentialReferences(vault, storage.tenant.id, references);
      const markerCredentials = snapshot.credentials.map(({ key, handle }) => ({ key, handle }));
      verifyMigrationMarkerCredentials(vault, storage.tenant.id, markerCredentials);
      vault.set(
        CHASSIS_MIGRATION_MARKER,
        JSON.stringify({ version: 1, state: "pending_scrub", credentials: markerCredentials }),
      );
      vault.close();
      vaultOpen = false;

      cleanupLegacyCredentialDatabase(snapshot.databasePath);
      vault = storage.vault(vaultName);
      vaultOpen = true;
      verifyImportedCredentials(vault, storage.tenant.id, snapshot.credentials);
      verifyCredentialReferences(vault, storage.tenant.id, references);
      verifyMigrationMarkerCredentials(vault, storage.tenant.id, markerCredentials);
      vault.set(
        CHASSIS_MIGRATION_MARKER,
        JSON.stringify({ version: 1, state: "complete", credentials: markerCredentials }),
      );
      securelyRemoveLegacyKey(snapshot.keyPath);
      return vault;
    }

    const marker = readCredentialMigrationMarker(vault);
    if (marker?.state === "pending_scrub") {
      verifyMigrationMarkerCredentials(vault, storage.tenant.id, marker.credentials);
      vault.close();
      vaultOpen = false;
      cleanupLegacyCredentialDatabase(join(storage.rootDir, "vault.sqlite"));
      vault = storage.vault(vaultName);
      vaultOpen = true;
      verifyMigrationMarkerCredentials(vault, storage.tenant.id, marker.credentials);
      vault.set(
        CHASSIS_MIGRATION_MARKER,
        JSON.stringify({ ...marker, state: "complete" }),
      );
    }
    if (marker) {
      securelyRemoveLegacyKey(join(storage.rootDir, LOCAL_KEY_FILE));
    }
    return vault;
  } catch (error) {
    if (vaultOpen) {
      try {
        vault.close();
      } catch {
        // Preserve the migration failure that made construction abort.
      }
    }
    throw error;
  }
}

function readCredentialMigrationMarker(vault: TenantVault): CredentialMigrationMarker | null {
  const stored = vault.get(CHASSIS_MIGRATION_MARKER);
  if (!stored) return null;
  let parsed: { version?: unknown; state?: unknown; credentials?: unknown };
  try {
    parsed = JSON.parse(stored) as typeof parsed;
  } catch {
    throw new Error("legacy credential migration marker is malformed");
  }
  if (
    parsed.version !== 1 ||
    !new Set(["pending_scrub", "complete"]).has(String(parsed.state)) ||
    !Array.isArray(parsed.credentials)
  ) {
    throw new Error("legacy credential migration marker is malformed");
  }
  const credentials = parsed.credentials.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as { key?: unknown }).key !== "string" ||
      typeof (entry as { handle?: unknown }).handle !== "string" ||
      !isCredentialHandle((entry as { handle: string }).handle)
    ) {
      throw new Error("legacy credential migration marker is malformed");
    }
    return {
      key: assertCredentialKey((entry as { key: string }).key),
      handle: (entry as { handle: string }).handle,
    };
  });
  const identities = credentials.map((entry) => `${entry.key}\0${entry.handle}`);
  if (new Set(identities).size !== identities.length) {
    throw new Error("legacy credential migration marker is malformed");
  }
  return {
    version: 1,
    state: parsed.state as CredentialMigrationMarker["state"],
    credentials,
  };
}

function verifyMigrationMarkerCredentials(
  vault: TenantVault,
  tenantId: string,
  credentials: CredentialReference[],
): void {
  verifyCredentialReferences(vault, tenantId, credentials);
  const storedCredentialKeys = vault
    .listKeys()
    .filter((key) => key.startsWith(CHASSIS_RECORD_PREFIX))
    .sort();
  const expectedCredentialKeys = credentials
    .map((entry) => chassisRecordKey(entry.key))
    .sort();
  if (JSON.stringify(storedCredentialKeys) !== JSON.stringify(expectedCredentialKeys)) {
    throw new Error("legacy credential migration marker does not match the complete chassis credential set");
  }
}

function readLegacyCredentialSnapshot(
  rootDir: string,
  legacyMasterKey: string | undefined,
): LegacyCredentialSnapshot | null {
  const databasePath = join(rootDir, "vault.sqlite");
  if (!existsSync(databasePath)) return null;

  const db = new DatabaseSync(databasePath, { readOnly: true });
  let rawRows: Array<{
    handle: unknown;
    tenant_id: unknown;
    key_name: unknown;
    ciphertext: unknown;
    iv: unknown;
    auth_tag: unknown;
    created_at: unknown;
    updated_at: unknown;
  }>;
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'credential_entries'")
      .get();
    if (!table) return null;
    rawRows = db
      .prepare(
        `SELECT handle, tenant_id, key_name, ciphertext, iv, auth_tag, created_at, updated_at
           FROM credential_entries
          ORDER BY tenant_id, key_name`,
      )
      .all() as typeof rawRows;
  } finally {
    db.close();
  }
  const rows = rawRows.map(normalizeLegacyCredentialRow);
  const references = readCredentialReferences(rootDir);
  const unresolvedReferences = references.filter(
    (reference) => !rows.some((row) => row.key === reference.key && row.handle === reference.handle),
  );
  const keyPath = join(rootDir, LOCAL_KEY_FILE);
  if (rows.length === 0) {
    return { databasePath, keyPath, credentials: [], references, unresolvedReferences };
  }

  const tenantIds = [...new Set(rows.map((row) => row.tenantId))];
  if (tenantIds.length !== 1) {
    throw new Error("legacy credential migration requires exactly one tenant id");
  }
  const legacyTenantId = tenantIds[0];
  if (!legacyTenantId) throw new Error("legacy credential migration found no tenant id");
  const candidates: Buffer[] = [];
  if (legacyMasterKey) {
    candidates.push(deriveStandaloneMasterKey(legacyTenantId, legacyMasterKey));
  }
  if (existsSync(keyPath)) {
    const keyStat = lstatSync(keyPath);
    if (!keyStat.isFile() || keyStat.isSymbolicLink()) {
      throw new Error(`${LOCAL_KEY_FILE} must be a regular file`);
    }
    const localKey = readFileSync(keyPath);
    if (localKey.length !== 32) {
      throw new Error(`${LOCAL_KEY_FILE} must contain exactly 32 bytes`);
    }
    candidates.push(localKey);
  }
  const uniqueCandidates = [...new Map(candidates.map((key) => [key.toString("hex"), key])).values()];
  if (uniqueCandidates.length === 0) {
    throw new Error("legacy credential migration requires its local key or ZENOD_CREDENTIAL_MASTER_KEY");
  }

  const successful: DecryptedLegacyCredential[][] = [];
  for (const candidate of uniqueCandidates) {
    try {
      successful.push(
        rows.map((row) => ({
          handle: row.handle,
          tenantId: row.tenantId,
          key: row.key,
          value: decrypt(
            row.ciphertext,
            row.iv,
            row.authTag,
            candidate,
            aad(row.tenantId, row.key, row.handle),
          ),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
      );
    } catch {
      // A candidate must authenticate the complete legacy set.
    }
  }
  if (successful.length !== 1) {
    throw new Error("legacy credential migration could not identify exactly one valid encryption key");
  }
  const credentials = successful[0];
  if (!credentials) throw new Error("legacy credential migration found no decrypted credential set");
  if (credentials.some((entry) => !entry.value)) {
    throw new Error("legacy credential migration found an empty credential value");
  }
  return { databasePath, keyPath, credentials, references, unresolvedReferences };
}

function normalizeLegacyCredentialRow(row: {
  handle: unknown;
  tenant_id: unknown;
  key_name: unknown;
  ciphertext: unknown;
  iv: unknown;
  auth_tag: unknown;
  created_at: unknown;
  updated_at: unknown;
}): LegacyCredentialRow {
  if (typeof row.handle !== "string" || !isCredentialHandle(row.handle)) {
    throw new Error("legacy credential row has an invalid handle");
  }
  if (typeof row.tenant_id !== "string") {
    throw new Error("legacy credential row has an invalid tenant id");
  }
  assertTenantId(row.tenant_id);
  if (typeof row.key_name !== "string") {
    throw new Error("legacy credential row has an invalid key");
  }
  const key = assertCredentialKey(row.key_name);
  if (!(row.ciphertext instanceof Uint8Array) || row.ciphertext.length === 0) {
    throw new Error("legacy credential row has invalid ciphertext");
  }
  if (!(row.iv instanceof Uint8Array) || row.iv.length !== 12) {
    throw new Error("legacy credential row has an invalid IV");
  }
  if (!(row.auth_tag instanceof Uint8Array) || row.auth_tag.length !== 16) {
    throw new Error("legacy credential row has an invalid authentication tag");
  }
  if (typeof row.created_at !== "number" || !Number.isFinite(row.created_at)) {
    throw new Error("legacy credential row has an invalid created timestamp");
  }
  if (typeof row.updated_at !== "number" || !Number.isFinite(row.updated_at)) {
    throw new Error("legacy credential row has an invalid updated timestamp");
  }
  return {
    handle: row.handle,
    tenantId: row.tenant_id,
    key,
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.auth_tag,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readCredentialReferences(rootDir: string): CredentialReference[] {
  const path = join(rootDir, "zenod.sqlite");
  if (!existsSync(path)) return [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'")
      .get();
    if (!table) return [];
    const rows = db
      .prepare("SELECT key, value FROM settings WHERE value LIKE 'zenod-secret:v1:%' ORDER BY key")
      .all() as Array<{ key: unknown; value: unknown }>;
    return rows.map((row) => {
      if (typeof row.key !== "string" || typeof row.value !== "string" || !isCredentialHandle(row.value)) {
        throw new Error("settings contains a malformed credential handle");
      }
      return { key: assertCredentialKey(row.key), handle: row.value };
    });
  } finally {
    db.close();
  }
}

function importLegacyCredentials(
  vault: TenantVault,
  tenantId: string,
  credentials: DecryptedLegacyCredential[],
): void {
  for (const credential of credentials) {
    const recordKey = chassisRecordKey(credential.key);
    const envelope: ChassisCredentialEnvelope = {
      version: 1,
      owner: CHASSIS_RECORD_OWNER,
      tenantId,
      key: credential.key,
      handle: credential.handle,
      value: credential.value,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
    const existing = vault.get(recordKey);
    if (existing) {
      const parsed = parseChassisEnvelope(existing, tenantId, credential.key);
      if (JSON.stringify(parsed) !== JSON.stringify(envelope)) {
        throw new Error(`legacy credential migration conflicts with chassis record ${credential.key}`);
      }
      continue;
    }
    vault.set(recordKey, JSON.stringify(envelope));
  }
  verifyImportedCredentials(vault, tenantId, credentials);
}

function verifyImportedCredentials(
  vault: TenantVault,
  tenantId: string,
  credentials: DecryptedLegacyCredential[],
): void {
  for (const credential of credentials) {
    const stored = vault.get(chassisRecordKey(credential.key));
    if (!stored) throw new Error(`migrated credential ${credential.key} is missing`);
    const envelope = parseChassisEnvelope(stored, tenantId, credential.key);
    if (envelope.handle !== credential.handle || envelope.value !== credential.value) {
      throw new Error(`migrated credential ${credential.key} failed round-trip verification`);
    }
  }
}

function verifyCredentialReferences(
  vault: TenantVault,
  tenantId: string,
  references: CredentialReference[],
): void {
  for (const reference of references) {
    const stored = vault.get(chassisRecordKey(reference.key));
    if (!stored) throw new Error(`credential handle ${reference.handle} cannot be materialized`);
    const envelope = parseChassisEnvelope(stored, tenantId, reference.key);
    if (envelope.handle !== reference.handle) {
      throw new Error(`credential handle ${reference.handle} cannot be materialized`);
    }
  }
}

function parseChassisEnvelope(
  stored: string,
  tenantId: string,
  key: string,
): ChassisCredentialEnvelope {
  let parsed: Partial<ChassisCredentialEnvelope>;
  try {
    parsed = JSON.parse(stored) as Partial<ChassisCredentialEnvelope>;
  } catch {
    throw new Error(`chassis credential record ${key} is malformed`);
  }
  if (
    parsed.version !== 1 ||
    parsed.owner !== CHASSIS_RECORD_OWNER ||
    parsed.tenantId !== tenantId ||
    parsed.key !== key ||
    typeof parsed.handle !== "string" ||
    !isCredentialHandle(parsed.handle) ||
    typeof parsed.value !== "string" ||
    !parsed.value ||
    typeof parsed.createdAt !== "number" ||
    !Number.isFinite(parsed.createdAt) ||
    typeof parsed.updatedAt !== "number" ||
    !Number.isFinite(parsed.updatedAt)
  ) {
    throw new Error(`chassis credential record ${key} is malformed`);
  }
  return parsed as ChassisCredentialEnvelope;
}

function cleanupLegacyCredentialDatabase(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA secure_delete = ON; BEGIN IMMEDIATE");
    try {
      db.exec("DROP INDEX IF EXISTS idx_credential_entries_tenant_key; DROP TABLE IF EXISTS credential_entries; COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

function securelyRemoveLegacyKey(path: string): void {
  if (!existsSync(path)) return;
  const keyStat = lstatSync(path);
  if (!keyStat.isFile() || keyStat.isSymbolicLink() || keyStat.size !== 32) {
    throw new Error(`${LOCAL_KEY_FILE} must be a regular 32-byte file before cleanup`);
  }
  const descriptor = openSync(path, "r+");
  try {
    writeSync(descriptor, randomBytes(32), 0, 32, 0);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  unlinkSync(path);
  const directory = openSync(join(path, ".."), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
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
    return deriveStandaloneMasterKey(options.tenantId, masterKey);
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

function deriveStandaloneMasterKey(tenantId: string, masterKey: string): Buffer {
  return createHash("sha256")
    .update("zenod-credential-vault\0")
    .update(tenantId)
    .update("\0")
    .update(masterKey)
    .digest();
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
