import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMemoryTenantStore } from "@zenod/mcp-chassis";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createZenodUnit,
  HOSTED_CHANNEL_MCP_TOOLS,
  HOSTED_CUSTOMER_MCP_TOOLS,
} from "../src/zenodUnit.js";

// EPIC-10 R1: what a directory connector (Claude, ChatGPT) sees on a hosted customer tenant.
const ORIGIN = "https://cloud.zenod.dev";
const VERIFIER = "a-deterministic-pkce-verifier-for-hosted-tool-surface-test";
const REDIRECT = "https://claude.example/callback";
const OPERATOR_TOOLS = ["create_issue", "digest_backlog", "task_brain", "run_task", "install_operating_directive"];

/** Sentences that instruct the model rather than describe the tool (Anthropic review criteria). */
const INSTRUCTION_TO_MODEL =
  /\b(you|your|must|always|never|should|do not|don't)\b|(^|[.;:]\s+)(use|call|poll|pass|prefer|repeat|omit|show|relay|read it|add|discard)\b/i;

describe("hosted customer MCP tool surface", () => {
  let dir: string;
  let unit: ReturnType<typeof createZenodUnit>;
  let cookie: string;

  const request = (path: string, init?: RequestInit) => unit.app.request(new URL(path, ORIGIN), init);

  async function listTools(token: string) {
    const server = serve({ fetch: unit.app.fetch, hostname: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const client = new Client({ name: "directory-check", version: "1.0.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`),
        { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
      ));
      return (await client.listTools()).tools;
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zenod-hosted-surface-"));
    const tenants = createMemoryTenantStore([
      { token: "customer-canonical", tenant: { id: "tenant-customer", name: "Customer brain" } },
      { token: "operator-canonical", tenant: { id: "tenant-operator", name: "Operator brain" } },
      { token: "self-host-token", tenant: { id: "tenant-self", name: "Self-hosted brain" } },
    ]);
    unit = createZenodUnit({
      dataDir: dir,
      tenantStore: tenants,
      env: { NODE_ENV: "test", ACCOUNT_STATE_SECRET: "surface-test-secret", CHASSIS_VAULT_MASTER_KEY: "11".repeat(32), DOMAIN: ORIGIN },
      customer: {
        identity: {
          authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
          exchangeAndGetUser: async () => ({ id: 42, login: "customer", email: null }),
        },
      },
      customerAdmin: { githubLogin: "Operator" },
    });
    for (const [id, login, tenantId, token] of [
      [42, "customer", "tenant-customer", "customer-canonical"],
      [7, "operator", "tenant-operator", "operator-canonical"],
    ] as const) {
      unit.customerAccounts.upsert(`account-${id}`, {
        account_id: `github-${id}`, github_id: id, github_login: login, tier: "monthly",
        subscription_status: "active", tenant_id: tenantId,
      });
      unit.customerTokenVault.put(`github-${id}`, token);
    }
    const login = await request("/auth/signin");
    const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
    const callback = await request(`/auth/github/callback?${new URLSearchParams({ code: "c", state })}`);
    cookie = callback.headers.getSetCookie().find((v) => v.startsWith("zenod_customer_session="))!.split(";")[0]!;
  });

  afterEach(async () => {
    await unit?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("gives an OAuth directory connector only the eight memory tools, each with a title, hints and a describing description", async () => {
    const tools = await listTools(await oauthAccessToken());
    expect(tools.map((tool) => tool.name).sort()).toEqual([...HOSTED_CUSTOMER_MCP_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe("boolean");
      expect(typeof tool.annotations?.destructiveHint, tool.name).toBe("boolean");
      expect(tool.description, tool.name).not.toMatch(INSTRUCTION_TO_MODEL);
      for (const [param, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
        expect((schema as { description?: string }).description ?? "", `${tool.name}.${param}`).not.toMatch(INSTRUCTION_TO_MODEL);
      }
    }
    const surface = tools
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, title, description, annotations }) => ({ name, title, description, annotations }));
    expect(surface).toMatchSnapshot();
  });

  it("gives a customer's zmt_ token the same eight tools", async () => {
    const created = await request("/api/account/mcp-tokens", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ label: "Claude Desktop" }),
    });
    const { token } = (await created.json()) as { token: string };
    const names = (await listTools(token)).map((tool) => tool.name).sort();
    expect(names).toEqual([...HOSTED_CUSTOMER_MCP_TOOLS].sort());
  });

  it("keeps the durable chat tool on the canonical credential Phylax uses for WhatsApp", async () => {
    const names = (await listTools("customer-canonical")).map((tool) => tool.name).sort();
    expect(names).toEqual([...HOSTED_CHANNEL_MCP_TOOLS].sort());
  });

  it("keeps operator tools on the operator's tenant and on tenants with no customer account", async () => {
    for (const token of ["operator-canonical", "self-host-token"]) {
      const names = (await listTools(token)).map((tool) => tool.name);
      for (const tool of [...HOSTED_CHANNEL_MCP_TOOLS, ...OPERATOR_TOOLS]) expect(names, `${token} ${tool}`).toContain(tool);
    }
  });

  /** Browser-consent OAuth flow as a directory connector runs it, for the customer tenant. */
  async function oauthAccessToken(): Promise<string> {
    const registered = await request("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT] }),
    });
    const { client_id } = (await registered.json()) as { client_id: string };
    const params = new URLSearchParams({
      response_type: "code", client_id, redirect_uri: REDIRECT,
      code_challenge: createHash("sha256").update(VERIFIER).digest("base64url"),
      code_challenge_method: "S256", scope: "mcp", resource: `${ORIGIN}/mcp`, state: "s",
    });
    const page = await request(`/oauth/authorize?${params}`, { headers: { cookie } });
    const nonce = (await page.text()).match(/name="consent" value="([^"]+)"/)![1]!;
    const approved = await request("/oauth/authorize/decision", {
      method: "POST",
      headers: { cookie, origin: ORIGIN },
      body: new URLSearchParams({ ...Object.fromEntries(params), consent: nonce, decision: "approve" }),
    });
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const exchanged = await request("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: REDIRECT, client_id, resource: `${ORIGIN}/mcp` }),
    });
    return ((await exchanged.json()) as { access_token: string }).access_token;
  }
});
