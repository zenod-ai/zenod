import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { OAuthStore } from "./oauthStore.js";
import type { Settings } from "./settings.js";
import { publicBaseUrl, validateAccessToken, wwwAuthenticate } from "./oauth.js";

const SESSION_COOKIE = "zenod_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HOSTED_ENTRY_TTL_MS = 2 * 60 * 1000;
const HOSTED_SURFACES = new Set(["ring-router-products", "phylax-channels"]);
const MCP_TOOL_TOKEN_PREFIX = "zenod_mcp_scope_v1";
const MEMORY_CHANNEL_PROFILE = "memory-channel";

export const MEMORY_CHANNEL_MCP_TOOLS = Object.freeze([
  "ask_brain",
  "chat_with_zenod",
  "get_task_result",
  "ingest_memory",
  "search_memory",
  "store_memory",
] as const);

interface McpToolTokenClaims {
  v: 1;
  nonce: string;
  profile: typeof MEMORY_CHANNEL_PROFILE;
}

interface McpRequestAccess {
  toolAllowlist?: ReadonlySet<string>;
}

const mcpRequestAccess = new AsyncLocalStorage<McpRequestAccess>();

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Mint the exact D3 bearer for a Phylax channel binding. */
export function createMemoryChannelMcpToken(
  apiToken: string,
  nonce = randomUUID(),
): string {
  if (!apiToken) throw new Error("cannot mint an MCP tool token without an API token");
  if (!nonce) throw new Error("MCP tool token nonce is required");
  const claims: McpToolTokenClaims = {
    v: 1,
    nonce,
    profile: MEMORY_CHANNEL_PROFILE,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signed = `${MCP_TOOL_TOKEN_PREFIX}.${payload}`;
  return `${signed}.${sign(apiToken, signed)}`;
}

export function mcpToolAllowlistForToken(
  apiToken: string,
  token: string,
): ReadonlySet<string> | null {
  if (!apiToken) return null;
  const [prefix, payload, mac, ...extra] = token.split(".");
  if (
    prefix !== MCP_TOOL_TOKEN_PREFIX ||
    !payload ||
    !mac ||
    extra.length > 0 ||
    !/^[a-f0-9]{64}$/.test(mac)
  ) {
    return null;
  }
  const signed = `${prefix}.${payload}`;
  const expected = sign(apiToken, signed);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<McpToolTokenClaims>;
    if (
      claims.v !== 1 ||
      typeof claims.nonce !== "string" ||
      !claims.nonce ||
      claims.profile !== MEMORY_CHANNEL_PROFILE
    ) {
      return null;
    }
    return new Set(MEMORY_CHANNEL_MCP_TOOLS);
  } catch {
    return null;
  }
}

/**
 * Available only while an authenticated /mcp request is being handled.
 * Undefined means the accepted credential has the full MCP surface.
 */
export function currentMcpToolAllowlist(): ReadonlySet<string> | undefined {
  return mcpRequestAccess.getStore()?.toolAllowlist;
}

export function hostedRingMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ZENOD_HOSTED_MODE === "ring";
}

export function createHostedEntryTicket(
  secret: string,
  surface: string,
  now = Date.now(),
  nonce = randomUUID(),
): string {
  if (!HOSTED_SURFACES.has(surface)) throw new Error("invalid hosted entry surface");
  const expires = now + HOSTED_ENTRY_TTL_MS;
  const payload = `${expires}.${nonce}.${surface}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function verifyHostedEntryTicket(
  secret: string,
  ticket: string,
  now = Date.now(),
): { nonce: string; surface: string } | null {
  if (!secret) return null;
  const [expires, nonce, surface, mac] = ticket.split(".");
  if (!expires || !nonce || !surface || !mac || !HOSTED_SURFACES.has(surface)) return null;
  const expiresAt = Number(expires);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + HOSTED_ENTRY_TTL_MS) return null;
  const expected = sign(secret, `${expires}.${nonce}.${surface}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? { nonce, surface } : null;
}

export function issueSession(c: Context, settings: Settings): void {
  const expires = Date.now() + SESSION_TTL_MS;
  const token = `${expires}.${sign(settings.sessionSecret(), String(expires))}`;
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSession(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function hasValidSession(c: Context, settings: Settings): boolean {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (!cookie) return false;
  const [expires, mac] = cookie.split(".");
  if (!expires || !mac) return false;
  if (Number(expires) < Date.now()) return false;
  const expected = sign(settings.sessionSecret(), expires);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearerToken(c: Context): string | null {
  const header = c.req.header("Authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

function matchesStaticToken(presented: string, settings: Settings): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(settings.apiToken());
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function hasValidBearer(c: Context, settings: Settings): boolean {
  const presented = bearerToken(c);
  return presented !== null && matchesStaticToken(presented, settings);
}

/** Auth for /api: static bearer token (scripts) or session cookie (UI). */
export function requireAuth(settings: Settings) {
  return async (c: Context, next: Next) => {
    if (hasValidBearer(c, settings) || hasValidSession(c, settings)) {
      await next();
      return;
    }
    return c.json({ error: "unauthorized" }, 401);
  };
}

/**
 * Auth for /mcp: static bearer (scripts/Codex), an OAuth access token
 * (Claude.ai/Claude Code after sign-in), or the admin session cookie.
 * On failure, returns 401 with the WWW-Authenticate challenge that kicks off
 * the OAuth discovery flow.
 */
export function requireMcpAuth(settings: Settings, oauth: OAuthStore) {
  return async (c: Context, next: Next) => {
    const presented = bearerToken(c);
    if (presented !== null && matchesStaticToken(presented, settings)) {
      return mcpRequestAccess.run({}, next);
    }
    if (presented !== null && validateAccessToken(oauth, presented) !== null) {
      return mcpRequestAccess.run({}, next);
    }
    if (hasValidSession(c, settings)) {
      return mcpRequestAccess.run({}, next);
    }
    if (presented !== null) {
      const toolAllowlist = mcpToolAllowlistForToken(settings.apiToken(), presented);
      if (toolAllowlist) {
        return mcpRequestAccess.run({ toolAllowlist }, next);
      }
    }
    c.header("WWW-Authenticate", wwwAuthenticate(publicBaseUrl(c)));
    return c.json({ error: "unauthorized" }, 401);
  };
}
