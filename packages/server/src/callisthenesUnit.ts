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
  const observationLedger = new CallisthenesObservationLedger(storage.dataDir, {
    ...(Number.isFinite(pendingTtl) && pendingTtl > 0 ? { pendingTtlMs: pendingTtl } : {}),
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
    const held = observationLedger.resolve(tenantId, approval);
    if (!held) {
      const replay = observationLedger.replayReceipt(tenantId, approval);
      return rpcText(rpc.id, replay?.text ?? renderNothingPendingToApprove());
    }

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
    const response = await fetcher(target, { method: "POST", headers: engineHeaders, body: JSON.stringify(engineRpc) });
    const payload = parseRpcResponse(await response.text());
    if (!payload) return rpcText(rpc.id, "FAILED to send to X (Twitter): the engine returned no readable MCP result. Do NOT tell the user it was sent.", response.headers);
    const raw = resultText(payload);
    const receipt = parseOutboundReceipt("x", raw);
    const rendered = renderOutboundReceipt(receipt);
    if (receipt.verified && receipt.url) observationLedger.recordReceipt(tenantId, held.id, rendered, receipt.url);
    return rpcText(rpc.id, rendered, response.headers);
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
      if ("close" in tenantStore && typeof tenantStore.close === "function") tenantStore.close();
    },
  };
}
