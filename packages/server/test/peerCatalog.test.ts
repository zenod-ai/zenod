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
      "Show the exact upstream and Ring callable names for both connected units",
      [alpha, beta],
    );

    expect(output).toContain(`\`shared_leaf\` → Ring \`${alpha.tools![0]!.as}\``);
    expect(output).toContain(`\`shared_leaf\` → Ring \`${beta.tools![0]!.as}\``);
    expect(alpha.tools![0]!.as).not.toBe(beta.tools![0]!.as);
    expect(output).toContain("Refreshed at: 2026-07-11T12:34:56.000Z");
    expect(output).toContain("advisory only");
    expect(output).not.toContain("never-render-this-secret");
    expect(output).not.toContain("ask_alpha");
    expect(output).not.toContain("ask_beta");
  });

  it("keeps a casual tool question compact and progressively discloses details", () => {
    const output = renderMcpCatalog("hi what are your tools?", [peer("Alpha", true), peer("Beta")]);

    expect(output).toContain("Advertised tool count: 1");
    expect(output).toContain("Tools: `shared_leaf`");
    expect(output).not.toContain("Ring callable name:");
    expect(output).not.toContain("Description:");
    expect(output).not.toContain("Annotations:");
    expect(output.length).toBeLessThan(2_000);
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

    const degraded = peer("Alpha");
    degraded.tools![0] = {
      ...degraded.tools![0]!,
      outputSchema: undefined,
      outputSchemaError: "shared_leaf outputSchema exceeds the 65536-byte discovery limit",
    };
    const degradedOutput = renderMcpCatalog(
      "For Alpha shared_leaf, show its required input and output schema",
      [degraded],
    );
    expect(degradedOutput).toContain("Output schema warning:");
    expect(degradedOutput).toContain("tool remains usable");
    expect(degradedOutput).toContain("did not invent or truncate");

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
    const refused = renderMcpCatalog("For Alpha, show the schema fields", [
      ambiguous,
    ]);
    expect(refused).toContain("Ring did not guess or dump every contract");
    expect(refused).toContain("Ring did not guess");
    expect(refused).not.toContain("Input schema (verbatim");
  });
});
