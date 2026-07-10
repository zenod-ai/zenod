/// <reference types="node" />

import assert from "node:assert/strict"
import test from "node:test"

import { normalizeProvider } from "./model-catalog.ts"

test("defaults an unconfigured tenant to OpenRouter", () => {
  assert.equal(normalizeProvider(null), "openrouter")
  assert.equal(normalizeProvider(undefined), "openrouter")
})

test("preserves an explicitly configured provider", () => {
  assert.equal(normalizeProvider("anthropic"), "anthropic")
  assert.equal(normalizeProvider("openai"), "openai")
  assert.equal(normalizeProvider("openrouter"), "openrouter")
  assert.equal(normalizeProvider("groq"), "groq")
})
