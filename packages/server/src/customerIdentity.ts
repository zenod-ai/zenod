import { createHmac, timingSafeEqual } from "node:crypto";

// Transplanted from zenod-ai/cloud services/webhook/src/identity.ts @ 6bdb318.

export interface IdentityUser {
  id: number | string;
  login: string;
  email: string | null;
}

export interface IdentityProvider {
  authorizeUrl(state: string): string;
  exchangeAndGetUser(code: string): Promise<IdentityUser>;
}

export interface StatePayload {
  mode?: "signin";
  rh?: string;
  exp?: number;
}

export function signState(payload: StatePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60_000 })).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyState(state: string, secret: string): StatePayload | null {
  if (!secret) return null;
  const [body, mac] = state.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export class GithubIdentityProvider implements IdentityProvider {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
  ) {}

  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: "read:user user:email",
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  async exchangeAndGetUser(code: string): Promise<IdentityUser> {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.redirectUri,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`GitHub token exchange failed (${tokenResponse.status})`);
    const tokenBody = (await tokenResponse.json()) as { access_token?: string; error?: string };
    if (!tokenBody.access_token) throw new Error(tokenBody.error || "GitHub token exchange returned no token");

    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tokenBody.access_token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const userResponse = await fetch("https://api.github.com/user", { headers });
    if (!userResponse.ok) throw new Error(`GitHub user lookup failed (${userResponse.status})`);
    const user = (await userResponse.json()) as { id: number; login: string; email?: string | null };
    let email = user.email ?? null;
    if (!email) {
      const emailsResponse = await fetch("https://api.github.com/user/emails", { headers });
      if (emailsResponse.ok) {
        const emails = (await emailsResponse.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
        email = emails.find((candidate) => candidate.primary && candidate.verified)?.email ?? null;
      }
    }
    return { id: user.id, login: user.login, email };
  }
}
