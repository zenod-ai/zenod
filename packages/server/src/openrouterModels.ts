export type OpenRouterTranscriptionModel = {
  id: string;
  name: string;
  inputPerMTokens: number;
  outputPerMTokens: number;
  estimatedCostPerMinute: number;
  popularityLabel: string | null;
};

type OpenRouterEndpoint = {
  pricing?: {
    prompt?: string;
    completion?: string;
    audio?: string;
  };
};

type OpenRouterModelDetail = {
  data?: {
    id?: string;
    name?: string;
    architecture?: {
      modality?: string;
      input_modalities?: string[];
      output_modalities?: string[];
    };
    endpoints?: OpenRouterEndpoint[];
  };
};

type RankedModel = {
  id: string;
  name: string;
  popularityLabel: string | null;
};

const COLLECTION_URL = "https://openrouter.ai/collections/speech-to-text-models";
const DETAIL_URL = "https://openrouter.ai/api/v1/models";
const AUDIO_TOKENS_PER_MINUTE_ESTIMATE = 32_000;

// Ranked by OpenRouter's speech-to-text collection when the page cannot be read.
const FALLBACK_RANKED_MODELS: RankedModel[] = [
  { id: "openai/gpt-4o-mini-transcribe", name: "OpenAI: GPT-4o Mini Transcribe", popularityLabel: "157M tokens" },
  { id: "openai/gpt-4o-transcribe", name: "OpenAI: GPT-4o Transcribe", popularityLabel: "35.1M tokens" },
  { id: "mistralai/voxtral-mini-transcribe", name: "Mistral: Voxtral Mini Transcribe", popularityLabel: "3.75M tokens" },
  { id: "microsoft/mai-transcribe-1.5", name: "Microsoft: MAI-Transcribe 1.5", popularityLabel: null },
  { id: "nvidia/parakeet-tdt-0.6b-v3", name: "NVIDIA: Parakeet TDT 0.6B v3", popularityLabel: null },
  { id: "qwen/qwen3-asr-flash-2026-02-10", name: "Qwen: Qwen3 ASR Flash", popularityLabel: null },
  { id: "google/chirp-3", name: "Google: Chirp 3", popularityLabel: null },
  { id: "openai/whisper-large-v3-turbo", name: "OpenAI: Whisper Large V3 Turbo", popularityLabel: null },
  { id: "openai/whisper-large-v3", name: "OpenAI: Whisper Large V3", popularityLabel: null },
  { id: "openai/whisper-1", name: "OpenAI: Whisper 1", popularityLabel: null },
];

function htmlDecode(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function parseRankedModels(html: string, limit: number): RankedModel[] {
  const models: RankedModel[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a[^>]+href="\/([^"#?]+)"[^>]*>[\s\S]*?<h3>([\s\S]*?)<\/h3>[\s\S]*?<\/a>/g;
  const anchors = Array.from(html.matchAll(anchorPattern));
  for (let index = 0; index < anchors.length && models.length < limit; index += 1) {
    const anchor = anchors[index]!;
    const id = anchor[1];
    const name = anchor[2];
    if (!id || !name || seen.has(id) || !id.includes("/")) continue;
    const afterAnchor = html.slice(anchor.index! + anchor[0].length, anchors[index + 1]?.index ?? html.length);
    const popularity = afterAnchor
      .match(/<div class="flex shrink-0[^"]*">([\s\S]*?)<\/div>/)?.[1]
      ?.replace(/<[^>]*>/g, "");
    seen.add(id);
    models.push({
      id: htmlDecode(id),
      name: htmlDecode(name.replace(/<[^>]*>/g, "")),
      popularityLabel: popularity?.trim() || null,
    });
  }
  return models;
}

function isTranscriptionModel(detail: OpenRouterModelDetail["data"]): boolean {
  const modality = detail?.architecture?.modality?.toLowerCase() ?? "";
  const input = detail?.architecture?.input_modalities ?? [];
  const output = detail?.architecture?.output_modalities ?? [];
  return modality.includes("audio->transcription") || (input.includes("audio") && output.includes("transcription"));
}

function dollarsPerM(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed * 1_000_000 : 0;
}

function estimatePerMinute(promptPrice: number, inputPerM: number): number {
  if (!Number.isFinite(promptPrice) || promptPrice <= 0) return 0;
  // OpenRouter normalizes duration-priced STT models into prompt-like prices.
  // Small values are token-priced, larger values are already minute/hour-like.
  if (promptPrice < 0.001) return (inputPerM / 1_000_000) * AUDIO_TOKENS_PER_MINUTE_ESTIMATE;
  if (promptPrice >= 0.1) return promptPrice / 60;
  return promptPrice;
}

export async function listOpenRouterTranscriptionModels({
  limit = 20,
  fetcher = fetch,
}: {
  limit?: number;
  fetcher?: typeof fetch;
} = {}): Promise<OpenRouterTranscriptionModel[]> {
  let ranked = FALLBACK_RANKED_MODELS.slice(0, limit);
  try {
    const response = await fetcher(COLLECTION_URL);
    if (response.ok) {
      const parsed = parseRankedModels(await response.text(), limit);
      if (parsed.length > 0) ranked = parsed;
    }
  } catch {
    // The fallback is intentionally good enough for the selector to preload.
  }

  const results = await Promise.all(
    ranked.map(async (model) => {
      try {
        const response = await fetcher(`${DETAIL_URL}/${model.id}/endpoints`);
        if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);
        const detail = (await response.json()) as OpenRouterModelDetail;
        if (!isTranscriptionModel(detail.data)) return null;
        const endpoint = detail.data?.endpoints?.[0];
        const promptPrice = Number(endpoint?.pricing?.prompt ?? 0);
        const inputPerM = dollarsPerM(endpoint?.pricing?.prompt);
        const outputPerM = dollarsPerM(endpoint?.pricing?.completion);
        return {
          id: detail.data?.id ?? model.id,
          name: detail.data?.name ?? model.name,
          inputPerMTokens: inputPerM,
          outputPerMTokens: outputPerM,
          estimatedCostPerMinute: estimatePerMinute(promptPrice, inputPerM),
          popularityLabel: model.popularityLabel,
        };
      } catch {
        return null;
      }
    }),
  );

  const models = results.filter((model): model is OpenRouterTranscriptionModel => model !== null);
  if (models.length > 0) return models.slice(0, limit);

  return FALLBACK_RANKED_MODELS.slice(0, limit).map((model) => ({
    ...model,
    inputPerMTokens: 0,
    outputPerMTokens: 0,
    estimatedCostPerMinute: 0,
  }));
}
