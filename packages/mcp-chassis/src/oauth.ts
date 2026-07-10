import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import type {
  TenantContext,
  TenantOAuthAccessToken,
  TenantTokenStore,
  UnitAuthMiddleware,
} from "./index.js";
import { hashToken } from "./index.js";
import type { ChassisStorage } from "./storage.js";

const ACCESS_TTL_MS = 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const MCP_SCOPE = "mcp";
const OAUTH_VAULT_PREFIX = "oauth:";
const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: number;
}

export interface OAuthAuthorizationCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  tenant: TenantContext;
  expiresAt: number;
}

export interface OAuthServerToken extends TenantOAuthAccessToken {
  accessToken: string;
  refreshToken: string;
  resource: string;
  createdAt: number;
}

export interface OAuthProviderState {
  state: string;
  providerId: string;
  tenantId: string;
  redirectUri: string;
  expiresAt: number;
}

export interface OAuthTokenSet {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
  [key: string]: unknown;
}

export interface OAuthProviderExchangeInput {
  code: string;
  redirectUri: string;
  tenant: TenantContext;
  provider: OAuthProvider;
}

export interface OAuthProvider {
  id: string;
  displayName?: string;
  clientId: string;
  authorizationUrl: string | ((input: { baseUrl: string; provider: OAuthProvider }) => string);
  scopes?: string[];
  authorizationParams?: Record<string, string>;
  vaultKey?: string;
  exchangeCode(input: OAuthProviderExchangeInput): Promise<OAuthTokenSet> | OAuthTokenSet;
}

export interface OAuthStore {
  createClient(client: OAuthClient): void;
  getClient(clientId: string): OAuthClient | null;
  createCode(code: OAuthAuthorizationCode): void;
  consumeCode(code: string): OAuthAuthorizationCode | null;
  createToken(token: OAuthServerToken): void;
  resolveOAuthAccessToken(accessToken: string): TenantOAuthAccessToken | null;
  getByRefreshToken(refreshToken: string): OAuthServerToken | null;
  rotateAccessToken(refreshToken: string, newAccessToken: string, expiresAt: number): void;
  createProviderState(state: OAuthProviderState): void;
  consumeProviderState(state: string): OAuthProviderState | null;
}

export interface OAuthServerOptions {
  enabled?: boolean;
}

export interface OAuthClientFrameworkOptions {
  providers?: OAuthProvider[];
}

export interface OAuthKitOptions {
  store?: OAuthStore;
  server?: boolean | OAuthServerOptions;
  providers?: OAuthProvider[];
}

export interface ResolvedOAuthKit {
  store: OAuthStore;
  serverEnabled: boolean;
  providers: Map<string, OAuthProvider>;
}

export class MemoryOAuthStore implements OAuthStore {
  private readonly clients = new Map<string, OAuthClient>();
  private readonly codes = new Map<string, OAuthAuthorizationCode>();
  private readonly tokensByAccess = new Map<string, OAuthServerToken>();
  private readonly tokensByRefresh = new Map<string, string>();
  private readonly providerStates = new Map<string, OAuthProviderState>();

  createClient(client: OAuthClient): void {
    this.clients.set(client.clientId, { ...client, redirectUris: [...client.redirectUris] });
  }

  getClient(clientId: string): OAuthClient | null {
    const client = this.clients.get(clientId);
    return client ? { ...client, redirectUris: [...client.redirectUris] } : null;
  }

  createCode(code: OAuthAuthorizationCode): void {
    this.codes.set(code.code, { ...code, tenant: { ...code.tenant } });
  }

  consumeCode(code: string): OAuthAuthorizationCode | null {
    const authCode = this.codes.get(code);
    this.codes.delete(code);
    if (!authCode || authCode.expiresAt < Date.now()) return null;
    return { ...authCode, tenant: { ...authCode.tenant } };
  }

