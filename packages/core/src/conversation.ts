import type { Surface } from "./types.js";

/**
 * Stable conversation namespace shared by chat messages and capture context.
 * Provider ids are not globally unique across channels or chats, so capture
 * identity always retains the unsanitized conversation key alongside this id.
 */
export function conversationId(surface: Surface, key = "default"): string {
  const safeKey = key.trim().replace(/[^\w@.+:-]/g, "_").slice(0, 160) || "default";
  return `${surface}:${safeKey}`;
}
