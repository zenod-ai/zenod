/// <reference types="node" />

import assert from "node:assert/strict"
import test from "node:test"

import { formatMediaIngestTranscription } from "./media-ingest-receipt.ts"

test("formats the canonical media-ingest transcription receipt", () => {
  assert.equal(
    formatMediaIngestTranscription("provided"),
    "Transcript provided"
  )
  assert.equal(
    formatMediaIngestTranscription("performed"),
    "Transcription performed"
  )
  assert.equal(formatMediaIngestTranscription(undefined), null)
})
