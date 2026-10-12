import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { ExecutionStore } from "../src/executionStore.js";
import { HeraldLoopStore } from "../src/heraldLoop.js";
import { IngestStore } from "../src/ingestStore.js";
import { JourneyStore } from "../src/journeyStore.js";
import { NotificationStore } from "../src/notificationStore.js";
import { PhylaxAllowanceLedger } from "../src/phylaxAllowanceLedger.js";
import { TaskJobStore } from "../src/taskJobStore.js";
import { UsageStore } from "../src/usageStore.js";
import { WhatsAppStore } from "../src/whatsappStore.js";

/**
 * SQLite hot-path regression harness (docs/evidence/sqlite-hot-path-audit-2026-10-12.md).
 *
 * Rule: no query on a request path or a polled path may be O(table size). Phylax once burned a
 * core because a per-request COUNT/SUM GROUP BY walked a growing table on the event loop.
 *
 *  1. EXPLAIN QUERY PLAN assertions (fast, deterministic): every statement the hot paths prepare
 *     must not SCAN an unbounded table, except an index-ordered walk with LIMIT and no sort.
 *  2. Time-budget assertions on tables seeded with hundreds of thousands of rows, for the paths
 *     that were offenders (budgets are generous multiples of the measured cost, so they only
 *     trip on a complexity regression, not on a slow CI box).
 */

/** Tables that grow with traffic and have no retention, or are otherwise not small config. */
const UNBOUNDED_TABLES = new Set([
  "llm_usage",
  "whatsapp_messages",
  "whatsapp_outbound_audit",
  "whatsapp_media_followups",
  "whatsapp_media_coalescing",
  "whatsapp_channel_audit",
  "whatsapp_voice_jobs",
  "phylax_allowance_entries",
  "phylax_allowance_periods",
  "phylax_paid_work",
  "journeys",
  "journey_steps",
  "journey_artifacts",
  "journey_events",
  "notifications",
  "ingest_jobs",
  "execution_tickets",
  "task_jobs",
  "herald_briefings",
  "herald_board_items",
]);

type Captured = { sql: string; plan: string[] };

