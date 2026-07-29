import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Surface } from "zenod";
import { z } from "zod";

import {
  CAPTURE_MEMORY_TOOLS,
  captureMemoryAuthorityId,
  type CaptureMemoryTool,
} from "./captureMemoryAuthority.js";
import { callPeerTool, type PeerConfig, type PeerToolResult } from "./peerClient.js";
import type { Runtime } from "./runtime.js";

const CAPTURE_SURFACES = ["whatsapp", "telegram"] as const satisfies readonly Surface[];

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function verifiedCaptureReceipt(
  result: PeerToolResult,
  expectedJobId: string,
  expectedKind: "store" | "media_ingest",
): { summary: string; evidenceRef: string } | null {
  if (result.isError) return null;
  const structured = objectValue(result.structuredContent);
  const responseJobId = structured?.ticket_id ?? structured?.jobId;
  const state = structured?.state ?? structured?.status;
  const kind = structured?.kind;
  if (
    responseJobId !== expectedJobId
    || state !== "done"
    || kind !== expectedKind
  ) return null;
  const payload = objectValue(structured?.result);
  const digest = objectValue(payload?.digest);
  const evidenceValue = payload?.evidenceRef ?? digest?.evidenceRef;
  if (typeof evidenceValue !== "string" || !evidenceValue.trim()) return null;
  const pagesValue = payload?.pagesTouched ?? digest?.pagesTouched;
  const pages = Array.isArray(pagesValue)
    ? pagesValue.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  const message = typeof payload?.message === "string" && payload.message.trim()
    ? payload.message.trim().replace(/\s+/g, " ")
    : pages.length > 0
      ? `Filed memory in ${pages.join(", ")}.`
      : "Filed memory.";
  return {
    summary: message.slice(0, 500),
    evidenceRef: evidenceValue.trim(),
  };
}

function exactMemoryAuthority(
  runtime: Runtime,
  memoryAuthorityId: string,
  captureTool: CaptureMemoryTool,
): PeerConfig | null {
  const matches = runtime.settings.peers().filter((peer) => {
    try {
      if (captureMemoryAuthorityId(peer) !== memoryAuthorityId) return false;
    } catch {
      return false;
    }
    const tools = peer.tools ?? [];
    return tools.some((tool) => tool.mcp === captureTool)
      && tools.some((tool) => tool.mcp === "get_task_result");
  });
  return matches.length === 1 ? matches[0]! : null;
}

async function readVerifiedCapture(
  runtime: Runtime,
  jobId: string,
  memoryAuthorityId: string,
  captureTool: CaptureMemoryTool,
): Promise<{ summary: string; evidenceRef: string } | null> {
  const peer = exactMemoryAuthority(runtime, memoryAuthorityId, captureTool);
  if (!peer) return null;
  try {
    return verifiedCaptureReceipt(
      await callPeerTool(peer, "get_task_result", { ticket_id: jobId }),
      jobId,
      captureTool === "store_memory" ? "store" : "media_ingest",
    );
  } catch {
    return null;
  }
}

/**
 * Host-owned intake for D18 capture context. Caller prose/state is never
 * authority: Ring re-reads the canonical memory job and derives both summary
 * and evidenceRef from its exact terminal receipt before touching context.
 */
export function registerRingCaptureTicketTool(
  server: McpServer,
  runtime: Runtime,
  tenantId: string,
): void {
  server.registerTool(
    "record_capture_ticket",
    {
      title: "Record terminal capture context",
      description:
        "Host intake for one capture correlation. Ring independently verifies the canonical job is terminal, then adds only its host-derived bounded summary and evidenceRef to this authenticated tenant's conversation. Retry-safe; queued, failed, unknown, or caller-asserted terminal captures are rejected.",
      inputSchema: {
        surface: z.enum(CAPTURE_SURFACES).describe("Capture channel"),
        conversationKey: z.string().trim().min(1).max(200).describe("Exact provider chat/conversation namespace"),
        providerMessageId: z.string().trim().min(1).max(256).describe("Stable channel-provider message id"),
        jobId: z.string().trim().min(1).max(256).describe("Canonical memory job id Ring must independently verify"),
        memoryAuthorityId: z.string()
          .regex(/^memory-authority-v1:[0-9a-f]{64}$/)
          .describe("Opaque fingerprint of the exact originating tenant memory connection"),
        captureTool: z.enum(CAPTURE_MEMORY_TOOLS)
          .describe("Exact memory mutation tool that originated the canonical job"),
        terminalState: z.any().optional().refine((value) => value === undefined, {
          message: "terminalState assertions are not accepted; Ring verifies jobId",
        }),
        summary: z.any().optional().refine((value) => value === undefined, {
          message: "caller summaries are not accepted; Ring derives the terminal recap",
        }),
        evidenceRef: z.any().optional().refine((value) => value === undefined, {
          message: "caller evidence is not accepted; Ring derives the terminal evidenceRef",
        }),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      surface,
      conversationKey,
      providerMessageId,
      jobId,
      memoryAuthorityId,
      captureTool,
    }) => {
      const verified = await readVerifiedCapture(
        runtime,
        jobId,
        memoryAuthorityId,
        captureTool,
      );
      if (!verified) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: "Capture context not recorded: the canonical memory job is not a verified terminal success.",
          }],
          structuredContent: {
            status: "pending",
            jobId,
            evidence: [],
          },
        };
      }
      const status = await runtime.state.appendCaptureTicket(
        {
          identity: {
            tenantId,
            surface,
            conversationKey,
            providerMessageId,
          },
          summary: verified.summary,
          evidenceRef: verified.evidenceRef,
        },
      );
      return {
        content: [{
          type: "text",
          text: status === "recorded"
            ? `Capture context ticket recorded.\nevidence: ${verified.evidenceRef}`
            : `Capture context ticket already recorded.\nevidence: ${verified.evidenceRef}`,
        }],
        structuredContent: {
          status,
          jobId,
          evidenceRef: verified.evidenceRef,
          captureIdentity: {
            tenantId,
            surface,
            conversationKey,
            providerMessageId,
          },
          evidence: [{
            kind: "capture_context_ticket",
            id: providerMessageId,
          }],
        },
      };
    },
  );
}
