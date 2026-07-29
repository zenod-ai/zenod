import { createHash } from "node:crypto";

export const CAPTURE_MEMORY_TOOLS = ["store_memory", "ingest_memory"] as const;
export type CaptureMemoryTool = (typeof CAPTURE_MEMORY_TOOLS)[number];

export function isCaptureMemoryTool(value: unknown): value is CaptureMemoryTool {
  return typeof value === "string"
    && CAPTURE_MEMORY_TOOLS.includes(value as CaptureMemoryTool);
}

/**
 * Opaque identity for one exact memory connection. The bearer never crosses
 * the Phylax→Ring ticket boundary, while endpoint or credential rotation
 * produces a different authority identity and therefore fails closed.
 */
export function captureMemoryAuthorityId(input: { url: string; token: string }): string {
  const url = new URL(input.url.trim()).toString();
  const token = input.token.trim();
  if (!token) throw new Error("memory authority token is required");
  const digest = createHash("sha256")
    .update(url)
    .update("\0")
    .update(token)
    .digest("hex");
  return `memory-authority-v1:${digest}`;
}
