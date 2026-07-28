import {
  DEFAULT_OPENROUTER_STT_MODEL,
  GROQ_STT_MODEL,
  OPENAI_STT_MODEL,
} from "./transcribe.js";
import type { PhylaxTranscriptionProvider } from "./phylaxTenantSettings.js";

export type PhylaxTranscriptionProbeResult = {
  ok: boolean;
  provider: PhylaxTranscriptionProvider;
  model: string;
  message: string;
};

type ProbeOptions = {
  provider: PhylaxTranscriptionProvider;
  model?: string | null;
  key?: string | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  openRouterCatalog?: {
    models: Array<{ id: string }>;
    fallback: boolean;
  };
};

function effectiveModel(
  provider: PhylaxTranscriptionProvider,
  model?: string | null,
): string {
  if (provider === "local") return model?.trim() || "base";
  if (provider === "groq") return GROQ_STT_MODEL;
  if (provider === "openai") return OPENAI_STT_MODEL;
  return model?.trim() || DEFAULT_OPENROUTER_STT_MODEL;
}

function probeUrl(
  provider: Exclude<PhylaxTranscriptionProvider, "local">,
  env: NodeJS.ProcessEnv,
): string {
  if (provider === "groq") {
    return (
      env.PHYLAX_GROQ_KEY_CHECK_URL ?? "https://api.groq.com/openai/v1/models"
    );
  }
  if (provider === "openai") {
    return (
      env.PHYLAX_OPENAI_KEY_CHECK_URL ??
      `https://api.openai.com/v1/models/${encodeURIComponent(OPENAI_STT_MODEL)}`
    );
  }
  return (
    env.PHYLAX_OPENROUTER_KEY_CHECK_URL ?? "https://openrouter.ai/api/v1/key"
  );
}

function failureMessage(
  provider: PhylaxTranscriptionProvider,
  status: number,
): string {
  if (status === 401 || status === 403)
    return `${provider} rejected this provider key`;
  if (status === 402)
    return `${provider} accepted the key but transcription credit is unavailable`;
  if (status === 429)
    return `${provider} is rate-limiting checks; try again shortly`;
  return `${provider} connection check failed (${status})`;
}

/** Verify the configured provider without storing or returning its credential. */
export async function probePhylaxTranscriptionProvider({
  provider,
  model,
  key,
  env = process.env,
  fetchImpl = fetch,
  openRouterCatalog,
}: ProbeOptions): Promise<PhylaxTranscriptionProbeResult> {
  const selectedModel = effectiveModel(provider, model);
  if (provider === "local") {
    return {
      ok: true,
      provider,
      model: selectedModel,
      message: `Local whisper.cpp is configured with ${selectedModel}; the model downloads into durable storage when needed.`,
    };
  }
  const credential = key?.trim();
  if (!credential) {
    return {
      ok: false,
      provider,
      model: selectedModel,
      message: `${provider} requires a provider key`,
    };
  }
  try {
    const response = await fetchImpl(probeUrl(provider, env), {
      headers: {
        Authorization: `Bearer ${credential}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        provider,
        model: selectedModel,
        message: failureMessage(provider, response.status),
      };
    }
    if (provider === "groq") {
      const body = (await response.json().catch(() => null)) as {
        data?: Array<{ id?: unknown }>;
      } | null;
      const available =
        body?.data?.some((entry) => entry.id === GROQ_STT_MODEL) ?? false;
      if (!available) {
        return {
          ok: false,
          provider,
          model: selectedModel,
          message: `Groq accepted the key but ${GROQ_STT_MODEL} is not available to it`,
        };
      }
    }
    if (provider === "openrouter") {
      const body = (await response.json().catch(() => null)) as {
        data?: { limit_remaining?: unknown };
      } | null;
      const remaining = body?.data?.limit_remaining;
      if (typeof remaining === "number" && remaining <= 0) {
        return {
          ok: false,
          provider,
          model: selectedModel,
          message:
            "OpenRouter accepted the key but its configured limit has no remaining credit",
        };
      }
      if (!openRouterCatalog || openRouterCatalog.fallback) {
        return {
          ok: false,
          provider,
          model: selectedModel,
          message:
            "OpenRouter accepted the key, but live transcription model availability could not be verified",
        };
      }
      if (!openRouterCatalog.models.some((candidate) => candidate.id === selectedModel)) {
        return {
          ok: false,
          provider,
          model: selectedModel,
          message: `OpenRouter accepted the key, but ${selectedModel} is not in its live transcription catalog`,
        };
      }
    }
    return {
      ok: true,
      provider,
      model: selectedModel,
      message: `${provider} accepted the tenant-scoped key; ${selectedModel} is selected for transcription.`,
    };
  } catch (error) {
    const detail =
      error instanceof Error && error.name === "TimeoutError"
        ? "timed out"
        : "could not be reached";
    return {
      ok: false,
      provider,
      model: selectedModel,
      message: `${provider} ${detail}; no settings were changed`,
    };
  }
}
