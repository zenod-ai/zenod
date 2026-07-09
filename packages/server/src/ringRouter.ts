import { createHash, randomUUID } from "node:crypto";

export type RingRouteReason = "named" | "memory_write" | "memory_read" | "media_ingest" | "default";
export type RingRouteStatus = "ok" | "error" | "refused";
export type RingRelayPolicy = "same_channel" | "silent";

export interface RingConnectedServerTools {
  chat?: string;
  askMemory?: string;
  storeMemory?: string;
  ingestMemory?: string;
}

export interface RingConnectedServer {
  id: string;
  endpoint: string;
  token: string;
  displayName: string;
  skillText: string;
  enabled: boolean;
  relayPolicy?: RingRelayPolicy;
  settingsUrl?: string;
  aliases?: string[];
  tools?: RingConnectedServerTools;
}

export interface RingMediaHandle {
  mediaType: "audio" | "screenshot" | "image" | "pdf" | "document" | "link";
  mediaId?: string;
  bytesRef?: string;
  artifactUrl?: string;
  filename?: string;
  sourceHint?: string;
  contentHint?: string;
  hints?: string[];
}

export interface RingInboundMessage {
  channel: string;
  chatId: string;
  text?: string;
  media?: RingMediaHandle[];
  messageId?: string;
  senderTimestamp?: string;
}

export interface RingRouterConfig {
  servers: RingConnectedServer[];
  defaultServerId: string;
  zenodServerId?: string;
}

export interface RingToolCall {
  server: RingConnectedServer;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface RingToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export type RingMcpCaller = (call: RingToolCall) => Promise<RingToolResult>;

export interface RingRouteLogEntry {
  id: string;
  mailboxId: string;
  inputDigest: string;
  chosenServerId: string | null;
  chosenServerDisplayName: string | null;
  reason: RingRouteReason | "unavailable";
  tool: string | null;
  resultStatus: RingRouteStatus;
  channel: string;
  chatId: string;
  timestamp: string;
}

export interface RingMailboxEntry {
  id: string;
  channel: string;
  chatId: string;
  messageId?: string;
  inputDigest: string;
  text: string;
  media: RingMediaHandle[];
  createdAt: string;
}

export interface RingOutboundEnvelope {
  channel: string;
  chatId: string;
  text: string;
  inReplyToMailboxId: string;
}

export interface RingRouteResult {
  mailboxEntry: RingMailboxEntry;
  decision: RingRouteLogEntry;
  outbound: RingOutboundEnvelope | null;
  toolCall: Omit<RingToolCall, "server"> & { serverId: string; serverDisplayName: string } | null;
  toolResult: RingToolResult | null;
}

function digestInput(input: RingInboundMessage): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        channel: input.channel,
        chatId: input.chatId,
        text: input.text ?? "",
        media: input.media ?? [],
        messageId: input.messageId ?? "",
      }),
    )
    .digest("hex");
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function aliasesFor(server: RingConnectedServer): string[] {
  return [server.id, server.displayName, ...(server.aliases ?? [])]
    .map((alias) => alias.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function serverMatches(server: RingConnectedServer, name: string): boolean {
  const normalized = normalizeName(name);
  return aliasesFor(server).some((alias) => normalizeName(alias) === normalized);
}

function stripNamedPrefix(text: string, server: RingConnectedServer): string | null {
  for (const alias of aliasesFor(server)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`^\\s*@${escaped}\\b\\s*:?[\\s-]*`, "i"),
      new RegExp(`^\\s*(?:for|to)\\s+${escaped}\\b\\s*:?[\\s-]*`, "i"),
      new RegExp(`^\\s*${escaped}\\s*:\\s*`, "i"),
    ];
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        const rest = text.replace(pattern, "").trim();
        return rest || text.trim();
      }
    }
  }
  return null;
}

function findNamedRoute(text: string, servers: RingConnectedServer[]): { server: RingConnectedServer; payload: string } | null {
  for (const server of servers) {
    const payload = stripNamedPrefix(text, server);
    if (payload !== null) return { server, payload };
  }
  return null;
}

function isMemoryWrite(text: string): boolean {
  return /\b(remember|store|save|capture|file|note)\b/i.test(text) && /\b(this|that|memory|note|notes|brain|vault)\b/i.test(text);
}

