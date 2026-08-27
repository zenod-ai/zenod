import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChassisStorage } from "@zenod/mcp-chassis";
import { PhylaxCompatibilityMigration } from "../src/phylaxCompatibilityMigration.js";
import { resolvePhylaxInstanceConfig } from "../src/phylaxInstance.js";
import { resolvePhylaxRuntimeRoute } from "../src/phylaxUnit.js";
import { PhylaxTenantSettingsStore } from "../src/phylaxTenantSettings.js";

const dirs: string[] = [];
const MASTER_KEY = "55".repeat(32);

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function configuredTenant(name: string) {
  const dir = await mkdtemp(join(tmpdir(), `phylax-compat-${name}-`));
  dirs.push(dir);
  const storage = new ChassisStorage({ dataDir: dir, vaultEncryptionKey: MASTER_KEY });
  const settings = new PhylaxTenantSettingsStore(dir, storage);
  const registration = settings.registerPhone("alpha", "+34 611 111 111", "number-a");
  settings.verifyInbound("34611111111@s.whatsapp.net", registration.keyword);
  settings.update("alpha", {
    downstreamUrl: "https://memory.example.test/mcp/tenant-alpha",
    downstreamToken: "preserve-this-secret",
    turnBindings: {
      text: { tool: "custom_capture", argumentMappings: { body: { source: "message" } } },
    },
  });
  return { dir, storage, settings };
}

