# ZMR-15 real-pipeline evaluation

Preparation for [ZMR-15 #1241](https://github.com/zenod-ai/zenod/issues/1241). This runner imports the **actual candidate's engine, configured LLM adapter and durable job queue**. It does not use the proposed-operation contract in `scripts/memory-eval` and cannot declare semantic acceptance automatically.

The default command is offline and uses no key/network:

```sh
node scripts/zmr-pipeline-eval/run.mjs
node --test scripts/zmr-pipeline-eval/*.test.mjs
```

The held-out fixture remains private to evaluation at `/tmp/zmr15-heldout/heldout.json`. Its frozen SHA256 is `9f4730688c2d94212d6d9daeecdf9285eedc4d5f924c25721e820438d37aeb21`; the runner rejects changed bytes or invalid source offsets. Expected operations never enter model requests. Preserve the private fixture and recall questions independently; do not send their expected operations to implementation workers or tune on this held-out result. Questions are frozen separately and their hash recorded. Source offsets authored in codepoints are converted to JavaScript UTF-16 before comparing runtime evidence spans.

## Terminal provider failures

Both drivers latch a recognized HTTP 403 provider quota denial at the shared HTTP boundary. Later SDK retries, enrichment retries and recall trials cannot send new requests. A request already in flight cannot be unsent. The first failed trial and all earlier observations remain recorded; unstarted trials are reported separately as unmeasured. The run exits unsuccessfully with `INCOMPLETE_PROVIDER_QUOTA`, never an awaiting-review acceptance hint. Local budget exhaustion and other incomplete calls have distinct statuses.

Public summaries contain a sanitized quota code/stage, not the provider error message, URL or key identifier. Exact wire responses remain in the private output directory for audit. `providerReportedCostUsd` sums known reported costs only; `retainedUnknownCostReservationsUsd` retains the full reservation for attempts without reported cost. `exposureUsd` includes both and must not be described as billed cost. Restoring provider quota or beginning another paid run remains a separate manager/user gate; the harness never changes account limits.

## Candidate-bound execution

Actual model testing waits for the manager's accepted integrated ZMR-11–14 candidate. This preparatory PR neither authorizes an earlier quality run nor substitutes for that dependency. At execution, record fresh read-only production provider/model configuration and verify the defaults still match: OpenRouter MiniMax M3 classification, Grok 4.3 ask/composition. This is an algorithm evaluation; no DeepSeek comparison or production model switch is performed.

Create a private price manifest from current reviewed OpenRouter model/provider prices and documented output limits. The runner requires both configured models, charges reservations without cache savings, and refuses unlisted model IDs. Example shape, **not executable pricing**:

```json
{
  "reviewedAt": "ACTUAL_REVIEW_TIME",
  "source": "ACTUAL_PRICE_SOURCE_URL_AND_ROUTE_ASSUMPTION",
  "models": {
    "minimax/minimax-m3": {
      "inputUsdPerMillion": 0,
      "outputUsdPerMillion": 0,
      "maxOutputTokens": 0
    },
    "x-ai/grok-4.3": {
      "inputUsdPerMillion": 0,
      "outputUsdPerMillion": 0,
      "maxOutputTokens": 0
    }
  }
}
```

Zero output limits are invalid. Do not use placeholders or synthetic prices for paid calls. `syntheticTransportOnly: true` is rejected in live mode. The existing production secret must be supplied securely at execution through `ZMR_EVAL_OPENROUTER_KEY`; never put it in an argument, fixture, output file or Git. The runner does not locate/extract keys.

The private questions file is an array of `{ "id": "stable-case-id", "question": "natural recall question" }`. Include beginning, middle, tail, current/prior/collaborator claims, owners and uncertainty. No expected answer is included in a question. Each runs three times with a fresh engine and SQLite state. These are independent read-only ask sessions, not browser/phone conversations.

```sh
node scripts/zmr-pipeline-eval/run.mjs --live \
  --candidate-repo /ABSOLUTE/ISOLATED/ACCEPTED_CANDIDATE \
  --candidate-sha FULL_ACCEPTED_SHA \
  --out /ABSOLUTE/NEW/PRIVATE/RESULT_DIRECTORY \
  --prices /ABSOLUTE/REVIEWED_PRICES.json \
  --questions /tmp/zmr15-heldout/questions.json \
  --budget-usd 1 --max-requests 60
```

The candidate must have installed dependencies, match the exact SHA and be clean. The runner builds it before importing its output, records source/harness/fixture/question/price hashes, and rejects an existing output directory. It creates only an isolated temporary bare Git remote, working vault and local SQLite stores. Its source type is `mcp`, explicitly an evaluator; it never impersonates a phone event or opens the owner's vault.

Default path: actual `captureEvidence`, actual `enrich_memory` queue, terminal receipt, direct enrichment replay, idempotent capture/job identity, then fresh-session recall. It records all model method inputs/results, full private before/after/replay pages, raw evidence, actual wire requests/responses without headers, adapter usage and token estimates. It checks original-page preservation, forbidden-page stability, raw identity, replay changes, read-only recall and candidate-source stability.

The network guard allows only OpenRouter chat completion POSTs, counts SDK retries at the HTTP boundary, applies a two-minute timeout per request, and reserves budget **before** sending. It uses a conservative request-byte input bound plus an explicit wire request output limit within the reviewed model maximum; missing, invalid, conflicting, or excessive output limits fail before transport. Returned `usage.cost` replaces a reservation; absent cost retains it. Request/attempt caps remain independent of cost. A budget refusal is recorded separately from sent requests; inspect the resulting pending outcome. Unexpected provider prices can exceed a reservation, so this is a bounded scheduling policy, not an account-level hard billing cap. The starting budget ceiling is $1; do not silently raise it.

Raw wire parsing buffers a cloned response before handing it back to the adapter. This preserves contents but means first-token streaming latency is not measured. Record total request/stage/capture latency; label small-sample p50/p95 with their counts. Compare baseline and candidate using separate fresh runs with the same frozen inputs and reviewed settings. This runner does not change prompts/model behavior or request output limits to make a candidate pass.

## Review the results

`run.json` reports structural invariants and request/stage telemetry. `semantic-review.json` requires an independent reviewer to inspect every changed statement and each of the three recall answers. Span overlap is only **structural assignment coverage**; citation existence is not semantic support.

Acceptance needs measured idea recall, candidate recall from actual packets, operation correctness, false writes, false duplicate suppression, qualification/history preservation and grounded recall. Inspect the real method/wire traces alongside page diffs. Require zero evidence mutation, isolation or idempotency failures and no unsupported writes/corrections in mandatory cases. Pending ideas need specific justified reasons; an unassigned idea cannot count as understood merely because all characters were marked reviewed. One source sentence may contain multiple independent facts, so review its subclaims individually.

A replay after complete filing must not change pages. A replay after partial filing may make progress; its extra writes and duplicate prevention require review, while raw evidence and forbidden pages must remain unchanged.

Automatic states are `RUN_FAILED`, `INVARIANT_FAILURE`, or `AWAITING_INDEPENDENT_SEMANTIC_REVIEW`. None means SHIP. Freeze the exact candidate and review receipt, run the required integrated CI gate, then prepare the ZMR-16 release packet. Replaying a failure during repair becomes a development case; preserve additional held-out cases for the next acceptance attempt.

## Audio and phone boundaries

An optional `--audio /ABSOLUTE/SYNTHETIC.wav` uses the actual `media_ingest` archive path with the fixture as a **provided transcript**. It verifies raw WAV hash and separate archived transcript bytes, then follows the actual queued enrichment path. It intentionally labels itself `actual-local-media-archive-with-provided-transcript`; it is **not ASR or phone acceptance**.

For actual audio acceptance at candidate time:

1. Generate intelligible Spanish and English synthetic speech from separately frozen source text using an installed local TTS voice; preserve the text, voice/rate command, WAV checksum and duration. Confirm the beginning/middle/end are audible. Silence bytes cannot stand in for spoken material.
2. Run that real WAV through the existing transcription ingress in the isolated test context with the approved transcription provider/settings, omitting `providedTranscript`. The optional mode here does not yet automate this ASR leg; wire it only after the exact candidate/provider are bound. Record ASR words/omissions separately from reconciliation errors and include its usage/cost.
3. For ZMR-17, deliver the designated synthetic recording through the genuine approved phone/test identity and supported channel. Verify binary/transcript/Log pointers and final receipts on the actual deployed image. Local data URIs and supplied transcripts cannot satisfy this boundary. Do not fake webhook events or use the owner's personal memory as a scratch vault.

## Offline plumbing smoke

`--offline-smoke` replaces only HTTP completions with canned responses while using the real built candidate adapter/engine/queue; it refuses combination with `--live` and requires no secret. Supply a synthetic price manifest marked `syntheticTransportOnly: true` and the same explicit candidate/output/question arguments. It must report `externalCalls: 0` and `OFFLINE_PLUMBING_ONLY`; no semantic quality follows from it.

Preparatory checks performed against reviewed source `737eb6d9710104831f61c380b723e68417667380`:

- Actual capture/queue/replay and 18 fresh-state ask sessions, synthetic HTTP only: zero external calls. The first smoke intentionally exercised classification failure preservation while the fixture completion schema was being wired.
- Actual local media archival of a valid silence WAV with a supplied transcript, queued enrichment and 18 fresh-state ask sessions: 24 intercepted requests, zero external calls. Silence was used solely to verify byte custody, never represented as speech. The smoke exposed a pre-existing strict transcript-fidelity failure: supplied-transcript extraction trimmed the final CRLF (two bytes) before archival. This remains a visible failed invariant awaiting product repair; equality was not relaxed.
- Five native policy tests check source freezing/UTF-16 offsets, model-input separation, request/cost bounds, unknown cost handling, streaming usage parsing and the distinction between span coverage and semantic correctness.

These are harness checks, not ZMR-15 quality evidence. Outstanding: final integrated candidate, reviewed real pricing/configuration, paid real-classifier runs, independent semantic scoring, real spoken audio/ASR and genuine production phone acceptance.

## Real local-ASR candidate-container leg

`asr-ingress.mjs` runs the actual candidate `TaskJobQueue` media ingest with **no supplied transcript**, local Whisper, raw/transcript archival, real engine capture/enrichment, direct replay, and three fresh engine sessions for every recall question. It consumes compiled `/app` modules, checks both runtime `GIT_SHA` and baked `.gitsha`, hashes the driver and frozen inputs, and requires the existing `ggml-large-v3-turbo.bin` checksum. The operator must separately verify the immutable image digest. No ASR model download or cloud ASR fallback is allowed; the evaluation key is retained only in a lexical variable, all model credential environment variables are cleared before child processes, and ASR settings pass empty credentials. Fake-transcript/provider hooks, VITEST, and NODE_ENV=test are rejected before runtime imports. Only bounded OpenRouter chat completions are permitted by the fetch guard.

Run the two independent long speech fixtures separately, once each. The driver fixes each run's ceiling at **$0.50 / 40 HTTP attempts**, so both ASR fixture runs together have a $1 reservation ceiling; this is separate from the primary heldout run's budget. Failed attempts consume that allocation; do not rerun with a fresh ledger without accounting for prior exposure. The same explicit-output-limit policy applies. Unexpected provider pricing retains the billing caveat above.

Required arguments are `--candidate-sha`, `--captured-at` (frozen canonical UTC timestamp), `--audio`, `--audio-sha256`, `--source`, `--source-sha256`, `--model-dir`, `--model-sha256`, `--seed-pages`, `--questions`, `--prices`, and exclusive new `--out`. `--runtime` defaults to `/app`. Supply `ZMR_EVAL_OPENROUTER_KEY` only through the operator's protected in-memory launcher, never argument text or an artifact. Mount only private synthetic fixtures, a fresh output/data directory, this driver/policy, and existing model weights read-only; do not mount a production vault. Do not start a container or download an image until the exact candidate has passed its gate.

Prepared independent fixtures and their manifests are in `/tmp/zmr15-asr-fixtures`: Spanish `es-long.wav` (150.23 seconds) and English `en-long.wav` (135.84 seconds), with source files, per-language seed pages and frozen recall questions. They are separate from the primary heldout corpus. The ASR source text is used only for frozen reference/checksum, never passed to the ASR or semantic model. Actual ASR output, page snapshots, model wire usage, archive pointers, capture/enrichment receipts, replay, and recall answers are retained for independent review. ASR transcription accuracy, false writes, preservation of the unrelated cooking page, and current/prior recall are human/evaluator checks; successful process completion is not SHIP.

The driver verifies capture and enrichment timestamps, source identity and content type; failed or unfinished enrichment blocks replay/recall. Preparation has only passed syntax and offline guard review; this driver has not yet run ASR. The discovered production model asset is `/data/models/ggml-large-v3-turbo.bin`, SHA256 `1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69`. The image includes the executable but not weights. A later isolated candidate container can mount this existing file read-only without copying/downloading 1.5GB.

For native laptop execution, pass `--source-repo /path/to/clean/candidate` instead of relying on the container runtime. The operator must build that exact source checkout **before** securely injecting the evaluation key (the primary heldout runner already performs this build). Native mode requires exact Git HEAD and clean tracked/untracked status, records hashes of tracked core/server/chassis source plus all compiled modules, and verifies they remain unchanged through the run. It is labeled native candidate ASR evidence, not production-image or phone evidence. Use the same verified existing Whisper model bytes in a private local cache, never a substitute model. The driver removes all model credentials from the environment before even native Git child processes, retaining only a lexical key for the AISDK adapter.
