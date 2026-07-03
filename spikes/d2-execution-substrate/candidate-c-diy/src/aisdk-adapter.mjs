/**
 * Real AI SDK → Anthropic adapter. Only imported when ANTHROPIC_API_KEY is set
 * (see model.mjs), so the spike stays runnable offline. Mirrors the provider wiring
 * in packages/core/src/llm/aisdk.ts. Requires `npm i ai @ai-sdk/anthropic` in this
 * candidate directory (see package.json optionalDependencies).
 */
export function makeAnthropicModel() {
  return {
    id: "anthropic:claude (ai-sdk)",
    async generate({ phase, prompt }) {
      const { generateText } = await import("ai");
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const model = anthropic(process.env.SPIKE_MODEL || "claude-opus-4-8");
      const system =
        phase === "generate" ? "Plan the task in one line." :
        phase === "act" ? "State the single tool action you took." :
        "Summarize the outcome in one line.";
      const res = await generateText({ model, system, prompt });
      return { text: res.text, usage: { totalTokens: res.usage?.totalTokens ?? 0 } };
    },
  };
}
