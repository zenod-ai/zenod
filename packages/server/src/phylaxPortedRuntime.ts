import { join } from "node:path";
import type { Env, Hono } from "hono";
import { SqliteStateStore } from "zenod";
import { Settings } from "./settings.js";
import { WhatsAppGateway, type SocketFactory } from "./whatsappGateway.js";
import { WhatsAppStore } from "./whatsappStore.js";
import { TelegramGateway } from "./telegramGateway.js";
import {
  PhylaxChannelsOrgan,
  phylaxWhatsAppPaths,
  type PhylaxDeliveryReceipt,
  type PhylaxTenantDelivery,
} from "./phylaxChannels.js";

/**
 * The shipped channels organ, mounted without the old fused BrainEngine path.
 * It directly composes the existing Baileys store/session gateway, Telegram
 * gateway, and their shared transcription path; only tenant lookup/forwarding
 * is new.
 */
export class PhylaxPortedRuntime {
  readonly state: SqliteStateStore;
  readonly settings: Settings;
  readonly whatsappStore: WhatsAppStore;
  readonly whatsapp: WhatsAppGateway;
  readonly telegram: TelegramGateway;

  constructor(
    readonly dataDir: string,
    readonly organ: PhylaxChannelsOrgan,
    env: NodeJS.ProcessEnv = process.env,
    adapters: {
      whatsappSocketFactory?: SocketFactory;
      telegramFetch?: typeof fetch;
      verifyInbound?: (input: { channel: "whatsapp"; sender: string; text: string }) => Promise<string | null> | string | null;
    } = {},
  ) {
    this.state = new SqliteStateStore(join(dataDir, "phylax-channels.sqlite"));
    this.settings = new Settings(this.state);
    this.settings.seedFromEnv(env);
    // In the full Phylax unit, the tenant resolver is the authorization gate.
    // Keep the provider gateways open to verified-candidate senders so a stale
    // legacy allowlist cannot reject a tenant before the tenant lookup runs.
    this.settings.setWhatsAppSettings({ acceptAll: true, groupsEnabled: false });
    this.settings.setTelegramSettings({ acceptAll: true });
    const whatsappPaths = phylaxWhatsAppPaths(dataDir);
    this.whatsappStore = new WhatsAppStore(whatsappPaths.store);
    const unavailableEngine = async () => {
      throw new Error("Phylax channel gateways use the tenant downstream seam, not a local BrainEngine");
    };
    this.whatsapp = new WhatsAppGateway({
      dataDir: whatsappPaths.root,
      settings: this.settings,
      store: this.whatsappStore,
      getEngine: unavailableEngine,
      portedInboundHandler: async ({ event, text, media, transcription }) => {
        const verificationReply = await adapters.verifyInbound?.({
          channel: "whatsapp",
          sender: event.senderId,
          text,
        });
        if (verificationReply) return { replyText: verificationReply };
        const forwarded = await this.organ.receive({
          channel: "whatsapp",
          sender: event.senderId,
          chatId: event.chatId,
          messageId: event.messageId,
          text,
          ...(media ? { media } : {}),
          ...(transcription
            ? {
                transcription: {
                  ...(text ? { text_transcript: text } : {}),
                  ...(transcription.provider ? { transcription_source: transcription.provider } : {}),
                  ...(transcription.failed ? { transcription_failed: transcription.failed } : {}),
                },
              }
            : {}),
        });
        this.whatsappStore.recordChannelForwarding({
          providerMessageId: event.messageId,
          tenantId: forwarded.tenantId,
          senderId: forwarded.sender,
          transcriptText: forwarded.handoff.text_transcript ?? null,
          transcriptProvenance:
            forwarded.handoff.transcription_source ?? (media ? "whatsapp-media" : "whatsapp-text"),
          artifactRef: forwarded.handoff.artifact_ref ?? null,
          artifactSha256: forwarded.artifactSha256,
          downstreamDestination: forwarded.downstreamDestination,
          downstreamCorrelationId: forwarded.downstreamCorrelationId,
          downstreamReceipt: forwarded.downstreamReceipt,
          replyText: forwarded.replyText,
        });
        return { replyText: forwarded.replyText };
      },
      ...(adapters.whatsappSocketFactory ? { socketFactory: adapters.whatsappSocketFactory } : {}),
    });
    this.telegram = new TelegramGateway({
      settings: this.settings,
      getEngine: unavailableEngine,
      dataDir: join(dataDir, "telegram"),
      portedInboundHandler: async ({ sender, chatId, messageId, text, media, transcription }) => {
        const forwarded = await this.organ.receive({
          channel: "telegram",
          sender,
          chatId,
          messageId,
          text,
          ...(media ? { media } : {}),
          ...(transcription
            ? {
                transcription: {
                  ...(text ? { text_transcript: text } : {}),
                  ...(transcription.provider ? { transcription_source: transcription.provider } : {}),
                  ...(transcription.failed ? { transcription_failed: transcription.failed } : {}),
                },
              }
            : {}),
        });
        return { replyText: forwarded.replyText };
      },
      ...(adapters.telegramFetch ? { fetchImpl: adapters.telegramFetch } : {}),
    });
  }

