import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SqliteStateStore } from "zenod";
import {
  normalizeAllowedSenders,
  parseStoredAllowedSenders,
  type WhatsAppSettings,
} from "./whatsappConfig.js";
import {
  normalizeAllowedUsers,
  parseStoredAllowedUsers,
  type TelegramSettings,
} from "./telegramConfig.js";
import type { PeerConfig } from "./peerClient.js";

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
  "whisper_model",
  "telegram_enabled",
  "telegram_bot_token",
  "telegram_allowed_users",
  "telegram_accept_all",
  "telegram_rich",
  // Composio (interim Reddit connector, #420). The Console holds the key and pushes
  // it to Callistheness; the outbound agent reads it in buildOutboundTools. user_id
  // is the Composio-connected Reddit account to post/read as (defaults via env).
  "composio_api_key",
  "composio_user_id",
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
  "google_oauth_client_secret",
  "groq_api_key",
  "telegram_bot_token",
  "composio_api_key",
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
  model_vision: "ZENOD_MODEL_VISION",
  model_max_steps: "ZENOD_MODEL_MAX_STEPS",
  google_service_account_json: "GOOGLE_SERVICE_ACCOUNT_JSON",
  google_oauth_client_id: "GOOGLE_OAUTH_CLIENT_ID",
  google_oauth_client_secret: "GOOGLE_OAUTH_CLIENT_SECRET",
  google_drive_folder_id: "GOOGLE_DRIVE_FOLDER_ID",
  groq_api_key: "GROQ_API_KEY",
  openai_long_transcription: "ZENOD_OPENAI_LONG_TRANSCRIPTION",
  long_transcription_provider: "ZENOD_LONG_TRANSCRIPTION_PROVIDER",
  openrouter_transcription_model: "ZENOD_OPENROUTER_TRANSCRIPTION_MODEL",
  whisper_model: "ZENOD_WHISPER_MODEL",
  telegram_enabled: "TELEGRAM_ENABLED",
  telegram_bot_token: "TELEGRAM_BOT_TOKEN",
  telegram_allowed_users: "TELEGRAM_ALLOWED_USERS",
  telegram_accept_all: "TELEGRAM_ACCEPT_ALL",
  telegram_rich: "TELEGRAM_RICH",
  composio_api_key: "COMPOSIO_API_KEY",
  composio_user_id: "COMPOSIO_USER_ID",
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
    // Un-provisioned agents (ZENOD_AWAIT_PROVISION=1, not yet provisioned) do NOT
    // mint their own api_token — the enabler (the Console) originates it and pushes
    // it in via /api/provision. Until then the agent idles, configured()=false.
    if (!this.awaitingProvision(env) && this.store.getSetting("api_token") === null) {
      this.regenerateApiToken();
    }
    if (this.store.getSetting("session_secret") === null) {
      this.store.setSetting("session_secret", randomBytes(32).toString("hex"));
    }
  }

  /** This agent waits for the Console to mint+push its token (headless provisioning). */
  awaitingProvision(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.ZENOD_AWAIT_PROVISION === "1" && this.getRaw("provisioned") !== "1";
  }

  /**
   * Apply a Console-originated provisioning: adopt the given token + config and go
   * live. One-shot — once provisioned, awaitingProvision() is false and the
   * /api/provision endpoint refuses further calls.
   */
  applyProvision(input: {
    token: string
    admin_password_hash?: string
    session_secret?: string
    provider?: string
    api_key?: string
    model_ask?: string
    model_classify?: string
    vault_repo?: string
    vault_branch?: string
    backlog_repo?: string
    github_app_id?: string
    github_app_private_key?: string
    github_app_installation_id?: string
    github_app_slug?: string
    github_token?: string
    composio_api_key?: string
    composio_user_id?: string
  }): void {
    this.store.setSetting("api_token", input.token);
    if (input.admin_password_hash) this.store.setSetting("admin_password_hash", input.admin_password_hash);
    if (input.session_secret) this.store.setSetting("session_secret", input.session_secret);
    if (input.provider) this.store.setSetting("provider", input.provider);
    if (input.provider && input.api_key) this.store.setSetting(PROVIDER_KEY[input.provider as Provider], input.api_key);
    for (const k of ["model_ask", "model_classify", "vault_repo", "vault_branch", "backlog_repo"] as const) {
      if (input[k]) this.store.setSetting(k, input[k]!);
    }
    for (const k of ["github_app_id", "github_app_private_key", "github_app_installation_id", "github_app_slug", "github_token"] as const) {
      if (input[k]) this.store.setSetting(k, input[k]!);
    }
    for (const k of ["composio_api_key", "composio_user_id"] as const) {
      if (input[k]) this.store.setSetting(k, input[k]!);
    }
    this.setRaw("provisioned", "1");
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

  /**
   * Peer agents this agent can delegate to (the mesh). Stored as a JSON blob under
   * the internal `peers` key (not UI-masked settings — tokens are handled by the
   * /api/peers endpoint, which never returns them).
   */
  peers(): PeerConfig[] {
    const raw = this.getRaw("peers");
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? (arr as PeerConfig[]).filter((p) => p && p.name && p.url && p.token) : [];
    } catch {
      return [];
    }
  }

  setPeers(peers: PeerConfig[]): void {
    this.setRaw("peers", JSON.stringify(peers));
  }

  /**
   * Tokens this agent (as the Console) has MINTED for the agents it enables — kept
   * so disable/re-enable reuses the same token (the agent was provisioned with it).
   */
  agentTokens(): Record<string, string> {
    const raw = this.getRaw("agent_tokens");
    if (!raw) return {};
    try {
      const o = JSON.parse(raw);
      return o && typeof o === "object" ? (o as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  agentToken(name: string): string | null {
    return this.agentTokens()[name] ?? null;
  }

  setAgentToken(name: string, token: string): void {
    const all = this.agentTokens();
    all[name] = token;
    this.setRaw("agent_tokens", JSON.stringify(all));
  }

  /**
   * The repo each enabled agent is pointed at (vault or central backlog), kept by
   * the Console for display + the Team-tab "Manage" affordance. Persisted
   * separately from the peer list so it survives disable/re-enable — the agent
   * keeps its provisioned repo while disabled, so the Console should remember it.
   */
  agentRepos(): Record<string, string> {
    const raw = this.getRaw("agent_repos");
    if (!raw) return {};
    try {
      const o = JSON.parse(raw);
      return o && typeof o === "object" ? (o as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  agentRepo(name: string): string | null {
    return this.agentRepos()[name] ?? null;
  }

  setAgentRepo(name: string, repo: string): void {
    const all = this.agentRepos();
    all[name] = repo;
    this.setRaw("agent_repos", JSON.stringify(all));
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

  /** Configured tool-step budget per reply; undefined = engine default. */
  maxSteps(): number | undefined {
    const value = this.get("model_max_steps");
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
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

  /** Google Drive is connected: service account, or Google user OAuth. */
  driveConfigured(): boolean {
    return Boolean(
      this.get("google_service_account_json") ||
        (this.get("google_oauth_client_id") &&
          this.get("google_oauth_client_secret") &&
          this.getRaw("google_oauth_refresh_token")),
    );
  }

  /** Configured whisper transcription quality; defaults to large-v3-turbo. */
  whisperModel(): string {
    return this.get("whisper_model") || "large-v3-turbo";
  }

  /** Long voice notes use OpenAI transcription by default when a key exists. */
  useOpenAiForLongTranscription(): boolean {
    return Boolean(this.get("openai_api_key") && this.get("openai_long_transcription") !== "false");
  }

  longTranscriptionProvider(): "openrouter" | "openai" | "local" {
    const value = this.get("long_transcription_provider");
    if (value === "openrouter" || value === "openai" || value === "local") return value;
    if (this.get("openrouter_api_key")) return "openrouter";
    return this.useOpenAiForLongTranscription() ? "openai" : "local";
  }

  openrouterTranscriptionModel(): string {
    return this.get("openrouter_transcription_model") || "openai/whisper-large-v3-turbo";
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
   * Telegram channel config (env-seeded, no bespoke UI). Setting just
   * TELEGRAM_BOT_TOKEN is enough to turn the channel on (Hermes-style) — set
   * telegram_enabled=false to keep a token configured but the gateway off.
   * Rich messages (Bot API 10.1 markdown passthrough) are on unless disabled.
   */
  telegramSettings(): TelegramSettings {
    const token = this.get("telegram_bot_token");
    const enabledRaw = this.get("telegram_enabled");
    const enabled = enabledRaw === null ? Boolean(token) : enabledRaw === "true";
    return {
      enabled: enabled && Boolean(token),
      allowedUsers: parseStoredAllowedUsers(this.get("telegram_allowed_users")),
      acceptAll: this.get("telegram_accept_all") === "true",
      rich: this.get("telegram_rich") !== "false",
    };
  }

  setTelegramSettings(
    input: Partial<Omit<TelegramSettings, "allowedUsers">> & { allowedUsers?: unknown; botToken?: string },
  ): TelegramSettings {
    if (input.botToken !== undefined) this.set("telegram_bot_token", input.botToken);
    if (input.enabled !== undefined) this.set("telegram_enabled", input.enabled ? "true" : "false");
    if (input.acceptAll !== undefined) this.set("telegram_accept_all", input.acceptAll ? "true" : "false");
    if (input.rich !== undefined) this.set("telegram_rich", input.rich ? "true" : "false");
    if (input.allowedUsers !== undefined) {
      this.set("telegram_allowed_users", JSON.stringify(normalizeAllowedUsers(input.allowedUsers)));
    }
    return this.telegramSettings();
  }

  telegramBotToken(): string | null {
    return this.get("telegram_bot_token");
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
