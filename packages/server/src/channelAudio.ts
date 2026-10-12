import type { Settings } from "./settings.js";
import { transcribeAudio, type TranscriptionEnvelope } from "./transcribe.js";

export async function transcribeChannelAudio(
  settings: Settings,
  data: Buffer,
  filename: string,
): Promise<TranscriptionEnvelope> {
  return transcribeAudio(data, filename, {
    model: settings.whisperModel(),
    groqApiKey: settings.get("groq_api_key"),
    openaiApiKey: settings.get("openai_api_key"),
    openrouterApiKey: settings.openrouterApiKey(),
    openrouterUser: settings.openrouterUser(),
    openrouterModel: settings.openrouterTranscriptionModel(),
    longTranscriptionProvider: settings.longTranscriptionProvider(),
    useOpenAiForLongAudio: settings.useOpenAiForLongTranscription(),
    allowLocalFallback: false,
    onUsage: settings.transcriptionUsageSink(),
  });
}
