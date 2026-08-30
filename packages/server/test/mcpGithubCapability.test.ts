import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type { BrainEngine } from "zenod";
import { buildMcpServer } from "../src/mcp.js";

async function catalog(input: {
  edit?: Parameters<typeof buildMcpServer>[5];
  create?: Parameters<typeof buildMcpServer>[6];
  githubCapability?: () => boolean;
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
});
