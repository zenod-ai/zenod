import { describe, expect, it } from "vitest";
import { councilToolName, type PeerConfig } from "../src/peerClient.js";
import { renderMcpCatalog } from "../src/peerCatalog.js";

function peer(name: string, skill = false): PeerConfig {
  const callable = councilToolName(name, "shared_leaf");
  return {
    name,
    url: `https://${name.toLowerCase()}.example/mcp`,
    token: "never-render-this-secret",
    wallet: true,
    discovery: {
      transport: "connected",
      tools: "ready",
      refreshedAt: "2026-07-11T12:34:56.000Z",
    },
    ...(skill
      ? { skillArtifact: { artifactId: "sha256:not-secret", version: "1.2.3" } }
      : {}),
    tools: [
      {
        as: callable,
        mcp: "shared_leaf",
        arg: "input",
        description: `Read ${name}'s exact record`,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", minLength: 1 } },
        },
        outputSchema: {
          type: "object",
          required: ["record"],
          properties: { record: { type: "string" } },
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    ],
  };
}

describe("host-owned MCP catalog", () => {
  it("renders same-leaf peers without shadowing and never exposes credentials", () => {
    const alpha = peer("Alpha", true);
    const beta = peer("Beta");
    const output = renderMcpCatalog(
      "Show which actual tools both connected units expose",
      [alpha, beta],
    );

    expect(output).toContain("Upstream MCP name: `shared_leaf`");
    expect(output).toContain(`Ring callable name: \`${alpha.tools![0]!.as}\``);
    expect(output).toContain(`Ring callable name: \`${beta.tools![0]!.as}\``);
    expect(alpha.tools![0]!.as).not.toBe(beta.tools![0]!.as);
    expect(output).toContain("Refreshed at: 2026-07-11T12:34:56.000Z");
    expect(output).toContain("advisory only");
    expect(output).not.toContain("never-render-this-secret");
    expect(output).not.toContain("ask_alpha");
    expect(output).not.toContain("ask_beta");
  });

  it("renders complete selected schemas and handles ambiguity without guessing", () => {
    const alpha = peer("Alpha");
    const exact = renderMcpCatalog(
      "For Alpha shared_leaf, show its required input and output schema",
      [alpha],
    );
    expect(exact).toContain('"required": [\n    "id"');
    expect(exact).toContain('"required": [\n    "record"');
    expect(exact).toContain('"openWorldHint":false');

    const ambiguous: PeerConfig = {
      ...alpha,
      tools: [
        ...alpha.tools!,
        {
          ...alpha.tools![0]!,
          as: councilToolName("Alpha", "second_leaf"),
          mcp: "second_leaf",
        },
      ],
    };
    const complete = renderMcpCatalog("For Alpha, show the schema fields", [
      ambiguous,
    ]);
    expect(complete).toContain(
      "Ring did not guess; complete bounded contracts for every advertised tool follow",
    );
    expect(complete.match(/Input schema \(verbatim/g)).toHaveLength(2);

    const tooLarge: PeerConfig = {
      ...alpha,
      tools: Array.from({ length: 5 }, (_, index) => ({
        ...alpha.tools![0]!,
        as: councilToolName("Alpha", `leaf_${index}`),
        mcp: `leaf_${index}`,
        inputSchema: { type: "object", description: "x".repeat(60_000) },
        outputSchema: undefined,
      })),
    };
    const refused = renderMcpCatalog("For Alpha, show the schema fields", [
      tooLarge,
    ]);
    expect(refused).toContain("host-render bound");
    expect(refused).toContain("Ring will not guess");
    expect(refused).not.toContain("Input schema (verbatim");
  });
});
