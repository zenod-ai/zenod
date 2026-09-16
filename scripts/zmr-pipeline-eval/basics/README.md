# M2 fixed basic memory baseline (#1313)

This runner extends the existing evaluator guard/ledger and the existing server `runSyntheticChat` seam. No product behavior changes. `fixture.json` freezes12 synthetic cases; `rubric.json` holds expected checks **never included in model inputs**. Trial-major order B01–B12 ×3 retains denominator36 under every stop. Each case/trial uses a fresh local Git bare repository, vault and SQLite state; multi-turn case conversations retain their key. B09 also exercises a different key. No owner vault, phone, external Git or ASR access. Uses the candidate ZENOD_AGENT persona and local vault task tools; external task/Drive/peer integrations and tenant project registry are absent and recorded. This isolated memory surface does not claim complete production prompt/tool parity.

B10 directly captures a thought then asks for an opinion. B07 deliberately processes the older voice note after the newer one. B05 consumes the local fixture job's automatic retry allowance before starting, injects one failure before its second real reconciliation (no synthetic model response), saves the actual partial receipt/pages, then retries with a fresh engine. It requires observed filed+pending intermediate work; verifies durable input/fingerprint, completed IDs and actual claim/citation lines, duplicate capture/key and completed replay. A pending retry leaves completed replay UNMEASURED and cannot pass B05; it is not mislabeled data loss.

## Run

Plan only (no key/network):

```sh
node scripts/zmr-pipeline-eval/basics/run.mjs
```

Use a **separate clean candidate checkout**, exact full source and independently observed deployment SHA. Runner builds it with credential environment variables removed before any child process, hashes source/compiled outputs and records all request bodies/responses privately. No fake transport for live mode. Existing provider deadline120s, maximum$1/80requests remain unchanged. The full36 cases may not fit; incomplete is a valid red baseline, never a smaller passing suite. Optional `--select B01:1,B02:1` is an explicitly named partial batch, not an automatic resume or fresh-budget retry; all36 rows remain in its report. Root must authorize any subsequent batch separately and compare all attempts.

```sh
node scripts/zmr-pipeline-eval/basics/run.mjs --preflight \
  --candidate-repo /absolute/clean/candidate --candidate-sha FULL_SHA --deployed-sha OBSERVED_FULL_SHA \
  --out /absolute/new/private/output --prices /absolute/reviewed-prices.json \
  --classify-model openai/gpt-5.6-luna --organizer-reasoning-effort low --ask-model x-ai/grok-4.3
```

After independent review, parent supplies existing key securely as `ZMR_EVAL_OPENROUTER_KEY` and replaces `--preflight` with `--live --budget-usd 1 --max-requests 80`. **Do not put the key in command arguments or files.** These model identifiers describe the current baseline explicitly, not product defaults or a model switch. Preflight exercises all36 isolated bootstraps with zero external calls; it does not run agent answers or prove quality.

## Score

All real outputs, page snapshots, exact model operations, reads, tool events, custody gates, request IDs/tokens/cost and timings are retained. Failed attempts count. Unknown provider cost retains reservation; cost per pass is null when any cost is unknown. `review-template.json` must be filled independently against every rubric check, actual source and answer; evidence hashes prevent stale reviews. HTTP200/tool success/citations alone cannot pass. No lexical or model judge. Review cannot override missing/failed critical gates or unmeasured B05 replay.

```sh
node scripts/zmr-pipeline-eval/basics/report.mjs --run /private/output/run.json \
  --review /private/independent-review.json --out /private/new-scored-report.json
node --test scripts/zmr-pipeline-eval/basics/policy.test.mjs
M2_CANDIDATE_REPO=/absolute/built/candidate node --test scripts/zmr-pipeline-eval/basics/seam.test.mjs
```

Seam test uses a deterministic offline responder solely to prove real engine conversation retention/isolation; it is never a semantic trial. Report source/candidate/version hashes and keep red baselines alongside subsequent candidate reports. This is isolated engine.chat proof only; production MCP and actual WhatsApp acceptance are separate manager-owned gates.

### Background filing boundary and archived cost correction

Conversational `capture_note` can start an engine-local background store outside TaskJobQueue. The runner observes its real queued result, waits for the existing `onFilingComplete` callback before the next turn/case and before snapshot/cost finalization, and records those receipts. Missing completion after the bounded wait stops the run as incomplete; it is never synthesized as success. Remaining writes cannot regain unrestricted network access after that stop. The offline seam test exercises this exact real-engine callback with delayed deterministic classification.

The shared wire parser accepts SSE comments/metadata before `data:` and multiline CRLF events. Historical evidence stays immutable: corrections to previously unknown provider costs belong in a separate reconciliation report containing original run/response hashes. Recovered usage does not retroactively erase a budget stop, repair contaminated stage attribution, or authorize a new run.
