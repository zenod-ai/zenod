import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
  type JsonWebKey,
} from "node:crypto";
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
  authorizeUrl(state: string, proof?: IdentityAuthorizationProof): string;
  exchangeAndGetUser(code: string, proof?: IdentityAuthorizationProof): Promise<IdentityUser>;
}

export interface IdentityAuthorizationProof {
  nonce?: string;
  codeVerifier?: string;
  codeChallenge?: string;
}

export interface StatePayload {
  mode?: "signin" | "link_identity" | "connect_repo" | "connect_github_tasking" | "connect_drive_vault";
  provider?: CustomerIdentityProvider;
  flow?: string;
  nonce?: string;
  verifier?: string;
  rh?: string;
  uid?: string;
  aid?: string;
  sid?: string;
  gid?: number;
  login?: string;
  tid?: string;
  bid?: string;
  epoch?: number;
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
    provider_login?: string | null;
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
    if (existing) {
      const user = snapshot.users.find((candidate) => candidate.user_id === existing.user_id);
      if (!user) throw new Error(`identity references unknown user ${existing.user_id}`);
      const nextLogin = input.provider_login === undefined ? existing.provider_login : input.provider_login;
      const nextEmail = input.email === undefined ? existing.email : input.email;
      const nextVerified = input.email_verified === undefined ? existing.email_verified : input.email_verified;
      const nextAvatar = input.avatar_url === undefined ? user.avatar_url : input.avatar_url;
      const changed =
        nextLogin !== existing.provider_login ||
        nextEmail !== existing.email ||
        nextVerified !== existing.email_verified ||
        input.display_name !== user.display_name ||
        nextAvatar !== user.avatar_url;
      if (changed) {
        existing.provider_login = nextLogin ?? null;
        existing.email = nextEmail ?? null;
        existing.email_verified = nextVerified;
        user.display_name = input.display_name;
        user.avatar_url = nextAvatar ?? null;
        this.save(snapshot);
      }
      return this.principal(snapshot, existing);
    }

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
      provider_login: input.provider_login ?? null,
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

  /** Persistence primitive for GDV-3's separately authenticated linking flow. */
  linkIdentity(userId: string, input: {
    provider: CustomerIdentityProvider;
    provider_subject: string;
    provider_login?: string | null;
    email?: string | null;
    email_verified?: boolean;
  }): CustomerIdentityRecord {
    const snapshot = this.load();
    if (!snapshot.users.some((candidate) => candidate.user_id === userId)) {
      throw new Error(`cannot link identity to unknown user ${userId}`);
    }
    const providerSubject = input.provider_subject.trim();
    if (!providerSubject) throw new Error("provider_subject is required");
    const existing = snapshot.identities.find(
      (candidate) => candidate.provider === input.provider && candidate.provider_subject === providerSubject,
    );
    if (existing) {
      if (existing.user_id !== userId) throw new Error("provider identity is already linked to another user");
      const nextLogin = input.provider_login === undefined ? existing.provider_login : input.provider_login;
      const nextEmail = input.email === undefined ? existing.email : input.email;
      const nextVerified = input.email_verified === undefined ? existing.email_verified : input.email_verified;
      if (
        nextLogin !== existing.provider_login ||
        nextEmail !== existing.email ||
        nextVerified !== existing.email_verified
      ) {
        existing.provider_login = nextLogin ?? null;
        existing.email = nextEmail ?? null;
        existing.email_verified = nextVerified;
        this.save(snapshot);
      }
      return existing;
    }
    const providerAlreadyLinked = snapshot.identities.find(
      (candidate) => candidate.user_id === userId && candidate.provider === input.provider,
    );
    if (providerAlreadyLinked) {
      throw new Error(`${input.provider} is already linked to this user with a different subject`);
    }
    const identity: CustomerIdentityRecord = {
      user_id: userId,
      provider: input.provider,
      provider_subject: providerSubject,
      provider_login: input.provider_login ?? null,
      email: input.email ?? null,
      email_verified: input.email_verified ?? false,
      created_at: new Date().toISOString(),
    };
    snapshot.identities.push(identity);
    this.save(snapshot);
    return identity;
  }

  unlinkIdentity(userId: string, provider: CustomerIdentityProvider): CustomerPrincipal {
    const snapshot = this.load();
    const providerMatches = snapshot.identities.filter(
      (candidate) => candidate.user_id === userId && candidate.provider === provider,
    );
    if (providerMatches.length === 0) throw new Error(`${provider} identity is not linked`);
    const remaining = snapshot.identities.find(
      (candidate) => candidate.user_id === userId && candidate.provider !== provider,
    );
    if (!remaining) throw new Error("cannot unlink the last sign-in identity");
    // Remove every matching row so stores written by an earlier vulnerable
    // build cannot leave a second provider subject able to authenticate.
    snapshot.identities = snapshot.identities.filter(
      (candidate) => candidate.user_id !== userId || candidate.provider !== provider,
    );
    this.save(snapshot);
    return this.principal(snapshot, remaining);
  }

