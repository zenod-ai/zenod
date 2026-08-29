import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Answer, Hit, Note, StoreResult } from "zenod";
import {
  assertLegacyCustomerIdentifiersFrozen,
  assertProviderNeutralCustomerSnapshot,
  customerIdentityKey,
  projectVaultCapabilities,
  type FrozenLegacyCustomerIdentifiers,
  type ProviderNeutralCustomerSnapshot,
} from "../src/googleDriveVaultContract.js";

const vaultRevisionSchema = z.object({
  provider: z.enum(["github", "google_drive"]),
  id: z.string().min(1),
  committedAt: z.string().datetime(),
  urls: z.array(z.string()),
  commitSha: z.string().optional(),
  githubUrls: z.array(z.string()).optional(),
}).strict();
const vaultSourceSchema = z.object({
  path: z.string(),
  url: z.string(),
  provider: z.enum(["github", "google_drive"]),
  revisionId: z.string().optional(),
  githubUrl: z.string().optional(),
}).strict();
const githubStoreResultSchema = z.object({
  evidenceRef: z.string(),
  evidenceUrl: z.string(),
  pagesTouched: z.array(z.string()),
  pageUrls: z.array(z.string()),
  revision: vaultRevisionSchema,
  urls: z.array(z.string()),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  githubUrls: z.array(z.string()),
  filing: z.enum(["filed", "uncertain", "inbox", "pending"]),
  backlog: z.unknown().optional(),
  queued: z.boolean().optional(),
}).strict();
const githubCompatibilityFixtureSchema = z.object({
  store: githubStoreResultSchema,
  search: z.array(z.object({
    path: z.string(),
    snippet: z.string(),
    score: z.number(),
    url: z.string(),
    provider: z.literal("github"),
    revisionId: z.string().optional(),
    githubUrl: z.string(),
  }).strict()),
  get: z.object({
    path: z.string(),
    frontmatter: z.record(z.string(), z.unknown()),
    body: z.string(),
    url: z.string(),
    provider: z.literal("github"),
    revisionId: z.string().optional(),
    githubUrl: z.string(),
  }).strict(),
  ask: z.object({
    text: z.string(),
    sources: z.array(vaultSourceSchema),
  }).strict(),
  mcpStructuredStore: githubStoreResultSchema,
  peerReceipt: z.object({
    status: z.literal("done"),
    kind: z.literal("store"),
    result: githubStoreResultSchema,
  }).strict(),
}).strict();

const driveRevisionSchema = z.object({
  provider: z.literal("google_drive"),
  id: z.string().min(1),
  committedAt: z.string().datetime(),
  urls: z.array(z.string()),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/).optional(),
}).strict();
const driveStoreResultSchema = z.object({
  evidenceRef: z.string(),
  evidenceUrl: z.string(),
  pagesTouched: z.array(z.string()),
  pageUrls: z.array(z.string()),
  revision: driveRevisionSchema,
  urls: z.array(z.string()),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  filing: z.enum(["filed", "uncertain", "inbox", "pending"]),
  backlog: z.unknown().optional(),
  queued: z.boolean().optional(),
}).strict();
const driveFixtureSchema = z.object({
  store: driveStoreResultSchema,
  search: z.array(vaultSourceSchema.extend({ snippet: z.string(), score: z.number(), provider: z.literal("google_drive") })),
  get: vaultSourceSchema.extend({ frontmatter: z.record(z.string(), z.unknown()), body: z.string(), provider: z.literal("google_drive") }),
  ask: z.object({ text: z.string(), sources: z.array(vaultSourceSchema) }).strict(),
  mcpStructuredStore: driveStoreResultSchema,
  peerReceipt: z.object({ status: z.literal("done"), kind: z.literal("store"), result: driveStoreResultSchema }).strict(),
}).strict();

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Condition extends true> = Condition;
type _StoreResultFieldsRemainRepresented = Assert<
  Equal<keyof z.infer<typeof githubStoreResultSchema>, keyof StoreResult>
>;
type _SearchFieldsRemainRepresented = Assert<
  Equal<keyof z.infer<typeof githubCompatibilityFixtureSchema>["search"][number], keyof Hit>
>;
type _GetFieldsRemainRepresented = Assert<
  Equal<keyof z.infer<typeof githubCompatibilityFixtureSchema>["get"], keyof Note>
>;
type _AskFieldsRemainRepresented = Assert<
  Equal<keyof z.infer<typeof githubCompatibilityFixtureSchema>["ask"], keyof Answer>
