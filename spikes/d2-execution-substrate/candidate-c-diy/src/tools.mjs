/**
 * Tool layer — acceptance test 3: "an existing Zenod MCP tool (search_memory) is
 * called from inside the candidate's tool layer."
 *
 * The candidate calls Zenod's `search_memory` as a first-class MCP tool. In a live
 * run this is a real MCP client (@modelcontextprotocol/sdk) pointed at the Zenod /
 * Console gateway; the tool schema is the one this repo already ships
 * (mcp__console__search_memory: { query } → { hits: [{ path, snippet, score, githubUrl }] }).
 *
 * For a hermetic spike we inject the MCP transport. `makeSearchMemoryTool(transport)`
 * builds the tool against ANY transport implementing `.call(name, args)`; the default
 * transport is a stub returning one deterministic hit, but the SAME code path drives a
 * real gateway transport when one is supplied. This proves MCP interop survives the
 * substrate choice — the tool boundary is transport-agnostic.
 */

/** A stub MCP transport with the real search_memory response shape (offline default). */
export function stubMcpTransport() {
  return {
    id: "stub-mcp",
    async call(name, args) {
      if (name !== "search_memory") throw new Error(`unknown MCP tool: ${name}`);
      return {
        hits: [{
          path: "Projects/Zenod/Vercel Eve as Execution Substrate (D-2).md",
          snippet: `stub hit for "${args.query}"`,
          score: 175,
          githubUrl: "https://github.com/AlfaBlok/obsidian-brain/blob/main/Projects/Zenod/...",
        }],
      };
    },
  };
}

/** Build the search_memory tool over an MCP transport (stub or real gateway). */
export function makeSearchMemoryTool(transport = stubMcpTransport()) {
  return {
    name: "search_memory",
    description: "Deterministic keyword search over the user's Zenod memory vault.",
    transportId: transport.id,
    async invoke({ query }) {
      const res = await transport.call("search_memory", { query });
      return res.hits ?? [];
    },
  };
}
