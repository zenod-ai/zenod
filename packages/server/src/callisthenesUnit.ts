import type { HttpBindings } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { ChassisStorage, createSqliteTenantStore, hashToken, type TenantProvisioningStore } from "@zenod/mcp-chassis";
import { createCallisthenesCustomerLayer, type CallisthenesCustomerLayerOptions } from "./callisthenesCustomerLayer.js";
import { mountStaticSurfaces } from "./staticSurfaces.js";
import { resolvedGitSha } from "./app.js";
import { CallisthenesObservationLedger } from "./callisthenesObservationLedger.js";
import {
  parseOutboundReceipt,
  renderApproveAffordance,
  renderNothingPendingToApprove,
  renderOutboundReceipt,
} from "./outboundReceipt.js";

export interface CreateCallisthenesUnitOptions {
  dataDir?: string;
  webDist?: string;
  siteDist?: string;
  tenantStore?: TenantProvisioningStore;
  customer?: CallisthenesCustomerLayerOptions;
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
}

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

interface RpcResponse {
  jsonrpc?: "2.0";
  id?: string | number | null;
  result?: { tools?: McpToolDescriptor[]; content?: Array<{ type?: string; text?: string }> };
  error?: { message?: string; data?: unknown };
}

interface McpToolDescriptor {
  name?: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  [key: string]: unknown;
}

const READ_TOOL_NAMES = new Set([
  "searchPostsRecent",
  "getPostsById",
  "getPostsByIds",
  "getUsersMe",
  "getUsersById",
  "getUsersByUsername",
  "getUsersPosts",
  "getUsersMentions",
]);

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

const APPROVAL_PROPERTY = {
  description: "Explicit approval for this outward mutation. Omit it to create a held draft; never infer approval.",
};

const APPROVE_SEND_TOOL = {
  name: "approve_send",
  title: "Approve and send an exact X draft",
  description: "After the user explicitly confirms the exact final text, commit its tenant-held action exactly once. Pass the opaque action_id returned by the draft when available. Safe retries return the stored canonical permalink receipt without posting again.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["channel", "text"],
    properties: {
      channel: { type: "string", enum: ["x"], description: "The approved outbound channel." },
      action_id: { type: "string", minLength: 1, description: "Opaque held-action id returned by the unapproved createPosts call. Supply it when available." },
      text: { type: "string", minLength: 1, description: "The exact final text already shown to and explicitly confirmed by the user. Do not rewrite it." },
    },
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
};

