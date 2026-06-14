import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SqliteStateStore } from "zenod";
import {
  normalizeAllowedSenders,
  parseStoredAllowedSenders,
  type WhatsAppSettings,
} from "./whatsappConfig.js";

/** Runtime settings persisted in SQLite; env vars seed them on first boot. */
export const SETTING_KEYS = [
  "vault_repo",
  "vault_branch",
  "github_token",
  "provider",
  "anthropic_api_key",
  "openai_api_key",
  "openrouter_api_key",
  "model_ask",
  "model_classify",
  "google_service_account_json",
  "google_drive_folder_id",
  "groq_api_key",
  "openai_long_transcription",
  "whisper_model",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export type Provider = "anthropic" | "openai" | "openrouter" | "groq";

/** The settings key holding each provider's API key. */
export const PROVIDER_KEY: Record<Provider, SettingKey> = {
  anthropic: "anthropic_api_key",
  openai: "openai_api_key",
  openrouter: "openrouter_api_key",
  groq: "groq_api_key",
};

const SECRET_KEYS: ReadonlySet<string> = new Set([
  "github_token",
  "anthropic_api_key",
  "openai_api_key",
  "openrouter_api_key",
  "google_service_account_json",
  "groq_api_key",
]);

const ENV_SEEDS: Record<SettingKey, string> = {
  vault_repo: "VAULT_REPO",
  vault_branch: "VAULT_BRANCH",
  github_token: "GITHUB_TOKEN",
  provider: "ZENOD_PROVIDER",
  anthropic_api_key: "ANTHROPIC_API_KEY",
  openai_api_key: "OPENAI_API_KEY",
  openrouter_api_key: "OPENROUTER_API_KEY",
  model_ask: "ZENOD_MODEL_ASK",
  model_classify: "ZENOD_MODEL_CLASSIFY",
  google_service_account_json: "GOOGLE_SERVICE_ACCOUNT_JSON",
  google_drive_folder_id: "GOOGLE_DRIVE_FOLDER_ID",
  groq_api_key: "GROQ_API_KEY",
  openai_long_transcription: "ZENOD_OPENAI_LONG_TRANSCRIPTION",
  whisper_model: "ZENOD_WHISPER_MODEL",
};

export class Settings {
  constructor(private readonly store: SqliteStateStore) {}

  /** Seed settings from env vars that aren't already set (first boot). */
  seedFromEnv(env: NodeJS.ProcessEnv = process.env): void {
    for (const key of SETTING_KEYS) {
      const envValue = env[ENV_SEEDS[key]];
      if (envValue && this.get(key) === null) this.store.setSetting(key, envValue);
    }
    if (this.get("provider") === null) this.store.setSetting("provider", "anthropic");
    if (this.store.getSetting("api_token") === null) this.regenerateApiToken();
    if (this.store.getSetting("session_secret") === null) {
      this.store.setSetting("session_secret", randomBytes(32).toString("hex"));
    }
  }

  get(key: SettingKey): string | null {
    return this.store.getSetting(key);
  }

  set(key: SettingKey, value: string): void {
    if (value === "") this.store.deleteSetting(key);
    else this.store.setSetting(key, value);
  }

  /** Internal keys (e.g. GitHub App credentials) — not part of the UI-editable set. */
  getRaw(key: string): string | null {
    return this.store.getSetting(key);
  }

  setRaw(key: string, value: string): void {
    if (value === "") this.store.deleteSetting(key);
    else this.store.setSetting(key, value);
  }

  /** All settings with secrets masked — safe for the UI. */
  masked(): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const key of SETTING_KEYS) {
      const value = this.get(key);
      out[key] = value === null ? null : SECRET_KEYS.has(key) ? mask(value) : value;
    }
    return out;
  }

  isSecret(key: string): boolean {
    return SECRET_KEYS.has(key);
  }

  /** A connected GitHub App can stand in for a PAT. */
  hasGithubApp(): boolean {
    return Boolean(
      this.getRaw("github_app_id") && this.getRaw("github_app_private_key") && this.getRaw("github_app_installation_id"),
    );
  }

  /** Active model provider — defaults to Anthropic. */
  provider(): Provider {
    const value = this.get("provider");
    return value === "openai" || value === "openrouter" || value === "groq" ? value : "anthropic";
  }

  /** The API key for the active provider. */
  activeApiKey(): string | null {
    return this.get(PROVIDER_KEY[this.provider()]);
  }

  /** Google Drive is connected: a service account to read with. */
  driveConfigured(): boolean {
    return Boolean(this.get("google_service_account_json"));
  }

  /** Configured whisper transcription quality; defaults to large-v3-turbo. */
  whisperModel(): string {
    return this.get("whisper_model") || "large-v3-turbo";
  }

  /** Long voice notes use OpenAI transcription by default when a key exists. */
  useOpenAiForLongTranscription(): boolean {
    return Boolean(this.get("openai_api_key") && this.get("openai_long_transcription") !== "false");
  }

  whatsappSettings(): WhatsAppSettings {
    return {
      enabled: this.getRaw("whatsapp_enabled") === "true",
      allowedSenders: parseStoredAllowedSenders(this.getRaw("whatsapp_allowed_senders")),
      groupsEnabled: this.getRaw("whatsapp_groups_enabled") === "true",
      acceptAll: this.getRaw("whatsapp_accept_all") === "true",
    };
  }

  setWhatsAppSettings(
    input: Partial<Omit<WhatsAppSettings, "allowedSenders">> & { allowedSenders?: unknown },
  ): WhatsAppSettings {
    const current = this.whatsappSettings();
    const next: WhatsAppSettings = {
      enabled: input.enabled ?? current.enabled,
      allowedSenders:
        input.allowedSenders === undefined ? current.allowedSenders : normalizeAllowedSenders(input.allowedSenders),
      groupsEnabled: input.groupsEnabled ?? current.groupsEnabled,
      acceptAll: input.acceptAll ?? current.acceptAll,
    };
    this.setRaw("whatsapp_enabled", next.enabled ? "true" : "false");
    this.setRaw("whatsapp_allowed_senders", JSON.stringify(next.allowedSenders));
    this.setRaw("whatsapp_groups_enabled", next.groupsEnabled ? "true" : "false");
    this.setRaw("whatsapp_accept_all", next.acceptAll ? "true" : "false");
    return next;
  }

  /**
   * The key that powers audio transcription, by preference: Groq (free
   * whisper-large-v3-turbo tier), else the OpenAI key. Null = no transcription.
   */
  transcriptionKey(): { provider: "groq" | "openai"; apiKey: string } | null {
    const groq = this.get("groq_api_key");
    if (groq) return { provider: "groq", apiKey: groq };
    const openai = this.get("openai_api_key");
    if (openai) return { provider: "openai", apiKey: openai };
    return null;
  }

  /** The vault is reachable: a repo plus some GitHub auth. Independent of the LLM key. */
  vaultConfigured(): boolean {
    return Boolean(this.get("vault_repo") && (this.get("github_token") || this.hasGithubApp()));
  }

  /** The full engine can run: a reachable vault plus the active provider's key. */
  configured(): boolean {
    return this.vaultConfigured() && Boolean(this.activeApiKey());
  }

  // --- admin password ---

  hasAdminPassword(): boolean {
    return this.store.getSetting("admin_password_hash") !== null;
  }

  setAdminPassword(password: string): void {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    this.store.setSetting("admin_password_hash", `${salt}:${hash}`);
  }

  verifyAdminPassword(password: string): boolean {
    const stored = this.store.getSetting("admin_password_hash");
    if (!stored) return false;
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }

  // --- tokens ---

  apiToken(): string {
    return this.store.getSetting("api_token") ?? "";
  }

  regenerateApiToken(): string {
    const token = `zenod_${randomBytes(24).toString("hex")}`;
    this.store.setSetting("api_token", token);
    return token;
  }

  sessionSecret(): string {
    return this.store.getSetting("session_secret") ?? "";
  }
}

function mask(value: string): string {
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}
