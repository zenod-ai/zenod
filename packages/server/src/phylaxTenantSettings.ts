import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ChassisStorage } from "@zenod/mcp-chassis";
import { normalizeTelegramEntry } from "./telegramConfig.js";
import { normalizeWhatsAppIdentifier } from "./whatsappConfig.js";
import type { PhylaxPortedChannel, PhylaxTenantRoute } from "./phylaxChannels.js";

const DOWNSTREAM_TOKEN_KEY = "phylax_downstream_token";
const DOWNSTREAM_URL_KEY = "phylax_downstream_url";
const ASSISTANT_TOKEN_KEY = "phylax_assistant_token";
const ASSISTANT_URL_KEY = "phylax_assistant_url";
const RING_TICKET_TOKEN_KEY = "phylax_ring_ticket_token";
const RING_TICKET_URL_KEY = "phylax_ring_ticket_url";
const TRANSCRIPTION_TOKEN_KEY = "phylax_transcription_token";
const VERIFY_TTL_MS = 30 * 60_000;
export type PhylaxTranscriptionProvider = "local" | "groq" | "openai" | "openrouter";
export const PHYLAX_TURN_TYPES = ["voice_note", "text", "media"] as const;
export type PhylaxTurnType = (typeof PHYLAX_TURN_TYPES)[number];
export type PhylaxVoiceDefault = "capture" | "assistant";
export type PhylaxBindingConstant =
  | string
  | number
  | boolean
  | null
  | PhylaxBindingConstant[]
  | { [key: string]: PhylaxBindingConstant };

export type PhylaxBindingArgumentSource =
  | { source: "transcript" }
  | { source: "sender" }
  | { source: "chatId" }
  | { source: "artifactUrl" }
  | { source: "mediaType" }
  | { source: "filename" }
  | { source: "channel" }
  | { source: "providerMessageId" }
  | { source: "senderTimestamp" }
  | { source: "constant"; value: PhylaxBindingConstant }
  | { source: "message" }
  | { source: "surface" }
  | { source: "conversationKey" };

export interface PhylaxTurnBinding {
  tool: string;
  argumentMappings: Record<string, PhylaxBindingArgumentSource>;
}

export type PhylaxTurnBindings = Record<PhylaxTurnType, PhylaxTurnBinding>;

const CLOUD_TRANSCRIPTION_PROVIDERS = ["groq", "openai", "openrouter"] as const;
const VERIFICATION_ANIMALS = [
  "badger",
  "bear",
  "bison",
  "cat",
  "deer",
  "dolphin",
  "eagle",
  "falcon",
  "fox",
  "gecko",
  "heron",
  "koala",
  "lemur",
  "lion",
  "lynx",
  "otter",
  "owl",
  "panda",
  "puma",
  "raven",
  "seal",
  "shark",
  "tiger",
  "turtle",
  "whale",
  "wolf",
] as const;

export interface PhylaxTenantSettings {
  tenantId: string;
  phoneNumber: string | null;
  verified: boolean;
  numberId: string;
  verificationHash: string | null;
  verificationExpiresAt: number | null;
  downstreamUrl: string | null;
  downstreamCredentialStatus: "unknown" | "healthy" | "rejected";
  downstreamCredentialCheckedAt: string | null;
  downstreamCredentialRevision: string | null;
  assistantUrl: string | null;
  ringTicketUrl: string | null;
  transcriptionEnabled: boolean;
  transcriptionProvider: PhylaxTranscriptionProvider;
  transcriptionModel: string | null;
  voiceDefault: PhylaxVoiceDefault;
  turnBindings: PhylaxTurnBindings;
  telegramBinding: string | null;
  notificationPrefs: { whatsapp: boolean; telegram: boolean };
  updatedAt: string;
}

export interface PhylaxTenantSettingsView extends Omit<
  PhylaxTenantSettings,
  "verificationHash" | "downstreamCredentialRevision"
> {
  downstreamTokenConfigured: boolean;
  assistantTokenConfigured: boolean;
  ringTicketTokenConfigured: boolean;
  transcriptionKeyConfigured: boolean;
  transcriptionKeysConfigured: Record<Exclude<PhylaxTranscriptionProvider, "local">, boolean>;
}

