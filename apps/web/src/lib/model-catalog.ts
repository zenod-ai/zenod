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
    { id: "claude-opus-4-8", label: "Claude Opus 4.8", inputPerM: 5, outputPerM: 25, note: "Most capable" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", inputPerM: 3, outputPerM: 15, note: "Balanced" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", inputPerM: 1, outputPerM: 5, note: "Fast & cheap" },
    { id: "claude-fable-5", label: "Claude Fable 5", inputPerM: 10, outputPerM: 50, note: "Most powerful" },
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
  // OpenRouter model slugs are "vendor/model". This is a curated shortlist of
  // strong, cheap options; any OpenRouter model works via "Custom model ID…".
  openrouter: [
    { id: "deepseek/deepseek-chat", label: "DeepSeek V3", inputPerM: 0.14, outputPerM: 0.28, note: "Cheap & capable" },
    { id: "deepseek/deepseek-r1", label: "DeepSeek R1", inputPerM: 0.55, outputPerM: 2.19, note: "Reasoning" },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", inputPerM: 0.12, outputPerM: 0.3 },
    { id: "qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B", inputPerM: 0.12, outputPerM: 0.39 },
    { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash", inputPerM: 0.1, outputPerM: 0.4, note: "Fast & cheap" },
  ],
  // Groq runs OpenAI-compatible chat completions at very high speed. Curated
  // shortlist; any Groq model works via "Custom model ID…".
  groq: [
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", inputPerM: 0.59, outputPerM: 0.79, note: "Balanced" },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B", inputPerM: 0.05, outputPerM: 0.08, note: "Fast & cheap" },
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", inputPerM: 0.15, outputPerM: 0.75 },
    { id: "moonshotai/kimi-k2-instruct", label: "Kimi K2", inputPerM: 1, outputPerM: 3 },
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
