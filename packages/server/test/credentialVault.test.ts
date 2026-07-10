import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChassisStorage } from "@zenod/mcp-chassis";
import { SqliteStateStore } from "zenod";
import { createApp } from "../src/app.js";
import { ChassisCredentialVault, isCredentialHandle } from "../src/credentialVault.js";
import { Runtime } from "../src/runtime.js";

const dirs: string[] = [];

async function runtimeFor(tenantId: string): Promise<Runtime> {
  const dataDir = await tempDir(tenantId);
  return new Runtime(dataDir, undefined, {
    seedFromEnv: false,
    tenantId,
    credentialMasterKey: "test-only-master-key",
  });
}

async function tempDir(label: string): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), `zenod-credentials-${label}-`));
  dirs.push(dataDir);
  return dataDir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("tenant credential custody", () => {
  it("stores repo and provider credentials as opaque handles with encrypted values", async () => {
    const runtime = await runtimeFor("tenant-alpha");
    try {
      runtime.settings.set("github_token", "ghp_alpha_secret");
      runtime.settings.set("anthropic_api_key", "sk-ant-alpha-secret");

      const githubHandle = runtime.state.getSetting("github_token");
      const providerHandle = runtime.state.getSetting("anthropic_api_key");
      expect(githubHandle).toSatisfy((value: string | null) => Boolean(value && isCredentialHandle(value)));
      expect(providerHandle).toSatisfy((value: string | null) => Boolean(value && isCredentialHandle(value)));
      expect(runtime.settings.get("github_token")).toBe("ghp_alpha_secret");
      expect(runtime.settings.activeApiKey()).toBe("sk-ant-alpha-secret");

      const databaseBytes = await readFile(join(runtime.dataDir, "vault.sqlite"));
      expect(databaseBytes.includes(Buffer.from("ghp_alpha_secret"))).toBe(false);
      expect(databaseBytes.includes(Buffer.from("sk-ant-alpha-secret"))).toBe(false);
      expect(runtime.credentialVault.list().map((entry) => entry.key)).toEqual([
        "anthropic_api_key",
        "github_token",
      ]);
    } finally {
      runtime.close();
    }
  });

  it("fails closed for cross-tenant handles and wrong credential classes", async () => {
    const alpha = await runtimeFor("tenant-alpha");
    const beta = await runtimeFor("tenant-beta");
    try {
      alpha.settings.set("github_token", "ghp_alpha_secret");
      const alphaHandle = alpha.state.getSetting("github_token")!;

      beta.state.setSetting("github_token", alphaHandle);
      expect(beta.settings.get("github_token")).toBeNull();
      expect(alpha.credentialVault.materialize("anthropic_api_key", alphaHandle)).toBeNull();
      expect(beta.credentialVault.materialize("github_token", alphaHandle)).toBeNull();
    } finally {
      alpha.close();
      beta.close();
    }
  });

  it("migrates legacy plaintext settings into custody without changing trusted reads", async () => {
    const dataDir = await tempDir("tenant-migrate");
    const legacyState = new SqliteStateStore(join(dataDir, "zenod.sqlite"));
    legacyState.setSetting("github_token", "ghp_legacy_secret");
    legacyState.setSetting("anthropic_api_key", "sk-ant-legacy-secret");
    legacyState.close();

    const runtime = new Runtime(dataDir, undefined, {
      seedFromEnv: false,
      tenantId: "tenant-migrate",
      credentialMasterKey: "test-only-master-key",
    });
    try {
      expect(runtime.settings.get("github_token")).toBe("ghp_legacy_secret");
      expect(runtime.settings.get("anthropic_api_key")).toBe("sk-ant-legacy-secret");
      expect(isCredentialHandle(runtime.state.getSetting("github_token")!)).toBe(true);
      expect(isCredentialHandle(runtime.state.getSetting("anthropic_api_key")!)).toBe(true);
    } finally {
      runtime.close();
    }
  });

  it("preserves standalone credentials across restart with a private local world key", async () => {
    const dataDir = await tempDir("standalone");
    const first = new Runtime(dataDir, undefined, { seedFromEnv: false });
    first.settings.set("github_token", "ghp_standalone_secret");
    first.settings.set("openai_api_key", "sk-standalone-secret");
    first.close();

    const keyStat = await stat(join(dataDir, ".zenod-vault-key"));
    expect(keyStat.mode & 0o777).toBe(0o600);

    const restarted = new Runtime(dataDir, undefined, { seedFromEnv: false });
    try {
      expect(restarted.settings.get("github_token")).toBe("ghp_standalone_secret");
      expect(restarted.settings.get("openai_api_key")).toBe("sk-standalone-secret");
    } finally {
      restarted.close();
    }
  });

  it("implements hosted chassis custody with tenant, key, and handle binding", async () => {
    const dataRoot = await tempDir("chassis");
    const storage = new ChassisStorage({ dataDir: dataRoot });
    const alphaStorage = storage.forTenant({ id: "tenant-alpha" });
    const betaStorage = storage.forTenant({ id: "tenant-beta" });
    const alphaCredentials = new ChassisCredentialVault(alphaStorage);
    const betaCredentials = new ChassisCredentialVault(betaStorage);
    const alpha = new Runtime(alphaStorage.rootDir, undefined, {
      seedFromEnv: false,
      tenantId: alphaStorage.tenant.id,
      credentialVault: alphaCredentials,
    });
    const beta = new Runtime(betaStorage.rootDir, undefined, {
      seedFromEnv: false,
      tenantId: betaStorage.tenant.id,
      credentialVault: betaCredentials,
    });
    try {
      alpha.settings.applyProvision({
        token: "token-alpha",
        provider: "anthropic",
        api_key: "sk-ant-alpha",
        github_token: "ghp_alpha",
        vault_repo: "owner/alpha",
      });
      beta.settings.applyProvision({
        token: "token-beta",
        provider: "anthropic",
        api_key: "sk-ant-beta",
        github_token: "ghp_beta",
        vault_repo: "owner/beta",
      });

      expect(alpha.dataDir).toBe(join(dataRoot, "tenant-alpha"));
      expect(beta.dataDir).toBe(join(dataRoot, "tenant-beta"));
      expect(alpha.settings.get("github_token")).toBe("ghp_alpha");
      expect(beta.settings.get("github_token")).toBe("ghp_beta");
      const alphaHandle = alpha.state.getSetting("github_token")!;
      const betaHandle = beta.state.getSetting("github_token")!;
      expect(isCredentialHandle(alphaHandle)).toBe(true);
      expect(isCredentialHandle(betaHandle)).toBe(true);
      expect(alphaHandle).not.toBe(betaHandle);
      expect(alphaCredentials.materialize("github_token", betaHandle)).toBeNull();
      expect(betaCredentials.materialize("github_token", alphaHandle)).toBeNull();
      expect(alphaCredentials.materialize("anthropic_api_key", alphaHandle)).toBeNull();
      expect(alphaCredentials.list().map((entry) => entry.key)).toEqual([
        "anthropic_api_key",
        "github_token",
      ]);

      const alphaRawVault = alphaStorage.vault();
      const betaRawVault = betaStorage.vault();
      try {
        const recordKey = alphaRawVault.listKeys().find((key) => key.endsWith(".github_token"))!;
        betaRawVault.set(recordKey, alphaRawVault.get(recordKey)!);
      } finally {
        alphaRawVault.close();
        betaRawVault.close();
      }
      expect(betaCredentials.materialize("github_token", alphaHandle)).toBeNull();

      beta.state.setSetting("github_token", alphaHandle);
      expect(beta.settings.get("github_token")).toBeNull();
      expect(betaCredentials.delete("github_token", alphaHandle)).toBe(false);
      expect(alphaCredentials.delete("github_token", alphaHandle)).toBe(true);
      expect(alphaCredentials.materialize("github_token", alphaHandle)).toBeNull();

      const alphaSettingsDb = alphaStorage.db("zenod.sqlite");
      try {
        const rows = alphaSettingsDb
          .prepare("SELECT key, value FROM settings WHERE key IN ('github_token', 'anthropic_api_key') ORDER BY key")
          .all();
        const serialized = JSON.stringify(rows);
        expect(serialized).not.toContain("ghp_alpha");
        expect(serialized).not.toContain("sk-ant-alpha");
        expect(serialized).toContain("zenod-secret:v1:");
      } finally {
        alphaSettingsDb.close();
      }

      await expect(stat(join(alphaStorage.rootDir, ".zenod-vault-key"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      alpha.close();
      beta.close();
    }
  });

  it("supports hosted put, update, list, delete, and close without exposing values", async () => {
    const dataRoot = await tempDir("chassis-lifecycle");
    const storage = new ChassisStorage({ dataDir: dataRoot }).forTenant({ id: "tenant-lifecycle" });
    const credentials = new ChassisCredentialVault(storage, { vaultName: "credentials.sqlite" });

    const firstHandle = credentials.put("github_token", "ghp_first");
    const secondHandle = credentials.put("github_token", "ghp_second");
    expect(secondHandle).toBe(firstHandle);
    expect(credentials.materialize("github_token", firstHandle)).toBe("ghp_second");
    expect(credentials.materialize("openai_api_key", firstHandle)).toBeNull();
    expect(credentials.list()).toEqual([
      expect.objectContaining({ key: "github_token", handle: firstHandle }),
    ]);
    expect(JSON.stringify(credentials.list())).not.toContain("ghp_second");
    const wrongHandle = `${firstHandle.slice(0, -1)}${firstHandle.endsWith("0") ? "1" : "0"}`;
    expect(credentials.delete("github_token", wrongHandle)).toBe(false);
    expect(credentials.delete("github_token", firstHandle)).toBe(true);
    expect(credentials.list()).toEqual([]);
    credentials.close();
    expect(() => credentials.list()).toThrow("credential vault is closed");
  });

  it("returns only masked credential metadata and does not log submitted values", async () => {
    const runtime = await runtimeFor("tenant-api");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      runtime.settings.applyProvision({ token: "tenant-api-token" });
      const app = createApp(runtime);
      const response = await app.request("/api/settings", {
        method: "PUT",
        headers: { Authorization: "Bearer tenant-api-token", "Content-Type": "application/json" },
        body: JSON.stringify({
          vault_repo: "owner/private-vault",
          github_token: "ghp_api_secret1234",
          anthropic_api_key: "sk-ant-api-secret5678",
        }),
      });
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toContain("ghp_api_secret1234");
      expect(body).not.toContain("sk-ant-api-secret5678");
      expect(body).not.toContain("zenod-secret:v1:");
      expect(body).toContain("••••1234");
      expect(body).toContain("••••5678");

      const logs = [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls].flat().join(" ");
      expect(logs).not.toContain("ghp_api_secret1234");
      expect(logs).not.toContain("sk-ant-api-secret5678");
    } finally {
      runtime.close();
    }
  });
});
