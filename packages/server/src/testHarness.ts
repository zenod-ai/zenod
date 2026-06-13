import { randomUUID } from "node:crypto";
import { conversationId, type BrainEngine, type ChatToolEvent, type SourceRef, type Surface } from "zenod";

const SURFACES = new Set<Surface>(["cli", "mcp", "whatsapp", "web", "drive"]);

export interface SyntheticChatRequest {
  message?: string;
  surface?: string;
  conversationKey?: string;
  testRunId?: string;
}

export interface ChatTestAuditInput {
  correlationId: string;
  testRunId?: string;
  surface: Surface;
  conversationKey: string;
  conversationId: string;
  prompt: string;
  reply?: string;
  sources: SourceRef[];
  toolEvents: ChatToolEvent[];
  status: "ok" | "error";
  error?: string;
  at: Date;
}

export interface ChatTestAuditRecord extends ChatTestAuditInput {
  at: Date;
}

export interface ChatTestAuditStore {
  recordChatTestRun(input: ChatTestAuditInput): ChatTestAuditRecord;
  getChatTestRun(correlationId: string): ChatTestAuditRecord | null;
  listChatTestRuns(limit?: number): ChatTestAuditRecord[];
}

export interface SyntheticChatResult {
  correlationId: string;
  testRunId?: string;
  surface: Surface;
  conversationKey: string;
  conversationId: string;
  status: "ok" | "error";
  text: string;
  sources: ChatTestAuditInput["sources"];
  toolEvents: ChatToolEvent[];
  audit: ChatTestAuditRecord;
  error?: string;
}

export async function runSyntheticChat(options: {
  request: SyntheticChatRequest;
  defaultSurface: Surface;
  getEngine: () => Promise<BrainEngine>;
  recordAudit: (input: ChatTestAuditInput) => ChatTestAuditRecord;
}): Promise<SyntheticChatResult> {
  const message = options.request.message?.trim();
  if (!message) throw new Error("message is required");

  const correlationId = `test_${randomUUID().replaceAll("-", "")}`;
  const testRunId = cleanOptional(options.request.testRunId);
  const surface = parseSurface(options.request.surface, options.defaultSurface);
  const conversationKey = cleanOptional(options.request.conversationKey) ?? testRunId ?? correlationId;
  const cid = conversationId(surface, conversationKey);
  const toolEvents: ChatToolEvent[] = [];

  console.log(`[test-chat:${correlationId}] start surface=${surface} conversation=${cid}`);
  const at = new Date();
  try {
    const engine = await options.getEngine();
    const reply = await engine.chat(message, surface, {
      conversationKey,
      onToolEvent: (event) => {
        toolEvents.push(event);
        console.log(`[test-chat:${correlationId}] tool ${event.phase}: ${event.tool} - ${event.label}`);
      },
    });
    const audit = options.recordAudit({
      correlationId,
      ...(testRunId ? { testRunId } : {}),
      surface,
      conversationKey,
      conversationId: cid,
      prompt: message,
      reply: reply.text,
      sources: reply.sources,
      toolEvents,
      status: "ok",
      at,
    });
    console.log(`[test-chat:${correlationId}] ok`);
    return {
      correlationId,
      ...(testRunId ? { testRunId } : {}),
      surface,
      conversationKey,
      conversationId: cid,
      status: "ok",
      text: reply.text,
      sources: reply.sources,
      toolEvents,
      audit,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : "chat failed";
    const audit = options.recordAudit({
      correlationId,
      ...(testRunId ? { testRunId } : {}),
      surface,
      conversationKey,
      conversationId: cid,
      prompt: message,
      sources: [],
      toolEvents,
      status: "error",
      error,
      at,
    });
    console.error(`[test-chat:${correlationId}] error:`, err);
    return {
      correlationId,
      ...(testRunId ? { testRunId } : {}),
      surface,
      conversationKey,
      conversationId: cid,
      status: "error",
      text: "",
      sources: [],
      toolEvents,
      audit,
      error,
    };
  }
}

function parseSurface(value: string | undefined, fallback: Surface): Surface {
  if (!value) return fallback;
  const candidate = value.trim() as Surface;
  if (!SURFACES.has(candidate)) {
    throw new Error(`surface must be one of: ${Array.from(SURFACES).join(", ")}`);
  }
  return candidate;
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
