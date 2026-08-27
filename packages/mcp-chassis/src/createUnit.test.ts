import { createHash, createHmac } from "node:crypto";
import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ChassisStorage, ChassisUsageStore, createMemoryTenantStore, createSqliteTenantStore, createUnit, hashToken, type UnitContext } from "./index.js";

const servers: ServerType[] = [];
const tempDirs: string[] = [];
const TEST_VAULT_KEY = "11".repeat(32);

async function listen(
  app: ReturnType<typeof createUnit>["app"],
): Promise<string> {
  const info = await new Promise<{ port: number }>((resolve) => {
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      (address) => {
        resolve({ port: address.port });
      },
    );
    servers.push(server);
  });
  return `http://127.0.0.1:${info.port}`;
}

afterEach(async () => {
  await Promise.all([
    ...servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        }),
    ),
    ...tempDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  ]);
});

function initializeBody(id = 1, params: Record<string, unknown> = {}): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcp-chassis-test", version: "0.0.0" },
      ...params,
    },
  });
}

async function initialize(
  base: string,
  init?: RequestInit,
  path = "/mcp",
  params: Record<string, unknown> = {},
): Promise<Response> {
  const { headers, ...rest } = init ?? {};
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: initializeBody(1, params),
    ...rest,
  });
}

async function callTool(
  base: string,
  name: string,
  args: Record<string, unknown>,
  init?: RequestInit,
  path = "/mcp",
): Promise<Response> {
  const { headers, ...rest } = init ?? {};
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    ...rest,
  });
}

async function listTools(
  base: string,
  init?: RequestInit,
  path = "/mcp",
): Promise<Response> {
  const { headers, ...rest } = init ?? {};
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
      params: {},
    }),
    ...rest,
  });
}

interface McpToolCallBody {
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
  error?: unknown;
}

