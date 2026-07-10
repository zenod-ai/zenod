import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UnitContext } from "./index.js";
import { ChassisStorage } from "./storage.js";
import { ChassisUsageStore } from "./usage.js";
import {
  channelMediaForwardPayload,
  channelMediaForwardSchema,
  createTranscriptionKit,
  createVaultTranscriptionProviderResolver,
  TranscriptionKitError,
  TranscriptionProviderFailure,
  transcriptionPayload,
  type TranscriptionProvider,
  type TranscriptionProviderRequest,
} from "./transcription.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "chassis-transcription-"));
  roots.push(value);
  return value;
}

function context(
  storage: ChassisStorage,
  usage: ChassisUsageStore,
  tenantId: string,
): UnitContext {
  const tenant = { id: tenantId };
  return {
    unitName: "test-unit",
    tenant,
    storage: storage.forTenant(tenant),
    usage: usage.forTenant(tenant),
    operatingRules: null,
  };
}

describe("D18 transcription schemas", () => {
  it("accepts the canonical channel fields and rejects tenant selectors and inline media", () => {
    const valid = {
      sender: "whatsapp:+34123456789",
      artifact_ref: "https://phylax.example/artifacts/voice-1.ogg",
      text_transcript: "book the train",
      transcription_usage: {
        provider: "groq",
        model: "whisper-large-v3-turbo",
        audio_seconds: 4.2,
        input_bytes: 8192,
        billable_units: 5,
      },
      transcription_source: { unit: "phylax", version: "3.1.0" },
    };
    expect(channelMediaForwardSchema.parse(valid)).toEqual(valid);
    expect(() => channelMediaForwardSchema.parse({ ...valid, tenant_id: "t1" })).toThrow();
    expect(() =>
      channelMediaForwardSchema.parse({
        sender: valid.sender,
        artifact_ref: valid.artifact_ref,
        inline_media: { data_base64: "YQ==", mime_type: "audio/ogg" },
      }),
    ).toThrow();
    expect(() =>
      channelMediaForwardSchema.parse({
        ...valid,
        transcription_failed: { code: "unavailable", message: "failed" },
      }),
    ).toThrow();
  });
});

