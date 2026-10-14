import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { CustomerAccount } from "./customerAccounts.js";
import type { Runtime } from "./runtime.js";

/**
 * D30 cleanup: hosted Zenod uses one platform OpenRouter key, so the per-customer
 * ("managed AI") key lifecycle that #1400 removed left stored data behind. This
 * idempotent startup migration deletes exactly that data and nothing else:
 *
 *  1. the tenant `openrouter_api_key` setting, only for tenants whose customer
 *     account recorded a managed child key (`managed_ai_key_hash` or a
 *     `zenod-tenant:` `managed_ai_key_name`); other tenants' keys are never touched;
 *  2. every `managed_ai_*` field on customer-account rows;
 *  3. the dead sidecar files of the removed lifecycle (exact names below).
 *
 * It logs counts only, never values, and never throws (startup must not fail on it).
 * Order matters: tenant keys are attributed from the account fields, so the account
 * fields are stripped last and a partial failure is retried on the next start.
 */

export const LEGACY_MANAGED_AI_FIELD_PREFIX = "managed_ai_";
export const LEGACY_MANAGED_AI_KEY_NAME_PREFIX = "zenod-tenant:";

/** Exact basenames of the removed lifecycle's files inside the data dir (plus SQLite sidecars). */
const SQLITE_SIDECARS = ["", "-wal", "-shm", "-journal"];
export const LEGACY_MANAGED_AI_FILES: readonly string[] = [
  "customer-managed-ai-audit.jsonl",
  ...["customer-managed-ai-admission.sqlite", "customer-managed-ai-coordination.sqlite", "managed-ai-downstream.sqlite"]
    .flatMap((name) => SQLITE_SIDECARS.map((suffix) => `${name}${suffix}`)),
];

export interface LegacyManagedAiCleanupCounts {
  accountFilesRewritten: number;
  accountRowsCleaned: number;
  accountFieldsRemoved: number;
  tenantKeysDeleted: number;
  tenantKeysFailed: number;
  filesDeleted: number;
  errors: number;
}

export interface LegacyManagedAiCleanupOptions {
  dataDir: string;
  /** Customer-account JSON store path (`customer-accounts[-product].json`). */
  accountsPath: string;
  /** Resolves a tenant runtime for an account; omitted for services that own no tenant settings (Phylax). */
  runtimeForAccount?: (account: CustomerAccount) => Pick<Runtime, "settings"> | null;
  log?: (line: string) => void;
}

type RawStore = Record<string, Record<string, unknown>>;

function hadManagedKey(row: Record<string, unknown>): boolean {
  const hash = row.managed_ai_key_hash;
  const name = row.managed_ai_key_name;
  return (typeof hash === "string" && hash !== "") ||
    (typeof name === "string" && name.startsWith(LEGACY_MANAGED_AI_KEY_NAME_PREFIX));
}

export function cleanupLegacyManagedAi(options: LegacyManagedAiCleanupOptions): LegacyManagedAiCleanupCounts {
  const log = options.log ?? ((line: string) => console.log(line));
  const counts: LegacyManagedAiCleanupCounts = {
    accountFilesRewritten: 0,
    accountRowsCleaned: 0,
    accountFieldsRemoved: 0,
    tenantKeysDeleted: 0,
    tenantKeysFailed: 0,
    filesDeleted: 0,
    errors: 0,
  };

  let store: RawStore | null = null;
  try {
    if (existsSync(options.accountsPath)) {
      const parsed = JSON.parse(readFileSync(options.accountsPath, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) store = parsed as RawStore;
    }
  } catch {
    counts.errors += 1;
  }

  // 1. Tenant keys, attributed through the account rows (strip happens only after this).
  if (store && options.runtimeForAccount) {
    const doneTenants = new Set<string>();
    for (const row of Object.values(store)) {
      if (!row || typeof row !== "object" || !hadManagedKey(row)) continue;
      const tenantId = typeof row.tenant_id === "string" ? row.tenant_id : "";
      if (!tenantId || doneTenants.has(tenantId)) continue;
      doneTenants.add(tenantId);
      try {
        const runtime = options.runtimeForAccount(row as unknown as CustomerAccount);
        if (runtime && runtime.settings.get("openrouter_api_key") !== null) {
          runtime.settings.set("openrouter_api_key", "");
          counts.tenantKeysDeleted += 1;
        }
      } catch {
        counts.tenantKeysFailed += 1;
      }
    }
  }

  // 2. Account fields. Skipped if a tenant key could not be deleted, so attribution survives for the retry.
  if (store && counts.tenantKeysFailed === 0) {
    try {
      for (const row of Object.values(store)) {
        if (!row || typeof row !== "object") continue;
        const stale = Object.keys(row).filter((key) => key.startsWith(LEGACY_MANAGED_AI_FIELD_PREFIX));
        if (stale.length === 0) continue;
        for (const key of stale) delete row[key];
        counts.accountRowsCleaned += 1;
        counts.accountFieldsRemoved += stale.length;
      }
      if (counts.accountRowsCleaned > 0) {
        const pending = `${options.accountsPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
        writeFileSync(pending, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
        renameSync(pending, options.accountsPath);
        counts.accountFilesRewritten = 1;
      }
    } catch {
      counts.errors += 1;
      counts.accountRowsCleaned = 0;
      counts.accountFieldsRemoved = 0;
    }
  }

  // 3. Dead sidecar files.
  for (const name of LEGACY_MANAGED_AI_FILES) {
    const path = join(options.dataDir, name);
    try {
      if (!existsSync(path)) continue;
      rmSync(path, { force: true });
      counts.filesDeleted += 1;
    } catch {
      counts.errors += 1;
    }
  }

  const changed = counts.accountFieldsRemoved + counts.tenantKeysDeleted + counts.filesDeleted;
  if (changed > 0 || counts.errors > 0 || counts.tenantKeysFailed > 0) {
    log(
      `[legacy-managed-ai-cleanup] tenant_keys_deleted=${counts.tenantKeysDeleted} tenant_keys_failed=${counts.tenantKeysFailed} ` +
        `account_rows_cleaned=${counts.accountRowsCleaned} account_fields_removed=${counts.accountFieldsRemoved} ` +
        `files_deleted=${counts.filesDeleted} errors=${counts.errors}`,
    );
  }
  return counts;
}