>;

const legacyIdentifiers: FrozenLegacyCustomerIdentifiers = {
  account_id: "github-42",
  session_id: "cs_existing",
  tenant_id: "github-42",
  stripe_client_reference_id: "github-42",
  stripe_customer_id: "cus_existing",
  stripe_subscription_id: "sub_existing",
  mcp_url: "https://zenod.dev/mcp/github-42",
  mcp_token: "existing-token",
  github_id: 42,
  github_login: "octocat",
  vault_repo: "zenod-ai/vault",
  vault_repo_url: "https://github.com/zenod-ai/vault",
};

function snapshot(): ProviderNeutralCustomerSnapshot {
  return {
    schema_version: 1,
    users: [{
      user_id: "user-1",
      display_name: "Octocat",
      avatar_url: null,
      created_at: "2026-08-29T10:00:00.000Z",
    }],
    identities: [{
      user_id: "user-1",
      provider: "github",
      provider_subject: "42",
      email: "octocat@example.test",
      email_verified: true,
      created_at: "2026-08-29T10:00:00.000Z",
    }],
    account_owners: [{
      user_id: "user-1",
      account_id: "github-42",
      created_at: "2026-08-29T10:00:00.000Z",
    }],
    vault_bindings: [{
      binding_id: "binding-1",
      tenant_id: "github-42",
      provider: "github",
      status: "ready",
      repo: "zenod-ai/vault",
      branch: "main",
      created_at: "2026-08-29T10:00:00.000Z",
      updated_at: "2026-08-29T10:00:00.000Z",
    }],
  };
}

describe("provider-neutral customer persistence contract", () => {
  it("keys identities by provider subject and never by email", () => {
    expect(customerIdentityKey(snapshot().identities[0]!)).toBe("github:42");
    expect(customerIdentityKey({ provider: "google", provider_subject: "oidc-sub-42" }))
      .toBe("google:oidc-sub-42");

    const valid = snapshot();
    valid.users.push({
      user_id: "user-2",
      display_name: "Another Octocat",
      avatar_url: null,
      created_at: "2026-08-29T10:00:00.000Z",
    });
    valid.identities.push({
      user_id: "user-2",
      provider: "google",
      provider_subject: "oidc-sub-42",
      email: valid.identities[0]!.email,
      email_verified: true,
      created_at: "2026-08-29T10:00:00.000Z",
    });
    expect(() => assertProviderNeutralCustomerSnapshot(valid)).not.toThrow();

    valid.identities.push({ ...valid.identities[1]!, user_id: "user-1" });
    expect(() => assertProviderNeutralCustomerSnapshot(valid)).toThrow(/provider identity/);
  });

  it("freezes legacy account, tenant, Stripe, and MCP identifiers", () => {
    expect(() => assertLegacyCustomerIdentifiersFrozen(legacyIdentifiers, { ...legacyIdentifiers }))
      .not.toThrow();
    expect(() => assertLegacyCustomerIdentifiersFrozen(legacyIdentifiers, {
      ...legacyIdentifiers,
      tenant_id: "new-tenant",
    })).toThrow(/tenant_id/);
  });

  it("enforces one authoritative vault binding per tenant", () => {
    const valid = snapshot();
    expect(() => assertProviderNeutralCustomerSnapshot(valid)).not.toThrow();
    expect(() => assertProviderNeutralCustomerSnapshot({
      ...valid,
      vault_bindings: [
        ...valid.vault_bindings,
        {
          binding_id: "binding-2",
          tenant_id: "github-42",
          provider: "google_drive",
          status: "ready",
          folder_id: "drive-folder-1",
          manifest_file_id: null,
          created_at: "2026-08-29T10:00:00.000Z",
          updated_at: "2026-08-29T10:00:00.000Z",
        },
      ],
    })).toThrow(/authoritative vault tenant_id/);
  });

  it("rejects invalid vault authorization epochs", () => {
    const valid = snapshot();
    valid.vault_bindings[0]!.authorization_epoch = -1;
    expect(() => assertProviderNeutralCustomerSnapshot(valid)).toThrow(/authorization_epoch/);
  });
});

