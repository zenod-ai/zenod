import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChassisStorage, openSqlite } from "./storage.js";

const tempDirs: string[] = [];

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-chassis-storage-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("tenant storage", () => {
  it("places tenant directories and sqlite files under /data/<tenant_id>/ equivalents", async () => {
    const dataDir = await tempDataDir();
    const storage = new ChassisStorage({ dataDir });
    const alpha = storage.forTenant({ id: "tenant_alpha" });
    const beta = storage.forTenant({ id: "tenant_beta" });

    expect(alpha.rootDir).toBe(join(dataDir, "tenant_alpha"));
    expect(beta.rootDir).toBe(join(dataDir, "tenant_beta"));
    expect(alpha.dir("files")).toBe(join(dataDir, "tenant_alpha", "files"));
    expect(beta.dir("files")).toBe(join(dataDir, "tenant_beta", "files"));
    expect(() => alpha.dir("../tenant_beta")).toThrow(/unsafe segment|escaped/);
    expect(() => storage.forTenant({ id: "../tenant_beta" })).toThrow(/tenant id/);

    const alphaDb = alpha.db("state.sqlite");
    const betaDb = beta.db("state.sqlite");
    try {
      alphaDb.exec("CREATE TABLE items (value TEXT NOT NULL); INSERT INTO items (value) VALUES ('alpha');");
      betaDb.exec("CREATE TABLE items (value TEXT NOT NULL); INSERT INTO items (value) VALUES ('beta');");

      expect(alphaDb.prepare("SELECT value FROM items").get()).toEqual({ value: "alpha" });
      expect(betaDb.prepare("SELECT value FROM items").get()).toEqual({ value: "beta" });
    } finally {
      alphaDb.close();
      betaDb.close();
    }
  });

  it("opens sqlite with WAL and busy_timeout", async () => {
    const dataDir = await tempDataDir();
    const db = openSqlite(join(dataDir, "tenant_a", "unit.sqlite"), 7_500);
    try {
      expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 7500 });
    } finally {
      db.close();
    }
  });

  it("keeps vault rows tenant-keyed and isolated", async () => {
    const dataDir = await tempDataDir();
    const storage = new ChassisStorage({ dataDir });
    const alphaVault = storage.forTenant({ id: "tenant_alpha" }).vault();
    const betaVault = storage.forTenant({ id: "tenant_beta" }).vault();

    try {
      alphaVault.set("github", "alpha-secret");
      betaVault.set("github", "beta-secret");

      expect(alphaVault.get("github")).toBe("alpha-secret");
      expect(betaVault.get("github")).toBe("beta-secret");
      expect(alphaVault.listKeys()).toEqual(["github"]);
      expect(betaVault.listKeys()).toEqual(["github"]);
    } finally {
      alphaVault.close();
      betaVault.close();
    }

    const alphaRows = openSqlite(join(dataDir, "tenant_alpha", "vault.sqlite"));
    const betaRows = openSqlite(join(dataDir, "tenant_beta", "vault.sqlite"));
    try {
      expect(alphaRows.prepare("SELECT tenant_id, key, value FROM vault_entries").all()).toEqual([
        { tenant_id: "tenant_alpha", key: "github", value: "alpha-secret" },
      ]);
      expect(betaRows.prepare("SELECT tenant_id, key, value FROM vault_entries").all()).toEqual([
        { tenant_id: "tenant_beta", key: "github", value: "beta-secret" },
      ]);
    } finally {
      alphaRows.close();
      betaRows.close();
    }
  });
});
