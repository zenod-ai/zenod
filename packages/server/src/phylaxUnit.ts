import type { HttpBindings } from "@hono/node-server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ChassisStorage, hashToken, type UnitContext } from "@zenod/mcp-chassis";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Hono, type Context } from "hono";
import { PHYLAX_AGENT } from "./agent.js";
import { readCustomerSession } from "./customerSession.js";
import { transcribeAudio } from "./transcribe.js";
import {
  PhylaxChannelError,
  PhylaxChannelsOrgan,
  phylaxWhatsAppPaths,
  registerPhylaxChannelTools,
  type PhylaxPortedChannel,
} from "./phylaxChannels.js";
import { mountPhylaxAdminChannelRoutes, PhylaxPortedRuntime } from "./phylaxPortedRuntime.js";
import { PhylaxTenantSettingsStore } from "./phylaxTenantSettings.js";
import { createZenodUnit, type CreateZenodUnitOptions } from "./zenodUnit.js";

export const PHYLAX_ADMIN_GITHUB_LOGIN = "alfablok";

type AppContext = Context<{ Bindings: HttpBindings }>;

/** Compose the shipped customer unit with the ported channels organ. */
export function createPhylaxUnit(options: CreateZenodUnitOptions = {}) {
  const env = options.env ?? process.env;
  const storage = options.storage ?? new ChassisStorage({
    dataDir: options.dataDir,
    vaultEncryptionKey: env.CHASSIS_VAULT_MASTER_KEY,
  });
  const tenantSettings = new PhylaxTenantSettingsStore(storage.dataDir, storage);
  let base!: ReturnType<typeof createZenodUnit>;
  const organ = createTenantOrgan(storage.dataDir, tenantSettings, () => base, env);
  const runtime = new PhylaxPortedRuntime(storage.dataDir, organ, env, {
    verifyInbound({ sender, text }) {
      const verified = tenantSettings.verifyInbound(sender, text);
      return verified ? "Your WhatsApp number is verified. Return to Phylax to finish setup." : null;
    },
  });

  base = createZenodUnit({
    ...options,
    storage,
    agent: PHYLAX_AGENT,
    unitName: "phylax",
    tokenEnvVar: "PHYLAX_API_TOKEN",
    defaultTenantName: "Self-hosted Phylax",
    panels: ["mcp", "transcription", "connections"],
    additionalReadTools: ["channel_status"],
    registerAdditionalTools(server, context, runtimeInstance) {
      registerTenantChannelTools(server, context, runtime, tenantSettings);
      options.registerAdditionalTools?.(server, context, runtimeInstance);
    },
    customerProduct: {
      product: "phylax",
      unit: "phylax",
      defaultDomain: "https://phylax.zenod.dev",
      signInToLanding: true,
    },
    customerAdmin: {
      githubLogin: PHYLAX_ADMIN_GITHUB_LOGIN,
      mountRoutes: (app) => mountPhylaxAdminChannelRoutes(app, runtime),
      close: () => runtime.close(),
    },
  });
  void runtime.start().catch((error) => console.error("phylax channels failed to start:", error));

  const app = new Hono<{ Bindings: HttpBindings }>();
  app.get("/api/phylax/settings", (c) => {
    const tenantId = activeTenantId(c, base, env);
    if (!tenantId) return c.json({ error: "unauthorized" }, 401);
    const account = base.customerAccounts.list().find((candidate) => candidate.tenant_id === tenantId);
    const token = account ? base.customerTokenVault.get(account.account_id) : null;
    return c.json({
      settings: tenantSettings.view(tenantId),
      phylaxNumber: runtime.whatsapp.status().linkedNumber,
      mcp: token
        ? {
            url: `${(env.CUSTOMER_APP_URL || "https://phylax.zenod.dev").replace(/\/$/, "")}/mcp/${token}`,
            token,
          }
        : null,
    });
  });
  app.put("/api/phylax/settings", async (c) => {
    const tenantId = activeTenantId(c, base, env);
    if (!tenantId) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json<{
      downstreamUrl?: string | null;
      downstreamToken?: string | null;
      transcriptionEnabled?: boolean;
      transcriptionProvider?: "local" | "groq" | "openai" | "openrouter";
      transcriptionModel?: string | null;
      transcriptionKey?: string | null;
      telegramBinding?: string | null;
      notificationPrefs?: { whatsapp?: boolean; telegram?: boolean };
    }>().catch(() => ({}));
    try {
      return c.json({ settings: tenantSettings.update(tenantId, body) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid settings" }, 400);
    }
  });
  app.post("/api/phylax/phone-registration", async (c) => {
    const tenantId = activeTenantId(c, base, env);
    if (!tenantId) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req
      .json<{ phoneNumber?: string; numberId?: string }>()
      .catch((): { phoneNumber?: string; numberId?: string } => ({}));
    try {
      const registration = tenantSettings.registerPhone(tenantId, body.phoneNumber ?? "", body.numberId);
      return c.json({
        ...registration,
        phylaxNumber: runtime.whatsapp.status().linkedNumber,
        instruction: `WhatsApp ${registration.keyword} to ${runtime.whatsapp.status().linkedNumber ?? "the Phylax number"}`,
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid phone number" }, 400);
    }
  });
  app.get("/mcp/:token/artifacts/:tenantId/:file", async (c) => {
    const token = c.req.param("token");
    const tenantId = c.req.param("tenantId");
    const file = c.req.param("file");
    if (!file || basename(file) !== file || file === "." || file === "..") {
      return c.json({ error: "not found" }, 404);
    }
    const record = await base.tenantStore.resolveTokenHash(hashToken(token));
    if (!record || (record.status ?? "active") !== "active" || record.tenant.id !== tenantId) {
      return c.json({ error: "not found" }, 404);
    }
    const path = join(phylaxWhatsAppPaths(base.storage.dataDir).artifacts, tenantId, file);
    try {
      const bytes = await readFile(path);
      const extension = file.split(".").pop()?.toLowerCase();
      const contentType = extension === "ogg" ? "audio/ogg"
        : extension === "mp3" ? "audio/mpeg"
        : extension === "wav" ? "audio/wav"
        : "application/octet-stream";
      return c.body(bytes, 200, { "content-type": contentType, "cache-control": "private, no-store" });
    } catch {
      return c.json({ error: "not found" }, 404);
    }
  });
  app.all("*", (c) => base.app.fetch(c.req.raw, c.env));

  return {
    ...base,
    app,
    phylaxRuntime: runtime,
    phylaxTenantSettings: tenantSettings,
    close() {
      base.close();
    },
  };
}

function createTenantOrgan(
  dataDir: string,
  tenantSettings: PhylaxTenantSettingsStore,
  baseUnit: () => ReturnType<typeof createZenodUnit>,
  env: NodeJS.ProcessEnv,
): PhylaxChannelsOrgan {
  return new PhylaxChannelsOrgan({
    dataDir,
    routes: { resolve: (channel, sender) => tenantSettings.resolve(channel, sender) },
    transcriber: {
      async transcribe(input) {
        const transcription = tenantSettings.transcriptionConfig(input.tenantId);
        if (!transcription.enabled) {
          return { transcription_failed: { code: "disabled", message: "tenant transcription is disabled" } };
        }
        const key = transcription.key ?? undefined;
        const result = await transcribeAudio(Buffer.from(input.bytes), input.fileName ?? "voice.ogg", {
          groqApiKey: transcription.provider === "groq" ? key ?? "" : "",
          openaiApiKey: transcription.provider === "openai" ? key ?? "" : "",
          openrouterApiKey: transcription.provider === "openrouter" ? key ?? "" : "",
          ...(transcription.provider === "openai" ? { longTranscriptionProvider: "openai" as const } : {}),
          ...(transcription.provider === "openrouter"
            ? { openrouterModel: transcription.model ?? undefined, longTranscriptionProvider: "openrouter" as const }
            : {}),
        });
        if (!result.success || !result.transcript?.trim()) {
          return {
            ...(result.provider ? { transcription_source: result.provider } : {}),
            transcription_failed: {
              code: result.noSpeech ? "no_speech" : "unavailable",
              message: result.error ?? "transcription failed",
            },
          };
        }
        return {
          text_transcript: result.transcript.trim(),
          ...(result.provider ? { transcription_source: result.provider } : {}),
        };
      },
    },
    artifactUrl(tenantId, artifactId) {
      const base = baseUnit();
      const account = base.customerAccounts.list().find((candidate) => candidate.tenant_id === tenantId);
      const token = account ? base.customerTokenVault.get(account.account_id) : null;
      if (!token) throw new PhylaxChannelError("invalid_input", "tenant artifact token is unavailable");
      return `${(env.CUSTOMER_APP_URL || "https://phylax.zenod.dev").replace(/\/$/, "")}/mcp/${token}/artifacts/${tenantId}/${artifactId}`;
    },
  });
}

function activeTenantId(
  c: AppContext,
  base: ReturnType<typeof createZenodUnit>,
  env: NodeJS.ProcessEnv,
): string | null {
  const session = readCustomerSession(c, env);
  if (!session) return null;
  return base.customerAccounts.resolveActiveTenantForUser(session.github_id)?.tenant_id ?? null;
}

function registerTenantChannelTools(
  server: McpServer,
  context: UnitContext,
  runtime: PhylaxPortedRuntime,
  settings: PhylaxTenantSettingsStore,
): void {
  const tenantId = context.tenant?.id;
  if (!tenantId) throw new Error("Phylax channel tools require a tenant");
  const delivery = runtime.delivery();
  const send = async (channel: PhylaxPortedChannel, recipient: string, text: string) => {
    if (!settings.ownsRecipient(tenantId, channel, recipient)) {
      throw new PhylaxChannelError("delivery_error", "recipient is not bound to this tenant");
    }
    return delivery.send(channel, recipient, text);
  };
  registerPhylaxChannelTools(server, {
    send,
    async notify(text) {
      const tenant = settings.get(tenantId);
      const requests: Array<Promise<Awaited<ReturnType<typeof send>>>> = [];
      if (tenant.notificationPrefs.whatsapp && tenant.verified && tenant.phoneNumber) {
        requests.push(send("whatsapp", tenant.phoneNumber, text));
      }
      if (tenant.notificationPrefs.telegram && tenant.telegramBinding) {
        requests.push(send("telegram", tenant.telegramBinding, text));
      }
      return Promise.all(requests);
    },
    status() {
      return {
        settings: settings.view(tenantId),
        providers: delivery.status(),
      };
    },
  });
}
