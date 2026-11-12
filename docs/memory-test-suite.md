# Zenod memory test suite: three numbers for every change

Row E15-Q2 in [EPIC-15](memory-answers-quality-check-and-real-li.md). Jordi asked (voice note vn_f986ae4b, 8 Nov 2026) for his ingestion success rate, retrieval efficiency and error rate, and for a systematic test suite that shows how each change moves them.

Dashboard: http://vps3.taild81fbb.ts.net:8921/memory-tests/ (tailnet, no password). Code: [`scripts/memory-eval/`](../scripts/memory-eval/).

## The three numbers

| Number | Plain meaning | Exactly how it is counted |
|---|---|---|
| **Ingestion success rate** | Of the notes sent, how many landed properly | A voice note passes when every memory in it is (1) stored word for word in the Log, (2) written on a meaning page that cites the Log entry, (3) on the right page, or under the right tree branch when no single page is expected, (4) linked into the tree, with the page reaching a branch through its parents, and (5) done within 60 s on the demo vault, or 180 s on a large real vault. Nothing may be lost. An agent save passes when `store_memory` returns its evidence reference and `get_memory` reads it back. Rate = passing notes and saves ÷ all sent. |
| **Retrieval efficiency** | Does the right memory come up | The share of questions whose right memory is among the five shown, meaning the source note itself or a page that cites it. Questions come from the demo set, from questions about the notes just filed, and from an agent searching for what it saved. Also reported: mean reciprocal rank, median time per question, and tokens the answer step reads per question. |
| **Error rate** | How often something went wrong | Failed operations ÷ all operations. One operation is each memory filed, each question asked and each agent store-and-find pair. It fails when the capture errors, a memory is lost, unwritten, unlinked or in the wrong place, a question errors, takes over 10 s or the facts it needs never reach the answer step, or an agent cannot read back or find what it stored. |

Higher is better for the first two and lower for the third. A move under one point counts as "same".

## Suites

| Suite | Input | Checked against |
|---|---|---|
| Filing and categorisation | 16 made-up voice notes covering 12 shapes: short task, three-topic ramble, follow-up, names and dates, new topic, health, mixed Spanish and English, people, vague reference, venture, correction, recipe. 7 of them expect one existing page. | expected page or tree branch per memory |
| Graph building | 8 links that should be strong, from a page to its branch, and 4 pairs that should not be tied | link strength from `memoryCloud`, at least 0.7 when tied and under 0.5 when apart; before weighted links existed, the parent chain is used |
| Retrieval | 20 demo questions | expected source page |
| Answers | the same questions | the expected facts appear in what the answer step reads |
| Recall | 10 questions about the notes just filed | the new Log entry or a page it was filed on, in the top 5 |
| Agent insert and retrieve | 8 facts saved through MCP `store_memory`, then `get_memory` and `search_memory` | read back, and found in the top 5 |

## Two datasets

- **Demo vault**, in the repo, deterministic, no private data: the tree-vault fixture plus about 680 made-up pages ([`demo/gen_vault.py`](../scripts/memory-eval/demo/gen_vault.py)). Every page is made lint-clean the way Zenod writes pages.
- **Jordi's real notes**, private, on VPS3 only: his 45 real questions (`~/zenod-eval/real-questions.jsonl`, built by E15-Q1 and E12-S1b) run on a throwaway copy of his vault. The 8 notes behind the placements he judged on the trial page (`~/zenod-feedback`) are filed again, and a note fails if it lands on a page he said was wrong. Since E12-S27 his own checks in the app (Right place or Wrong place in the Memory tab, kept in his vault at `.brain/tree-corrections.jsonl` in the same record shape) are read too; a Wrong place there says the parent was wrong, so it rejects no page to file on. The agent save and find runs on his vault copy too. Only counts leave the machine.
- **Questions that ask by time** ("what was in my last voice note?", "what did I say today?", "yesterday", "on November 6"), as Zenod's own time words read them, are asked on his vault as it was at the question's `asOf` revision and with the clock stopped at its `asOf` moment (`--vault-git <clone>` gives the revision; the nightly passes its read-only clone). Their right answer changes honestly with every new note, so today's vault cannot score them (E12-S33: one new voice note on 9 Nov took two of them out and "yesterday" broke at each midnight). Every other question runs on today's vault. Without `--vault-git` they run on today's vault as before.

## The stand-in model, and what it does not measure

Every run uses a free, deterministic stand-in for the AI models ([`organiser.mjs`](../scripts/memory-eval/organiser.mjs)), so it can run on every change at no cost. The shared OpenRouter account is nearly empty (E15-A3).

