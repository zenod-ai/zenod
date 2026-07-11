import { HERALD_AGENT } from "./agent.js";
import { createZenodUnit, type CreateZenodUnitOptions } from "./zenodUnit.js";

/**
 * Herald duplicates the proven tenant/customer chassis and ports the existing
 * vaultless Council runtime. The chat, wallet, SSRF policy, Keys custody,
 * history, customer layer and MCP face stay shared with the shipped Ring.
 */
export function createHeraldUnit(options: CreateZenodUnitOptions = {}) {
  return createZenodUnit({
    ...options,
    agent: HERALD_AGENT,
    unitName: "herald",
    tokenEnvVar: "HERALD_API_TOKEN",
    defaultTenantName: "Self-hosted Herald",
    panels: ["chat", "keys", "connections", "costs", "mcp"],
    customerProduct: {
      product: "herald",
      unit: "herald",
      defaultDomain: "https://herald.zenod.dev",
      signInToLanding: true,
    },
  });
}
