import type { Provider } from "@/lib/api"

/**
 * A model the user can pick for the Ask/Classify roles, with rough pricing so
 * the settings UI can show relative cost. Prices are USD per 1M tokens and are
 * indicative — providers change them, and a custom model ID is always allowed.
 */
export type ModelInfo = {
  id: string
  label: string
  /** USD per 1M input tokens. */
  inputPerM: number
  /** USD per 1M output tokens. */
  outputPerM: number
  /** Short positioning hint (e.g. "Balanced", "Fast & cheap"). */
  note?: string
}

/** Per-provider catalogs. Order is roughly capable → cheap. */
export const MODEL_CATALOG: Record<Provider, ModelInfo[]> = {
  anthropic: [
    { id: "claude-fable-5", label: "Claude Fable 5", inputPerM: 10, outputPerM: 50, note: "Most powerful" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8", inputPerM: 5, outputPerM: 25, note: "Most capable" },
    { id: "claude-opus-4-7", label: "Claude Opus 4.7", inputPerM: 5, outputPerM: 25 },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", inputPerM: 5, outputPerM: 25 },
    { id: "claude-opus-4-5", label: "Claude Opus 4.5", inputPerM: 5, outputPerM: 25 },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", inputPerM: 3, outputPerM: 15, note: "Balanced" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", inputPerM: 3, outputPerM: 15 },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", inputPerM: 1, outputPerM: 5, note: "Fast & cheap" },
  ],
  openai: [
    { id: "gpt-5.5", label: "GPT-5.5", inputPerM: 2, outputPerM: 16, note: "Most capable" },
    { id: "gpt-5.4", label: "GPT-5.4", inputPerM: 1.25, outputPerM: 10 },
    { id: "gpt-5.4-mini", label: "GPT-5.4 mini", inputPerM: 0.25, outputPerM: 2, note: "Fast & cheap" },
    { id: "gpt-4o", label: "GPT-4o", inputPerM: 2.5, outputPerM: 10, note: "Balanced" },
    { id: "gpt-4o-mini", label: "GPT-4o mini", inputPerM: 0.15, outputPerM: 0.6, note: "Fast & cheap" },
    { id: "gpt-4.1", label: "GPT-4.1", inputPerM: 2, outputPerM: 8 },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini", inputPerM: 0.4, outputPerM: 1.6 },
    { id: "gpt-4.1-nano", label: "GPT-4.1 nano", inputPerM: 0.1, outputPerM: 0.4, note: "Cheapest" },
  ],
  // OpenRouter model slugs are "vendor/model". Curated top picks across vendors —
  // strong + good value, roughly capable → cheap (refreshed 2026-06). Any
  // OpenRouter model still works via "Custom model ID…".
  openrouter: [
    { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", inputPerM: 0.44, outputPerM: 0.87, note: "Flagship" },
    { id: "minimax/minimax-m3", label: "MiniMax M3", inputPerM: 0.3, outputPerM: 1.2, note: "Strong & cheap" },
    { id: "qwen/qwen3.7-plus", label: "Qwen3.7 Plus", inputPerM: 0.32, outputPerM: 1.28, note: "Capable" },
    { id: "moonshotai/kimi-k2-thinking", label: "Kimi K2 Thinking", inputPerM: 0.6, outputPerM: 2.5, note: "Reasoning" },
    { id: "z-ai/glm-4.7", label: "GLM 4.7", inputPerM: 0.4, outputPerM: 1.75 },
    { id: "x-ai/grok-4.3", label: "Grok 4.3", inputPerM: 1.25, outputPerM: 2.5 },
    { id: "deepseek/deepseek-r1-0528", label: "DeepSeek R1", inputPerM: 0.5, outputPerM: 2.15, note: "Reasoning" },
    { id: "deepseek/deepseek-chat", label: "DeepSeek V3", inputPerM: 0.2, outputPerM: 0.8, note: "Cheap & capable" },
    { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", inputPerM: 0.15, outputPerM: 0.6, note: "Cheap" },
    { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", inputPerM: 0.25, outputPerM: 1.5, note: "Fast & cheap" },
    { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5", inputPerM: 3, outputPerM: 15 },
    { id: "openai/gpt-5.1", label: "GPT-5.1", inputPerM: 1.25, outputPerM: 10 },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", inputPerM: 1.25, outputPerM: 10 },
    { id: "mistralai/mistral-large", label: "Mistral Large", inputPerM: 2, outputPerM: 6 },
    { id: "amazon/nova-pro-v1", label: "Amazon Nova Pro", inputPerM: 0.8, outputPerM: 3.2 },
    { id: "qwen/qwen3-coder", label: "Qwen3 Coder 480B", inputPerM: 0.22, outputPerM: 1.8, note: "Coding" },
    { id: "openai/gpt-5-mini", label: "GPT-5 Mini", inputPerM: 0.25, outputPerM: 2 },
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", inputPerM: 0.3, outputPerM: 2.5 },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", inputPerM: 0.1, outputPerM: 0.32 },
    { id: "mistralai/mistral-small-3.2-24b-instruct", label: "Mistral Small 3.2", inputPerM: 0.07, outputPerM: 0.2, note: "Cheapest" },
  ],
  // Groq runs OpenAI-compatible chat completions at very high speed. Curated
  // shortlist; any Groq model works via "Custom model ID…".
  groq: [
    { id: "moonshotai/kimi-k2-instruct", label: "Kimi K2", inputPerM: 1, outputPerM: 3, note: "Capable" },
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", inputPerM: 0.15, outputPerM: 0.75 },
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", inputPerM: 0.1, outputPerM: 0.5 },
    { id: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 Distill 70B", inputPerM: 0.75, outputPerM: 0.99, note: "Reasoning" },
    { id: "qwen/qwen3-32b", label: "Qwen3 32B", inputPerM: 0.29, outputPerM: 0.59 },
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", inputPerM: 0.59, outputPerM: 0.79, note: "Balanced" },
    { id: "meta-llama/llama-4-maverick-17b-128e-instruct", label: "Llama 4 Maverick", inputPerM: 0.2, outputPerM: 0.6 },
    { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout", inputPerM: 0.11, outputPerM: 0.34 },
    { id: "gemma2-9b-it", label: "Gemma 2 9B", inputPerM: 0.2, outputPerM: 0.2 },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B", inputPerM: 0.05, outputPerM: 0.08, note: "Fast & cheap" },
  ],
}

/**
 * Per-provider default models used when the stored value is empty. Mirrors
 * PROVIDER_DEFAULTS in packages/core so the UI can label the default option.
 */
export const PROVIDER_DEFAULT_MODEL: Record<Provider, { ask: string; classify: string }> = {
  anthropic: { ask: "claude-sonnet-4-6", classify: "claude-haiku-4-5" },
  openai: { ask: "gpt-4o", classify: "gpt-4o-mini" },
  openrouter: { ask: "deepseek/deepseek-chat", classify: "deepseek/deepseek-chat" },
  groq: { ask: "llama-3.3-70b-versatile", classify: "llama-3.1-8b-instant" },
}

export function findModel(provider: Provider, id: string): ModelInfo | undefined {
  return MODEL_CATALOG[provider].find((m) => m.id === id)
}

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`

/** Compact cost, e.g. "$3/$15 per 1M" — for dropdown rows. */
export function costShort(m: ModelInfo): string {
  return `${money(m.inputPerM)}/${money(m.outputPerM)} per 1M`
}

/** Verbose cost, e.g. "$3 input · $15 output per 1M tokens" — for help text. */
export function costLong(m: ModelInfo): string {
  return `${money(m.inputPerM)} input · ${money(m.outputPerM)} output per 1M tokens`
}
