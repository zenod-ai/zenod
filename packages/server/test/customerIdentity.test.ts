import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  CustomerIdentityStore,
  GoogleOidcIdentityProvider,
  customerUserId,
} from "../src/customerIdentity.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function identityStore(): Promise<{ dir: string; identities: CustomerIdentityStore }> {
  const dir = await mkdtemp(join(tmpdir(), "zenod-identities-"));
  tempDirs.push(dir);
  return { dir, identities: new CustomerIdentityStore(dir) };
}

describe("provider-neutral customer identity persistence", () => {
  it("keeps equal verified emails as separate provider subjects", async () => {
    const { identities } = await identityStore();
    const github = identities.resolveOrCreate({
      provider: "github",
      provider_subject: "42",
      display_name: "octocat",
      email: "same@example.com",
      email_verified: true,
    });
    const google = identities.resolveOrCreate({
      provider: "google",
      provider_subject: "google-subject-42",
      display_name: "Octo Cat",
      email: "same@example.com",
      email_verified: true,
    });

    expect(github.user_id).not.toBe(google.user_id);
    expect(identities.snapshot().users).toHaveLength(2);
    expect(identities.snapshot().identities).toHaveLength(2);
  });

  it("does not collide when two providers expose the same subject text", async () => {
    const { identities } = await identityStore();
    const github = identities.resolveOrCreate({
      provider: "github",
      provider_subject: "123",
      display_name: "github-user",
    });
    const google = identities.resolveOrCreate({
      provider: "google",
      provider_subject: "123",
      display_name: "google-user",
    });

    expect(github.user_id).toBe(customerUserId("github", "123"));
    expect(google.user_id).toBe(customerUserId("google", "123"));
    expect(github.user_id).not.toBe(google.user_id);
  });

  it("fails closed when an account owner would be replaced", async () => {
    const { identities } = await identityStore();
    const first = identities.resolveOrCreate({
      provider: "github",
      provider_subject: "1",
      display_name: "first",
    });
    const second = identities.resolveOrCreate({
      provider: "google",
      provider_subject: "second-sub",
      display_name: "second",
    });
    identities.bindAccount(first.user_id, "github-1");

    expect(() => identities.bindAccount(second.user_id, "github-1")).toThrow(
      "account is already owned by another user",
    );
    expect(identities.ownerForAccount("github-1")).toBe(first.user_id);
  });

  it("uses provider-scoped GitHub login metadata and refreshes renamed profiles", async () => {
    const { identities } = await identityStore();
    const google = identities.resolveOrCreate({
      provider: "google",
      provider_subject: "google-admin-lookalike",
      display_name: "AlFaBlOk",
      email: "lookalike@example.test",
      email_verified: true,
    });
    identities.linkIdentity(google.user_id, {
      provider: "github",
      provider_subject: "7001",
      provider_login: "unrelated-user",
    });

    expect(identities.resolve("google", "google-admin-lookalike")).toMatchObject({
      display_name: "AlFaBlOk",
      github_id: 7001,
      github_login: "unrelated-user",
    });

    identities.resolveOrCreate({
      provider: "github",
      provider_subject: "7001",
      provider_login: "renamed-user",
      display_name: "Renamed User",
    });
    expect(identities.resolve("google", "google-admin-lookalike")?.github_login).toBe("renamed-user");
  });

  it("refuses to link a provider subject already owned by another user", async () => {
    const { identities } = await identityStore();
    const first = identities.resolveOrCreate({
      provider: "google",
      provider_subject: "first-google",
      display_name: "First",
    });
    const second = identities.resolveOrCreate({
      provider: "google",
      provider_subject: "second-google",
      display_name: "Second",
    });
    identities.linkIdentity(first.user_id, {
      provider: "github",
      provider_subject: "42",
      provider_login: "octocat",
    });

    expect(() => identities.linkIdentity(second.user_id, {
      provider: "github",
      provider_subject: "42",
      provider_login: "octocat",
    })).toThrow("provider identity is already linked to another user");
  });

  it.each(["github", "google"] as const)(
    "allows only one %s subject per user while same-subject linking updates metadata",
    async (provider) => {
      const { identities } = await identityStore();
      const principal = identities.resolveOrCreate({
        provider: provider === "github" ? "google" : "github",
        provider_subject: provider === "github" ? "google-owner" : "42",
        display_name: "Owner",
      });
      identities.linkIdentity(principal.user_id, {
        provider,
        provider_subject: "first-subject",
        provider_login: "before",
        email: "before@example.test",
      });
      const updated = identities.linkIdentity(principal.user_id, {
        provider,
        provider_subject: "first-subject",
        provider_login: "after",
        email: "after@example.test",
        email_verified: true,
      });
      expect(updated).toMatchObject({
        provider_subject: "first-subject",
        provider_login: "after",
        email: "after@example.test",
        email_verified: true,
      });
      expect(() => identities.linkIdentity(principal.user_id, {
        provider,
        provider_subject: "second-subject",
      })).toThrow(`${provider} is already linked to this user with a different subject`);
      expect(identities.snapshot().identities.filter(
        (candidate) => candidate.user_id === principal.user_id && candidate.provider === provider,
      )).toHaveLength(1);
    },
  );

  it("refuses to unlink the final sign-in identity and preserves the stable user id", async () => {
    const { identities } = await identityStore();
    const principal = identities.resolveOrCreate({
      provider: "github",
      provider_subject: "42",
      display_name: "octocat",
    });
    expect(() => identities.unlinkIdentity(principal.user_id, "github")).toThrow(
      "cannot unlink the last sign-in identity",
    );
    identities.linkIdentity(principal.user_id, {
      provider: "google",
      provider_subject: "google-42",
      email: "octocat@example.test",
      email_verified: true,
    });

    const remaining = identities.unlinkIdentity(principal.user_id, "github");
    expect(remaining).toMatchObject({
      user_id: principal.user_id,
      provider: "google",
      provider_subject: "google-42",
    });
    expect(identities.providersForUser(principal.user_id)).toEqual(["google"]);
  });

  it("removes every legacy duplicate subject for an unlinked provider", async () => {
    const { dir, identities } = await identityStore();
    const principal = identities.resolveOrCreate({
      provider: "github",
      provider_subject: "42",
      display_name: "octocat",
    });
    identities.linkIdentity(principal.user_id, {
      provider: "google",
      provider_subject: "google-one",
    });
    const snapshot = identities.snapshot();
    snapshot.identities.push({
      user_id: principal.user_id,
      provider: "google",
      provider_subject: "google-two",
      provider_login: null,
      email: null,
      email_verified: false,
      created_at: new Date().toISOString(),
    });
    await writeFile(join(dir, "customer-identities.json"), JSON.stringify(snapshot), "utf8");

    identities.unlinkIdentity(principal.user_id, "google");
    expect(identities.resolve("google", "google-one")).toBeNull();
    expect(identities.resolve("google", "google-two")).toBeNull();
    expect(identities.providersForUser(principal.user_id)).toEqual(["github"]);
  });

  it("fails closed without replacing an unreadable identity store", async () => {
    const { dir, identities } = await identityStore();
    const path = join(dir, "customer-identities.json");
    await writeFile(path, "{truncated", "utf8");

    expect(() => identities.snapshot()).toThrow(/customer identity store is unreadable/);
    expect(await readFile(path, "utf8")).toBe("{truncated");
  });
});

