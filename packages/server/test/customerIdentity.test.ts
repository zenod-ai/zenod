import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CustomerIdentityStore, customerUserId } from "../src/customerIdentity.js";

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

  it("fails closed without replacing an unreadable identity store", async () => {
    const { dir, identities } = await identityStore();
    const path = join(dir, "customer-identities.json");
    await writeFile(path, "{truncated", "utf8");

    expect(() => identities.snapshot()).toThrow(/customer identity store is unreadable/);
    expect(await readFile(path, "utf8")).toBe("{truncated");
  });
});