describe("PhylaxCompatibilityMigration", () => {
  it("classifies literal generated legacy bindings without rewriting their rollback bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phylax-compat-legacy-"));
    dirs.push(dir);
    const storage = new ChassisStorage({ dataDir: dir, vaultEncryptionKey: MASTER_KEY });
    const settings = new PhylaxTenantSettingsStore(dir, storage);
    const legacy = {
      tenantId: "legacy",
      turnBindings: {
        text: {
          tool: "chat_with_ring",
          argumentMappings: {
            message: { source: "message" },
            surface: { source: "surface" },
            conversationKey: { source: "conversationKey" },
          },
        },
      },
    };
    await writeFile(settings.path, JSON.stringify({ legacy }));
    const before = await readFile(settings.path);
    const migration = new PhylaxCompatibilityMigration(
      dir,
      settings,
      resolvePhylaxInstanceConfig({
        PHYLAX_INSTANCE_MODE: "zenod",
        PHYLAX_INSTANCE_ID: "phylax-legacy",
        PHYLAX_SERVICE_NUMBER_ID: "legacy-primary",
      }),
    );
    expect(migration.migrateExisting()).toEqual([expect.objectContaining({
      tenantId: "legacy",
      sourceDisposition: "generated_legacy",
      runtimeDisposition: "fixed_zenod_adapter",
    })]);
    expect(await readFile(settings.path)).toEqual(before);
    migration.close();
  });

  it("preserves and reports unknown and invalid binding rows instead of guessing defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phylax-compat-unknown-"));
    dirs.push(dir);
    const storage = new ChassisStorage({ dataDir: dir, vaultEncryptionKey: MASTER_KEY });
    const settings = new PhylaxTenantSettingsStore(dir, storage);
    await writeFile(settings.path, JSON.stringify({
      future: {
        tenantId: "future",
        turnBindings: { future_media: { tool: "future_tool", argumentMappings: {} } },
      },
      invalid: { tenantId: "invalid", turnBindings: { text: { tool: 42 } } },
    }));
    const before = await readFile(settings.path);
    const migration = new PhylaxCompatibilityMigration(
      dir,
      settings,
      resolvePhylaxInstanceConfig({
        PHYLAX_INSTANCE_MODE: "standalone",
        PHYLAX_INSTANCE_ID: "phylax-future",
        PHYLAX_SERVICE_NUMBER_ID: "future-primary",
      }),
    );
    expect(migration.migrateExisting()).toEqual(expect.arrayContaining([
      expect.objectContaining({ tenantId: "future", sourceDisposition: "custom" }),
      expect.objectContaining({ tenantId: "invalid", sourceDisposition: "invalid_preserved" }),
    ]));
    expect(await readFile(settings.path)).toEqual(before);
    migration.close();
  });

  it("adopts generated/default bindings once without rewriting the source row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phylax-compat-generated-"));
    dirs.push(dir);
    const storage = new ChassisStorage({ dataDir: dir, vaultEncryptionKey: MASTER_KEY });
    const settings = new PhylaxTenantSettingsStore(dir, storage);
    settings.registerPhone("generated", "+34 622 222 222", "number-generated");
    const before = await readFile(settings.path);
    const migration = new PhylaxCompatibilityMigration(
      dir,
      settings,
      resolvePhylaxInstanceConfig({
        PHYLAX_INSTANCE_MODE: "standalone",
        PHYLAX_INSTANCE_ID: "phylax-generated",
        PHYLAX_SERVICE_NUMBER_ID: "generated-primary",
      }),
      () => 50,
    );
    expect(migration.migrateExisting()).toEqual([expect.objectContaining({
      tenantId: "generated",
      sourceDisposition: "generated_current",
      runtimeDisposition: "standalone_generated_adapter",
    })]);
    expect(migration.migrateExisting()).toHaveLength(1);
    expect(await readFile(settings.path)).toEqual(before);
    migration.close();
  });

  it("records one non-destructive fixed-adapter cutover and preserves credentials and settings bytes", async () => {
    const { dir, settings } = await configuredTenant("fixed");
    const before = await readFile(settings.path);
    const instance = resolvePhylaxInstanceConfig({
      PHYLAX_INSTANCE_MODE: "zenod",
      PHYLAX_INSTANCE_ID: "phylax-for-zenod",
      PHYLAX_SERVICE_NUMBER_ID: "zenod-primary",
    });
    const first = new PhylaxCompatibilityMigration(dir, settings, instance, () => 100);
    expect(first.migrateExisting()).toEqual([expect.objectContaining({
      tenantId: "alpha",
      sourceDisposition: "custom",
      runtimeDisposition: "fixed_zenod_adapter",
      migratedAt: 100,
    })]);
    first.close();

    const restarted = new PhylaxCompatibilityMigration(dir, settings, instance, () => 999);
    expect(restarted.migrateExisting()[0]).toMatchObject({ migratedAt: 100 });
    expect(await readFile(settings.path)).toEqual(before);
    expect(settings.downstreamCredentials("alpha")).toEqual({
      url: "https://memory.example.test/mcp/tenant-alpha",
      token: "preserve-this-secret",
    });
    const fixed = resolvePhylaxRuntimeRoute(
      instance,
      settings,
      "whatsapp",
      "34611111111@s.whatsapp.net",
    );
    expect(fixed?.turnBindings?.text.tool).not.toBe("custom_capture");
    expect(JSON.stringify(restarted.records())).not.toContain("preserve-this-secret");
    restarted.close();
  });

  it("preserves and explicitly reports the standalone tenant's one custom downstream", async () => {
    const { dir, settings } = await configuredTenant("standalone");
    const before = await readFile(settings.path);
    const instance = resolvePhylaxInstanceConfig({
      PHYLAX_INSTANCE_MODE: "standalone",
      PHYLAX_INSTANCE_ID: "phylax-standalone",
      PHYLAX_SERVICE_NUMBER_ID: "standalone-primary",
    });
    const migration = new PhylaxCompatibilityMigration(dir, settings, instance, () => 200);
    expect(migration.migrateTenant("alpha")).toMatchObject({
      sourceDisposition: "custom",
      runtimeDisposition: "standalone_custom_preserved",
    });
    const route = resolvePhylaxRuntimeRoute(
      instance,
      settings,
      "whatsapp",
      "34611111111@s.whatsapp.net",
    );
    expect(route).toMatchObject({
      downstreamUrl: "https://memory.example.test/mcp/tenant-alpha",
      downstreamToken: "preserve-this-secret",
      turnBindings: { text: { tool: "custom_capture" } },
    });
    expect(await readFile(settings.path)).toEqual(before);
    migration.close();
  });
});
