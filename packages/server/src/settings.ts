import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SqliteStateStore } from "zenod/state/sqlite";
import { clearGithubAuthorizationCache } from "zenod";
import {
  normalizeOptionalConfigString,
  normalizeAllowedSenders,
  normalizeWhatsAppCloudStatus,
  parseStoredAllowedSenders,
  normalizeWhatsAppProviderMode,
  type WhatsAppSettings,
} from "./whatsappConfig.js";
import {
  normalizeAllowedUsers,
  parseStoredAllowedUsers,
  type TelegramSettings,
} from "./telegramConfig.js";
import type { PeerConfig } from "./peerClient.js";
import type { RingConnectedServer, RingRelayPolicy, RingRouteLogEntry } from "./ringRouter.js";
import { isCredentialHandle, type CredentialVault } from "./credentialVault.js";
import type { VaultProviderBindingRecord } from "./googleDriveVaultContract.js";

/** Runtime settings persisted in SQLite; env vars seed them on first boot. */
export const SETTING_KEYS = [
  // Display name this instance publishes as its MCP server name — lets a user run
  // several memories (work / personal / a project) and tell them apart in their client.
  "instance_name",
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
  "artifact_archive_provider",
  "artifact_archive_local_dir",
  "artifact_archive_drive_folder_id",
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

export interface GoogleDriveOAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export type GoogleDriveOAuthAuthority =
  | { mode: "self-hosted" }
  | {
      mode: "hosted-managed";
      credentials: GoogleDriveOAuthClientCredentials | null;
      /** Hosted entitlement permits this tenant's own complete OAuth client pair. */
      tenantCredentialsAllowed?: boolean;
    };

export type GoogleDriveOAuthAuthoritySource = () => GoogleDriveOAuthAuthority;
export type VaultProviderBindingSource = () => VaultProviderBindingRecord | null;

export interface RingTenantConfig {
  enabled: boolean;
  tenantSlug: string | null;
  tenantName: string | null;
  settingsUrl: string | null;
  runtimeMode: "hosted_tenant" | "self_hosted" | "dev";
  routePolicy: "deterministic_fast_path";
  defaultServerId: string | null;
  zenodServerId: string | null;
}

export type ExecutorEffort = "low" | "medium" | "high" | "max";
export type ExecutorCliProvider = "auto" | "codex" | "claude";

export interface ExecutorMcpServer {
  name: string;
  url: string;
  enabled: boolean;
  token?: string;
  hasToken: boolean;
}

export interface ExecutorSettings {
  defaultEffort: ExecutorEffort;
  workerInstructions: string;
  cliProvider: ExecutorCliProvider;
  mcpServers: ExecutorMcpServer[];
  skills: string[];
  status: {
    githubAuth: "configured" | "missing";
    providerAuth: "configured" | "missing";
    cliAuth: "configured" | "missing";
    provider: Provider;
    hasGithubToken: boolean;
    hasGithubApp: boolean;
    hasProviderKey: boolean;
    hasCodexCliAuth: boolean;
    hasClaudeCliAuth: boolean;
    executionLaneConfigured: boolean;
    archusPeerUrl: string | null;
  };
}

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

const CREDENTIAL_SECRET_KEYS: ReadonlySet<string> = new Set([
  ...SECRET_KEYS,
  "github_app_private_key",
  "google_oauth_refresh_token",
  "google_drive_vault_oauth_refresh_token",
]);

function peerTokenKey(name: string): string {
  return `peer_token_${name.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 80)}`;
}

const ENV_SEEDS: Record<SettingKey, string> = {
  instance_name: "ZENOD_INSTANCE_NAME",
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
  artifact_archive_provider: "ZENOD_ARTIFACT_ARCHIVE_PROVIDER",
  artifact_archive_local_dir: "ZENOD_ARTIFACT_ARCHIVE_LOCAL_DIR",
  artifact_archive_drive_folder_id: "ZENOD_ARTIFACT_ARCHIVE_DRIVE_FOLDER_ID",
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
  constructor(
    private readonly store: SqliteStateStore,
    private readonly credentialVault?: CredentialVault,
    private readonly rawFallbacks: Readonly<Record<string, string>> = {},
    private readonly googleDriveOAuthAuthoritySource?: GoogleDriveOAuthAuthoritySource,
    private readonly vaultProviderBindingSource?: VaultProviderBindingSource,
    private readonly githubAuthorizationScopeSource?: () => string,
    private readonly githubAuthorizationRevokedCallback?: () => void,
  ) {
    this.migrateCredentialSecrets();
  }

  /** Seed settings from env vars that aren't already set (first boot). */
  seedFromEnv(env: NodeJS.ProcessEnv = process.env): void {
    for (const key of SETTING_KEYS) {
      const envValue = env[ENV_SEEDS[key]];
      if (envValue && this.get(key) === null) this.set(key, envValue);
    }
    if (this.get("provider") === null) this.store.setSetting("provider", "anthropic");
    // ZD-9: a self-hoster can PIN their MCP token via ZENOD_API_TOKEN (sits next to
    // VAULT_REPO/GITHUB_TOKEN). This mirrors ZD-8's provisioner-set token, so the
    // stranger knows the bearer without needing the auth-gated /api/token.
    if (this.store.getSetting("api_token") === null && env.ZENOD_API_TOKEN) {
      this.store.setSetting("api_token", env.ZENOD_API_TOKEN);
    }
    // Un-provisioned agents (ZENOD_AWAIT_PROVISION=1, not yet provisioned) do NOT
    // mint their own api_token — the enabler (the Console) originates it and pushes
    // it in via /api/provision. Until then the agent idles, configured()=false.
    if (!this.awaitingProvision(env) && this.store.getSetting("api_token") === null) {
      this.regenerateApiToken();
      // ZD-9: nothing was pinned, so print the generated token ONCE to the boot logs —
      // otherwise a self-hoster can never learn it (/api/token needs the token). Pin
      // ZENOD_API_TOKEN to silence this.
      // eslint-disable-next-line no-console
      console.log(
        `[zenod] ZD-9: no ZENOD_API_TOKEN set — generated MCP bearer token: ${this.apiToken()} ` +
          `(send as 'Authorization: Bearer <token>' to /mcp; set ZENOD_API_TOKEN to pin it)`,
      );
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
    if (input.provider && input.api_key) this.set(PROVIDER_KEY[input.provider as Provider], input.api_key);
    for (const k of ["model_ask", "model_classify", "vault_repo", "vault_branch", "backlog_repo"] as const) {
      if (input[k]) this.setRaw(k, input[k]!);
    }
    for (const k of ["github_app_id", "github_app_private_key", "github_app_installation_id", "github_app_slug", "github_token"] as const) {
      if (input[k]) this.setRaw(k, input[k]!);
    }
    for (const k of ["composio_api_key", "composio_user_id"] as const) {
      if (input[k]) this.setRaw(k, input[k]!);
    }
    this.setRaw("provisioned", "1");
  }

  get(key: SettingKey): string | null {
    return this.getStoredValue(key);
  }

  set(key: SettingKey, value: string): void {
    this.setStoredValue(key, value);
  }

  /** Internal keys (e.g. GitHub App credentials) — not part of the UI-editable set. */
  getRaw(key: string): string | null {
    return this.getStoredValue(key) ?? this.rawFallbacks[key] ?? null;
  }

  setRaw(key: string, value: string): void {
    this.setStoredValue(key, value);
  }

  private getStoredValue(key: string): string | null {
    const stored = this.store.getSetting(key);
    if (!stored || !this.credentialVault || !CREDENTIAL_SECRET_KEYS.has(key)) return stored;
    if (isCredentialHandle(stored)) return this.credentialVault.materialize(key, stored);

    // A pre-custody database or direct legacy write is migrated on first read.
    const handle = this.credentialVault.put(key, stored);
    this.store.setSetting(key, handle);
    return stored;
  }

  private setStoredValue(key: string, value: string): void {
    const current = this.store.getSetting(key);
    if (value === "") {
      if (this.credentialVault && current && isCredentialHandle(current)) {
        this.credentialVault.delete(key, current);
      }
      this.store.deleteSetting(key);
      return;
    }
    if (this.credentialVault && CREDENTIAL_SECRET_KEYS.has(key)) {
      this.store.setSetting(key, this.credentialVault.put(key, value));
      return;
    }
    this.store.setSetting(key, value);
  }

  private migrateCredentialSecrets(): void {
    if (!this.credentialVault) return;
    for (const key of CREDENTIAL_SECRET_KEYS) {
      const stored = this.store.getSetting(key);
      if (!stored || isCredentialHandle(stored)) continue;
      this.store.setSetting(key, this.credentialVault.put(key, stored));
    }
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
      if (!Array.isArray(arr)) return [];
      return (arr as PeerConfig[])
        .map((peer) => {
          if (!peer || !peer.name || !peer.url || !peer.token) return null;
          const token = isCredentialHandle(peer.token)
            ? this.credentialVault?.materialize(peerTokenKey(peer.name), peer.token) ?? null
            : peer.token;
          return token ? { ...peer, token } : null;
        })
        .filter((peer): peer is PeerConfig => peer !== null);
    } catch {
      return [];
    }
  }

  setPeers(peers: PeerConfig[]): void {
    if (!this.credentialVault) {
      this.setRaw("peers", JSON.stringify(peers));
      return;
    }
    const current = this.getRaw("peers");
    let prior: PeerConfig[] = [];
    try {
      const parsed = current ? JSON.parse(current) : [];
      prior = Array.isArray(parsed) ? (parsed as PeerConfig[]) : [];
    } catch {
      prior = [];
    }
    const nextNames = new Set(peers.map((peer) => peer.name));
    for (const peer of prior) {
      if (!nextNames.has(peer.name) && isCredentialHandle(peer.token)) {
        this.credentialVault.delete(peerTokenKey(peer.name), peer.token);
      }
    }
    const vaulted = peers.map((peer) => ({
      ...peer,
      token: this.credentialVault!.put(peerTokenKey(peer.name), peer.token),
    }));
    this.setRaw("peers", JSON.stringify(vaulted));
  }

  ringTenantConfig(): RingTenantConfig {
    const mode = this.getRaw("ring_runtime_mode");
    const runtimeMode = mode === "self_hosted" || mode === "dev" ? mode : "hosted_tenant";
    return {
      enabled: this.getRaw("ring_enabled") !== "false",
      tenantSlug: normalizeOptionalConfigString(this.getRaw("ring_tenant_slug")),
      tenantName: normalizeOptionalConfigString(this.getRaw("ring_tenant_name")),
      settingsUrl: normalizeOptionalConfigString(this.getRaw("ring_settings_url")),
      runtimeMode,
      routePolicy: "deterministic_fast_path",
      defaultServerId: normalizeOptionalConfigString(this.getRaw("ring_default_server_id")),
      zenodServerId: normalizeOptionalConfigString(this.getRaw("ring_zenod_server_id")),
    };
  }

  executorSettings(env: NodeJS.ProcessEnv = process.env): ExecutorSettings {
    const hasGithubToken = Boolean(this.get("github_token"));
    const hasGithubApp = this.hasGithubApp();
    const provider = this.provider();
    const hasProviderKey = Boolean(this.activeApiKey());
    const hasCodexCliAuth = Boolean(
      this.getRaw("epaminon_codex_cli_auth") ||
        env.CODEX_API_KEY ||
        env.OPENAI_API_KEY,
    );
    const hasClaudeCliAuth = Boolean(
      this.getRaw("epaminon_claude_cli_auth") ||
        env.CLAUDE_CODE_OAUTH_TOKEN ||
        env.ANTHROPIC_API_KEY,
    );
    return {
      defaultEffort: normalizeExecutorEffort(this.getRaw("epaminon_default_effort")),
      workerInstructions: this.getRaw("epaminon_worker_instructions") ?? "",
      cliProvider: normalizeExecutorCliProvider(this.getRaw("epaminon_cli_provider")),
      mcpServers: this.executorMcpServers().map(({ token: _token, ...server }) => server),
      skills: this.executorSkills(),
      status: {
        githubAuth: hasGithubToken || hasGithubApp ? "configured" : "missing",
        providerAuth: hasProviderKey ? "configured" : "missing",
        cliAuth: hasCodexCliAuth || hasClaudeCliAuth ? "configured" : "missing",
        provider,
        hasGithubToken,
        hasGithubApp,
        hasProviderKey,
        hasCodexCliAuth,
        hasClaudeCliAuth,
        executionLaneConfigured: Boolean(this.getRaw("exec_lane_secret")),
        archusPeerUrl: normalizeOptionalConfigString(this.getRaw("exec_archus_url")),
      },
    };
  }

  setExecutorSettings(input: {
    defaultEffort?: unknown;
    workerInstructions?: unknown;
    cliProvider?: unknown;
    mcpServers?: unknown;
    skills?: unknown;
  }): ExecutorSettings {
    if (input.defaultEffort !== undefined) {
      this.setRaw("epaminon_default_effort", normalizeExecutorEffort(input.defaultEffort));
    }
    if (input.workerInstructions !== undefined) {
      this.setRaw("epaminon_worker_instructions", normalizeString(input.workerInstructions));
    }
    if (input.cliProvider !== undefined) {
      this.setRaw("epaminon_cli_provider", normalizeExecutorCliProvider(input.cliProvider));
    }
    if (input.mcpServers !== undefined) {
      this.setRaw("epaminon_mcp_servers", JSON.stringify(normalizeExecutorMcpServers(input.mcpServers, this.executorMcpServers())));
    }
    if (input.skills !== undefined) {
      this.setRaw("epaminon_skills", JSON.stringify(normalizeExecutorSkills(input.skills)));
    }
    return this.executorSettings();
  }

  private executorMcpServers(): ExecutorMcpServer[] {
    const raw = this.getRaw("epaminon_mcp_servers");
    if (!raw) return [];
    try {
      return normalizeExecutorMcpServers(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  private executorSkills(): string[] {
    const raw = this.getRaw("epaminon_skills");
    if (!raw) return [];
    try {
      return normalizeExecutorSkills(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  setRingTenantConfig(input: Partial<RingTenantConfig>): RingTenantConfig {
    if (input.enabled !== undefined) this.setRaw("ring_enabled", input.enabled ? "true" : "false");
    if (input.tenantSlug !== undefined) this.setRaw("ring_tenant_slug", input.tenantSlug ?? "");
    if (input.tenantName !== undefined) this.setRaw("ring_tenant_name", input.tenantName ?? "");
    if (input.settingsUrl !== undefined) this.setRaw("ring_settings_url", input.settingsUrl ?? "");
    if (input.runtimeMode !== undefined) this.setRaw("ring_runtime_mode", input.runtimeMode);
    if (input.defaultServerId !== undefined) this.setRaw("ring_default_server_id", input.defaultServerId ?? "");
    if (input.zenodServerId !== undefined) this.setRaw("ring_zenod_server_id", input.zenodServerId ?? "");
    return this.ringTenantConfig();
  }

  ringConnectedProducts(): RingConnectedServer[] {
    const raw = this.getRaw("ring_connected_products");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => normalizeRingConnectedProduct(item))
        .filter((item): item is RingConnectedServer => item !== null);
    } catch {
      return [];
    }
  }

  setRingConnectedProducts(products: unknown[]): RingConnectedServer[] {
    const existing = new Map(this.ringConnectedProducts().map((product) => [product.id, product]));
    const next = products
      .map((item) => normalizeRingConnectedProduct(item, existing))
      .filter((item): item is RingConnectedServer => item !== null);
    this.setRaw("ring_connected_products", JSON.stringify(next));
    return next;
  }

  ringRouteLog(): RingRouteLogEntry[] {
    const raw = this.getRaw("ring_route_log");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as RingRouteLogEntry[]) : [];
    } catch {
      return [];
    }
  }

  appendRingRouteLog(entry: RingRouteLogEntry): RingRouteLogEntry[] {
    const next = [entry, ...this.ringRouteLog()].slice(0, 50);
    this.setRaw("ring_route_log", JSON.stringify(next));
    return next;
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
    const authority = this.googleDriveOAuthAuthority();
    if (authority.mode === "hosted-managed") {
      return Boolean(
        authority.credentials && this.getRaw("google_oauth_refresh_token"),
      );
    }
    return Boolean(
      this.get("google_service_account_json") ||
        (this.get("google_oauth_client_id") &&
          this.get("google_oauth_client_secret") &&
          this.getRaw("google_oauth_refresh_token")),
    );
  }

  /** Authoritative Drive vault consent is isolated from the legacy archive/ingest OAuth credential. */
  driveVaultConfigured(): boolean {
    const authority = this.googleDriveOAuthAuthority();
    return authority.mode === "hosted-managed" && Boolean(
      authority.credentials && this.getRaw("google_drive_vault_oauth_refresh_token"),
    );
  }

  googleDriveOAuthAuthority(): GoogleDriveOAuthAuthority {
    const authority = this.googleDriveOAuthAuthoritySource?.() ?? { mode: "self-hosted" };
    if (authority.mode === "self-hosted") return authority;
    if (authority.credentials) {
      return { mode: "hosted-managed", credentials: authority.credentials };
    }
    if (authority.tenantCredentialsAllowed) {
      const clientId = this.get("google_oauth_client_id");
      const clientSecret = this.get("google_oauth_client_secret");
      if (clientId && clientSecret) {
        return {
          mode: "hosted-managed",
          credentials: { clientId, clientSecret },
        };
      }
    }
    return { mode: "hosted-managed", credentials: null };
  }

  /** Whether this Hosted tenant may configure its own OAuth client pair. */
  googleDriveTenantCredentialsAllowed(): boolean {
    const authority = this.googleDriveOAuthAuthoritySource?.();
    return authority?.mode === "hosted-managed" && authority.tenantCredentialsAllowed === true;
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
      providerMode: normalizeWhatsAppProviderMode(this.getRaw("whatsapp_provider_mode")),
      cloudProvider: normalizeOptionalConfigString(this.getRaw("whatsapp_cloud_provider")),
      cloudWebhookUrl: normalizeOptionalConfigString(this.getRaw("whatsapp_cloud_webhook_url")),
      cloudPhoneNumberId: normalizeOptionalConfigString(this.getRaw("whatsapp_cloud_phone_number_id")),
      cloudStatus: normalizeWhatsAppCloudStatus(this.getRaw("whatsapp_cloud_status")),
      testRecipient: normalizeOptionalConfigString(this.getRaw("whatsapp_test_recipient")),
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
      providerMode:
        input.providerMode === undefined ? current.providerMode : normalizeWhatsAppProviderMode(input.providerMode),
      cloudProvider:
        input.cloudProvider === undefined ? current.cloudProvider : normalizeOptionalConfigString(input.cloudProvider),
      cloudWebhookUrl:
        input.cloudWebhookUrl === undefined
          ? current.cloudWebhookUrl
          : normalizeOptionalConfigString(input.cloudWebhookUrl),
      cloudPhoneNumberId:
        input.cloudPhoneNumberId === undefined
          ? current.cloudPhoneNumberId
          : normalizeOptionalConfigString(input.cloudPhoneNumberId),
      cloudStatus:
        input.cloudStatus === undefined ? current.cloudStatus : normalizeWhatsAppCloudStatus(input.cloudStatus),
      testRecipient:
        input.testRecipient === undefined
          ? current.testRecipient
          : normalizeOptionalConfigString(input.testRecipient),
      allowedSenders:
        input.allowedSenders === undefined ? current.allowedSenders : normalizeAllowedSenders(input.allowedSenders),
      groupsEnabled: input.groupsEnabled ?? current.groupsEnabled,
      acceptAll: input.acceptAll ?? current.acceptAll,
    };
    this.setRaw("whatsapp_enabled", next.enabled ? "true" : "false");
    this.setRaw("whatsapp_provider_mode", next.providerMode);
    this.setRaw("whatsapp_cloud_provider", next.cloudProvider ?? "");
    this.setRaw("whatsapp_cloud_webhook_url", next.cloudWebhookUrl ?? "");
    this.setRaw("whatsapp_cloud_phone_number_id", next.cloudPhoneNumberId ?? "");
    this.setRaw("whatsapp_cloud_status", next.cloudStatus);
    this.setRaw("whatsapp_test_recipient", next.testRecipient ?? "");
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

  /** The selected vault authority is ready and its provider credential is available. Independent of the LLM key. */
  vaultConfigured(): boolean {
    const binding = this.vaultProviderBindingSource?.() ?? null;
    if (binding) {
      if (binding.status !== "ready") return false;
      if (binding.provider === "google_drive") {
        return Boolean(binding.folder_id && binding.manifest_file_id && this.driveVaultConfigured());
      }
      return Boolean(
        binding.repo &&
        binding.branch &&
        (this.get("github_token") || this.hasGithubApp()),
      );
    }
    return Boolean(this.get("vault_repo") && (this.get("github_token") || this.hasGithubApp()));
  }

  /** GitHub tasking is optional and independent of the selected vault provider. */
  githubConnectionConfigured(): boolean {
    return Boolean(this.get("github_token") || this.hasGithubApp());
  }

  githubAuthorizationScope(): string {
    return this.githubAuthorizationScopeSource?.() || "standalone:unbound";
  }

  onGithubAuthorizationRevoked(): void {
    this.revokeGithubAuthorization();
    this.githubAuthorizationRevokedCallback?.();
  }

  /** Replace tenant authorization and evict both old and same-ID cached tokens. */
  replaceGithubInstallationAuthorization(installationId: string): void {
    clearGithubAuthorizationCache(this);
    clearGithubAuthorizationCache(this, installationId);
    this.setRaw("github_app_installation_id", installationId);
  }

  /** Invalidate only tenant authorization; retain shared App identity/configuration for reconnect. */
  revokeGithubAuthorization(): void {
    clearGithubAuthorizationCache(this);
    this.setRaw("github_app_installation_id", "");
    this.setRaw("github_token", "");
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

  /**
   * OAuth-consent credential: accept the instance's API token (the bearer the user
   * already has in their console) OR an admin password if one was set. For a hosted
   * single-user memory the token IS the credential — the user pastes it, no separate
   * admin password (which the hosted provisioner never sets). Constant-time compare.
   */
  verifyConsoleCredential(input: string): boolean {
    const token = this.apiToken();
    if (token) {
      const a = Buffer.from(input);
      const b = Buffer.from(token);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    }
    return this.verifyAdminPassword(input);
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

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeExecutorEffort(value: unknown): ExecutorEffort {
  return value === "low" || value === "high" || value === "max" ? value : "medium";
}

function normalizeExecutorCliProvider(value: unknown): ExecutorCliProvider {
  return value === "codex" || value === "claude" ? value : "auto";
}

function normalizeExecutorSkills(value: unknown): string[] {
  const items =
    typeof value === "string"
      ? value.split(/\r?\n|,/)
      : Array.isArray(value)
        ? value
        : [];
  return [...new Set(items.map((item) => normalizeString(item)).filter(Boolean))];
}

function normalizeExecutorMcpServers(value: unknown, existing: ExecutorMcpServer[] = []): ExecutorMcpServer[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name = normalizeString(record.name);
      const url = normalizeString(record.url);
      if (!name || !url) return null;
      const previous = existing.find((server) => server.name === name);
      const rawToken = normalizeString(record.token);
      const token = rawToken && !rawToken.includes("••••") ? rawToken : previous?.token ?? "";
      return {
        name,
        url,
        enabled: record.enabled === undefined ? true : record.enabled !== false,
        ...(token ? { token } : {}),
        hasToken: Boolean(token),
      };
    })
    .filter((server): server is ExecutorMcpServer => server !== null);
}

function normalizeStringArray(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\n]/) : [];
  return [...new Set(raw.map((item) => normalizeString(item)).filter(Boolean))];
}

function normalizeRelayPolicy(value: unknown): RingRelayPolicy {
  return value === "silent" ? "silent" : "same_channel";
}

function normalizeTools(value: unknown): RingConnectedServer["tools"] {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const tools: RingConnectedServer["tools"] = {};
  for (const key of ["chat", "askMemory", "storeMemory", "ingestMemory", "runTask"] as const) {
    const v = normalizeString(input[key]);
    if (v) tools[key] = v;
  }
  return Object.keys(tools).length ? tools : undefined;
}

function normalizeRingConnectedProduct(
  value: unknown,
  existing: Map<string, RingConnectedServer> = new Map(),
): RingConnectedServer | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const id = normalizeString(input.id).toLowerCase();
  if (!id) return null;
  const current = existing.get(id);
  const token = normalizeString(input.token);
  const endpoint = normalizeString(input.endpoint) || current?.endpoint || "";
  const displayName = normalizeString(input.displayName) || normalizeString(input.name) || current?.displayName || id;
  const skillText = normalizeString(input.skillText) || current?.skillText || "";
  return {
    id,
    endpoint,
    token: token && !token.includes("••••") ? token : current?.token ?? "",
    displayName,
    skillText,
    enabled: typeof input.enabled === "boolean" ? input.enabled : current?.enabled ?? true,
    relayPolicy: normalizeRelayPolicy(input.relayPolicy ?? current?.relayPolicy),
    ...(normalizeString(input.settingsUrl) || current?.settingsUrl
      ? { settingsUrl: normalizeString(input.settingsUrl) || current?.settingsUrl }
      : {}),
    aliases: normalizeStringArray(input.aliases ?? current?.aliases),
    ...(normalizeTools(input.tools ?? current?.tools) ? { tools: normalizeTools(input.tools ?? current?.tools) } : {}),
  };
}
