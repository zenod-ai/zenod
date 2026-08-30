import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createGithubIssue, type BrainEngine } from "zenod";
import { buildMcpServer } from "../src/mcp.js";
import { Runtime } from "../src/runtime.js";

async function catalog(input: {
  edit?: Parameters<typeof buildMcpServer>[5];
  create?: Parameters<typeof buildMcpServer>[6];
  githubCapability?: () => boolean;
  onGithubAuthorizationRevoked?: () => void;
}) {
  const server = buildMcpServer(
    async () => ({}) as BrainEngine,
    undefined,
    undefined,
    undefined,
    undefined,
    input.edit,
    input.create,
    "zenod",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "",
    undefined,
    undefined,
    undefined,
    input.githubCapability,
    input.onGithubAuthorizationRevoked,
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "gdv-9-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server, tools: (await client.listTools()).tools };
}

describe("MCP GitHub capability projection", () => {
  it("does not advertise GitHub mutations without an explicit connection callback", async () => {
    const { client, server, tools } = await catalog({});
    try {
      const names = tools.map((tool) => tool.name);
      expect(names).toContain("digest_backlog");
      expect(names).not.toContain("create_issue");
      expect(names).not.toContain("edit_github_issue");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preserves GitHub mutation tools when their connection capability exists", async () => {
    const edit = vi.fn(async () => ({ repo: "o/r", issueNumber: 1, issueUrl: "https://github.com/o/r/issues/1", operations: [], labels: [] }));
    const create = vi.fn(async () => ({ repo: "o/r", issueNumber: 2, issueUrl: "https://github.com/o/r/issues/2", labels: [] }));
    const { client, server, tools } = await catalog({ edit, create });
    try {
      expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["create_issue", "edit_github_issue"]));
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns typed denial and performs no mutation after a connection is revoked", async () => {
    const edit = vi.fn(async () => ({ repo: "o/r", issueNumber: 1, issueUrl: "https://github.com/o/r/issues/1", operations: [], labels: [] }));
    const create = vi.fn(async () => ({ repo: "o/r", issueNumber: 2, issueUrl: "https://github.com/o/r/issues/2", labels: [] }));
    const { client, server } = await catalog({ edit, create, githubCapability: () => false });
    try {
      const result = await client.callTool({
        name: "create_issue",
        arguments: { title: "must not mutate", body: "blocked before provider access" },
      });
      expect(result).toMatchObject({
        isError: true,
        structuredContent: { error: { code: "github_connection_required" } },
      });
      expect(create).not.toHaveBeenCalled();
      expect(edit).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("classifies remote authorization revocation, invalidates once, and reconnects without rebuilding the catalog", async () => {
    let connected = true;
    let mutations = 0;
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("GitHub returned 401: Bad credentials token=must-not-leak"))
      .mockImplementationOnce(async () => {
        mutations += 1;
        return { repo: "o/r", issueNumber: 3, issueUrl: "https://github.com/o/r/issues/3", labels: [] };
      });
    const revoke = vi.fn(() => { connected = false; });
    const { client, server } = await catalog({
      create,
      githubCapability: () => connected,
      onGithubAuthorizationRevoked: revoke,
    });
    try {
      const revoked = await client.callTool({ name: "create_issue", arguments: { title: "blocked", body: "no mutation" } });
      expect(revoked).toMatchObject({
        isError: true,
        structuredContent: { error: { code: "github_connection_required" } },
      });
      expect(JSON.stringify(revoked)).not.toContain("must-not-leak");
      expect(revoke).toHaveBeenCalledTimes(1);
      expect(mutations).toBe(0);
      const denied = await client.callTool({ name: "create_issue", arguments: { title: "still blocked", body: "no mutation" } });
      expect(denied).toMatchObject({ structuredContent: { error: { code: "github_connection_required" } } });
      expect(create).toHaveBeenCalledTimes(1);
      expect(mutations).toBe(0);

      connected = true;
      const reconnected = await client.callTool({ name: "create_issue", arguments: { title: "connected", body: "allowed" } });
      expect(reconnected).toMatchObject({ structuredContent: { issueNumber: 3 } });
      expect(create).toHaveBeenCalledTimes(2);
      expect(mutations).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("does not misclassify rate limits or ordinary permission failures as revocation", async () => {
    const revoke = vi.fn();
    const create = vi.fn(async () => { throw new Error("GitHub returned 403: API rate limit exceeded"); });
    const { client, server } = await catalog({ create, githubCapability: () => true, onGithubAuthorizationRevoked: revoke });
    try {
      const result = await client.callTool({ name: "create_issue", arguments: { title: "limited", body: "unchanged" } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("github_connection_required");
      expect(revoke).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("uses the real tenant installation stack for MCP revocation and same-ID reconnect", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gdv9-mcp-revocation-"));
    const runtime = new Runtime(dir, undefined, { tenantId: "tenant-real-stack" });
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    runtime.settings.setRaw("github_app_id", "shared-app");
    runtime.settings.setRaw("github_app_private_key", privateKey.export({ type: "pkcs1", format: "pem" }) as string);
    runtime.settings.setRaw("github_app_installation_id", "111");
    let generation = 0;
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input).replace("https://api.github.com", "");
      calls.push(path);
      if (path === "/app/installations/111/access_tokens") {
        generation += 1;
        return Response.json({ token: `tenant-token-${generation}`, expires_at: new Date(Date.now() + 3600_000).toISOString() }, { status: 201 });
      }
      if (path === "/repos/o/r/issues" && generation === 1) return new Response("Bad credentials secret", { status: 401 });
      if (path === "/repos/o/r/issues" && generation === 2) {
        return Response.json({ number: 7, html_url: "https://github.com/o/r/issues/7", labels: [] }, { status: 201 });
      }
      return new Response(`unexpected ${path}`, { status: 500 });
    });
    const invalidate = vi.spyOn(runtime, "invalidate");
    const { client, server } = await catalog({
      create: (input) => createGithubIssue(runtime.settings, input),
      githubCapability: () => runtime.settings.githubConnectionConfigured(),
      onGithubAuthorizationRevoked: () => runtime.settings.onGithubAuthorizationRevoked(),
    });
    try {
      const revoked = await client.callTool({ name: "create_issue", arguments: { repo: "o/r", title: "blocked", body: "no mutation" } });
      expect(revoked).toMatchObject({ isError: true, structuredContent: { error: { code: "github_connection_required" } } });
      expect(JSON.stringify(revoked)).not.toContain("secret");
      expect(runtime.settings.githubConnectionConfigured()).toBe(false);
      const denied = await client.callTool({ name: "create_issue", arguments: { repo: "o/r", title: "still blocked", body: "no mutation" } });
      expect(denied).toMatchObject({ structuredContent: { error: { code: "github_connection_required" } } });
      expect(calls).toEqual(["/app/installations/111/access_tokens", "/repos/o/r/issues"]);

      runtime.settings.replaceGithubInstallationAuthorization("111");
      const connected = await client.callTool({ name: "create_issue", arguments: { repo: "o/r", title: "connected", body: "allowed" } });
      expect(connected).toMatchObject({ structuredContent: { issueNumber: 7 } });
      expect(calls).toEqual([
        "/app/installations/111/access_tokens",
        "/repos/o/r/issues",
        "/app/installations/111/access_tokens",
        "/repos/o/r/issues",
      ]);
      expect(invalidate).toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
      await runtime.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
