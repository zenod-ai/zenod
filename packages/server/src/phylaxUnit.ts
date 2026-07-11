import { PHYLAX_AGENT } from "./agent.js";
import { createZenodUnit, type CreateZenodUnitOptions } from "./zenodUnit.js";
import { PhylaxChannelsOrgan } from "./phylaxChannels.js";
import { mountPhylaxAdminChannelRoutes, PhylaxPortedRuntime } from "./phylaxPortedRuntime.js";

export const PHYLAX_ADMIN_GITHUB_LOGIN = "alfablok";

/**
 * Phylax duplicates the shipped Zenod/Ring customer unit mount. The channels
 * organ is ported onto this seam separately; customer auth, billing, tenant
 * storage and static landing/dashboard routing stay on the proven unit path.
 */
export function createPhylaxUnit(options: CreateZenodUnitOptions = {}) {
  const dataDir = options.dataDir ?? process.env.ZENOD_DATA_DIR ?? "./data";
  const organ = new PhylaxChannelsOrgan({
    dataDir,
    // P-S3 replaces this empty resolver with the tenant-owned settings store.
    // Keeping it closed here means the admin can safely pair the fresh unit
    // before any sender is allowed to reach a downstream.
    routes: { resolve: () => null },
  });
  const channels = new PhylaxPortedRuntime(dataDir, organ, options.env ?? process.env);
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
    customerAdmin: {
      githubLogin: PHYLAX_ADMIN_GITHUB_LOGIN,
      mountRoutes: (app) => mountPhylaxAdminChannelRoutes(app, channels),
      close: () => channels.close(),
    },
  });
}