export interface PhylaxDownstreamCredentials {
  url: string;
  token: string;
}

type Store = Record<string, PhylaxTenantSettings>;

function legacyRingChatBinding(): PhylaxTurnBinding {
  return {
    tool: "chat_with_ring",
    argumentMappings: {
      message: { source: "message" },
      surface: { source: "surface" },
      conversationKey: { source: "conversationKey" },
    },
  };
}

function directZenodChatBinding(): PhylaxTurnBinding {
  return {
    tool: "chat_with_zenod",
    argumentMappings: {
      message: { source: "message" },
      surface: { source: "surface" },
      conversationKey: { source: "conversationKey" },
    },
  };
}

/**
 * The first Hosted deployment persisted the old default Ring binding in every
 * tenant row. Migrate only that exact generated value at read time. A customer
 * who deliberately configured another Ring binding keeps it, and rollback is
 * simply running the previous code because the settings file is never rewritten.
 */
function isGeneratedLegacyRingChatBinding(binding: PhylaxTurnBinding): boolean {
  const legacy = legacyRingChatBinding();
  return binding.tool === legacy.tool
    && JSON.stringify(binding.argumentMappings) === JSON.stringify(legacy.argumentMappings);
}

/**
 * D17's globally approved sane defaults. Existing persisted tenant overrides
 * remain authoritative; this function contains no tenant-specific branch.
 */
export function defaultPhylaxTurnBindings(): PhylaxTurnBindings {
  return {
    voice_note: {
      tool: "store_memory",
      argumentMappings: {
        content: { source: "transcript" },
        verbatim: { source: "constant", value: true },
        hints: { source: "constant", value: ["WhatsApp voice note"] },
        source: { source: "channel" },
        contentType: { source: "constant", value: "voice_note" },
        capturedAt: { source: "senderTimestamp" },
        sourceId: { source: "providerMessageId" },
      },
    },
    text: directZenodChatBinding(),
    media: {
      tool: "ingest_memory",
      argumentMappings: {
        artifactUrl: { source: "artifactUrl" },
        mediaType: { source: "mediaType" },
        filename: { source: "filename" },
        sourceHint: { source: "constant", value: "WhatsApp media" },
      },
    },
  };
}

/**
 * Resolve standalone routing from structural facts only. Reply-context routing
 * is deliberately excluded here and belongs to MC-12.
 */
export function resolvePhylaxTurnBinding(
  settings: Pick<PhylaxTenantSettings, "voiceDefault" | "turnBindings">,
  turnType: PhylaxTurnType,
): PhylaxTurnBinding {
  return turnType === "voice_note" && settings.voiceDefault === "assistant"
    ? settings.turnBindings.text
    : settings.turnBindings[turnType];
}

/** Materialize the route table consumed by the mechanical dispatcher. */
export function effectivePhylaxTurnBindings(
  settings: Pick<PhylaxTenantSettings, "voiceDefault" | "turnBindings">,
): PhylaxTurnBindings {
  return {
    voice_note: resolvePhylaxTurnBinding(settings, "voice_note"),
    text: resolvePhylaxTurnBinding(settings, "text"),
    media: resolvePhylaxTurnBinding(settings, "media"),
  };
}

function cloneConstant(
  value: unknown,
  seen: Set<object>,
  depth: number,
): PhylaxBindingConstant {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (depth > 16) throw new Error("binding constant exceeds maximum depth");
  if (typeof value !== "object") throw new Error("binding constant must contain only JSON values");
  if (seen.has(value)) throw new Error("binding constant must not be circular");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => cloneConstant(item, seen, depth + 1));
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error("binding constant must contain only plain objects");
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneConstant(item, seen, depth + 1)]),
    );
  } finally {
    seen.delete(value);
  }
}

export const PHYLAX_BINDING_ARGUMENT_SOURCES = [
  "transcript",
  "sender",
  "chatId",
  "artifactUrl",
  "mediaType",
  "filename",
  "channel",
  "providerMessageId",
  "senderTimestamp",
  "constant",
  "message",
  "surface",
  "conversationKey",
] as const;

