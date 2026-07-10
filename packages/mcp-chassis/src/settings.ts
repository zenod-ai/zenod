import type { DatabaseSync } from "node:sqlite";
import type { TenantStorage } from "./storage.js";

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
      const values = defaultTenantSettingsValues();
      for (const row of readRows(db)) values[row.setting_key] = row.value;
      return { settings: maskSettings(values), configured: true };
    } finally {
      db.close();
    }
  }

  update(storage: TenantStorage, input: unknown): TenantSettingsSnapshot {
    const updates = normalizeUpdate(input);
    const db = openSettingsDb(storage);
    try {
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
          db.prepare(
            `INSERT INTO tenant_settings (setting_key, value, created_at, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(setting_key) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at`,
          ).run(update.key, update.value, now, now);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      const values = defaultTenantSettingsValues();
      for (const row of readRows(db)) values[row.setting_key] = row.value;
      return { settings: maskSettings(values), configured: true };
    } finally {
      db.close();
    }
  }

  keyMetadata(storage: TenantStorage): TenantKeyMetadata[] {
    const db = openSettingsDb(storage);
    try {
      return readRows(db)
        .filter(
          (row): row is SettingRow & { setting_key: TenantSecretSettingKey } =>
            SECRET_KEY_SET.has(row.setting_key),
        )
        .map((row) => ({
          id: row.setting_key,
          label: KEY_LABELS[row.setting_key],
          configured: true,
          maskedValue: maskSecret(row.value),
          updatedAt: new Date(row.updated_at).toISOString(),
        }));
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
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

function readRows(db: DatabaseSync): SettingRow[] {
  return (
    db
      .prepare(
        `SELECT setting_key, value, updated_at
         FROM tenant_settings
         ORDER BY setting_key`,
      )
      .all() as unknown as SettingRow[]
  ).filter((row) => SETTING_KEY_SET.has(row.setting_key));
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