describe("vault readiness and capability projection", () => {
  it("makes Drive memory ready without implying a GitHub connection", () => {
    const capabilities = projectVaultCapabilities({
      binding: {
        binding_id: "binding-drive",
        tenant_id: "google-account-1",
        provider: "google_drive",
        status: "ready",
        folder_id: "drive-folder-1",
        manifest_file_id: "drive-manifest-1",
        created_at: "2026-08-29T10:00:00.000Z",
        updated_at: "2026-08-29T10:00:00.000Z",
      },
      githubConnectionReady: false,
    });
    expect(capabilities).toMatchObject({
      provider: "google_drive",
      ready: true,
      memory: { store: true, search: true, get: true, ask: true, attachments: true },
      githubTasking: false,
      blocker: null,
    });
  });

  it("fails closed when a ready Drive binding has no authoritative manifest", () => {
    const binding = {
      binding_id: "binding-drive",
      tenant_id: "google-account-1",
      provider: "google_drive" as const,
      status: "ready" as const,
      folder_id: "drive-folder-1",
      manifest_file_id: null,
      created_at: "2026-08-29T10:00:00.000Z",
      updated_at: "2026-08-29T10:00:00.000Z",
    };
    const invalid = snapshot();
    invalid.vault_bindings = [binding];

    expect(() => assertProviderNeutralCustomerSnapshot(invalid)).toThrow(/manifest_file_id/);
    expect(projectVaultCapabilities({ binding, githubConnectionReady: false })).toMatchObject({
      provider: "google_drive",
      ready: false,
      memory: { store: false, search: false, get: false, ask: false, attachments: false },
      githubTasking: false,
      blocker: "vault_error",
    });
  });

  it.each([
    ["recovering", "vault_recovering"],
    ["conflict", "vault_conflict"],
    ["revoked", "vault_authorization_required"],
    ["error", "vault_error"],
  ] as const)("fails memory closed while binding is %s", (status, blocker) => {
    const binding = { ...snapshot().vault_bindings[0]!, status };
    expect(projectVaultCapabilities({ binding, githubConnectionReady: true })).toMatchObject({
      ready: false,
      memory: { store: false, search: false, get: false, ask: false, attachments: false },
      githubTasking: true,
      blocker,
    });
  });
});

describe("GitHub compatibility fixtures", () => {
  it("preserves current store/search/get/ask, MCP, and peer receipt shapes", async () => {
    const fixture = githubCompatibilityFixtureSchema.parse(JSON.parse(await readFile(
      new URL("./fixtures/gdv-1-github-compatibility.json", import.meta.url),
      "utf8",
    )));

    expect(fixture.store.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(fixture.store.githubUrls).toHaveLength(2);
    expect(fixture.store.revision.id).toBe(fixture.store.commitSha);
    expect(fixture.store.revision.committedAt).toBe("2026-08-29T10:00:00.000Z");
    expect(fixture.search[0]?.githubUrl).toContain("github.com");
    expect(fixture.get.githubUrl).toContain("github.com");
    expect(fixture.ask.sources[0]?.githubUrl).toContain("github.com");
    expect(fixture.mcpStructuredStore).toEqual(fixture.store);
    expect(fixture.peerReceipt).toEqual({ status: "done", kind: "store", result: fixture.store });
  });
});

describe("Drive provider-neutral receipt fixtures", () => {
  it("represents Drive authority with an independent real Git bundle commit and no GitHub semantics", async () => {
    const fixture = driveFixtureSchema.parse(JSON.parse(await readFile(
      new URL("./fixtures/gdv-5-drive-receipts.json", import.meta.url),
      "utf8",
    )));

    expect(fixture.store.revision.provider).toBe("google_drive");
    expect(fixture.store.revision.id).toBe("drive-txn-01J6H8Q3N7");
    expect(fixture.store.urls.every((url) => url.includes("drive.google.com"))).toBe(true);
    expect(fixture.store.commitSha).toMatch(/^[0-9a-f]{40}$/i);
    expect(fixture.store.revision.commitSha).toBe(fixture.store.commitSha);
    expect(fixture.store.revision.id).not.toBe(fixture.store.commitSha);
    expect(JSON.stringify(fixture)).not.toContain("github.com");
    expect(fixture.store).not.toHaveProperty("githubUrls");
    expect(fixture.store.revision).not.toHaveProperty("githubUrls");
    expect(fixture.search[0]).not.toHaveProperty("githubUrl");
    expect(fixture.get).not.toHaveProperty("githubUrl");
    expect(fixture.ask.sources[0]).not.toHaveProperty("githubUrl");
    expect(fixture.mcpStructuredStore).toEqual(fixture.store);
    expect(fixture.peerReceipt).toEqual({ status: "done", kind: "store", result: fixture.store });
  });
});