const RECONCILE_SEND_TOOL = {
  name: "reconcile_send",
  title: "Reconcile an unknown X publication",
  description: "Resolve an unknown approve_send outcome only by reading the connected X identity and a specific X post, then proving its author, exact text, unique post id, and creation window match the held action. This tool never publishes or retries.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["channel", "action_id", "text", "post_id"],
    properties: {
      channel: { type: "string", enum: ["x"] },
      action_id: { type: "string", minLength: 1 },
      text: { type: "string", minLength: 1 },
      post_id: { type: "string", pattern: "^[0-9]+$", description: "Numeric X post id obtained independently after the ambiguous dispatch." },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

function objectSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  return schema && schema.type === "object" ? schema : { type: "object", properties: {} };
}

function withApprovalProperty(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  const normalized = objectSchema(schema);
  const properties = normalized.properties && typeof normalized.properties === "object"
    ? normalized.properties as Record<string, unknown>
    : {};
  return {
    ...normalized,
    properties: {
      ...properties,
      callisthenes_approve: {
        ...(properties.callisthenes_approve && typeof properties.callisthenes_approve === "object"
          ? properties.callisthenes_approve as Record<string, unknown>
          : {}),
        ...APPROVAL_PROPERTY,
      },
    },
  };
}

function withoutApprovalProperty(
  schema: Record<string, unknown> | undefined,
  approvalArg = "callisthenes_approve",
): Record<string, unknown> {
  const normalized = objectSchema(schema);
  const properties = normalized.properties && typeof normalized.properties === "object"
    ? { ...normalized.properties as Record<string, unknown> }
    : {};
  delete properties.callisthenes_approve;
  delete properties[approvalArg];
  const required = Array.isArray(normalized.required)
    ? normalized.required.filter((name) => name !== "callisthenes_approve" && name !== approvalArg)
    : normalized.required;
  return { ...normalized, ...(required ? { required } : {}), properties };
}

function describePublicTool(tool: McpToolDescriptor, approvalArg = "callisthenes_approve"): McpToolDescriptor {
  if (!tool.name) return tool;
  if (READ_TOOL_NAMES.has(tool.name)) {
    return { ...tool, annotations: READ_ANNOTATIONS };
  }
  if (tool.name === "createPosts") {
    return {
      ...tool,
      title: "Draft or create an X post",
      description: "Create a tenant-held X draft (returns [draft_not_approved] plus an opaque held action_id and does not publish). Publish only through approve_send after exact confirmation; direct approval fields are ignored.",
      inputSchema: withoutApprovalProperty(tool.inputSchema, approvalArg),
      annotations: WRITE_ANNOTATIONS,
    };
  }
  if (tool.name === "deletePosts") {
    return {
      ...tool,
      title: "Delete an X post",
      description: "Delete the specified X post only with explicit callisthenes_approve. This is destructive and returns the deleted post handle; do not treat retries as guaranteed safe.",
      inputSchema: withApprovalProperty(tool.inputSchema),
      annotations: WRITE_ANNOTATIONS,
    };
  }
  return tool;
}

function parseRpc(body: string): RpcRequest | null {
  try {
    const value = JSON.parse(body) as RpcRequest;
    return value?.jsonrpc === "2.0" && typeof value.method === "string" ? value : null;
  } catch {
    return null;
  }
}

function resultText(payload: RpcResponse): string {
  if (payload.error) return `${payload.error.message ?? "MCP error"} ${JSON.stringify(payload.error.data ?? "")}`.trim();
  return (payload.result?.content ?? [])
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function parseRpcResponse(text: string): RpcResponse | null {
  try {
    return JSON.parse(text) as RpcResponse;
  } catch {
    for (const line of text.split(/\r?\n/).reverse()) {
      if (!line.startsWith("data:")) continue;
      try {
        return JSON.parse(line.slice(5).trim()) as RpcResponse;
      } catch {
        // Keep searching earlier SSE events.
      }
    }
    return null;
  }
}

function rpcText(id: RpcRequest["id"], text: string, headers?: Headers): Response {
  const outgoing = new Headers();
  const sessionId = headers?.get("mcp-session-id");
  if (sessionId) outgoing.set("mcp-session-id", sessionId);
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result: { content: [{ type: "text", text }] } }, { headers: outgoing });
}

function unknownPublication(actionId: string, reason?: string): string {
  return `[publication_unknown] action_id=${actionId}. The prior dispatch may have published. Do not call approve_send again. Reconcile it with reconcile_send using a provider-read post_id.${reason ? ` Detail: ${reason}` : ""}`;
}

function publicationInProgress(actionId: string): string {
  return `[publication_in_progress] action_id=${actionId}. One dispatch is already in flight. Do not retry or call another send tool; a later approve_send call may only replay its terminal receipt or unknown state.`;
}

function publicationDeferred(action: { id: string; retry_at?: string; unknown_reason?: string }): string {
  return `[publication_deferred] action_id=${action.id}. The engine proved no post was dispatched. ${action.unknown_reason ?? "Retry later."} Retry only after ${action.retry_at}.`;
}

function extractPost(raw: string): { id: string; text: string; authorId: string; createdAt: string } | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const visit = (value: unknown): { id: string; text: string; authorId: string; createdAt: string } | null => {
      if (!value || typeof value !== "object") return null;
      const object = value as Record<string, unknown>;
      const createdAt = object.created_at ?? object.createdAt;
      const authorId = object.author_id ?? object.authorId;
      if ((typeof object.id === "string" || typeof object.id === "number") && typeof object.text === "string" && typeof authorId === "string" && typeof createdAt === "string") {
        return { id: String(object.id), text: object.text, authorId, createdAt };
      }
      for (const child of Object.values(object)) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(parsed);
  } catch {
    return null;
  }
}

function extractUserId(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const visit = (value: unknown): string | null => {
      if (!value || typeof value !== "object") return null;
      const object = value as Record<string, unknown>;
      if ((typeof object.id === "string" || typeof object.id === "number") && typeof (object.username ?? object.name) === "string") return String(object.id);
      for (const child of Object.values(object)) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(parsed);
  } catch {
    return null;
  }
}

