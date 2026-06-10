import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Settings } from "./settings.js";

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

function hasValidBearer(c: Context, settings: Settings): boolean {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const presented = Buffer.from(header.slice(7));
  const expected = Buffer.from(settings.apiToken());
  return expected.length > 0 && presented.length === expected.length && timingSafeEqual(presented, expected);
}

/** Auth for /api and /mcp: bearer token (agents) or session cookie (UI). */
export function requireAuth(settings: Settings) {
  return async (c: Context, next: Next) => {
    if (hasValidBearer(c, settings) || hasValidSession(c, settings)) {
      await next();
      return;
    }
    return c.json({ error: "unauthorized" }, 401);
  };
}
