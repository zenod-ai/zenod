import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ChassisStorage } from "@zenod/mcp-chassis";
import { normalizeTelegramEntry } from "./telegramConfig.js";
import { normalizeWhatsAppIdentifier } from "./whatsappConfig.js";
import type { PhylaxPortedChannel, PhylaxTenantRoute } from "./phylaxChannels.js";

const DOWNSTREAM_TOKEN_KEY = "phylax_downstream_token";
const TRANSCRIPTION_TOKEN_KEY = "phylax_transcription_token";
const VERIFY_TTL_MS = 30 * 60_000;
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
  transcriptionEnabled: boolean;
  transcriptionProvider: "local" | "groq" | "openai" | "openrouter";
  transcriptionModel: string | null;
  telegramBinding: string | null;
  notificationPrefs: { whatsapp: boolean; telegram: boolean };
  updatedAt: string;
}

export interface PhylaxTenantSettingsView extends Omit<PhylaxTenantSettings, "verificationHash"> {
  downstreamTokenConfigured: boolean;
  transcriptionKeyConfigured: boolean;
}

type Store = Record<string, PhylaxTenantSettings>;

function defaultSettings(tenantId: string): PhylaxTenantSettings {
  return {
    tenantId,
    phoneNumber: null,
    verified: false,
    numberId: "primary",
    verificationHash: null,
    verificationExpiresAt: null,
    downstreamUrl: null,
    transcriptionEnabled: true,
    transcriptionProvider: "local",
    transcriptionModel: null,
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

  constructor(dataDir: string, private readonly storage: ChassisStorage) {
    this.path = join(dataDir, "phylax-tenant-settings.json");
  }

  get(tenantId: string): PhylaxTenantSettings {
    return this.load()[tenantId] ?? defaultSettings(tenantId);
  }

  view(tenantId: string): PhylaxTenantSettingsView {
    const { verificationHash: _verificationHash, ...settings } = this.get(tenantId);
    return {
      ...settings,
      downstreamTokenConfigured: this.secret(tenantId, DOWNSTREAM_TOKEN_KEY) !== null,
      transcriptionKeyConfigured: this.secret(tenantId, TRANSCRIPTION_TOKEN_KEY) !== null,
    };
  }

  update(
    tenantId: string,
    input: {
      downstreamUrl?: string | null;
      downstreamToken?: string | null;
      transcriptionEnabled?: boolean;
      transcriptionProvider?: PhylaxTenantSettings["transcriptionProvider"];
      transcriptionModel?: string | null;
      transcriptionKey?: string | null;
      telegramBinding?: string | null;
      notificationPrefs?: Partial<PhylaxTenantSettings["notificationPrefs"]>;
    },
  ): PhylaxTenantSettingsView {
    const current = this.get(tenantId);
    if (
      input.transcriptionProvider !== undefined &&
      !["local", "groq", "openai", "openrouter"].includes(input.transcriptionProvider)
    ) throw new Error("invalid transcription provider");
    const next: PhylaxTenantSettings = {
      ...current,
      ...(input.downstreamUrl !== undefined
        ? { downstreamUrl: input.downstreamUrl?.trim() ? normalizedDownstreamUrl(input.downstreamUrl) : null }
        : {}),
      ...(input.telegramBinding !== undefined
        ? { telegramBinding: input.telegramBinding?.trim() ? normalizeTelegramEntry(input.telegramBinding) : null }
        : {}),
      ...(input.transcriptionEnabled !== undefined ? { transcriptionEnabled: input.transcriptionEnabled } : {}),
      ...(input.transcriptionProvider !== undefined ? { transcriptionProvider: input.transcriptionProvider } : {}),
      ...(input.transcriptionModel !== undefined ? { transcriptionModel: input.transcriptionModel?.trim() || null } : {}),
      notificationPrefs: { ...current.notificationPrefs, ...(input.notificationPrefs ?? {}) },
      updatedAt: new Date().toISOString(),
    };
    if (input.telegramBinding?.trim() && !next.telegramBinding) throw new Error("invalid Telegram binding");
    this.put(next);
    if (input.downstreamToken !== undefined && input.downstreamToken !== null) {
      this.setSecret(tenantId, DOWNSTREAM_TOKEN_KEY, input.downstreamToken);
    }
    if (input.transcriptionKey !== undefined && input.transcriptionKey !== null) {
      this.setSecret(tenantId, TRANSCRIPTION_TOKEN_KEY, input.transcriptionKey);
    }
    return this.view(tenantId);
  }

  registerPhone(
    tenantId: string,
    phoneNumber: string,
    numberId = "primary",
    now = Date.now(),
  ): { settings: PhylaxTenantSettingsView; keyword: string } {
    const normalized = normalizeWhatsAppIdentifier(phoneNumber);
    if (!normalized) throw new Error("invalid WhatsApp phone number");
    const collision = Object.values(this.load()).find(
      (entry) => entry.tenantId !== tenantId && entry.phoneNumber === normalized,
    );
    if (collision) throw new Error("phone number is already registered");
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
    if (!entry?.downstreamUrl) return null;
    const downstreamToken = this.secret(entry.tenantId, DOWNSTREAM_TOKEN_KEY);
    if (!downstreamToken) return null;
    return { tenantId: entry.tenantId, downstreamUrl: entry.downstreamUrl, downstreamToken };
  }

  ownsRecipient(tenantId: string, channel: PhylaxPortedChannel, recipient: string): boolean {
    const entry = this.get(tenantId);
    return channel === "whatsapp"
      ? entry.verified && entry.phoneNumber === normalizeWhatsAppIdentifier(recipient)
      : Boolean(entry.telegramBinding && entry.telegramBinding === normalizeTelegramEntry(recipient));
  }

  transcriptionConfig(tenantId: string): {
    enabled: boolean;
    provider: PhylaxTenantSettings["transcriptionProvider"];
    model: string | null;
    key: string | null;
  } {
    const entry = this.get(tenantId);
    return {
      enabled: entry.transcriptionEnabled,
      provider: entry.transcriptionProvider,
      model: entry.transcriptionModel,
      key: this.secret(tenantId, TRANSCRIPTION_TOKEN_KEY),
    };
  }

  private secret(tenantId: string, key: string): string | null {
    const vault = this.storage.forTenant({ id: tenantId }).vault("phylax-secrets.sqlite");
    try {
      return vault.get(key);
    } finally {
      vault.close();
    }
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
