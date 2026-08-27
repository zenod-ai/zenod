import {
  createCustomerLayer,
  type CustomerLayerHost,
  type CustomerLayerOptions,
} from "./customerLayer.js";
import type { CustomerUsageProjection } from "./customerMetering.js";
import type { PhylaxCustomerMeteringProjection } from "./phylaxAllowanceLedger.js";

export function projectPhylaxCustomerUsage(
  allowance: PhylaxCustomerMeteringProjection,
): CustomerUsageProjection {
  const percentageUsed = allowance.periodId === null
    ? null
    : Math.min(100, Math.max(0, Math.round(allowance.usageBasisPoints / 100)));
  return {
    percentageUsed,
    state: allowance.state === "paused" || allowance.state === "suspended"
      ? "paused"
      : allowance.state === "unavailable"
        ? "unavailable"
        : percentageUsed !== null && percentageUsed >= 80
          ? "warn"
          : "normal",
    resetsAt: allowance.resetsAt === null ? null : new Date(allowance.resetsAt).toISOString(),
  };
}

/**
 * Phylax customer front, duplicated from the shipped Zenod customer layer.
 * Auth, checkout, webhook idempotency, local tenant binding, session handling,
 * and token custody remain in the shared implementation; only the product
 * identity, storage namespace, and canonical domain differ.
 */
export function createPhylaxCustomerLayer(
  host: CustomerLayerHost,
  options: CustomerLayerOptions = {},
) {
  return createCustomerLayer(host, {
    ...options,
    capabilities: {
      ...options.capabilities,
      productionReadiness: false,
      repositoryConnection: false,
      managedAiApplication: false,
    },
    product: {
      product: "phylax",
      unit: "phylax",
      defaultDomain: "https://phylax.zenod.dev",
      signInToLanding: true,
    },
  });
}
