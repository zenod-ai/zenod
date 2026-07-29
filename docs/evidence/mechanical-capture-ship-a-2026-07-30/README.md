# Mechanical Capture SHIP-A — 2026-07-30

Live acceptance candidate: `080f985b0e7a4638f65f4b5a443d7d51fa823fa6`

Tenant: `github-63050995`

Result: steps 1–10 passed uninterrupted in sequence.

## Uninterrupted lap

| Step | Live observation | Evidence |
|---|---|---|
| 1 | Forwarded a fresh provider instance of the 24:14 acceptance voice note at 01:17 CEST. | `step-01-fresh-24m14s-voice-note-sent.png` |
| 2 | Phylax replied that the note was queued for transcription within seconds. | `step-02-progress-message-within-seconds.png` |
| 3 | STT completed successfully; no fallback or silent placeholder appeared. | `step-03-stt-succeeded-no-silent-fallback.png` |
| 4 | Provider message `3EB05E7CA6885B94A71DDD` produced one durable job row and one receipt row. Recovery produced no duplicate memory. | `step-04-durable-idempotent-job-proof.png` |
| 5 | Job `28165f58-8036-4b79-b67d-616ed0b1b2df` was observed in `polling` before a forced Phylax restart. Replacement container `be426bd33059` resumed the same job and its receipt arrived. | `step-05-persisted-job-survived-phylax-restart.png` |
| 6 | The terminal Saved receipt linked page, evidence `Log/2026-07-29.md#^e-3a77f3`, and commit `e5715bf407c604d2353b328c8007a0403637b4a9`. The opened Log shows `verbatim: yes` and the anchored transcript. | `step-06-terminal-receipt-saved-pages-commit-evidence.png`, `step-06b-opened-commit-verbatim-transcript-anchor.png` |
| 7 | A structural reply to the receipt asking “what were the open questions in that note?” returned all four questions and cited `^e-3a77f3`. | `step-07-evidence-scoped-ask-brain-answer.png` |
| 8 | Authenticated live `tools/list` on the channel credential returned exactly `ask_brain`, `chat_with_zenod`, `get_task_result`, `ingest_memory`, `search_memory`, and `store_memory`; no action tools. | `step-08-memory-scoped-tools-list.png` |
| 9 | Killing the live Meta socket produced `degraded/retry_wait` generation 2, `handshake` generation 3, then `connected/ready` in about three seconds. A fresh 24-second recovery note returned a Saved receipt. | `step-09-watchdog-recovery-fresh-short-note-receipt.png` |
| 10 | Fifteen minutes after the connected generation-3 baseline at `2026-07-29T23:27:13.481Z`, generation and `lastConnectedAt` were unchanged; the path remained connected/ready, restart remained false, and the worker heartbeat advanced. | `step-10-natural-quiet-no-restart.png` |

## Structural evidence

The companion `ship-a-structural-proof.html` records the sanitized job, restart, scoped-catalog, watchdog, and quiet-window facts without credentials or transcript content.

The pre-lap D19 probe is retained separately as `probe-d19-e-a7f53e-answer-intact.png`; it is not counted as a SHIP-A lap step.
