import {
  createCustomerLayer,
  type CustomerLayerHost,
  type CustomerLayerOptions,
} from "./customerLayer.js";

/**
 * Ring customer front, duplicated from the shipped Zenod customer layer.
 * Auth, checkout, webhook idempotency, local tenant binding, session handling,
 * and token custody remain in the shared implementation; only the product
 * identity, storage namespace, and canonical domain differ.
 */
export function createRingCustomerLayer(
  host: CustomerLayerHost,
  options: CustomerLayerOptions = {},
) {
  return createCustomerLayer(host, {
    ...options,
    product: {
      product: "ring",
      unit: "ring",
      defaultDomain: "https://ring.zenod.dev",
      signInToLanding: true,
    },
  });
}
