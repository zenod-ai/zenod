import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SqliteStateStore } from "zenod";

/** Runtime settings persisted in SQLite; env vars seed them on first boot. */
export const SETTING_KEYS = [
  "vault_repo",
  "vault_branch",
  "github_token",
  "anthropic_api_key",
  "model_ask",
  "model_classify",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

const SECRET_KEYS: ReadonlySet<string> = new Set(["github_token", "anthropic_api_key"]);

const ENV_SEEDS: Record<SettingKey, string> = {
  vault_repo: "VAULT_REPO",
  vault_branch: "VAULT_BRANCH",
  github_token: "GITHUB_TOKEN",
  anthropic_api_key: "ANTHROPIC_API_KEY",
  model_ask: "ZENOD_MODEL_ASK",
  model_classify: "ZENOD_MODEL_CLASSIFY",
};

export class Settings {
  constructor(private readonly store: SqliteStateStore) {}

  /** Seed settings from env vars that aren't already set (first boot). */
  seedFromEnv(env: NodeJS.ProcessEnv = process.env): void {
    for (const key of SETTING_KEYS) {
      const envValue = env[ENV_SEEDS[key]];
      if (envValue && this.get(key) === null) this.store.setSetting(key, envValue);
    }
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

  /** The vault is reachable: a repo plus some GitHub auth. Independent of the LLM key. */
  vaultConfigured(): boolean {
    return Boolean(this.get("vault_repo") && (this.get("github_token") || this.hasGithubApp()));
  }

  /** The full engine can run: a reachable vault plus an Anthropic key. */
  configured(): boolean {
    return this.vaultConfigured() && Boolean(this.get("anthropic_api_key"));
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
