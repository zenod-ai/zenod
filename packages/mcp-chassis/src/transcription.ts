import { z } from "zod";
import type { UnitContext } from "./index.js";

export const DEFAULT_MAX_INLINE_MEDIA_BYTES = 256 * 1024;
export const DEFAULT_TRANSCRIPTION_USAGE_KIND = "transcription.audio";

const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const FAILURE_CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const nonEmpty = z.string().trim().min(1);
const identifier = nonEmpty.regex(IDENTIFIER_RE);
const artifactRef = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "artifact_ref must be an HTTPS URL without embedded credentials");

export const transcriptionFailureSchema = z
  .object({
    code: z.string().regex(FAILURE_CODE_RE),
    message: nonEmpty.max(500),
  })
  .strict();

export const transcriptionSourceSchema = z
  .object({
    unit: identifier,
    version: nonEmpty.max(128),
  })
  .strict();

export const transcriptionUsageSchema = z
  .object({
    provider: identifier,
    model: nonEmpty.max(256).optional(),
    audio_seconds: z.number().finite().nonnegative().optional(),
    input_bytes: z.number().int().nonnegative().optional(),
    billable_units: z.number().int().positive(),
  })
  .strict();

export const inlineTranscriptionMediaSchema = z
  .object({
    data_base64: z.string().min(1).regex(BASE64_RE, "inline media must be valid base64"),
    mime_type: nonEmpty.max(255),
    filename: nonEmpty.max(255).optional(),
  })
  .strict();

const transcriptionFields = {
  sender: nonEmpty.max(512).optional(),
  artifact_ref: artifactRef.optional(),
  inline_media: inlineTranscriptionMediaSchema.optional(),
  text_transcript: nonEmpty.optional(),
  transcription_usage: transcriptionUsageSchema.optional(),
  transcription_failed: transcriptionFailureSchema.optional(),
  transcription_source: transcriptionSourceSchema.optional(),
};

function validateTranscriptionState(
  value: {
    artifact_ref?: string;
    inline_media?: unknown;
    text_transcript?: string;
    transcription_usage?: unknown;
    transcription_failed?: unknown;
    transcription_source?: unknown;
  },
  ctx: z.RefinementCtx,
): void {
  if (Boolean(value.artifact_ref) === Boolean(value.inline_media)) {
    ctx.addIssue({
      code: "custom",
      message: "exactly one of artifact_ref or inline_media is required",
      path: ["artifact_ref"],
    });
  }
  if (value.text_transcript && value.transcription_failed) {
    ctx.addIssue({
      code: "custom",
      message: "text_transcript and transcription_failed are mutually exclusive",
      path: ["transcription_failed"],
    });
  }
  if (value.transcription_usage && !value.text_transcript) {
    ctx.addIssue({
      code: "custom",
      message: "transcription_usage requires text_transcript",
      path: ["transcription_usage"],
    });
  }
  if (value.transcription_source && !value.text_transcript && !value.transcription_failed) {
    ctx.addIssue({
      code: "custom",
      message: "transcription_source requires a transcript or failure",
      path: ["transcription_source"],
    });
  }
}

/** General D18 ingest shape. Direct media may use a bounded inline payload. */
export const transcriptionInputSchema = z
  .object(transcriptionFields)
  .strict()
  .superRefine(validateTranscriptionState);

/** Channel-forward shape. D18 forbids inline base64 and requires an immutable HTTPS artifact. */
export const channelMediaForwardSchema = z
  .object({
    sender: nonEmpty.max(512),
    artifact_ref: artifactRef,
    text_transcript: nonEmpty.optional(),
    transcription_usage: transcriptionUsageSchema.optional(),
    transcription_failed: transcriptionFailureSchema.optional(),
    transcription_source: transcriptionSourceSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    validateTranscriptionState(value, ctx);
    if (value.text_transcript && !value.transcription_usage) {
      ctx.addIssue({
        code: "custom",
        message: "a successful channel transcript requires transcription_usage",
        path: ["transcription_usage"],
      });
    }
  });

export const transcriptionResultSchema = z
  .object({
    transcription_status: z.enum(["provided", "performed", "failed"]),
    sender: nonEmpty.max(512).optional(),
    artifact_ref: artifactRef.optional(),
    inline_media: inlineTranscriptionMediaSchema.optional(),
    text_transcript: nonEmpty.optional(),
    transcription_usage: transcriptionUsageSchema.optional(),
    transcription_failed: transcriptionFailureSchema.optional(),
    transcription_source: transcriptionSourceSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    validateTranscriptionState(value, ctx);
    if (value.transcription_status === "failed" && !value.transcription_failed) {
      ctx.addIssue({ code: "custom", message: "failed results require transcription_failed" });
    }
    if (value.transcription_status !== "failed" && !value.text_transcript) {
      ctx.addIssue({ code: "custom", message: "successful results require text_transcript" });
    }
    if (value.transcription_status === "performed" && !value.transcription_usage) {
      ctx.addIssue({ code: "custom", message: "performed results require transcription_usage" });
    }
  });

