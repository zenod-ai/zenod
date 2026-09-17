import type { BrainLlm, Classification, ClassifyInput } from "./types.js";
import { assembleClassification, JevClient, JevUnavailableError, type JevVerdict } from "./jev.js";

/**
 * Wrap the primary classifier with a Jev fast path.
 *
 * Jev is only ever allowed to *shorten* the path. Every outcome that is not a
 * confident, contract-complete decision — low confidence, no destination, no
 * addressable evidence, an ineligible request, a transport failure, or an open
 * circuit breaker — delegates to the primary classifier. The wrapper never
 * throws into the filing path and never returns a partial classification.
 *
 * The circuit breaker exists because TypeSafe's early access returns HTTP 503
 * model_unavailable under load. Retrying every request into a struggling
 * provider both wastes the request and adds load, so after `breakerFailures`
 * consecutive failures the fast path is skipped entirely for `breakerCooldownMs`.
 */

export const JEV_DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
export const JEV_DEFAULT_BREAKER_FAILURES = 3;
export const JEV_DEFAULT_BREAKER_COOLDOWN_MS = 30_000;
const JEV_DEFAULT_ATTEMPTS = 2;
/**
 * A single Choice destination cannot express more than one destination, so a
 * capture that likely holds several propositions is declined rather than filed
 * to one page with the rest silently dropped.
 */
export const JEV_MULTI_TOPIC_FLOOR = 0.5;

export type JevFallbackReason =
  | "disabled"
  | "ineligible"
  | "circuit_open"
  | "unavailable"
  | "low_confidence"
  | "multi_topic"
  | "no_destination"
  | "incomplete_evidence";

export type ClassifyOutcome =
  | { route: "jev"; confidence: number; inputTokens: number; latencyMs: number; destination: string }
  | { route: "primary"; reason: JevFallbackReason; errorType?: string; latencyMs: number };

export interface JevClassifyOptions {
  client: JevClient;
  /** Below this routing confidence the primary classifier decides instead. */
  confidenceThreshold?: number;
  /** Consecutive failures that open the breaker. */
  breakerFailures?: number;
  /** How long the breaker stays open before Jev is retried. */
  breakerCooldownMs?: number;
  /** Total attempts per request, including the first. */
  attempts?: number;
  /** Base backoff between attempts; doubling, capped at 2s. */
  retryBaseMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onOutcome?: (outcome: ClassifyOutcome) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Requests Jev cannot answer completely are not worth a call: corrective
 * retries carry host-owned decision identity the fast path does not model, and
 * without addressed source passages there is no way to satisfy the evidence
 * contract without generation.
 */
export function isJevEligible(input: ClassifyInput): boolean {
  return Boolean(input.sourcePassages?.length) && !input.retryDecisions?.length;
}

export function withJevClassify(primary: BrainLlm, options: JevClassifyOptions): BrainLlm {
  const threshold = options.confidenceThreshold ?? JEV_DEFAULT_CONFIDENCE_THRESHOLD;
  const breakerFailures = Math.max(1, options.breakerFailures ?? JEV_DEFAULT_BREAKER_FAILURES);
  const cooldownMs = options.breakerCooldownMs ?? JEV_DEFAULT_BREAKER_COOLDOWN_MS;
  const attempts = Math.max(1, options.attempts ?? JEV_DEFAULT_ATTEMPTS);
  const retryBaseMs = options.retryBaseMs ?? 150;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;

  let consecutiveFailures = 0;
  let openUntil = 0;

  const report = (outcome: ClassifyOutcome) => {
    // Telemetry must never break a filing turn.
    try {
      options.onOutcome?.(outcome);
    } catch {
      /* ignore */
    }
  };

  const fallback = async (
    input: ClassifyInput,
    reason: JevFallbackReason,
    startedAt: number,
    errorType?: string,
  ): Promise<Classification> => {
    report({ route: "primary", reason, ...(errorType ? { errorType } : {}), latencyMs: Math.round(now() - startedAt) });
    return primary.classify(input);
  };

  const classify = async (input: ClassifyInput): Promise<Classification> => {
    const startedAt = now();
    if (!isJevEligible(input)) return fallback(input, "ineligible", startedAt);
    if (now() < openUntil) return fallback(input, "circuit_open", startedAt);

    let verdict: JevVerdict | undefined;
    let lastError: JevUnavailableError | undefined;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        verdict = await options.client.classify(input);
        break;
      } catch (error) {
        lastError = error instanceof JevUnavailableError
          ? error
          : new JevUnavailableError("jev unexpected failure", "unexpected");
        if (attempt < attempts - 1) await sleep(Math.min(2000, retryBaseMs * 2 ** attempt));
      }
    }

    if (!verdict) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= breakerFailures) {
        openUntil = now() + cooldownMs;
        consecutiveFailures = 0;
      }
      return fallback(input, "unavailable", startedAt, lastError?.errorType);
    }
    consecutiveFailures = 0;

    if (verdict.confidence < threshold) return fallback(input, "low_confidence", startedAt);
    if (verdict.multiplePropositions >= JEV_MULTI_TOPIC_FLOOR) return fallback(input, "multi_topic", startedAt);
    if (!verdict.destinationPath) return fallback(input, "no_destination", startedAt);

    const assembled = assembleClassification(input, verdict);
    if (!assembled) return fallback(input, "incomplete_evidence", startedAt);

    report({
      route: "jev",
      confidence: verdict.confidence,
      inputTokens: verdict.inputTokens,
      latencyMs: Math.round(now() - startedAt),
      destination: assembled.destinationPath,
    });
    return assembled.classification;
  };

  // Proxy preserves every other BrainLlm method and its `this` binding.
  return new Proxy(primary, {
    get(target, property, receiver) {
      if (property === "classify") return classify;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
