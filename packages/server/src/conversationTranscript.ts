export interface ConversationTranscriptEntry {
  direction: "inbound" | "outbound";
  at: number;
  messageId: string | null;
  chatId: string;
  contactId: string | null;
  bodyText: string;
  status: string;
  mediaType: string | null;
  sentMessageId?: string | null;
}

export type ConversationTranscriptReader = (input: {
  sinceMs?: number;
  contactId?: string;
  chatId?: string;
  messageId?: string;
  limit?: number;
}) => ConversationTranscriptEntry[];

export interface ConversationTranscriptToolArgs {
  windowMinutes?: unknown;
  contactId?: unknown;
  chatId?: unknown;
  messageId?: unknown;
  limit?: unknown;
}

export function transcriptQueryFromToolArgs(args: ConversationTranscriptToolArgs): {
  sinceMs: number;
  windowMinutes: number;
  contactId?: string;
  chatId?: string;
  messageId?: string;
  limit?: number;
} {
  const parsedWindow = typeof args.windowMinutes === "number" && Number.isFinite(args.windowMinutes) ? args.windowMinutes : 120;
  const parsedLimit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : undefined;
  const parsedMessageId = typeof args.messageId === "string" && args.messageId ? args.messageId : undefined;
  return {
    sinceMs: parsedMessageId ? 0 : Date.now() - parsedWindow * 60 * 1000,
    windowMinutes: parsedWindow,
    ...(typeof args.contactId === "string" && args.contactId ? { contactId: args.contactId } : {}),
    ...(typeof args.chatId === "string" && args.chatId ? { chatId: args.chatId } : {}),
    ...(parsedMessageId ? { messageId: parsedMessageId } : {}),
    ...(parsedLimit ? { limit: parsedLimit } : {}),
  };
}

export function formatConversationTranscript(entries: ConversationTranscriptEntry[]): string {
  if (entries.length === 0) {
    return "No WhatsApp transcript entries matched the requested window/scope.";
  }
  return entries
    .map((entry) => {
      const at = new Date(entry.at).toISOString();
      const who = entry.direction === "inbound" ? entry.contactId ?? "inbound" : "Zenod";
      const media = entry.mediaType ? `; media=${entry.mediaType}` : "";
      const status = entry.status ? `; status=${entry.status}` : "";
      const id = entry.messageId ? `; message=${entry.messageId}` : "";
      const body = entry.bodyText.trim() || "(empty body/transcript not available)";
      return `[${at}] ${entry.direction} ${who}${id}${media}${status}\n${body}`;
    })
    .join("\n\n");
}
