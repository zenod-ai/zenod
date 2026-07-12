import { join } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { UnitContext } from "@zenod/mcp-chassis";
import { conversationId } from "zenod";
import { z } from "zod";

import {
  HeraldLoopScheduler,
  HeraldLoopStore,
  type HeraldBoardItem,
  type HeraldBriefing,
  type HeraldMutationReceipt,
  type HeraldProposalInput,
  type HeraldWakeHandlerInput,
  type HeraldWakeReceipt,
} from "./heraldLoop.js";
import {
  callPeerTool,
  callPeerWithArgs,
  type PeerConfig,
  type PeerToolResult,
} from "./peerClient.js";
import type { Runtime } from "./runtime.js";

const X_PERMALINK_RE = /https:\/\/x\.com\/(?:i\/web\/)?status\/(\d+)/i;
const FAILED_FILING_RE =
  /^(?:Could not reach|Zenod filing failed|Zenod filing receipt timed out)/i;

export interface HeraldPublishReceipt {
  itemId: string;
  permalink: string;
  filingReceipt: string;
}

export interface HeraldApprovalReceipt extends HeraldMutationReceipt {
  published: HeraldPublishReceipt[];
}

export interface HeraldLaneServiceOptions {
  runtimeForTenant: (tenantId: string) => Runtime;
  callTool?: typeof callPeerTool;
  callToolText?: typeof callPeerWithArgs;
  /** Test seam only; production uses the tenant's configured model through Runtime. */
  answer?: (
    runtime: Runtime,
    prompt: string,
    wakeId: string,
  ) => Promise<string>;
  startScheduler?: boolean;
  log?: Pick<Console, "info" | "error">;
}

type MemorySource = { path: string; citation: string; body: string };

function textResult(result: PeerToolResult): string {
  return result.content
    .filter(
      (
        item,
      ): item is Extract<(typeof result.content)[number], { type: "text" }> =>
        item.type === "text",
    )
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function peerHasTool(peer: PeerConfig, tool: string): boolean {
  return (
    peer.tools?.some(
      (candidate) => candidate.mcp === tool || candidate.as === tool,
    ) ?? false
  );
}

function walletPeer(runtime: Runtime, kind: "memory" | "mouth"): PeerConfig {
  const peers = runtime.settings.peers().filter((peer) => peer.wallet === true);
  const desired =
    kind === "memory"
      ? (peers.find(
          (peer) =>
            peerHasTool(peer, "search_memory") &&
            peerHasTool(peer, "get_memory"),
        ) ?? peers.find((peer) => peer.name.toLowerCase().includes("zenod")))
      : (peers.find(
          (peer) =>
            peerHasTool(peer, "createPosts") &&
            peerHasTool(peer, "approve_send"),
        ) ?? peers.find((peer) => /calli|callisthenes/i.test(peer.name)));
  if (!desired) {
    throw new Error(
      kind === "memory"
        ? "Connect a Zenod memory unit in Herald's wallet before proposing."
        : "Connect a Callisthenes mouth in Herald's wallet before publishing.",
    );
  }
  return desired;
}

function proposalJson(
  text: string,
): Array<{ text: string; rationale: string; sourceIndex: number }> {
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  if (start < 0 || end <= start)
    throw new Error("the proposer did not return a JSON proposal array");
  const parsed = JSON.parse(unfenced.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed))
    throw new Error("the proposer response was not an array");
  return parsed.map((candidate, index) => {
    const row =
      candidate && typeof candidate === "object"
        ? (candidate as Record<string, unknown>)
        : {};
    const post = String(row.text ?? "").trim();
    const rationale = String(row.rationale ?? "").trim();
    const sourceIndex = Number(row.sourceIndex);
    if (!post || !rationale || !Number.isInteger(sourceIndex)) {
      throw new Error(
        `proposal ${index + 1} must include text, rationale, and an integer sourceIndex`,
      );
    }
    return { text: post, rationale, sourceIndex };
  });
}

function canonicalXPermalink(raw: string): string | null {
  const match = raw.match(X_PERMALINK_RE);
  return match ? `https://x.com/i/web/status/${match[1]}` : null;
}

function mutationResult(
  receipt: HeraldMutationReceipt | HeraldWakeReceipt,
  evidence: unknown[],
) {
  const ok =
    "status" in receipt &&
    receipt.status !== "failed" &&
    receipt.status !== "refused";
  return {
    content: [{ type: "text" as const, text: receipt.message }],
    structuredContent: { ...receipt, status: ok ? "ok" : "error", evidence },
    ...(ok ? {} : { isError: true }),
  };
}

