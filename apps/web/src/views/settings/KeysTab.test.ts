import { describe, expect, it } from "vitest"

import type { SettingsValues } from "@/lib/api"
import { toFormState } from "./KeysTab"

describe("Keys settings normalization", () => {
  it("defaults an unset hosted provider before reading its API key field", () => {
    const settings = {
      provider: null,
      vault_repo: null,
      vault_branch: null,
      github_token: null,
      anthropic_api_key: null,
      openai_api_key: null,
      openrouter_api_key: null,
      groq_api_key: null,
      model_ask: null,
      model_classify: null,
      model_vision: null,
      model_max_steps: null,
    } as SettingsValues

    expect(toFormState(settings)).toMatchObject({
      provider: "anthropic",
      anthropic_api_key: "",
    })
  })
})
