import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ChassisStorage, SqliteTenantSettingsStore } from "@zenod/mcp-chassis";
import { runVaultRekey } from "../src/vaultRekey.js";
import { zenodPhylaxTokenKey } from "../src/zenodPhylax.js";

const OLD_KEY = "31".repeat(32);
const NEW_KEY = "52".repeat(32);
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function seedAdapterToken(dataDir: string, accountId: string, token: string, secret: string): void {
  const db = new DatabaseSync(join(dataDir, "zenod-phylax-adapter.sqlite"));
  db.exec(`CREATE TABLE IF NOT EXISTS zenod_phylax_bindings (
    account_id TEXT PRIMARY KEY, token_iv TEXT NOT NULL, token_ciphertext TEXT NOT NULL, token_auth_tag TEXT NOT NULL
  )`);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", zenodPhylaxTokenKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  db.prepare("INSERT INTO zenod_phylax_bindings VALUES (?, ?, ?, ?)").run(
    accountId,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  );
  db.close();
}

async function seededDataDir(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), "zenod-vault-rekey-"));
  dirs.push(dataDir);
  const storage = new ChassisStorage({ dataDir, vaultEncryptionKey: OLD_KEY });
  const alpha = storage.forTenant({ id: "tenant_alpha" });
  const vault = alpha.vault();
  vault.set("github", "alpha-github-secret");
  vault.set("drive", "alpha-drive-secret");
  vault.close();
  const named = alpha.vault("phylax-secrets.sqlite");
  named.set("channel", "alpha-channel-secret");
  named.close();
  new SqliteTenantSettingsStore().update(alpha, { github_token: "alpha-settings-token-1234" });
  // A tenant with only a verifier (empty vault) is still sealed under the key.
  storage.forTenant({ id: "tenant_beta" }).vault().close();
  seedAdapterToken(dataDir, "account-1", "phylax-token-1", OLD_KEY);
  seedAdapterToken(dataDir, "account-2", "phylax-token-2", OLD_KEY);
  return dataDir;
}

describe("vault master key rotation", () => {
  it("re-seals every ciphertext under the new key, idempotently, with counts only", async () => {
    const dataDir = await seededDataDir();
    const before = runVaultRekey({ mode: "verify", dataDir, key: OLD_KEY });
    expect(before.ok).toBe(true);
    // alpha: vault.sqlite 2 entries + verifier, phylax-secrets 1 + verifier, settings 1 + verifier; beta: verifier.
    expect(before.chassis).toMatchObject({ files: 4, envelopes: 8, verified: 8, failed: 0 });
    expect(before.phylaxTokens).toEqual({ tokens: 2, verified: 2, rekeyed: 0, failed: 0 });
    expect(runVaultRekey({ mode: "verify", dataDir, key: NEW_KEY }).ok).toBe(false);

    const rekey = runVaultRekey({ mode: "rekey", dataDir, key: NEW_KEY, previousKey: OLD_KEY });
    expect(rekey.ok).toBe(true);
    expect(rekey.chassis).toMatchObject({ envelopes: 8, rekeyed: 8, verified: 8, failed: 0 });
    expect(rekey.phylaxTokens).toEqual({ tokens: 2, verified: 2, rekeyed: 2, failed: 0 });
    const printed = JSON.stringify(rekey);
    for (const secret of [OLD_KEY, NEW_KEY, "alpha-github-secret", "phylax-token-1"]) {
      expect(printed).not.toContain(secret);
    }

    const again = runVaultRekey({ mode: "rekey", dataDir, key: NEW_KEY, previousKey: OLD_KEY });
    expect(again.ok).toBe(true);
    expect(again.chassis.rekeyed).toBe(0);
    expect(again.phylaxTokens.rekeyed).toBe(0);
    expect(runVaultRekey({ mode: "verify", dataDir, key: NEW_KEY }).ok).toBe(true);
    expect(runVaultRekey({ mode: "verify", dataDir, key: OLD_KEY }).ok).toBe(false);

    const rotated = new ChassisStorage({ dataDir, vaultEncryptionKey: NEW_KEY }).forTenant({ id: "tenant_alpha" });
    const vault = rotated.vault();
    expect(vault.get("github")).toBe("alpha-github-secret");
    expect(vault.get("drive")).toBe("alpha-drive-secret");
    vault.close();
    const named = rotated.vault("phylax-secrets.sqlite");
    expect(named.get("channel")).toBe("alpha-channel-secret");
    named.close();
    expect(new SqliteTenantSettingsStore().keyMetadata(rotated)).toEqual([
      expect.objectContaining({ id: "github_token", maskedValue: "••••1234" }),
    ]);
    expect(() =>
      new ChassisStorage({ dataDir, vaultEncryptionKey: OLD_KEY }).forTenant({ id: "tenant_alpha" }).vault(),
    ).toThrow();
  });

  it("refuses to write anything when a ciphertext sits outside the known stores", async () => {
    const dataDir = await seededDataDir();
    const db = new DatabaseSync(join(dataDir, "tenant_alpha", "vault.sqlite"));
    db.exec("CREATE TABLE stray (value TEXT)");
    db.prepare("INSERT INTO stray VALUES (?)").run("mcp-chassis-vault:v1:a.b.c");
    db.close();

    const report = runVaultRekey({ mode: "rekey", dataDir, key: NEW_KEY, previousKey: OLD_KEY });
    expect(report.ok).toBe(false);
    expect(report.chassis).toMatchObject({ envelopes: 9, rekeyed: 0, failed: 1 });
    expect(report.phylaxTokens.rekeyed).toBe(0);
    const vault = new ChassisStorage({ dataDir, vaultEncryptionKey: OLD_KEY }).forTenant({ id: "tenant_alpha" }).vault();
    expect(vault.get("github")).toBe("alpha-github-secret");
    vault.close();
  });

  it("requires a distinct previous key to rekey", async () => {
    const dataDir = await seededDataDir();
    expect(() => runVaultRekey({ mode: "rekey", dataDir, key: NEW_KEY })).toThrow(/PREVIOUS/);
    expect(() => runVaultRekey({ mode: "rekey", dataDir, key: OLD_KEY, previousKey: OLD_KEY })).toThrow(/differ/);
  });
});
