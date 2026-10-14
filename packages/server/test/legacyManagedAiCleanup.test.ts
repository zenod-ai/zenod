import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupLegacyManagedAi, LEGACY_MANAGED_AI_FILES } from "../src/legacyManagedAiCleanup.js";

describe("legacy managed-AI cleanup (D30)", () => {
  let dir: string;
  let accountsPath: string;
  let lines: string[];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "zenod-legacy-ai-"));
    accountsPath = join(dir, "customer-accounts.json");
    lines = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const fakeRuntimes = (keys: Record<string, string>) => {
    const deleted: string[] = [];
    return {
      deleted,
      runtimeForAccount: (account: { tenant_id: string | null }) => ({
        settings: {
          get: (key: string) => (key === "openrouter_api_key" ? keys[account.tenant_id!] ?? null : null),
          set: (key: string, value: string) => {
            if (key === "openrouter_api_key" && value === "") {
              deleted.push(account.tenant_id!);
              delete keys[account.tenant_id!];
            }
          },
        },
      }) as never,
    };
  };

  it("deletes managed tenant keys, account fields and dead files; leaves the rest and logs counts only", () => {
    writeFileSync(accountsPath, JSON.stringify({
      a: { account_id: "a", tenant_id: "t-managed", managed_ai_key_hash: "h-secret", managed_ai_key_name: "zenod-tenant:x", managed_ai_status: "active", tier: "monthly" },
      b: { account_id: "b", tenant_id: "t-other", managed_ai_status: "canceled", managed_ai_limit_usd: 2 },
      c: { account_id: "c", tenant_id: "t-clean", tier: "monthly" },
    }));
    for (const f of LEGACY_MANAGED_AI_FILES.slice(0, 3)) writeFileSync(join(dir, f), "x");
    writeFileSync(join(dir, "customer-identities.json"), "{}");
    const keys: Record<string, string> = { "t-managed": "sk-secret-value", "t-other": "sk-byo", "t-clean": "sk-clean" };
    const rt = fakeRuntimes(keys);

    const counts = cleanupLegacyManagedAi({ dataDir: dir, accountsPath, runtimeForAccount: rt.runtimeForAccount, log: (l) => lines.push(l) });

    expect(rt.deleted).toEqual(["t-managed"]);
    expect(keys).toEqual({ "t-other": "sk-byo", "t-clean": "sk-clean" });
    expect(counts).toMatchObject({ tenantKeysDeleted: 1, accountRowsCleaned: 2, accountFieldsRemoved: 5, filesDeleted: 3, errors: 0 });
    const store = JSON.parse(readFileSync(accountsPath, "utf8"));
    expect(JSON.stringify(store)).not.toContain("managed_ai");
    expect(store.a).toEqual({ account_id: "a", tenant_id: "t-managed", tier: "monthly" });
    expect(existsSync(join(dir, "customer-identities.json"))).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/secret|sk-/);

    // Second run: nothing left to do, nothing logged.
    lines.length = 0;
    const again = cleanupLegacyManagedAi({ dataDir: dir, accountsPath, runtimeForAccount: rt.runtimeForAccount, log: (l) => lines.push(l) });
    expect(again).toMatchObject({ tenantKeysDeleted: 0, accountFieldsRemoved: 0, filesDeleted: 0, errors: 0 });
    expect(lines).toEqual([]);
  });

  it("deletes the stored key of the two named accountless test tenants only, idempotently, and never a tenant with an account", () => {
    writeFileSync(accountsPath, JSON.stringify({ a: { account_id: "a", tenant_id: "jordiepic32test-5oqq39", tier: "monthly" } }));
    const keys: Record<string, string> = {
      "jordiepic32clean-ml7rz0": "sk-secret-1",
      "jordiepic32test-5oqq39": "sk-has-account",
      "someone-else": "sk-other",
    };
    const rt = fakeRuntimes(keys);
    const run = () => cleanupLegacyManagedAi({
      dataDir: dir,
      accountsPath,
      runtimeForTenant: (tenantId) => rt.runtimeForAccount({ tenant_id: tenantId }),
      log: (l) => lines.push(l),
    });

    const counts = run();
    expect(counts).toMatchObject({ accountlessKeysDeleted: 1, tenantKeysDeleted: 0, errors: 0 });
    expect(keys).toEqual({ "jordiepic32test-5oqq39": "sk-has-account", "someone-else": "sk-other" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("accountless_keys_deleted=1");
    expect(lines[0]).not.toMatch(/secret|sk-/);

    lines.length = 0;
    expect(run()).toMatchObject({ accountlessKeysDeleted: 0, errors: 0 });
    expect(lines).toEqual([]);
  });

  it("keeps account attribution for a retry when a tenant key deletion fails", () => {
    writeFileSync(accountsPath, JSON.stringify({ a: { account_id: "a", tenant_id: "t", managed_ai_key_hash: "h" } }));
    const counts = cleanupLegacyManagedAi({
      dataDir: dir,
      accountsPath,
      runtimeForAccount: () => { throw new Error("boom"); },
      log: (l) => lines.push(l),
    });
    expect(counts.tenantKeysFailed).toBe(1);
    expect(readFileSync(accountsPath, "utf8")).toContain("managed_ai_key_hash");
  });

  it("tolerates an unreadable accounts file and still removes dead files", () => {
    writeFileSync(accountsPath, "{not json");
    writeFileSync(join(dir, "customer-managed-ai-audit.jsonl"), "x");
    const counts = cleanupLegacyManagedAi({ dataDir: dir, accountsPath, log: (l) => lines.push(l) });
    expect(counts.errors).toBe(1);
    expect(counts.filesDeleted).toBe(1);
    expect(readFileSync(accountsPath, "utf8")).toBe("{not json");
  });
});