function normalizedArgumentSource(value: unknown): PhylaxBindingArgumentSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("binding argument source must be an object");
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error("binding argument source must be a plain object");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.source !== "string"
    || !PHYLAX_BINDING_ARGUMENT_SOURCES.includes(
      candidate.source as (typeof PHYLAX_BINDING_ARGUMENT_SOURCES)[number],
    )
  ) {
    throw new Error("invalid binding argument source");
  }
  const expectedKeys = candidate.source === "constant" ? ["source", "value"] : ["source"];
  const unknownKey = Object.keys(candidate).find((key) => !expectedKeys.includes(key));
  if (unknownKey || Object.keys(candidate).length !== expectedKeys.length) {
    throw new Error(`invalid ${candidate.source} binding argument source`);
  }
  if (candidate.source === "constant") {
    return {
      source: "constant",
      value: cloneConstant(candidate.value, new Set(), 0),
    };
  }
  return { source: candidate.source } as PhylaxBindingArgumentSource;
}

function normalizedArgumentMappings(
  value: unknown,
): Record<string, PhylaxBindingArgumentSource> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("turn binding argumentMappings must be an object");
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error("turn binding argumentMappings must be a plain object");
  }
  return Object.fromEntries(
    Object.entries(value).map(([field, source]) => {
      if (!field.trim() || field !== field.trim() || field.length > 128 || /[\u0000-\u001f\u007f]/.test(field)) {
        throw new Error("binding target field is invalid");
      }
      return [field, normalizedArgumentSource(source)];
    }),
  );
}

function normalizedTurnBinding(value: unknown): PhylaxTurnBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("turn binding must be an object");
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error("turn binding must be a plain object");
  }
  const candidate = value as { tool?: unknown; argumentMappings?: unknown };
  const unknownKey = Object.keys(value).find(
    (key) => key !== "tool" && key !== "argumentMappings",
  );
  if (unknownKey) throw new Error(`unsupported turn binding field: ${unknownKey}`);
  if (typeof candidate.tool !== "string" || !candidate.tool.trim()) {
    throw new Error("turn binding tool is required");
  }
  if (candidate.tool.trim().length > 128 || /[\u0000-\u001f\u007f]/.test(candidate.tool)) {
    throw new Error("turn binding tool is invalid");
  }
  return {
    tool: candidate.tool.trim(),
    argumentMappings: normalizedArgumentMappings(candidate.argumentMappings),
  };
}

function normalizedStoredTurnBindings(value: unknown): PhylaxTurnBindings {
  const defaults = defaultPhylaxTurnBindings();
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const stored = value as Record<string, unknown>;
  for (const turnType of PHYLAX_TURN_TYPES) {
    if (stored[turnType] === undefined) continue;
    try {
      const normalized = normalizedTurnBinding(stored[turnType]);
      if (turnType === "text" && isGeneratedLegacyRingChatBinding(normalized)) {
        continue;
      }
      defaults[turnType] = normalized;
    } catch {
      // A corrupt row must not strand a tenant; preserve the approved D17 default.
    }
  }
  return defaults;
}

function updatedTurnBindings(
  current: PhylaxTurnBindings,
  patch: Partial<Record<PhylaxTurnType, PhylaxTurnBinding>>,
): PhylaxTurnBindings {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("turnBindings must be an object");
  }
  const unknownTurnType = Object.keys(patch).find(
    (turnType) => !PHYLAX_TURN_TYPES.includes(turnType as PhylaxTurnType),
  );
  if (unknownTurnType) throw new Error(`invalid Phylax turn type: ${unknownTurnType}`);
  const next = normalizedStoredTurnBindings(current);
  for (const turnType of PHYLAX_TURN_TYPES) {
    if (patch[turnType] !== undefined) next[turnType] = normalizedTurnBinding(patch[turnType]);
  }
  return next;
}

function defaultSettings(
  tenantId: string,
  defaultAssistantUrl: string | null,
  defaultRingTicketUrl: string | null,
): PhylaxTenantSettings {
  return {
    tenantId,
    phoneNumber: null,
    verified: false,
    numberId: "primary",
    verificationHash: null,
    verificationExpiresAt: null,
    downstreamUrl: null,
    downstreamCredentialStatus: "unknown",
    downstreamCredentialCheckedAt: null,
    downstreamCredentialRevision: null,
    assistantUrl: defaultAssistantUrl,
    ringTicketUrl: defaultRingTicketUrl,
    transcriptionEnabled: true,
    transcriptionProvider: "local",
    transcriptionModel: null,
    voiceDefault: "capture",
    turnBindings: defaultPhylaxTurnBindings(),
    telegramBinding: null,
    notificationPrefs: { whatsapp: true, telegram: false },
    updatedAt: new Date(0).toISOString(),
  };
}

