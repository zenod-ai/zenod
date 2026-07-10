import type { MediaIngestReceipt } from "./api.ts"

export function formatMediaIngestTranscription(
  transcription: MediaIngestReceipt["transcription"]
): string | null {
  if (transcription === "provided") return "Transcript provided"
  if (transcription === "performed") return "Transcription performed"
  return null
}
