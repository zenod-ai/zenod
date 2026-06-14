# Session Log Forensics — Reconstructing a WhatsApp Interaction

How to reconstruct, after the fact, exactly what happened during a single
WhatsApp interaction (which message, which LLM calls, how long each took, why a
reply was slow). Written after diagnosing a 4-minute reply (see the worked
example at the bottom).

## TL;DR

`docker logs` is **not** the primary source — the engine path is almost silent
and logs are lost on container recreate. The real timeline is reconstructed by
cross-referencing two SQLite DBs on the `/data` volume:

- `/data/whatsapp/whatsapp.sqlite` — inbound message + outbound reply audit
  (gives the user-visible latency: `received_at` → reply `created_at`).
- `/data/usage.sqlite` — the `llm_usage` ledger (gives the per-LLM-call
  timeline *inside* that window, labelled by `operation`).

## Where things live

- App container: `zenod-uqe3bx.1.<taskid>` on the Dokploy VPS
  (`hetzner_vps_1` / 49.13.24.121). Find it with
  `docker ps --format '{{.Names}}' | grep zenod` (the site + agent-runner also match).
- Data volume `/data` holds the SQLite DBs. There is **no `sqlite3` CLI and no
  `better-sqlite3`** in the image — query with Node's built-in `node:sqlite`
  (`DatabaseSync`, `readOnly: true`).
- `docker logs -t <container>` only covers the **current** container instance
  (a deploy/recreate wipes it). Container start:
  `docker inspect -f '{{.State.StartedAt}}' <container>`. If the interaction
  predates that, the stdout logs are gone — the SQLite ledgers survive on the
  volume regardless.

## Step 1 — find the message + measure the user-visible latency

```sh
ssh hetzner_vps_1 'docker exec <container> node -e "
const { DatabaseSync } = require(\"node:sqlite\");
const iso = t => new Date(typeof t===\"number\" ? (t<2e10?t*1000:t) : t).toISOString();
const w = new DatabaseSync(\"/data/whatsapp/whatsapp.sqlite\", { readOnly: true });
for (const r of w.prepare(\"SELECT message_id,direction,received_at,processing_status,substr(body_text,1,60) b FROM whatsapp_messages ORDER BY received_at DESC LIMIT 8\").all().reverse())
  console.log(iso(r.received_at), r.direction, r.processing_status, r.message_id, JSON.stringify(r.b));
for (const r of w.prepare(\"SELECT created_at,status,message_id,substr(body_text,1,70) b FROM whatsapp_outbound_audit ORDER BY created_at DESC LIMIT 8\").all().reverse())
  console.log(iso(r.created_at), r.status, \"replyto=\"+r.message_id, JSON.stringify(r.b));
"'
```

`whatsapp_outbound_audit.message_id` is the **inbound** id being replied to.
Match it to `whatsapp_messages.received_at` → that delta is the latency the user
felt. (`whatsapp_messages.message_timestamp` is WhatsApp's send time, whole
seconds; `received_at` is when the server got it — use `received_at`.)

## Step 2 — see where the time went (the LLM ledger)

```sh
ssh hetzner_vps_1 'docker exec <container> node -e "
const { DatabaseSync } = require(\"node:sqlite\");
const iso = t => new Date(t).toISOString();
const u = new DatabaseSync(\"/data/usage.sqlite\", { readOnly: true });
for (const r of u.prepare(\"SELECT * FROM llm_usage ORDER BY id DESC LIMIT 40\").all().reverse())
  console.log(iso(r.ts), r.operation, r.provider+\"/\"+r.model, \"in=\"+r.input_tokens, \"cached=\"+(r.cached_input_tokens||0), \"out=\"+r.output_tokens, \"\$\"+(r.cost_usd||0).toFixed(4));
"'
```

`llm_usage.ts` is logged when each call **completes**. Interleave these rows
into the Step-1 window and the per-operation gaps reveal the bottleneck. The
`operation` label tells you which engine phase it was:
`answer` (the agentic tasking loop, one row per `llm.answer()` call — it covers
the whole multi-step loop and logs at the end), `classify` / `compose` /
`extractBacklog` (the librarian `store()` pipeline), `chat`, etc.

Output tokens are usually the cost driver on slow tiers: a `compose` of a few
thousand output tokens on a free OpenRouter tier can take ~50 s.

## Step 3 — confirm against stdout (best-effort)

```sh
ssh hetzner_vps_1 'docker logs -t <container> 2>&1' | grep -E "whatsapp|markRead|AI SDK Warning"
```

What you get today: one `[whatsapp][diag] markRead key=...` per inbound read,
and one `AI SDK Warning: System messages...` per `generateText`/`answer` call.
Useful only as a coarse cross-check on timing — Baileys also dumps noisy
`Closing session: SessionEntry {...}` blocks. There are **no** engine/tool/
timing logs on the tasking path.

## Known limits (and how to improve logging)

The reconstruction above works but is harder than it should be. Gaps:

1. **`llm_usage` has no correlation id** — no message/conversation/trace id, so
   tying an LLM call to a specific WhatsApp message relies on timestamp
   proximity. Add a `trace_id` (and/or `conversation_id`) column populated from
   the inbound message id, threaded through `handleTasking` → `store()` → each
   `llm.*` call.
2. **No per-phase timing on the tasking path.** Wrap `handleTasking` and each
   tool (`captureNote`/`store`, `createIssue`, `extractBacklog`) in timed,
   structured log spans keyed by the message id, e.g.
   `[whatsapp][timing] <msgId> handleTasking=Nms store=Nms createIssue=Nms`.
   Today the only way to see a 4-minute reply's breakdown is the usage DB.
3. **Stdout logs die on deploy/recreate.** `docker logs` is wiped when the
   container is recreated (every push redeploys). Persist structured logs to the
   `/data` volume or an external sink if post-mortem on older interactions
   matters.
4. **Engine path is effectively silent.** `engine.ts` emits no log lines; only
   `[whatsapp][diag]` and opt-in `[llm-usage]`/`[llm-cost]` (gated on
   `ZENOD_LLM_COST_LOG`) exist. Consider a single structured JSON line per phase
   transition so a normal `docker logs | grep <msgId>` tells the whole story
   without reaching into SQLite.
5. **`processing_status` is coarse** (`inbound` → `replied`). It doesn't capture
   the intermediate states (filing vs. issue-creation vs. composing) that would
   let you see *what* a still-pending message is stuck on.

## Worked example (2026-06-14, the 4-minute reply)

Inbound `3B9BCE449F01BF6F9E34` "create the issue in the obsidian repo…" at
21:33:53 UTC → reply at 21:37:43 UTC (**3 m 51 s**). The `llm_usage` rows in that
window: `classify` 21:35:17 (out 1467), `compose` 21:36:08 (out 4580),
`extractBacklog` 21:37:37 (out 2199), final `answer` 21:37:43 (out 1535) — all
`openrouter/minimax/minimax-m3` at $0.0000 (free tier). Conclusion: the full
librarian `store()` + backlog digestion (~2 m 20 s) ran **synchronously on the
reply path** before the issue was even created, on a slow free-tier model. The
fix is to move filing/digestion off the critical path and add a two-stage
"queued → done" reply.