export type TranscriptionFailure = z.infer<typeof transcriptionFailureSchema>;
export type TranscriptionSource = z.infer<typeof transcriptionSourceSchema>;
export type TranscriptionUsage = z.infer<typeof transcriptionUsageSchema>;
export type InlineTranscriptionMedia = z.infer<typeof inlineTranscriptionMediaSchema>;
export type TranscriptionInput = z.infer<typeof transcriptionInputSchema>;
export type ChannelMediaForward = z.infer<typeof channelMediaForwardSchema>;
export type TranscriptionResult = z.infer<typeof transcriptionResultSchema>;

export type TranscriptionProviderMedia =
  | { kind: "artifact_ref"; artifactRef: string }
  | {
      kind: "inline";
      bytes: Uint8Array;
      mimeType: string;
      filename?: string;
    };

export interface TranscriptionProviderRequest {
  media: TranscriptionProviderMedia;
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
}

export interface TranscriptionProviderUsage {
  model?: string;
  audioSeconds?: number;
  inputBytes?: number;
  billableUnits?: number;
}

export interface TranscriptionProviderResult {
  text: string;
  usage?: TranscriptionProviderUsage;
}

export interface TranscriptionProvider {
  readonly id: string;
  transcribe(request: TranscriptionProviderRequest): Promise<TranscriptionProviderResult>;
}

export interface ResolvedTranscriptionProvider {
  provider: TranscriptionProvider;
  apiKey: string;
  model?: string;
}

export type TranscriptionProviderResolver = (
  context: UnitContext,
) => Promise<ResolvedTranscriptionProvider | null> | ResolvedTranscriptionProvider | null;

export interface VaultTranscriptionProviderDefinition {
  provider: TranscriptionProvider;
  apiKeyVaultKey: string;
  modelVaultKey?: string;
  defaultModel?: string;
}

export interface VaultTranscriptionProviderResolverOptions {
  providers: readonly VaultTranscriptionProviderDefinition[];
  /** Vault entry selecting a provider id. Defaults to transcription.provider. */
  providerVaultKey?: string;
  /** Used only when the tenant has no provider selector entry. */
  defaultProvider?: string;
  /** Tenant vault filename. Defaults to vault.sqlite. */
  vaultName?: string;
}

/**
 * Resolve a provider and secret only from the authenticated tenant's storage.
 * The returned key is passed directly to the adapter and never enters a result.
 */
export function createVaultTranscriptionProviderResolver(
  options: VaultTranscriptionProviderResolverOptions,
): TranscriptionProviderResolver {
  const definitions = new Map(
    options.providers.map((definition) => [definition.provider.id, definition]),
  );
  if (definitions.size !== options.providers.length) {
    throw new Error("transcription provider ids must be unique");
  }
  for (const id of definitions.keys()) assertIdentifier(id, "transcription provider id");

  return (context) => {
    const storage = requireTenantStorage(context);
    const vault = storage.vault(options.vaultName);
    try {
      const selected =
        vault.get(options.providerVaultKey ?? "transcription.provider")?.trim() ||
        options.defaultProvider?.trim() ||
        "";
      const definition = definitions.get(selected);
      if (!definition) return null;
      const apiKey = vault.get(definition.apiKeyVaultKey)?.trim() || "";
      if (!apiKey) return null;
      const model = definition.modelVaultKey
        ? vault.get(definition.modelVaultKey)?.trim() || definition.defaultModel?.trim()
        : definition.defaultModel?.trim();
      return {
        provider: definition.provider,
        apiKey,
        ...(model ? { model } : {}),
      };
    } finally {
      vault.close();
    }
  };
}

export interface TranscriptionKitOptions {
  unit: TranscriptionSource;
  resolveProvider: TranscriptionProviderResolver;
  /** Finite inline allowance for non-channel tools. Set to 0 to require artifact_ref. */
  maxInlineBytes?: number;
  usageKind?: string;
}

export interface ProcessTranscriptionOptions {
  /**
   * Trusted source resolved from the upstream connection/card. Required when
   * input carries text_transcript or transcription_failed.
   */
  authenticatedSource?: TranscriptionSource;
  /**
   * Book supplied usage to this tenant. Enable only at the attribution hop
   * (for example, the Ring after sender-to-tenant mapping). Defaults to false.
   */
  bookProvidedUsageToTenant?: boolean;
  signal?: AbortSignal;
}

export interface TranscriptionKit {
  readonly maxInlineBytes: number;
  process(
    context: UnitContext,
    input: unknown,
    options?: ProcessTranscriptionOptions,
  ): Promise<TranscriptionResult>;
}