function verificationDigest(keyword: string): Buffer {
  return createHash("sha256").update(keyword.trim().toLowerCase(), "utf8").digest();
}

function friendlyVerificationKeyword(): string {
  const entropy = randomBytes(2);
  const number = 10 + ((entropy[0] ?? 0) % 90);
  const animal = VERIFICATION_ANIMALS[(entropy[1] ?? 0) % VERIFICATION_ANIMALS.length] ?? "otter";
  return `${number}-${animal}`;
}

function normalizedDownstreamUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("downstream URL must use https");
  }
  return parsed.toString();
}

/** Tenant channel rows plus encrypted downstream-token custody. */
export class PhylaxTenantSettingsStore {
  readonly path: string;
  private readonly defaultAssistantUrl: string | null;
  private readonly defaultRingTicketUrl: string | null;

  constructor(
    dataDir: string,
    private readonly storage: ChassisStorage,
    defaults: { assistantUrl?: string | null; ringTicketUrl?: string | null } = {},
  ) {
    this.path = join(dataDir, "phylax-tenant-settings.json");
    this.defaultAssistantUrl = defaults.assistantUrl?.trim()
      ? normalizedDownstreamUrl(defaults.assistantUrl)
      : null;
    this.defaultRingTicketUrl = defaults.ringTicketUrl?.trim()
      ? normalizedDownstreamUrl(defaults.ringTicketUrl)
      : null;
  }

  get(tenantId: string): PhylaxTenantSettings {
    const stored = this.load()[tenantId];
    return stored
      ? {
          ...defaultSettings(tenantId, this.defaultAssistantUrl, this.defaultRingTicketUrl),
          ...stored,
          voiceDefault: stored.voiceDefault === "assistant" ? "assistant" : "capture",
          turnBindings: normalizedStoredTurnBindings(stored.turnBindings),
          downstreamCredentialStatus: stored.downstreamCredentialStatus ?? "unknown",
          downstreamCredentialCheckedAt: stored.downstreamCredentialCheckedAt ?? null,
        }
      : defaultSettings(tenantId, this.defaultAssistantUrl, this.defaultRingTicketUrl);
  }

  view(tenantId: string): PhylaxTenantSettingsView {
    const current = this.get(tenantId);
    const {
      verificationHash: _verificationHash,
      downstreamCredentialRevision: _downstreamCredentialRevision,
      ...settings
    } = current;
    const transcriptionKeysConfigured = Object.fromEntries(
      CLOUD_TRANSCRIPTION_PROVIDERS.map((provider) => [
        provider,
        this.transcriptionKey(tenantId, provider) !== null,
      ]),
    ) as PhylaxTenantSettingsView["transcriptionKeysConfigured"];
    return {
      ...settings,
      downstreamUrl: this.encryptedDownstreamUrl(current),
      downstreamTokenConfigured: this.secret(tenantId, DOWNSTREAM_TOKEN_KEY) !== null,
      assistantUrl: this.encryptedAssistantUrl(current),
      assistantTokenConfigured: this.secret(tenantId, ASSISTANT_TOKEN_KEY) !== null,
      ringTicketUrl: this.encryptedRingTicketUrl(current),
      ringTicketTokenConfigured: this.secret(tenantId, RING_TICKET_TOKEN_KEY) !== null,
      transcriptionKeyConfigured: current.transcriptionProvider === "local"
        ? false
        : transcriptionKeysConfigured[current.transcriptionProvider],
      transcriptionKeysConfigured,
    };
  }

  /**
   * Server-only credential access for authenticated downstream operations.
   * Callers must never serialize this value into an HTTP response or log it.
   */
  downstreamCredentials(tenantId: string): PhylaxDownstreamCredentials | null {
    const current = this.get(tenantId);
    const url = this.encryptedDownstreamUrl(current);
    const token = this.secret(tenantId, DOWNSTREAM_TOKEN_KEY);
    return url && token ? { url, token } : null;
  }

