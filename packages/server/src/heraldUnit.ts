import { HERALD_AGENT } from "./agent.js";
import { createHeraldChatHandler, createZenodWalletFiler } from "./heraldChat.js";
import { HeraldLaneService, registerHeraldLoopTools } from "./heraldLanes.js";
import { createZenodUnit, type CreateZenodUnitOptions } from "./zenodUnit.js";

/**
 * Herald duplicates the proven tenant/customer chassis and ports the existing
 * vaultless Council runtime. The chat, wallet, SSRF policy, Keys custody,
 * history, customer layer and MCP face stay shared with the shipped Ring.
 */
export function createHeraldUnit(options: CreateZenodUnitOptions = {}) {
  let lanes: HeraldLaneService;
  const inheritedTools = options.registerAdditionalTools;
  const inheritedRoutes = options.mountAdditionalRoutes;
  const inheritedAppOptions = options.appOptionsForTenant;
  const unit = createZenodUnit({
    ...options,
    agent: HERALD_AGENT,
    unitName: "herald",
    tokenEnvVar: "HERALD_API_TOKEN",
    defaultTenantName: "Self-hosted Herald",
    panels: ["chat", "briefing", "board", "keys", "connections", "costs", "mcp"],
    additionalReadTools: [...(options.additionalReadTools ?? []), "get_board", "get_briefing"],
    appOptionsForTenant(tenantId, runtime) {
      const inherited = inheritedAppOptions?.(tenantId, runtime);
      const handler = createHeraldChatHandler({
        getApprovedBriefing: (id) => lanes.store.getApprovedBriefing(id),
        getBriefingDraft: (id) => lanes.store.getBriefingDraft(id),
        saveBriefingDraft: (id, patch) => lanes.store.saveBriefingDraft(id, patch),
        clearBriefingDraft: (id) => lanes.store.clearBriefingDraft(id),
        approveBriefing: (input) => lanes.store.approveBriefing(input),
        listProposed: (id) => lanes.store.listBoardItems(id, ["proposed"]),
        decideItems: (id, decision) => lanes.store.decideItems(id, decision),
        recordFiling: (input) => lanes.store.recordFiling(input),
        fileToMemory: createZenodWalletFiler(() => runtime.settings.peers()),
        listApproved: (id) => lanes.store.listBoardItems(id, ["approved"]),
        publishApproved: (id, itemIds) => lanes.publishApproved(id, itemIds, { appendChatReceipt: false }),
        getTurnState: (id) => {
          const briefing = lanes.store.getApprovedBriefing(id);
          if (!briefing) throw new Error("Herald turn state requires an approved briefing.");
          return {
            briefing,
            board: lanes.store.listBoardItems(id),
            filings: lanes.store.listFilings(id).slice(-10),
            wakes: lanes.store.recentWakeReceipts(id, 10),
          };
        },
      });
      return {
        ...inherited,
        chatInterceptor: async (input) => {
          const result = await handler({ tenantId, text: input.message });
          // Once Herald has an approved briefing, contextNote marks the single
          // model-backed Herald path. An inherited handled reply must never
          // replace it and recreate a second operational authority.
          if (result.handled || result.contextNote || !inherited?.chatInterceptor) return result;
          const inheritedResult = await inherited.chatInterceptor(input);
          return inheritedResult.handled
            ? inheritedResult
            : {
                ...result,
                contextNote: [result.contextNote, inheritedResult.contextNote].filter(Boolean).join("\n\n"),
              };
        },
      };
    },
    registerAdditionalTools(server, context, runtime) {
      inheritedTools?.(server, context, runtime);
      registerHeraldLoopTools(server, context, lanes);
    },
    mountAdditionalRoutes(routes, runtimes) {
      inheritedRoutes?.(routes, runtimes);
      const tenantId = (context: { get(name: "unitContext"): { tenant: { id: string } | null } }) => {
        const id = context.get("unitContext").tenant?.id;
        if (!id) throw new Error("Herald loop route requires a tenant");
        return id;
      };
      routes.get("/api/herald/board", (c) => c.json(lanes.getBoard(tenantId(c))));
      routes.get("/api/herald/briefing", (c) => c.json({ briefing: lanes.getBriefing(tenantId(c)) }));
      routes.post("/api/herald/run-now", async (c) => {
        const receipt = await lanes.proposeNow(tenantId(c));
        return c.json(receipt, receipt.status === "failed" ? 500 : receipt.status === "refused" ? 409 : 200);
      });
      routes.post("/api/herald/approve", async (c) => {
        const body: { itemIds?: string[] } = await c.req.json<{ itemIds?: string[] }>().catch(() => ({}));
        if (!Array.isArray(body.itemIds) || body.itemIds.length === 0) return c.json({ error: "itemIds are required" }, 400);
        try {
          const receipt = await lanes.approveAndPublish(tenantId(c), body.itemIds);
          return c.json(receipt, receipt.status === "ok" ? 200 : 409);
        } catch (error) {
          return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
        }
      });
    },
    customerProduct: {
      product: "herald",
      unit: "herald",
      defaultDomain: "https://herald.zenod.dev",
      signInToLanding: true,
    },
  });
  lanes = new HeraldLaneService(unit.storage.dataDir, {
    runtimeForTenant: (tenantId) =>
      unit.runtimes.forTenantStorage(tenantId, unit.storage.forTenant({ id: tenantId })),
  });
  return {
    ...unit,
    lanes,
    close() {
      lanes.close();
      unit.close();
    },
  };
}
