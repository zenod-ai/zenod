import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VERSION, type BrainEngine } from "zenod";

/**
 * The Zenod MCP tool surface (docs/M0-SPEC.md): four tools, no raw file CRUD.
 * Built fresh per request — the transport is stateless Streamable HTTP.
 */
export function buildMcpServer(getEngine: () => Promise<BrainEngine>): McpServer {
  const server = new McpServer({ name: "zenod-mcp-server", version: VERSION });

  server.registerTool(
    "search_memory",
    {
      title: "Search memory",
      description:
        "Deterministic search over the user's memory vault. Returns ranked note paths with snippets, scores, and GitHub source URLs. Fast (no LLM) — call this first to locate memories; then use get_memory to read one. For fuzzy or synthesis questions, prefer ask_brain.",
      inputSchema: { query: z.string().min(1).describe("Search terms, e.g. 'travel insurance'") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query }) => {
      const engine = await getEngine();
      const hits = await engine.search(query);
      const output = { hits };
      return {
        content: [
          {
            type: "text",
            text:
              hits.length === 0
                ? `No memories match '${query}'.`
                : hits.map((h) => `${h.path} (score ${h.score}) — ${h.snippet}${h.githubUrl ? `\n  ${h.githubUrl}` : ""}`).join("\n"),
          },
        ],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "get_memory",
    {
      title: "Get memory",
      description:
        "Read one note from the memory vault by its vault-relative path (e.g. 'Areas/Insurance.md'). Returns frontmatter, full content, and the GitHub source URL. Paths come from search_memory results.",
      inputSchema: { path: z.string().min(1).describe("Vault-relative path, e.g. Areas/Insurance.md") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path }) => {
      const engine = await getEngine();
      const note = await engine.get(path);
      return {
        content: [
          {
            type: "text",
            text: `# ${note.path}\nfrontmatter: ${JSON.stringify(note.frontmatter)}\n${note.githubUrl ? `source: ${note.githubUrl}\n` : ""}\n${note.body}`,
          },
        ],
        structuredContent: { path: note.path, frontmatter: note.frontmatter, body: note.body, githubUrl: note.githubUrl },
      };
    },
  );

  server.registerTool(
    "store_memory",
    {
      title: "Store memory",
      description:
        "Store a memory in the user's vault through the librarian pipeline: records immutable evidence in the Log, files the meaning onto the right page(s) with citations, validates, and commits to GitHub. Returns the evidence reference, pages touched, commit SHA, and GitHub URLs. If the librarian is unsure where the memory belongs, it returns a question instead of guessing — relay that question to the user. Use for anything the user wants remembered: facts, decisions, events, preferences.",
      inputSchema: {
        content: z.string().min(1).describe("The memory to store, as the user expressed it"),
        hints: z.array(z.string()).optional().describe("Optional filing hints, e.g. 'belongs to the housing project'"),
        verbatim: z.boolean().optional().describe("Force verbatim evidence recording (exact words preserved)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ content, hints, verbatim }) => {
      const engine = await getEngine();
      const result = await engine.store({
        content,
        source: "mcp",
        ...(hints ? { hints } : {}),
        ...(verbatim !== undefined ? { verbatim } : {}),
      });
      const lines = [
        result.question ? `QUESTION FOR THE USER: ${result.question}` : "Stored.",
        `evidence: ${result.evidenceRef}`,
        `pages: ${result.pagesTouched.join(", ")}`,
        `commit: ${result.commitSha}`,
        ...result.githubUrls,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: { ...result } };
    },
  );

  server.registerTool(
    "ask_brain",
    {
      title: "Ask the brain",
      description:
        "Ask the user's memory agent a free-form question. It runs its own read-only research loop over the vault and returns a synthesized answer with cited sources (vault paths + GitHub URLs). Use for fuzzy or cross-note questions ('what do I know about X?', 'when does my policy renew?') where search_memory alone is not enough. Slower than search_memory (runs an LLM loop).",
      inputSchema: { question: z.string().min(1).describe("The question, in natural language") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ question }) => {
      const engine = await getEngine();
      const answer = await engine.ask(question);
      const sources = answer.sources.map((s) => `- ${s.path}${s.githubUrl ? ` (${s.githubUrl})` : ""}`).join("\n");
      return {
        content: [{ type: "text", text: sources ? `${answer.text}\n\nSources:\n${sources}` : answer.text }],
        structuredContent: { ...answer },
      };
    },
  );

  return server;
}
