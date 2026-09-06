# ZMR-8 release validation — rejected first candidate

Issue [#1196](https://github.com/zenod-ai/zenod/issues/1196). Tester `/root/zmr_8_release_validation`; parent `/root` owns integration, the final browser journey and the ZMR spine. Prepared 2026-09-06, local macOS / Node 22.22.3 / Vitest 4.1.10.

**NOT SHIP and NOT deploy-ready.** Product candidate `3f5ba097a8d287cdb9ae4468251bc42563e7e7a3` passes existing MCP safeguards but fails three customer streaming-chat acceptance checks. The tester reported them immediately for a bounded repair. Real-model and live-browser acceptance are unmeasured. No deployment, live vault mutation, backup operation, real send, billing, signup or provider change was performed.

## Exact source and reproducibility

Worktree `/Users/jordi/Documents/GitHub/wt-zmr-8`, branch `codex/zmr-8`, pinned product above. The initial HTTP reproducer is test-only commit `f850aa0`; subsequent changes add reporting and evidence only. No `packages/*/src` file was edited. Do not use this rejected candidate's digests to deploy a later repaired candidate.

Frozen ground truth is the unchanged [ZMR-1 manifest](../../../packages/server/test/fixtures/zmr/manifest.json) and generator. All six repeated runs retain the exact original per-file fixture hashes. There are 656 seeded captures plus one inherited citation entry; the old bounded range contains exactly five refs. Provider lanes are a real local Git repository/bare origin and the existing in-memory Drive persistence double. Neither exercises a remote provider or production tenant.

Commands:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
node --test scripts/*.test.mjs
node scripts/build-tool-output-schemas.mjs --check
npm run test -w @zenod/server -- test/zmrReleaseChat.test.ts
node scripts/zmr-release-validation.mjs
```

The full suite ran once with production sources pinned to `3f5ba09`; the HTTP reproducer was created while earlier workspace suites ran and was included by the later server suite. Core: 637 pass / 6 skipped; chassis: 92 pass; server: 1,253 pass / 2 fail; other workspace suites: 159 pass. The only failures are the initial two new customer HTTP assertions below; a later focused temporal regression adds a third failure. Top-level `npm test` exits nonzero and therefore does not reach its chained script/schema steps; those were run explicitly: 195/195 script tests and 27/27 bundled schemas pass. All-workspace typecheck passes.

Exact-main [CI 34049036816](https://github.com/zenod-ai/zenod/actions/runs/34049036816) passes without the new reproducer; that does not override the release failure. Paired [publish 34049036814](https://github.com/zenod-ai/zenod/actions/runs/34049036814) passes, including image smoke. Local browser acceptance has not been claimed from an HTTP fixture.

## Customer-path integration findings

[Reproducer](../../../packages/server/test/zmrReleaseChat.test.ts) uses authenticated `POST /api/chat/stream`, the real `createApp`, `engine.chat`, state store and frozen fixture. Only the LLM is scripted. Each test has an isolated runtime/vault. The unauthenticated request gets HTTP 401.

| Check | Result | Evidence / implication |
|---|---|---|
| Late exact evidence passage, anchored Drive source, no neighboring color entry | PASS | `cobalt-seventeen` is reachable beyond character 8000 through customer streaming chat. |
| Typed entry enumeration available in customer memory loop | FAIL | `searchEntries` is absent. `engine.chat` constructs `readTools()` without the typed-entry option enabled for `ask_brain`. A customer cannot rely on the new full historical catalog through this seam. |
| Temporal unknown status remains unknown in customer chat | FAIL | Actual `readFacts` on a legacy note returns no facts and unknown warnings; the draft `Production is definitely broken and live verified` is returned unchanged. Ask's temporal projection/finalization is bypassed. |
| Reject an unread model-supplied citation and unsupported unknown answer | FAIL | The model performs no read, supplies a real-looking `readPaths` ref and says `imaginary-payroll`; customer chat returns both the claim and model-derived source. `engine.chat` bypasses ask's host evidence finalization. |

The required fix must preserve normal tasking/write authority while sharing the memory read, coverage, grounding and temporal safeguards on the actual customer path. Tester did not implement a fix or weaken these assertions. Final focused HTTP run: **1 pass / 3 fail** across four tests; the unread-source test separately proves both fabricated text and the unread source leak. The full suite was not rerun for this added narrow probe. Probability of a real model triggering the adversarial case is unmeasured; the deterministic boundary failure is proven. Review should also cover the nonstreaming route's tasking path, not silently equate `/api/chat` and `/api/chat/stream`.

## Frozen-case ledger and measurement limits

[Machine ledger](results/ledger.json), with individual provider reports under `results/trial-{1,2,3}/`, records three fresh Vitest processes. Every process creates fresh provider vaults and SQLite state; each public `ask_brain` call is stateless. This is three independent **scripted access trials**, not three independent real-model conversations.

| Dimension | Observed local evidence | Release quality verdict |
|---|---|---|
| Fixed literal answer availability | 24/24 cases including access word, historical amber, current violet and unknown | Scripted extraction/abstention only; model correctness unmeasured. |
| Held-out paraphrase | 6/6 scripted traversals reach violet; raw lexical search returns 0 hits in all six | Observer already knows the daily-log path. Autonomous recall/generalization unmeasured; zero lexical hits explicitly retained. No tuning against the held-out prompt. |
| Required source identity | 24/24 non-unknown outputs include the frozen expected ref | Identity availability, not universal semantic entailment. Extra read sources remain in some outputs. |
| Unknown / false absence | Scripted unknown in all six unknown trials | Observer reads the log and the returned source list contains six read refs; these are **not supporting evidence for a payroll provider**. No claim of zero irrelevant citations or model abstention is made. False exhaustive/unknown safeguards are separately exercised by existing public ZMR-4 regressions. |
| Deterministic pagination / identity / isolation | Existing ZMR passage/history/ask/fact suites pass in full server/core run | Customer parity failures above still block the whole release. |
| Per-topic filing and summary bounds | Two clear pages plus isolated uncertainty, intact raw memory and ≤480-character classifier summary in all six baseline runs | Real model topic classification/alias quality unmeasured. |
| Current-versus-historical facts | Existing both-provider ZMR-7 public tests pass, including reversed correction and unrelated verification regressions | Host temporal projection passes; autonomous fact proposal and customer temporal handling need repaired-candidate evaluation. |
| p50/p95 model latency, token usage and dollars | `null` | No model API calls. Individual local seam durations are retained only as harness timing, never remote-provider latency/cost. |

No live customer corpus, new held-out tuning set, embeddings, reranker or maintenance job was introduced. ZMR-9/10 remain deferred until Jordi's SHIP acceptance.

## Real-model preflight and next input

The inherited local environment has no configured supported provider API key; neither worktree root nor shared repository root has a runtime `.env` (only `.env.tenant.example`). The existing baseline explicitly instantiates `Observer`, not `AiSdkLlm`. Runtime source normally obtains `provider`, `model_ask`, `model_classify` and `model_max_steps` from the settings store; `AiSdkLlm` supports actual billed token reporting through `onUsage`. No production credential was extracted or copied.

Before the mandatory real-model run, Jordi must identify an already approved test provider/account, exact ask/classify model IDs and step settings, provide its key through the existing secure local configuration, and authorize an explicit spending ceiling. Recommendation: use the same existing provider/models as the intended tenant in an isolated synthetic local vault; do not introduce a provider or use personal memories. This approval authorizes only those synthetic calls, not deployment or live data changes. If an already authorized local test configuration exists elsewhere, provide its secure location; the tester can inspect presence/settings without printing its key.

After configuration, record exact models/settings, per-attempt usage including failures, real output and read traces, wall-clock timings, cost basis, three fresh conversations per fixed question, separate untouched held-out results and abstention. A missing usage record stays unknown. Do not substitute this deterministic ledger for those measurements.

## Deployment ordering reconciliation

`PRODUCTION-READINESS.md` still describes one universal image and public-first rollout. Foundation/Phylax Current State still says the original commercial values are awaiting approval. Both are stale for current live topology: [#1112's 2026-08-28 rollout receipt](https://github.com/zenod-ai/zenod/issues/1112) records Jordi's explicit closed-production approval, dedicated Phylax first, Zenod second and the commercial values deployed. Current read-only Swarm inspection confirms dedicated Phylax and the existing management/allowance configuration. The old 14-key addition packet must **not** be replayed and the same commercial approval must **not** be requested again.

If a repaired ZMR candidate updates both artifacts, use the current separate-artifact private-first/public-second contract; rollback public first, private second. The old `zal22-production-rollout.sh` cannot represent this topology. If release scope is Zenod-only, parent must explicitly record that target set and compatibility evidence before the exact gate. No sibling spine was edited.

The first candidate published these immutable OCI indexes (workflow evidence; not deployment):

| Artifact | Tag | OCI index |
|---|---|---|
| Zenod | `ghcr.io/zenod-ai/zenod:sha-3f5ba09` | `sha256:c2ac2e943807c3ab67282cfec3e6456407e3f424457be37e024879d2f3e322c2` |
| Phylax | `ghcr.io/zenod-ai/phylax:sha-3f5ba09` | `sha256:96fdfde7ae329e2dd9179909bd9e8bb4d5ddff06b67f123a9f8e2b968281329e` |

These artifacts are rejected for release pending the customer fix. Freeze new exact source/digests after integration and repeat affected acceptance; never relabel this evidence as testing a newer build.

## Live baseline, rollback and backup evidence

Read-only inspection on 2026-09-06: public `zenod-mt-fxpzoo` (Dokploy app `2dkayH_eAur427leH64MT`) is configured as `zenod:sha-fb8b07c`; public health reports full `fb8b07c5910b3424c4a15da4e1cfaa920cee4e22`. Private `app-index-back-end-panel-6zm3qg` (app `urbFsgl6eImbQ4MTIZl5N`) is already `phylax@sha256:1ae6607fb5cabf059a7058ae0b80abc2a492dab32d034b903dc920b73759b53e`. Both have one running task and unchanged `zenod-mt-data:/data` / `phylax-data:/data` mounts. This is read-only metadata, not a full tenant/session journey.

The running public image resolves to `ghcr.io/zenod-ai/zenod@sha256:c4d5fbf98818ca407ef445159965143cffc519a38f6c63e4e8c4f04230ba286d` with OCI revision `fb8b07c5910b3424c4a15da4e1cfaa920cee4e22`; private OCI revision is `abfd75d35a74e0d18aa7267d6d349d5f7c329cc9` and runtime label `phylax-only`. Both public signup flags are `0`. These exact current digest references, not the old universal fallback, are the normal pre-release rollback pair. The public backup-restore environment timestamp is `2026-08-30T15:22:23Z`; this is metadata only, not inspection of its archive or restore receipt.

Current canonical effective environment hashes: public `4cbcc353526ad695acedad58ca44b1d618024fe6247eeffcfcb6cdaa303c3f5f`; private `43e9520e682d0d4f0d1d02c3f0985f502a7cd9dbbe76e27e35b25bc0811f9ec5`. No secret values are retained in this packet. Public includes a runtime `GIT_SHA=fb8b07c…` override; the approved future delta must remove that stale override or replace it with the exact candidate SHA, otherwise health can misrepresent the image. ZMR memory changes otherwise introduce no new environment key or data migration. Existing provider keys, commercial settings, tokens, sessions, mounts and signup flags are preserved exactly.

Historical backup proof exists in the August ZAL-22 receipt and #1112's later Gate A manifest (`/var/tmp/zenod-zpf10-20260827T220420Z-zpf10/gate-a-manifest.json`). Those are dated evidence, not fresh backups for this release. No archive was created, decrypted, copied or restored by this tester. Fresh approved snapshot/checksum/isolated restore/off-host verification remains necessary before any live customer data mutation or deployment that requires it. Reconcile the actual current backup receipt and destination before requesting backup quiescence; do not use old scripts with an assumed universal verifier image.

Normal rollback pins the exact pre-release images and restores captured environment values while preserving both data volumes. Data restore is separately approved only for demonstrated corruption, into a new verified volume, retaining the original. Never overwrite a live volume as code rollback.

## Reviewable human test package (execution pending)

Parent first repairs/reviews/integrates the customer gap, completes real-model acceptance and freezes one candidate with source, image digests, target applications, exact redacted config delta, current rollback references and fresh verified backup evidence. Only then request Jordi's exact deployment approval. This packet itself grants none.

On the approved live candidate, parent personally opens the existing customer surface with an isolated approved synthetic tenant and walks, uninterrupted:

1. Capture the frozen long multi-topic input; wait for a terminal receipt; open its immutable evidence and compare complete bytes.
2. Open both clear meaning pages and the uncertainty receipt; verify only the ambiguous topic is unresolved, unrelated knowledge remains and summaries are bounded.
3. Ask the frozen late-access question; open its exact cited passage and reject any neighboring-entry leakage.
4. Ask the older bounded date-range audit in the 657-entry fixture; traverse all pages and reconcile exactly five old refs with complete coverage.
5. Supply the explicit correction; ask current and original facts independently; open the appropriate correction/historical citations and distinguish unknown verification from live truth.
6. Ask the untouched paraphrase and unsupported payroll question in three independent conversations each; collect actual source support, correct answer/abstention and model usage. Repeat the other fixed questions three times as well.
7. Record URL, immutable candidate SHA, timestamp, evidence refs, one screenshot per step and full pass/fail ledger. Stop at the first failure; route a bounded fix, obtain any new deployment approval and restart step 1.

Only after that clean same-build pass may parent write “I manually walked the full journey and it works” and hand Jordi the same URL/journey: “Now you test.” Human SHIP acceptance remains unchecked. No clickable live action has been represented as already exercised.