/** Records the query plan of every SELECT/UPDATE/DELETE prepared while `run` executes. */
function capturePlans(run: () => void): Captured[] {
  const original = DatabaseSync.prototype.prepare;
  const captured: Captured[] = [];
  const seen = new Set<string>();
  DatabaseSync.prototype.prepare = function patched(this: DatabaseSync, sql: string) {
    const statement = original.call(this, sql);
    const normalized = String(sql).replace(/\s+/g, " ").trim();
    if (/^(select|with|update|delete)/i.test(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      try {
        const plan = (original.call(this, `EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>).map(
          (row) => row.detail,
        );
        captured.push({ sql: normalized, plan });
      } catch {
        // Statements that cannot be explained without bound context are not hot-path candidates.
      }
    }
    return statement;
  } as typeof DatabaseSync.prototype.prepare;
  try {
    run();
  } finally {
    DatabaseSync.prototype.prepare = original;
  }
  return captured;
}

/** Offending plan lines: a SCAN of an unbounded table that is not a bounded, index-ordered LIMIT walk. */
function offenders(captured: Captured[]): string[] {
  const found: string[] = [];
  for (const { sql, plan } of captured) {
    const sorts = plan.some((line) => /TEMP B-TREE/.test(line));
    for (const line of plan) {
      const match = /^SCAN (\w+)(?: AS \w+)?(?: (USING .*))?$/.exec(line);
      if (!match) continue;
      const table = match[1]!;
      if (!UNBOUNDED_TABLES.has(table)) continue;
      const indexOrderedLimit = /USING INDEX/.test(line) && /\bLIMIT\b/i.test(sql) && !sorts;
      if (!indexOrderedLimit) found.push(`${line}  <=  ${sql.slice(0, 160)}`);
    }
  }
  return found;
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tmp(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `zenod-hotpath-${name}-`));
  dirs.push(dir);
  return join(dir, `${name}.sqlite`);
}

function timeMs(run: () => void, repeat = 3): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < repeat; i += 1) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/** Bulk-seeds `count` rows with one recursive INSERT..SELECT through a second connection. */
function seed(path: string, sql: string, count: number): void {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 30000");
  db.exec("BEGIN");
  db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) ${sql}`).run(count);
  db.exec("COMMIT");
  db.close();
}

describe("SQLite hot-path query plans (no SCAN of unbounded tables)", () => {
  it("usage store: headroom, /api/usage summary and timeline are index-range queries", async () => {
    const store = new UsageStore(await tmp("usage"));
    const plans = capturePlans(() => {
      store.costSince(0);
      store.summary(0);
      store.timeline({ sinceMs: 0 });
    });
    expect(plans.length).toBeGreaterThan(0);
    expect(offenders(plans)).toEqual([]);
    store.close();
  });

  it("whatsapp store: status/diagnostics and lookup paths never scan message or audit history", async () => {
    const store = new WhatsAppStore(await tmp("whatsapp"));
    const plans = capturePlans(() => {
      store.lastActivity();
      store.diagnostics();
      store.latestDigestStatusForContact("491700000000");
      store.recentNotifications({ limit: 50 });
      store.recentTranscript({});
      store.followUpsForMedia("media-1");
      store.latestVoiceFailure("tenant-1");
    });
    expect(plans.length).toBeGreaterThan(0);
    expect(offenders(plans)).toEqual([]);
    store.close();
  });

  it("allowance ledger: projection, sweeps and tenant inventory avoid history scans", async () => {
    const store = new PhylaxAllowanceLedger(await tmp("ledger"));
    const plans = capturePlans(() => {
      store.customerProjection("tenant-1");
      store.tenantIds();
      store.reconcileExpiredPeriods();
      store.reconcileExpiredPaidWork();
      store.revision("tenant-1");
      store.claimNextPaidWork("tenant-1", "worker-1", 1000);
    });
    expect(plans.length).toBeGreaterThan(0);
    expect(offenders(plans)).toEqual([]);
    store.close();
  });

  it("journey, notification, ingest, execution, task and herald stores poll via indexes", async () => {
    const journeys = new JourneyStore(await tmp("journeys"));
    const notifications = new NotificationStore(await tmp("notifications"));
    const ingest = new IngestStore(await tmp("ingest"));
    const execution = new ExecutionStore(await tmp("execution"));
    const tasks = new TaskJobStore(await tmp("tasks"));
    const herald = new HeraldLoopStore(await tmp("herald"));
    const journey = journeys.create({ surface: "test", originalRequest: "plan check" }, 100);
    const first = journeys.addStep(journey.id, { owner: "archus", title: "first" }, 110);
    journeys.addStep(journey.id, { owner: "epaminon", title: "second", dependencyIds: [first.id] }, 120);
    journeys.dispatchStep(first.id, {}, 130);
    journeys.completeStep(first.id, {}, 140);
    const plans = capturePlans(() => {
      journeys.claimDueSteps(1_000_000);
      journeys.overdueSteps();
      journeys.recent();
      journeys.artifactsByKind("github_issue");
      notifications.latestSentForGroup("zenod#1", null);
      notifications.latestSentByDedupeKey("k");
      notifications.recent();
      ingest.recent();
      execution.recent();
      tasks.recent();
      tasks.nextQueued();
      herald.listApprovedTenantIds();
    });
    expect(plans.length).toBeGreaterThan(0);
    expect(offenders(plans)).toEqual([]);
    // The dependency check must seek by journey/id, never by the (global, low-selectivity) status index.
    const dependencyPlan = plans.find((entry) => /COUNT\(\*\) AS completed FROM journey_steps/.test(entry.sql));
    expect(dependencyPlan).toBeDefined();
    expect(dependencyPlan!.plan.join(" | ")).not.toMatch(/journey_steps_status_wake/);
    for (const closable of [journeys, notifications, ingest, execution, tasks, herald]) closable.close();
  });

  it("the harness itself flags a full scan (guards against a vacuous pass)", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE llm_usage (id INTEGER PRIMARY KEY, operation TEXT)");
    const plans = capturePlans(() => {
      db.prepare("SELECT COUNT(*) FROM llm_usage WHERE operation = ?").get("x");
    });
    expect(offenders(plans)).toHaveLength(1);
    db.close();
  });
});

describe("SQLite hot-path time budgets on large seeded tables", () => {
  it("usage: headroom and 1h summary stay fast with 500k historical rows", async () => {
    const path = await tmp("usage-big");
    const store = new UsageStore(path);
    const now = Date.now();
    // 500k rows older than 2 days, then 50 rows inside the last hour.
    seed(
      path,
      `INSERT INTO llm_usage (ts, operation, provider, model, input_tokens, output_tokens, cost_usd)
       SELECT ${now} - 172800000 - i * 100, 'op' || (i % 20), 'anthropic', 'claude-sonnet-4', 10, 10, 0.001 FROM n`,
      500_000,
    );
    seed(
      path,
      `INSERT INTO llm_usage (ts, operation, provider, model, input_tokens, output_tokens, cost_usd)
       SELECT ${now} - 1000 * i, 'recent', 'anthropic', 'claude-sonnet-4', 1, 1, 1.0 FROM n`,
      50,
    );

    const since = now - 60 * 60 * 1000;
    const headroomMs = timeMs(() => store.costSince(since));
    const summaryMs = timeMs(() => store.summary(since));
    expect(store.costSince(since)).toBeGreaterThan(0);
    expect(headroomMs).toBeLessThan(40);
    expect(summaryMs).toBeLessThan(60);
    store.close();
  }, 120_000);

  it("whatsapp: status diagnostics are O(1) with 400k messages and 200k audits", async () => {
    const path = await tmp("whatsapp-big");
    const store = new WhatsAppStore(path);
    seed(
      path,
      `INSERT INTO whatsapp_messages (message_id, chat_id, contact_id, direction, message_timestamp, body_text, processing_status, received_at)
       SELECT 'm' || i, 'chat' || (i % 500), 'c' || (i % 500), 'inbound', i, 'hello', CASE WHEN i % 10 = 0 THEN 'replied' ELSE 'ignored' END, 1700000000000 + i FROM n`,
      400_000,
    );
    seed(
      path,
      `INSERT INTO whatsapp_outbound_audit (audit_id, message_id, chat_id, status, created_at)
       SELECT 'a' || i, 'm' || i, 'chat' || (i % 500), 'sent', 1700000000000 + i FROM n`,
      200_000,
    );
    const diagnostics = store.diagnostics();
    expect(diagnostics.inboundMessages).toBe(400_000);
    expect(diagnostics.outboundAudits).toBe(200_000);
    expect(diagnostics.processingCounts).toEqual({ replied: 40_000, ignored: 360_000 });
    expect(diagnostics.outboundCounts).toEqual({ sent: 200_000 });
    expect(store.lastActivity()).toBe(1700000000000 + 400_000);

    expect(timeMs(() => store.diagnostics())).toBeLessThan(25);
    expect(timeMs(() => store.lastActivity())).toBeLessThan(10);
    expect(timeMs(() => store.recentNotifications({ limit: 50 }))).toBeLessThan(25);
    store.close();
  }, 180_000);

  it("allowance ledger: per-request sweep ignores 3k settled periods / 60k entries", async () => {
    const path = await tmp("ledger-big");
    const ledgerNow = Date.parse("2026-10-12T00:00:00.000Z");
    const store = new PhylaxAllowanceLedger(path, () => ledgerNow);
    // 3000 ended periods across 300 tenants, each fully settled (grant 100, usage -100).
    seed(
      path,
      `INSERT INTO phylax_allowance_periods (tenant_id, period_id, starts_at, ends_at, created_at)
       SELECT 't' || (i % 300), 'p' || i, 1000 + i, 2000 + i, 1 FROM n`,
      3000,
    );
    seed(
      path,
      `INSERT INTO phylax_allowance_entries
         (tenant_id, period_id, kind, amount_units, source, idempotency_key, payload_hash, tariff_version, audit_reason, occurred_at, created_at)
       SELECT 't' || ((i - 1) % 300), 'p' || (((i - 1) % 3000) + 1), CASE WHEN i <= 3000 THEN 'grant' ELSE 'usage' END,
              CASE WHEN i <= 3000 THEN 100 ELSE (CASE WHEN i % 20 = 0 THEN -100 + 19 * 5 ELSE -5 END) END,
              'zenod', 'k' || i, 'h', 'v1', 'seed', 1000, 1000 FROM n`,
      60_000,
    );
    // Settle every period to a zero balance so nothing is reclaimable: add a closing usage entry.
    const raw = new DatabaseSync(path);
    raw.exec(
      `INSERT INTO phylax_allowance_entries
         (tenant_id, period_id, kind, amount_units, source, idempotency_key, payload_hash, tariff_version, audit_reason, occurred_at, created_at)
       SELECT p.tenant_id, p.period_id, 'usage', -COALESCE(t.balance_units, 0), 'zenod', 'close:' || p.period_id, 'h', 'v1', 'seed', 1000, 1000
       FROM phylax_allowance_periods p JOIN phylax_allowance_period_totals t USING (tenant_id, period_id)
       WHERE t.balance_units <> 0`,
    );
    raw.close();

    expect(store.reconcileExpiredPeriods(ledgerNow)).toBe(0);
    expect(timeMs(() => store.reconcileExpiredPeriods(ledgerNow))).toBeLessThan(25);
    expect(timeMs(() => store.tenantIds())).toBeLessThan(25);
    expect(timeMs(() => store.revision("t7"))).toBeLessThan(10);
    expect(timeMs(() => store.customerProjection("t7", 1500))).toBeLessThan(10);
    store.close();
  }, 180_000);

  it("journeys: dependency checks do not walk 300k completed steps", async () => {
    const path = await tmp("journeys-big");
    const store = new JourneyStore(path);
    const journey = store.create({ surface: "test", originalRequest: "dep check" }, 100);
    const first = store.addStep(journey.id, { owner: "archus", title: "first" }, 110);
    store.addStep(journey.id, { owner: "epaminon", title: "second", dependencyIds: [first.id] }, 120);
    store.dispatchStep(first.id, {}, 130);
    store.completeStep(first.id, {}, 140);
    // Completed history lives on a finished journey, as in production; the live journey stays small.
    const history = store.create({ surface: "test", originalRequest: "history" }, 100);
    const raw = new DatabaseSync(path);
    raw.prepare("UPDATE journeys SET status='completed' WHERE id=?").run(history.id);
    raw.close();
    seed(
      path,
      `INSERT INTO journey_steps (id, journey_id, sequence, owner, title, status, created_at, updated_at)
       SELECT 'seed' || i, '${history.id}', 1000 + i, 'archus', 'seed', 'completed', 1, 1 FROM n`,
      300_000,
    );
    expect(store.claimDueSteps(1000).length).toBeGreaterThan(0);
    // Advance past each lease so every timed claim re-runs the dependency check.
    let clock = 10_000_000;
    expect(
      timeMs(() => {
        clock += 1_000_000;
        expect(store.claimDueSteps(clock)).toHaveLength(1);
      }),
    ).toBeLessThan(10);
    store.close();
  }, 180_000);
});
