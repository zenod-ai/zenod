import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChassisStorage, openSqlite } from "./storage.js";

const tempDirs: string[] = [];
const TEST_VAULT_KEY = Buffer.alloc(32, 0x31);
const OTHER_VAULT_KEY = Buffer.alloc(32, 0x32);

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-chassis-storage-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("tenant storage", () => {
  it("places tenant directories and sqlite files under /data/<tenant_id>/ equivalents", async () => {
    const dataDir = await tempDataDir();
    const storage = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: TEST_VAULT_KEY,
    });
    const alpha = storage.forTenant({ id: "tenant_alpha" });
    const beta = storage.forTenant({ id: "tenant_beta" });

    expect(alpha.rootDir).toBe(join(dataDir, "tenant_alpha"));
    expect(beta.rootDir).toBe(join(dataDir, "tenant_beta"));
    expect(alpha.dir("files")).toBe(join(dataDir, "tenant_alpha", "files"));
    expect(beta.dir("files")).toBe(join(dataDir, "tenant_beta", "files"));
    expect(() => alpha.dir("../tenant_beta")).toThrow(/unsafe segment|escaped/);
    expect(() => storage.forTenant({ id: "../tenant_beta" })).toThrow(
      /tenant id/,
    );

    const alphaDb = alpha.db("state.sqlite");
    const betaDb = beta.db("state.sqlite");
    try {
      alphaDb.exec(
        "CREATE TABLE items (value TEXT NOT NULL); INSERT INTO items (value) VALUES ('alpha');",
      );
      betaDb.exec(
        "CREATE TABLE items (value TEXT NOT NULL); INSERT INTO items (value) VALUES ('beta');",
      );

      expect(alphaDb.prepare("SELECT value FROM items").get()).toEqual({
        value: "alpha",
      });
      expect(betaDb.prepare("SELECT value FROM items").get()).toEqual({
        value: "beta",
      });
    } finally {
      alphaDb.close();
      betaDb.close();
    }
  });

  it("opens sqlite with WAL and busy_timeout", async () => {
    const dataDir = await tempDataDir();
    const db = openSqlite(join(dataDir, "tenant_a", "unit.sqlite"), 7_500);
    try {
      expect(db.prepare("PRAGMA journal_mode").get()).toEqual({
        journal_mode: "wal",
      });
      expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({
        timeout: 7500,
      });
    } finally {
      db.close();
    }
  });

  it("encrypts vault rows while keeping tenant-keyed reads isolated", async () => {
    const dataDir = await tempDataDir();
    const storage = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: TEST_VAULT_KEY,
    });
    const alphaVault = storage.forTenant({ id: "tenant_alpha" }).vault();
    const betaVault = storage.forTenant({ id: "tenant_beta" }).vault();

    try {
      alphaVault.set("github", "alpha-secret");
      alphaVault.set("empty", "");
      alphaVault.set("unicode", "secrèt-世界");
      alphaVault.set("json", '{"token":"nested-secret"}');
      alphaVault.set("prefix", "mcp-chassis-vault:v1:not-an-envelope");
      betaVault.set("github", "beta-secret");

      expect(alphaVault.get("github")).toBe("alpha-secret");
      expect(alphaVault.get("empty")).toBe("");
      expect(alphaVault.get("unicode")).toBe("secrèt-世界");
      expect(alphaVault.get("json")).toBe('{"token":"nested-secret"}');
      expect(alphaVault.get("prefix")).toBe(
        "mcp-chassis-vault:v1:not-an-envelope",
      );
      expect(betaVault.get("github")).toBe("beta-secret");
      expect(alphaVault.listKeys()).toEqual([
        "empty",
        "github",
        "json",
        "prefix",
        "unicode",
      ]);
      expect(betaVault.listKeys()).toEqual(["github"]);
    } finally {
      alphaVault.close();
      betaVault.close();
    }

    const alphaRows = openSqlite(join(dataDir, "tenant_alpha", "vault.sqlite"));
    const betaRows = openSqlite(join(dataDir, "tenant_beta", "vault.sqlite"));
    try {
      const alpha = alphaRows
        .prepare(
          "SELECT tenant_id, key, encrypted_value AS value FROM vault_entries",
        )
        .get() as { tenant_id: string; key: string; value: string };
      const beta = betaRows
        .prepare(
          "SELECT tenant_id, key, encrypted_value AS value FROM vault_entries",
        )
        .get() as { tenant_id: string; key: string; value: string };
      expect(alpha).toMatchObject({ tenant_id: "tenant_alpha", key: "github" });
      expect(beta).toMatchObject({ tenant_id: "tenant_beta", key: "github" });
      expect(alpha.value).toMatch(/^mcp-chassis-vault:v1:/);
      expect(beta.value).toMatch(/^mcp-chassis-vault:v1:/);
      expect(alpha.value).not.toBe(beta.value);
    } finally {
      alphaRows.close();
      betaRows.close();
    }
    expectPersistedBytesNotToContain(dataDir, [
      "alpha-secret",
      "beta-secret",
      "secrèt-世界",
      "nested-secret",
      "mcp-chassis-vault:v1:not-an-envelope",
    ]);
  });

  it("fails closed when tenant vault encryption has no configured key", async () => {
    const dataDir = await tempDataDir();
    const storage = new ChassisStorage({ dataDir });

    expect(() => storage.forTenant({ id: "tenant_alpha" }).vault()).toThrow(
      /CHASSIS_VAULT_MASTER_KEY/,
    );
    expect(persistedFiles(dataDir)).toEqual([]);
  });

  it("preserves encrypted values across restart and rejects a different master key", async () => {
    const dataDir = await tempDataDir();
    const first = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: TEST_VAULT_KEY,
    });
    const initial = first.forTenant({ id: "tenant_alpha" }).vault();
    initial.set("github", "restart-secret");
    initial.close();

    const restarted = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: TEST_VAULT_KEY,
    })
      .forTenant({ id: "tenant_alpha" })
      .vault();
    expect(restarted.get("github")).toBe("restart-secret");
    restarted.close();

    expect(() =>
      new ChassisStorage({
        dataDir,
        vaultEncryptionKey: OTHER_VAULT_KEY,
      })
        .forTenant({ id: "tenant_alpha" })
        .vault(),
    ).toThrow(/could not be decrypted/);
    const unchanged = first.forTenant({ id: "tenant_alpha" }).vault();
    expect(unchanged.get("github")).toBe("restart-secret");
    unchanged.close();
    expectPersistedBytesNotToContain(dataDir, ["restart-secret"]);
  });

  it("keeps updates and deletes secret-free in database, WAL, and SHM bytes", async () => {
    const dataDir = await tempDataDir();
    const storage = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: TEST_VAULT_KEY,
    });
    const vault = storage.forTenant({ id: "tenant_alpha" }).vault();
    vault.set("github", "first-world-secret");
    vault.set("github", "second-world-secret");
    expect(vault.get("github")).toBe("second-world-secret");
    expectSqliteSidecarsExist(dataDir, "tenant_alpha", "vault.sqlite");
    expectPersistedBytesNotToContain(dataDir, [
      "first-world-secret",
      "second-world-secret",
    ]);
    expect(vault.delete("github")).toBe(1);
    expect(vault.get("github")).toBeNull();
    vault.close();
    expectPersistedBytesNotToContain(dataDir, [
      "first-world-secret",
      "second-world-secret",
    ]);
  });

  it("migrates legacy plaintext rows and securely rewrites active SQLite files", async () => {
    const dataDir = await tempDataDir();
    const path = join(dataDir, "tenant_alpha", "vault.sqlite");
    const legacy = openSqlite(path);
    legacy.exec(`
      CREATE TABLE vault_entries (
        tenant_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, key)
      );
    `);
    legacy
      .prepare(
        "INSERT INTO vault_entries (tenant_id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("tenant_alpha", "github", "legacy-plaintext-secret", 1, 1);
    legacy
      .prepare(
        "INSERT INTO vault_entries (tenant_id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        "tenant_alpha",
        "prefix",
        "mcp-chassis-vault:v1:legacy-prefix-secret",
        1,
        1,
      );
    const legacyWriter = legacy.prepare(
      "UPDATE vault_entries SET value = ? WHERE tenant_id = ? AND key = ?",
    );
    expect(persistedBytesContain(dataDir, "legacy-plaintext-secret")).toBe(
      true,
    );

    const migrated = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: TEST_VAULT_KEY,
    })
      .forTenant({ id: "tenant_alpha" })
      .vault();
    expect(migrated.get("github")).toBe("legacy-plaintext-secret");
    expect(migrated.get("prefix")).toBe(
      "mcp-chassis-vault:v1:legacy-prefix-secret",
    );
    migrated.close();
    expect(() =>
      legacyWriter.run("post-migration-plaintext", "tenant_alpha", "github"),
    ).toThrow(/no such column|schema/);
    legacy.close();

    expectPersistedBytesNotToContain(dataDir, [
      "legacy-plaintext-secret",
      "legacy-prefix-secret",
    ]);
    const reopened = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: TEST_VAULT_KEY,
    })
      .forTenant({ id: "tenant_alpha" })
      .vault();
    expect(reopened.get("github")).toBe("legacy-plaintext-secret");
    reopened.close();
  });

  it("authenticates ciphertext against its tenant, vault, and entry key", async () => {
    const dataDir = await tempDataDir();
    const tenant = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: TEST_VAULT_KEY,
    }).forTenant({ id: "tenant_alpha" });
    const vault = tenant.vault();
    vault.set("first", "aad-bound-secret");
    vault.set("second", "replacement-secret");
    vault.close();

    const db = openSqlite(join(dataDir, "tenant_alpha", "vault.sqlite"));
    const transplanted = db
      .prepare(
        "SELECT encrypted_value AS value FROM vault_entries WHERE key = 'first'",
      )
      .get() as { value: string };
    db.prepare(
      "UPDATE vault_entries SET encrypted_value = ? WHERE key = 'second'",
    ).run(transplanted.value);
    db.close();

    const reopened = tenant.vault();
    expect(reopened.get("first")).toBe("aad-bound-secret");
    expect(() => reopened.get("second")).toThrow(/could not be decrypted/);
    reopened.close();
  });

  it("rejects weak or malformed vault master keys", async () => {
    const dataDir = await tempDataDir();
    expect(
      () => new ChassisStorage({ dataDir, vaultEncryptionKey: "not-a-key" }),
    ).toThrow(/32-byte/);
  });
});

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

function expectSqliteSidecarsExist(
  root: string,
  tenantId: string,
  database: string,
): void {
  const path = join(root, tenantId, database);
  expect(existsSync(path)).toBe(true);
  expect(existsSync(`${path}-wal`)).toBe(true);
  expect(existsSync(`${path}-shm`)).toBe(true);
}