async function callToolResult(
  base: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<NonNullable<McpToolCallBody["result"]>> {
  const response = await callTool(base, name, args);
  expect(response.status).toBe(200);
  const body = (await response.json()) as McpToolCallBody;
  expect(body.error).toBeUndefined();
  expect(body.result).toBeDefined();
  return body.result ?? {};
}

function controlPlaneHeaders(token = "control-secret"): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function provisionTenant(
  base: string,
  body: Record<string, unknown> = {},
): Promise<Response> {
  return fetch(`${base}/api/tenants`, {
    method: "POST",
    headers: controlPlaneHeaders(),
    body: JSON.stringify(body),
  });
}

async function login(base: string, token: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();
  return cookie ?? "";
}

async function tempWebDist(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-chassis-web-"));
  tempDirs.push(dir);
  await writeFile(
    join(dir, "index.html"),
    "<!doctype html><main>chassis shell</main>",
  );
  await writeFile(join(dir, "asset.txt"), "asset");
  return dir;
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function formBody(input: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) body.set(key, value);
  return body;
}

function stripeSignature(payload: string, secret: string, timestamp = 1_720_000_000): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function postStripeWebhook(base: string, payload: string, signature: string): Promise<Response> {
  return fetch(`${base}/api/billing/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });
}

describe("createUnit", () => {
  it("serves healthz", async () => {
    const unit = createUnit({ name: "demo", version: "1.2.3" });
    const base = await listen(unit.app);

    await expect(
      fetch(`${base}/healthz`).then((r) => r.json()),
    ).resolves.toEqual({
      status: "ok",
      name: "demo",
      version: "1.2.3",
    });
  });

  it("publishes the exact tenant-neutral D16 skill manifest without auth", async () => {
    const tenants = createMemoryTenantStore([
      {
        token: "tenant-one-secret-token",
        tenant: { id: "tenant-one", name: "Tenant One" },
      },
    ]);
    const skill = {
      id: " demo.skill ",
      name: " Demo Skill ",
      version: " 4.5.6 ",
      description: " Tenant-neutral routing metadata. ",
      purpose: " File durable knowledge. ",
      whenToRoute: [" When a user wants information filed. "],
      tools: [" ingest "],
      etiquette: [" Never claim a write without a receipt. "],
      receiptExpectations: [" Mutations return a commit SHA. "],
      bundleUrl: " /.well-known/agent-skill-bundle.json ",
      tenant: { id: "tenant-one" },
      token: "tenant-one-secret-token",
      connectorCredentials: { github: "connector-secret" },
      installedDirectives: ["tenant-only directive"],
    };
    const unit = createUnit({
      name: "demo",
      version: "1.2.3",
      tenantAuth: { store: tenants },
      skill,
    });
    const base = await listen(unit.app);

    const response = await fetch(
      `${base}/.well-known/atomic-unit-skill.json?tenant_id=tenant-one`,
    );
    const manifest = await response.json();

    expect(response.status).toBe(200);
    expect(manifest).toEqual({
      schemaVersion: "1.0",
      id: "demo.skill",
      name: "Demo Skill",
      version: "4.5.6",
      description: "Tenant-neutral routing metadata.",
      purpose: "File durable knowledge.",
      whenToRoute: ["When a user wants information filed."],
      tools: ["ingest"],
      etiquette: ["Never claim a write without a receipt."],
      receiptExpectations: ["Mutations return a commit SHA."],
      unit: { name: "demo", version: "1.2.3" },
      bundle: {
        format: "zenod-agent-skill-bundle-v1",
        url: "/.well-known/agent-skill-bundle.json",
      },
    });
    expect(JSON.stringify(manifest)).not.toMatch(
      /tenant-one|secret|connectorCredentials|installedDirectives|directive/,
    );
  });

  it("returns a loud tenant-neutral 404 when no skill is declared", async () => {
    const unit = createUnit({ name: "demo", version: "1.2.3" });
    const base = await listen(unit.app);

    const response = await fetch(
      `${base}/.well-known/atomic-unit-skill.json`,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "skill manifest not configured",
    });
  });

  it("fails startup loudly when a declared skill omits required D16 fields", () => {
    expect(() =>
      createUnit({
        name: "demo",
        skill: {
          id: "demo.skill",
          name: "Demo Skill",
          purpose: "Exercise the demo unit.",
          whenToRoute: ["Use for demo-unit checks."],
          tools: [],
          etiquette: ["Return grounded results."],
          receiptExpectations: ["Mutations return evidence."],
        },
      }),
    ).toThrow("createUnit skill.tools must contain at least one item");
  });

  it("answers MCP initialize over stateless Streamable HTTP", async () => {
    const unit = createUnit({ name: "demo", version: "1.2.3" });
    const base = await listen(unit.app);

    const response = await initialize(base);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: {
          name: "demo",
          version: "1.2.3",
        },
      },
    });
  });

  it("structurally rejects silent acknowledgements from modern, legacy, updated, and unknown tools", async () => {
    const unit = createUnit({
      name: "conduct-demo",
      conduct: {
        toolKinds: {
          read: ["declared_read", "legacy_read"],
          mutate: ["declared_mutation", "updated_mutation"],
        },
      },
      tools(server) {
        server.registerTool(
          "declared_mutation",
          { annotations: { readOnlyHint: false } },
          async () => ({
            content: [{ type: "text", text: "ok" }],
            structuredContent: { status: "ok" },
          }),
        );
        server.registerTool("unknown_tool", {}, async () => ({
          content: [{ type: "text", text: "ok" }],
          structuredContent: { status: "ok" },
        }));
        server.registerTool(
          "unknown_read_hint",
          { annotations: { readOnlyHint: true } },
          async () => ({
            content: [{ type: "text", text: "ok" }],
            structuredContent: { status: "ok" },
          }),
        );
        server.registerTool(
          "declared_read",
          { annotations: { readOnlyHint: true } },
          async () => ({
            content: [{ type: "text", text: "42" }],
            structuredContent: { value: 42 },
          }),
        );
        server.tool(
          "legacy_read",
          { readOnlyHint: true },
          async () => ({
            content: [{ type: "text", text: "legacy data" }],
            structuredContent: { value: "legacy data" },
          }),
        );
        server.tool("legacy_unknown", async () => ({
          content: [{ type: "text", text: "ok" }],
          structuredContent: { status: "ok" },
        }));
        const updated = server.registerTool(
          "updated_mutation",
          { annotations: { readOnlyHint: false } },
          async () => ({
            content: [{ type: "text", text: "stored" }],
            structuredContent: {
              evidence: [{ kind: "item_updated", id: "before-update" }],
            },
          }),
        );
        updated.update({
          callback: async () => ({
            content: [{ type: "text", text: "ok" }],
            structuredContent: { status: "ok" },
          }),
        });
      },
    });
    const base = await listen(unit.app);

    for (const tool of [
      "declared_mutation",
      "unknown_tool",
      "unknown_read_hint",
      "legacy_unknown",
      "updated_mutation",
    ]) {
      const result = await callToolResult(base, tool);
      expect(result.isError, tool).toBe(true);
      expect(result.structuredContent, tool).toMatchObject({
        error: { code: "silent_ack" },
      });
    }
    await expect(callToolResult(base, "declared_read")).resolves.toMatchObject({
      structuredContent: { value: 42 },
    });
    await expect(callToolResult(base, "legacy_read")).resolves.toMatchObject({
      structuredContent: { value: "legacy data" },
    });
  });

  it("normalizes handler failures to loud structured MCP errors", async () => {
    const sentinelSecret = "provider_api_key=sentinel-secret-do-not-leak";
    const unit = createUnit({
      name: "conduct-errors",
      tools(server) {
        server.registerTool("structured_failure", {}, async () => ({
          content: [{ type: "text", text: "invalid" }],
          structuredContent: {
            error: { code: "invalid_input", message: "name is required" },
          },
        }));
        server.registerTool("thrown_failure", {}, async () => {
          throw new Error(`connector unavailable: ${sentinelSecret}`);
        });
        server.registerTool(
          "read_text_error",
          { annotations: { readOnlyHint: true } },
          async () => ({
            content: [{ type: "text", text: "failed" }],
            isError: true,
          }),
        );
      },
    });
    const base = await listen(unit.app);

    await expect(callToolResult(base, "structured_failure")).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: { code: "invalid_input", message: "name is required" },
      },
    });
    const thrown = await callToolResult(base, "thrown_failure");
    expect(thrown).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "tool_error",
          message: "Tool execution failed unexpectedly.",
        },
      },
    });
    expect(JSON.stringify(thrown.content)).not.toContain(sentinelSecret);
    expect(JSON.stringify(thrown.structuredContent)).not.toContain(
      sentinelSecret,
    );
    await expect(callToolResult(base, "read_text_error")).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: { code: "unstructured_error" },
      },
    });
  });

  it("enforces long-tool tickets, poll completions, and dispatch propagation", async () => {
    const poll = { name: "get_job_result", inputField: "ticket_id" as const };
    const unit = createUnit({
      name: "conduct-long-tools",
      conduct: {
        toolKinds: { read: ["get_job_result"] },
        longTools: {
          run_job: { pollTool: "get_job_result" },
          hybrid_job: { pollTool: "get_job_result", allowSynchronousResult: true },
          hybrid_missing_status_ticket: { pollTool: "get_job_result", allowSynchronousResult: true },
          hybrid_missing_state_ticket: { pollTool: "get_job_result", allowSynchronousResult: true },
          hybrid_blank_ticket: { pollTool: "get_job_result", allowSynchronousResult: true },
          hybrid_non_string_ticket: { pollTool: "get_job_result", allowSynchronousResult: true },
          missing_poll_contract: { pollTool: "get_job_result" },
          wrong_poll_contract: { pollTool: "get_job_result" },
          dispatch_job: { pollTool: "get_job_result", dispatch: true },
        },
      },
      tools(server) {
        server.registerTool(
          "run_job",
          { inputSchema: {}, annotations: { readOnlyHint: false } },
          async () => ({
            content: [{ type: "text", text: "accepted" }],
            structuredContent: {
              ticket_id: "job-good",
              status: "accepted",
              poll,
            },
          }),
        );
        server.registerTool(
          "hybrid_job",
          {
            inputSchema: { durable: z.boolean().optional() },
            annotations: { readOnlyHint: false },
          },
          async ({ durable }) => durable
            ? {
                content: [{ type: "text", text: "accepted" }],
                structuredContent: { ticket_id: "hybrid-1", status: "accepted", poll },
              }
            : {
                content: [{ type: "text", text: "completed synchronously" }],
                structuredContent: {
                  result: "completed synchronously",
                  evidence: [{ kind: "hybrid_completed", id: "hybrid-sync" }],
                },
              },
        );
        server.registerTool(
          "hybrid_missing_status_ticket",
          { inputSchema: {}, annotations: { readOnlyHint: false } },
          async () => ({
            content: [{ type: "text", text: "accepted" }],
            structuredContent: { status: "accepted", poll },
          }),
        );
        server.registerTool(
          "hybrid_missing_state_ticket",
          { inputSchema: {}, annotations: { readOnlyHint: false } },
          async () => ({
            content: [{ type: "text", text: "accepted" }],
            structuredContent: { state: "accepted", poll },
          }),
        );
        server.registerTool(
          "hybrid_blank_ticket",
          { inputSchema: {}, annotations: { readOnlyHint: false } },
          async () => ({
            content: [{ type: "text", text: "accepted" }],
            structuredContent: {
              ticket_id: "",
              evidence: [{ kind: "hybrid_completed", id: "must-not-pass-sync" }],
            },
          }),
        );
        server.registerTool(
          "hybrid_non_string_ticket",
          { inputSchema: {}, annotations: { readOnlyHint: false } },
          async () => ({
            content: [{ type: "text", text: "accepted" }],
            structuredContent: {
              ticket_id: 7,
              evidence: [{ kind: "hybrid_completed", id: "must-not-pass-sync" }],
            },
          }),
        );
        server.registerTool(
          "missing_poll_contract",
          { inputSchema: {}, annotations: { readOnlyHint: false } },
          async () => ({
            content: [{ type: "text", text: "accepted" }],
            structuredContent: { ticket_id: "job-no-poll", status: "accepted" },
          }),
        );
        server.registerTool(
          "wrong_poll_contract",
          { inputSchema: {}, annotations: { readOnlyHint: false } },
          async () => ({
            content: [{ type: "text", text: "accepted" }],
            structuredContent: {
              ticket_id: "job-wrong-poll",
              status: "accepted",
              poll: { name: "some_other_poll", inputField: "ticket_id" },
            },
          }),
        );
        server.registerTool(
          "undeclared_long_tool",
          { inputSchema: {}, annotations: { readOnlyHint: false } },
          async () => ({
            content: [{ type: "text", text: "accepted" }],
            structuredContent: {
              ticket_id: "job-undeclared",
              status: "accepted",
              poll,
            },
          }),
        );
        server.registerTool(
          "dispatch_job",
          {
            inputSchema: {
              origin_ticket_id: z.string().optional(),
              depth: z.number().int().optional(),
            },
            annotations: { readOnlyHint: false },
          },
          async ({ origin_ticket_id, depth }) => ({
            content: [{ type: "text", text: "accepted" }],
            structuredContent: {
              ticket_id: "dispatch-1",
              status: "accepted",
              origin_ticket_id:
                origin_ticket_id === "mismatched-origin"
                  ? "different-origin"
                  : origin_ticket_id,
              depth: (depth ?? 0) + 1,
              poll,
            },
          }),
        );
        server.registerTool(
          "get_job_result",
          {
            inputSchema: { ticket_id: z.string().min(1) },
            annotations: { readOnlyHint: true },
          },
          async ({ ticket_id }) => {
            if (ticket_id === "job-running") {
              return {
                content: [{ type: "text", text: "running" }],
                structuredContent: { ticket_id, state: "running" },
              };
            }
            if (ticket_id === "job-mismatch") {
              return {
                content: [{ type: "text", text: "done" }],
                structuredContent: {
                  ticket_id: "some-other-job",
                  state: "done",
                  evidence: [{ kind: "job_completed", id: "some-other-job" }],
                },
              };
            }
            if (ticket_id === "job-error-mismatch") {
              return {
                content: [{ type: "text", text: "failed" }],
                structuredContent: {
                  ticket_id: "some-other-job",
                  state: "error",
                  error: { code: "job_failed", message: "job failed" },
                },
                isError: true,
              };
            }
            return {
              content: [{ type: "text", text: "done" }],
              structuredContent: {
                ticket_id,
                state: "done",
                ...(ticket_id === "job-no-evidence"
                  ? {}
                  : { evidence: [{ kind: "job_completed", id: ticket_id }] }),
              },
            };
          },
        );
      },
    });
    const base = await listen(unit.app);

    await expect(callToolResult(base, "run_job")).resolves.toMatchObject({
      structuredContent: { ticket_id: "job-good", status: "accepted" },
    });
    await expect(callToolResult(base, "hybrid_job", { durable: true })).resolves.toMatchObject({
      structuredContent: { ticket_id: "hybrid-1", status: "accepted" },
    });
    await expect(callToolResult(base, "hybrid_job")).resolves.toMatchObject({
      structuredContent: { result: "completed synchronously" },
    });
    for (const toolName of [
      "hybrid_missing_status_ticket",
      "hybrid_missing_state_ticket",
      "hybrid_blank_ticket",
      "hybrid_non_string_ticket",
    ]) {
      await expect(callToolResult(base, toolName)).resolves.toMatchObject({
        isError: true,
        structuredContent: { error: { code: "missing_accepted_ticket" } },
      });
    }
    await expect(callToolResult(base, "missing_poll_contract")).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "missing_poll_tool" } },
    });
    await expect(callToolResult(base, "wrong_poll_contract")).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "poll_mismatch" } },
    });
    await expect(callToolResult(base, "undeclared_long_tool")).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "undeclared_long_tool" } },
    });
    await expect(
      callToolResult(base, "dispatch_job", {
        origin_ticket_id: "origin-1",
        depth: 0,
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        origin_ticket_id: "origin-1",
        depth: 1,
      },
    });
    await expect(callToolResult(base, "dispatch_job", {})).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "missing_origin_ticket_id" } },
    });
    await expect(
      callToolResult(base, "dispatch_job", {
        origin_ticket_id: "mismatched-origin",
        depth: 0,
      }),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "origin_ticket_mismatch" } },
    });
    await expect(
      callToolResult(base, "dispatch_job", {
        origin_ticket_id: "origin-1",
        depth: 1,
      }),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "dispatch_depth_exceeded" } },
    });
    await expect(
      callToolResult(base, "get_job_result", { ticket_id: "job-running" }),
    ).resolves.toMatchObject({
      structuredContent: { ticket_id: "job-running", state: "running" },
    });
    await expect(
      callToolResult(base, "get_job_result", { ticket_id: "job-mismatch" }),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "ticket_mismatch" } },
    });
    await expect(
      callToolResult(base, "get_job_result", {
        ticket_id: "job-error-mismatch",
      }),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "ticket_mismatch" } },
    });
    await expect(
      callToolResult(base, "get_job_result", { ticket_id: "job-no-evidence" }),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: { code: "completion_without_evidence" } },
    });
  });

  it("fails registration closed when a declared long tool has no poll tool", async () => {
    const unit = createUnit({
      name: "conduct-missing-poll",
      conduct: {
        longTools: { run_job: { pollTool: "get_job_result" } },
      },
      tools(server) {
        server.registerTool("run_job", {}, async () => ({
          content: [{ type: "text", text: "accepted" }],
          structuredContent: {
            ticket_id: "job-1",
            status: "accepted",
            poll: { name: "get_job_result", inputField: "ticket_id" },
          },
        }));
      },
    });
    const base = await listen(unit.app);
    unit.app.onError((error, c) =>
      c.json(
        {
          error: error instanceof Error ? error.name : "unknown",
          message: error instanceof Error ? error.message : String(error),
        },
        500,
      ),
    );

    const response = await initialize(base);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "ConductContractError",
      message: expect.stringContaining("requires registered poll tool"),
    });
  });

  it("fails closed when experimental SDK tasks try to bypass conduct registration", async () => {
    const unit = createUnit({
      name: "conduct-sdk-task",
      tools(server) {
        server.experimental.tasks.registerToolTask(
          "sdk_task",
          {},
          {} as never,
        );
      },
    });
    unit.app.onError((error, c) =>
      c.json(
        {
          error: error instanceof Error ? error.name : "unknown",
          code:
            error && typeof error === "object" && "code" in error
              ? error.code
              : null,
          message: error instanceof Error ? error.message : String(error),
        },
        500,
      ),
    );
    const base = await listen(unit.app);

    const response = await initialize(base);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "ConductContractError",
      code: "unsupported_task_registration",
      message: expect.stringContaining("conduct.longTools"),
    });
  });

  it("stores only token hashes in the memory tenant table", () => {
    const tenants = createMemoryTenantStore([
      { token: "raw-secret-token", tenant: { id: "tenant-a" } },
    ]);

    expect(tenants.snapshot()).toEqual([
      {
        tokenHash: hashToken("raw-secret-token"),
        tenant: { id: "tenant-a" },
        status: "active",
        expiresAt: null,
      },
    ]);
    expect(JSON.stringify(tenants.snapshot())).not.toContain(
      "raw-secret-token",
    );
  });

  it("resolves bearer and tokened MCP URL auth to tenant context for tools", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-auth-storage-"));
    tempDirs.push(dataDir);
    const seenTenants: Array<string | null> = [];
    const tenants = createMemoryTenantStore([
      {
        token: "tenant-one-token",
        tenant: { id: "tenant-one", name: "Tenant One" },
      },
      {
        token: "tenant-two-token",
        tenant: { id: "tenant-two", name: "Tenant Two" },
      },
    ]);
    const unit = createUnit({
      name: "demo",
      version: "1.2.3",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      tools(_server, context) {
        seenTenants.push(context.tenant?.id ?? null);
      },
    });
    const base = await listen(unit.app);

    const bearerResponse = await initialize(base, {
      headers: { authorization: "Bearer tenant-one-token" },
    });
    const urlResponse = await initialize(
      base,
      undefined,
      "/mcp/tenant-two-token",
    );

    expect(bearerResponse.status).toBe(200);
    expect(urlResponse.status).toBe(200);
    expect(seenTenants).toEqual(["tenant-one", "tenant-two"]);
  });

  it("rejects unknown or mutated tenant tokens with WWW-Authenticate", async () => {
    const tenants = createMemoryTenantStore([
      { token: "known-token", tenant: { id: "tenant-a" } },
    ]);
    const unit = createUnit({ name: "demo", tenantAuth: { store: tenants } });
    const base = await listen(unit.app);

    const unknown = await initialize(base, {
      headers: { authorization: "Bearer unknown-token" },
    });
    const mutated = await initialize(
      base,
      undefined,
      "/mcp/known-token-mutated",
    );

    expect(unknown.status).toBe(401);
    expect(mutated.status).toBe(401);
    expect(unknown.headers.get("www-authenticate")).toBe(
      'Bearer realm="mcp-chassis", error="invalid_token"',
    );
    expect(mutated.headers.get("www-authenticate")).toBe(
      'Bearer realm="mcp-chassis", error="invalid_token"',
    );
    await expect(unknown.json()).resolves.toEqual({ error: "unauthorized" });
    await expect(mutated.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("guards POST /api/tenants and mints one raw token without storing it", async () => {
    const tenants = createMemoryTenantStore();
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      controlPlane: { store: tenants, token: "control-secret" },
    });
    const base = await listen(unit.app);

    const unauthorized = await fetch(`${base}/api/tenants`, { method: "POST" });
    const created = await provisionTenant(base, {
      tenantId: "tenant-a",
      name: "Tenant A",
      plan: "pro",
    });

    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe(
      'Bearer realm="mcp-chassis-control-plane", error="invalid_token"',
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body).toMatchObject({
      tenant: { id: "tenant-a", name: "Tenant A", plan: "pro" },
      status: "active",
    });
    expect(body.token).toMatch(/^zenod_[a-f0-9]{48}$/);
    expect(tenants.snapshot()).toEqual([
      {
        tokenHash: hashToken(body.token),
        tenant: { id: "tenant-a", name: "Tenant A", plan: "pro" },
        status: "active",
        expiresAt: null,
      },
    ]);
    expect(JSON.stringify(tenants.snapshot())).not.toContain(body.token);

    const mcp = await initialize(base, {
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(mcp.status).toBe(200);
  });

  it("issues replaceable profile tokens that enforce list and call on hosted paths", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "mcp-chassis-profile-token-route-"),
    );
    tempDirs.push(dataDir);
    const tenants = createMemoryTenantStore();
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      storage: { dataDir, vaultEncryptionKey: TEST_VAULT_KEY },
      controlPlane: { store: tenants, token: "control-secret" },
      ui: { sessionSecret: "profile-route-session-secret" },
      toolProfiles: { "memory-channel": ["read_memory"] },
      conduct: { toolKinds: { read: ["read_memory"] } },
      tools(server) {
        server.registerTool("read_memory", {}, async () => ({
          content: [{ type: "text", text: "memory read" }],
        }));
        server.registerTool("full_surface", {}, async () => ({
          content: [{ type: "text", text: "full surface" }],
        }));
      },
      routes(routes) {
        routes.post("/api/danger", (c) =>
          c.json({ ok: true, tenant: c.get("unitContext").tenant }),
        );
      },
    });
    const base = await listen(unit.app);
    const tenant = await provisionTenant(base, { tenantId: "tenant-a" }).then(
      (response) => response.json(),
    );
    const issueProfileToken = () =>
      fetch(`${base}/api/tenants/tenant-a/tokens`, {
        method: "POST",
        headers: controlPlaneHeaders(),
        body: JSON.stringify({ profile: "memory-channel" }),
      });
    const unauthorizedIssue = await fetch(
      `${base}/api/tenants/tenant-a/tokens`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: "memory-channel" }),
      },
    );
    const firstResponse = await issueProfileToken();
    const first = await firstResponse.json();

    expect(unauthorizedIssue.status).toBe(401);
    expect(firstResponse.status).toBe(200);
    expect(first).toMatchObject({
      tenant: { id: "tenant-a" },
      status: "active",
      profile: "memory-channel",
      mcpPath: `/mcp/${first.token}`,
    });
    expect(first.token).toMatch(/^zenod_[a-f0-9]{48}$/);

    const profiledApi = await fetch(`${base}/api/danger`, {
      method: "POST",
      headers: { authorization: `Bearer ${first.token}` },
    });
    expect(profiledApi.status).toBe(401);
    const profiledUiBearer = await fetch(`${base}/api/settings`, {
      headers: { authorization: `Bearer ${first.token}` },
    });
    expect(profiledUiBearer.status).toBe(401);
    const profiledLogin = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: first.token }),
    });
    expect(profiledLogin.status).toBe(401);
    expect(profiledLogin.headers.get("set-cookie")).toBeNull();

    const primaryApi = await fetch(`${base}/api/danger`, {
      method: "POST",
      headers: { authorization: `Bearer ${tenant.token}` },
    });
    expect(primaryApi.status).toBe(200);
    const primaryLogin = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: tenant.token }),
    });
    expect(primaryLogin.status).toBe(200);
    const sessionCookie = primaryLogin.headers.get("set-cookie")?.split(";")[0];
    expect(sessionCookie).toBeTruthy();
    const sessionApi = await fetch(`${base}/api/danger`, {
      method: "POST",
      headers: { cookie: sessionCookie ?? "" },
    });
    expect(sessionApi.status).toBe(200);

    const primaryList = await listTools(
      base,
      { headers: { authorization: `Bearer ${tenant.token}` } },
      `/mcp/${tenant.token}`,
    ).then((response) => response.json());
    expect(primaryList.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining([
        "install_operating_directive",
        "read_memory",
        "full_surface",
      ]),
    );

    const scopedInit = {
      headers: { authorization: `Bearer ${first.token}` },
    };
    const scopedList = await listTools(
      base,
      scopedInit,
      `/mcp/${first.token}`,
    ).then((response) => response.json());
    expect(scopedList.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "read_memory",
    ]);
    const allowed = await callTool(
      base,
      "read_memory",
      {},
      scopedInit,
      `/mcp/${first.token}`,
    ).then((response) => response.json());
    expect(allowed.result.content).toEqual([
      { type: "text", text: "memory read" },
    ]);
    const denied = await callTool(
      base,
      "full_surface",
      {},
      scopedInit,
      `/mcp/${first.token}`,
    ).then((response) => response.json());
    expect(denied.result.isError).toBe(true);
    expect(JSON.stringify(denied)).toMatch(/not found/i);

    const second = await issueProfileToken().then((response) => response.json());
    expect(second.token).not.toBe(first.token);
    await expect(
      initialize(
        base,
        { headers: { authorization: `Bearer ${first.token}` } },
        `/mcp/${first.token}`,
      ),
    ).resolves.toHaveProperty("status", 401);
    await expect(
      initialize(
        base,
        { headers: { authorization: `Bearer ${second.token}` } },
        `/mcp/${second.token}`,
      ),
    ).resolves.toHaveProperty("status", 200);

    const unknown = await fetch(`${base}/api/tenants/tenant-a/tokens`, {
      method: "POST",
      headers: controlPlaneHeaders(),
      body: JSON.stringify({ profile: "unknown-profile" }),
    }).then((response) => response.json());
    const unknownList = await listTools(
      base,
      { headers: { authorization: `Bearer ${unknown.token}` } },
      `/mcp/${unknown.token}`,
    ).then((response) => response.json());
    expect(unknownList.result.tools).toEqual([]);
    const unknownCall = await callTool(
      base,
      "read_memory",
      {},
      { headers: { authorization: `Bearer ${unknown.token}` } },
      `/mcp/${unknown.token}`,
    ).then((response) => response.json());
    expect(unknownCall.result.isError).toBe(true);

    const tampered = `${second.token.slice(0, -1)}x`;
    await expect(
      initialize(
        base,
        { headers: { authorization: `Bearer ${tampered}` } },
        `/mcp/${tampered}`,
      ),
    ).resolves.toHaveProperty("status", 401);

    tenants.setTenantStatus("tenant-a", "suspended");
    await expect(
      initialize(
        base,
        { headers: { authorization: `Bearer ${second.token}` } },
        `/mcp/${second.token}`,
      ),
    ).resolves.toHaveProperty("status", 401);
  });

  it("rejects suspended and deleted tenants during MCP auth", async () => {
    const tenants = createMemoryTenantStore();
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      controlPlane: { store: tenants, token: "control-secret" },
    });
    const base = await listen(unit.app);
    const first = await provisionTenant(base, { tenantId: "tenant-a" }).then(
      (r) => r.json(),
    );
    const second = await provisionTenant(base, { tenantId: "tenant-b" }).then(
      (r) => r.json(),
    );

    const suspended = await fetch(`${base}/api/tenants/tenant-a`, {
      method: "PATCH",
      headers: controlPlaneHeaders(),
      body: JSON.stringify({ status: "suspended" }),
    });
    const deleted = await fetch(`${base}/api/tenants/tenant-b`, {
      method: "DELETE",
      headers: controlPlaneHeaders(),
    });

    expect(suspended.status).toBe(200);
    await expect(suspended.json()).resolves.toEqual({
      tenant: { id: "tenant-a" },
      status: "suspended",
    });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({
      tenant: { id: "tenant-b" },
      status: "deleted",
    });
    await expect(
      initialize(base, { headers: { authorization: `Bearer ${first.token}` } }),
    ).resolves.toHaveProperty("status", 401);
    await expect(
      initialize(base, {
        headers: { authorization: `Bearer ${second.token}` },
      }),
    ).resolves.toHaveProperty("status", 401);
  });

  it("rotates tenant tokens and invalidates the old token", async () => {
    const tenants = createMemoryTenantStore();
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      controlPlane: { store: tenants, token: "control-secret" },
    });
    const base = await listen(unit.app);
    const created = await provisionTenant(base, { tenantId: "tenant-a" }).then(
      (r) => r.json(),
    );

    const rotatedResponse = await fetch(
      `${base}/api/tenants/tenant-a/token/rotate`,
      {
        method: "POST",
        headers: controlPlaneHeaders(),
      },
    );
    const rotated = await rotatedResponse.json();

    expect(rotatedResponse.status).toBe(200);
    expect(rotated.token).toMatch(/^zenod_[a-f0-9]{48}$/);
    expect(rotated.token).not.toBe(created.token);
    expect(tenants.snapshot()).toEqual([
      {
        tokenHash: hashToken(rotated.token),
        tenant: { id: "tenant-a" },
        status: "active",
        expiresAt: null,
      },
    ]);
    await expect(
      initialize(base, {
        headers: { authorization: `Bearer ${created.token}` },
      }),
    ).resolves.toHaveProperty("status", 401);
    await expect(
      initialize(base, {
        headers: { authorization: `Bearer ${rotated.token}` },
      }),
    ).resolves.toHaveProperty("status", 200);
  });

  it("binds UI token login sessions to one tenant and ignores cross-tenant URL attempts", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-ui-session-"));
    tempDirs.push(dataDir);
    const tenants = createMemoryTenantStore([
      {
        token: "tenant-one-token",
        tenant: { id: "tenant-one", name: "Tenant One" },
      },
      {
        token: "tenant-two-token",
        tenant: { id: "tenant-two", name: "Tenant Two" },
      },
    ]);
    const unit = createUnit({
      name: "demo",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      ui: {
        displayName: "Demo Unit",
        tagline: "Tenant settings",
        panels: ["keys", "connections"],
        sessionSecret: "test-session-secret",
      },
    });
    const base = await listen(unit.app);

    const tenantOneCookie = await login(base, "tenant-one-token");
    const tenantTwoCookie = await login(base, "tenant-two-token");
    const status = await fetch(`${base}/api/auth/status`, {
      headers: { cookie: tenantOneCookie },
    }).then((r) => r.json());
    const settings = await fetch(`${base}/api/settings?tenantId=tenant-two`, {
      headers: { cookie: tenantOneCookie },
    }).then((r) => r.json());
    const overview = await fetch(`${base}/api/overview`, {
      headers: { cookie: tenantTwoCookie },
    }).then((r) => r.json());
    const agent = await fetch(`${base}/api/agent`).then((r) => r.json());

    expect(status).toMatchObject({
      authenticated: true,
      tenant: { id: "tenant-one", name: "Tenant One" },
    });
    expect(settings).toMatchObject({
      tenant: { id: "tenant-one", name: "Tenant One" },
    });
    expect(JSON.stringify(settings)).not.toContain("tenant-two");
    expect(overview).toMatchObject({
      tenant: { id: "tenant-two", name: "Tenant Two" },
    });
    expect(agent).toMatchObject({
      name: "demo",
      displayName: "Demo Unit",
      tagline: "Tenant settings",
      panels: ["keys", "connections"],
    });
  });

  it("rejects protected UI routes without a tenant session or bearer token", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-ui-auth-"));
    tempDirs.push(dataDir);
    const tenants = createMemoryTenantStore([
      { token: "known-token", tenant: { id: "tenant-a" } },
    ]);
    const unit = createUnit({
      name: "demo",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      ui: { sessionSecret: "test-session-secret" },
    });
    const base = await listen(unit.app);

    const anonymous = await fetch(`${base}/api/settings`);
    const bearer = await fetch(`${base}/api/settings`, {
      headers: { authorization: "Bearer known-token" },
    });

    expect(anonymous.status).toBe(401);
    expect(bearer.status).toBe(200);
    await expect(bearer.json()).resolves.toMatchObject({
      tenant: { id: "tenant-a" },
    });
  });

  it("persists tenant settings and key metadata across restarts without cross-tenant leakage", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-settings-"));
    tempDirs.push(dataDir);
    const tenantOneToken = "tenant-one-settings-token";
    const tenantTwoToken = "tenant-two-settings-token";
    const firstTenants = createSqliteTenantStore({ dataDir });
    firstTenants.importTenantTokenHash({
      tokenHash: hashToken(tenantOneToken),
      tenant: { id: "tenant-one", name: "Tenant One" },
    });
    firstTenants.importTenantTokenHash({
      tokenHash: hashToken(tenantTwoToken),
      tenant: { id: "tenant-two", name: "Tenant Two" },
    });
    const firstUnit = createUnit({
      name: "demo",
      storage: { dataDir, vaultEncryptionKey: TEST_VAULT_KEY },
      tenantAuth: { store: firstTenants },
      ui: { sessionSecret: "durable-settings-session" },
    });
    const firstBase = await listen(firstUnit.app);

    const tenantOneSave = await fetch(
      `${firstBase}/api/settings?tenantId=tenant-two`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${tenantOneToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tenant_id: "tenant-two",
          vault_repo: "tenant-one/vault",
          github_token: "tenant-one-github-1111",
          provider: "openai",
          openai_api_key: "tenant-one-openai-2222",
          model_ask: "gpt-tenant-one",
        }),
      },
    );
    const tenantTwoSave = await fetch(`${firstBase}/api/settings`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${tenantTwoToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        vault_repo: "tenant-two/vault",
        provider: "anthropic",
        anthropic_api_key: "tenant-two-anthropic-3333",
      }),
    });

    expect(tenantOneSave.status).toBe(200);
    await expect(tenantOneSave.json()).resolves.toMatchObject({
      tenant: { id: "tenant-one" },
      settings: {
        vault_repo: "tenant-one/vault",
        provider: "openai",
        openai_api_key: "\u2022\u2022\u2022\u20222222",
        model_ask: "gpt-tenant-one",
      },
    });
    expect(tenantTwoSave.status).toBe(200);

    const tenantOneCookie = await login(firstBase, tenantOneToken);
    const [tenantOneSettings, tenantTwoSettings, tenantOneKeys, tenantTwoKeys] =
      await Promise.all([
        fetch(`${firstBase}/api/settings?tenantId=tenant-two`, {
          headers: { cookie: tenantOneCookie },
        }).then((response) => response.json()),
        fetch(`${firstBase}/api/settings`, {
          headers: { authorization: `Bearer ${tenantTwoToken}` },
        }).then((response) => response.json()),
        fetch(`${firstBase}/api/keys`, {
          headers: { authorization: `Bearer ${tenantOneToken}` },
        }).then((response) => response.json()),
        fetch(`${firstBase}/api/keys`, {
          headers: { authorization: `Bearer ${tenantTwoToken}` },
        }).then((response) => response.json()),
      ]);

    expect(tenantOneSettings).toMatchObject({
      tenant: { id: "tenant-one" },
      settings: {
        vault_repo: "tenant-one/vault",
        github_token: "\u2022\u2022\u2022\u20221111",
        openai_api_key: "\u2022\u2022\u2022\u20222222",
      },
    });
    expect(tenantTwoSettings).toMatchObject({
      tenant: { id: "tenant-two" },
      settings: {
        vault_repo: "tenant-two/vault",
        provider: "anthropic",
        anthropic_api_key: "\u2022\u2022\u2022\u20223333",
        openai_api_key: null,
      },
    });
    expect(JSON.stringify(tenantOneSettings)).not.toContain("tenant-two");
    expect(JSON.stringify(tenantTwoSettings)).not.toContain("tenant-one");
    expect(JSON.stringify({ tenantOneSettings, tenantOneKeys })).not.toContain(
      "tenant-one-openai-2222",
    );
    expect(tenantOneKeys.tenant).toMatchObject({ id: "tenant-one" });
    expect(tenantOneKeys.keys).toEqual([
      {
        id: "github_token",
        label: "GitHub token",
        configured: true,
        maskedValue: "\u2022\u2022\u2022\u20221111",
        updatedAt: expect.any(String),
      },
      {
        id: "openai_api_key",
        label: "OpenAI API key",
        configured: true,
        maskedValue: "\u2022\u2022\u2022\u20222222",
        updatedAt: expect.any(String),
      },
    ]);
    expect(tenantTwoKeys).toMatchObject({
      tenant: { id: "tenant-two" },
      keys: [
        {
          id: "anthropic_api_key",
          label: "Anthropic API key",
          configured: true,
          maskedValue: "\u2022\u2022\u2022\u20223333",
          updatedAt: expect.any(String),
        },
      ],
    });

    const invalid = await fetch(`${firstBase}/api/settings`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${tenantOneToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ provider: 42, model_ask: "must-not-persist" }),
    });
    expect(invalid.status).toBe(400);

    firstTenants.close();
    const restartedTenants = createSqliteTenantStore({ dataDir });
    const restartedUnit = createUnit({
      name: "demo",
      storage: { dataDir, vaultEncryptionKey: TEST_VAULT_KEY },
      tenantAuth: { store: restartedTenants },
      ui: { sessionSecret: "durable-settings-session" },
    });
    const restartedBase = await listen(restartedUnit.app);

    const [restartedOne, restartedTwo, restartedKeys] = await Promise.all([
      fetch(`${restartedBase}/api/settings`, {
        headers: { authorization: `Bearer ${tenantOneToken}` },
      }).then((response) => response.json()),
      fetch(`${restartedBase}/api/settings`, {
        headers: { authorization: `Bearer ${tenantTwoToken}` },
      }).then((response) => response.json()),
      fetch(`${restartedBase}/api/keys`, {
        headers: { authorization: `Bearer ${tenantOneToken}` },
      }).then((response) => response.json()),
    ]);

    expect(restartedOne).toMatchObject({
      tenant: { id: "tenant-one" },
      settings: {
        vault_repo: "tenant-one/vault",
        model_ask: "gpt-tenant-one",
        openai_api_key: "\u2022\u2022\u2022\u20222222",
      },
    });
    expect(restartedTwo).toMatchObject({
      tenant: { id: "tenant-two" },
      settings: {
        vault_repo: "tenant-two/vault",
        anthropic_api_key: "\u2022\u2022\u2022\u20223333",
      },
    });
    expect(restartedKeys.keys).toEqual(tenantOneKeys.keys);

    const maskedEcho = await fetch(`${restartedBase}/api/settings`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${tenantOneToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        openai_api_key: "\u2022\u2022\u2022\u2022tenant-one-openai-2222",
      }),
    }).then((response) => response.json());
    expect(maskedEcho.settings.openai_api_key).toBe(
      "\u2022\u2022\u2022\u20222222",
    );

    restartedTenants.close();
  });

  it("protects unit routes with bearer or session auth and injects tenant-bound context", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-unit-routes-"));
    tempDirs.push(dataDir);
    await writeFile(join(dataDir, "index.html"), "<html>SPA fallback</html>");
    const tenants = createSqliteTenantStore({ dataDir });
    tenants.importTenantTokenHash({
      tokenHash: hashToken("tenant-one-token"),
      tenant: { id: "tenant-one", name: "Tenant One" },
    });
    tenants.importTenantTokenHash({
      tokenHash: hashToken("tenant-two-token"),
      tenant: { id: "tenant-two", name: "Tenant Two" },
    });
    const unit = createUnit({
      name: "demo",
      storage: { dataDir, vaultEncryptionKey: TEST_VAULT_KEY },
      tenantAuth: { store: tenants },
      controlPlane: { store: tenants, token: "control-secret" },
      ui: {
        sessionSecret: "unit-route-session-secret",
        webDist: dataDir,
      },
      routes(routes) {
        routes.post("/api/unit-marker", async (c) => {
          const context = c.get("unitContext");
          const body = await c.req.json<{ marker?: string }>();
          const vault = context.storage.vault("unit-routes.sqlite");
          try {
            vault.set("marker", body.marker ?? "");
          } finally {
            vault.close();
          }
          return c.json({
            tenant: context.tenant,
            storageRoot: context.storage.rootDir,
            usage: context.usage?.summary() ?? null,
          });
        });
        routes.get("/api/unit-marker", (c) => {
          const context = c.get("unitContext");
          const vault = context.storage.vault("unit-routes.sqlite");
          try {
            return c.json({
              tenant: context.tenant,
              marker: vault.get("marker"),
              operatingRules: context.operatingRules,
            });
          } finally {
            vault.close();
          }
        });
      },
    });
    const base = await listen(unit.app);

    const anonymous = await fetch(`${base}/api/unit-marker`);
    const written = await fetch(`${base}/api/unit-marker?tenantId=tenant-two`, {
      method: "POST",
      headers: {
        authorization: "Bearer tenant-one-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ marker: "tenant-one-only" }),
    });
    const tenantTwo = await fetch(`${base}/api/unit-marker`, {
      headers: { authorization: "Bearer tenant-two-token" },
    });
    const tenantOneCookie = await login(base, "tenant-one-token");
    const sessionRead = await fetch(`${base}/api/unit-marker`, {
      headers: { cookie: tenantOneCookie },
    });

    expect(anonymous.status).toBe(401);
    await expect(written.json()).resolves.toMatchObject({
      tenant: { id: "tenant-one" },
      usage: { tenantId: "tenant-one" },
    });
    await expect(tenantTwo.json()).resolves.toMatchObject({
      tenant: { id: "tenant-two" },
      marker: null,
    });
    await expect(sessionRead.json()).resolves.toMatchObject({
      tenant: { id: "tenant-one" },
      marker: "tenant-one-only",
    });

    const rotated = tenants.rotateTenantToken("tenant-one");
    expect(rotated).not.toBeNull();
    await expect(
      fetch(`${base}/api/unit-marker`, {
        headers: { authorization: "Bearer tenant-one-token" },
      }),
    ).resolves.toHaveProperty("status", 401);
    await expect(
      fetch(`${base}/api/unit-marker`, {
        headers: { authorization: `Bearer ${rotated!.token}` },
      }),
    ).resolves.toHaveProperty("status", 200);
    await expect(
      fetch(`${base}/api/unit-marker`, { headers: { cookie: tenantOneCookie } }),
    ).resolves.toHaveProperty("status", 200);
    tenants.close();
  });

  it("keeps the SPA shell public when unit routes use an API wildcard", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-route-fallback-"));
    tempDirs.push(dataDir);
    await writeFile(join(dataDir, "index.html"), "<html>Public login shell</html>");
    await writeFile(join(dataDir, "asset.txt"), "public asset");
    const tenants = createMemoryTenantStore([
      { token: "known-token", tenant: { id: "tenant-a", name: "Tenant A" } },
    ]);
    const unit = createUnit({
      name: "demo",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      ui: { webDist: dataDir, sessionSecret: "route-fallback-secret" },
      routes(routes) {
        routes.all("/api/*", (c) =>
          c.json({ tenant: c.get("unitContext").tenant }),
        );
      },
    });
    const base = await listen(unit.app);
    const sessionCookie = await login(base, "known-token");

    const [root, asset, fallback, anonymousApi, bearerApi, sessionApi] =
      await Promise.all([
        fetch(`${base}/`),
        fetch(`${base}/asset.txt`),
        fetch(`${base}/not-a-real-route`),
        fetch(`${base}/api/unit-state`),
        fetch(`${base}/api/unit-state`, {
          headers: { authorization: "Bearer known-token" },
        }),
        fetch(`${base}/api/unit-state`, {
          headers: { cookie: sessionCookie },
        }),
      ]);

    expect(root.status).toBe(200);
    expect(asset.status).toBe(200);
    expect(fallback.status).toBe(200);
    await expect(root.text()).resolves.toContain("Public login shell");
    await expect(asset.text()).resolves.toBe("public asset");
    await expect(fallback.text()).resolves.toContain("Public login shell");
    expect(anonymousApi.status).toBe(401);
    await expect(bearerApi.json()).resolves.toEqual({
      tenant: { id: "tenant-a", name: "Tenant A" },
    });
    await expect(sessionApi.json()).resolves.toEqual({
      tenant: { id: "tenant-a", name: "Tenant A" },
    });
  });

  it("refuses to register unit routes without tenant auth", () => {
    expect(() =>
      createUnit({
        name: "demo",
        routes(routes) {
          routes.get("/api/unbound", (c) => c.json({ ok: true }));
        },
      }),
    ).toThrow("createUnit({ routes }) requires tenantAuth");
  });

  it("gives authenticated unit product routes precedence over UI placeholders", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-route-precedence-"));
    tempDirs.push(dataDir);
    const tenants = createMemoryTenantStore([
      { token: "known-token", tenant: { id: "tenant-a" } },
    ]);
    const unit = createUnit({
      name: "demo",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      ui: { sessionSecret: "route-precedence-secret" },
      routes(routes) {
        routes.get("/api/settings", (c) =>
          c.json({ source: "unit", tenant: c.get("unitContext").tenant }),
        );
      },
    });
    const base = await listen(unit.app);

    const response = await fetch(`${base}/api/settings`, {
      headers: { authorization: "Bearer known-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      source: "unit",
      tenant: { id: "tenant-a" },
    });
  });

  it("installs tenant directives through the seam tool and re-reads the turn preamble", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-rules-"));
    tempDirs.push(dataDir);
    const seenPreambles: Array<string | null> = [];
    const tenants = createMemoryTenantStore([
      { token: "tenant-one-token", tenant: { id: "tenant-one" } },
      { token: "tenant-two-token", tenant: { id: "tenant-two" } },
    ]);
    const unit = createUnit({
      name: "demo",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      tools(_server, context) {
        seenPreambles.push(context.operatingRules?.text ?? null);
      },
    });
    const base = await listen(unit.app);

    const installed = await callTool(
      base,
      "install_operating_directive",
      {
        id: "reply-with-receipts",
        text: "Reply only with receipt-grounded actions.",
        source: "council",
      },
      { headers: { authorization: "Bearer tenant-one-token" } },
    );
    expect(installed.status).toBe(200);
    const installedBody = await installed.json();
    expect(installedBody).toMatchObject({
      result: {
        structuredContent: {
          tenant: { id: "tenant-one" },
          directive: {
            id: "reply-with-receipts",
            source: "council",
            active: true,
          },
          evidence: [{ kind: "operating_directive", id: "reply-with-receipts" }],
        },
      },
    });

    await expect(
      initialize(base, {
        headers: { authorization: "Bearer tenant-one-token" },
      }),
    ).resolves.toHaveProperty("status", 200);
    await expect(
      initialize(base, {
        headers: { authorization: "Bearer tenant-two-token" },
      }),
    ).resolves.toHaveProperty("status", 200);

    expect(seenPreambles).toEqual([
      "No active operating directives for tenant-one.",
      expect.stringContaining("Reply only with receipt-grounded actions."),
      "No active operating directives for tenant-two.",
    ]);
  });

  it("renders operating rules, MCP config, and skills from the logged-in tenant only", async () => {
    const tenants = createMemoryTenantStore([
      {
        token: "tenant-one-token",
        tenant: { id: "tenant-one", name: "Tenant One" },
      },
      {
        token: "tenant-two-token",
        tenant: { id: "tenant-two", name: "Tenant Two" },
      },
    ]);
    const unit = createUnit({
      name: "demo",
      version: "1.2.3",
      tenantAuth: { store: tenants },
      ui: { sessionSecret: "test-session-secret" },
      oauth: { server: true },
      skill: {
        id: "demo.skill",
        name: "Demo Skill",
        version: "1.0.0",
        purpose: "Exercise the demo unit.",
        whenToRoute: ["Use for demo-unit checks."],
        tools: ["install_operating_directive"],
        etiquette: ["Follow installed operating directives."],
        receiptExpectations: ["mutations return evidence[]"],
      },
      skills: [
        {
          id: "installed.helper",
          name: "Installed Helper",
          purpose: "Represent a tenant-installed skill copy.",
          whenToRoute: ["Use for installed helper checks."],
          tools: ["helper_read"],
          etiquette: ["Keep installed edits tenant-scoped."],
          receiptExpectations: ["Reads return data or an explicit empty state."],
        },
      ],
    });
    const base = await listen(unit.app);
    const tenantOneCookie = await login(base, "tenant-one-token");
    const tenantTwoCookie = await login(base, "tenant-two-token");

    const installed = await callTool(
      base,
      "install_operating_directive",
      {
        id: "tenant-one-rule",
        text: "Tenant One rule marker.",
        source: "user",
      },
      { headers: { authorization: "Bearer tenant-one-token" } },
    );
    expect(installed.status).toBe(200);

    const tenantOneRules = await fetch(`${base}/api/operating-rules`, {
      headers: { cookie: tenantOneCookie },
    }).then((r) => r.json());
    const tenantTwoRules = await fetch(`${base}/api/operating-rules?tenantId=tenant-one`, {
      headers: { cookie: tenantTwoCookie },
    }).then((r) => r.json());
    const mcpConfig = await fetch(`${base}/api/mcp-config`, {
      headers: { cookie: tenantOneCookie },
    }).then((r) => r.json());
    const skills = await fetch(`${base}/api/skills`, {
      headers: { cookie: tenantOneCookie },
    }).then((r) => r.json());
    const anonymousSkills = await fetch(`${base}/api/skills`);
    const publishedSkill = await fetch(
      `${base}/.well-known/atomic-unit-skill.json`,
    ).then((r) => r.json());
    const agent = await fetch(`${base}/api/agent`).then((r) => r.json());

    expect(tenantOneRules).toMatchObject({
      tenant: { id: "tenant-one", name: "Tenant One" },
      seam: {
        status: "conformant",
        receiptDiscipline: "enabled",
        tenantIsolation: "tenant-scoped",
      },
      directives: [{ id: "tenant-one-rule", text: "Tenant One rule marker." }],
      conductReceipts: [
        {
          kind: "operating_directive.install",
          status: "ok",
        },
      ],
    });
    expect(JSON.stringify(tenantOneRules)).not.toContain("tenant-two");
    expect(tenantTwoRules).toMatchObject({
      tenant: { id: "tenant-two", name: "Tenant Two" },
      directives: [],
      conductReceipts: [],
    });
    expect(JSON.stringify(tenantTwoRules)).not.toContain("Tenant One rule marker");
    expect(mcpConfig).toMatchObject({
      tenant: { id: "tenant-one" },
      unit: { name: "demo", version: "1.2.3" },
      endpoint: "/mcp",
      auth: { bearer: true, tokenedUrl: true, oauth: true },
    });
    expect(skills).toMatchObject({
      tenant: { id: "tenant-one" },
      published: {
        schemaVersion: "1.0",
        id: "demo.skill",
        name: "Demo Skill",
        tools: ["install_operating_directive"],
        unit: { name: "demo", version: "1.2.3" },
      },
      installed: [
        {
          id: "installed.helper",
          name: "Installed Helper",
          tools: ["helper_read"],
        },
      ],
    });
    expect(anonymousSkills.status).toBe(401);
    expect(skills.published).toEqual(publishedSkill);
    expect(publishedSkill).not.toHaveProperty("installed");
    expect(agent.panels).toEqual([
      "chat",
      "rules",
      "mcp",
      "skills",
      "keys",
      "connections",
      "costs",
    ]);
  });

  it("rotates the logged-in tenant token from the UI and invalidates the old MCP token", async () => {
    const tenants = createMemoryTenantStore([
      { token: "tenant-one-token", tenant: { id: "tenant-one" } },
    ]);
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      controlPlane: { store: tenants, token: "control-secret" },
      ui: { sessionSecret: "test-session-secret" },
    });
    const base = await listen(unit.app);
    const cookie = await login(base, "tenant-one-token");

    const rotatedResponse = await fetch(`${base}/api/token/regenerate`, {
      method: "POST",
      headers: { cookie },
    });
    const rotated = await rotatedResponse.json();

    expect(rotatedResponse.status).toBe(200);
    expect(rotated).toMatchObject({
      tenant: { id: "tenant-one" },
      mcpPath: "/mcp",
    });
    expect(rotated.token).toMatch(/^zenod_[a-f0-9]{48}$/);
    await expect(
      initialize(base, {
        headers: { authorization: "Bearer tenant-one-token" },
      }),
    ).resolves.toHaveProperty("status", 401);
    await expect(
      initialize(base, {
        headers: { authorization: `Bearer ${rotated.token}` },
      }),
    ).resolves.toHaveProperty("status", 200);
  });

  it("serves the existing React console assets with an SPA fallback", async () => {
    const tenants = createMemoryTenantStore([
      { token: "known-token", tenant: { id: "tenant-a" } },
    ]);
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      ui: {
        webDist: await tempWebDist(),
        sessionSecret: "test-session-secret",
      },
    });
    const base = await listen(unit.app);

    await expect(
      fetch(`${base}/asset.txt`).then((r) => r.text()),
    ).resolves.toBe("asset");
    const fallback = await fetch(`${base}/settings/keys`);

    expect(fallback.status).toBe(200);
    expect(fallback.headers.get("cache-control")).toBe(
      "no-cache, no-store, must-revalidate",
    );
    await expect(fallback.text()).resolves.toContain("chassis shell");
  });

  it("seeds one implicit self-host tenant from env token", async () => {
    const tenants = createMemoryTenantStore();
    const env = { DEMO_API_TOKEN: "zenod_self_host_seed_token" };
    const first = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      singleTenant: { store: tenants, env },
    });
    createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      singleTenant: { store: tenants, env },
    });
    const base = await listen(first.app);

    expect(tenants.snapshot()).toEqual([
      {
        tokenHash: hashToken("zenod_self_host_seed_token"),
        tenant: { id: "self-host", name: "Self-host", plan: "self-host" },
        status: "active",
        expiresAt: null,
      },
    ]);
    const response = await initialize(base, {
      headers: { authorization: "Bearer zenod_self_host_seed_token" },
    });
    expect(response.status).toBe(200);
  });

  it("idempotently seeds a durable self-host tenant across restarts", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-self-host-"));
    tempDirs.push(dataDir);
    const env = { DEMO_API_TOKEN: "zenod_durable_self_host_token" };

    const firstStore = createSqliteTenantStore({ dataDir });
    createUnit({
      name: "demo",
      tenantAuth: { store: firstStore },
      singleTenant: { store: firstStore, env },
    });
    firstStore.close();

    const restartedStore = createSqliteTenantStore({ dataDir });
    const restarted = createUnit({
      name: "demo",
      tenantAuth: { store: restartedStore },
      singleTenant: { store: restartedStore, env },
    });
    const base = await listen(restarted.app);

    expect(restartedStore.snapshot()).toEqual([
      {
        tokenHash: hashToken("zenod_durable_self_host_token"),
        tenant: { id: "self-host", name: "Self-host", plan: "self-host" },
        status: "active",
        expiresAt: null,
      },
    ]);
    await expect(
      initialize(base, {
        headers: { authorization: "Bearer zenod_durable_self_host_token" },
      }),
    ).resolves.toHaveProperty("status", 200);
    restartedStore.close();
  });

  it("maps MCP OAuth sign-in grants back to the approving tenant", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-oauth-server-"));
    tempDirs.push(dataDir);
    const seenTenants: Array<string | null> = [];
    const tenants = createMemoryTenantStore([{ token: "tenant-one-token", tenant: { id: "tenant-one" } }]);
    const unit = createUnit({
      name: "demo",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      oauth: { server: true },
      tools(_server, context) {
        seenTenants.push(context.tenant?.id ?? null);
      },
    });
    const base = await listen(unit.app);

    const unauthenticated = await initialize(base);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("www-authenticate")).toContain(
      `${base}/.well-known/oauth-protected-resource`,
    );

    const registered = (await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude Desktop",
        redirect_uris: ["https://client.example/callback"],
      }),
    }).then((r) => r.json())) as { client_id: string };
    const verifier = "deterministic-test-verifier";
    const authorizeParams = {
      client_id: registered.client_id,
      redirect_uri: "https://client.example/callback",
      state: "client-state",
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      resource: `${base}/mcp`,
      scope: "mcp",
    };
    const scopedToken = tenants.provisionTenantToken(
      "tenant-one",
      "memory-channel",
    )!.token;
    const scopedDecision = await fetch(
      `${base}/oauth/authorize/decision`,
      {
        method: "POST",
        redirect: "manual",
        body: formBody({
          ...authorizeParams,
          token: scopedToken,
          decision: "approve",
        }),
      },
    );
    expect(scopedDecision.status).toBe(401);

    const decision = await fetch(`${base}/oauth/authorize/decision`, {
      method: "POST",
      redirect: "manual",
      body: formBody({ ...authorizeParams, token: "tenant-one-token", decision: "approve" }),
    });
    expect(decision.status).toBe(302);
    const location = decision.headers.get("location");
    expect(location).toBeTruthy();
    const code = new URL(location!).searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenResponse = await fetch(`${base}/oauth/token`, {
      method: "POST",
      body: formBody({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: authorizeParams.redirect_uri,
        code_verifier: verifier,
      }),
    });
    expect(tokenResponse.status).toBe(200);
    const tokenBody = (await tokenResponse.json()) as { access_token: string };

    const mcp = await initialize(base, { headers: { authorization: `Bearer ${tokenBody.access_token}` } });
    expect(mcp.status).toBe(200);
    expect(seenTenants).toEqual(["tenant-one"]);
  });

  it("binds provider OAuth state to one tenant and stores tokens in that tenant vault", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-oauth-"));
    tempDirs.push(dataDir);
    const storage = new ChassisStorage({
      dataDir,
      vaultEncryptionKey: TEST_VAULT_KEY,
    });
    const tenants = createMemoryTenantStore([
      { token: "tenant-one-token", tenant: { id: "tenant-one" } },
      { token: "tenant-two-token", tenant: { id: "tenant-two" } },
    ]);
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      storage,
      oauth: {
        providers: [
          {
            id: "demo",
            displayName: "Demo Provider",
            clientId: "demo-client",
            authorizationUrl: "https://provider.example/oauth",
            scopes: ["read"],
            exchangeCode: ({ code, tenant }) => ({
              accessToken: `access-${tenant.id}-${code}`,
              refreshToken: `refresh-${tenant.id}`,
            }),
          },
        ],
      },
    });
    const base = await listen(unit.app);
    const profiledToken = tenants.provisionTenantToken(
      "tenant-one",
      "memory-channel",
    )!.token;
    const profiledStart = await fetch(
      `${base}/api/oauth/providers/demo/start`,
      {
        redirect: "manual",
        headers: { authorization: `Bearer ${profiledToken}` },
      },
    );
    expect(profiledStart.status).toBe(401);

    const start = await fetch(`${base}/api/oauth/providers/demo/start`, {
      redirect: "manual",
      headers: { authorization: "Bearer tenant-one-token" },
    });
    expect(start.status).toBe(302);
    const authorizeUrl = new URL(start.headers.get("location")!);
    const state = authorizeUrl.searchParams.get("state");
    const redirectUri = authorizeUrl.searchParams.get("redirect_uri");
    expect(authorizeUrl.origin).toBe("https://provider.example");
    expect(authorizeUrl.searchParams.get("client_id")).toBe("demo-client");
    expect(authorizeUrl.searchParams.get("scope")).toBe("read");
    expect(state).toBeTruthy();
    expect(new URL(redirectUri!).searchParams.get("tenant_id")).toBe("tenant-one");

    const mismatched = new URL(redirectUri!);
    mismatched.searchParams.set("tenant_id", "tenant-two");
    mismatched.searchParams.set("code", "wrong-tenant-code");
    mismatched.searchParams.set("state", state!);
    const mismatchResponse = await fetch(mismatched);
    expect(mismatchResponse.status).toBe(400);
    await expect(mismatchResponse.json()).resolves.toEqual({ error: "tenant_state_mismatch" });

    const replayed = new URL(redirectUri!);
    replayed.searchParams.set("code", "valid-code-after-replay");
    replayed.searchParams.set("state", state!);
    const replayResponse = await fetch(replayed);
    expect(replayResponse.status).toBe(400);
    await expect(replayResponse.json()).resolves.toEqual({ error: "invalid_oauth_state" });

    const secondStart = await fetch(`${base}/api/oauth/providers/demo/start`, {
      redirect: "manual",
      headers: { authorization: "Bearer tenant-one-token" },
    });
    const secondAuthorizeUrl = new URL(secondStart.headers.get("location")!);
    const secondState = secondAuthorizeUrl.searchParams.get("state");
    const secondCallback = new URL(secondAuthorizeUrl.searchParams.get("redirect_uri")!);
    secondCallback.searchParams.set("code", "valid-code");
    secondCallback.searchParams.set("state", secondState!);

    const callback = await fetch(secondCallback);
    expect(callback.status).toBe(200);
    await expect(callback.json()).resolves.toEqual({ ok: true, provider: "demo", tenant: { id: "tenant-one" } });

    const tenantOneVault = storage.forTenant({ id: "tenant-one" }).vault();
    const tenantTwoVault = storage.forTenant({ id: "tenant-two" }).vault();
    try {
      expect(JSON.parse(tenantOneVault.get("oauth:demo")!)).toMatchObject({
        providerId: "demo",
        tenantId: "tenant-one",
        tokens: {
          accessToken: "access-tenant-one-valid-code",
          refreshToken: "refresh-tenant-one",
        },
      });
      expect(tenantTwoVault.get("oauth:demo")).toBeNull();
    } finally {
      tenantOneVault.close();
      tenantTwoVault.close();
    }
  });

  it("binds storage to the trusted tenant resolved by auth, not client-supplied tenant ids", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-create-unit-"));
    tempDirs.push(dataDir);
    let captured: UnitContext | undefined;
    const tenants = createMemoryTenantStore([{ token: "tenant-alpha-token", tenant: { id: "tenant_alpha" } }]);
    const unit = createUnit({
      name: "demo",
      version: "1.2.3",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      tools(_server, context) {
        captured = context;
      },
    });
    const base = await listen(unit.app);

    const response = await initialize(
      base,
      { headers: { authorization: "Bearer tenant-alpha-token" } },
      "/mcp",
      { tenant_id: "tenant_beta" },
    );

    expect(response.status).toBe(200);
    expect(captured?.tenant).toEqual({ id: "tenant_alpha" });
    expect(captured?.storage?.rootDir).toBe(join(dataDir, "tenant_alpha"));
    expect(captured?.storage?.dir("unit")).toBe(join(dataDir, "tenant_alpha", "unit"));
  });

  it("increments only the resolved tenant's usage for MCP requests", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-create-unit-usage-"));
    tempDirs.push(dataDir);
    const usageStore = new ChassisUsageStore({ dataDir });
    const seenUsageTotals: number[] = [];
    const tenants = createMemoryTenantStore([
      { token: "tenant-alpha-token", tenant: { id: "tenant_alpha", quota: 10 } },
      { token: "tenant-beta-token", tenant: { id: "tenant_beta", quota: 10 } },
    ]);
    const unit = createUnit({
      name: "demo",
      version: "1.2.3",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      metering: usageStore,
      tools(_server, context) {
        seenUsageTotals.push(context.usage?.summary().units ?? 0);
      },
    });
    const base = await listen(unit.app);

    expect((await initialize(base, { headers: { authorization: "Bearer tenant-alpha-token" } })).status).toBe(200);
    expect((await initialize(base, { headers: { authorization: "Bearer tenant-beta-token" } })).status).toBe(200);
    expect((await initialize(base, { headers: { authorization: "Bearer tenant-alpha-token" } })).status).toBe(200);

    expect(seenUsageTotals).toEqual([1, 1, 2]);
    expect(usageStore.summary({ id: "tenant_alpha" })).toMatchObject({ events: 2, units: 2 });
    expect(usageStore.summary({ id: "tenant_beta" })).toMatchObject({ events: 1, units: 1 });
    expect(JSON.stringify(usageStore.timeline({ id: "tenant_alpha" }))).not.toContain("tenant_beta");
    usageStore.close();
  });

  it("returns a structured denial and does not run tools when tenant quota is zero", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-create-unit-quota-"));
    tempDirs.push(dataDir);
    const usageStore = new ChassisUsageStore({ dataDir });
    let toolCalls = 0;
    const tenants = createMemoryTenantStore([{ token: "tenant-zero-token", tenant: { id: "tenant_zero", quota: 0 } }]);
    const unit = createUnit({
      name: "demo",
      version: "1.2.3",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      metering: usageStore,
      tools() {
        toolCalls += 1;
      },
    });
    const base = await listen(unit.app);

    const response = await initialize(base, { headers: { authorization: "Bearer tenant-zero-token" } });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "quota_exceeded",
      quota: 0,
      used: 0,
      requested: 1,
      remaining: 0,
    });
    expect(toolCalls).toBe(0);
    expect(usageStore.summary({ id: "tenant_zero" })).toMatchObject({ events: 0, units: 0 });
    usageStore.close();
  });

  it("honors quota supplied through tenant provisioning", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mcp-chassis-create-unit-provisioned-quota-"));
    tempDirs.push(dataDir);
    const usageStore = new ChassisUsageStore({ dataDir });
    let toolCalls = 0;
    const tenants = createMemoryTenantStore();
    const unit = createUnit({
      name: "demo",
      version: "1.2.3",
      storage: { dataDir },
      tenantAuth: { store: tenants },
      controlPlane: { store: tenants, token: "control-secret" },
      metering: usageStore,
      tools() {
        toolCalls += 1;
      },
    });
    const base = await listen(unit.app);
    const created = await provisionTenant(base, { tenantId: "tenant_zero", quota: 0 }).then((r) => r.json());

    const response = await initialize(base, { headers: { authorization: `Bearer ${created.token}` } });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ error: "quota_exceeded", quota: 0 });
    expect(toolCalls).toBe(0);
    expect(tenants.snapshot()[0]?.tenant).toEqual({ id: "tenant_zero", quota: 0 });
    usageStore.close();
  });

  it("verifies Stripe webhook signatures and provisions tenant rows", async () => {
    const tenants = createMemoryTenantStore();
    const secret = "whsec_test_secret";
    const now = 1_720_000_000_000;
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      billing: {
        store: tenants,
        env: { BILLING_ENABLED: "true", STRIPE_WEBHOOK_SECRET: secret },
        clock: () => now,
      },
    });
    const base = await listen(unit.app);
    const payload = JSON.stringify({
      id: "evt_checkout",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          customer: "cus_123",
          customer_details: { email: "buyer@example.com" },
          metadata: { tenant_id: "tenant-billing", plan: "starter" },
        },
      },
    });

    const response = await postStripeWebhook(base, payload, stripeSignature(payload, secret));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      received: true,
      event: "checkout.session.completed",
      action: "provisioned",
      tenant: { id: "tenant-billing", name: "buyer@example.com", plan: "starter" },
      status: "active",
    });
    const [record] = tenants.snapshot();
    expect(record).toMatchObject({
      tenant: { id: "tenant-billing", name: "buyer@example.com", plan: "starter" },
      status: "active",
    });
    expect(record?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects bad Stripe webhook signatures before mutating tenants", async () => {
    const tenants = createMemoryTenantStore();
    const secret = "whsec_test_secret";
    const now = 1_720_000_000_000;
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      billing: {
        store: tenants,
        env: { BILLING_ENABLED: "true", STRIPE_WEBHOOK_SECRET: secret },
        clock: () => now,
      },
    });
    const base = await listen(unit.app);
    const payload = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_123", metadata: { tenant_id: "tenant-billing" } } },
    });

    const response = await postStripeWebhook(base, payload, stripeSignature(payload, "wrong-secret"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid Stripe signature" });
    expect(tenants.snapshot()).toEqual([]);
  });

  it("suspends tenant rows from subscription deletion webhooks", async () => {
    const tenants = createMemoryTenantStore([{ token: "tenant-token", tenant: { id: "tenant-billing" } }]);
    const secret = "whsec_test_secret";
    const now = 1_720_000_000_000;
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      billing: {
        store: tenants,
        env: { BILLING_ENABLED: "true", STRIPE_WEBHOOK_SECRET: secret },
        clock: () => now,
      },
    });
    const base = await listen(unit.app);
    const payload = JSON.stringify({
      id: "evt_deleted",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_123", metadata: { tenant_id: "tenant-billing" } } },
    });

    const response = await postStripeWebhook(base, payload, stripeSignature(payload, secret));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      received: true,
      action: "suspended",
      tenant: { id: "tenant-billing" },
      status: "suspended",
    });
    expect(tenants.snapshot()).toEqual([
      {
        tokenHash: hashToken("tenant-token"),
        tenant: { id: "tenant-billing" },
        status: "suspended",
        expiresAt: null,
      },
    ]);
    await expect(initialize(base, { headers: { authorization: "Bearer tenant-token" } })).resolves.toHaveProperty(
      "status",
      401,
    );
  });

  it("reactivates existing tenant rows from active subscription update webhooks", async () => {
    const tenants = createMemoryTenantStore([
      { token: "tenant-token", tenant: { id: "tenant-billing" }, status: "suspended" },
    ]);
    const secret = "whsec_test_secret";
    const now = 1_720_000_000_000;
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      billing: {
        store: tenants,
        env: { BILLING_ENABLED: "true", STRIPE_WEBHOOK_SECRET: secret },
        clock: () => now,
      },
    });
    const base = await listen(unit.app);
    const payload = JSON.stringify({
      id: "evt_updated",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_123", status: "active", metadata: { tenant_id: "tenant-billing" } } },
    });

    const response = await postStripeWebhook(base, payload, stripeSignature(payload, secret));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      received: true,
      action: "updated",
      tenant: { id: "tenant-billing" },
      status: "active",
    });
    expect(tenants.snapshot()).toEqual([
      {
        tokenHash: hashToken("tenant-token"),
        tenant: { id: "tenant-billing" },
        status: "active",
        expiresAt: null,
      },
    ]);
    await expect(initialize(base, { headers: { authorization: "Bearer tenant-token" } })).resolves.toHaveProperty(
      "status",
      200,
    );
  });

  it("serves unit-local checkout return handlers when billing is enabled", async () => {
    const tenants = createMemoryTenantStore();
    const unit = createUnit({
      name: "demo",
      tenantAuth: { store: tenants },
      billing: { store: tenants, env: { BILLING_ENABLED: "true" } },
    });
    const base = await listen(unit.app);

    const success = await fetch(`${base}/checkout/success`);
    const cancel = await fetch(`${base}/checkout/cancel`);

    expect(success.status).toBe(200);
    expect(success.headers.get("content-type")).toContain("text/html");
    await expect(success.text()).resolves.toContain("demo checkout complete");
    expect(cancel.status).toBe(200);
    await expect(cancel.text()).resolves.toContain("demo checkout canceled");
  });
});