  /** Server-only Ring assistant authority; never used by memory capture dispatch. */
  assistantCredentials(tenantId: string): PhylaxDownstreamCredentials | null {
    const current = this.get(tenantId);
    const url = this.encryptedAssistantUrl(current);
    const token = this.secret(tenantId, ASSISTANT_TOKEN_KEY);
    return url && token ? { url, token } : null;
  }

  /** Server-only post-terminal Ring ticket connection; never used by capture dispatch. */
  ringTicketCredentials(tenantId: string): PhylaxDownstreamCredentials | null {
    const current = this.get(tenantId);
    const url = this.encryptedRingTicketUrl(current);
    const token = this.secret(tenantId, RING_TICKET_TOKEN_KEY);
    return url && token ? { url, token } : null;
  }

  update(
    tenantId: string,
    input: {
      downstreamUrl?: string | null;
      downstreamToken?: string | null;
      assistantUrl?: string | null;
      assistantToken?: string | null;
      ringTicketUrl?: string | null;
      ringTicketToken?: string | null;
      transcriptionEnabled?: boolean;
      transcriptionProvider?: PhylaxTenantSettings["transcriptionProvider"];
      transcriptionModel?: string | null;
      transcriptionKey?: string | null;
      voiceDefault?: PhylaxVoiceDefault;
      turnBindings?: Partial<Record<PhylaxTurnType, PhylaxTurnBinding>>;
      telegramBinding?: string | null;
      notificationPrefs?: Partial<PhylaxTenantSettings["notificationPrefs"]>;
    },
  ): PhylaxTenantSettingsView {
    const current = this.get(tenantId);
    const currentDownstreamUrl = this.encryptedDownstreamUrl(current);
    if (
      input.transcriptionProvider !== undefined &&
      !["local", "groq", "openai", "openrouter"].includes(input.transcriptionProvider)
    ) throw new Error("invalid transcription provider");
    if (input.voiceDefault !== undefined && !["capture", "assistant"].includes(input.voiceDefault)) {
      throw new Error("invalid voiceDefault");
    }
    const nextDownstreamUrl = input.downstreamUrl !== undefined
      ? input.downstreamUrl?.trim() ? normalizedDownstreamUrl(input.downstreamUrl) : null
      : currentDownstreamUrl;
    const currentAssistantUrl = this.encryptedAssistantUrl(current);
    const nextAssistantUrl = input.assistantUrl !== undefined
      ? input.assistantUrl?.trim() ? normalizedDownstreamUrl(input.assistantUrl) : this.defaultAssistantUrl
      : currentAssistantUrl;
    const currentRingTicketUrl = this.encryptedRingTicketUrl(current);
    const nextRingTicketUrl = input.ringTicketUrl !== undefined
      ? input.ringTicketUrl?.trim() ? normalizedDownstreamUrl(input.ringTicketUrl) : this.defaultRingTicketUrl
      : currentRingTicketUrl;
    const downstreamCredentialChanged = nextDownstreamUrl !== currentDownstreamUrl
      || (input.downstreamToken !== undefined && input.downstreamToken !== null);
    const next: PhylaxTenantSettings = {
      ...current,
      downstreamUrl: null,
      assistantUrl: null,
      ringTicketUrl: null,
      ...(downstreamCredentialChanged
        ? {
            downstreamCredentialStatus: "unknown" as const,
            downstreamCredentialCheckedAt: null,
            downstreamCredentialRevision: randomBytes(16).toString("hex"),
          }
        : {}),
      ...(input.telegramBinding !== undefined
        ? { telegramBinding: input.telegramBinding?.trim() ? normalizeTelegramEntry(input.telegramBinding) : null }
        : {}),
      ...(input.transcriptionEnabled !== undefined ? { transcriptionEnabled: input.transcriptionEnabled } : {}),
      ...(input.transcriptionProvider !== undefined ? { transcriptionProvider: input.transcriptionProvider } : {}),
      ...(input.transcriptionModel !== undefined ? { transcriptionModel: input.transcriptionModel?.trim() || null } : {}),
      ...(input.voiceDefault !== undefined ? { voiceDefault: input.voiceDefault } : {}),
      ...(input.turnBindings !== undefined
        ? { turnBindings: updatedTurnBindings(current.turnBindings, input.turnBindings) }
        : {}),
      notificationPrefs: { ...current.notificationPrefs, ...(input.notificationPrefs ?? {}) },
      updatedAt: new Date().toISOString(),
    };
    if (input.telegramBinding?.trim() && !next.telegramBinding) throw new Error("invalid Telegram binding");
    if (input.transcriptionKey !== undefined && input.transcriptionKey !== null) {
      const provider = input.transcriptionProvider ?? current.transcriptionProvider;
      if (provider === "local") throw new Error("local transcription does not use a provider key");
      this.setSecret(tenantId, this.transcriptionTokenKey(provider), input.transcriptionKey);
    }
    this.put(next);
    if (input.downstreamUrl !== undefined) {
      this.setSecret(tenantId, DOWNSTREAM_URL_KEY, nextDownstreamUrl ?? "");
    }
    if (input.downstreamToken !== undefined && input.downstreamToken !== null) {
      this.setSecret(tenantId, DOWNSTREAM_TOKEN_KEY, input.downstreamToken);
    }
    if (input.assistantUrl !== undefined) {
      this.setSecret(tenantId, ASSISTANT_URL_KEY, nextAssistantUrl ?? "");
    }
    if (input.assistantToken !== undefined && input.assistantToken !== null) {
      this.setSecret(tenantId, ASSISTANT_TOKEN_KEY, input.assistantToken);
    }
    if (input.ringTicketUrl !== undefined) {
      this.setSecret(tenantId, RING_TICKET_URL_KEY, nextRingTicketUrl ?? "");
    }
    if (input.ringTicketToken !== undefined && input.ringTicketToken !== null) {
      this.setSecret(tenantId, RING_TICKET_TOKEN_KEY, input.ringTicketToken);
    }
    return this.view(tenantId);
  }

