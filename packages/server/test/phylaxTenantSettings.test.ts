import { readFile, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChassisStorage } from "@zenod/mcp-chassis";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultPhylaxTurnBindings,
  effectivePhylaxTurnBindings,
  PhylaxTenantSettingsStore,
  resolvePhylaxTurnBinding,
} from "../src/phylaxTenantSettings.js";
import {
  appendPhylaxCaptureReceiptInvitation,
  PHYLAX_CAPTURE_RECEIPT_INVITATION,
} from "../src/phylaxCaptureReceipt.js";

const dirs: string[] = [];
const MASTER_KEY = "35".repeat(32);

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(defaults: { ringTicketUrl?: string | null } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "phylax-settings-"));
  dirs.push(dataDir);
  const storage = new ChassisStorage({ dataDir, vaultEncryptionKey: MASTER_KEY });
  return {
    dataDir,
    storage,
    store: new PhylaxTenantSettingsStore(dataDir, storage, defaults),
  };
}

describe("PhylaxTenantSettingsStore", () => {
  it("defaults standalone voice to verbatim capture, media to ingest, and ordinary text to Ring", async () => {
    const { store } = await setup();

    expect(store.get("alpha")).toMatchObject({
      voiceDefault: "capture",
      turnBindings: {
        voice_note: {
          tool: "store_memory",
          argumentMappings: {
            content: { source: "transcript" },
            verbatim: { source: "constant", value: true },
            hints: { source: "constant", value: ["WhatsApp voice note"] },
          },
        },
        text: {
          tool: "chat_with_ring",
          argumentMappings: {
            message: { source: "message" },
            surface: { source: "surface" },
            conversationKey: { source: "conversationKey" },
          },
        },
        media: {
          tool: "ingest_memory",
          argumentMappings: {
            artifactUrl: { source: "artifactUrl" },
            mediaType: { source: "mediaType" },
            filename: { source: "filename" },
            sourceHint: { source: "constant", value: "WhatsApp media" },
          },
        },
      },
    });
    expect(store.view("alpha").turnBindings).toEqual(defaultPhylaxTurnBindings());
    expect(store.view("alpha").voiceDefault).toBe("capture");
    expect(store.get("beta").turnBindings).toEqual(defaultPhylaxTurnBindings());
  });

  it("resolves the per-tenant voice flip structurally while leaving text and media unchanged", async () => {
    const { store } = await setup();
    const capture = store.get("alpha");
    const assistant = store.update("beta", { voiceDefault: "assistant" });

    expect(resolvePhylaxTurnBinding(capture, "voice_note").tool).toBe("store_memory");
    expect(resolvePhylaxTurnBinding(assistant, "voice_note")).toEqual(assistant.turnBindings.text);
    expect(effectivePhylaxTurnBindings(assistant)).toEqual({
      ...assistant.turnBindings,
      voice_note: assistant.turnBindings.text,
    });
    expect(resolvePhylaxTurnBinding(assistant, "text").tool).toBe("chat_with_ring");
    expect(resolvePhylaxTurnBinding(assistant, "media").tool).toBe("ingest_memory");
    expect(store.get("alpha").voiceDefault).toBe("capture");
  });

  it("persists structured binding patches and voice defaults per tenant", async () => {
    const { dataDir, storage, store } = await setup();
    store.update("alpha", {
      voiceDefault: "assistant",
      turnBindings: {
        voice_note: {
          tool: "store_memory",
          argumentMappings: {
            content: { source: "transcript" },
            sender: { source: "sender" },
            chatId: { source: "chatId" },
            verbatim: { source: "constant", value: true },
            hints: {
              source: "constant",
              value: ["WhatsApp voice note", { origin: "phylax" }],
            },
          },
        },
        media: {
          tool: "ingest_memory",
          argumentMappings: {
            artifactUrl: { source: "artifactUrl" },
            mediaType: { source: "mediaType" },
            filename: { source: "filename" },
            sourceHint: { source: "constant", value: "WhatsApp media" },
          },
        },
      },
    });

    const restarted = new PhylaxTenantSettingsStore(dataDir, storage);
    expect(restarted.get("alpha").voiceDefault).toBe("assistant");
    expect(restarted.get("alpha").turnBindings.voice_note).toEqual({
      tool: "store_memory",
      argumentMappings: {
        content: { source: "transcript" },
        sender: { source: "sender" },
        chatId: { source: "chatId" },
        verbatim: { source: "constant", value: true },
        hints: {
          source: "constant",
          value: ["WhatsApp voice note", { origin: "phylax" }],
        },
      },
    });
    expect(restarted.get("alpha").turnBindings.text).toEqual(defaultPhylaxTurnBindings().text);
    expect(restarted.get("alpha").turnBindings.media).toEqual({
      tool: "ingest_memory",
      argumentMappings: {
        artifactUrl: { source: "artifactUrl" },
        mediaType: { source: "mediaType" },
        filename: { source: "filename" },
        sourceHint: { source: "constant", value: "WhatsApp media" },
      },
    });
    expect(restarted.get("beta")).toMatchObject({
      voiceDefault: "capture",
      turnBindings: defaultPhylaxTurnBindings(),
    });
    expect(JSON.parse(await readFile(store.path, "utf8"))).toMatchObject({
      alpha: {
        tenantId: "alpha",
        voiceDefault: "assistant",
        turnBindings: {
          voice_note: { tool: "store_memory" },
          text: { tool: "chat_with_ring" },
          media: { tool: "ingest_memory" },
        },
      },
    });
  });

  it("rejects unknown turn types, free-form templates, and invalid mapping sources", async () => {
    const { store } = await setup();
    expect(() => store.update("alpha", {
      turnBindings: {
        unexpected: {
          tool: "store_memory",
          argumentMappings: {},
        },
      } as never,
    })).toThrow("invalid Phylax turn type: unexpected");
    expect(() => store.update("alpha", {
      turnBindings: {
        voice_note: {
          tool: "store_memory",
          argumentMappings: { content: "{{transcript}}" },
        },
      } as never,
    })).toThrow("binding argument source must be an object");
    expect(() => store.update("alpha", {
      turnBindings: {
        voice_note: {
          tool: "store_memory",
          argumentMappings: { content: { source: "invented" } },
        },
      } as never,
    })).toThrow("invalid binding argument source");
    expect(() => store.update("alpha", {
      turnBindings: {
        voice_note: {
          tool: "store_memory",
          argumentMappings: {
            content: { source: "constant", value: undefined },
          },
        },
      } as never,
    })).toThrow("binding constant must contain only JSON values");
    expect(() => store.update("alpha", { voiceDefault: "sometimes" as never }))
      .toThrow("invalid voiceDefault");
  });

  it("backfills legacy voice routing and missing or corrupt binding rows", async () => {
    const { store } = await setup();
    await writeFile(store.path, JSON.stringify({
      alpha: {
        tenantId: "alpha",
        voiceDefault: "invalid-legacy-value",
        turnBindings: {
          voice_note: {
            tool: "store_memory",
            argumentMappings: {
              content: { source: "transcript" },
              verbatim: { source: "constant", value: true },
            },
          },
          text: { tool: "", argumentMappings: {} },
        },
      },
    }));

    expect(store.get("alpha")).toMatchObject({
      voiceDefault: "capture",
      turnBindings: {
        ...defaultPhylaxTurnBindings(),
        voice_note: {
          tool: "store_memory",
          argumentMappings: {
            content: { source: "transcript" },
            verbatim: { source: "constant", value: true },
          },
        },
      },
    });
  });

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
    expect(store.view("alpha")).not.toHaveProperty("downstreamCredentialRevision");
    const rowFile = await readFile(join(dataDir, "phylax-tenant-settings.json"), "utf8");
    expect(rowFile).not.toContain("ring-alpha-secret");
    expect(rowFile).not.toContain("stt-alpha-secret");
    expect(rowFile).not.toContain("/mcp/alpha");
    expect(rowFile).not.toContain("/mcp/beta");
  });

  it("keeps cloud-provider keys separate and never reuses one provider's key for another", async () => {
    const { store } = await setup();
    store.update("alpha", {
      transcriptionProvider: "openrouter",
      transcriptionKey: "openrouter-alpha-secret",
      transcriptionModel: "openai/whisper-large-v3-turbo",
    });
    expect(store.transcriptionConfig("alpha")).toMatchObject({
      provider: "openrouter",
      key: "openrouter-alpha-secret",
    });
    expect(store.transcriptionConfig("alpha", "groq").key).toBeNull();

    store.update("alpha", {
      transcriptionProvider: "groq",
      transcriptionKey: "groq-alpha-secret",
      transcriptionModel: null,
    });
    expect(store.transcriptionConfig("alpha")).toMatchObject({
      provider: "groq",
      key: "groq-alpha-secret",
    });
    expect(store.transcriptionConfig("alpha", "openrouter").key).toBe("openrouter-alpha-secret");
    expect(store.view("alpha").transcriptionKeysConfigured).toEqual({
      groq: true,
      openai: false,
      openrouter: true,
    });
  });

  it("removes only the selected provider key and safely disables an active provider", async () => {
    const { store } = await setup();
    store.update("alpha", {
      transcriptionProvider: "openrouter",
      transcriptionKey: "openrouter-alpha-secret",
      transcriptionModel: "openai/whisper-large-v3-turbo",
    });
    store.update("alpha", {
      transcriptionProvider: "groq",
      transcriptionKey: "groq-alpha-secret",
    });

    const inactive = store.clearTranscriptionKey("alpha", "openrouter");
    expect(inactive.transcriptionEnabled).toBe(true);
    expect(inactive.transcriptionKeysConfigured).toEqual({
      groq: true,
      openai: false,
      openrouter: false,
    });

    const active = store.clearTranscriptionKey("alpha", "groq");
    expect(active.transcriptionEnabled).toBe(false);
    expect(active.transcriptionKeysConfigured).toEqual({
      groq: false,
      openai: false,
      openrouter: false,
    });
  });

  it("migrates a legacy transcription key only to its persisted active provider", async () => {
    const { storage, store } = await setup();
    await writeFile(store.path, JSON.stringify({
      alpha: {
        tenantId: "alpha",
        transcriptionEnabled: true,
        transcriptionProvider: "openrouter",
        transcriptionModel: "openai/whisper-large-v3-turbo",
      },
    }));
    const vault = storage.forTenant({ id: "alpha" }).vault("phylax-secrets.sqlite");
    try {
      vault.set("phylax_transcription_token", "legacy-openrouter-secret");
    } finally {
      vault.close();
    }

    expect(store.transcriptionConfig("alpha", "groq").key).toBeNull();
    expect(store.transcriptionConfig("alpha").key).toBe("legacy-openrouter-secret");
    expect(store.view("alpha").transcriptionKeysConfigured).toEqual({
      groq: false,
      openai: false,
      openrouter: true,
    });
    expect(await readFile(store.path, "utf8")).not.toContain("legacy-openrouter-secret");
  });

  it("does not resolve an unverified or tokenless tenant", async () => {
    const { store } = await setup();
    store.registerPhone("alpha", "+34 611 111 111");
    store.update("alpha", { downstreamUrl: "https://ring.zenod.dev/mcp/alpha" });
    expect(store.resolve("whatsapp", "34611111111")).toBeNull();
  });

  it("keeps post-terminal Ring credentials distinct and isolated per tenant", async () => {
    const defaultRingUrl = "https://ring.zenod.dev/mcp";
    const { dataDir, storage, store } = await setup({ ringTicketUrl: defaultRingUrl });

    expect(store.view("alpha")).toMatchObject({
      ringTicketUrl: defaultRingUrl,
      ringTicketTokenConfigured: false,
    });
    expect(store.ringTicketCredentials("alpha")).toBeNull();

    store.update("alpha", {
      downstreamUrl: "https://memory.example/mcp/alpha",
      downstreamToken: "alpha-memory-only",
      ringTicketToken: "alpha-ring-ticket-only",
    });
    store.update("beta", {
      ringTicketUrl: "https://ring.example/mcp/beta",
      ringTicketToken: "beta-ring-ticket-only",
    });

    expect(store.downstreamCredentials("alpha")).toEqual({
      url: "https://memory.example/mcp/alpha",
      token: "alpha-memory-only",
    });
    expect(store.ringTicketCredentials("alpha")).toEqual({
      url: defaultRingUrl,
      token: "alpha-ring-ticket-only",
    });
    expect(store.ringTicketCredentials("beta")).toEqual({
      url: "https://ring.example/mcp/beta",
      token: "beta-ring-ticket-only",
    });
    expect(store.ringTicketCredentials("gamma")).toBeNull();

    const restarted = new PhylaxTenantSettingsStore(dataDir, storage, {
      ringTicketUrl: defaultRingUrl,
    });
    expect(restarted.ringTicketCredentials("alpha")).toEqual({
      url: defaultRingUrl,
      token: "alpha-ring-ticket-only",
    });
    expect(restarted.ringTicketCredentials("beta")).toEqual({
      url: "https://ring.example/mcp/beta",
      token: "beta-ring-ticket-only",
    });

    const settingsFile = await readFile(store.path, "utf8");
    expect(settingsFile).not.toContain("alpha-memory-only");
    expect(settingsFile).not.toContain("alpha-ring-ticket-only");
    expect(settingsFile).not.toContain("beta-ring-ticket-only");
    expect(settingsFile).not.toContain("ring.example/mcp/beta");
  });

  it("tracks credential rejection without persisting secrets and clears it only through the existing update seam", async () => {
    const { dataDir, store } = await setup();
    store.update("alpha", {
      downstreamUrl: "https://ring.zenod.dev/mcp/old-path-token",
      downstreamToken: "old-bearer-secret",
    });
    const oldRows = JSON.parse(await readFile(store.path, "utf8")) as Record<string, { downstreamCredentialRevision: string }>;
    const oldRevision = oldRows.alpha!.downstreamCredentialRevision;

    expect(store.reportDownstreamCredentialStatus("alpha", oldRevision, "rejected", 1_000)).toBe(true);
    expect(store.view("alpha")).toMatchObject({
      downstreamCredentialStatus: "rejected",
      downstreamCredentialCheckedAt: new Date(1_000).toISOString(),
      downstreamTokenConfigured: true,
    });
    expect(await readFile(join(dataDir, "phylax-tenant-settings.json"), "utf8"))
      .not.toContain("old-bearer-secret");
    expect(await readFile(join(dataDir, "phylax-tenant-settings.json"), "utf8"))
      .not.toContain("old-path-token");

    store.update("alpha", { transcriptionModel: "small" });
    expect(store.view("alpha").downstreamCredentialStatus).toBe("rejected");
    store.update("alpha", {
      downstreamUrl: "https://ring.zenod.dev/mcp/new-path-token",
      downstreamToken: "new-bearer-secret",
    });
    const newRows = JSON.parse(await readFile(store.path, "utf8")) as Record<string, { downstreamCredentialRevision: string }>;
    const newRevision = newRows.alpha!.downstreamCredentialRevision;
    expect(newRevision).not.toBe(oldRevision);
    expect(store.view("alpha")).toMatchObject({
      downstreamCredentialStatus: "unknown",
      downstreamCredentialCheckedAt: null,
    });
    expect(await readFile(join(dataDir, "phylax-tenant-settings.json"), "utf8"))
      .not.toContain("new-bearer-secret");
    expect(await readFile(join(dataDir, "phylax-tenant-settings.json"), "utf8"))
      .not.toContain("new-path-token");

    expect(store.reportDownstreamCredentialStatus("alpha", oldRevision, "healthy", 1_500)).toBe(false);
    expect(store.reportDownstreamCredentialStatus("alpha", oldRevision, "rejected", 1_500)).toBe(false);
    expect(store.reportDownstreamCredentialStatus("alpha", newRevision, "healthy", 2_000)).toBe(true);
    expect(store.view("alpha")).toMatchObject({
      downstreamCredentialStatus: "healthy",
      downstreamCredentialCheckedAt: new Date(2_000).toISOString(),
    });
  });

  it("migrates a legacy plaintext downstream URL into encrypted custody without changing the route", async () => {
    const { dataDir, store } = await setup();
    await writeFile(store.path, JSON.stringify({
      alpha: {
        tenantId: "alpha",
        phoneNumber: "34611111111",
        verified: true,
        downstreamUrl: "https://ring.zenod.dev/mcp/legacy-path-secret",
      },
    }));

    store.update("alpha", { downstreamToken: "legacy-bearer-secret" });
    expect(store.resolve("whatsapp", "34611111111")).toMatchObject({
      tenantId: "alpha",
      downstreamUrl: "https://ring.zenod.dev/mcp/legacy-path-secret",
      downstreamToken: "legacy-bearer-secret",
    });
    const migrated = await readFile(join(dataDir, "phylax-tenant-settings.json"), "utf8");
    expect(migrated).not.toContain("legacy-path-secret");
    expect(migrated).not.toContain("legacy-bearer-secret");
  });

  it("scrubs a legacy URL after restart when the encrypted migration write already succeeded", async () => {
    const { store } = await setup();
    store.update("alpha", {
      downstreamUrl: "https://ring.zenod.dev/mcp/encrypted-current-path",
      downstreamToken: "encrypted-current-bearer",
    });
    const interrupted = JSON.parse(await readFile(store.path, "utf8")) as Record<string, Record<string, unknown>>;
    interrupted.alpha!.downstreamUrl = "https://ring.zenod.dev/mcp/stale-plaintext-path";
    await writeFile(store.path, JSON.stringify(interrupted));

    expect(store.view("alpha").downstreamUrl).toBe("https://ring.zenod.dev/mcp/encrypted-current-path");
    const recovered = await readFile(store.path, "utf8");
    expect(recovered).not.toContain("stale-plaintext-path");
    expect(recovered).not.toContain("encrypted-current-path");
    expect(recovered).not.toContain("encrypted-current-bearer");
  });
});

describe("Phylax capture receipt copy", () => {
  it("appends the exact host-owned discussion invitation once", () => {
    const terminal = appendPhylaxCaptureReceiptInvitation(
      "Stored: project launch notes\nPages: Projects/Launch.md\nCommit: https://example.test/commit/abc",
    );

    expect(terminal).toContain(
      "\n\nreply to this message to discuss or act on it",
    );
    expect(PHYLAX_CAPTURE_RECEIPT_INVITATION).toBe(
      "reply to this message to discuss or act on it",
    );
    expect(appendPhylaxCaptureReceiptInvitation(terminal)).toBe(terminal);
  });
});