  accountIdsForUser(userId: string): string[] {
    return this.load().account_owners
      .filter((candidate) => candidate.user_id === userId)
      .map((candidate) => candidate.account_id);
  }

  providersForUser(userId: string): CustomerIdentityProvider[] {
    const providers = this.load().identities
      .filter((candidate) => candidate.user_id === userId)
      .map((candidate) => candidate.provider);
    return [...new Set(providers)];
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
      github_login: github?.provider_login?.trim() || null,
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

interface GoogleIdTokenHeader {
  alg?: string;
  kid?: string;
}

interface GoogleIdTokenClaims {
  iss?: string;
  aud?: string | string[];
  azp?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

interface GoogleJwk extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

export interface GoogleOidcProviderOptions {
  fetch?: typeof fetch;
  now?: () => number;
  jwksUrl?: string;
}

const GOOGLE_OIDC_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const GOOGLE_OIDC_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OIDC_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_OIDC_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

function parseJwtPart<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

/** Google OIDC identity only. It never requests Drive scopes or retains OAuth tokens. */
export class GoogleOidcIdentityProvider implements IdentityProvider {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly jwksUrl: string;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
    options: GoogleOidcProviderOptions = {},
  ) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.jwksUrl = options.jwksUrl ?? GOOGLE_OIDC_JWKS_URL;
  }

  authorizeUrl(state: string, proof: IdentityAuthorizationProof = {}): string {
    if (!proof.nonce || !proof.codeChallenge) throw new Error("Google OIDC nonce and PKCE challenge are required");
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce: proof.nonce,
      code_challenge: proof.codeChallenge,
      code_challenge_method: "S256",
    });
    return `${GOOGLE_OIDC_AUTH_URL}?${params}`;
  }

  async exchangeAndGetUser(code: string, proof: IdentityAuthorizationProof = {}): Promise<IdentityUser> {
    if (!proof.nonce || !proof.codeVerifier) throw new Error("Google OIDC nonce and PKCE verifier are required");
    const tokenResponse = await this.fetcher(GOOGLE_OIDC_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        code_verifier: proof.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: this.redirectUri,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`Google token exchange failed (${tokenResponse.status})`);
    const token = (await tokenResponse.json()) as { id_token?: string; error?: string };
    if (!token.id_token) throw new Error(token.error || "Google token exchange returned no ID token");
    const claims = await this.verifyIdToken(token.id_token, proof.nonce);
    return {
      id: claims.sub!,
      login: claims.name?.trim() || claims.email?.trim() || "Google user",
      email: claims.email?.trim() || null,
      email_verified: claims.email_verified === true,
      avatar_url: claims.picture?.trim() || null,
      provider: "google",
    };
  }

  private async verifyIdToken(token: string, expectedNonce: string): Promise<GoogleIdTokenClaims> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Google returned a malformed ID token");
    const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string];
    const header = parseJwtPart<GoogleIdTokenHeader>(encodedHeader);
    const claims = parseJwtPart<GoogleIdTokenClaims>(encodedClaims);
    if (header.alg !== "RS256" || !header.kid) throw new Error("Google ID token uses an unsupported signature");
    const jwksResponse = await this.fetcher(this.jwksUrl);
    if (!jwksResponse.ok) throw new Error(`Google signing-key lookup failed (${jwksResponse.status})`);
    const jwks = (await jwksResponse.json()) as { keys?: GoogleJwk[] };
    const jwk = jwks.keys?.find(
      (candidate) =>
        candidate.kid === header.kid &&
        candidate.kty === "RSA" &&
        (!candidate.alg || candidate.alg === "RS256") &&
        (!candidate.use || candidate.use === "sig"),
    );
    if (!jwk) throw new Error("Google ID token signing key was not found");
    const verified = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(encodedSignature, "base64url"),
    );
    if (!verified) throw new Error("Google ID token signature is invalid");
    if (!claims.iss || !GOOGLE_OIDC_ISSUERS.has(claims.iss)) throw new Error("Google ID token issuer is invalid");
    const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (!audiences.includes(this.clientId)) throw new Error("Google ID token audience is invalid");
    if (audiences.length > 1 && claims.azp !== this.clientId) throw new Error("Google ID token authorized party is invalid");
    const nowSeconds = Math.floor(this.now() / 1000);
    if (!claims.exp || claims.exp <= nowSeconds) throw new Error("Google ID token is expired");
    if (claims.iat && claims.iat > nowSeconds + 60) throw new Error("Google ID token issued-at time is invalid");
    if (!claims.nonce || claims.nonce !== expectedNonce) throw new Error("Google ID token nonce is invalid");
    if (!claims.sub?.trim()) throw new Error("Google ID token subject is missing");
    return claims;
  }
}
