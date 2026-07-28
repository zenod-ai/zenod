import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Env, Hono } from "hono";
import { SqliteStateStore } from "zenod";
import { Settings } from "./settings.js";
import { WhatsAppGateway, type SocketFactory } from "./whatsappGateway.js";
import { WhatsAppStore } from "./whatsappStore.js";
import { normalizeWhatsAppIdentifier } from "./whatsappConfig.js";
import { TelegramGateway } from "./telegramGateway.js";
import {
  PhylaxChannelError,
  PhylaxChannelsOrgan,
  phylaxWhatsAppPaths,
  type PhylaxDeliveryReceipt,
  type PhylaxTenantDelivery,
  type PhylaxStagedVoice,
  type PhylaxTranscriptionReceipt,
} from "./phylaxChannels.js";
import { probeAudioDurationSeconds } from "./transcribe.js";

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
  private readonly mediaCoalescingWindowMs: number;
  private readonly voiceProgressDelayMs: number;
  private readonly mediaInFlight = new Map<string, Promise<Awaited<ReturnType<PhylaxChannelsOrgan["receive"]>>>>();
  private readonly voiceAbortControllers = new Map<string, AbortController>();
  private voiceWorkerRunning = false;
  private voiceWorkerClosed = false;
  private voiceWorkerWakeRequested = false;
  private voiceWorkerPromise: Promise<void> | null = null;
  private lastVoiceTenantId: string | null = null;
  private readonly probeVoiceDuration: (bytes: Buffer, fileName: string) => Promise<number | null>;

  constructor(
    readonly dataDir: string,
    readonly organ: PhylaxChannelsOrgan,
    env: NodeJS.ProcessEnv = process.env,
    adapters: {
      whatsappSocketFactory?: SocketFactory;
      telegramFetch?: typeof fetch;
      verifyInbound?: (input: { channel: "whatsapp"; sender: string; text: string }) => Promise<string | null> | string | null;
      probeVoiceDuration?: (bytes: Buffer, fileName: string) => Promise<number | null>;
    } = {},
  ) {
    const configuredWindow = Number(env.PHYLAX_MEDIA_COALESCE_WINDOW_MS ?? 300_000);
    this.mediaCoalescingWindowMs = Number.isFinite(configuredWindow)
      ? Math.max(1_000, Math.min(configuredWindow, 3_600_000))
      : 300_000;
    const configuredProgressDelay = Number(env.PHYLAX_VOICE_PROGRESS_DELAY_MS ?? 5_000);
    this.voiceProgressDelayMs = Number.isFinite(configuredProgressDelay)
      ? Math.max(100, Math.min(configuredProgressDelay, 30_000))
      : 5_000;
    this.probeVoiceDuration = adapters.probeVoiceDuration ?? ((bytes, fileName) =>
      probeAudioDurationSeconds(bytes, fileName));
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
      portedInboundHandler: async ({ event, text, media, transcription, timing, progress }) => {
        const verificationReply = await adapters.verifyInbound?.({
          channel: "whatsapp",
          sender: event.senderId,
          text,
        });
        if (verificationReply) return { replyText: verificationReply };
        const normalizedText = text.trim().toLowerCase();
        if (!media && (normalizedText === "cancel transcription" || normalizedText === "confirm transcription")) {
          const tenantId = await this.organ.tenantIdFor("whatsapp", event.senderId, event.chatId);
          const sender = normalizeWhatsAppIdentifier(event.senderId);
          const conversationKey = `whatsapp:${sender}`;
          if (normalizedText === "cancel transcription") {
            const cancelled = this.whatsappStore.cancelLatestVoiceJob(tenantId, conversationKey);
            if (!cancelled) {
              return { replyText: "No pending voice transcription to cancel in this conversation." };
            }
            this.voiceAbortControllers.get(cancelled.providerMessageId)?.abort();
            return {
              replyText: `Cancelled transcription ${cancelled.providerMessageId}. Nothing was sent to Ring.`,
            };
          }
          const confirmed = this.whatsappStore.confirmLatestVoiceJob(tenantId, conversationKey);
          if (!confirmed) {
            return { replyText: "No voice transcription is waiting for confirmation in this conversation." };
          }
          return {
            replyText:
              `Confirmed transcription ${confirmed.providerMessageId}. It is queued and may take a while. `
              + 'Send “cancel transcription” to cancel it before Ring handoff starts.',
            afterReply: () => this.kickVoiceWorker(),
          };
        }
        const inbound = {
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
        } as const;
        let mediaClaim: ReturnType<WhatsAppStore["claimMediaCoalescing"]> | null = null;
        let claimedTenantId: string | null = null;
        if (media?.bytes) {
          const tenantId = await this.organ.tenantIdFor("whatsapp", event.senderId, event.chatId);
          claimedTenantId = tenantId;
          const artifactSha256 = createHash("sha256").update(media.bytes).digest("hex");
          mediaClaim = this.whatsappStore.claimMediaCoalescing({
            providerMessageId: event.messageId,
            tenantId,
            channel: "whatsapp",
            artifactSha256,
            windowMs: this.mediaCoalescingWindowMs,
          });
          if (mediaClaim.role === "duplicate") {
            const canonicalInFlight = this.mediaInFlight.get(mediaClaim.canonicalProviderMessageId);
            if (canonicalInFlight) await canonicalInFlight.catch(() => undefined);
            const canonical = this.whatsappStore.channelAudit(mediaClaim.canonicalProviderMessageId);
            if (canonical) {
              this.whatsappStore.recordCoalescedChannelForwarding({
                providerMessageId: event.messageId,
                canonicalProviderMessageId: mediaClaim.canonicalProviderMessageId,
                artifactSha256,
                senderId: normalizeWhatsAppIdentifier(event.senderId),
                timing: { mediaDownloadMs: timing.mediaDownloadMs },
              });
            }
            return {
              replyText: canonical?.replyText ?? "",
              suppressReply: true,
              timing: { mediaDownloadMs: timing.mediaDownloadMs },
            };
          }
        }
        const isVoice = Boolean(media?.bytes && (
          media.mimeType?.toLowerCase().startsWith("audio/")
          || /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|webm)$/i.test(media.fileName?.trim() ?? "")
        ));
        if (mediaClaim?.role === "owner" && isVoice && media?.bytes) {
          const staged = await this.organ.stageVoice(inbound, claimedTenantId ?? undefined);
          const durationSeconds = await this.probeVoiceDuration(
            media.bytes,
            media.fileName?.trim() || `${event.messageId}.ogg`,
          );
          const needsConfirmation = durationSeconds === null || durationSeconds > 30 * 60;
          this.whatsappStore.createVoiceJob({
            providerMessageId: event.messageId,
            tenantId: staged.tenantId,
            conversationKey: staged.conversationKey,
            senderId: staged.sender,
            chatId: staged.chatId,
            artifactRef: staged.artifactRef,
            artifactPath: staged.artifactPath,
            artifactSha256: staged.artifactSha256,
            mimeType: staged.mimeType,
            fileName: staged.fileName,
            captionText: staged.text,
            durationSeconds,
            state: needsConfirmation ? "awaiting_confirmation" : "queued",
          });
          return {
            deferred: true,
            replyText: durationSeconds === null
              ? 'I could not determine this voice note’s length safely. Reply “confirm transcription” to start it, or “cancel transcription” to cancel it.'
              : needsConfirmation
              ? 'This voice note is longer than 30 minutes. Reply “confirm transcription” to start it, or “cancel transcription” to cancel it.'
              : 'I received your voice note and queued it for transcription. It may take a while. Send “cancel transcription” to cancel the latest pending voice note in this conversation.',
            ...(!needsConfirmation ? { afterReply: () => this.kickVoiceWorker() } : {}),
            timing: { mediaDownloadMs: timing.mediaDownloadMs },
          };
        }
        const forwarding = (async () => {
          try {
            const result = await this.organ.receive(inbound, claimedTenantId ?? undefined);
            this.whatsappStore.recordChannelForwarding({
              providerMessageId: event.messageId,
              tenantId: result.tenantId,
              senderId: result.sender,
              transcriptText: result.handoff.text_transcript ?? null,
              transcriptProvenance:
                result.handoff.transcription_source ?? (media ? "whatsapp-media" : "whatsapp-text"),
              transcriptionFailureCode: result.handoff.transcription_failed?.code ?? null,
              artifactRef: result.handoff.artifact_ref ?? null,
              artifactSha256: result.artifactSha256,
              downstreamDestination: result.downstreamDestination,
              downstreamCorrelationId: result.downstreamCorrelationId,
              downstreamReceipt: result.downstreamReceipt,
              replyText: result.replyText,
              canonicalProviderMessageId: mediaClaim?.canonicalProviderMessageId ?? null,
              coalescingState: mediaClaim ? "owner" : null,
              timing: {
                mediaDownloadMs: timing.mediaDownloadMs,
                transcriptionQueueWaitMs: result.timing.transcriptionQueueWaitMs,
                transcriptionRuntimeMs: result.timing.transcriptionRuntimeMs,
                downstreamMs: result.timing.downstreamMs,
              },
            });
            if (mediaClaim) this.whatsappStore.completeMediaCoalescing(mediaClaim.canonicalProviderMessageId, "completed");
            return result;
          } catch (error) {
            if (error instanceof PhylaxChannelError && error.audit) {
              this.whatsappStore.recordChannelFailure({
                providerMessageId: event.messageId,
                tenantId: error.audit.tenantId,
                senderId: error.audit.sender,
                transcriptText: error.audit.transcriptText,
                transcriptProvenance: error.audit.transcriptProvenance,
                transcriptionFailureCode: error.audit.transcriptionFailureCode,
                artifactRef: error.audit.artifactRef,
                artifactSha256: error.audit.artifactSha256,
                downstreamDestination: error.audit.downstreamDestination,
                downstreamCorrelationId: error.audit.downstreamCorrelationId,
                downstreamReceipt: error.audit.downstreamReceipt,
                canonicalProviderMessageId: mediaClaim?.canonicalProviderMessageId ?? null,
                coalescingState: mediaClaim ? "owner" : null,
                failureStage: error.audit.failureStage,
                failureCode: error.audit.failureCode,
                timing: {
                  mediaDownloadMs: timing.mediaDownloadMs,
                  transcriptionQueueWaitMs: error.audit.timing.transcriptionQueueWaitMs,
                  transcriptionRuntimeMs: error.audit.timing.transcriptionRuntimeMs,
                  downstreamMs: error.audit.timing.downstreamMs,
                },
              });
            }
            if (mediaClaim) this.whatsappStore.completeMediaCoalescing(mediaClaim.canonicalProviderMessageId, "failed");
            throw error;
          }
        })();
        if (mediaClaim) this.mediaInFlight.set(mediaClaim.canonicalProviderMessageId, forwarding);
        let forwardingSettled = false;
        let progressPromise: Promise<void> | null = null;
        const progressTimer = mediaClaim?.role === "owner" && isVoice
          ? setTimeout(() => {
              if (forwardingSettled) return;
              progressPromise = progress("I received your voice note and I’m still processing it.")
                .catch((error) => console.warn("[phylax] voice progress receipt failed:", error));
            }, this.voiceProgressDelayMs)
          : null;
        progressTimer?.unref?.();
        let forwarded: Awaited<typeof forwarding>;
        try {
          forwarded = await forwarding;
        } finally {
          forwardingSettled = true;
          if (progressTimer) clearTimeout(progressTimer);
          if (progressPromise) await progressPromise;
          if (mediaClaim) this.mediaInFlight.delete(mediaClaim.canonicalProviderMessageId);
        }
        return {
          replyText: forwarded.replyText,
          timing: {
            mediaDownloadMs: timing.mediaDownloadMs,
            transcriptionQueueWaitMs: forwarded.timing.transcriptionQueueWaitMs,
            transcriptionRuntimeMs: forwarded.timing.transcriptionRuntimeMs,
            downstreamMs: forwarded.timing.downstreamMs,
          },
        };
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
    queueMicrotask(() => this.kickVoiceWorker());
  }

  private kickVoiceWorker(): void {
    if (this.voiceWorkerClosed) return;
    this.voiceWorkerWakeRequested = true;
    if (this.voiceWorkerRunning) return;
    this.voiceWorkerRunning = true;
    this.voiceWorkerPromise = (async () => {
      try {
        do {
          this.voiceWorkerWakeRequested = false;
          await this.runVoiceWorker();
        } while (this.voiceWorkerWakeRequested && !this.voiceWorkerClosed);
      } finally {
        this.voiceWorkerRunning = false;
        this.voiceWorkerPromise = null;
        if (this.voiceWorkerWakeRequested && !this.voiceWorkerClosed) this.kickVoiceWorker();
      }
    })();
  }

  private async runVoiceWorker(): Promise<void> {
    for (;;) {
      if (this.voiceWorkerClosed) return;
      const job = this.whatsappStore.claimNextVoiceJob(this.lastVoiceTenantId);
      if (!job) return;
      this.lastVoiceTenantId = job.tenantId;
      const controller = new AbortController();
      this.voiceAbortControllers.set(job.providerMessageId, controller);
      try {
        let transcription: PhylaxTranscriptionReceipt;
        if (job.state === "transcribed") {
          transcription = (job.transcription ?? {}) as PhylaxTranscriptionReceipt;
        } else {
          const bytes = await readFile(job.artifactPath);
          transcription = await this.organ.transcribeStagedVoice({
            tenantId: job.tenantId,
            bytes,
            mimeType: job.mimeType,
            fileName: job.fileName,
          }, controller.signal);
          if (this.whatsappStore.voiceJob(job.providerMessageId)?.state === "cancelled") continue;
          if (transcription.transcription_failed || !transcription.text_transcript?.trim()) {
            const message = transcription.transcription_failed?.message ?? "transcription returned no text";
            this.whatsappStore.queueVoiceFailureReply(
              job.providerMessageId,
              `⚠️ I could not transcribe that voice note: ${message}`,
            );
            await this.whatsapp.drainMediaRecovery();
            continue;
          }
          if (!this.whatsappStore.persistVoiceTranscript(
            job.providerMessageId,
            transcription as unknown as Record<string, unknown>,
          )) continue;
        }
        if (!transcription.text_transcript?.trim()) {
          this.whatsappStore.queueVoiceFailureReply(
            job.providerMessageId,
            "⚠️ I could not process the persisted voice transcript because it was empty.",
          );
          await this.whatsapp.drainMediaRecovery();
          continue;
        }
        if (!this.whatsappStore.claimVoiceRingHandoff(job.providerMessageId)) continue;
        const staged: PhylaxStagedVoice = {
          tenantId: job.tenantId,
          sender: job.senderId,
          chatId: job.chatId,
          messageId: job.providerMessageId,
          conversationKey: job.conversationKey,
          artifactRef: job.artifactRef,
          artifactPath: job.artifactPath,
          artifactSha256: job.artifactSha256,
          mimeType: job.mimeType,
          fileName: job.fileName,
          text: job.captionText,
        };
        const result = await this.organ.forwardStagedVoice(staged, transcription);
        this.whatsappStore.recordChannelForwarding({
          providerMessageId: job.providerMessageId,
          tenantId: result.tenantId,
          senderId: result.sender,
          transcriptText: result.handoff.text_transcript ?? null,
          transcriptProvenance: result.handoff.transcription_source ?? "whatsapp-media",
          transcriptionFailureCode: null,
          artifactRef: result.handoff.artifact_ref ?? null,
          artifactSha256: job.artifactSha256,
          downstreamDestination: result.downstreamDestination,
          downstreamCorrelationId: result.downstreamCorrelationId,
          downstreamReceipt: result.downstreamReceipt,
          replyText: result.replyText,
          canonicalProviderMessageId: job.providerMessageId,
          coalescingState: "owner",
          timing: {
            transcriptionQueueWaitMs: result.timing.transcriptionQueueWaitMs,
            transcriptionRuntimeMs: result.timing.transcriptionRuntimeMs,
            downstreamMs: result.timing.downstreamMs,
          },
        });
        this.whatsappStore.reconcileVoiceCoalescedFollowers(job.providerMessageId);
        this.whatsappStore.completeVoiceRingHandoff(job.providerMessageId, result.replyText);
        await this.whatsapp.drainMediaRecovery();
      } catch (error) {
        const current = this.whatsappStore.voiceJob(job.providerMessageId);
        if (current?.state === "cancelled") continue;
        if (this.voiceWorkerClosed && current?.state === "transcribing") {
          this.whatsappStore.requeueInterruptedVoiceJob(job.providerMessageId);
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        if (current?.state === "forwarding") {
          this.whatsappStore.markVoiceRingOutcomeUnknown(job.providerMessageId);
        } else {
          this.whatsappStore.queueVoiceFailureReply(
            job.providerMessageId,
            `⚠️ I could not process that voice note: ${message}`,
          );
        }
        await this.whatsapp.drainMediaRecovery();
      } finally {
        this.voiceAbortControllers.delete(job.providerMessageId);
      }
    }
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

  async close(): Promise<void> {
    this.voiceWorkerClosed = true;
    for (const controller of this.voiceAbortControllers.values()) controller.abort();
    this.whatsapp.close();
    await this.voiceWorkerPromise?.catch(() => undefined);
    await this.telegram.close();
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