/** Herald's two concrete lanes, hosted inside the duplicated Ring unit. */
export class HeraldLaneService {
  readonly store: HeraldLoopStore;
  readonly scheduler: HeraldLoopScheduler;
  private readonly callTool: typeof callPeerTool;
  private readonly callToolText: typeof callPeerWithArgs;
  private readonly answer: NonNullable<HeraldLaneServiceOptions["answer"]>;

  constructor(
    dataDir: string,
    private readonly options: HeraldLaneServiceOptions,
  ) {
    this.store = new HeraldLoopStore(join(dataDir, "herald-loop.sqlite"));
    this.callTool = options.callTool ?? callPeerTool;
    this.callToolText = options.callToolText ?? callPeerWithArgs;
    this.answer =
      options.answer ??
      (async (runtime, prompt, wakeId) => {
        const engine = await runtime.getEngine();
        const reply = await engine.chat(prompt, "mcp", {
          conversationKey: `herald-proposer-${wakeId}`,
        });
        return reply.text;
      });
    this.scheduler = new HeraldLoopScheduler(this.store, {
      runWake: (input) => this.propose(input),
      onReceipt: (receipt) =>
        this.appendChatReceipt(receipt.tenantId, this.wakeChatReceipt(receipt)),
      log: options.log,
    });
    if (options.startScheduler !== false) this.scheduler.start();
  }

  getBoard(tenantId: string): {
    items: HeraldBoardItem[];
    wakes: HeraldWakeReceipt[];
  } {
    return {
      items: this.store.listBoardItems(tenantId),
      wakes: this.store.recentWakeReceipts(tenantId),
    };
  }

  getBriefing(tenantId: string): HeraldBriefing | null {
    return this.store.getApprovedBriefing(tenantId);
  }

  proposeNow(tenantId: string): Promise<HeraldWakeReceipt> {
    return this.scheduler.runNow(tenantId);
  }

  async approveAndPublish(
    tenantId: string,
    itemIds: string[],
  ): Promise<HeraldApprovalReceipt> {
    const ids = [...new Set(itemIds)];
    const items = ids.map((itemId) =>
      this.store.getBoardItem(tenantId, itemId),
    );
    const invalidIndex = items.findIndex(
      (item) =>
        !item || (item.state !== "proposed" && item.state !== "approved"),
    );
    if (invalidIndex >= 0) {
      return {
        status: "error",
        code: "invalid_board_transition",
        message: `Board item ${ids[invalidIndex]} must be proposed or approved before publishing.`,
        tenantId,
        published: [],
      };
    }
    const proposedIds = items
      .filter((item): item is HeraldBoardItem => item?.state === "proposed")
      .map((item) => item.id);
    const approved =
      proposedIds.length > 0
        ? this.store.approveItems(tenantId, proposedIds)
        : {
            status: "ok" as const,
            code: "items_already_approved",
            message: `${ids.length} item${ids.length === 1 ? "" : "s"} already approved.`,
            tenantId,
            ids,
          };
    if (approved.status === "error") return { ...approved, published: [] };

    return this.publishApproved(tenantId, ids);
  }

  /** Poster-only hook for the chat command `publish approved`. Never approves rows. */
  async publishApproved(
    tenantId: string,
    itemIds: string[],
    options: { appendChatReceipt?: boolean } = {},
  ): Promise<HeraldApprovalReceipt> {
    const ids = [...new Set(itemIds)];
    const invalidId = ids.find((itemId) => {
      const item = this.store.getBoardItem(tenantId, itemId);
      return !item || item.state !== "approved";
    });
    if (invalidId) {
      return {
        status: "error",
        code: "invalid_board_transition",
        message: `Board item ${invalidId} must already be approved before publishing.`,
        tenantId,
        published: [],
      };
    }
    if (ids.length === 0) {
      return {
        status: "error",
        code: "no_board_items",
        message: "No approved board items were selected for publishing.",
        tenantId,
        published: [],
      };
    }

    const published: HeraldPublishReceipt[] = [];
    for (const itemId of ids) {
      published.push(await this.publishOneApproved(tenantId, itemId));
    }
    const message = published.map((entry) => entry.permalink).join("\n");
    if (options.appendChatReceipt !== false) {
      await this.appendChatReceipt(
        tenantId,
        `Published ${published.length} approved item${published.length === 1 ? "" : "s"}:\n${message}`,
      );
    }
    return {
      status: "ok",
      code: "items_posted",
      message: `Published ${published.length} approved item${published.length === 1 ? "" : "s"} with canonical permalink receipts.`,
      tenantId,
      ids,
      published,
    };
  }

