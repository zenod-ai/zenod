import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { customerUserId, type CustomerPrincipal } from "./customerIdentity.js";

// Transplanted from zenod-ai/cloud services/webhook/src/session.ts @ 6bdb318.

const CUSTOMER_SESSION_COOKIE = "zenod_customer_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CustomerSession {
  user_id: string;
  provider: "github" | "google";
  provider_subject: string;
  display_name: string;
  avatar_url: string | null;
  /** Present only while reading a legacy GitHub-keyed cookie. */
  github_id?: number;
  /** Compatibility presentation alias used by existing GitHub-only UI code. */
  login: string;
}

function secret(env: NodeJS.ProcessEnv): string {
  return env.ACCOUNT_STATE_SECRET || env.STRIPE_WEBHOOK_SECRET || "";
}

function signature(value: string, env: NodeJS.ProcessEnv): string {
  return createHmac("sha256", secret(env)).update(value).digest("base64url");
}

export function issueCustomerSession(
  c: Context,
  user: CustomerPrincipal | { id: number; login: string },
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!secret(env)) throw new Error("customer session secret is not configured");
  const cookieDomain = env.ZC_COOKIE_DOMAIN || (env.NODE_ENV === "production" ? ".zenod.dev" : undefined);
  const principal: Omit<CustomerSession, "github_id"> = "user_id" in user
    ? {
        user_id: user.user_id,
        provider: user.provider,
        provider_subject: user.provider_subject,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        login: user.github_login ?? user.display_name,
      }
    : {
        user_id: customerUserId("github", String(user.id)),
        provider: "github",
        provider_subject: String(user.id),
        display_name: user.login,
        avatar_url: `https://github.com/${user.login}.png`,
        login: user.login,
      };
  const payload = Buffer.from(JSON.stringify({ ...principal, exp: Date.now() + SESSION_TTL_MS })).toString("base64url");
  setCookie(c, CUSTOMER_SESSION_COOKIE, `${payload}.${signature(payload, env)}`, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
}

export function clearCustomerSession(c: Context, env: NodeJS.ProcessEnv = process.env): void {
  const cookieDomain = env.ZC_COOKIE_DOMAIN || (env.NODE_ENV === "production" ? ".zenod.dev" : undefined);
  // Clear a host-only cookie as well as the production parent-domain cookie.
  // This keeps logout working across a cutover where an earlier build issued
  // the same cookie name without ZC_COOKIE_DOMAIN/NODE_ENV configured.
  deleteCookie(c, CUSTOMER_SESSION_COOKIE, { path: "/" });
  if (!cookieDomain) return;
  deleteCookie(c, CUSTOMER_SESSION_COOKIE, {
    path: "/",
    domain: cookieDomain,
  });
  if (cookieDomain !== ".zenod.dev") {
    deleteCookie(c, CUSTOMER_SESSION_COOKIE, { path: "/", domain: ".zenod.dev" });
  }
}

export function readCustomerSession(c: Context, env: NodeJS.ProcessEnv = process.env): CustomerSession | null {
  const raw = getCookie(c, CUSTOMER_SESSION_COOKIE);
  if (!raw || !secret(env)) return null;
  const [payload, mac] = raw.split(".");
  if (!payload || !mac) return null;
  const expected = signature(payload, env);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<CustomerSession> & {
      exp?: number;
      github_id?: number;
    };
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    if (
      parsed.user_id &&
      (parsed.provider === "github" || parsed.provider === "google") &&
      parsed.provider_subject &&
      parsed.display_name &&
      parsed.login
    ) {
      return {
        user_id: parsed.user_id,
        provider: parsed.provider,
        provider_subject: parsed.provider_subject,
        display_name: parsed.display_name,
        avatar_url: parsed.avatar_url ?? null,
        login: parsed.login,
      };
    }
    // Rollback-compatible read of cookies issued before provider-neutral
    // sessions. New cookies never contain github_id as their owner key.
    if (!Number.isSafeInteger(parsed.github_id) || !parsed.login) return null;
    return {
      user_id: customerUserId("github", String(parsed.github_id)),
      provider: "github",
      provider_subject: String(parsed.github_id),
      display_name: parsed.login,
      avatar_url: `https://github.com/${parsed.login}.png`,
      github_id: parsed.github_id,
      login: parsed.login,
    };
  } catch {
    return null;
  }
}