  async start(): Promise<void> {
    await this.whatsapp.startIfEnabled();
    await this.telegram.startIfEnabled();
  }

  delivery(): PhylaxTenantDelivery {
    return {
      send: async (channel, recipient, text) => {
        const sent = channel === "whatsapp"
          ? await this.whatsapp.sendText(recipient, text)
          : await this.telegram.sendText(recipient, text);
        return {
          channel,
          recipient,
          sentMessageId: sent.sentMessageId,
          status: "sent",
          at: new Date().toISOString(),
        } satisfies PhylaxDeliveryReceipt;
      },
      status: () => ({ whatsapp: this.whatsapp.status(), telegram: this.telegram.status() }),
    };
  }

  close(): void {
    this.whatsapp.close();
    void this.telegram.close();
    this.whatsappStore.close();
    this.state.close();
  }
}

/** Existing whatsapp-connect.tsx calls these exact ported API shapes. */
export function mountPhylaxAdminChannelRoutes<E extends Env>(app: Hono<E>, runtime: PhylaxPortedRuntime): void {
  app.get("/api/whatsapp/status", (c) => c.json(runtime.whatsapp.status()));
  app.get("/api/telegram/status", (c) => c.json(runtime.telegram.status()));
  app.put("/api/whatsapp/settings", async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const next = runtime.settings.setWhatsAppSettings(body);
    if (next.enabled && next.providerMode === "self_host_dev") {
      await runtime.whatsapp.startIfEnabled();
      await runtime.whatsapp.refreshAllowedSenderAliases();
    } else {
      await runtime.whatsapp.disconnect({ keepEnabled: next.enabled });
    }
    return c.json(runtime.whatsapp.status());
  });
  app.post("/api/whatsapp/pair", async (c) => {
    await runtime.whatsapp.pair();
    await runtime.whatsapp.waitForPairingSignal();
    return c.json(runtime.whatsapp.status());
  });
  app.post("/api/whatsapp/disconnect", async (c) => {
    await runtime.whatsapp.disconnect();
    return c.json(runtime.whatsapp.status());
  });
  app.post("/api/whatsapp/reset-session", async (c) => {
    const body = await c.req.json<{ confirm?: string }>().catch(() => ({} as { confirm?: string }));
    if (body.confirm !== "RESET") return c.json({ error: "confirm must be RESET" }, 400);
    await runtime.whatsapp.resetSession();
    return c.json(runtime.whatsapp.status());
  });
  app.put("/api/telegram/settings", async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    runtime.settings.setTelegramSettings(body);
    await runtime.telegram.close();
    await runtime.telegram.startIfEnabled();
    return c.json(runtime.telegram.status());
  });
}