function isMemoryRead(text: string): boolean {
  return /\b(what did i say|what do i know|do i know|recall|search memory|find .*memory|remember about|in my memory|from memory)\b/i.test(text);
}

function textContent(result: RingToolResult): string {
  return result.content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function chatTool(server: RingConnectedServer): string {
  return server.tools?.chat ?? "ask_brain";
}

function memoryTool(server: RingConnectedServer, reason: RingRouteReason): string {
  if (reason === "media_ingest") return server.tools?.ingestMemory ?? "ingest_memory";
  if (reason === "memory_write") return server.tools?.storeMemory ?? "store_memory";
  return server.tools?.askMemory ?? "ask_brain";
}

function buildMediaArguments(input: RingInboundMessage, media: RingMediaHandle): Record<string, unknown> {
  return {
    mediaType: media.mediaType,
    ...(media.artifactUrl ? { artifactUrl: media.artifactUrl } : {}),
    ...(media.bytesRef ?? media.mediaId ? { bytesRef: media.bytesRef ?? media.mediaId } : {}),
    ...(media.filename ? { filename: media.filename } : {}),
    sourceHint: media.sourceHint ?? `Ring ${input.channel}`,
    ...(media.contentHint ?? input.text ? { contentHint: media.contentHint ?? input.text } : {}),
    ...(input.senderTimestamp ? { senderTimestamp: input.senderTimestamp } : {}),
    ...(media.hints ? { hints: media.hints } : {}),
  };
}

function buildArguments(input: RingInboundMessage, payload: string, reason: RingRouteReason, media?: RingMediaHandle): Record<string, unknown> {
  if (reason === "media_ingest" && media) return buildMediaArguments(input, media);
  if (reason === "memory_write") return { content: payload, verbatim: true };
  if (reason === "memory_read") return { question: payload };
  return { message: payload, conversationKey: `${input.channel}:${input.chatId}` };
}

export class RingRouterCore {
  private readonly mailboxEntries: RingMailboxEntry[] = [];
  private readonly routeLogEntries: RingRouteLogEntry[] = [];

  constructor(
    private readonly config: RingRouterConfig,
    private readonly callMcp: RingMcpCaller,
  ) {}

  mailbox(): RingMailboxEntry[] {
    return [...this.mailboxEntries];
  }

  routeLog(): RingRouteLogEntry[] {
    return [...this.routeLogEntries];
  }

  async route(input: RingInboundMessage): Promise<RingRouteResult> {
    const text = (input.text ?? "").trim();
    const media = input.media ?? [];
    const mailboxEntry: RingMailboxEntry = {
      id: randomUUID(),
      channel: input.channel,
      chatId: input.chatId,
      ...(input.messageId ? { messageId: input.messageId } : {}),
      inputDigest: digestInput(input),
      text,
      media,
      createdAt: new Date().toISOString(),
    };
    this.mailboxEntries.push(mailboxEntry);

    const route = this.chooseRoute(text, media);
    if (!route.server) {
      return this.refuse(mailboxEntry, input, route.reason, route.message);
    }
    if (!route.server.enabled) {
      return this.refuse(
        mailboxEntry,
        input,
        route.reason,
        `Connected MCP server "${route.server.displayName}" is disabled; Ring refused the call.`,
        route.server,
        route.tool,
      );
    }

    const args = buildArguments(input, route.payload, route.reason, route.media);
    const toolCall = { server: route.server, tool: route.tool, arguments: args };
    const result = await this.callMcp(toolCall).catch((err: unknown): RingToolResult => {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Could not reach MCP server "${route.server.displayName}": ${message}` }],
        structuredContent: { code: "mcp_call_failed", message },
        isError: true,
      };
    });
    const resultStatus: RingRouteStatus = result.isError ? "error" : "ok";
    const decision = this.log(mailboxEntry, input, route.reason, route.server, route.tool, resultStatus);
    const relayText = textContent(result);
    const outbound =
      route.server.relayPolicy === "silent"
        ? null
        : {
            channel: mailboxEntry.channel,
            chatId: mailboxEntry.chatId,
            text: `${route.server.displayName}: ${relayText || `(${route.server.displayName} returned no text)`}`,
            inReplyToMailboxId: mailboxEntry.id,
          };

    return {
      mailboxEntry,
      decision,
      outbound,
      toolCall: {
        serverId: route.server.id,
        serverDisplayName: route.server.displayName,
        tool: route.tool,
        arguments: args,
      },
      toolResult: result,
    };
  }

  private chooseRoute(
    text: string,
    media: RingMediaHandle[],
  ):
    | { server: RingConnectedServer; reason: RingRouteReason; payload: string; tool: string; media?: RingMediaHandle }
    | { server: null; reason: RingRouteReason | "unavailable"; message: string } {
    const named = findNamedRoute(text, this.config.servers);
    if (named) {
      const reason = this.memoryReason(named.server, named.payload, media) ?? "named";
      return {
        server: named.server,
        reason,
        payload: named.payload,
        tool: reason === "named" ? chatTool(named.server) : memoryTool(named.server, reason),
        ...(reason === "media_ingest" && media[0] ? { media: media[0] } : {}),
      };
    }

    const zenod = this.zenodServer();
    const memoryReason = zenod ? this.memoryReason(zenod, text, media) : null;
    if (zenod && memoryReason) {
      return {
        server: zenod,
        reason: memoryReason,
        payload: text,
        tool: memoryTool(zenod, memoryReason),
        ...(memoryReason === "media_ingest" && media[0] ? { media: media[0] } : {}),
      };
    }

    const fallback = this.serverById(this.config.defaultServerId);
    if (!fallback) {
      return { server: null, reason: "unavailable", message: `Default MCP server "${this.config.defaultServerId}" is not connected.` };
    }
    return { server: fallback, reason: "default", payload: text, tool: chatTool(fallback) };
  }

  private memoryReason(server: RingConnectedServer, text: string, media: RingMediaHandle[]): RingRouteReason | null {
    if (!this.isZenod(server)) return null;
    if (media.length > 0) return "media_ingest";
    if (isMemoryWrite(text)) return "memory_write";
    if (isMemoryRead(text)) return "memory_read";
    return null;
  }

  private zenodServer(): RingConnectedServer | null {
    if (this.config.zenodServerId) return this.serverById(this.config.zenodServerId);
    return this.config.servers.find((server) => serverMatches(server, "zenod")) ?? null;
  }

  private isZenod(server: RingConnectedServer): boolean {
    return this.config.zenodServerId ? server.id === this.config.zenodServerId : serverMatches(server, "zenod");
  }

  private serverById(id: string): RingConnectedServer | null {
    return this.config.servers.find((server) => server.id === id) ?? null;
  }

  private refuse(
    mailboxEntry: RingMailboxEntry,
    input: RingInboundMessage,
    reason: RingRouteReason | "unavailable",
    message: string,
    server: RingConnectedServer | null = null,
    tool: string | null = null,
  ): RingRouteResult {
    const decision = this.log(mailboxEntry, input, reason, server, tool, "refused");
    return {
      mailboxEntry,
      decision,
      outbound: {
        channel: mailboxEntry.channel,
        chatId: mailboxEntry.chatId,
        text: message,
        inReplyToMailboxId: mailboxEntry.id,
      },
      toolCall: null,
      toolResult: { content: [{ type: "text", text: message }], structuredContent: { code: "route_refused", message }, isError: true },
    };
  }

  private log(
    mailboxEntry: RingMailboxEntry,
    input: RingInboundMessage,
    reason: RingRouteReason | "unavailable",
    server: RingConnectedServer | null,
    tool: string | null,
    resultStatus: RingRouteStatus,
  ): RingRouteLogEntry {
    const entry: RingRouteLogEntry = {
      id: randomUUID(),
      mailboxId: mailboxEntry.id,
      inputDigest: mailboxEntry.inputDigest,
      chosenServerId: server?.id ?? null,
      chosenServerDisplayName: server?.displayName ?? null,
      reason,
      tool,
      resultStatus,
      channel: input.channel,
      chatId: input.chatId,
      timestamp: new Date().toISOString(),
    };
    this.routeLogEntries.push(entry);
    return entry;
  }
}