export class TranscriptionKitError extends Error {
  constructor(
    readonly code: "invalid_input" | "unauthorized" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "TranscriptionKitError";
  }

  toJSON(): TranscriptionFailure {
    return { code: this.code, message: this.message };
  }
}

/** A provider may throw this only when its code and message are safe to expose. */
export class TranscriptionProviderFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TranscriptionProviderFailure";
    transcriptionFailureSchema.parse({ code, message });
  }
}

/** Strip the receipt status while preserving every D18 hand-off field. */
export function transcriptionPayload(result: TranscriptionResult): TranscriptionInput {
  const parsed = transcriptionResultSchema.parse(result);
  const { transcription_status: _status, ...payload } = parsed;
  return transcriptionInputSchema.parse(payload);
}

/** Build the artifact-only channel payload and enforce the stricter channel profile. */
export function channelMediaForwardPayload(result: TranscriptionResult): ChannelMediaForward {
  const payload = transcriptionPayload(result);
  return channelMediaForwardSchema.parse(payload);
}

export function createTranscriptionKit(options: TranscriptionKitOptions): TranscriptionKit {
  const localSource = transcriptionSourceSchema.parse(options.unit);
  const maxInlineBytes = normalizeInlineLimit(
    options.maxInlineBytes ?? DEFAULT_MAX_INLINE_MEDIA_BYTES,
  );
  const usageKind = options.usageKind ?? DEFAULT_TRANSCRIPTION_USAGE_KIND;
  assertIdentifier(usageKind, "transcription usage kind");

  return {
    maxInlineBytes,
    async process(context, rawInput, processOptions = {}) {
      requireTenantStorage(context);
      const input = parseInput(rawInput);
      const authenticatedInputSource =
        input.text_transcript || input.transcription_failed
          ? resolveAuthenticatedInputSource(input, processOptions.authenticatedSource)
          : null;
      const media = resolveMedia(input, maxInlineBytes);

      if (input.text_transcript) {
        if (input.transcription_usage && processOptions.bookProvidedUsageToTenant === true) {
          meterUsage(
            context,
            usageKind,
            "provided",
            input.transcription_usage,
            authenticatedInputSource!,
          );
        }
        return transcriptionResultSchema.parse({
          transcription_status: "provided",
          ...forwardFields(input),
          transcription_source: authenticatedInputSource,
        });
      }

      let binding: ResolvedTranscriptionProvider | null;
      try {
        binding = await options.resolveProvider(context);
      } catch (error) {
        if (error instanceof TranscriptionKitError) throw error;
        return failedResult(input, localSource, {
          code: "unavailable",
          message: "transcription provider resolution failed",
        });
      }
      if (!binding) {
        return failedResult(
          input,
          authenticatedInputSource ?? localSource,
          input.transcription_failed ?? {
            code: "unavailable",
            message: "no transcription provider is configured for this tenant",
          },
        );
      }

      assertIdentifier(binding.provider.id, "transcription provider id");
      if (!binding.apiKey.trim()) {
        return failedResult(input, localSource, {
          code: "unavailable",
          message: "the tenant transcription provider has no credential",
        });
      }

      try {
        const providerResult = await binding.provider.transcribe({
          media,
          apiKey: binding.apiKey,
          ...(binding.model ? { model: binding.model } : {}),
          ...(processOptions.signal ? { signal: processOptions.signal } : {}),
        });
        const text = providerResult.text.trim();
        if (!text) {
          return failedResult(input, localSource, {
            code: "unavailable",
            message: `transcription provider ${binding.provider.id} returned no text`,
          });
        }
        const usage = normalizeProviderUsage(
          binding.provider.id,
          binding.model,
          providerResult.usage,
          media,
        );
        meterUsage(context, usageKind, "performed", usage, localSource);
        return transcriptionResultSchema.parse({
          transcription_status: "performed",
          ...mediaFields(input),
          ...(input.sender ? { sender: input.sender } : {}),
          text_transcript: text,
          transcription_usage: usage,
          transcription_source: localSource,
        });
      } catch (error) {
        const failure =
          error instanceof TranscriptionProviderFailure
            ? { code: error.code, message: error.message }
            : {
                code: "unavailable",
                message: `transcription provider ${binding.provider.id} failed`,
              };
        return failedResult(input, localSource, failure);
      }
    },
  };
}

function parseInput(input: unknown): TranscriptionInput {
  const result = transcriptionInputSchema.safeParse(input);
  if (!result.success) {
    throw new TranscriptionKitError(
      "invalid_input",
      result.error.issues[0]?.message ?? "invalid transcription input",
    );
  }
  return result.data;
}