  /** Persist only non-secret health observed while Phylax calls the configured downstream. */
  reportDownstreamCredentialStatus(
    tenantId: string,
    credentialRevision: string,
    status: "healthy" | "rejected",
    now = Date.now(),
  ): boolean {
    const current = this.get(tenantId);
    if (!current.downstreamCredentialRevision || current.downstreamCredentialRevision !== credentialRevision) {
      return false;
    }
    if (current.downstreamCredentialStatus === status && status === "healthy") return true;
    this.put({
      ...current,
      downstreamCredentialStatus: status,
      downstreamCredentialCheckedAt: new Date(now).toISOString(),
    });
    return true;
  }

  registerPhone(
    tenantId: string,
    phoneNumber: string,
    numberId = "primary",
    now = Date.now(),
  ): { settings: PhylaxTenantSettingsView; keyword: string } {
    const normalized = normalizeWhatsAppIdentifier(phoneNumber);
    if (!normalized) throw new Error("invalid WhatsApp phone number");
    this.assertPhoneAvailable(tenantId, normalized);
    const keyword = friendlyVerificationKeyword();
    this.put({
      ...this.get(tenantId),
      phoneNumber: normalized,
      verified: false,
      numberId: numberId.trim() || "primary",
      verificationHash: verificationDigest(keyword).toString("hex"),
      verificationExpiresAt: now + VERIFY_TTL_MS,
      updatedAt: new Date(now).toISOString(),
    });
    return { settings: this.view(tenantId), keyword };
  }

  /** Validate one tenant's sender without mutating its existing channel configuration. */
  assertPhoneAvailable(tenantId: string, phoneNumber: string): void {
    const normalized = normalizeWhatsAppIdentifier(phoneNumber);
    if (!normalized) throw new Error("invalid WhatsApp phone number");
    const collision = Object.values(this.load()).find(
      (entry) => entry.tenantId !== tenantId && entry.phoneNumber === normalized,
    );
    if (collision) throw new Error("phone number is already registered");
  }

