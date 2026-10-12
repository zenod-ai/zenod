# SQLite hot-path query audit (2026-10-12)

## Rule

**No query on a request path, webhook, MCP tool, poll loop or timer may be O(table size).**
Every such statement must be bounded by an index range seek, a `LIMIT` on an index-ordered walk,
or a maintained aggregate. `node:sqlite` is synchronous, so an O(n) statement blocks Node's event
loop for the whole scan; Phylax burned a full core this way when `checkQuota` ran a `COUNT/SUM ... GROUP BY`
over the growing usage table on every request (fixed for `packages/mcp-chassis` in PR #1380, not
covered here).

Scope: `packages/server` and `packages/core` (about 60 tables in ~25 stores).
`packages/mcp-chassis/src/usage.ts` is owned elsewhere.

Method: every `prepare()` executed by the full server test-suite (1.3k tests) was captured and run
through `EXPLAIN QUERY PLAN`; statements flagged `SCAN` or using a low-selectivity index were then traced to
their callers (HTTP route, MCP tool, timer, startup) and classified. Plans below are from empty tables
(no `sqlite_stat1`), which is also what production uses since nothing runs `ANALYZE`.

## Offenders found and fixed

| # | Store / statement | Reachable from | Problem (before) | Fix |
|---|---|---|---|---|
| 1 | `whatsappStore.diagnostics()`: `COUNT(*)` x2, `GROUP BY processing_status`, `GROUP BY status` | `runtime.whatsapp.status()` -> `/api/whatsapp/status`, `/api/phylax/status`, Phylax management MCP (every poll) | Full scan of `whatsapp_messages` and `whatsapp_outbound_audit` per call (same class as #1380) | Trigger-maintained `whatsapp_status_counters`; one-time backfill on first open; counts are O(1) |
| 2 | `whatsappStore.lastActivity()`: `MAX(at)` over `UNION ALL` of both tables | same `status()` | Full scan of both tables | Two indexed `MAX()` seeks (`idx_whatsapp_messages_received`, `idx_whatsapp_outbound_audit_created`) |
| 3 | `whatsappStore` last inbound/outbound row, `recentNotifications` (`ORDER BY created_at DESC LIMIT 50`), `recentTranscript` window | status payload (`phylaxStatusPayload`) | Full scan + temp b-tree sort | Same two indexes |
| 4 | `whatsappStore` outbound audit by `message_id`, digest status by `contact_id`, follow-ups by `media_message_id`, media coalescing by `canonical_provider_message_id` (4 UPDATEs + SELECT), latest voice failure per tenant | transcript/digest tools, voice job lifecycle, Phylax status probe | `SCAN` of unbounded tables / `O(tenant jobs)` | Indexes `idx_whatsapp_outbound_audit_message`, `idx_whatsapp_messages_inbound_contact` (partial), `idx_whatsapp_media_followups_media`, `idx_whatsapp_media_coalescing_canonical`, `idx_whatsapp_voice_jobs_failure` (partial) |
| 5 | `phylaxAllowanceLedger.reconcileExpiredPeriodsInTransaction` | called inside capture accept, `admitPaidWork`, `claim*`, `resumePaused` (every paid-work operation) | Iterated **every ended period ever** (all tenants) and ran UPDATE + 2 SUMs per period: O(ledger history) per request | Visits only ended periods with positive balance or open (`captured`/`ready`) work, found through partial index + `phylax_paid_work_state_lease` |
| 6 | `phylaxAllowanceLedger.periodBalance` / `customerProjection` totals (`SUM(amount_units)` per period) | every paid-work admit/claim/complete, customer projection | O(entries in period) per call | Trigger-maintained `phylax_allowance_period_totals` (entries are append-only, verified: no UPDATE/DELETE); backfilled once. Ledger semantics unchanged |
| 7 | `phylaxAllowanceLedger.isSuspended`, `revision()` | projection / management mutations | Scan all tenant entries for latest suspend/resume / `MAX(sequence)` | `phylax_allowance_entries_suspension` (partial) and `phylax_allowance_entries_tenant_sequence` |
| 8 | `phylaxAllowanceLedger.reconcileExpiredPaidWork` (timer) | `PhylaxUsageMeter` sweep timer | `state='processing' AND lease_until<=?` walked the whole `(tenant,state,created_at)` index | `phylax_paid_work_state_lease (state, lease_until)` |
| 9 | `phylaxAllowanceLedger.tenantIds()` | `phylaxUnit` status route | `UNION` of three full covering-index scans | Skip-scan recursive CTE over the leading `tenant_id` index column: O(tenants) |
| 10 | `usageStore.summary()` operation aggregate | `/api/usage` and **`/api/usage/headroom` (polled by the watchdog)** | Planner chose `llm_usage_op` and scanned the whole index even for a 1h window | `INDEXED BY llm_usage_ts` so aggregates are range scans over the window; new `costSince()` (single `SUM`, no `GROUP BY`) for headroom |
| 11 | `usageStore.backfillCosts()` | startup | Loaded every `llm_usage` row into memory and re-priced them on **every boot** | Gated on a fingerprint of `PRICING`+pricing code (`llm_usage_meta`); runs in 2000-row keyset batches when the cost model changed |
| 12 | `journeyStore.dependenciesSatisfied` (`COUNT ... id IN (..) AND status='completed'`) | `claimDueSteps` (journey monitor poll) for every candidate step | Planner picked global `journey_steps_status_wake (status=?)`: O(all completed steps) per candidate (19 ms at 300k rows) | `+status` so the planner seeks by `journey_id`/`id` |
| 13 | `journeyStore.recent`, `artifactsByKind`; `ingestStore.recent`; `executionStore.recent`; `taskJobStore.recent` | list/recent endpoints and tools for journeys, ingest, execution tickets and task jobs | `ORDER BY ... LIMIT n` did full scan + temp-b-tree sort | Indexes on the sort column (`journeys_updated`, `journey_artifacts_kind_updated`, `ingest_jobs_created`, `execution_tickets_updated`, `task_jobs_tenant_created`) |
| 14 | `notificationStore.latestSentForGroup` | notification bus ordering guard on every notification | Walked `notifications_created` backwards filtering by `target_issue`: O(table) on a miss | `notifications_target_issue (target_issue, created_at)` |
| 15 | `heraldLoop.listApprovedTenantIds` (`SELECT DISTINCT tenant_id FROM herald_briefings`) | Herald scheduler tick | Full covering-index scan of all briefing versions | Skip-scan recursive CTE: O(tenants) |
| 16 | `phylaxUsageMeter.pending` / `reconcilePending` / `reconcileAllPending` | startup + ledger reconciliation | `booked_at IS NULL` over the unbounded booked history | Partial index `phylax_usage_compat_pending` (only unbooked rows) |
| 17 | `customerManagedAiAdmission.noticeCandidates` | managed-AI Telegram notice reconcile | `OR` over the whole admission table | Two partial indexes (pending notices only) + `id IN (... UNION ...)` |
| 18 | `phylaxChannels` capture journal: by `job_id`, by `provider_message_id`, receipts by `capture_provider_message_id`, undelivered-terminal-receipt recovery | capture status lookups, startup recovery | `SCAN` / walked all done+error jobs | Indexes + partial `idx_phylax_capture_jobs_undelivered` |
| 19 | `oauthStore.revokeClient` | OAuth admin | `SCAN oauth_tokens` | `idx_tokens_client` |

New indexes are `CREATE INDEX IF NOT EXISTS` (built once at first boot after deploy; builds are O(n) once, not per request).
The two trigger-maintained tables backfill only when first created.

## Reviewed and bounded by design (no change)

| Store | Statement(s) | Why it is fine |
|---|---|---|
| `authFailureLimiter` | `recent()` (index range on `(key, at)`), insert, `sweep()` `DELETE ... at <= ?` | Capped per key, swept every minute: table stays tiny. Request path is a covering-index range seek |
| `taskJobStore` / `taskJobQueue` | claim/next queued (`(tenant_id,status,created_at)`), lease expiry | Index equality + LIMIT 1; restart-recovery UPDATEs are startup-only |
| `ingestStore`, `executionStore` | queue by `status`/`state` index | Queue states hold only open work |
| `whatsappStore` voice jobs / media recovery / outbound intents | `(job_state, created_at)`, `(recovery_state)`, `(intent_state, receipt_eligible)` | Only non-terminal rows live in the probed states |
| `journeyStore.claimDueSteps`, `overdueSteps` | `journeys(status='active')` join, `(status, deadline_at)` | O(active journeys); verified by the test |
| `hostedChannels`, `callisthenesObservationLedger` (lookups), `zenodPhylax` operations, `credentialVault`, `mcpTokens` (`token_hash` UNIQUE), `oauthStore` tokens | PK / unique / tenant-prefixed index equality | |
| `credentialVault`, `tenants`, `zenod_phylax_bindings`, `mcp_clients`, `oauth_clients` full reads | Config-sized tables (one row per tenant/account/client), not traffic-sized | |
| `core/state/sqlite` approval tokens | Expired rows deleted on read; table holds live tokens only | |
| Startup-only recovery in `whatsappStore` (`UPDATE whatsapp_channel_audit ... lifecycle_state='forwarded'`, media coalescing `processing`), `taskJobStore` tenant backfill, `credentialVault` migrations, ring capture journal recovery | Run once at boot, not per request | Not on a request path; still O(n) at boot. Tracked in the follow-up issue |

## Known remaining O(n) paths (not behaviour-preserving to fix here)

| Path | Why deferred |
|---|---|
| `callisthenesObservationLedger.read(tenantId)`: returns **all** drafts and receipts for a tenant (per customer-layer request) | Needs pagination (API contract change) in an agent slated for extraction |
| `core/state/sqlite` `messages ... lower(text) LIKE '%term%'` (chat search tool) | Substring search cannot use a b-tree; needs FTS5 (not available in `node:sqlite` build) or a bounded recent window. User-initiated, `LIMIT`ed, but scans |
| `phylaxAllowanceLedger.operatorProjection` | Full per-tenant entry history by design (operator export); admin only |
| `whatsappStore` text search (`LIKE '%..%'` over `whatsapp_outbound_audit`) | Same as chat search; operator tool |

## Unbounded tables with no retention (no deletion added: production deletion is a human gate)

Only `auth_failures`, `approval_tokens`, `oauth_codes` and `herald_briefing_drafts` are ever pruned. These grow forever:

| Table(s) | Store | Growth driver |
|---|---|---|
| `llm_usage` | usageStore | one row per LLM call |
| `whatsapp_messages`, `whatsapp_message_media`, `whatsapp_outbound_audit`, `whatsapp_channel_audit`, `whatsapp_media_followups`, `whatsapp_media_coalescing`, `whatsapp_media_recovery`, `whatsapp_outbound_intents`, `whatsapp_voice_jobs`, `whatsapp_status_counters` (bounded: one row per status) | whatsappStore | every inbound/outbound message |
| `phylax_allowance_entries` (append-only ledger; archive, never delete), `phylax_allowance_periods`, `phylax_allowance_period_totals`, `phylax_paid_work`, `phylax_usage_compat` | phylaxAllowanceLedger / phylaxUsageMeter | every metered operation |
| `phylax_capture_jobs`, `phylax_capture_receipts`, `phylax_capture_conversations`, `phylax_transcription_results`, `ring_capture_job_authorities` | phylaxChannels / ringCaptureTicketProducer | every capture |
| `journeys`, `journey_steps`, `journey_events`, `journey_artifacts` | journeyStore | every journey |
| `notifications` | notificationStore | every notification |
| `ingest_jobs`, `execution_tickets`, `task_jobs` | ingestStore / executionStore / taskJobStore | every job |
| `herald_briefings`, `herald_wakes`, `herald_board_items`, `herald_filings` | heraldLoop | every wake |
| `calli_actions`, `calli_receipts` | callisthenesObservationLedger | every draft/send |
| `hosted_channel_mutations`, `managed_ai_downstream_outbox`, `customer_managed_ai_admission`, `zenod_phylax_allowance_operations`, `zenod_phylax_channel_operations` | hosted/managed-AI/Phylax stores | every mutation / admitted request |
| `messages`, `conversation_capture_tickets`, `chat_test_runs` | core state | every chat turn (only cleared on explicit `clearConversation`) |

With the indexes and aggregates above, none of these makes a hot path slower as it grows, but disk, backup size,
boot-time recovery scans and index build time all still grow. Retention is proposed in the linked issue.

## Regression harness

`packages/server/test/sqliteHotPath.test.ts`

1. **Plan assertions** (fast, deterministic): the hot-path methods of the usage, WhatsApp, allowance-ledger,
   journey, notification, ingest, execution, task-job and Herald stores are run under a `prepare()` spy; each
   statement's `EXPLAIN QUERY PLAN` must not `SCAN` an unbounded table, except an index-ordered walk with
   `LIMIT` and no sort. A self-test proves the checker flags a full scan. The journey dependency query is
   also asserted not to use the global status index.
2. **Time budgets** on seeded tables (500k `llm_usage`, 400k messages + 200k audits, 3k ended periods / 60k
   entries, 300k completed journey steps; seeded with one recursive `INSERT..SELECT`, about 4 s total).
   Budgets are 10-60 ms; the pre-fix code took roughly 20-110 ms on the same data (e.g. 112 ms for the
   ledger sweep), so they trip on a complexity regression, not on a slow runner.

To add a store: add its hot-path calls to the plan test and add any new unbounded table to `UNBOUNDED_TABLES`.
