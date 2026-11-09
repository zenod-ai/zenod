/**
 * DeepSeek's own API (EPIC-14 S10 round 4): the prepaid route for hosted background work.
 * OpenAI-compatible Chat Completions at https://api.deepseek.com. It reports no cost per call,
 * but its bill is tokens × a published price, so the price is computed here from the cache
 * hit/miss split it returns. Prices per 1M tokens as published on
 * https://api-docs.deepseek.com/quick_start/pricing, read 2026-11-09. Peak hours bill double:
 * 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday (Chinese public holidays are off-peak;
 * they are not modelled here, so those hours are over-counted, never under-counted).
 */
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/** Off-peak USD per 1M tokens; peak is double. */
export const DEEPSEEK_PRICES: Record<"flash" | "pro", { hit: number; miss: number; output: number }> = {
  flash: { hit: 0.003, miss: 0.15, output: 0.6 },
  pro: { hit: 0.022, miss: 0.66, output: 1.98 },
};

/** True inside DeepSeek's peak window for the given instant. */
export function isDeepseekPeak(at: number): boolean {
  const date = new Date(at);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = date.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

/** USD for one DeepSeek call from its reported cache hit, cache miss and output tokens. */
export function deepseekCostUsd(input: { model: string; hitTokens: number; missTokens: number; outputTokens: number; at: number }): number {
  const rate = /pro/i.test(input.model) ? DEEPSEEK_PRICES.pro : DEEPSEEK_PRICES.flash;
  const factor = isDeepseekPeak(input.at) ? 2 : 1;
  return ((input.hitTokens * rate.hit + input.missTokens * rate.miss + input.outputTokens * rate.output) * factor) / 1_000_000;
}