  createToken(token: OAuthServerToken): void {
    this.tokensByAccess.set(token.accessToken, cloneOAuthToken(token));
    this.tokensByRefresh.set(token.refreshToken, token.accessToken);
  }

  resolveOAuthAccessToken(accessToken: string): TenantOAuthAccessToken | null {
    const token = this.tokensByAccess.get(accessToken);
    if (!token || token.expiresAt < Date.now()) return null;
    return {
      tenant: { ...token.tenant },
      clientId: token.clientId,
      clientName: token.clientName,
      scope: token.scope,
      expiresAt: token.expiresAt,
    };
  }

  getByRefreshToken(refreshToken: string): OAuthServerToken | null {
    const access = this.tokensByRefresh.get(refreshToken);
    const token = access ? this.tokensByAccess.get(access) : null;
    return token ? cloneOAuthToken(token) : null;
  }

  rotateAccessToken(refreshToken: string, newAccessToken: string, expiresAt: number): void {
    const oldAccess = this.tokensByRefresh.get(refreshToken);
    const existing = oldAccess ? this.tokensByAccess.get(oldAccess) : null;
    if (!oldAccess || !existing) return;
    this.tokensByAccess.delete(oldAccess);
    this.tokensByAccess.set(newAccessToken, { ...existing, accessToken: newAccessToken, expiresAt });
    this.tokensByRefresh.set(refreshToken, newAccessToken);
  }

  createProviderState(state: OAuthProviderState): void {
    this.providerStates.set(state.state, { ...state });
  }

  consumeProviderState(state: string): OAuthProviderState | null {
    const entry = this.providerStates.get(state);
    this.providerStates.delete(state);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return { ...entry };
  }
}

export function resolveOAuthKit(options: OAuthKitOptions | undefined): ResolvedOAuthKit | null {
  if (!options) return null;
  const serverEnabled = typeof options.server === "boolean" ? options.server : Boolean(options.server?.enabled);
  const providers = new Map<string, OAuthProvider>();
  for (const provider of options.providers ?? []) {
    const id = provider.id.trim();
    if (!PROVIDER_ID_RE.test(id) || providers.has(id)) {
      throw new Error("OAuth providers must have unique ids of A-Z, a-z, 0-9, _, ., or -");
    }
    providers.set(id, { ...provider, id });
  }
  if (!serverEnabled && providers.size === 0) return null;
  return { store: options.store ?? new MemoryOAuthStore(), serverEnabled, providers };
}

export function publicBaseUrl(c: Context): string {
  const proto = c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? new URL(c.req.url).host;
  return `${proto}://${host}`;
}

export function protectedResourceMetadata(baseUrl: string): Record<string, unknown> {
  return {
    resource: canonicalResource(baseUrl),
    authorization_servers: [baseUrl],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
  };
}

export function authServerMetadata(baseUrl: string): Record<string, unknown> {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_SCOPE],
    authorization_response_iss_parameter_supported: true,
  };
}

export function oauthWwwAuthenticate(baseUrl: string): string {
  return `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", scope="${MCP_SCOPE}"`;
}

export function installOAuthRoutes(
  app: Hono<any>,
  options: {
    kit: ResolvedOAuthKit;
    tenantStore: TenantTokenStore;
    storage: ChassisStorage;
    tenantAuth: UnitAuthMiddleware;
  },
): void {
  if (options.kit.serverEnabled) {
    app.get("/.well-known/oauth-protected-resource", (c) => c.json(protectedResourceMetadata(publicBaseUrl(c))));
    app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(protectedResourceMetadata(publicBaseUrl(c))));
    app.get("/.well-known/oauth-authorization-server", (c) => c.json(authServerMetadata(publicBaseUrl(c))));
    app.get("/.well-known/oauth-authorization-server/mcp", (c) => c.json(authServerMetadata(publicBaseUrl(c))));
    app.post("/oauth/register", (c) => handleRegister(c, options.kit.store));
    app.get("/oauth/authorize", (c) => handleAuthorizeGet(c, options.kit.store));
    app.post("/oauth/authorize/decision", (c) => handleAuthorizeDecision(c, options.kit.store, options.tenantStore));
    app.post("/oauth/token", (c) => handleToken(c, options.kit.store));
  }

  for (const [providerId, provider] of options.kit.providers) {
    app.get(`/api/oauth/providers/${providerId}/start`, options.tenantAuth, (c) =>
      handleProviderStart(c, options.kit.store, provider),
    );
    app.get(`/api/oauth/providers/${providerId}/callback`, (c) =>
      handleProviderCallback(c, options.kit.store, provider, options.storage),
    );
  }
}