  /** Remove only one tenant's sender binding; shared transport/session state is untouched. */
  disconnectPhone(tenantId: string, now = Date.now()): PhylaxTenantSettingsView {
    const current = this.get(tenantId);
    this.put({
      ...current,
      phoneNumber: null,
      verified: false,
      numberId: "primary",
      verificationHash: null,
      verificationExpiresAt: null,
      updatedAt: new Date(now).toISOString(),
    });
    return this.view(tenantId);
  }

  verifyInbound(sender: string, text: string, now = Date.now()): PhylaxTenantSettings | null {
    const normalized = normalizeWhatsAppIdentifier(sender);
    if (!normalized) return null;
    const provided = verificationDigest(text);
    const entry = Object.values(this.load()).find((candidate) => {
      if (
        candidate.phoneNumber !== normalized ||
        candidate.verified ||
        !candidate.verificationHash ||
        !candidate.verificationExpiresAt ||
        candidate.verificationExpiresAt < now
      ) return false;
      const expected = Buffer.from(candidate.verificationHash, "hex");
      return expected.length === provided.length && timingSafeEqual(expected, provided);
    });
    if (!entry) return null;
    const verified = {
      ...entry,
      verified: true,
      verificationHash: null,
      verificationExpiresAt: null,
      updatedAt: new Date(now).toISOString(),
    };
    this.put(verified);
    return verified;
  }

  resolve(channel: PhylaxPortedChannel, sender: string): PhylaxTenantRoute | null {
    const normalized = channel === "whatsapp"
      ? normalizeWhatsAppIdentifier(sender)
      : normalizeTelegramEntry(sender);
    if (!normalized) return null;
    const entry = Object.values(this.load()).find((candidate) =>
      channel === "whatsapp"
        ? candidate.verified && candidate.phoneNumber === normalized
        : candidate.telegramBinding === normalized,
    );
    if (!entry) return null;
    const downstreamUrl = this.encryptedDownstreamUrl(entry);
    if (!downstreamUrl) return null;
    const downstreamToken = this.secret(entry.tenantId, DOWNSTREAM_TOKEN_KEY);
    if (!downstreamToken) return null;
    const credentialRevision = this.ensureDownstreamCredentialRevision(entry.tenantId);
    const assistant = this.assistantCredentials(entry.tenantId);
    return {
      tenantId: entry.tenantId,
      downstreamUrl,
      downstreamToken,
      credentialRevision,
      ...(assistant
        ? { assistantUrl: assistant.url, assistantToken: assistant.token }
        : {}),
    };
  }

  ownsRecipient(tenantId: string, channel: PhylaxPortedChannel, recipient: string): boolean {
    const entry = this.get(tenantId);
    return channel === "whatsapp"
      ? entry.verified && entry.phoneNumber === normalizeWhatsAppIdentifier(recipient)
      : Boolean(entry.telegramBinding && entry.telegramBinding === normalizeTelegramEntry(recipient));
  }

  transcriptionConfig(
    tenantId: string,
    providerOverride?: PhylaxTranscriptionProvider,
  ): {
    enabled: boolean;
    provider: PhylaxTranscriptionProvider;
    model: string | null;
    key: string | null;
  } {
    const entry = this.get(tenantId);
    const provider = providerOverride ?? entry.transcriptionProvider;
    return {
      enabled: entry.transcriptionEnabled,
      provider,
      model: provider === entry.transcriptionProvider ? entry.transcriptionModel : null,
      key: provider === "local" ? null : this.transcriptionKey(tenantId, provider),
    };
  }

  clearTranscriptionKey(
    tenantId: string,
    provider: Exclude<PhylaxTranscriptionProvider, "local">,
  ): PhylaxTenantSettingsView {
    const current = this.get(tenantId);
    if (current.transcriptionProvider === provider && current.transcriptionEnabled) {
      this.put({
        ...current,
        transcriptionEnabled: false,
        updatedAt: new Date().toISOString(),
      });
    }
    this.setSecret(tenantId, this.transcriptionTokenKey(provider), "");
    if (current.transcriptionProvider === provider) {
      this.setSecret(tenantId, TRANSCRIPTION_TOKEN_KEY, "");
    }
    return this.view(tenantId);
  }

