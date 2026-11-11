import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";

type LanguageModelV3 = Parameters<typeof wrapLanguageModel>[0]["model"];
type LanguageModelV3CallOptions = Parameters<NonNullable<LanguageModelMiddleware["transformParams"]>>[0]["params"];

/**
 * Claude 5 request shape (EPIC-7 E7-S1 round 2: Anthropic is the provider Zenod ships to testers).
 *
 * The AI SDK release Zenod runs predates the Claude 5 models, so it treats `claude-haiku-5-5` and
 * `claude-sonnet-5-5` as unknown models and sends what they refuse (claude-api skill, 2026-11-03):
 *   - sampling parameters: a `temperature`, `top_p` or `top_k` other than the default is a 400 on
 *     Haiku 5.5, Sonnet 5.5, Opus 5.x and Fable/Mythos; Zenod sends `temperature: 0` on fast chat;
 *   - forced tool use: `tool_choice` `any`/`tool` is a 400 on Sonnet 5.5, Opus 5.5 and Fable/Mythos
 *     5.1+; the answer loop asks for `required` while it searches;
 *   - structured output: for an unknown model the SDK fakes it with a forced `json` tool (the 400
 *     above) instead of the native `output_config.format`, which every Claude 5 model takes.
 * The wrapper drops the sampling parameters, asks for native structured output, turns a forced tool
 * choice into `auto` where it is refused, and sets the thinking depth per job: Haiku (filing, chat,
 * helpers) runs without thinking so a short reply never spends its tokens thinking, Sonnet (answers)
 * thinks at `medium` effort.
 */
const CLAUDE5 = /claude-(?:haiku|sonnet|opus)-5|claude-(?:fable|mythos)-5/;
const REFUSES_FORCED_TOOL = /claude-sonnet-5-5|claude-opus-5-5|claude-(?:fable|mythos)-5-[1-9]/;

export function isClaude5(modelId: string): boolean {
  return CLAUDE5.test(modelId);
}

/** The call options a Claude 5 model accepts, from what the SDK was asked for. */
export function claude5Params(modelId: string, params: LanguageModelV3CallOptions): LanguageModelV3CallOptions {
  if (!isClaude5(modelId)) return params;
  const { temperature: _t, topP: _p, topK: _k, ...rest } = params;
  const anthropic = { ...((params.providerOptions?.anthropic ?? {}) as Record<string, unknown>) };
  anthropic.structuredOutputMode ??= "outputFormat";
  if (/claude-sonnet-5/.test(modelId)) anthropic.effort ??= "medium";
  const toolChoice = REFUSES_FORCED_TOOL.test(modelId) && (params.toolChoice?.type === "required" || params.toolChoice?.type === "tool")
    ? { type: "auto" as const }
    : params.toolChoice;
  return {
    ...rest,
    ...(toolChoice ? { toolChoice } : {}),
    providerOptions: { ...(params.providerOptions ?? {}), anthropic: anthropic as never },
  };
}

/** A Claude 5 model with the request shape above; any other model unchanged. */
export function claude5Model(modelId: string, model: LanguageModelV3): LanguageModelV3 {
  if (!isClaude5(modelId)) return model;
  return wrapLanguageModel({
    model,
    middleware: { specificationVersion: "v3", transformParams: async ({ params }) => claude5Params(modelId, params) },
  });
}

/**
 * Body patch for the Anthropic Messages request: Claude Haiku 5.5 thinks by default (adaptive,
 * `medium`), so a 700-token chat reply or a filing pass could spend its budget thinking. Off is
 * accepted at effort `high` or below. Returns whether the body changed.
 */
export function claude5Body(body: Record<string, unknown>): boolean {
  const model = typeof body.model === "string" ? body.model : "";
  if (!/claude-haiku-5/.test(model) || body.thinking !== undefined) return false;
  const effort = (body.output_config as { effort?: unknown } | undefined)?.effort;
  if (effort === "xhigh" || effort === "max") return false;
  body.thinking = { type: "disabled" };
  return true;
}

/** Fetch seam for the Anthropic provider applying {@link claude5Body}; other requests pass through. */
export function claude5Fetch(base: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    if (init?.method !== "POST" || typeof init.body !== "string" || !String(input instanceof Request ? input.url : input).endsWith("/messages")) {
      return base(input, init);
    }
    let body: Record<string, unknown>;
    try { body = JSON.parse(init.body) as Record<string, unknown>; } catch { return base(input, init); }
    return claude5Body(body) ? base(input, { ...init, body: JSON.stringify(body) }) : base(input, init);
  };
}
