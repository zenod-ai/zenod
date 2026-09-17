// Deployed-snapshot binding for the production MCP eval.
//
// A production cell must be evaluated against the exact deployed code snapshot
// (candidateSha / imageDigest) AND the exact deployed model snapshot. The test
// tenant is configured to match the live owner's model settings so the receipt
// describes the running product, not a different model configuration.
export const MODEL_KEYS = [
  "model_classify",
  "model_classify_reasoning_effort",
  "model_classify_provider_order",
  "model_ask",
  "model_ask_reasoning_effort",
];

export const REQUIRED_MODEL_KEYS = [
  "model_classify",
  "model_ask",
  "model_classify_reasoning_effort",
];

/** Project a settings map onto the eval's model keys (present, non-empty only). */
export function modelSnapshot(settings) {
  const snapshot = {};
  for (const key of MODEL_KEYS) {
    const value = settings?.[key];
    if (typeof value === "string" && value.trim()) snapshot[key] = value;
  }
  return snapshot;
}

/** Fail closed on an incomplete or unrecognized model snapshot. */
export function validateModelSnapshot(models) {
  if (!models || typeof models !== "object") throw new Error("model snapshot is required");
  for (const key of Object.keys(models)) {
    if (!MODEL_KEYS.includes(key)) throw new Error(`unknown model key: ${key}`);
    if (typeof models[key] !== "string" || !models[key].trim()) throw new Error(`empty model value: ${key}`);
  }
  for (const key of REQUIRED_MODEL_KEYS) {
    if (typeof models[key] !== "string" || !models[key].trim()) throw new Error(`missing model value: ${key}`);
  }
  return modelSnapshot(models);
}

/** True when the deployed owner model settings and the eval snapshot agree. */
export function sameModelSnapshot(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
}
