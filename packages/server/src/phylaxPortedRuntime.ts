import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Env, Hono } from "hono";
import { SqliteStateStore } from "zenod/state/sqlite";
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
  type PhylaxInboundReceipt,
  type PhylaxTenantDelivery,
  type PhylaxStagedVoice,
  type PhylaxTranscriptionReceipt,
} from "./phylaxChannels.js";
import { probeAudioDurationSeconds } from "./transcribe.js";

const MAX_VOICE_TRANSCRIPTION_SECONDS = 2 * 60 * 60;

function normalizedWhatsAppSenderTimestamp(value: unknown): string | undefined {
  let numeric: number;
  if (typeof value === "object" && value !== null && "low" in value) {
    numeric = Number((value as { low: unknown }).low);
  } else {
    numeric = Number(value);
  }
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function safeVoiceTranscriptionFailure(code: string | null | undefined): string {
  switch (code?.trim().toLowerCase()) {
    case "no_speech":
      return "⚠️ Zenod could not find speech in that voice note. Please try again.";
    case "timeout":
      return "⚠️ Zenod could not finish transcribing that voice note. Please try a shorter note or try again.";
    case "disabled":
    case "not_configured":
    case "unavailable":
    default:
      return "⚠️ Voice transcription is unavailable right now. Please try again later.";
  }
}

/** Keep typed audit/retry state while exposing only bounded Zenod copy. */
function safePortedChannelError(error: unknown): PhylaxChannelError {
  if (!(error instanceof PhylaxChannelError)) {
    return new PhylaxChannelError(
      "downstream_error",
      "Zenod could not process that message. Please try again.",
    );
  }
  const message = error.code === "unmatched_sender"
    ? "This channel is not connected to a Zenod account."
    : error.code === "invalid_input"
      ? "Zenod could not read that message safely. Please check it and try again."
      : error.code === "delivery_error"
        ? "Zenod could not deliver that reply. Please try again."
        : "Zenod could not process that message. Please try again.";
  return new PhylaxChannelError(error.code, message, error.audit, error.retryDisposition);
}

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
  private readonly eventLoopHeartbeatIntervalMs: number;
  private readonly eventLoopHeartbeatStaleMs: number;
  private eventLoopHeartbeatAt = Date.now();
  private eventLoopHeartbeatTimer: NodeJS.Timeout | null = null;
  private readonly probeVoiceDuration: (bytes: Buffer, fileName: string) => Promise<number | null>;
  private readonly onCaptureJobObserved?: (input: {
    tenantId: string;
    surface: "whatsapp" | "telegram";
    conversationKey: string;
    providerMessageId: string;
    jobId: string;
    terminal: boolean;
  }) => void;
  private readonly wakeCaptureTickets?: () => void;

  constructor(
    readonly dataDir: string,
    readonly organ: PhylaxChannelsOrgan,
    env: NodeJS.ProcessEnv = process.env,
    adapters: {
      whatsappSocketFactory?: SocketFactory;
      telegramFetch?: typeof fetch;
      verifyInbound?: (input: {
        channel: "whatsapp" | "telegram";
        sender: string;
        username?: string | null;
        text: string;
      }) => Promise<string | null> | string | null;
      probeVoiceDuration?: (bytes: Buffer, fileName: string) => Promise<number | null>;
      observeCaptureJob?: (input: {
        tenantId: string;
        surface: "whatsapp" | "telegram";
        conversationKey: string;
        providerMessageId: string;
        jobId: string;
        terminal: boolean;
      }) => void;
      wakeCaptureTickets?: () => void;
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
    const configuredHeartbeatInterval = Number(env.PHYLAX_EVENT_LOOP_HEARTBEAT_INTERVAL_MS ?? 5_000);
    this.eventLoopHeartbeatIntervalMs = Number.isFinite(configuredHeartbeatInterval)
      ? Math.max(100, Math.min(configuredHeartbeatInterval, 60_000))
      : 5_000;
    const configuredHeartbeatStale = Number(env.PHYLAX_EVENT_LOOP_HEARTBEAT_STALE_MS ?? 20_000);
    this.eventLoopHeartbeatStaleMs = Number.isFinite(configuredHeartbeatStale)
      ? Math.max(this.eventLoopHeartbeatIntervalMs * 2, Math.min(configuredHeartbeatStale, 300_000))
      : 20_000;
    this.probeVoiceDuration = adapters.probeVoiceDuration ?? ((bytes, fileName) =>
      probeAudioDurationSeconds(bytes, fileName));
    this.onCaptureJobObserved = adapters.observeCaptureJob;
    this.wakeCaptureTickets = adapters.wakeCaptureTickets;
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
      recordPortedReplyDelivery: (inboundProviderMessageId, sentProviderMessageId) => {
        const tenantId = this.whatsappStore.channelAudit(inboundProviderMessageId)?.tenantId;
        if (!tenantId) return;
        this.organ.recordCaptureReceiptDelivery(
          "whatsapp",
          tenantId,
          inboundProviderMessageId,
          sentProviderMessageId,
        );
      },
      portedReplyIntentScope: (inboundProviderMessageId) => {
        const tenantId = this.whatsappStore.channelAudit(inboundProviderMessageId)?.tenantId;
        if (!tenantId) return null;
        return {
          tenantId,
          receiptEligible: this.organ.captureReceiptReady(
            "whatsapp",
            tenantId,
            inboundProviderMessageId,
          ),
        };
      },
      portedInboundHandler: async ({ event, text, media, transcription, timing, progress }) => {
        const verificationReply = await adapters.verifyInbound?.({
          channel: "whatsapp",
          sender: event.senderId,
          text,
        });
        if (verificationReply) return { replyText: verificationReply };
        const normalizedText = text.trim().toLowerCase();
        if (!media && normalizedText === "confirm transcription") {
          return {
            replyText: "No confirmation is required. Zenod starts voice-note processing automatically.",
          };
        }
        if (!media && normalizedText === "cancel transcription") {
          const tenantId = await this.organ.tenantIdFor("whatsapp", event.senderId, event.chatId);
          const sender = normalizeWhatsAppIdentifier(event.senderId);
          const conversationKey = `whatsapp:${sender}`;
          const cancelled = this.whatsappStore.cancelLatestVoiceJob(tenantId, conversationKey);
          if (!cancelled) {
            return { replyText: "No pending voice transcription to cancel in this conversation." };
          }
          this.voiceAbortControllers.get(cancelled.providerMessageId)?.abort();
          return {
            replyText: "Cancelled the pending voice transcription. Nothing was sent to Zenod.",
          };
        }
        const senderTimestamp = normalizedWhatsAppSenderTimestamp(event.timestamp);
        const inbound = {
          channel: "whatsapp",
          sender: event.senderId,
          chatId: event.chatId,
          messageId: event.messageId,
          ...(senderTimestamp ? { senderTimestamp } : {}),
          ...(event.replyToMessageId ? { replyToMessageId: event.replyToMessageId } : {}),
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
          this.whatsappStore.createVoiceJob({
            providerMessageId: event.messageId,
            replyToMessageId: staged.replyToMessageId,
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
            state: "queued",
          });
          return {
            deferred: true,
            replyText: durationSeconds !== null && durationSeconds > MAX_VOICE_TRANSCRIPTION_SECONDS
              ? "I received your voice note. It is over 2 hours, so Zenod will archive the original audio to your Google Drive without transcribing it and create a memory entry pointing to it."
              : 'I received your voice note and queued it for transcription and Google Drive archiving. It may take a while. Send “cancel transcription” to cancel the latest pending voice note in this conversation.',
            afterReply: () => this.kickVoiceWorker(),
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
            this.observeCaptureJob("whatsapp", event.messageId, result);
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
            throw safePortedChannelError(error);
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
          ...(forwarded.afterReply ? { afterReply: forwarded.afterReply } : {}),
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
      portedInboundHandler: async ({ sender, username, chatId, messageId, text, media, transcription }) => {
        const verificationReply = await adapters.verifyInbound?.({
          channel: "telegram",
          sender,
          username,
          text,
        });
        if (verificationReply) return { replyText: verificationReply };
        try {
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
          this.observeCaptureJob("telegram", messageId, forwarded);
          return {
            replyText: forwarded.replyText,
            ...(forwarded.afterReply ? { afterReply: forwarded.afterReply } : {}),
          };
        } catch (error) {
          throw safePortedChannelError(error);
        }
      },
      ...(adapters.telegramFetch ? { fetchImpl: adapters.telegramFetch } : {}),
    });
    this.organ.setTerminalReceiptDelivery(async (channel, recipient, text, captureProviderMessageId) => {
      const delivery = channel === "whatsapp"
        ? await this.whatsapp.sendText(recipient, text, captureProviderMessageId)
        : await this.telegram.sendText(recipient, text);
      this.wakeCaptureTickets?.();
      return delivery;
    });
    this.organ.setTerminalReceiptRecovery(async (
      channel,
      tenantId,
      captureProviderMessageId,
      recipient,
      text,
    ) => {
      if (channel !== "whatsapp") return null;
      return this.whatsapp.recoverPortedReceipt(
        tenantId,
        captureProviderMessageId,
        { recipient, text },
      );
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
          if (job.durationSeconds !== null && job.durationSeconds > MAX_VOICE_TRANSCRIPTION_SECONDS) {
            transcription = {
              duration_seconds: job.durationSeconds,
              transcription_failed: {
                code: "duration_limit",
                message: "audio exceeds Zenod's 2-hour transcription limit",
              },
            };
          } else {
            const bytes = await readFile(job.artifactPath);
            transcription = {
              ...(await this.organ.transcribeStagedVoice({
                tenantId: job.tenantId,
                bytes,
                mimeType: job.mimeType,
                fileName: job.fileName,
              }, controller.signal)),
              duration_seconds: job.durationSeconds,
            };
          }
          if (this.whatsappStore.voiceJob(job.providerMessageId)?.state === "cancelled") continue;
          const skippedForDuration = transcription.transcription_failed?.code === "duration_limit";
          if (!skippedForDuration && (transcription.transcription_failed || !transcription.text_transcript?.trim())) {
            this.whatsappStore.queueVoiceFailureReply(
              job.providerMessageId,
              safeVoiceTranscriptionFailure(transcription.transcription_failed?.code),
            );
            await this.whatsapp.drainMediaRecovery();
            continue;
          }
          if (!this.whatsappStore.persistVoiceTranscript(
            job.providerMessageId,
            transcription as unknown as Record<string, unknown>,
          )) continue;
        }
        if (!transcription.text_transcript?.trim() && transcription.transcription_failed?.code !== "duration_limit") {
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
          replyToMessageId: job.replyToMessageId,
          conversationKey: job.conversationKey,
          artifactRef: job.artifactRef,
          artifactPath: job.artifactPath,
          artifactSha256: job.artifactSha256,
          mimeType: job.mimeType,
          fileName: job.fileName,
          text: job.captionText,
        };
        const result = await this.organ.forwardStagedVoice(staged, transcription);
        this.observeCaptureJob("whatsapp", job.providerMessageId, result);
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
        result.afterReply?.();
      } catch (error) {
        const current = this.whatsappStore.voiceJob(job.providerMessageId);
        if (current?.state === "cancelled") continue;
        if (this.voiceWorkerClosed && current?.state === "transcribing") {
          this.whatsappStore.requeueInterruptedVoiceJob(job.providerMessageId);
          continue;
        }
        if (current?.state === "forwarding") {
          if (
            error instanceof PhylaxChannelError
            && error.retryDisposition === "idempotent_capture"
          ) {
            this.whatsappStore.deferIdempotentVoiceCapture(
              job.providerMessageId,
              "⚠️ Your voice note was transcribed, but Zenod has not returned a save receipt. The transcript is safely retained; retry after the connection is repaired cannot create a second memory.",
            );
          } else {
            this.whatsappStore.markVoiceRingOutcomeUnknown(job.providerMessageId);
          }
        } else {
          this.whatsappStore.queueVoiceFailureReply(
            job.providerMessageId,
            "⚠️ Zenod could not process that voice note. Please try again.",
          );
        }
        await this.whatsapp.drainMediaRecovery();
      } finally {
        this.voiceAbortControllers.delete(job.providerMessageId);
      }
    }
  }

  retryPendingVoiceCaptures(tenantId: string): number {
    const resumed = this.whatsappStore.resumeIdempotentVoiceCaptures(tenantId);
    if (resumed > 0) this.kickVoiceWorker();
    return resumed;
  }

  private observeCaptureJob(
    surface: "whatsapp" | "telegram",
    providerMessageId: string,
    receipt: PhylaxInboundReceipt,
  ): void {
    const structured = receipt.downstream.structuredContent;
    if (!structured || typeof structured !== "object" || Array.isArray(structured)) return;
    const candidate = structured as Record<string, unknown>;
    const jobId = candidate.ticket_id ?? candidate.jobId;
    const kind = candidate.kind;
    const state = candidate.state ?? candidate.status;
    if (
      typeof jobId !== "string"
      || !jobId.trim()
      || (kind !== undefined && kind !== "store" && kind !== "media_ingest")
      || !["accepted", "queued", "polling", "running", "done"].includes(String(state))
    ) return;
    this.onCaptureJobObserved?.({
      tenantId: receipt.tenantId,
      surface,
      conversationKey: `${surface}:${receipt.sender}`,
      providerMessageId,
      jobId: jobId.trim(),
      terminal: state === "done",
    });
  }

  async start(): Promise<void> {
    this.startEventLoopHeartbeat();
    await this.whatsapp.startIfEnabled();
    await this.telegram.startIfEnabled();
    await this.organ.resumePendingCaptures();
  }

  workerHealth(now = Date.now()): {
    status: "ok" | "degraded";
    lastHeartbeatAt: number;
    staleAfterMs: number;
  } {
    return {
      status: now - this.eventLoopHeartbeatAt <= this.eventLoopHeartbeatStaleMs ? "ok" : "degraded",
      lastHeartbeatAt: this.eventLoopHeartbeatAt,
      staleAfterMs: this.eventLoopHeartbeatStaleMs,
    };
  }

  private startEventLoopHeartbeat(): void {
    if (this.eventLoopHeartbeatTimer) return;
    this.eventLoopHeartbeatAt = Date.now();
    this.eventLoopHeartbeatTimer = setInterval(() => {
      this.eventLoopHeartbeatAt = Date.now();
    }, this.eventLoopHeartbeatIntervalMs);
    this.eventLoopHeartbeatTimer.unref();
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
    if (this.eventLoopHeartbeatTimer) clearInterval(this.eventLoopHeartbeatTimer);
    this.eventLoopHeartbeatTimer = null;
    for (const controller of this.voiceAbortControllers.values()) controller.abort();
    const failures: unknown[] = [];
    const voiceDrain = (async (): Promise<void> => {
      if (!this.voiceWorkerPromise) return;
      let timer: NodeJS.Timeout | null = null;
      try {
        await Promise.race([
          this.voiceWorkerPromise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Phylax voice worker did not stop within 5000ms")), 5_000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    for (
      const result of await Promise.allSettled([
        this.whatsapp.close(),
        this.telegram.close(),
        voiceDrain,
      ])
    ) {
      if (result.status === "rejected") failures.push(result.reason);
    }
    try {
      this.whatsappStore.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      this.state.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.organ.close();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw new AggregateError(failures, "Phylax channel shutdown failed");
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
