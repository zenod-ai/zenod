import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import type { PhylaxInstanceConfig } from "./phylaxInstance.js";
import type {
  PhylaxLegacyBindingDisposition,
  PhylaxTenantSettingsStore,
} from "./phylaxTenantSettings.js";

export interface PhylaxCompatibilityMigrationRecord {
  tenantId: string;
  instanceId: string;
  mode: PhylaxInstanceConfig["mode"];
  bindingDigest: string;
  sourceDisposition: PhylaxLegacyBindingDisposition;
  runtimeDisposition:
    | "fixed_zenod_adapter"
    | "fixed_pm_adapter"
    | "standalone_generated_adapter"
    | "standalone_custom_preserved"
    | "standalone_invalid_preserved";
  migratedAt: number;
}

/**
 * Append-only proof for the compatibility cutover.
 *
 * The source settings row is deliberately never rewritten: generated defaults
 * are adopted through the runtime adapter, while custom/invalid standalone
 * rows remain byte-for-byte available to both old and new binaries. This is a
 * migration of authority, not credentials or tenant data.
 */
export class PhylaxCompatibilityMigration {
  private readonly db: DatabaseSync;

  constructor(
    dataDir: string,
    private readonly settings: PhylaxTenantSettingsStore,
    private readonly instance: PhylaxInstanceConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.db = new DatabaseSync(join(dataDir, "phylax-compatibility.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 30000;
      CREATE TABLE IF NOT EXISTS phylax_binding_migrations (
        tenant_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        binding_digest TEXT NOT NULL,
        source_disposition TEXT NOT NULL,
        runtime_disposition TEXT NOT NULL,
        migrated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, instance_id)
      );
    `);
  }

  migrateExisting(): PhylaxCompatibilityMigrationRecord[] {
    for (const tenantId of this.settings.tenantIds()) this.migrateTenant(tenantId);
    return this.records();
  }

  migrateTenant(tenantId: string): PhylaxCompatibilityMigrationRecord {
    const existing = this.record(tenantId);
    if (existing) return existing;
    const source = this.settings.inspectLegacyBindings(tenantId);
    const runtimeDisposition = this.instance.mode === "zenod"
      ? "fixed_zenod_adapter"
      : this.instance.mode === "pm"
        ? "fixed_pm_adapter"
        : source.disposition === "custom"
          ? "standalone_custom_preserved"
          : source.disposition === "invalid_preserved"
            ? "standalone_invalid_preserved"
            : "standalone_generated_adapter";
    const migratedAt = this.now();
    this.db.prepare(
      `INSERT INTO phylax_binding_migrations
       (tenant_id, instance_id, mode, binding_digest, source_disposition,
        runtime_disposition, migrated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, instance_id) DO NOTHING`,
    ).run(
      tenantId,
      this.instance.instanceId,
      this.instance.mode,
      source.bindingDigest,
      source.disposition,
      runtimeDisposition,
      migratedAt,
    );
    return this.record(tenantId)!;
  }

  records(): PhylaxCompatibilityMigrationRecord[] {
    return (this.db.prepare(
      `SELECT tenant_id, instance_id, mode, binding_digest,
              source_disposition, runtime_disposition, migrated_at
       FROM phylax_binding_migrations
       WHERE instance_id=? ORDER BY tenant_id`,
    ).all(this.instance.instanceId) as unknown as Array<Record<string, unknown>>)
      .map((row) => ({
        tenantId: String(row.tenant_id),
        instanceId: String(row.instance_id),
        mode: row.mode as PhylaxInstanceConfig["mode"],
        bindingDigest: String(row.binding_digest),
        sourceDisposition: row.source_disposition as PhylaxLegacyBindingDisposition,
        runtimeDisposition: row.runtime_disposition as PhylaxCompatibilityMigrationRecord["runtimeDisposition"],
        migratedAt: Number(row.migrated_at),
      }));
  }

  close(): void {
    this.db.close();
  }

  private record(tenantId: string): PhylaxCompatibilityMigrationRecord | null {
    const row = this.db.prepare(
      `SELECT tenant_id, instance_id, mode, binding_digest,
              source_disposition, runtime_disposition, migrated_at
       FROM phylax_binding_migrations
       WHERE tenant_id=? AND instance_id=?`,
    ).get(tenantId, this.instance.instanceId) as Record<string, unknown> | undefined;
    return row
      ? {
          tenantId: String(row.tenant_id),
          instanceId: String(row.instance_id),
          mode: row.mode as PhylaxInstanceConfig["mode"],
          bindingDigest: String(row.binding_digest),
          sourceDisposition: row.source_disposition as PhylaxLegacyBindingDisposition,
          runtimeDisposition: row.runtime_disposition as PhylaxCompatibilityMigrationRecord["runtimeDisposition"],
          migratedAt: Number(row.migrated_at),
        }
      : null;
  }
}
