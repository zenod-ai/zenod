import type { DatabaseSync } from "node:sqlite";
import {
  securelyRewriteSqlite,
  type TenantStorage,
  type TenantValueCipher,
} from "./storage.js";

export const TENANT_SETTING_KEYS = [
  "vault_repo",
  "vault_branch",
  "github_token",
  "provider",
  "anthropic_api_key",
  "openai_api_key",
  "openrouter_api_key",
  "model_ask",
  "model_classify",
  "model_vision",
  "model_max_steps",
  "google_service_account_json",
  "google_oauth_client_id",
  "google_oauth_client_secret",
  "google_drive_folder_id",
  "groq_api_key",
  "openai_long_transcription",
  "long_transcription_provider",
  "openrouter_transcription_model",
  "composio_api_key",
  "composio_user_id",
] as const;

export type TenantSettingKey = (typeof TENANT_SETTING_KEYS)[number];
export type TenantSettingsValues = Record<TenantSettingKey, string | null>;

export const TENANT_SECRET_SETTING_KEYS = [
  "github_token",
  "anthropic_api_key",
  "openai_api_key",
  "openrouter_api_key",
  "google_service_account_json",
  "google_oauth_client_secret",
  "groq_api_key",
  "composio_api_key",
] as const satisfies readonly TenantSettingKey[];

export type TenantSecretSettingKey =
  (typeof TENANT_SECRET_SETTING_KEYS)[number];

export interface TenantKeyMetadata {
  id: TenantSecretSettingKey;
  label: string;
  configured: true;
  maskedValue: string;
  updatedAt: string;
}

export interface TenantSettingsSnapshot {
  settings: TenantSettingsValues;
  configured: true;
}

const SETTINGS_DB_NAME = "chassis-settings.sqlite";
const SETTINGS_ENCRYPTION_STATE_KEY = "secret_encryption_state";
const SETTINGS_KEY_VERIFIER_KEY = "secret_key_verifier";
const SETTINGS_KEY_VERIFIER_CIPHER_KEY = "__chassis_settings_key_verifier__";
const SETTINGS_KEY_VERIFIER_VALUE = "mcp-chassis-settings-key-verifier:v1";
const SETTINGS_ENCRYPTION_PENDING = "encrypted_pending_scrub";
const SETTINGS_ENCRYPTION_V1 = "v1";
const SETTING_KEY_SET = new Set<string>(TENANT_SETTING_KEYS);
const SECRET_KEY_SET = new Set<string>(TENANT_SECRET_SETTING_KEYS);
const PROVIDERS = new Set(["anthropic", "openai", "openrouter", "groq"]);
const KEY_LABELS: Record<TenantSecretSettingKey, string> = {
  github_token: "GitHub token",
  anthropic_api_key: "Anthropic API key",
  openai_api_key: "OpenAI API key",
  openrouter_api_key: "OpenRouter API key",
  google_service_account_json: "Google service account",
  google_oauth_client_secret: "Google OAuth client secret",
  groq_api_key: "Groq API key",
  composio_api_key: "Composio API key",
};

interface SettingRow {
  setting_key: TenantSettingKey;
  value: string;
  created_at: number;
  updated_at: number;
}

interface NormalizedUpdate {
  key: TenantSettingKey;
  value: string | null;
  preserveMaskedSecret: boolean;
}

/** Durable settings persisted inside a tenant-bound storage directory. */
export class SqliteTenantSettingsStore {
  snapshot(storage: TenantStorage): TenantSettingsSnapshot {
    const db = openSettingsDb(storage);
    try {
      migrateLegacySecretRows(storage, db);
      return snapshotFromDb(storage, db);
    } finally {
      db.close();
    }
  }

