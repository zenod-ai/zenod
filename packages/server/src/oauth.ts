import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { issueSession, hasValidSession } from "./auth.js";
import type { OAuthStore } from "./oauthStore.js";
import type { Settings } from "./settings.js";

const ACCESS_TTL_MS = 60 * 60 * 1000; // 1h
const CODE_TTL_MS = 10 * 60 * 1000; // 10m
const SCOPE = "mcp";

function token(): string {
  return randomBytes(32).toString("base64url");
}

/** Public origin as seen through the reverse proxy (no trailing slash). */
export function publicBaseUrl(c: Context): string {
  const proto = c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? new URL(c.req.url).host;
  return `${proto}://${host}`;
}

function canonicalResource(baseUrl: string): string {
  return `${baseUrl}/mcp`;
}

/** RFC 9728 Protected Resource Metadata. */
export function protectedResourceMetadata(baseUrl: string): Record<string, unknown> {
  return {
    resource: canonicalResource(baseUrl),
    authorization_servers: [baseUrl],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
  };
}

/** RFC 8414 Authorization Server Metadata. */
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
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
  };
}

/** The WWW-Authenticate challenge pointing at our resource metadata. */
export function wwwAuthenticate(baseUrl: string): string {
  return `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", scope="${SCOPE}"`;
}

/** Validate an OAuth access token for MCP requests. Returns the client name, or null. */
export function validateAccessToken(store: OAuthStore, accessToken: string): string | null {
  const tok = store.getByAccessToken(accessToken);
  if (!tok || tok.expiresAt < Date.now()) return null;
  return tok.clientName;
}

function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Dynamic Client Registration (RFC 7591) ---

export async function handleRegister(c: Context, store: OAuthStore): Promise<Response> {
  const body = await c.req.json<{
    redirect_uris?: string[];
    client_name?: string;
    token_endpoint_auth_method?: string;
  }>().catch(() => null);

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

// --- Authorization endpoint ---

interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  scope: string;
}

function readParams(src: URLSearchParams): AuthorizeParams {
  return {
    clientId: src.get("client_id") ?? "",
    redirectUri: src.get("redirect_uri") ?? "",
    state: src.get("state") ?? "",
    codeChallenge: src.get("code_challenge") ?? "",
    codeChallengeMethod: src.get("code_challenge_method") ?? "",
    resource: src.get("resource") ?? "",
    scope: src.get("scope") ?? SCOPE,
  };
}

/** Validate the client + redirect_uri + PKCE method. Returns an error string or null. */
function validateAuthorize(store: OAuthStore, p: AuthorizeParams): string | null {
  if (!p.clientId || !p.redirectUri || !p.codeChallenge) return "missing required parameters";
  if (p.codeChallengeMethod !== "S256") return "code_challenge_method must be S256";
  const client = store.getClient(p.clientId);
  if (!client) return "unknown client_id";
  if (!client.redirectUris.includes(p.redirectUri)) return "redirect_uri not registered for this client";
  return null;
}

/** GET /oauth/authorize — render the consent (and login, if needed) page. */
export function handleAuthorizeGet(c: Context, store: OAuthStore, settings: Settings): Response {
  const url = new URL(c.req.url);
  const p = readParams(url.searchParams);
  const err = validateAuthorize(store, p);
  if (err) return c.html(errorPage(err), 400);

  const client = store.getClient(p.clientId)!;
  const authed = hasValidSession(c, settings);
  return c.html(consentPage({ clientName: client.clientName, params: p, authed, error: null }));
}

