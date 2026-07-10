import {
  createCustomerLayer,
  type CustomerLayerHost,
  type CustomerLayerOptions,
} from "./customerLayer.js";

/**
 * Callisthenes customer front, duplicated from the shipped Zenod customer layer.
 * The implementation remains shared so auth, checkout, webhook idempotency, local
 * tenant binding, session handling, and token custody cannot drift between units.
 * Only product identity, storage namespace, and canonical domain are adapted.
 */
export function createCallisthenesCustomerLayer(
  host: CustomerLayerHost,
  options: CustomerLayerOptions = {},
) {
  return createCustomerLayer(host, {
    ...options,
    product: {
      product: "callisthenes",
      unit: "callisthenes",
      defaultDomain: "https://calli.zenod.dev",
      signInToLanding: true,
    },
  });
}
