import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { bodyLimit } from "hono/body-limit";
import type { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import type { HttpBindings } from "@hono/node-server";
import type { Context, Hono } from "hono";

import type { Runtime } from "./runtime.js";
import { apiError, subscribersDisabled } from "./subscriberRoutes.js";
import {
  FORWARD_SCOPE,
  hashSubscriberToken,
  SUBSCRIBER_EVENT,
  SUBSCRIBER_SCOPES,
  SUBSCRIBER_TOKEN_PREFIX,
  SubscriberUrlError,
  subscriberUrlPolicyFromEnv,
  subscriptionJson,
  deliveryJson,
  TEST_NOTE_ID,
  validateSubscriberUrl,
  type AddressLookup,
  type GrantScope,
  type SubscriberGrant,
} from "./subscribers.js";
import { createVoiceNoteForwardServer, FORWARD_MAX_BODY_BYTES } from "./voiceNoteForward.js";
import { openZenodSqlite } from "./sqlite.js";
import { mergeMemoryEntries } from "./memoryEntryCatalog.js";
import type { MemoryEntry } from "zenod";

/**
 * Sign in with Zenod and the subscriber API (agent_team E42-S22; contract: agent_team docs/status/e42-s22-contract.md).
 *
 * A narrow OAuth grant, separate from MCP: scope `voice_notes.read voice_notes.subscribe`, an opaque `zvn_` bearer kept
 * only as a hash, valid until revoked, accepted only on /api/subscribers/v1/*. It reuses Zenod's registered OAuth clients
 * (RFC 7591) and the hosted sign-in, but its codes (`zvc_`) and tokens never enter the MCP OAuth store, so a voice-note
 * grant can never call /mcp. Grants live per tenant (subscribers.sqlite); this module keeps only a host-level index
 * (token hash -> tenant) and the short-lived codes, in `subscriber-index.sqlite`.
 *
 * EPIC-21 V1 adds a second grant an app can ask for, `voice_notes.write`: forward its own voice notes into Zenod through
 * one narrow MCP server at /api/subscribers/v1/mcp (ingest_voice_note), and nothing else (contract:
 * docs/voice-note-forwarding.md). An app may ask for it alone or together with the subscriber scopes.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_PREFIX = "zvc_";
const API_PREFIX = "/api/subscribers/v1";
const DECISION_PATH = "/oauth/subscribers/decision";
const RATE_PER_MINUTE = 60;
const TESTS_PER_MINUTE = 10;

export interface SubscriberApiClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

export interface SubscriberIdentity {
  userId: string;
  name: string | null;
  email: string | null;
  provider: string | null;
  tenantId: string;
}

export interface SubscriberApiHost {
  enabled: () => boolean;
  /** A registered OAuth client (Zenod's shared dynamic client registration). */
  getClient(clientId: string): SubscriberApiClient | null;
  /** The signed-in customer and their active workspace; a Response to return as is (e.g. no active workspace); null = signed out. */
  identity(c: Context): SubscriberIdentity | Response | null;
  signInUrl(returnTo: string): string;
  /** The tenant's runtime when its account may still use Zenod; null otherwise. */
  runtimeForTenant(tenantId: string): Runtime | null;
  dataDir: string;
  /** Where the private-origin exception is read (default process.env). */
  env?: NodeJS.ProcessEnv;
  lookup?: AddressLookup;
  /** How the forwarding door fetches an audioUrl (tests). */
  fetch?: typeof fetch;
  now?: () => number;
}

interface PendingConsent {
  userId: string;
  tenantId: string;
  request: string;
  expiresAt: number;
}

interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  kind: string;
  product: string;
}

export class SubscriberIndex {
  private readonly db: DatabaseSync;

