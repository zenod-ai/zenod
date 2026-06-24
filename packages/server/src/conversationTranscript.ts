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
  media?: ConversationTranscriptMedia[];
  linkedReceipts?: ConversationTranscriptReceipt[];
}

export interface ConversationTranscriptMedia {
  mediaId: number;
  mediaType: string;
  mimeType: string | null;
  fileName: string | null;
  storageStatus: string;
}

export interface ConversationTranscriptReceipt {
  at: number;
  status: string;
  sentMessageId: string | null;
  bodyText: string;
  driveLinks: string[];
  driveFileIds: string[];
  vaultEvidenceRefs: string[];
  vaultCommits: string[];
  vaultLinks: string[];
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
      const mediaDetails = entry.media?.length
        ? `\nMedia evidence:\n${entry.media
            .map((item) => {
              const mime = item.mimeType ? `; mime=${item.mimeType}` : "";
              const file = item.fileName ? `; file=${item.fileName}` : "";
              return `- ${item.mediaType}${mime}${file}; storage=${item.storageStatus}`;
            })
            .join("\n")}`
        : "";
      const receipts = entry.linkedReceipts?.length
        ? `\nLinked receipt(s):\n${entry.linkedReceipts
            .map((receipt) => {
              const links = [...receipt.driveLinks, ...receipt.vaultEvidenceRefs, ...receipt.vaultLinks].filter(Boolean);
              return `- ${new Date(receipt.at).toISOString()} status=${receipt.status}${receipt.sentMessageId ? ` sent=${receipt.sentMessageId}` : ""}${links.length ? ` — ${links.join(", ")}` : ""}`;
            })
            .join("\n")}`
        : "";
      const status = entry.status ? `; status=${entry.status}` : "";
      const id = entry.messageId ? `; message=${entry.messageId}` : "";
      const body = entry.bodyText.trim() || "(empty body/transcript not available)";
      const chars = entry.bodyText.trim() ? `; chars=${entry.bodyText.length}` : "";
      return `[${at}] ${entry.direction} ${who}${id}${media}${status}${chars}\n${body}${mediaDetails}${receipts}`;
    })
    .join("\n\n");
}