  /**
   * Read one provider's tenant-scoped key. A legacy single-key tenant is
   * migrated only to the provider it was configured for, never reused across
   * providers.
   */
  private transcriptionKey(
    tenantId: string,
    provider: Exclude<PhylaxTranscriptionProvider, "local">,
  ): string | null {
    const scopedKey = this.transcriptionTokenKey(provider);
    const scoped = this.secret(tenantId, scopedKey);
    if (scoped) return scoped;
    const current = this.get(tenantId);
    if (current.transcriptionProvider !== provider) return null;
    const legacy = this.secret(tenantId, TRANSCRIPTION_TOKEN_KEY);
    if (!legacy) return null;
    this.setSecret(tenantId, scopedKey, legacy);
    this.setSecret(tenantId, TRANSCRIPTION_TOKEN_KEY, "");
    return legacy;
  }

  private transcriptionTokenKey(
    provider: Exclude<PhylaxTranscriptionProvider, "local">,
  ): string {
    return `${TRANSCRIPTION_TOKEN_KEY}:${provider}`;
  }

  private secret(tenantId: string, key: string): string | null {
    const vault = this.storage.forTenant({ id: tenantId }).vault("phylax-secrets.sqlite");
    try {
      return vault.get(key);
    } finally {
      vault.close();
    }
  }

  /** Move legacy credential-bearing MCP URLs into encrypted tenant custody on first read. */
  private encryptedDownstreamUrl(settings: PhylaxTenantSettings): string | null {
    const encrypted = this.secret(settings.tenantId, DOWNSTREAM_URL_KEY);
    if (encrypted) {
      if (settings.downstreamUrl) this.put({ ...settings, downstreamUrl: null });
      return encrypted;
    }
    if (!settings.downstreamUrl) return null;
    this.setSecret(settings.tenantId, DOWNSTREAM_URL_KEY, settings.downstreamUrl);
    this.put({ ...settings, downstreamUrl: null });
    return settings.downstreamUrl;
  }

  /** Move legacy/plain assistant URLs into encrypted tenant custody on first read. */
  private encryptedAssistantUrl(settings: PhylaxTenantSettings): string | null {
    const encrypted = this.secret(settings.tenantId, ASSISTANT_URL_KEY);
    if (encrypted) {
      if (settings.assistantUrl) this.put({ ...settings, assistantUrl: null });
      return encrypted;
    }
    if (!settings.assistantUrl) return this.defaultAssistantUrl;
    this.setSecret(settings.tenantId, ASSISTANT_URL_KEY, settings.assistantUrl);
    this.put({ ...settings, assistantUrl: null });
    return settings.assistantUrl;
  }

  /** Move legacy/plain Ring ticket URLs into encrypted tenant custody on first read. */
  private encryptedRingTicketUrl(settings: PhylaxTenantSettings): string | null {
    const encrypted = this.secret(settings.tenantId, RING_TICKET_URL_KEY);
    if (encrypted) {
      if (settings.ringTicketUrl) this.put({ ...settings, ringTicketUrl: null });
      return encrypted;
    }
    if (!settings.ringTicketUrl) return this.defaultRingTicketUrl;
    this.setSecret(settings.tenantId, RING_TICKET_URL_KEY, settings.ringTicketUrl);
    this.put({ ...settings, ringTicketUrl: null });
    return settings.ringTicketUrl;
  }

  private ensureDownstreamCredentialRevision(tenantId: string): string {
    const current = this.get(tenantId);
    if (current.downstreamCredentialRevision) return current.downstreamCredentialRevision;
    const revision = randomBytes(16).toString("hex");
    this.put({ ...current, downstreamUrl: null, downstreamCredentialRevision: revision });
    return revision;
  }

  private setSecret(tenantId: string, key: string, value: string): void {
    const vault = this.storage.forTenant({ id: tenantId }).vault("phylax-secrets.sqlite");
    try {
      if (value.trim()) vault.set(key, value.trim());
      else vault.delete(key);
    } finally {
      vault.close();
    }
  }

  private load(): Store {
    if (!existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as Store;
    } catch {
      return {};
    }
  }

  private put(settings: PhylaxTenantSettings): void {
    const store = this.load();
    store[settings.tenantId] = settings;
    mkdirSync(dirname(this.path), { recursive: true });
    const pending = `${this.path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(pending, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(pending, this.path);
  }
}