describe("Google OIDC identity provider", () => {
  const now = Date.parse("2026-08-29T12:00:00.000Z");
  const clientId = "google-client-id";
  const redirectUri = "https://cloud.zenod.dev/auth/google/callback";

  function fixture(overrides: Record<string, unknown> = {}) {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
    const claims = Buffer.from(JSON.stringify({
      iss: "https://accounts.google.com",
      aud: clientId,
      sub: "google-subject-42",
      exp: Math.floor(now / 1000) + 300,
      iat: Math.floor(now / 1000),
      nonce: "expected-nonce",
      email: "verified@example.test",
      email_verified: true,
      name: "Verified Person",
      picture: "https://example.test/avatar.png",
      ...overrides,
    })).toString("base64url");
    const signature = sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), privateKey).toString("base64url");
    return {
      token: `${header}.${claims}.${signature}`,
      jwk: { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" },
    };
  }

  it("requests only identity scopes and binds nonce plus S256 PKCE", () => {
    const provider = new GoogleOidcIdentityProvider(clientId, "client-secret", redirectUri);
    const url = new URL(provider.authorizeUrl("signed-state", {
      nonce: "expected-nonce",
      codeChallenge: "challenge",
    }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("scope")).not.toMatch(/drive/i);
    expect(url.searchParams.get("nonce")).toBe("expected-nonce");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
  });

  it("verifies the ID token and returns only identity attributes", async () => {
    const { token, jwk } = fixture();
    const requests: Array<{ url: string; body: string | null }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, body: init?.body?.toString() ?? null });
      return url.includes("token")
        ? Response.json({ id_token: token, access_token: "discarded-access-token", refresh_token: "discarded-refresh-token" })
        : Response.json({ keys: [jwk] });
    };
    const provider = new GoogleOidcIdentityProvider(clientId, "client-secret", redirectUri, {
      fetch: fetcher,
      now: () => now,
      jwksUrl: "https://google.test/jwks",
    });

    await expect(provider.exchangeAndGetUser("authorization-code", {
      nonce: "expected-nonce",
      codeVerifier: "secret-verifier",
    })).resolves.toEqual({
      id: "google-subject-42",
      login: "Verified Person",
      email: "verified@example.test",
      email_verified: true,
      avatar_url: "https://example.test/avatar.png",
      provider: "google",
    });
    expect(requests[0]?.body).toContain("code_verifier=secret-verifier");
    expect(requests[0]?.body).toContain(`redirect_uri=${encodeURIComponent(redirectUri)}`);
  });

  it.each([
    ["issuer", { iss: "https://attacker.example" }, /issuer/],
    ["audience", { aud: "another-client" }, /audience/],
    ["expiry", { exp: Math.floor(now / 1000) - 1 }, /expired/],
    ["nonce", { nonce: "wrong-nonce" }, /nonce/],
  ])("rejects an invalid %s claim", async (_name, overrides, error) => {
    const { token, jwk } = fixture(overrides);
    const provider = new GoogleOidcIdentityProvider(clientId, "client-secret", redirectUri, {
      fetch: async (input) => String(input).includes("token")
        ? Response.json({ id_token: token })
        : Response.json({ keys: [jwk] }),
      now: () => now,
      jwksUrl: "https://google.test/jwks",
    });
    await expect(provider.exchangeAndGetUser("code", {
      nonce: "expected-nonce",
      codeVerifier: "verifier",
    })).rejects.toThrow(error);
  });

  it("rejects an ID token whose signature does not match Google's advertised key", async () => {
    const { token } = fixture();
    const { jwk } = fixture();
    const provider = new GoogleOidcIdentityProvider(clientId, "client-secret", redirectUri, {
      fetch: async (input) => String(input).includes("token")
        ? Response.json({ id_token: token })
        : Response.json({ keys: [jwk] }),
      now: () => now,
      jwksUrl: "https://google.test/jwks",
    });
    await expect(provider.exchangeAndGetUser("code", {
      nonce: "expected-nonce",
      codeVerifier: "verifier",
    })).rejects.toThrow(/signature is invalid/);
  });
});
