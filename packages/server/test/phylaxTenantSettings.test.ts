import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChassisStorage } from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it } from "vitest";
import { PhylaxTenantSettingsStore } from "../src/phylaxTenantSettings.js";

const dirs: string[] = [];
const MASTER_KEY = "35".repeat(32);

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), "phylax-settings-"));
  dirs.push(dataDir);
  const storage = new ChassisStorage({ dataDir, vaultEncryptionKey: MASTER_KEY });
  return { dataDir, store: new PhylaxTenantSettingsStore(dataDir, storage) };
}

describe("PhylaxTenantSettingsStore", () => {
  it("verifies only the claimed normalized sender using its one-time inbound keyword", async () => {
    const { store } = await setup();
    const registration = store.registerPhone("alpha", "+34 611 111 111", "number-1", 1_000);
    expect(registration.settings).toMatchObject({ phoneNumber: "34611111111", verified: false, numberId: "number-1" });
    expect(registration.keyword).toMatch(/^\d{2}-[a-z]+$/);
    expect(registration.keyword).toBe(registration.keyword.toLowerCase());
    expect(store.verifyInbound("34622222222@s.whatsapp.net", registration.keyword, 2_000)).toBeNull();
    expect(store.verifyInbound("34611111111@s.whatsapp.net", "99-wrong", 2_000)).toBeNull();
    expect(store.verifyInbound("+34 611 111 111@s.whatsapp.net", registration.keyword.toUpperCase(), 2_000)).toMatchObject({ tenantId: "alpha", verified: true });
    expect(store.verifyInbound("34611111111", registration.keyword, 2_001)).toBeNull();
  });

  it("keeps two tenants' routes, downstream tokens and transcription keys isolated", async () => {
    const { dataDir, store } = await setup();
    for (const [tenant, phone, ringToken, sttKey] of [
      ["alpha", "+34 611 111 111", "ring-alpha-secret", "stt-alpha-secret"],
      ["beta", "+34 622 222 222", "ring-beta-secret", "stt-beta-secret"],
    ] as const) {
      const registration = store.registerPhone(tenant, phone);
      store.update(tenant, {
        downstreamUrl: `https://ring.zenod.dev/mcp/${tenant}`,
        downstreamToken: ringToken,
        transcriptionProvider: "openrouter",
        transcriptionKey: sttKey,
        transcriptionModel: `model-${tenant}`,
      });
      expect(store.verifyInbound(phone, registration.keyword)).toMatchObject({ tenantId: tenant });
    }
    expect(store.resolve("whatsapp", "34611111111")).toMatchObject({ tenantId: "alpha", downstreamToken: "ring-alpha-secret" });
    expect(store.resolve("whatsapp", "34622222222")).toMatchObject({ tenantId: "beta", downstreamToken: "ring-beta-secret" });
    expect(store.transcriptionConfig("alpha")).toEqual({ enabled: true, provider: "openrouter", model: "model-alpha", key: "stt-alpha-secret" });
    expect(store.transcriptionConfig("beta")).toEqual({ enabled: true, provider: "openrouter", model: "model-beta", key: "stt-beta-secret" });
    expect(JSON.stringify(store.view("alpha"))).not.toContain("beta");
    const rowFile = await readFile(join(dataDir, "phylax-tenant-settings.json"), "utf8");
    expect(rowFile).not.toContain("ring-alpha-secret");
    expect(rowFile).not.toContain("stt-alpha-secret");
  });

  it("does not resolve an unverified or tokenless tenant", async () => {
    const { store } = await setup();
    store.registerPhone("alpha", "+34 611 111 111");
    store.update("alpha", { downstreamUrl: "https://ring.zenod.dev/mcp/alpha" });
    expect(store.resolve("whatsapp", "34611111111")).toBeNull();
  });
});