describe("createTranscriptionKit", () => {
  it("bypasses provider resolution for supplied text and preserves provenance and usage", async () => {
    const dataDir = root();
    const storage = new ChassisStorage({ dataDir });
    const usage = new ChassisUsageStore({ dataDir });
    let resolverCalls = 0;
    const kit = createTranscriptionKit({
      unit: { unit: "zenod", version: "4.0.0" },
      resolveProvider: () => {
        resolverCalls += 1;
        return null;
      },
    });
    const tenant = context(storage, usage, "tenant-1");

    const result = await kit.process(
      tenant,
      {
        sender: "whatsapp:alice",
        artifact_ref: "https://phylax.example/artifacts/a.ogg",
        text_transcript: "renew the insurance",
        transcription_usage: {
          provider: "groq",
          model: "whisper-large-v3-turbo",
          audio_seconds: 7,
          billable_units: 7,
        },
      },
      { authenticatedSource: { unit: "phylax", version: "2.3.1" } },
    );

    expect(resolverCalls).toBe(0);
    expect(result).toMatchObject({
      transcription_status: "provided",
      text_transcript: "renew the insurance",
      transcription_source: { unit: "phylax", version: "2.3.1" },
      transcription_usage: { provider: "groq", billable_units: 7 },
    });
    expect(tenant.usage?.timeline()).toHaveLength(1);
    expect(tenant.usage?.timeline()[0]).toMatchObject({
      tenantId: "tenant-1",
      kind: "transcription.audio",
      units: 7,
      metadata: { status: "provided", source_unit: "phylax" },
    });
    usage.close();
  });

  it("passes performed output to the next unit without a second provider call", async () => {
    const dataDir = root();
    const storage = new ChassisStorage({ dataDir });
    const usage = new ChassisUsageStore({ dataDir });
    let edgeCalls = 0;
    let downstreamCalls = 0;
    const provider: TranscriptionProvider = {
      id: "edge-stt",
      async transcribe() {
        edgeCalls += 1;
        return { text: "one transcription", usage: { billableUnits: 2 } };
      },
    };
    const edge = createTranscriptionKit({
      unit: { unit: "phylax", version: "2.0.0" },
      resolveProvider: () => ({ provider, apiKey: "secret" }),
    });
    const downstream = createTranscriptionKit({
      unit: { unit: "zenod", version: "4.0.0" },
      resolveProvider: () => {
        downstreamCalls += 1;
        return { provider, apiKey: "must-not-be-used" };
      },
    });
    const tenant = context(storage, usage, "tenant-1");

    const performed = await edge.process(tenant, {
      sender: "whatsapp:alice",
      artifact_ref: "https://phylax.example/artifacts/a.ogg",
    });
    const forwarded = channelMediaForwardPayload(performed);
    const provided = await downstream.process(tenant, transcriptionPayload(performed));

    expect(edgeCalls).toBe(1);
    expect(downstreamCalls).toBe(0);
    expect(forwarded).toMatchObject({
      text_transcript: "one transcription",
      transcription_source: { unit: "phylax", version: "2.0.0" },
    });
    expect(provided).toMatchObject({
      transcription_status: "provided",
      text_transcript: "one transcription",
      transcription_source: { unit: "phylax", version: "2.0.0" },
    });
    usage.close();
  });

  it("resolves provider keys from each tenant vault and makes exactly one call per input", async () => {
    const dataDir = root();
    const storage = new ChassisStorage({ dataDir });
    const usage = new ChassisUsageStore({ dataDir });
    const calls: TranscriptionProviderRequest[] = [];
    const provider: TranscriptionProvider = {
      id: "groq",
      async transcribe(request) {
        calls.push(request);
        return {
          text: request.model === "whisper-t1" ? "tenant one audio" : "tenant two audio",
          usage: { model: request.model, audioSeconds: 3, billableUnits: 3 },
        };
      },
    };
    const resolver = createVaultTranscriptionProviderResolver({
      providers: [
        {
          provider,
          apiKeyVaultKey: "transcription.groq.api_key",
          modelVaultKey: "transcription.groq.model",
        },
      ],
    });
    for (const [tenantId, key, model] of [
      ["tenant-1", "secret-t1", "whisper-t1"],
      ["tenant-2", "secret-t2", "whisper-t2"],
    ]) {
      const vault = storage.forTenant({ id: tenantId }).vault();
      vault.set("transcription.provider", "groq");
      vault.set("transcription.groq.api_key", key);
      vault.set("transcription.groq.model", model);
      vault.close();
    }
    const kit = createTranscriptionKit({
      unit: { unit: "phylax", version: "2.0.0" },
      resolveProvider: resolver,
    });

    const t1 = context(storage, usage, "tenant-1");
    const t2 = context(storage, usage, "tenant-2");
    const [r1, r2] = await Promise.all([
      kit.process(t1, {
        artifact_ref: "https://phylax.example/artifacts/t1.ogg",
      }),
      kit.process(t2, {
        artifact_ref: "https://phylax.example/artifacts/t2.ogg",
      }),
    ]);

    expect(calls).toHaveLength(2);
    expect(calls.map((call) => [call.apiKey, call.model])).toEqual([
      ["secret-t1", "whisper-t1"],
      ["secret-t2", "whisper-t2"],
    ]);
    expect(r1.text_transcript).toBe("tenant one audio");
    expect(r2.text_transcript).toBe("tenant two audio");
    expect(JSON.stringify([r1, r2])).not.toContain("secret-t1");
    expect(JSON.stringify([r1, r2])).not.toContain("secret-t2");
    expect(t1.usage?.timeline()).toHaveLength(1);
    expect(t2.usage?.timeline()).toHaveLength(1);
    expect(t1.usage?.timeline()[0]?.tenantId).toBe("tenant-1");
    expect(t2.usage?.timeline()[0]?.tenantId).toBe("tenant-2");
    usage.close();
  });

  it("returns a structured failure immediately after one provider attempt", async () => {
    const dataDir = root();
    const storage = new ChassisStorage({ dataDir });
    const usage = new ChassisUsageStore({ dataDir });
    let calls = 0;
    const provider: TranscriptionProvider = {
      id: "groq",
      async transcribe() {
        calls += 1;
        throw new TranscriptionProviderFailure("rate_limited", "provider rate limit");
      },
    };
    const kit = createTranscriptionKit({
      unit: { unit: "phylax", version: "2.0.0" },
      resolveProvider: () => ({ provider, apiKey: "secret" }),
    });

    const result = await kit.process(context(storage, usage, "tenant-1"), {
      sender: "whatsapp:alice",
      artifact_ref: "https://phylax.example/artifacts/a.ogg",
    });

    expect(calls).toBe(1);
    expect(result).toEqual({
      transcription_status: "failed",
      sender: "whatsapp:alice",
      artifact_ref: "https://phylax.example/artifacts/a.ogg",
      transcription_failed: { code: "rate_limited", message: "provider rate limit" },
      transcription_source: { unit: "phylax", version: "2.0.0" },
    });
    usage.close();
  });

  it("redacts unexpected provider errors instead of returning tenant credentials", async () => {
    const dataDir = root();
    const storage = new ChassisStorage({ dataDir });
    const usage = new ChassisUsageStore({ dataDir });
    const provider: TranscriptionProvider = {
      id: "groq",
      async transcribe(request) {
        throw new Error(`upstream rejected ${request.apiKey}`);
      },
    };
    const kit = createTranscriptionKit({
      unit: { unit: "phylax", version: "2.0.0" },
      resolveProvider: () => ({ provider, apiKey: "tenant-secret" }),
    });

    const result = await kit.process(context(storage, usage, "tenant-1"), {
      artifact_ref: "https://phylax.example/artifacts/a.ogg",
    });

    expect(result.transcription_failed).toEqual({
      code: "unavailable",
      message: "transcription provider groq failed",
    });
    expect(JSON.stringify(result)).not.toContain("tenant-secret");
    usage.close();
  });

  it("enforces a finite inline limit and keeps artifact_ref as the large-media path", async () => {
    const dataDir = root();
    const storage = new ChassisStorage({ dataDir });
    const usage = new ChassisUsageStore({ dataDir });
    const provider: TranscriptionProvider = {
      id: "test-stt",
      async transcribe(request) {
        return {
          text: "ok",
          usage: {
            inputBytes: request.media.kind === "inline" ? request.media.bytes.byteLength : 10,
          },
        };
      },
    };
    const kit = createTranscriptionKit({
      unit: { unit: "unit", version: "1" },
      resolveProvider: () => ({ provider, apiKey: "secret" }),
      maxInlineBytes: 3,
    });
    const tenant = context(storage, usage, "tenant-1");

    await expect(
      kit.process(tenant, {
        inline_media: { data_base64: Buffer.from("123").toString("base64"), mime_type: "audio/ogg" },
      }),
    ).resolves.toMatchObject({
      transcription_status: "performed",
      transcription_usage: { input_bytes: 3 },
    });
    await expect(
      kit.process(tenant, {
        inline_media: { data_base64: Buffer.from("1234").toString("base64"), mime_type: "audio/ogg" },
      }),
    ).rejects.toMatchObject<Partial<TranscriptionKitError>>({
      code: "invalid_input",
      message: "inline media exceeds the 3-byte limit; use artifact_ref",
    });
    await expect(
      kit.process(tenant, { artifact_ref: "https://unit.example/artifacts/large.ogg" }),
    ).resolves.toMatchObject({ transcription_status: "performed" });
    usage.close();
  });

  it("fails closed without a tenant-bound UnitContext", async () => {
    const dataDir = root();
    const storage = new ChassisStorage({ dataDir });
    const usage = new ChassisUsageStore({ dataDir });
    const kit = createTranscriptionKit({
      unit: { unit: "unit", version: "1" },
      resolveProvider: () => null,
    });
    await expect(
      kit.process(
        {
          unitName: "unit",
          tenant: null,
          storage: null,
          usage: null,
          operatingRules: null,
        },
        { artifact_ref: "https://unit.example/artifacts/a.ogg" },
      ),
    ).rejects.toMatchObject({ code: "unauthorized" });

    const mismatched = context(storage, usage, "tenant-1");
    mismatched.storage = storage.forTenant({ id: "tenant-2" });
    await expect(
      kit.process(mismatched, { artifact_ref: "https://unit.example/artifacts/a.ogg" }),
    ).rejects.toMatchObject({
      code: "unauthorized",
      message: "transcription context tenant bindings do not match",
    });
    usage.close();
  });
});
