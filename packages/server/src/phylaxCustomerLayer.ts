import {
  createCustomerLayer,
  type CustomerLayerHost,
  type CustomerLayerOptions,
} from "./customerLayer.js";

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
