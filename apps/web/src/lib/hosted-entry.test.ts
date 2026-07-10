/// <reference types="node" />

import assert from "node:assert/strict"
import test from "node:test"

import { extractHostedAccessToken } from "./hosted-entry.ts"

test("extracts a hosted tenant token from the URL fragment", () => {
  assert.equal(
    extractHostedAccessToken("#access_token=zenod_abc123"),
    "zenod_abc123"
  )
})

test("ignores unrelated and empty fragments", () => {
  assert.equal(extractHostedAccessToken("#ring-router-products"), null)
  assert.equal(extractHostedAccessToken("#access_token="), null)
  assert.equal(extractHostedAccessToken(""), null)
})