export function createCallisthenesUnit(options: CreateCallisthenesUnitOptions = {}) {
  const env = options.env ?? process.env;
  const storage = new ChassisStorage({
    dataDir: options.dataDir,
    vaultEncryptionKey: env.CHASSIS_VAULT_MASTER_KEY,
  });
  const tenantStore = options.tenantStore ?? createSqliteTenantStore({ dataDir: storage.dataDir, busyTimeoutMs: 30_000 });
  const engineUrl = (options.customer?.engineUrl || env.CALLISTHENES_ENGINE_URL || "http://calli-engine:8000").replace(/\/$/, "");
  const fetcher = options.fetcher ?? fetch;
  const pendingTtl = Number(env.CALLISTHENES_PENDING_ACTION_TTL_MS);
  const dispatchLease = Number(env.CALLISTHENES_DISPATCH_LEASE_MS);
  const observationLedger = new CallisthenesObservationLedger(storage.dataDir, {
    ...(Number.isFinite(pendingTtl) && pendingTtl > 0 ? { pendingTtlMs: pendingTtl } : {}),
    ...(Number.isFinite(dispatchLease) && dispatchLease > 0 ? { dispatchLeaseMs: dispatchLease } : {}),
  });
  const customer = createCallisthenesCustomerLayer(
    { dataDir: storage.dataDir },
    { ...options.customer, env, tenantStore, engineUrl, observationLedger },
  );
  const app = new Hono<{ Bindings: HttpBindings }>();

  async function forwardMcp(c: Context<{ Bindings: HttpBindings }>): Promise<Response> {
    const authorization = c.req.header("authorization") ?? "";
    const [scheme, headerToken = ""] = authorization.split(/\s+/, 2);
    const bearer = scheme?.toLowerCase() === "bearer" ? headerToken.trim() : "";
    const pathToken = c.req.path.startsWith("/mcp/")
      ? decodeURIComponent(c.req.path.slice("/mcp/".length).split("/")[0] ?? "")
      : "";
    if (bearer && pathToken && bearer !== pathToken) {
      return c.json({ error: "conflicting tenant credentials" }, 401);
    }
    const token = bearer || pathToken;
    if (!token) return c.json({ error: "unauthorized" }, 401);
    const record = await tenantStore.resolveTokenHash(hashToken(token));
    if (!record || (record.status ?? "active") !== "active") return c.json({ error: "unauthorized" }, 401);

    const headers = new Headers(c.req.raw.headers);
    headers.delete("cookie");
    headers.set("authorization", `Bearer ${token}`);
    const target = new URL(`${engineUrl}/mcp`);
    target.search = new URL(c.req.url).search;
    const body = c.req.method === "GET" || c.req.method === "HEAD" ? "" : await c.req.text();
    const rpc = parseRpc(body);

    if (rpc?.method === "tools/call" && rpc.params?.name === "approve_send") {
      observationLedger.observeCall(record.tenant.id, "");
      return approveSend(rpc, record.tenant.id, target, headers);
    }
    if (rpc?.method === "tools/call" && rpc.params?.name === "reconcile_send") {
      observationLedger.observeCall(record.tenant.id, "");
      return reconcileSend(rpc, record.tenant.id, target, headers);
    }

    let forwardedBody = body;
    if (rpc?.method === "tools/call" && rpc.params?.name === "createPosts") {
      const approvalArg = env.CALLISTHENES_APPROVE_ARG?.trim() || "callisthenes_approve";
      const originalArgs = rpc.params.arguments ?? {};
      if (Object.hasOwn(originalArgs, approvalArg) || Object.hasOwn(originalArgs, "callisthenes_approve")) {
        const safeArgs = { ...originalArgs };
        delete safeArgs[approvalArg];
        delete safeArgs.callisthenes_approve;
        forwardedBody = JSON.stringify({ ...rpc, params: { ...rpc.params, arguments: safeArgs } });
        headers.delete("content-length");
      }
    }
    const response = await fetcher(target, {
      method: c.req.method,
      headers,
      ...(forwardedBody ? { body: forwardedBody } : {}),
    } as RequestInit);
    if (!rpc) return new Response(response.body, { status: response.status, headers: response.headers });
    const responseText = await response.text();
    const payload = parseRpcResponse(responseText);
    if (!payload) return new Response(responseText, { status: response.status, headers: response.headers });
    if (rpc.method === "tools/list" && payload.result?.tools) {
      if (!payload.result.tools.some((tool) => tool.name === "approve_send")) payload.result.tools.push(APPROVE_SEND_TOOL);
      if (!payload.result.tools.some((tool) => tool.name === "reconcile_send")) payload.result.tools.push(RECONCILE_SEND_TOOL);
      payload.result.tools = payload.result.tools.map((tool) =>
        describePublicTool(tool, env.CALLISTHENES_APPROVE_ARG?.trim() || "callisthenes_approve")
      );
    }
    if (rpc.method === "tools/call") {
      const text = resultText(payload);
      observationLedger.observeCall(record.tenant.id, text);
      const args = rpc.params?.arguments ?? {};
      if (rpc.params?.name === "createPosts" && text.includes("[draft_not_approved]")) {
        const proposed = String(args.text ?? "");
        if (proposed.trim()) {
          const held = observationLedger.hold(record.tenant.id, proposed);
          const heldMarker = `[held_action] action_id=${held.id} expires_at=${held.expires_at}`;
          const firstText = payload.result?.content?.find((item) => item.type === "text" && typeof item.text === "string");
          if (firstText) firstText.text = `${firstText.text}\n${heldMarker}`;
        }
      }
    }
    const outgoing = new Headers();
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) outgoing.set("mcp-session-id", sessionId);
    return Response.json(payload, { status: response.status, headers: outgoing });
  }

  async function approveSend(
    rpc: RpcRequest,
    tenantId: string,
    target: URL,
    headers: Headers,
  ): Promise<Response> {
    const args = rpc.params?.arguments ?? {};
    const channel = String(args.channel ?? "").trim().toLowerCase();
    if (!channel) return rpcText(rpc.id, renderNothingPendingToApprove());
    if (!(["x", "reddit", "email"] as const).includes(channel as "x" | "reddit" | "email")) {
      return rpcText(rpc.id, renderNothingPendingToApprove());
    }
    if (channel !== "x") return rpcText(rpc.id, renderApproveAffordance(channel as "reddit" | "email"));
    const text = String(args.text ?? args.content ?? args.body ?? "");
    if (!text.trim()) return rpcText(rpc.id, renderApproveAffordance("x"));
    const actionId = String(args.action_id ?? args.actionId ?? "").trim() || undefined;
    const approval = { ...(actionId ? { actionId } : {}), text };
    let claim = observationLedger.claim(tenantId, approval);
    if (claim.state === "sent") return rpcText(rpc.id, claim.receipt.text);
    if (claim.state === "unknown") return rpcText(rpc.id, unknownPublication(claim.action.id, claim.action.unknown_reason));
    if (claim.state === "deferred") return rpcText(rpc.id, publicationDeferred(claim.action));
    if (claim.state === "missing") return rpcText(rpc.id, renderNothingPendingToApprove());
    if (claim.state === "dispatching") {
      const waitMs = Math.max(100, Number(env.CALLISTHENES_CONCURRENT_WAIT_MS) || 10_000);
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        claim = observationLedger.publicationState(tenantId, approval);
        if (claim.state === "sent") return rpcText(rpc.id, claim.receipt.text);
        if (claim.state === "unknown") return rpcText(rpc.id, unknownPublication(claim.action.id, claim.action.unknown_reason));
        if (claim.state === "deferred") return rpcText(rpc.id, publicationDeferred(claim.action));
        if (claim.state !== "dispatching") return rpcText(rpc.id, renderNothingPendingToApprove());
      }
      return rpcText(rpc.id, publicationInProgress(claim.action.id));
    }
    const held = claim.action;
    const owner = claim.owner;

    const approveValue = env.CALLISTHENES_APPROVE_TOKEN?.trim() || true;
    const engineRpc: RpcRequest = {
      jsonrpc: "2.0",
      id: rpc.id,
      method: "tools/call",
      params: {
        name: "createPosts",
        arguments: {
          text,
          [env.CALLISTHENES_APPROVE_ARG?.trim() || "callisthenes_approve"]: approveValue,
        },
      },
    };
    // The public approve_send envelope and the rewritten createPosts envelope do
    // not have the same byte length. Never forward the caller's Content-Length;
    // undici must calculate it for the rewritten body or the engine receives a
    // truncated request and closes the socket before dispatching the tool.
    const engineHeaders = new Headers(headers);
    engineHeaders.delete("content-length");
    try {
      const response = await fetcher(target, { method: "POST", headers: engineHeaders, body: JSON.stringify(engineRpc) });
      const payload = parseRpcResponse(await response.text());
      if (!response.ok || !payload) {
        observationLedger.markUnknown(tenantId, held.id, owner, !response.ok ? `upstream HTTP ${response.status}` : "unreadable MCP result");
        return rpcText(rpc.id, unknownPublication(held.id), response.headers);
      }
      const raw = resultText(payload);
      if (raw.includes("[throttle_exceeded]")) {
        const retryMs = Math.max(1_000, Number(env.CALLISTHENES_THROTTLE_RETRY_MS) || 60 * 60 * 1_000);
        observationLedger.markDeferred(tenantId, held.id, owner, raw, new Date(Date.now() + retryMs), true);
        return rpcText(rpc.id, raw, response.headers);
      }
      if (raw.includes("[draft_not_approved]")) {
        const retryMs = Math.max(1_000, Number(env.CALLISTHENES_GUARD_RETRY_MS) || 5 * 60 * 1_000);
        observationLedger.markDeferred(tenantId, held.id, owner, raw, new Date(Date.now() + retryMs));
        return rpcText(rpc.id, raw, response.headers);
      }
      const receipt = parseOutboundReceipt("x", raw);
      const rendered = renderOutboundReceipt(receipt);
      if (!receipt.verified || !receipt.url) {
        observationLedger.markUnknown(tenantId, held.id, owner, "upstream result did not contain a verified canonical receipt");
        return rpcText(rpc.id, unknownPublication(held.id), response.headers);
      }
      return rpcText(rpc.id, observationLedger.recordReceipt(tenantId, held.id, owner, rendered, receipt.url).text, response.headers);
    } catch (error) {
      observationLedger.markUnknown(tenantId, held.id, owner, error instanceof Error ? error.message : "upstream transport failure");
      return rpcText(rpc.id, unknownPublication(held.id));
    }
  }

  async function reconcileSend(
    rpc: RpcRequest,
    tenantId: string,
    target: URL,
    headers: Headers,
  ): Promise<Response> {
    const args = rpc.params?.arguments ?? {};
    const actionId = String(args.action_id ?? args.actionId ?? "").trim();
    const text = String(args.text ?? "");
    const postId = String(args.post_id ?? args.postId ?? "").trim();
    const approval = { actionId, text };
    const state = observationLedger.publicationState(tenantId, approval);
    if (state.state === "sent") return rpcText(rpc.id, state.receipt.text);
    if (state.state !== "unknown" || !/^\d+$/.test(postId)) return rpcText(rpc.id, renderNothingPendingToApprove());
    const engineHeaders = new Headers(headers);
    engineHeaders.delete("content-length");
    try {
      const providerRead = async (name: string, arguments_: Record<string, unknown>) => {
        const request: RpcRequest = { jsonrpc: "2.0", id: rpc.id, method: "tools/call", params: { name, arguments: arguments_ } };
        const response = await fetcher(target, { method: "POST", headers: engineHeaders, body: JSON.stringify(request) });
        const payload = parseRpcResponse(await response.text());
        return { response, raw: payload ? resultText(payload) : "" };
      };
      const identityRead = await providerRead("getUsersMe", {});
      const connectedUserId = identityRead.response.ok ? extractUserId(identityRead.raw) : null;
      const { response, raw } = await providerRead("getPostsById", { id: postId });
      const post = response.ok ? extractPost(raw) : null;
      const createdAt = post ? new Date(post.createdAt).getTime() : Number.NaN;
      const windowStart = new Date(state.action.dispatch_started_at ?? "").getTime() - 5_000;
      const windowEnd = new Date(state.action.unknown_at ?? "").getTime() + 60_000;
      if (!connectedUserId || !post || post.authorId !== connectedUserId || post.id !== postId || post.text !== text || !Number.isFinite(createdAt) || !Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || createdAt < windowStart || createdAt > windowEnd) {
        return rpcText(rpc.id, unknownPublication(actionId, "Provider reads did not prove an exact post by this connected account in this action's dispatch window"), response.headers);
      }
      const url = `https://x.com/i/web/status/${postId}`;
      const rendered = renderOutboundReceipt(parseOutboundReceipt("x", JSON.stringify({ data: { id: postId } })));
      const receipt = observationLedger.reconcileSent(tenantId, approval, rendered, url);
      return rpcText(rpc.id, receipt?.text ?? unknownPublication(actionId), response.headers);
    } catch {
      return rpcText(rpc.id, unknownPublication(actionId, "Provider reconciliation failed"));
    }
  }

  app.get("/healthz", (c) => c.json({ status: "ok", name: "callisthenes", sha: resolvedGitSha() }));
  app.get("/api/health", (c) => c.json({ status: "ok", name: "callisthenes", sha: resolvedGitSha() }));
  app.route("/", customer.app);

  app.all("/mcp", forwardMcp);
  app.all("/mcp/*", forwardMcp);

  mountStaticSurfaces(app, {
    webDist: options.webDist,
    siteDist: options.siteDist,
    publicSiteHost: "calli.zenod.dev",
  });

  return {
    app,
    storage,
    tenantStore,
    customerAccounts: customer.accounts,
    customerTokenVault: customer.tokenVault,
    observationLedger,
    close() {
      observationLedger.close();
      if ("close" in tenantStore && typeof tenantStore.close === "function") tenantStore.close();
    },
  };
}
