import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteTenantSettingsStore } from "./settings.js";
import { ChassisStorage, openSqlite } from "./storage.js";

const tempDirs: string[] = [];
const TEST_VAULT_KEY = Buffer.alloc(32, 0x41);

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("durable tenant settings", () => {
  it("encrypts secret settings while preserving masked restart behavior", async () => {
    const dataDir = await tempDataDir();
    const tenant = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: TEST_VAULT_KEY,
    }).forTenant({ id: "tenant_alpha" });
    const store = new SqliteTenantSettingsStore();

    const saved = store.update(tenant, {
      vault_repo: "tenant-alpha/vault",
      github_token: "github-world-secret-1234",
      openai_api_key: "openai-world-secret-5678",
    });
    expect(saved.settings).toMatchObject({
      vault_repo: "tenant-alpha/vault",
      github_token: "••••1234",
      openai_api_key: "••••5678",
    });
    expect(store.keyMetadata(tenant)).toEqual([
      expect.objectContaining({ id: "github_token", maskedValue: "••••1234" }),
      expect.objectContaining({
        id: "openai_api_key",
        maskedValue: "••••5678",
      }),
    ]);
    expectPersistedBytesNotToContain(dataDir, [
      "github-world-secret-1234",
      "openai-world-secret-5678",
    ]);

    const restarted = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: TEST_VAULT_KEY,
    }).forTenant({ id: "tenant_alpha" });
    expect(store.snapshot(restarted).settings).toMatchObject({
      vault_repo: "tenant-alpha/vault",
      github_token: "••••1234",
      openai_api_key: "••••5678",
    });
  });

  it("migrates legacy plaintext secret rows and scrubs database bytes", async () => {
    const dataDir = await tempDataDir();
    const storage = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: TEST_VAULT_KEY,
    });
    const tenant = storage.forTenant({ id: "tenant_alpha" });
    const db = openSqlite(join(tenant.rootDir, "chassis-settings.sqlite"));
    db.exec(`
      CREATE TABLE tenant_settings (
        setting_key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const insert = db.prepare(
      "INSERT INTO tenant_settings (setting_key, value, created_at, updated_at) VALUES (?, ?, ?, ?)",
    );
    insert.run("vault_repo", "tenant-alpha/vault", 1, 1);
    insert.run("github_token", "legacy-settings-secret-9876", 1, 2);
    const legacyWriter = db.prepare(
      "UPDATE tenant_settings SET value = ? WHERE setting_key = ?",
    );
    expect(persistedBytesContain(dataDir, "legacy-settings-secret-9876")).toBe(
      true,
    );

    const store = new SqliteTenantSettingsStore();
    expect(store.snapshot(tenant).settings).toMatchObject({
      vault_repo: "tenant-alpha/vault",
      github_token: "••••9876",
    });
    expectPersistedBytesNotToContain(dataDir, ["legacy-settings-secret-9876"]);
    expect(() =>
      legacyWriter.run("post-migration-settings-secret", "github_token"),
    ).toThrow(/no such column|schema/);
    db.close();

    const migrated = openSqlite(
      join(tenant.rootDir, "chassis-settings.sqlite"),
    );
    expect(
      migrated
        .prepare(
          "SELECT stored_value FROM tenant_settings WHERE setting_key = ?",
        )
        .get("github_token"),
    ).toEqual({
      stored_value: expect.stringMatching(/^mcp-chassis-vault:v1:/),
    });
    expect(
      migrated
        .prepare("SELECT value FROM settings_metadata WHERE key = ?")
        .get("secret_encryption_state"),
    ).toEqual({ value: "v1" });
    migrated.close();
  });

  it("allows non-secret settings without a key and fails closed for secrets", async () => {
    const dataDir = await tempDataDir();
    const tenant = new ChassisStorage({ dataDir }).forTenant({
      id: "tenant_alpha",
    });
    const store = new SqliteTenantSettingsStore();

    expect(
      store.update(tenant, { vault_repo: "tenant-alpha/vault" }).settings
        .vault_repo,
    ).toBe("tenant-alpha/vault");
    expect(() =>
      store.update(tenant, { github_token: "must-not-persist" }),
    ).toThrow(/CHASSIS_VAULT_MASTER_KEY/);
    expectPersistedBytesNotToContain(dataDir, ["must-not-persist"]);
  });

  it("rejects wrong-key updates before mutating any setting", async () => {
    const dataDir = await tempDataDir();
    const store = new SqliteTenantSettingsStore();
    const original = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: TEST_VAULT_KEY,
    }).forTenant({ id: "tenant_alpha" });
    store.update(original, {
      vault_repo: "original/vault",
      github_token: "original-secret-4444",
    });

    const wrongKey = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: Buffer.alloc(32, 0x42),
    }).forTenant({ id: "tenant_alpha" });
    expect(() =>
      store.update(wrongKey, {
        vault_repo: "must-not-commit",
        github_token: "must-not-commit-secret",
      }),
    ).toThrow(/could not be decrypted/);

    expect(store.snapshot(original).settings).toMatchObject({
      vault_repo: "original/vault",
      github_token: "••••4444",
    });
    expectPersistedBytesNotToContain(dataDir, [
      "original-secret-4444",
      "must-not-commit-secret",
    ]);
  });

  it("binds the key before the first secret is written", async () => {
    const dataDir = await tempDataDir();
    const store = new SqliteTenantSettingsStore();
    const original = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: TEST_VAULT_KEY,
    }).forTenant({ id: "tenant_alpha" });
    store.update(original, { vault_repo: "original/vault" });

    const wrongKey = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: Buffer.alloc(32, 0x42),
    }).forTenant({ id: "tenant_alpha" });
    expect(() =>
      store.update(wrongKey, { github_token: "wrong-first-secret" }),
    ).toThrow(/could not be decrypted/);
    expect(store.snapshot(original).settings).toMatchObject({
      vault_repo: "original/vault",
      github_token: null,
    });
    expectPersistedBytesNotToContain(dataDir, ["wrong-first-secret"]);
  });
});

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-chassis-settings-"));
  tempDirs.push(dir);
  return dir;
}

function persistedFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

function persistedBytesContain(root: string, value: string): boolean {
  const needle = Buffer.from(value, "utf8");
  return persistedFiles(root).some((path) =>
    readFileSync(path).includes(needle),
  );
}

function expectPersistedBytesNotToContain(
  root: string,
  values: string[],
): void {
  const files = persistedFiles(root);
  for (const value of values) {
    const needle = Buffer.from(value, "utf8");
    expect(
      files.filter((path) => readFileSync(path).includes(needle)),
      `raw value ${value} was persisted`,
    ).toEqual([]);
  }
}
