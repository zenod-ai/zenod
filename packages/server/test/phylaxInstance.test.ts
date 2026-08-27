import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ChassisStorage, createMemoryTenantStore } from "@zenod/mcp-chassis";
import { createPhylaxUnit, resolvePhylaxRuntimeRoute } from "../src/phylaxUnit.js";
import {
  assertCustomerDownstreamMutationAllowed,
  assertDedicatedPhylaxProcessEnv,
  resolvePhylaxInstanceConfig,
} from "../src/phylaxInstance.js";
import { defaultPhylaxTurnBindings, PhylaxTenantSettingsStore } from "../src/phylaxTenantSettings.js";

const dirs: string[] = [];
const MASTER_KEY = "44".repeat(32);

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("dedicated Phylax deployment islands", () => {
  it("derives one fixed adapter from each product mode and no free-form router", () => {
    expect(resolvePhylaxInstanceConfig({ PHYLAX_INSTANCE_MODE: "zenod" })).toMatchObject({
      mode: "zenod",
      downstreamAdapter: "zenod",
      commercialOwner: "zenod",
      customerConfigurableDownstream: false,
    });
    expect(resolvePhylaxInstanceConfig({ PHYLAX_INSTANCE_MODE: "pm" })).toMatchObject({
      mode: "pm",
      downstreamAdapter: "pm",
      commercialOwner: "pm",
      customerConfigurableDownstream: false,
    });
    expect(resolvePhylaxInstanceConfig({})).toMatchObject({
      mode: "standalone",
      downstreamAdapter: "configured",
      commercialOwner: "phylax",
      customerConfigurableDownstream: true,
    });
    expect(() => resolvePhylaxInstanceConfig({ PHYLAX_INSTANCE_MODE: "router" }))
      .toThrow("PHYLAX_INSTANCE_MODE must be one of");
    expect(() => resolvePhylaxInstanceConfig({ PHYLAX_ADMIN_ORIGIN: "http://admin.example.test" }))
      .toThrow("PHYLAX_ADMIN_ORIGIN must use https");
  });

  it("prevents the dedicated image from booting another unit or agent", () => {
    expect(() => assertDedicatedPhylaxProcessEnv({ ZENOD_UNIT: "zenod" }))
      .toThrow("cannot run another ZENOD_UNIT");
    expect(() => assertDedicatedPhylaxProcessEnv({ AGENT: "ring" }))
      .toThrow("cannot run another AGENT");
    expect(() => assertDedicatedPhylaxProcessEnv({ ZENOD_UNIT: "phylax", AGENT: "phylax" }))
      .not.toThrow();
  });

  it("allows customer downstream configuration only in standalone mode", () => {
    const zenod = resolvePhylaxInstanceConfig({ PHYLAX_INSTANCE_MODE: "zenod" });
    const standalone = resolvePhylaxInstanceConfig({ PHYLAX_INSTANCE_MODE: "standalone" });
    expect(() => assertCustomerDownstreamMutationAllowed(zenod, { downstreamUrl: "https://x.test/mcp" }))
      .toThrow("fixed zenod adapter");
    expect(() => assertCustomerDownstreamMutationAllowed(zenod, { transcriptionEnabled: true }))
      .not.toThrow();
    expect(() => assertCustomerDownstreamMutationAllowed(standalone, { turnBindings: {} }))
      .not.toThrow();
  });

  it("enforces product adapters at runtime instead of trusting persisted bindings", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-fixed-adapter-"));
    dirs.push(dataDir);
    const storage = new ChassisStorage({ dataDir, vaultEncryptionKey: MASTER_KEY });
    const settings = new PhylaxTenantSettingsStore(dataDir, storage);
    const registration = settings.registerPhone("tenant-a", "+34 611 111 111", "number-a");
    expect(settings.verifyInbound("34611111111@s.whatsapp.net", registration.keyword)).toMatchObject({
      tenantId: "tenant-a",
      verified: true,
    });
    settings.update("tenant-a", {
      downstreamUrl: "https://tenant-a.example/mcp",
      downstreamToken: "tenant-a-token",
      turnBindings: {
        voice_note: { tool: "legacy_arbitrary_voice", argumentMappings: { text: { source: "message" } } },
        text: { tool: "legacy_arbitrary_text", argumentMappings: { text: { source: "message" } } },
        media: { tool: "legacy_arbitrary_media", argumentMappings: { text: { source: "message" } } },
      },
    });

    const zenod = resolvePhylaxRuntimeRoute(
      resolvePhylaxInstanceConfig({ PHYLAX_INSTANCE_MODE: "zenod" }),
      settings,
      "whatsapp",
      "34611111111@s.whatsapp.net",
    );
    expect(zenod).toMatchObject({
      tenantId: "tenant-a",
      downstreamUrl: "https://tenant-a.example/mcp",
      downstreamToken: "tenant-a-token",
      turnBindings: defaultPhylaxTurnBindings(),
    });
    expect(JSON.stringify(zenod)).not.toContain("legacy_arbitrary");

    const pm = resolvePhylaxRuntimeRoute(
      resolvePhylaxInstanceConfig({ PHYLAX_INSTANCE_MODE: "pm" }),
      settings,
      "whatsapp",
      "34611111111@s.whatsapp.net",
    );
    expect(pm).toBeNull();

    const standalone = resolvePhylaxRuntimeRoute(
      resolvePhylaxInstanceConfig({ PHYLAX_INSTANCE_MODE: "standalone" }),
      settings,
      "whatsapp",
      "34611111111@s.whatsapp.net",
    );
    expect(standalone?.turnBindings).toMatchObject({
      text: { tool: "legacy_arbitrary_text" },
    });
  });

  it("exposes only Phylax MCP tools and no Zenod application routes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "phylax-runtime-audit-"));
    dirs.push(dataDir);
    const unit = createPhylaxUnit({
      dataDir,
      tenantStore: createMemoryTenantStore([{
        token: "phylax-runtime-token",
        tenant: { id: "tenant-a", name: "Tenant A" },
      }]),
      env: {
        CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
        PHYLAX_PREWARM_LOCAL_MODEL: "0",
      },
    });
    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const started = serve({ fetch: unit.app.fetch, port: 0 }, () => resolve(started));
    });
    try {
      const address = server.address() as AddressInfo;
      const client = new Client({ name: "phylax-runtime-audit", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${address.port}/mcp/phylax-runtime-token`),
      ));
      const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
      expect(tools).toEqual([
        "channel_status",
        "get_recent_conversation_transcript",
        "install_operating_directive",
        "notify",
        "send_message",
      ]);
      for (const forbidden of [
        "ask_brain",
        "chat_with_zenod",
        "get_memory",
        "ingest_memory",
        "list_drive_files",
        "search_memory",
        "store_memory",
      ]) {
        expect(tools).not.toContain(forbidden);
      }
      await client.close();

      for (const [method, path] of [
        ["POST", "/api/ask"],
        ["POST", "/api/chat"],
        ["GET", "/api/drive/status"],
        ["POST", "/api/store"],
        ["GET", "/api/vault"],
      ] as const) {
        const response = await unit.app.request(path, {
          method,
          headers: {
            authorization: "Bearer phylax-runtime-token",
            "content-type": "application/json",
          },
          ...(method === "POST" ? { body: "{}" } : {}),
        });
        expect(response.status, `${method} ${path}`).toBe(404);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await unit.close();
    }
  });

  it("boots two isolated modes concurrently and preserves a mounted legacy session", async () => {
    const zenodDir = await mkdtemp(join(tmpdir(), "phylax-zenod-island-"));
    const pmDir = await mkdtemp(join(tmpdir(), "phylax-pm-island-"));
    dirs.push(zenodDir, pmDir);
    const legacySession = join(zenodDir, "whatsapp", "session");
    await mkdir(legacySession, { recursive: true });
    const legacyBytes = "existing-session-material-must-not-change";
    await writeFile(join(legacySession, "session-owner.json"), legacyBytes);

    const zenod = createPhylaxUnit({
      dataDir: zenodDir,
      tenantStore: createMemoryTenantStore(),
      env: {
        CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
        PHYLAX_INSTANCE_MODE: "zenod",
        PHYLAX_INSTANCE_ID: "phylax-for-zenod",
        PHYLAX_SERVICE_NUMBER_ID: "zenod-primary",
        PHYLAX_ADMIN_ORIGIN: "https://channels-admin.zenod.dev",
        PHYLAX_PREWARM_LOCAL_MODEL: "0",
      },
    });
    const pm = createPhylaxUnit({
      dataDir: pmDir,
      tenantStore: createMemoryTenantStore(),
      env: {
        CHASSIS_VAULT_MASTER_KEY: MASTER_KEY,
        PHYLAX_INSTANCE_MODE: "pm",
        PHYLAX_INSTANCE_ID: "phylax-for-pm",
        PHYLAX_SERVICE_NUMBER_ID: "pm-primary",
        PHYLAX_ADMIN_ORIGIN: "https://channels-admin.pm.test",
        PHYLAX_PREWARM_LOCAL_MODEL: "0",
      },
    });
    try {
      zenod.phylaxTenantSettings.update("tenant-a", { transcriptionEnabled: false });
      expect(zenod.phylaxTenantSettings.get("tenant-a").transcriptionEnabled).toBe(false);
      expect(pm.phylaxTenantSettings.get("tenant-a").transcriptionEnabled).toBe(true);
      expect(await readFile(join(legacySession, "session-owner.json"), "utf8")).toBe(legacyBytes);
      await expect(readFile(join(pmDir, "whatsapp", "session", "session-owner.json"), "utf8"))
        .rejects.toThrow();

      expect(await (await zenod.app.request("/api/health")).json()).toMatchObject({
        name: "phylax",
        instance: {
          id: "phylax-for-zenod",
          mode: "zenod",
          downstreamAdapter: "zenod",
          serviceNumberId: "zenod-primary",
          runtime: "phylax",
        },
      });
      expect(await (await pm.app.request("/api/health")).json()).toMatchObject({
        name: "phylax",
        instance: {
          id: "phylax-for-pm",
          mode: "pm",
          downstreamAdapter: "pm",
          serviceNumberId: "pm-primary",
          runtime: "phylax",
        },
      });
    } finally {
      await Promise.all([zenod.close(), pm.close()]);
    }
  });

  it("uses the dedicated entrypoint and distinct compose state for every island", async () => {
    const dockerfile = await readFile(new URL("../../../units/phylax/Dockerfile", import.meta.url), "utf8");
    const compose = await readFile(
      new URL("../../../units/phylax/docker-compose.islands.yml", import.meta.url),
      "utf8",
    );
    const packageJson = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    );
    const phylaxUnitSource = await readFile(
      new URL("../src/phylaxUnit.ts", import.meta.url),
      "utf8",
    );
    expect(dockerfile).toContain('CMD ["node", "packages/server/dist/phylaxMain.js"]');
    expect(dockerfile).toContain('dev.zenod.runtime="phylax-only"');
    expect(dockerfile).toContain("npm run build:phylax -w @zenod/server");
    expect(dockerfile).toContain("/app/packages/server/dist-phylax/phylaxMain.js");
    expect(dockerfile).not.toContain("/app/packages/server/dist ./packages/server/dist");
    expect(dockerfile).not.toContain("/app/packages/core/dist");
    expect(dockerfile).not.toContain("apps/site/dist");
    expect(dockerfile).not.toContain("apps/ring-site/dist");
    expect(packageJson).toContain("assert-phylax-bundle.mjs");
    expect(phylaxUnitSource).not.toMatch(/createZenodUnit|ZenodRuntimePool|registerZenodTools/);
    expect(compose).toContain("phylax-for-zenod-data:/data");
    expect(compose).toContain("phylax-for-pm-data:/data");
    expect(compose).toContain("phylax-standalone-data:/data");
    expect(compose).toContain("PHYLAX_INSTANCE_MODE: zenod");
    expect(compose).toContain("PHYLAX_INSTANCE_MODE: pm");
    expect(compose).toContain("PHYLAX_INSTANCE_MODE: standalone");
    expect(compose).toContain("PHYLAX_SERVICE_NUMBER_ID: zenod-primary");
    expect(compose).toContain("PHYLAX_SERVICE_NUMBER_ID: pm-primary");
    expect(compose).toContain("platform: ${PHYLAX_PLATFORM:-linux/amd64}");
  });
});
