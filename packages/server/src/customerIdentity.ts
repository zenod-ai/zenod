import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  PROVIDER_NEUTRAL_CUSTOMER_SCHEMA_VERSION,
  assertProviderNeutralCustomerSnapshot,
  type CustomerAccountOwnerRecord,
  type CustomerIdentityProvider,
  type CustomerIdentityRecord,
  type CustomerUserRecord,
  type ProviderNeutralCustomerSnapshot,
} from "./googleDriveVaultContract.js";

// Transplanted from zenod-ai/cloud services/webhook/src/identity.ts @ 6bdb318.

export interface IdentityUser {
  id: number | string;
  login: string;
  email: string | null;
  provider?: CustomerIdentityProvider;
  email_verified?: boolean;
  avatar_url?: string | null;
}

export interface IdentityProvider {
  authorizeUrl(state: string): string;
  exchangeAndGetUser(code: string): Promise<IdentityUser>;
}

export interface StatePayload {
  mode?: "signin" | "connect_repo";
  rh?: string;
  uid?: string;
  gid?: number;
  login?: string;
  exp?: number;
}

export interface CustomerPrincipal {
  user_id: string;
  provider: CustomerIdentityProvider;
  provider_subject: string;
  display_name: string;
  avatar_url: string | null;
  email: string | null;
  email_verified: boolean;
  /** GitHub compatibility metadata; absent for identities with no GitHub link. */
  github_id: number | null;
  github_login: string | null;
}

/** Stable opaque ID used when lazily projecting legacy provider subjects. */
export function customerUserId(provider: CustomerIdentityProvider, providerSubject: string): string {
  const normalized = providerSubject.trim();
  if (!normalized) throw new Error("provider_subject is required");
  return `usr_${createHash("sha256").update(`${provider}:${normalized}`).digest("hex").slice(0, 24)}`;
}

function emptySnapshot(): ProviderNeutralCustomerSnapshot {
  return {
    schema_version: PROVIDER_NEUTRAL_CUSTOMER_SCHEMA_VERSION,
    users: [],
    identities: [],
    account_owners: [],
    vault_bindings: [],
  };
}

/**
 * Durable provider-neutral identity projection. It intentionally uses the same
 * private atomic-JSON pattern as CustomerAccountStore so this migration adds no
 * second database or service.
 */
export class CustomerIdentityStore {
  readonly path: string;

  constructor(dataDir: string, product = "zenod") {
    const suffix = product === "zenod" ? "" : `-${product}`;
    this.path = join(dataDir, `customer-identities${suffix}.json`);
  }

  private load(): ProviderNeutralCustomerSnapshot {
    if (!existsSync(this.path)) return emptySnapshot();
    try {
      const snapshot = JSON.parse(readFileSync(this.path, "utf8")) as ProviderNeutralCustomerSnapshot;
      assertProviderNeutralCustomerSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      throw new Error(`customer identity store is unreadable: ${this.path}`, { cause: error });
    }
  }

  private save(snapshot: ProviderNeutralCustomerSnapshot): void {
    assertProviderNeutralCustomerSnapshot(snapshot);
    mkdirSync(dirname(this.path), { recursive: true });
    const pendingPath = `${this.path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(pendingPath, JSON.stringify(snapshot, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(pendingPath, this.path);
  }

  resolve(provider: CustomerIdentityProvider, providerSubject: string): CustomerPrincipal | null {
    const snapshot = this.load();
    const identity = snapshot.identities.find(
      (candidate) => candidate.provider === provider && candidate.provider_subject === providerSubject,
    );
    if (!identity) return null;
    return this.principal(snapshot, identity);
  }

  resolveUser(userId: string): CustomerPrincipal | null {
    const snapshot = this.load();
    const identity = snapshot.identities.find((candidate) => candidate.user_id === userId);
    return identity ? this.principal(snapshot, identity) : null;
  }

  resolveOrCreate(input: {
    provider: CustomerIdentityProvider;
    provider_subject: string;
    display_name: string;
    avatar_url?: string | null;
    email?: string | null;
    email_verified?: boolean;
  }): CustomerPrincipal {
    const providerSubject = input.provider_subject.trim();
    if (!providerSubject) throw new Error("provider_subject is required");
    const snapshot = this.load();
    const existing = snapshot.identities.find(
      (candidate) => candidate.provider === input.provider && candidate.provider_subject === providerSubject,
    );
    if (existing) return this.principal(snapshot, existing);

    // Deliberately do not search by email. A matching address is never proof
    // that two provider subjects belong to the same customer.
    const now = new Date().toISOString();
    const userId = customerUserId(input.provider, providerSubject);
    const user: CustomerUserRecord = {
      user_id: userId,
      display_name: input.display_name,
      avatar_url: input.avatar_url ?? null,
      created_at: now,
    };
    const identity: CustomerIdentityRecord = {
      user_id: userId,
      provider: input.provider,
      provider_subject: providerSubject,
      email: input.email ?? null,
      email_verified: input.email_verified ?? false,
      created_at: now,
    };
    snapshot.users.push(user);
    snapshot.identities.push(identity);
    this.save(snapshot);
    return this.principal(snapshot, identity);
  }

  bindAccount(userId: string, accountId: string): CustomerAccountOwnerRecord {
    const snapshot = this.load();
    if (!snapshot.users.some((candidate) => candidate.user_id === userId)) {
      throw new Error(`cannot bind account to unknown user ${userId}`);
    }
    const existing = snapshot.account_owners.find((candidate) => candidate.account_id === accountId);
    if (existing) {
      if (existing.user_id !== userId) throw new Error("account is already owned by another user");
      return existing;
    }
    const owner = { user_id: userId, account_id: accountId, created_at: new Date().toISOString() };
    snapshot.account_owners.push(owner);
    this.save(snapshot);
    return owner;
  }

  accountIdsForUser(userId: string): string[] {
    return this.load().account_owners
      .filter((candidate) => candidate.user_id === userId)
      .map((candidate) => candidate.account_id);
  }

  ownerForAccount(accountId: string): string | null {
    return this.load().account_owners.find((candidate) => candidate.account_id === accountId)?.user_id ?? null;
  }

  snapshot(): ProviderNeutralCustomerSnapshot {
    return this.load();
  }

  private principal(
    snapshot: ProviderNeutralCustomerSnapshot,
    identity: CustomerIdentityRecord,
  ): CustomerPrincipal {
    const user = snapshot.users.find((candidate) => candidate.user_id === identity.user_id);
    if (!user) throw new Error(`identity references unknown user ${identity.user_id}`);
    const github = snapshot.identities.find(
      (candidate) => candidate.user_id === identity.user_id && candidate.provider === "github",
    );
    const githubId = github && /^\d+$/.test(github.provider_subject) ? Number(github.provider_subject) : null;
    return {
      user_id: user.user_id,
      provider: identity.provider,
      provider_subject: identity.provider_subject,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      email: identity.email,
      email_verified: identity.email_verified,
      github_id: githubId !== null && Number.isSafeInteger(githubId) ? githubId : null,
      github_login: github ? user.display_name : null,
    };
  }
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
    let emailVerified = false;
    const emailsResponse = await fetch("https://api.github.com/user/emails", { headers });
    if (emailsResponse.ok) {
      const emails = (await emailsResponse.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primary = emails.find((candidate) => candidate.primary && candidate.verified);
      if (primary) {
        email = primary.email;
        emailVerified = true;
      }
    }
    return {
      id: user.id,
      login: user.login,
      email,
      email_verified: emailVerified,
      avatar_url: `https://github.com/${user.login}.png`,
    };
  }
}
