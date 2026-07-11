import { PHYLAX_AGENT } from "./agent.js";
import { createZenodUnit, type CreateZenodUnitOptions } from "./zenodUnit.js";

/**
 * Phylax duplicates the shipped Zenod/Ring customer unit mount. The channels
 * organ is ported onto this seam separately; customer auth, billing, tenant
 * storage and static landing/dashboard routing stay on the proven unit path.
 */
export function createPhylaxUnit(options: CreateZenodUnitOptions = {}) {
  return createZenodUnit({
    ...options,
    agent: PHYLAX_AGENT,
    unitName: "phylax",
    tokenEnvVar: "PHYLAX_API_TOKEN",
    defaultTenantName: "Self-hosted Phylax",
    panels: ["mcp"],
    customerProduct: {
      product: "phylax",
      unit: "phylax",
      defaultDomain: "https://phylax.zenod.dev",
      signInToLanding: true,
    },
  });
}
