export type OpenRouterTranscriptionModel = {
  id: string;
  name: string;
  popularityRank: number;
  pricing: {
    prompt: number | null;
    completion: number | null;
    audio: number | null;
    request: number | null;
  };
  costLabel: string;
};

type OpenRouterModelResponse = {
  data?: OpenRouterModel[];
};

type OpenRouterModel = {
  id?: unknown;
  name?: unknown;
  architecture?: {
    modality?: unknown;
  };
  pricing?: Record<string, unknown>;
};

const OPENROUTER_MODELS_URL =
  process.env.ZENOD_OPENROUTER_MODELS_URL ?? "https://openrouter.ai/api/v1/models?output_modalities=all&sort=most-popular";
const CACHE_TTL_MS = 30 * 60 * 1000;

const FALLBACK_TRANSCRIPTION_MODELS: OpenRouterTranscriptionModel[] = [
  fallbackModel("openai/gpt-4o-mini-transcribe", "OpenAI: GPT-4o Mini Transcribe", 1, 0.00000125, 0.000005),
  fallbackModel("openai/gpt-4o-transcribe", "OpenAI: GPT-4o Transcribe", 2, 0.0000025, 0.00001),
  fallbackModel("mistralai/voxtral-mini-transcribe", "Mistral: Voxtral Mini Transcribe", 3, 0.003, 0),
  fallbackModel("microsoft/mai-transcribe-1.5", "Microsoft: MAI-Transcribe 1.5", 4, 0.36, 0),
  fallbackModel("nvidia/parakeet-tdt-0.6b-v3", "NVIDIA: Parakeet TDT 0.6B v3", 5, 0.0015, 0),
  fallbackModel("qwen/qwen3-asr-flash-2026-02-10", "Qwen: Qwen3 ASR Flash", 6, 0.000035, 0),
  fallbackModel("google/chirp-3", "Google: Chirp 3", 7, 0.016, 0),
  fallbackModel("openai/whisper-large-v3-turbo", "OpenAI: Whisper Large V3 Turbo", 8, 0.04, 0),
  fallbackModel("openai/whisper-large-v3", "OpenAI: Whisper Large V3", 9, 0.0015, 0),
  fallbackModel("openai/whisper-1", "OpenAI: Whisper 1", 10, 0.006, 0),
];

let cached: { fetchedAt: number; models: OpenRouterTranscriptionModel[] } | null = null;

export async function openRouterTranscriptionModels(limit = 20): Promise<{
  models: OpenRouterTranscriptionModel[];
  cached: boolean;
  fallback: boolean;
}> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { models: cached.models.slice(0, limit), cached: true, fallback: false };
  }

  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) throw new Error(`OpenRouter models failed (${response.status})`);
    const body = (await response.json()) as OpenRouterModelResponse;
    const models = normalizeOpenRouterModels(body.data ?? []).slice(0, limit);
    if (models.length === 0) throw new Error("OpenRouter returned no transcription models");
    cached = { fetchedAt: now, models };
    return { models, cached: false, fallback: false };
  } catch (err) {
    console.warn("[openrouter] using fallback transcription model catalog:", (err as Error).message);
    return { models: FALLBACK_TRANSCRIPTION_MODELS.slice(0, limit), cached: false, fallback: true };
  }
}

export function normalizeOpenRouterModels(models: OpenRouterModel[]): OpenRouterTranscriptionModel[] {
  let rank = 0;
  return models
    .filter((model) => model.architecture?.modality === "audio->transcription")
    .flatMap((model) => {
      if (typeof model.id !== "string" || typeof model.name !== "string") return [];
      rank += 1;
      const pricing = {
        prompt: parsePrice(model.pricing?.prompt),
        completion: parsePrice(model.pricing?.completion),
        audio: parsePrice(model.pricing?.audio),
        request: parsePrice(model.pricing?.request),
      };
      return [
        {
          id: model.id,
          name: model.name,
          popularityRank: rank,
          pricing,
          costLabel: costLabel(pricing),
        },
      ];
    });
}

function fallbackModel(
  id: string,
  name: string,
  popularityRank: number,
  prompt: number,
  completion: number,
): OpenRouterTranscriptionModel {
  const pricing = { prompt, completion, audio: null, request: null };
  return { id, name, popularityRank, pricing, costLabel: costLabel(pricing) };
}

function parsePrice(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function costLabel(pricing: OpenRouterTranscriptionModel["pricing"]): string {
  const parts: string[] = [];
  if (pricing.prompt !== null) parts.push(`input ${formatUsd(pricing.prompt)}`);
  if (pricing.completion !== null && pricing.completion > 0) parts.push(`output ${formatUsd(pricing.completion)}`);
  if (pricing.audio !== null && pricing.audio > 0) parts.push(`audio ${formatUsd(pricing.audio)}`);
  if (pricing.request !== null && pricing.request > 0) parts.push(`request ${formatUsd(pricing.request)}`);
  return parts.length > 0 ? parts.join(" · ") : "pricing unavailable";
}

function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.00001) return `$${value.toExponential(2)}`;
  if (value < 0.01) return `$${value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
  return `$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}
