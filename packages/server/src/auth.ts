import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { OAuthStore } from "./oauthStore.js";
import type { Settings } from "./settings.js";
import { publicBaseUrl, validateAccessToken, wwwAuthenticate } from "./oauth.js";

const SESSION_COOKIE = "zenod_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
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
    const ok =
      (presented !== null && matchesStaticToken(presented, settings)) ||
      (presented !== null && validateAccessToken(oauth, presented) !== null) ||
      hasValidSession(c, settings);
    if (ok) {
      await next();
      return;
    }
    c.header("WWW-Authenticate", wwwAuthenticate(publicBaseUrl(c)));
    return c.json({ error: "unauthorized" }, 401);
  };
}