  update(storage: TenantStorage, input: unknown): TenantSettingsSnapshot {
    const updates = normalizeUpdate(input);
    const db = openSettingsDb(storage);
    try {
      migrateLegacySecretRows(storage, db);
      const needsSecretCipher = updates.some(
        (update) =>
          SECRET_KEY_SET.has(update.key) &&
          !update.preserveMaskedSecret &&
          update.value !== null &&
          update.value !== "",
      );
      const cipher = needsSecretCipher
        ? storage.encryptedValues(SETTINGS_DB_NAME)
        : null;
      db.exec("BEGIN IMMEDIATE");
      try {
        const now = Date.now();
        for (const update of updates) {
          if (update.preserveMaskedSecret) continue;
          if (update.value === null || update.value === "") {
            db.prepare("DELETE FROM tenant_settings WHERE setting_key = ?").run(
              update.key,
            );
            continue;
          }
          const storedValue = SECRET_KEY_SET.has(update.key)
            ? requireCipher(cipher).encrypt(update.key, update.value)
            : update.value;
          db.prepare(
            `INSERT INTO tenant_settings
             (setting_key, stored_value, created_at, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(setting_key) DO UPDATE SET
               stored_value = excluded.stored_value,
               updated_at = excluded.updated_at`,
          ).run(update.key, storedValue, now, now);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return snapshotFromDb(storage, db);
    } finally {
      db.close();
    }
  }

  keyMetadata(storage: TenantStorage): TenantKeyMetadata[] {
    const db = openSettingsDb(storage);
    try {
      migrateLegacySecretRows(storage, db);
      const secretRows = readRows(db).filter(isSecretRow);
      const cipher = secretRows.length
        ? storage.encryptedValues(SETTINGS_DB_NAME)
        : null;
      return secretRows.map((row) => {
        const key = row.setting_key as TenantSecretSettingKey;
        const value = requireCipher(cipher).decrypt(key, row.value);
        return {
          id: key,
          label: KEY_LABELS[key],
          configured: true,
          maskedValue: maskSecret(value),
          updatedAt: new Date(row.updated_at).toISOString(),
        };
      });
    } finally {
      db.close();
    }
  }
}

export function defaultTenantSettingsValues(): TenantSettingsValues {
  return {
    vault_repo: null,
    vault_branch: null,
    github_token: null,
    provider: "anthropic",
    anthropic_api_key: null,
    openai_api_key: null,
    openrouter_api_key: null,
    model_ask: null,
    model_classify: null,
    model_vision: null,
    model_max_steps: null,
    google_service_account_json: null,
    google_oauth_client_id: null,
    google_oauth_client_secret: null,
    google_drive_folder_id: null,
    groq_api_key: null,
    openai_long_transcription: null,
    long_transcription_provider: null,
    openrouter_transcription_model: null,
    composio_api_key: null,
    composio_user_id: null,
  };
}

function openSettingsDb(storage: TenantStorage): DatabaseSync {
  const db = storage.db(SETTINGS_DB_NAME);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_settings (
      setting_key TEXT PRIMARY KEY,
      stored_value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

function snapshotFromDb(
  storage: TenantStorage,
  db: DatabaseSync,
): TenantSettingsSnapshot {
  const values = defaultTenantSettingsValues();
  const rows = readRows(db);
  const hasSecrets = rows.some(isSecretRow);
  const cipher = hasSecrets ? storage.encryptedValues(SETTINGS_DB_NAME) : null;
  for (const row of rows) {
    values[row.setting_key] = isSecretRow(row)
      ? requireCipher(cipher).decrypt(row.setting_key, row.value)
      : row.value;
  }
  return { settings: maskSettings(values), configured: true };
}

function migrateLegacySecretRows(
  storage: TenantStorage,
  db: DatabaseSync,
): void {
  let needsScrub = false;
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = db
      .prepare("SELECT value FROM settings_metadata WHERE key = ?")
      .get(SETTINGS_ENCRYPTION_STATE_KEY) as { value: string } | undefined;
    if (
      state &&
      state.value !== SETTINGS_ENCRYPTION_PENDING &&
      state.value !== SETTINGS_ENCRYPTION_V1
    ) {
      throw new Error(
        `unsupported tenant settings encryption state ${state.value}`,
      );
    }
    const columns = tableColumns(db, "tenant_settings");
    if (state?.value === SETTINGS_ENCRYPTION_V1) {
      assertSettingsV1Schema(columns);
      ensureSettingsKeyVerifier(storage, db);
      validateSecretRows(storage, readRows(db));
      db.exec("COMMIT");
      return;
    }

    if (state?.value === SETTINGS_ENCRYPTION_PENDING) {
      assertSettingsV1Schema(columns);
      ensureSettingsKeyVerifier(storage, db);
      validateSecretRows(storage, readRows(db));
    } else if (columns.has("value")) {
      const legacyRows = readLegacyRows(db);
      const hasSecrets = legacyRows.some(isSecretRow);
      const cipher = hasSecrets
        ? storage.encryptedValues(SETTINGS_DB_NAME)
        : null;
      db.exec(`
        DROP TABLE IF EXISTS tenant_settings_encrypted_migration;
        CREATE TABLE tenant_settings_encrypted_migration (
          setting_key TEXT PRIMARY KEY,
          stored_value TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      const insert = db.prepare(
        `INSERT INTO tenant_settings_encrypted_migration
         (setting_key, stored_value, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      );
      for (const row of legacyRows) {
        const storedValue = isSecretRow(row)
          ? requireCipher(cipher).encrypt(row.setting_key, row.value)
          : row.value;
        insert.run(
          row.setting_key,
          storedValue,
          row.created_at,
          row.updated_at,
        );
      }
      db.exec(`
        DROP TABLE tenant_settings;
        ALTER TABLE tenant_settings_encrypted_migration RENAME TO tenant_settings;
      `);
    } else {
      assertSettingsV1Schema(columns);
      const rows = readRows(db);
      const secretRows = rows.filter(isSecretRow);
      if (secretRows.length) {
        const cipher = storage.encryptedValues(SETTINGS_DB_NAME);
        const update = db.prepare(
          "UPDATE tenant_settings SET stored_value = ? WHERE setting_key = ?",
        );
        for (const row of secretRows) {
          update.run(
            cipher.encrypt(row.setting_key, row.value),
            row.setting_key,
          );
        }
      }
    }
    ensureSettingsKeyVerifier(storage, db);
    db.prepare(
      `INSERT INTO settings_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(SETTINGS_ENCRYPTION_STATE_KEY, SETTINGS_ENCRYPTION_PENDING);
    needsScrub = true;
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  if (!needsScrub) return;
  securelyRewriteSqlite(db);
  db.prepare(
    `INSERT INTO settings_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(SETTINGS_ENCRYPTION_STATE_KEY, SETTINGS_ENCRYPTION_V1);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
}

function validateSecretRows(storage: TenantStorage, rows: SettingRow[]): void {
  const secretRows = rows.filter(isSecretRow);
  if (!secretRows.length) return;
  const cipher = storage.encryptedValues(SETTINGS_DB_NAME);
  for (const row of secretRows) cipher.decrypt(row.setting_key, row.value);
}

function ensureSettingsKeyVerifier(
  storage: TenantStorage,
  db: DatabaseSync,
): void {
  const row = db
    .prepare("SELECT value FROM settings_metadata WHERE key = ?")
    .get(SETTINGS_KEY_VERIFIER_KEY) as { value: string } | undefined;
  if (row) {
    const value = storage
      .encryptedValues(SETTINGS_DB_NAME)
      .decrypt(SETTINGS_KEY_VERIFIER_CIPHER_KEY, row.value);
    if (value !== SETTINGS_KEY_VERIFIER_VALUE) {
      throw new Error("tenant settings key verifier is invalid");
    }
    return;
  }
  if (!storage.encryptionConfigured) return;
  const encryptedVerifier = storage
    .encryptedValues(SETTINGS_DB_NAME)
    .encrypt(SETTINGS_KEY_VERIFIER_CIPHER_KEY, SETTINGS_KEY_VERIFIER_VALUE);
  db.prepare(
    `INSERT INTO settings_metadata (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(SETTINGS_KEY_VERIFIER_KEY, encryptedVerifier);
}

function readRows(db: DatabaseSync): SettingRow[] {
  return filterKnownRows(
    db
      .prepare(
        `SELECT setting_key, stored_value AS value, created_at, updated_at
         FROM tenant_settings
         ORDER BY setting_key`,
      )
      .all() as unknown as SettingRow[],
  );
}

function readLegacyRows(db: DatabaseSync): SettingRow[] {
  return filterKnownRows(
    db
      .prepare(
        `SELECT setting_key, value, created_at, updated_at
         FROM tenant_settings
         ORDER BY setting_key`,
      )
      .all() as unknown as SettingRow[],
  );
}

function filterKnownRows(rows: SettingRow[]): SettingRow[] {
  return rows.filter((row) => SETTING_KEY_SET.has(row.setting_key));
}

function isSecretRow(
  row: SettingRow,
): row is SettingRow & { setting_key: TenantSecretSettingKey } {
  return SECRET_KEY_SET.has(row.setting_key);
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return new Set(rows.map((row) => row.name));
}

function assertSettingsV1Schema(columns: Set<string>): void {
  if (!columns.has("stored_value") || columns.has("value")) {
    throw new Error(
      "tenant settings encryption state does not match its schema",
    );
  }
}

function requireCipher(cipher: TenantValueCipher | null): TenantValueCipher {
  if (!cipher) throw new Error("tenant settings encryption key is unavailable");
  return cipher;
}

function normalizeUpdate(input: unknown): NormalizedUpdate[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("settings body must be a JSON object");
  }
  const body = input as Record<string, unknown>;
  const updates: NormalizedUpdate[] = [];
  for (const key of TENANT_SETTING_KEYS) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value !== null && typeof value !== "string") {
      throw new TypeError(`${key} must be a string or null`);
    }
    if (key === "provider" && value !== null && value !== "") {
      if (!PROVIDERS.has(value)) {
        throw new TypeError(
          "provider must be anthropic, openai, openrouter, or groq",
        );
      }
    }
    updates.push({
      key,
      value,
      preserveMaskedSecret:
        SECRET_KEY_SET.has(key) && value !== null && value.includes("\u2022"),
    });
  }
  return updates;
}

function maskSettings(values: TenantSettingsValues): TenantSettingsValues {
  const masked = { ...values };
  for (const key of TENANT_SECRET_SETTING_KEYS) {
    const value = masked[key];
    if (value !== null) masked[key] = maskSecret(value);
  }
  return masked;
}

function maskSecret(value: string): string {
  const bullets = "\u2022\u2022\u2022\u2022";
  return value.length <= 4 ? bullets : `${bullets}${value.slice(-4)}`;
}