  constructor(dataDir: string, private readonly now: () => number = Date.now) {
    this.db = openZenodSqlite(join(dataDir, "subscriber-index.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriber_codes (
        code_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        scope TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        account_name TEXT,
        account_email TEXT,
        kind TEXT,
        product TEXT,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS subscriber_tokens (
        token_hash TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        grant_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  createCode(input: Omit<StoredCode, "expiresAt">): string {
    const code = `${CODE_PREFIX}${randomBytes(32).toString("base64url")}`;
    this.db.prepare("DELETE FROM subscriber_codes WHERE expires_at < ?").run(this.now());
    this.db
      .prepare(`INSERT INTO subscriber_codes (code_hash, client_id, redirect_uri, code_challenge, scope, tenant_id, account_name, account_email, kind, product, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(hashSubscriberToken(code), input.clientId, input.redirectUri, input.codeChallenge, input.scope, input.tenantId,
        input.accountName, input.accountEmail, input.kind, input.product, this.now() + CODE_TTL_MS);
    return code;
  }

  /** Single use: the code is deleted whether or not it is still valid. */
  consumeCode(code: string): StoredCode | null {
    const hash = hashSubscriberToken(code);
    const row = this.db.prepare("SELECT * FROM subscriber_codes WHERE code_hash = ?").get(hash) as Record<string, string | number | null> | undefined;
    this.db.prepare("DELETE FROM subscriber_codes WHERE code_hash = ?").run(hash);
    if (!row || Number(row.expires_at) < this.now()) return null;
    return {
      clientId: String(row.client_id),
      redirectUri: String(row.redirect_uri),
      codeChallenge: String(row.code_challenge),
      scope: String(row.scope),
      tenantId: String(row.tenant_id),
      accountName: row.account_name === null ? null : String(row.account_name),
      accountEmail: row.account_email === null ? null : String(row.account_email),
      kind: row.kind === null ? null : String(row.kind),
      product: row.product === null ? null : String(row.product),
      expiresAt: Number(row.expires_at),
    };
  }

  putToken(tokenHash: string, tenantId: string, grantId: string): void {
    this.db.prepare("INSERT OR REPLACE INTO subscriber_tokens (token_hash, tenant_id, grant_id, created_at) VALUES (?, ?, ?, ?)")
      .run(tokenHash, tenantId, grantId, this.now());
  }

  tenantForToken(tokenHash: string): { tenantId: string; grantId: string } | null {
    const row = this.db.prepare("SELECT tenant_id, grant_id FROM subscriber_tokens WHERE token_hash = ?").get(tokenHash) as { tenant_id: string; grant_id: string } | undefined;
    return row ? { tenantId: row.tenant_id, grantId: row.grant_id } : null;
  }

  dropToken(tokenHash: string): void {
    this.db.prepare("DELETE FROM subscriber_tokens WHERE token_hash = ?").run(tokenHash);
  }

  close(): void {
    this.db.close();
  }
}

interface StoredCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  tenantId: string;
  accountName: string | null;
  accountEmail: string | null;
  kind: string | null;
  product: string | null;
  expiresAt: number;
}

/** True when an /oauth/authorize request asks for the voice-note grant (and so belongs to this module). */
export function isSubscriberAuthorize(scopeParam: string | null | undefined): boolean {
  return Boolean(scopeParam && scopeParam.split(/\s+/).some((scope) => scope.startsWith("voice_notes.")));
}

/**
 * The grant's scope when the request asks for one Zenod offers: the subscriber pair, `voice_notes.write` alone, or all
 * three; null otherwise (unknown scopes, or only half of the subscriber pair).
 */
export function grantScope(scopeParam: string): string | null {
  const scopes = new Set(scopeParam.split(/\s+/).filter(Boolean));
  const subscribe = SUBSCRIBER_SCOPES.every((scope) => scopes.has(scope));
  const write = scopes.has(FORWARD_SCOPE);
  const known = (subscribe ? SUBSCRIBER_SCOPES.length : 0) + (write ? 1 : 0);
  if (known === 0 || known !== scopes.size) return null;
  return [...(subscribe ? SUBSCRIBER_SCOPES : []), ...(write ? [FORWARD_SCOPE] : [])].join(" ");
}

function scopeIsExact(scopeParam: string): boolean {
  return grantScope(scopeParam) !== null;
}

function readParams(src: URLSearchParams): AuthorizeParams {
  return {
    clientId: src.get("client_id") ?? "",
    redirectUri: src.get("redirect_uri") ?? "",
    state: src.get("state") ?? "",
    codeChallenge: src.get("code_challenge") ?? "",
    codeChallengeMethod: src.get("code_challenge_method") ?? "",
    scope: src.get("scope") ?? "",
    kind: (src.get("subscriber_kind") ?? "").slice(0, 40),
    product: (src.get("subscriber_product") ?? "").slice(0, 60),
  };
}

function validRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch {
    return false;
  }
}

function redirectWith(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return url.toString();
}

function publicBaseUrl(c: Context): string {
  const proto = c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? new URL(c.req.url).host;
  return `${proto}://${host}`;
}

function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function initials(name: string): string {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("");
  return letters || "?";
}

function kindLabel(kind: string, product: string): string {
  const what = kind === "agent_team" ? "an agent team" : "an app";
  return product ? `${what} on ${product}` : what;
}

const PAGE_STYLE = `
:root{color-scheme:light}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;background:#fafafa;color:#111;font:15px/1.5 "Geist Variable",ui-sans-serif,system-ui,-apple-system,sans-serif;padding:48px 16px}
.card{width:min(100%,480px);background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:28px}
.marks{display:flex;align-items:center;gap:10px;margin-bottom:18px}.z{width:40px;height:40px;display:grid;place-items:center;background:#f3efe6;border:1px solid #e7e1d3;border-radius:6px;font:700 26px/1 Georgia,serif}
.dots{color:#a3a3a3;letter-spacing:3px}.app{width:40px;height:40px;display:grid;place-items:center;background:#171717;color:#fff;border-radius:8px;font-weight:600;font-size:14px}
h1{font-size:21px;line-height:1.3;margin:0 0 4px}.sub{color:#737373;font-size:13px;margin:0 0 18px}
.who{display:flex;justify-content:space-between;align-items:center;gap:12px;border:1px solid #e5e5e5;border-radius:8px;padding:10px 12px;margin-bottom:18px;font-size:13px}.who small{display:block;color:#737373;font-size:13px}.who a{color:#111;font-size:13px}
h2{font-size:14px;margin:0 0 6px}ul{margin:0 0 16px;padding-left:18px}li{margin:2px 0}.not li{color:#737373}
.note{color:#737373;font-size:13px;margin:0 0 18px}.row{display:flex;justify-content:flex-end;gap:8px}
button{font:inherit;font-size:14px;padding:7px 12px;border-radius:7px;border:1px solid #e5e5e5;background:#fff;color:#111;cursor:pointer}button.allow{background:#111;color:#fff;border-color:#111}
.meta{color:#737373;font-size:12px;margin:22px 0 0;word-break:break-word}.err{color:#b91c1c}`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PAGE_STYLE}</style></head><body><main class="card">${body}</main></body></html>`;
}

function errorPage(message: string): string {
  return shell("Zenod", `<h1>Zenod</h1><p class="err">${esc(message)}</p>`);
}

function consentPage(input: {
  client: SubscriberApiClient;
  params: AuthorizeParams;
  identity: SubscriberIdentity;
  nonce: string;
  baseUrl: string;
  notYouHref: string;
}): string {
  const { client, params, identity } = input;
  const redirectHost = new URL(params.redirectUri).host;
  const hidden = (Object.entries({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: params.codeChallengeMethod,
    scope: params.scope,
    subscriber_kind: params.kind,
    subscriber_product: params.product,
    consent: input.nonce,
  }) as Array<[string, string]>).map(([key, value]) => `<input type="hidden" name="${key}" value="${esc(value)}">`).join("");
  const provider = identity.provider === "google" ? "Google" : identity.provider === "github" ? "GitHub" : null;
  const scope = grantScope(params.scope) ?? SUBSCRIBER_SCOPES.join(" ");
  const subscribe = scope.includes("voice_notes.subscribe");
  const write = scope.includes(FORWARD_SCOPE);
  const headline = subscribe && write
    ? `${client.clientName} wants to send you its voice notes and receive yours`
    : write ? `${client.clientName} wants to send its voice notes to your Zenod` : `${client.clientName} wants to receive your voice notes`;
  const gets = [
    ...(write ? ["Adding voice notes you record in it to your Zenod, tagged with its name"] : []),
    ...(subscribe ? ["A signal each time a new voice note lands in your Zenod", "Read access to those notes only: the words, the time, the length"] : []),
  ];
  const getsNot = [
    write && !subscribe ? "Reading anything in your Zenod" : "Your other memories, files, or notes from before today",
    write ? "Any right to change or delete in your Zenod" : "Any right to write, change or delete in your Zenod",
  ];
  return shell(headline, `
<div class="marks" aria-hidden="true"><span class="z">Z</span><span class="dots">···</span><span class="app">${esc(initials(client.clientName))}</span></div>
<h1>${esc(headline)}</h1>
<p class="sub">${esc(redirectHost)} · ${esc(kindLabel(params.kind, params.product))}</p>
<div class="who"><div>${esc(identity.name ?? identity.email ?? "Your Zenod account")}<small>${esc([identity.email, provider ? `signed in with ${provider}` : null].filter(Boolean).join(" · "))}</small></div><a href="${esc(input.notYouHref)}">Not you?</a></div>
<h2>It will get</h2>
<ul>${gets.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
<h2>It will not get</h2>
<ul class="not">${getsNot.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
<p class="note">It shows up in Zenod under <strong>Subscribers</strong>, where you can pause or remove it any time.</p>
<form method="post" action="${DECISION_PATH}">${hidden}
<div class="row"><button type="submit" name="decision" value="deny">Cancel</button><button class="allow" type="submit" name="decision" value="approve">Allow</button></div>
</form>
<p class="meta">${esc(new URL(input.baseUrl).host)}/oauth/authorize · scope: ${esc(scope)}</p>`);
}

class Limiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly perMinute: number, private readonly now: () => number) {}
  take(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - 60_000);
    if (recent.length >= this.perMinute) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.delete(this.hits.keys().next().value!);
    return true;
  }
}

export function grantJson(grant: SubscriberGrant): Record<string, unknown> {
  return { grant_id: grant.id, scope: grant.scope, account: grant.account, created_at: grant.createdAt };
}

export function mountSubscriberApi(app: Hono<{ Bindings: HttpBindings }>, host: SubscriberApiHost): { index: () => SubscriberIndex | null; close: () => void } {
  const now = host.now ?? Date.now;
  const pending = new Map<string, PendingConsent>();
  const calls = new Limiter(RATE_PER_MINUTE, now);
  const tests = new Limiter(TESTS_PER_MINUTE, now);
  // kind/product chosen at consent, applied when the grant creates its subscription (in memory; the create body may also set them)
  const pendingLabels = new Map<string, { kind: string | null; product: string | null }>();
  let index: SubscriberIndex | null = null;
  // Opened on first use, and only while switched on, so a Zenod with Subscribers off never creates the table.
  const getIndex = (): SubscriberIndex => (index ??= new SubscriberIndex(host.dataDir, now));

  const authorizeError = (p: AuthorizeParams): string | null => {
    if (!p.clientId || !p.redirectUri || !p.codeChallenge) return "missing required parameters";
    if (p.codeChallengeMethod !== "S256") return "code_challenge_method must be S256";
    const client = host.getClient(p.clientId);
    if (!client) return "unknown client_id";
    if (!client.redirectUris.includes(p.redirectUri) || !validRedirectUri(p.redirectUri)) return "redirect_uri not registered for this client";
    return null;
  };

  // --- consent ---

  app.get("/oauth/authorize", async (c, next) => {
    if (!isSubscriberAuthorize(c.req.query("scope"))) return next();
    if (!host.enabled()) return c.html(errorPage("Subscribers are not switched on for this Zenod."), 503);
    const url = new URL(c.req.url);
    const p = readParams(url.searchParams);
    const err = authorizeError(p);
    if (err) return c.html(errorPage(err), 400);
    if (!scopeIsExact(p.scope)) {
      return c.redirect(redirectWith(p.redirectUri, { error: "invalid_scope", state: p.state, iss: publicBaseUrl(c) }));
    }
    const identity = host.identity(c);
    if (identity instanceof Response) return identity;
    const returnTo = `${url.pathname}${url.search}`;
    if (!identity) return c.redirect(host.signInUrl(returnTo));
    for (const [key, value] of pending) if (value.expiresAt <= now()) pending.delete(key);
    if (pending.size >= 1000) pending.delete(pending.keys().next().value!);
    const nonce = randomBytes(24).toString("base64url");
    pending.set(nonce, { userId: identity.userId, tenantId: identity.tenantId, request: `${publicBaseUrl(c)}:${JSON.stringify(p)}`, expiresAt: now() + CODE_TTL_MS });
    c.header("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(p.redirectUri).origin}; base-uri 'none'; frame-ancestors 'none'`);
    c.header("Cache-Control", "no-store");
    return c.html(consentPage({ client: host.getClient(p.clientId)!, params: p, identity, nonce, baseUrl: publicBaseUrl(c), notYouHref: host.signInUrl(returnTo) }));
  });

  app.post(DECISION_PATH, async (c) => {
    if (!host.enabled()) return c.html(errorPage("Subscribers are not switched on for this Zenod."), 503);
    const form = await c.req.formData().catch(() => null);
    if (!form) return c.html(errorPage("Invalid form. Start again from the app you are connecting."), 400);
    const src = new URLSearchParams();
    for (const [key, value] of form.entries()) if (typeof value === "string") src.set(key, value);
    const p = readParams(src);
    const err = authorizeError(p);
    if (err) return c.html(errorPage(err), 400);
    if (!scopeIsExact(p.scope)) return c.redirect(redirectWith(p.redirectUri, { error: "invalid_scope", state: p.state, iss: publicBaseUrl(c) }));
    const identity = host.identity(c);
    if (identity instanceof Response) return identity;
    if (!identity) return c.html(errorPage("Your sign-in expired. Start again from the app you are connecting."), 401);
    const nonce = src.get("consent") ?? "";
    const consent = pending.get(nonce);
    const origin = c.req.header("origin");
    if (
      !consent || consent.expiresAt <= now() || consent.userId !== identity.userId || consent.tenantId !== identity.tenantId ||
      consent.request !== `${publicBaseUrl(c)}:${JSON.stringify(p)}` || (origin && origin !== publicBaseUrl(c))
    ) return c.html(errorPage("This form is invalid or expired. Start again from the app you are connecting."), 403);
    pending.delete(nonce);
    const iss = publicBaseUrl(c);
    if (src.get("decision") !== "approve") return c.redirect(redirectWith(p.redirectUri, { error: "access_denied", state: p.state, iss }));
    const code = getIndex().createCode({
      clientId: p.clientId,
      redirectUri: p.redirectUri,
      codeChallenge: p.codeChallenge,
      scope: grantScope(p.scope)!,
      tenantId: identity.tenantId,
      accountName: identity.name,
      accountEmail: identity.email,
      kind: p.kind || null,
      product: p.product || null,
    });
    return c.redirect(redirectWith(p.redirectUri, { code, state: p.state, iss }));
  });

  // --- token and revoke (only for zvc_ codes and zvn_ tokens; everything else falls through to MCP OAuth) ---

  app.post("/oauth/token", async (c, next) => {
    const form = await c.req.raw.clone().formData().catch(() => null);
    const code = form ? String(form.get("code") ?? "") : "";
    if (!code.startsWith(CODE_PREFIX)) return next();
    if (!host.enabled()) return c.json({ error: "invalid_request", error_description: "subscribers are switched off" }, 503);
    c.header("Cache-Control", "no-store");
    if (String(form!.get("grant_type") ?? "") !== "authorization_code") return c.json({ error: "unsupported_grant_type" }, 400);
    const stored = getIndex().consumeCode(code);
    if (!stored) return c.json({ error: "invalid_grant", error_description: "code invalid or expired" }, 400);
    if (stored.redirectUri !== String(form!.get("redirect_uri") ?? "")) return c.json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400);
    const clientId = String(form!.get("client_id") ?? "");
    if (clientId && clientId !== stored.clientId) return c.json({ error: "invalid_client" }, 400);
    const verifier = String(form!.get("code_verifier") ?? "");
    if (!verifier || !pkceMatches(verifier, stored.codeChallenge)) return c.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
    const runtime = host.runtimeForTenant(stored.tenantId);
    if (!runtime?.subscribers) return c.json({ error: "invalid_grant", error_description: "workspace unavailable" }, 400);
    const client = host.getClient(stored.clientId);
    const { grant, token, tokenHash } = runtime.subscribers.createGrant({
      clientId: stored.clientId,
      clientName: client?.clientName ?? "App",
      scope: stored.scope,
      account: { name: stored.accountName, email: stored.accountEmail },
    });
    getIndex().putToken(tokenHash, stored.tenantId, grant.id);
    pendingLabels.set(grant.id, { kind: stored.kind, product: stored.product });
    return c.json({ access_token: token, token_type: "Bearer", scope: grant.scope, grant_id: grant.id, account: grant.account });
  });

  app.post("/oauth/revoke", async (c, next) => {
    const form = await c.req.raw.clone().formData().catch(() => null);
    const token = form ? String(form.get("token") ?? "") : "";
    if (!token.startsWith(SUBSCRIBER_TOKEN_PREFIX)) return next();
    if (!host.enabled()) return c.body(null, 200);
    const hash = hashSubscriberToken(token);
    const entry = getIndex().tenantForToken(hash);
    if (entry) {
      const runtime = host.runtimeForTenant(entry.tenantId);
      const store = runtime?.subscribers;
      if (store) {
        for (const sub of store.forGrant(entry.grantId)) runtime!.subscriberDispatcher?.cancel(sub.id);
        store.revokeGrant(entry.grantId);
      }
      getIndex().dropToken(hash);
    }
    return c.body(null, 200);
  });

  // --- the subscriber API ---

  type Authed = { runtime: Runtime; grant: SubscriberGrant; tenantId: string };
  const authenticate = (c: Context, scope: GrantScope | "any"): Authed | Response => {
    if (!host.enabled()) return subscribersDisabled(c);
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token.startsWith(SUBSCRIBER_TOKEN_PREFIX)) return apiError(c, 401, "invalid_token", "Send the zvn_ token from Sign in with Zenod.");
    const hash = hashSubscriberToken(token);
    const entry = getIndex().tenantForToken(hash);
    const runtime = entry ? host.runtimeForTenant(entry.tenantId) : null;
    const grant = runtime?.subscribers?.grantForTokenHash(hash) ?? null;
    if (!entry || !runtime || !grant || grant.id !== entry.grantId) return apiError(c, 401, "invalid_token", "This connection was removed or is not valid.");
    if (scope !== "any" && !grant.scope.split(/\s+/).includes(scope)) return apiError(c, 403, "insufficient_scope", `This call needs ${scope}.`);
    if (!calls.take(grant.id)) return apiError(c, 429, "rate_limited", "Too many calls; try again in a minute.");
    c.header("Cache-Control", "no-store");
    return { runtime, grant, tenantId: entry.tenantId };
  };

  app.get(`${API_PREFIX}/me`, (c) => {
    const auth = authenticate(c, "any");
    return auth instanceof Response ? auth : c.json(grantJson(auth.grant));
  });

  app.get(`${API_PREFIX}/subscriptions`, (c) => {
    const auth = authenticate(c, "voice_notes.subscribe");
    if (auth instanceof Response) return auth;
    const store = auth.runtime.subscribers!;
    return c.json({ subscriptions: store.forGrant(auth.grant.id).map((sub) => subscriptionJson(store.view(sub))) });
  });

  app.post(`${API_PREFIX}/subscriptions`, async (c) => {
    const auth = authenticate(c, "voice_notes.subscribe");
    if (auth instanceof Response) return auth;
    const store = auth.runtime.subscribers!;
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(c, 400, "invalid_request", "Send a JSON body.");
    if (body.event !== SUBSCRIBER_EVENT) return apiError(c, 400, "unsupported_event", `Only ${SUBSCRIBER_EVENT} is supported.`);
    for (const field of ["name", "kind", "product"] as const) {
      if (body[field] !== undefined && typeof body[field] !== "string") return apiError(c, 400, "invalid_request", `${field} must be a string.`);
    }
    if (body.kind !== undefined && body.kind !== "agent_team" && body.kind !== "webhook") return apiError(c, 400, "invalid_request", "kind must be agent_team or webhook.");
    const existing = store.forGrant(auth.grant.id)[0];
    if (existing) return apiError(c, 409, "subscription_exists", "This connection already has a subscription.", { subscription_id: existing.id });
    let url: URL;
    try {
      url = await validateSubscriberUrl(body.url, { tenantId: auth.tenantId, policy: subscriberUrlPolicyFromEnv(host.env), lookup: host.lookup });
    } catch (error) {
      if (error instanceof SubscriberUrlError) return apiError(c, 422, "url_not_allowed", error.message);
      throw error;
    }
    const labels = pendingLabels.get(auth.grant.id);
    pendingLabels.delete(auth.grant.id);
    const kind = (body.kind as string | undefined) ?? labels?.kind ?? "agent_team";
    const { subscription, signingSecret } = store.create({
      name: ((body.name as string | undefined)?.trim() || auth.grant.clientName),
      kind: kind === "webhook" ? "webhook" : "agent_team",
      product: (body.product as string | undefined) ?? labels?.product ?? null,
      url: url.toString(),
      event: SUBSCRIBER_EVENT,
      via: "oauth",
      grantId: auth.grant.id,
      createdBy: auth.grant.account,
    });
    return c.json({ subscription: subscriptionJson(store.view(subscription)), signing_secret: signingSecret }, 201);
  });

  const ownSubscription = (auth: Authed, id: string) => {
    const sub = auth.runtime.subscribers!.get(id);
    return sub && sub.grantId === auth.grant.id ? sub : null;
  };

  app.get(`${API_PREFIX}/subscriptions/:id`, (c) => {
    const auth = authenticate(c, "voice_notes.subscribe");
    if (auth instanceof Response) return auth;
    const sub = ownSubscription(auth, c.req.param("id"));
    if (!sub) return apiError(c, 404, "not_found", "No such subscription for this connection.");
    const store = auth.runtime.subscribers!;
    return c.json({ subscription: subscriptionJson(store.view(sub)), deliveries: store.deliveries(sub.id).map(deliveryJson) });
  });

  app.delete(`${API_PREFIX}/subscriptions/:id`, (c) => {
    const auth = authenticate(c, "voice_notes.subscribe");
    if (auth instanceof Response) return auth;
    const sub = ownSubscription(auth, c.req.param("id"));
    if (!sub) return apiError(c, 404, "not_found", "No such subscription for this connection.");
    auth.runtime.subscriberDispatcher?.cancel(sub.id);
    auth.runtime.subscribers!.delete(sub.id, { keepGrant: true });
    return c.body(null, 204);
  });

  app.post(`${API_PREFIX}/subscriptions/:id/test`, async (c) => {
    const auth = authenticate(c, "voice_notes.subscribe");
    if (auth instanceof Response) return auth;
    const sub = ownSubscription(auth, c.req.param("id"));
    if (!sub) return apiError(c, 404, "not_found", "No such subscription for this connection.");
    if (!tests.take(auth.grant.id)) return apiError(c, 429, "rate_limited", "Too many tests; try again in a minute.");
    const delivery = await auth.runtime.subscriberDispatcher!.sendTest(sub);
    return c.json({ delivery: deliveryJson(delivery) });
  });

  app.get(`${API_PREFIX}/notes`, async (c) => {
    const auth = authenticate(c, "voice_notes.read");
    if (auth instanceof Response) return auth;
    const id = c.req.query("id") ?? "";
    if (!id) return listNotes(c, auth);
    const notFound = () => apiError(c, 404, "note_not_found", "No such voice note for this connection.");
    if (id === TEST_NOTE_ID) {
      return c.json({ note: { id, text: "This is a test note from Zenod. If you can read this, your connection works.", captured_at: auth.grant.createdAt, source: "test", content_type: "voice_note" } });
    }
    if (!id.includes("#^") || id.length > 300) return notFound();
    let entry: MemoryEntry;
    try {
      const engine = await auth.runtime.getEngine();
      const stored = await engine.getEntry(id);
      // Same view as get_memory: a capture still being enriched reads from its task job.
      entry = mergeMemoryEntries([stored], auth.runtime.taskJobQueue.recent(Number.MAX_SAFE_INTEGER))
        .find((candidate) => candidate.evidenceRef === stored.evidenceRef) ?? stored;
    } catch {
      return notFound();
    }
    if (!entry || entry.evidenceRef !== id || entry.contentType !== "voice_note") return notFound();
    const capturedMs = Date.parse(entry.capturedAt);
    const sinceGrant = Number.isFinite(capturedMs) && capturedMs >= Date.parse(auth.grant.createdAt);
    if (!sinceGrant && !auth.runtime.subscribers!.announcedToGrant(auth.grant.id, id)) return notFound();
    return c.json({ note: { id, text: entry.content, captured_at: entry.capturedAt, source: entry.source ?? null, content_type: "voice_note" } });
  });

  // EPIC-21 V1: the forwarding door, a stateless MCP server holding only ingest_voice_note and its receipt.
  app.post(`${API_PREFIX}/mcp`, bodyLimit({
    maxSize: FORWARD_MAX_BODY_BYTES,
    onError: (c) => apiError(c, 413, "too_large", "The request is larger than the 16 MB audio limit allows."),
  }), async (c) => {
    const auth = authenticate(c, FORWARD_SCOPE);
    if (auth instanceof Response) return auth;
    const body = await c.req.json().catch(() => undefined);
    if (body === undefined) return apiError(c, 400, "invalid_request", "Send a JSON-RPC body.");
    const server = createVoiceNoteForwardServer({
      runtime: auth.runtime,
      grant: auth.grant,
      tenantId: auth.tenantId,
      policy: auth.runtime.subscriberDispatcher?.policy ?? subscriberUrlPolicyFromEnv(host.env),
      lookup: host.lookup,
      ...(host.fetch ? { fetch: host.fetch } : {}),
      now,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const { incoming, outgoing } = c.env as HttpBindings;
    outgoing.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(incoming, outgoing, body);
    return RESPONSE_ALREADY_SENT;
  });
  app.on(["GET", "DELETE"], `${API_PREFIX}/mcp`, (c) => c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: POST JSON-RPC to this stateless endpoint." }, id: null }, 405));

  // The slow safety net (contract section 6): pointers to voice notes since a time, never before the grant.
  async function listNotes(c: Context, auth: Authed): Promise<Response> {
    const sinceRaw = c.req.query("since");
    const since = sinceRaw ? Date.parse(sinceRaw) : NaN;
    if (sinceRaw && !Number.isFinite(since)) return apiError(c, 400, "invalid_request", "since must be an ISO time.");
    const limitRaw = Number(c.req.query("limit") ?? 50);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 50;
    const floor = Math.max(Number.isFinite(since) ? since : 0, Date.parse(auth.grant.createdAt));
    let entries: MemoryEntry[];
    try {
      const engine = await auth.runtime.getEngine();
      const stored = await engine.searchEntries({ contentType: "voice_note", capturedAfter: new Date(floor).toISOString(), order: "oldest", limit: null });
      entries = mergeMemoryEntries(stored, auth.runtime.taskJobQueue.recent(Number.MAX_SAFE_INTEGER));
    } catch {
      return apiError(c, 503, "memory_unavailable", "The workspace memory is not available right now; try again later.");
    }
    const notes = entries
      .filter((entry) => entry.contentType === "voice_note" && Date.parse(entry.capturedAt) > floor - 1)
      .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.evidenceRef.localeCompare(b.evidenceRef));
    const base = publicBaseUrl(c);
    return c.json({
      notes: notes.slice(0, limit).map((entry) => {
        const url = new URL(`${API_PREFIX}/notes`, base);
        url.searchParams.set("id", entry.evidenceRef);
        return { id: entry.evidenceRef, captured_at: entry.capturedAt, source: entry.source ?? null, content_type: "voice_note", url: url.toString() };
      }),
      has_more: notes.length > limit,
    });
  }

  return {
    index: () => index,
    close: () => {
      index?.close();
      index = null;
    },
  };
}