- **Filing.** It sends each sentence to the candidate page that shares the most rare words with it. It sees exactly the candidates the code under test offers the real model, so it measures what Zenod's own code does: which pages it offers, whether the filing is kept, rescued, linked and saved in time. It does not judge meaning the way a model does.
- **Answers.** It records what the answer step was given and replies "no answer". The suite measures whether the facts reached the answer step. Whether a model then answers correctly is not measured.

Live-model checks made today are listed on the dashboard as recorded results, without being rerun. Examples: S6/S8 landing quality, E12-S1b round 2 blind-graded answers and E15-Q1.

## The live tier: the real model on a fixed slice (E15-Q3)

The stand-in shows what Zenod's code does; the live tier shows how a real model files and answers. Since E7-S3 iteration 3 (2026-11-12) it runs the models production runs: **Claude Haiku 5.5 files, Claude Sonnet 5.5 answers**. [`live.mjs`](../scripts/memory-eval/live.mjs) `stagingLive` sends each model call to `zenod-staging`'s `POST /api/credit/eval-call`, which makes it on staging's own Anthropic credit route under that account's monthly cap and returns the result and its price. No model key is on VPS3: the Anthropic key is per-app and stays in staging (Jordi 2026-11-12: "DO NOT CREATE A DUPLICATE KEY"). The endpoint exists only where the host sets `ZENOD_EVAL_RELAY=on` (staging; production never). Before that, the tier ran DeepSeek V4.1 Flash on a separate zenod-tests key (`--live-provider deepseek`, still in the code for history, no longer in the nightly).

- **Slice.** Jordi's 20 judged questions (`rq01`–`rq20`) and the 8 notes behind the placements he judged, on a throwaway copy of his vault. The agent store-and-find suite stays on the stand-in. The stand-in runs the same slice on the same code right after, so the dashboard shows both side by side.
- **Answers.** On top of the three numbers, each question checks that the model's own answer carries the expected facts. In the live tier, an answer that leaves them out counts as a failed operation in the error rate.
- **Cache.** Every model call is stored under a hash of what was sent, with run-specific parts (new Log anchors, dates, clock times, weekdays, temp paths) replaced by placeholders and swapped back on replay. A rerun on unchanged input makes no model call and costs nothing; replayed calls report the first run's model time.
- **Caps.** No call starts once this run's spend plus 1 cent per call in flight could pass the run cap ($0.60 for Claude), or the month's spend in the ledger `~/zenod-eval/live-claude/spend.jsonl` could pass the month cap ($2). Staging stops at its own $3 a month (`ZENOD_CREDIT_MONTHLY_USD`) whatever the client does. An item whose call was refused counts as not run, never as passed or failed.
- **Key.** None here. The run reads only the staging test tenant's token (`~/.config/zenod-staging/tenant-token`, 0600).
- **When.** In the nightly job, after the offline runs, once a week (a Claude run costs about 45 cents, mostly Sonnet answers), or with `nightly.sh --force`.
- **By hand, with no key:** `--model live --live-stub` runs the stand-in behind the same cache and caps at a fixed fake price, to prove the wiring.

## When it runs

- **Every pull request and push, in CI**: the demo suite, after the build. The run fails if the numbers drop below [`floor.json`](../scripts/memory-eval/floor.json). The three numbers appear in the job summary.
- **After every production roll, and nightly, on VPS3**: [`nightly.sh`](../scripts/memory-eval/nightly.sh), driven by the user timer `zenod-memory-tests.timer` every 30 min. It runs when the sha on `cloud.zenod.dev/api/health` changes, or once 24 h have passed since the last run. It runs both datasets, appends a dated record to `~/zenod-eval/history/`, and redraws the dashboard.
- **By hand**: `node scripts/memory-eval/run.mjs --checkout . --dataset demo` after `npm run build`.
- **Filing time** (E15-Q4): `node scripts/memory-eval/filing-profile.mjs --checkout . --demo` (or `--vault <copy> --from-log <Log refs>` for real notes on a private copy) files notes through the production capture-then-enrich path with the stand-in and prints, per note, the model calls, prompt tokens, host seconds and an estimated total at recorded DeepSeek speeds; `--latency-scale 1` makes the stand-in wait that long, so calls that overlap are timed as overlapping. To replay an old commit: `scripts/memory-eval/build-at.sh <repo> <sha> <dir> <installed checkout>`, then `--checkout <dir>`.