async function handleRegister(c: Context, store: OAuthStore): Promise<Response> {
  const body = await c.req
    .json<{ redirect_uris?: string[]; client_name?: string; token_endpoint_auth_method?: string }>()
    .catch(() => null);

  if (!body || !Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    return c.json({ error: "invalid_client_metadata", error_description: "redirect_uris is required" }, 400);
  }

  const clientId = `zc_${randomBytes(16).toString("hex")}`;
  const clientName = body.client_name?.slice(0, 200) || "MCP client";
  store.createClient({ clientId, clientName, redirectUris: body.redirect_uris, createdAt: Date.now() });

  return c.json(
    {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: body.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

function handleAuthorizeGet(c: Context, store: OAuthStore): Response {
  const url = new URL(c.req.url);
  const p = readAuthorizeParams(url.searchParams);
  const err = validateAuthorize(store, p);
  if (err) return c.html(errorPage(err), 400);
  const client = store.getClient(p.clientId)!;
  return c.html(consentPage({ clientName: client.clientName, params: p, error: null }));
}

async function handleAuthorizeDecision(c: Context, store: OAuthStore, tenants: TenantTokenStore): Promise<Response> {
  const form = await c.req.formData();
  const p = readAuthorizeParams(formParams(form));
  const decision = String(form.get("decision") ?? "");
  const token = String(form.get("token") ?? "").trim();

  const err = validateAuthorize(store, p);
  if (err) return c.html(errorPage(err), 400);
  const client = store.getClient(p.clientId)!;

  const record = token ? await tenants.resolveTokenHash(hashToken(token)) : null;
  if (!record || !tenantRecordActive(record)) {
    return c.html(consentPage({ clientName: client.clientName, params: p, error: "That tenant token did not match." }), 401);
  }

  const baseUrl = publicBaseUrl(c);
  if (decision !== "approve") {
    return c.redirect(redirectWith(p.redirectUri, { error: "access_denied", state: p.state, iss: baseUrl }));
  }

  const code = opaqueToken();
  store.createCode({
    code,
    clientId: p.clientId,
    redirectUri: p.redirectUri,
    codeChallenge: p.codeChallenge,
    resource: p.resource || canonicalResource(baseUrl),
    scope: p.scope,
    tenant: record.tenant,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return c.redirect(redirectWith(p.redirectUri, { code, state: p.state, iss: baseUrl }));
}

async function handleToken(c: Context, store: OAuthStore): Promise<Response> {
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: "invalid_request" }, 400);
  const grantType = String(form.get("grant_type") ?? "");

  if (grantType === "authorization_code") {
    const code = String(form.get("code") ?? "");
    const verifier = String(form.get("code_verifier") ?? "");
    const redirectUri = String(form.get("redirect_uri") ?? "");
    const authCode = store.consumeCode(code);
    if (!authCode) return c.json({ error: "invalid_grant", error_description: "code invalid or expired" }, 400);
    if (authCode.redirectUri !== redirectUri) {
      return c.json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400);
    }
    if (!verifier || !pkceMatches(verifier, authCode.codeChallenge)) {
      return c.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
    }
    const client = store.getClient(authCode.clientId);
    const access = opaqueToken();
    const refresh = opaqueToken();
    const expiresAt = Date.now() + ACCESS_TTL_MS;
    store.createToken({
      accessToken: access,
      refreshToken: refresh,
      clientId: authCode.clientId,
      clientName: client?.clientName ?? "MCP client",
      resource: authCode.resource,
      scope: authCode.scope,
      tenant: authCode.tenant,
      expiresAt,
      createdAt: Date.now(),
    });
    return tokenResponse(c, access, refresh, authCode.scope);
  }

  if (grantType === "refresh_token") {
    const refresh = String(form.get("refresh_token") ?? "");
    const existing = store.getByRefreshToken(refresh);
    if (!existing) return c.json({ error: "invalid_grant", error_description: "unknown refresh_token" }, 400);
    const access = opaqueToken();
    const expiresAt = Date.now() + ACCESS_TTL_MS;
    store.rotateAccessToken(refresh, access, expiresAt);
    return tokenResponse(c, access, refresh, existing.scope);
  }

  return c.json({ error: "unsupported_grant_type" }, 400);
}

function handleProviderStart(c: Context, store: OAuthStore, provider: OAuthProvider): Response {
  const tenant = c.get("tenant") as TenantContext | null;
  if (!tenant) return c.json({ error: "tenant required" }, 401);

  const baseUrl = publicBaseUrl(c);
  const redirectUri = providerCallbackUrl(baseUrl, provider.id, tenant.id);
  const state = opaqueToken();
  store.createProviderState({
    state,
    providerId: provider.id,
    tenantId: tenant.id,
    redirectUri,
    expiresAt: Date.now() + STATE_TTL_MS,
  });

  const url = new URL(
    typeof provider.authorizationUrl === "function"
      ? provider.authorizationUrl({ baseUrl, provider })
      : provider.authorizationUrl,
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  if (provider.scopes?.length) url.searchParams.set("scope", provider.scopes.join(" "));
  for (const [key, value] of Object.entries(provider.authorizationParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return c.redirect(url.toString());
}

async function handleProviderCallback(
  c: Context,
  store: OAuthStore,
  provider: OAuthProvider,
  storage: ChassisStorage,
): Promise<Response> {
  const url = new URL(c.req.url);
  const error = url.searchParams.get("error");
  if (error) return c.json({ error: "oauth_provider_error", error_description: error }, 400);

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const tenantId = url.searchParams.get("tenant_id") ?? "";
  const entry = state ? store.consumeProviderState(state) : null;
  if (!code || !entry || entry.providerId !== provider.id) return c.json({ error: "invalid_oauth_state" }, 400);
  if (tenantId !== entry.tenantId) return c.json({ error: "tenant_state_mismatch" }, 400);

  const tokens = await provider.exchangeCode({
    code,
    redirectUri: entry.redirectUri,
    tenant: { id: entry.tenantId },
    provider,
  });
  const vault = storage.forTenant({ id: entry.tenantId }).vault();
  try {
    vault.set(provider.vaultKey ?? `${OAUTH_VAULT_PREFIX}${provider.id}`, JSON.stringify({
      providerId: provider.id,
      tenantId: entry.tenantId,
      tokens,
      storedAt: new Date().toISOString(),
    }));
  } finally {
    vault.close();
  }

  return c.json({ ok: true, provider: provider.id, tenant: { id: entry.tenantId } });
}

interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  scope: string;
}

function readAuthorizeParams(src: URLSearchParams): AuthorizeParams {
  return {
    clientId: src.get("client_id") ?? "",
    redirectUri: src.get("redirect_uri") ?? "",
    state: src.get("state") ?? "",
    codeChallenge: src.get("code_challenge") ?? "",
    codeChallengeMethod: src.get("code_challenge_method") ?? "",
    resource: src.get("resource") ?? "",
    scope: src.get("scope") ?? MCP_SCOPE,
  };
}

function validateAuthorize(store: OAuthStore, p: AuthorizeParams): string | null {
  if (!p.clientId || !p.redirectUri || !p.codeChallenge) return "missing required parameters";
  if (p.codeChallengeMethod !== "S256") return "code_challenge_method must be S256";
  const client = store.getClient(p.clientId);
  if (!client) return "unknown client_id";
  if (!client.redirectUris.includes(p.redirectUri)) return "redirect_uri not registered for this client";
  return null;
}

function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

function tokenResponse(c: Context, access: string, refresh: string, scope: string): Response {
  return c.json({
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refresh,
    scope,
  });
}

function canonicalResource(baseUrl: string): string {
  return `${baseUrl}/mcp`;
}

function providerCallbackUrl(baseUrl: string, providerId: string, tenantId: string): string {
  const url = new URL(`/api/oauth/providers/${providerId}/callback`, baseUrl);
  url.searchParams.set("tenant_id", tenantId);
  return url.toString();
}

function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function formParams(form: FormData): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params.set(key, value);
  }
  return params;
}

function redirectWith(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return url.toString();
}

function cloneOAuthToken(token: OAuthServerToken): OAuthServerToken {
  return { ...token, tenant: { ...token.tenant } };
}

function tenantRecordActive(record: { status?: string; expiresAt?: Date | string | number | null }): boolean {
  if ((record.status ?? "active") !== "active") return false;
  if (record.expiresAt === null || record.expiresAt === undefined) return true;
  const expiresAt = record.expiresAt instanceof Date ? record.expiresAt.getTime() : new Date(record.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

function hidden(params: AuthorizeParams): string {
  const fields: Array<[string, string]> = [
    ["client_id", params.clientId],
    ["redirect_uri", params.redirectUri],
    ["state", params.state],
    ["code_challenge", params.codeChallenge],
    ["code_challenge_method", params.codeChallengeMethod],
    ["resource", params.resource],
    ["scope", params.scope],
  ];
  return fields.map(([key, value]) => `<input type="hidden" name="${key}" value="${esc(value)}">`).join("");
}

function shell(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize MCP Client</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#fafafa;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}
.card{width:min(92vw,420px);background:#141414;border:1px solid #262626;border-radius:8px;padding:28px}
h1{font-size:20px;margin:0 0 4px}p{color:#a3a3a3;margin:0 0 20px}label{display:block;font-size:13px;color:#d4d4d4;margin:0 0 6px}
input[type=password]{width:100%;box-sizing:border-box;padding:10px 12px;background:#0a0a0a;border:1px solid #303030;border-radius:8px;color:#fafafa;margin:0 0 16px;font:inherit}
.row{display:flex;gap:10px;margin-top:8px}button{flex:1;padding:10px 14px;border-radius:8px;border:1px solid #303030;font:inherit;font-weight:500;cursor:pointer}
.approve{background:#fafafa;color:#0a0a0a;border-color:#fafafa}.deny{background:transparent;color:#d4d4d4}.err{color:#f87171;font-size:13px;margin:0 0 14px}.client{color:#fafafa;font-weight:600}
</style></head><body><div class="card">${body}</div></body></html>`;
}

function consentPage(opts: { clientName: string; params: AuthorizeParams; error: string | null }): string {
  return shell(`
<h1>Authorize MCP Client</h1>
<p><span class="client">${esc(opts.clientName)}</span> wants to connect to this tenant's MCP endpoint.</p>
${opts.error ? `<p class="err">${esc(opts.error)}</p>` : ""}
<form method="post" action="/oauth/authorize/decision">
  ${hidden(opts.params)}
  <label for="token">Tenant token</label>
  <input id="token" type="password" name="token" autofocus autocomplete="off" placeholder="paste tenant token">
  <div class="row">
    <button class="deny" type="submit" name="decision" value="deny">Deny</button>
    <button class="approve" type="submit" name="decision" value="approve">Connect</button>
  </div>
</form>`);
}

function errorPage(message: string): string {
  return shell(`<h1>Authorize MCP Client</h1><p class="err">${esc(message)}</p>`);
}
