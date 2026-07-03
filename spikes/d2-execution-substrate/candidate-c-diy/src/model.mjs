/**
 * Model adapter — the LLM pillar of candidate C (DIY).
 *
 * DIY's LLM layer is the Vercel AI SDK, already used in production at
 * packages/core/src/llm/aisdk.ts. To keep this spike hermetic (runnable in CI / an
 * offline sandbox with no API key), the DEFAULT model is a deterministic local stub
 * with the same call shape as AI SDK's `generateText` — { text, usage }. The real
 * AI SDK path is one file away (see aisdk-adapter.mjs) and is selected when
 * ANTHROPIC_API_KEY is present. The executor is written against the interface, so the
 * substrate evidence (durability, budget, receipt, MCP) is identical either way.
 */

/** A deterministic, offline model. Same return shape as AI SDK generateText. */
export function deterministicModel({ runawayTokensPerCall = 10 } = {}) {
  return {
    id: "deterministic-local",
    async generate({ phase, prompt }) {
      // Fixed per-phase outputs so acceptance tests are reproducible.
      const outputs = {
        generate: { text: `PLAN: search memory for "${prompt}", then summarize.`, usage: 8 },
        act: { text: "ACTED: called search_memory.", usage: 6 },
        summarize: { text: `SUMMARY: resolved "${prompt}" using 1 memory hit.`, usage: 7 },
        // The "runaway" phase reports a large, ever-growing charge so the hard
        // budget ceiling (test 4) is guaranteed to trip.
        runaway: { text: "loop...", usage: runawayTokensPerCall },
      };
      const out = outputs[phase] || { text: "", usage: 1 };
      return { text: out.text, usage: { totalTokens: out.usage } };
    },
  };
}

/**
 * Real AI SDK model, loaded lazily so the dependency is only required when used.
 * Returns null if creds/deps are absent, letting the caller fall back offline.
 */
export async function anthropicModelIfAvailable() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const mod = await import("./aisdk-adapter.mjs");
    return mod.makeAnthropicModel();
  } catch {
    return null; // ai / @ai-sdk/anthropic not installed in this environment
  }
}