  close(): void {
    this.scheduler.stop();
    this.store.close();
  }

  private async propose(
    input: HeraldWakeHandlerInput,
  ): Promise<HeraldProposalInput[]> {
    const runtime = this.options.runtimeForTenant(input.tenantId);
    const memory = walletPeer(runtime, "memory");
    const filingContext = this.store.listFilings(input.tenantId).slice(-10);
    const query = [
      input.briefing.content.theme,
      ...input.briefing.content.objectives,
      ...filingContext.map((filing) => filing.content),
    ].join(" ");
    const search = await this.callTool(memory, "search_memory", { query });
    if (search.isError)
      throw new Error(textResult(search) || "Zenod memory search failed");
    const hits = Array.isArray(search.structuredContent?.hits)
      ? (search.structuredContent.hits as Array<Record<string, unknown>>)
      : [];
    const selected = hits.slice(0, Math.max(input.proposalCount, 3));
    if (selected.length === 0)
      throw new Error("Zenod returned no cited memory for this briefing");

    const sources: MemorySource[] = [];
    for (const hit of selected) {
      const path = String(hit.path ?? "").trim();
      if (!path) continue;
      const note = await this.callTool(memory, "get_memory", { path });
      if (note.isError) continue;
      const structured = note.structuredContent as
        | Record<string, unknown>
        | undefined;
      const citation = String(
        structured?.githubUrl ?? hit.githubUrl ?? path,
      ).trim();
      const body = String(structured?.body ?? textResult(note)).trim();
      if (citation && body) sources.push({ path, citation, body });
    }
    if (sources.length === 0)
      throw new Error("Zenod returned no readable cited memory pages");

    const prompt = [
      "You are Herald's proposer lane. Return ONLY a JSON array.",
      `Create exactly ${input.proposalCount} concise X post proposals governed by this approved briefing:`,
      JSON.stringify(input.briefing.content),
      'Each object must be {"text":string,"rationale":string,"sourceIndex":integer}.',
      "The rationale is the one-line WHY. sourceIndex is zero-based into the substantiating sources below.",
      filingContext.length
        ? `Recent filings MUST visibly shape the new ideas (build on posted outcomes and avoid rejected directions): ${JSON.stringify(filingContext)}`
        : "There are no prior filings yet.",
      "Sources:",
      ...sources.map(
        (source, index) =>
          `[${index}] ${source.path} | ${source.citation}\n${source.body.slice(0, 4_000)}`,
      ),
    ].join("\n\n");
    const generated = proposalJson(
      await this.answer(runtime, prompt, input.wakeId),
    );
    if (generated.length !== input.proposalCount) {
      throw new Error(
        `the proposer returned ${generated.length} items; expected ${input.proposalCount}`,
      );
    }
    return generated.map((proposal) => {
      const source = sources[proposal.sourceIndex];
      if (!source)
        throw new Error(
          `proposal sourceIndex ${proposal.sourceIndex} is outside the cited source set`,
        );
      return {
        text: proposal.text,
        rationale: proposal.rationale,
        memoryCitation: source.citation,
      };
    });
  }

