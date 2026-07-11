import { RING_AGENT } from "./agent.js";
import { createZenodUnit, type CreateZenodUnitOptions } from "./zenodUnit.js";

/**
 * Ring duplicates the proven tenant/customer chassis and ports the existing
 * vaultless Council runtime. Wallet persistence and policy are layered onto
 * this seam by R-S3; the chat, Keys custody, history and MCP face stay shared.
 */
export function createRingUnit(options: CreateZenodUnitOptions = {}) {
  return createZenodUnit({
    ...options,
    agent: RING_AGENT,
    unitName: "ring",
    tokenEnvVar: "RING_API_TOKEN",
    defaultTenantName: "Self-hosted Ring",
    panels: ["chat", "keys", "connections", "costs", "mcp"],
    customerProduct: {
      product: "ring",
      unit: "ring",
      defaultDomain: "https://ring.zenod.dev",
      signInToLanding: true,
    },
  });
}