/** POST /oauth/authorize/decision — handle login + approve/deny. */
export async function handleAuthorizeDecision(c: Context, store: OAuthStore, settings: Settings): Promise<Response> {
  const form = await c.req.formData();
  const p: AuthorizeParams = {
    clientId: String(form.get("client_id") ?? ""),
    redirectUri: String(form.get("redirect_uri") ?? ""),
    state: String(form.get("state") ?? ""),
    codeChallenge: String(form.get("code_challenge") ?? ""),
    codeChallengeMethod: String(form.get("code_challenge_method") ?? ""),
    resource: String(form.get("resource") ?? ""),
    scope: String(form.get("scope") ?? SCOPE),
  };
  const decision = String(form.get("decision") ?? "");
  const password = form.get("password");

  const err = validateAuthorize(store, p);
  if (err) return c.html(errorPage(err), 400);
  const client = store.getClient(p.clientId)!;

  // Authenticate with the user's token (or an admin password, if set) when there's
  // no session. The token is the bearer they already hold in their console.
  if (!hasValidSession(c, settings)) {
    if (typeof password === "string" && settings.verifyConsoleCredential(password.trim())) {
      issueSession(c, settings);
    } else {
      return c.html(
        consentPage({
          clientName: client.clientName,
          params: p,
          authed: false,
          error: "That token didn't match — copy it from your Zenod console.",
        }),
        401,
      );
    }
  }

  const baseUrl = publicBaseUrl(c);
  if (decision !== "approve") {
    return c.redirect(redirectWith(p.redirectUri, { error: "access_denied", state: p.state, iss: baseUrl }));
  }

  const code = token();
  store.createCode({
    code,
    clientId: p.clientId,
    redirectUri: p.redirectUri,
    codeChallenge: p.codeChallenge,
    resource: p.resource || canonicalResource(baseUrl),
    scope: p.scope,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return c.redirect(redirectWith(p.redirectUri, { code, state: p.state, iss: baseUrl }));
}

// --- Token endpoint ---

export async function handleToken(c: Context, store: OAuthStore): Promise<Response> {
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
    const access = token();
    const refresh = token();
    const expiresAt = Date.now() + ACCESS_TTL_MS;
    store.createToken({
      accessToken: access,
      refreshToken: refresh,
      clientId: authCode.clientId,
      clientName: client?.clientName ?? "MCP client",
      resource: authCode.resource,
      scope: authCode.scope,
      expiresAt,
      createdAt: Date.now(),
    });
    return tokenResponse(c, access, refresh, authCode.scope);
  }

  if (grantType === "refresh_token") {
    const refresh = String(form.get("refresh_token") ?? "");
    const existing = store.getByRefreshToken(refresh);
    if (!existing) return c.json({ error: "invalid_grant", error_description: "unknown refresh_token" }, 400);
    const access = token();
    const expiresAt = Date.now() + ACCESS_TTL_MS;
    store.rotateAccessToken(refresh, access, expiresAt);
    return tokenResponse(c, access, refresh, existing.scope);
  }

  return c.json({ error: "unsupported_grant_type" }, 400);
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

// --- helpers ---

function redirectWith(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return url.toString();
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
  return fields.map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("");
}

function shell(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zenod — Authorize</title><style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#fafafa;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}
.card{width:min(92vw,420px);background:#141414;border:1px solid #262626;border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 4px}p{color:#a3a3a3;margin:0 0 20px}
label{display:block;font-size:13px;color:#d4d4d4;margin:0 0 6px}
input[type=password]{width:100%;box-sizing:border-box;padding:10px 12px;background:#0a0a0a;border:1px solid #303030;border-radius:9px;color:#fafafa;margin:0 0 16px;font:inherit}
.row{display:flex;gap:10px;margin-top:8px}
button{flex:1;padding:10px 14px;border-radius:9px;border:1px solid #303030;font:inherit;font-weight:500;cursor:pointer}
.approve{background:#fafafa;color:#0a0a0a;border-color:#fafafa}
.deny{background:transparent;color:#d4d4d4}
.err{color:#f87171;font-size:13px;margin:0 0 14px}
.hint{color:#a3a3a3;font-size:12px;margin:-8px 0 16px;line-height:1.5}
.brand{font-weight:600;letter-spacing:-.01em}
.client{color:#fafafa;font-weight:600}
</style></head><body><div class="card">${body}</div></body></html>`;
}

function consentPage(opts: {
  clientName: string;
  params: AuthorizeParams;
  authed: boolean;
  error: string | null;
}): string {
  const { clientName, params, authed, error } = opts;
  return shell(`
<h1><span class="brand">Zenod</span></h1>
<p><span class="client">${esc(clientName)}</span> wants to connect to your memory vault — read and store memories on your behalf.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" action="/oauth/authorize/decision">
  ${hidden(params)}
  ${
    authed
      ? ""
      : `<label for="pw">Your Zenod token</label><input id="pw" type="password" name="password" autofocus autocomplete="off" placeholder="paste your token">
         <p class="hint">Paste the token from your Zenod console — the same bearer you use to connect. It authenticates you; no separate password.</p>`
  }
  <div class="row">
    <button class="deny" type="submit" name="decision" value="deny">Deny</button>
    <button class="approve" type="submit" name="decision" value="approve">${authed ? "Approve" : "Connect"}</button>
  </div>
</form>`);
}

function errorPage(message: string): string {
  return shell(`<h1><span class="brand">Zenod</span></h1><p class="err">${esc(message)}</p>`);
}
