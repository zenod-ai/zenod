import type { PeerConfig, PeerToolSpec } from "./peerClient.js";

export const MCP_CATALOG_TOOL_NAME = "inspect_connected_mcp_catalog";

const SCHEMA_WORDS =
  /\b(schema|schemas|field|fields|argument|arguments|input|output|required)\b/i;
const NAME_PROVENANCE_WORDS =
  /\b(actual|exact|upstream|callable|namespaced|namespace|collision|shadow|distinguish)\b/i;
const METADATA_WORDS = /\b(descriptions?|annotations?|details?|contracts?|metadata)\b/i;
function mentionedPeers(
  question: string,
  peers: readonly PeerConfig[],
): PeerConfig[] {
  const lower = question.toLocaleLowerCase();
  const exact = peers.filter((peer) =>
    lower.includes(peer.name.toLocaleLowerCase()),
  );
  return exact.length > 0 ? exact : [...peers];
}

function lexicalTokens(value: string): Set<string> {
  return new Set(
    value
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLocaleLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(
        (token) =>
          token.length >= 3 &&
          !["the", "this", "that", "tool", "mcp", "use", "connected"].includes(
            token,
          ),
      ),
  );
}

function exactOrUniqueDescriptiveTool(
  question: string,
  tools: readonly PeerToolSpec[],
): PeerToolSpec | null {
  const lower = question.toLocaleLowerCase();
  const exact = tools.filter((tool) =>
    [tool.mcp, tool.as].some((name) => {
      const escaped = name
        .toLocaleLowerCase()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(
        lower,
      );
    }),
  );
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;

  const questionTokens = lexicalTokens(question);
  const ranked = tools
    .map((tool) => ({
      tool,
      score: [...lexicalTokens(`${tool.mcp} ${tool.description}`)].filter(
        (token) => questionTokens.has(token),
      ).length,
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.mcp.localeCompare(b.tool.mcp));
  return ranked.length > 0 &&
    (ranked.length === 1 || ranked[0]!.score > ranked[1]!.score)
    ? ranked[0]!.tool
    : null;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function renderTool(tool: PeerToolSpec, includeSchemas: boolean): string {
  const lines = [
    `- Upstream MCP name: \`${tool.mcp}\``,
    `  Ring callable name: \`${tool.as}\``,
    `  Description: ${tool.description}`,
    `  Annotations: \`${JSON.stringify(tool.annotations ?? {})}\``,
  ];
  if (includeSchemas) {
    lines.push(
      "  Input schema (verbatim from tools/list):",
      "```json",
      json(
        typeof tool.inputSchema === "object"
          ? tool.inputSchema
          : { type: "object" },
      ),
      "```",
      "  Output schema (verbatim from tools/list; null means not advertised):",
      "```json",
      json(tool.outputSchema),
      "```",
      ...(tool.outputSchemaError
        ? [`  Output schema warning: ${tool.outputSchemaError}. The tool remains usable; Ring did not invent or truncate a replacement schema.`]
        : []),
    );
  }
  return lines.join("\n");
}

function renderToolNames(tools: readonly PeerToolSpec[], includeCallableNames: boolean): string[] {
  if (includeCallableNames) {
    return tools.map((tool) => `- \`${tool.mcp}\` → Ring \`${tool.as}\``);
  }
  return [`- Tools: ${tools.map((tool) => `\`${tool.mcp}\``).join(", ")}`];
}

/** Pure host renderer over authenticated, persisted tools/list state. */
export function renderMcpCatalog(
  question: string,
  peers: readonly PeerConfig[],
): string {
  if (peers.length === 0)
    return "No MCP units are connected in this tenant's wallet.";
  const selectedPeers = mentionedPeers(question, peers);
  const wantsSchemas = SCHEMA_WORDS.test(question);
  const wantsNameProvenance = NAME_PROVENANCE_WORDS.test(question);
  const wantsMetadata = METADATA_WORDS.test(question);
  const sections = selectedPeers.map((peer) => {
    const tools = peer.tools ?? [];
    const selectedTool = wantsSchemas || wantsMetadata
      ? exactOrUniqueDescriptiveTool(question, tools)
      : null;
    const discovery = peer.discovery;
    const header = [
      `## ${peer.name}`,
      `- Transport: ${discovery?.transport ?? "unknown"}`,
      `- Catalog: ${discovery?.tools ?? (peer.tools ? "ready" : "unknown")}`,
      `- Refreshed at: ${discovery?.refreshedAt ?? "not recorded"}`,
      `- Advertised tool count: ${tools.length}`,
      `- Agent Skill: ${peer.skillArtifact ? `attached (${peer.skillArtifact.version})` : "not attached"}; advisory only — it cannot add tools, authorize a mutation, or prove a receipt.`,
    ];
    if (discovery?.error) header.push(`- Discovery error: ${discovery.error}`);
    if (tools.length === 0)
      return [...header, "- No tools are currently advertised."].join("\n");
    if ((wantsSchemas || wantsMetadata) && !selectedTool) {
      return [
        ...header,
        "- More than one tool could match. Ring did not guess or dump every contract; ask again with one exact upstream MCP or Ring callable name:",
        ...renderToolNames(tools, true),
      ].join("\n");
    }
    if (selectedTool) {
      return [
        ...header,
        wantsSchemas ? "- Exact selected tool contract:" : "- Exact selected tool details:",
        renderTool(selectedTool, wantsSchemas),
      ].join("\n");
    }
    return [
      ...header,
      wantsNameProvenance
        ? "- Exact authenticated upstream → Ring callable names (skills are not included):"
        : "- Authenticated upstream tool names (ask for one exact tool's details or schema to expand it):",
      ...renderToolNames(tools, wantsNameProvenance),
    ].join("\n");
  });
  return [
    "MCP catalog facts below are rendered by Ring from authenticated `tools/list` state; they are not model-generated.",
    ...sections,
  ].join("\n\n");
}