  private async publishOneApproved(
    tenantId: string,
    itemId: string,
  ): Promise<HeraldPublishReceipt> {
    const runtime = this.options.runtimeForTenant(tenantId);
    const item = this.store.getBoardItem(tenantId, itemId);
    if (!item || item.state !== "approved")
      throw new Error(`board item ${itemId} is not approved`);
    const mouth = walletPeer(runtime, "mouth");
    const draft = await this.callTool(mouth, "createPosts", {
      text: item.text,
    });
    const draftText = textResult(draft);
    if (!draft.isError || !draftText.includes("[draft_not_approved]")) {
      throw new Error(
        `Callisthenes did not hold the draft under C-22: ${draftText || "empty result"}`,
      );
    }
    const send = await this.callTool(mouth, "approve_send", {
      channel: "x",
      text: item.text,
    });
    const sendText = textResult(send);
    const permalink = !send.isError ? canonicalXPermalink(sendText) : null;
    if (!permalink)
      throw new Error(
        `Callisthenes did not return a canonical x.com permalink: ${sendText || "empty result"}`,
      );
    const posted = this.store.markPosted(tenantId, itemId, permalink);
    if (posted.status === "error") throw new Error(posted.message);

    const memory = walletPeer(runtime, "memory");
    const filingContent = `Herald posted board item ${item.id}. Text: ${item.text}. WHY: ${item.rationale}. Source: ${item.memoryCitation}. Receipt: ${permalink}. Build on this outcome in the next wake.`;
    const filingReceipt = await this.callToolText(memory, "store_memory", {
      content: filingContent,
      hints: ["Herald loop filing", "posted outcome", "use in next wake"],
    });
    if (!filingReceipt.trim() || FAILED_FILING_RE.test(filingReceipt.trim())) {
      throw new Error(
        `Posted ${permalink}, but the Zenod filing failed loudly: ${filingReceipt || "empty result"}`,
      );
    }
    this.store.recordFiling({
      tenantId,
      kind: "posted",
      content: filingContent,
      memoryCitation: item.memoryCitation,
      commitReceipt: filingReceipt,
    });
    return { itemId, permalink, filingReceipt };
  }

  private async appendChatReceipt(
    tenantId: string,
    text: string,
  ): Promise<void> {
    const runtime = this.options.runtimeForTenant(tenantId);
    await runtime.state.appendMessage(
      conversationId("web"),
      "assistant",
      text,
      "web",
    );
  }

  private wakeChatReceipt(receipt: HeraldWakeReceipt): string {
    if (receipt.code !== "wake_completed" || receipt.proposalIds.length === 0)
      return receipt.message;
    const proposals = receipt.proposalIds
      .map((id) => this.store.getBoardItem(receipt.tenantId, id))
      .filter((item): item is HeraldBoardItem => item !== null);
    return [
      receipt.message,
      ...proposals.map((item, index) =>
        [
          `${index + 1}. ${item.text}`,
          `WHY: ${item.rationale}`,
          `Memory: ${item.memoryCitation}`,
        ].join("\n"),
      ),
    ].join("\n\n");
  }
}

export function registerHeraldLoopTools(
  server: McpServer,
  context: UnitContext,
  service: HeraldLaneService,
): void {
  if (!context.tenant) throw new Error("Herald loop tools require a tenant");
  const tenantId = context.tenant.id;
  server.registerTool(
    "get_board",
    {
      title: "Get Herald board",
      description:
        "Read this tenant's Herald proposals, approval states, WHY, memory citations, posting receipts, and recent wakes.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(service.getBoard(tenantId), null, 2),
        },
      ],
      structuredContent: service.getBoard(tenantId),
    }),
  );
  server.registerTool(
    "get_briefing",
    {
      title: "Get approved Herald briefing",
      description:
        "Read this tenant's current approved, versioned Herald briefing. A null briefing means Herald will refuse to loop.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const briefing = service.getBriefing(tenantId);
      return {
        content: [
          {
            type: "text",
            text: briefing
              ? JSON.stringify(briefing, null, 2)
              : "No briefing approved — Herald will not loop.",
          },
        ],
        structuredContent: { briefing },
      };
    },
  );
  server.registerTool(
    "propose_now",
    {
      title: "Run Herald proposer now",
      description:
        "Run the exact same tenant wake path used by Herald's scheduler. Refuses without an approved briefing.",
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async () => {
      const receipt = await service.proposeNow(tenantId);
      return mutationResult(
        receipt,
        receipt.proposalIds.map((id) => ({ kind: "board_item", id })),
      );
    },
  );
  server.registerTool(
    "approve_items",
    {
      title: "Approve and publish Herald board items",
      description:
        "Approve named proposed items, send each exact text through Callisthenes draft then approve_send, persist canonical x.com receipts, and file the outcome to Zenod.",
      inputSchema: { itemIds: z.array(z.string().min(1)).min(1).max(10) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ itemIds }) => {
      try {
        const receipt = await service.approveAndPublish(tenantId, itemIds);
        return mutationResult(
          receipt,
          receipt.published.map((entry) => ({
            kind: "permalink",
            id: entry.itemId,
            url: entry.permalink,
          })),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          structuredContent: {
            status: "error",
            code: "publish_failed",
            message,
            evidence: [],
          },
          isError: true,
        };
      }
    },
  );
}