function requireTenantStorage(context: UnitContext) {
  if (!context.tenant || !context.storage) {
    throw new TranscriptionKitError(
      "unauthorized",
      "transcription requires an authenticated tenant context",
    );
  }
  if (
    context.storage.tenant.id !== context.tenant.id ||
    (context.usage && context.usage.tenant.id !== context.tenant.id)
  ) {
    throw new TranscriptionKitError(
      "unauthorized",
      "transcription context tenant bindings do not match",
    );
  }
  return context.storage;
}

function resolveAuthenticatedInputSource(
  input: TranscriptionInput,
  authenticatedSource: TranscriptionSource | undefined,
): TranscriptionSource {
  if (!authenticatedSource) {
    throw new TranscriptionKitError(
      "invalid_input",
      "a pre-transcribed transcript or upstream failure requires authenticated source unit and version",
    );
  }
  const trusted = transcriptionSourceSchema.parse(authenticatedSource);
  if (
    input.transcription_source &&
    (input.transcription_source.unit !== trusted.unit ||
      input.transcription_source.version !== trusted.version)
  ) {
    throw new TranscriptionKitError(
      "invalid_input",
      "transcription_source does not match the authenticated source",
    );
  }
  return trusted;
}

function resolveMedia(
  input: TranscriptionInput,
  maxInlineBytes: number,
): TranscriptionProviderMedia {
  if (input.artifact_ref) return { kind: "artifact_ref", artifactRef: input.artifact_ref };
  const inline = input.inline_media!;
  const maxEncodedLength = Math.ceil(maxInlineBytes / 3) * 4;
  if (inline.data_base64.length > maxEncodedLength) {
    throw new TranscriptionKitError(
      "invalid_input",
      `inline media encoded payload exceeds the ${maxInlineBytes}-byte limit; use artifact_ref`,
    );
  }
  const bytes = Buffer.from(inline.data_base64, "base64");
  if (bytes.byteLength > maxInlineBytes) {
    throw new TranscriptionKitError(
      "invalid_input",
      `decoded inline media exceeds the ${maxInlineBytes}-byte limit; use artifact_ref`,
    );
  }
  return {
    kind: "inline",
    bytes,
    mimeType: inline.mime_type,
    ...(inline.filename ? { filename: inline.filename } : {}),
  };
}

function normalizeProviderUsage(
  provider: string,
  configuredModel: string | undefined,
  usage: TranscriptionProviderUsage | undefined,
  media: TranscriptionProviderMedia,
): TranscriptionUsage {
  return transcriptionUsageSchema.parse({
    provider,
    ...(usage?.model ?? configuredModel ? { model: usage?.model ?? configuredModel } : {}),
    ...(usage?.audioSeconds !== undefined ? { audio_seconds: usage.audioSeconds } : {}),
    ...(usage?.inputBytes !== undefined
      ? { input_bytes: usage.inputBytes }
      : media.kind === "inline"
        ? { input_bytes: media.bytes.byteLength }
        : {}),
    billable_units: usage?.billableUnits ?? 1,
  });
}

function meterUsage(
  context: UnitContext,
  kind: string,
  status: "provided" | "performed",
  usage: TranscriptionUsage,
  source: TranscriptionSource,
): void {
  context.usage?.record({
    kind,
    units: usage.billable_units,
    metadata: {
      status,
      provider: usage.provider,
      ...(usage.model ? { model: usage.model } : {}),
      ...(usage.audio_seconds !== undefined ? { audio_seconds: usage.audio_seconds } : {}),
      ...(usage.input_bytes !== undefined ? { input_bytes: usage.input_bytes } : {}),
      source_unit: source.unit,
      source_version: source.version,
    },
  });
}

function failedResult(
  input: TranscriptionInput,
  source: TranscriptionSource,
  failure: TranscriptionFailure,
): TranscriptionResult {
  return transcriptionResultSchema.parse({
    transcription_status: "failed",
    ...mediaFields(input),
    ...(input.sender ? { sender: input.sender } : {}),
    transcription_failed: transcriptionFailureSchema.parse(failure),
    transcription_source: transcriptionSourceSchema.parse(source),
  });
}

function mediaFields(input: TranscriptionInput) {
  return {
    ...(input.artifact_ref ? { artifact_ref: input.artifact_ref } : {}),
    ...(input.inline_media ? { inline_media: input.inline_media } : {}),
  };
}

function forwardFields(input: TranscriptionInput) {
  return {
    ...mediaFields(input),
    ...(input.sender ? { sender: input.sender } : {}),
    ...(input.text_transcript ? { text_transcript: input.text_transcript } : {}),
    ...(input.transcription_usage
      ? { transcription_usage: input.transcription_usage }
      : {}),
  };
}

function normalizeInlineLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("maxInlineBytes must be a non-negative safe integer");
  }
  return value;
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_RE.test(value)) throw new Error(`${label} is invalid`);
}
