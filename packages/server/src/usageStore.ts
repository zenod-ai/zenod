import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { deepseekCostUsd, type LlmUsageReport } from "zenod";
import { currentFeature, featureForOperation, USAGE_FEATURES, type UsageFeature } from "./limits.js";
import { openZenodSqlite } from "./sqlite.js";

/** A row's feature (EPIC-14 S10): its recorded tag, else derived from its operation like featureForOperation. */
const FEATURE_SQL = `COALESCE(feature, CASE operation WHEN 'call' THEN 'calls' WHEN 'answer' THEN 'chat' WHEN 'turnPlan' THEN 'chat' WHEN 'work' THEN 'desk' ELSE 'filing' END)`;
const SPEND_SQL = "COALESCE(provider_cost_usd, cost_usd)";

/** Month spend by feature from rows grouped by FEATURE_SQL; unknown tags fold into filing. */
function featureTotals(rows: Array<{ feature: string; spend: number }>): Record<UsageFeature, number> {
  const totals = Object.fromEntries(USAGE_FEATURES.map((feature) => [feature, 0])) as Record<UsageFeature, number>;
  for (const row of rows) {
    const feature = (USAGE_FEATURES as readonly string[]).includes(row.feature) ? row.feature as UsageFeature : "filing";
    totals[feature] += row.spend ?? 0;
  }
  return totals;
}

/**
 * Spend by feature since `since` read straight from a tenant's usage file, read only, for the admin
 * view across tenants (a tenant whose runtime is not loaded is never booted for it). Null when the
 * file is missing or unreadable.
 */
export function readFeatureSpend(path: string, since: number): Record<UsageFeature, number> | null {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const columns = db.prepare("PRAGMA table_info(llm_usage)").all() as unknown as Array<{ name: string }>;
    if (columns.length === 0) return null;
    const has = (name: string) => columns.some((column) => column.name === name);
    const feature = has("feature") ? FEATURE_SQL : FEATURE_SQL.replace("COALESCE(feature, ", "COALESCE(NULL, ");
    const spend = has("provider_cost_usd") ? SPEND_SQL : "cost_usd";
    const status = has("status") ? "AND status = 'succeeded'" : "";
    const rows = db
      .prepare(`SELECT ${feature} AS feature, COALESCE(SUM(${spend}), 0) AS spend FROM llm_usage WHERE ts >= ? ${status} GROUP BY 1`)
      .all(since) as unknown as Array<{ feature: string; spend: number }>;
    return featureTotals(rows);
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

/**
 * Durable, append-only log of real (provider-billed) LLM token usage — its own
 * SQLite file on the /data volume. Every engine LLM call records one row, so
 * "where are the tokens going" is answerable from data instead of guesswork.
 * Read it via GET /api/usage. Recording must never throw into a chat turn, so
 * all writes here are best-effort and swallow errors at the call site.
 */

/**
 * USD per 1M tokens (input/output). Cache reads bill at ~0.1x the input rate,
 * cache writes at ~1.25x — applied below. Unknown models record token counts
 * with cost 0 so the data is never lost; add the model here to price it.
 * Matched first-wins by substring, so list specific slugs before generic
 * families (e.g. deepseek-v4-pro before deepseek). Mirrors the web
 * model-catalog (apps/web/src/lib/model-catalog.ts); pricing as of 2026-06.
 */
const PRICING: Array<{ match: (model: string) => boolean; input: number; output: number }> = [
  // Anthropic
  { match: (m) => m.includes("opus"), input: 5, output: 25 },
  { match: (m) => m.includes("sonnet"), input: 3, output: 15 },
  { match: (m) => m.includes("haiku"), input: 1, output: 5 },
  // OpenAI
  { match: (m) => m.includes("gpt-4o-mini") || m.includes("gpt-4.1-mini"), input: 0.15, output: 0.6 },
  { match: (m) => m.includes("gpt-4.1-nano"), input: 0.1, output: 0.4 },
  { match: (m) => m.includes("gpt-5.5"), input: 2, output: 16 },
  { match: (m) => m.includes("gpt-5") || m.includes("gpt-4.1") || m.includes("gpt-4o"), input: 1.25, output: 10 },
  // OpenRouter (vendor/model slugs)
  { match: (m) => m.includes("grok"), input: 1.25, output: 2.5 },
  { match: (m) => m.includes("minimax"), input: 0.3, output: 1.2 },
  { match: (m) => m.includes("qwen3.7") || m.includes("qwen3-coder"), input: 0.32, output: 1.28 },
  { match: (m) => m.includes("kimi-k2"), input: 0.6, output: 2.5 },
  { match: (m) => m.includes("glm"), input: 0.4, output: 1.75 },
  { match: (m) => m.includes("gemini") && m.includes("flash"), input: 0.3, output: 2.5 },
  { match: (m) => m.includes("gemini"), input: 1.25, output: 10 },
  { match: (m) => m.includes("llama-4") || m.includes("llama-3"), input: 0.15, output: 0.6 },
  { match: (m) => m.includes("mistral"), input: 2, output: 6 },
  { match: (m) => m.includes("nova"), input: 0.8, output: 3.2 },
  // DeepSeek — specific variants before the generic family fallback
  { match: (m) => m.includes("deepseek-v4") || m.includes("deepseek-v4-pro"), input: 0.44, output: 0.87 },
  { match: (m) => m.includes("deepseek-r1"), input: 0.5, output: 2.15 },
  { match: (m) => m.includes("deepseek"), input: 0.2, output: 0.8 },
];

function priceFor(model: string): { input: number; output: number } | null {
  const id = model.toLowerCase();
  return PRICING.find((p) => p.match(id)) ?? null;
}

/** Cost of one call in USD, accounting for the cache read/write rate split. */
export function estimateCostUsd(report: LlmUsageReport): number {
  // Audio transcription is priced per minute by the caller, not per token; a call (EPIC-14 S8) is
  // priced from the Realtime API's audio and text tokens by memoryCall.ts.
  if (report.operation === "transcribe" || report.operation === "call") return report.estimatedCostUsd ?? 0;
  // DeepSeek's own API (EPIC-14 S10 round 4): cache hits and misses at its published off-peak rate.
  // The live charge (peak hours double) is recorded as provider_cost_usd by the call itself.
  if (report.provider === "deepseek") {
    const hit = report.cachedInputTokens;
    return deepseekCostUsd({ model: report.model, hitTokens: hit, missTokens: Math.max(0, report.inputTokens - hit), outputTokens: report.outputTokens, at: Date.UTC(2026, 0, 3) });
  }
  const rate = priceFor(report.model);
  if (!rate) return 0;
  const usd =
    (report.inputTokens * rate.input +
      report.cachedInputTokens * rate.input * 0.1 +
      report.cacheCreationInputTokens * rate.input * 1.25 +
      report.outputTokens * rate.output) /
    1_000_000;
  return usd;
}

export interface UsageBucket {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
}

export interface UsageSummary {
  /** Window start (epoch ms); rows at or after this are included. */
  since: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
  /** Real gateway credits charged across the window, when reported (may undercount early rows). */
  providerCostUsd: number;
  byOperation: UsageBucket[];
  byModel: UsageBucket[];
  /** Spend per provider (real charge when reported, else estimate). */
  byProvider: UsageBucket[];
}

/** One recorded LLM call, as returned by `UsageStore.timeline`. */
export interface UsageCall {
  ts: number;
  operation: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
  /** Real gateway credits charged for the call (OpenRouter usage.cost), when reported. */
  providerCostUsd: number | null;
  status: "succeeded" | "failed";
  errorCode: string | null;
}

export interface UsageTimelineQuery {
  /** Epoch ms; only calls at or after this are returned. Defaults to 0 (all). */
  sinceMs?: number;
  /** Case-insensitive substring filter on the operation label. */
  operation?: string;
  /** Case-insensitive substring filter on the model id. */
  model?: string;
  /** Max rows (newest first). Clamped to [1, 2000]. Defaults to 200. */
  limit?: number;
}

interface AggRow {
  key: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
}

function rowToBucket(row: AggRow): UsageBucket {
  return {
    key: row.key,
    calls: row.calls,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cachedInputTokens: row.cached_input_tokens,
    cacheCreationInputTokens: row.cache_creation_input_tokens,
    costUsd: row.cost_usd ?? 0,
  };
}

export class UsageStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = openZenodSqlite(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        operation TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS llm_usage_ts ON llm_usage(ts);
      CREATE INDEX IF NOT EXISTS llm_usage_op ON llm_usage(operation, ts);
    `);
    const columns = this.db.prepare("PRAGMA table_info(llm_usage)").all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "status")) {
      this.db.exec("ALTER TABLE llm_usage ADD COLUMN status TEXT NOT NULL DEFAULT 'succeeded'");
    }
    if (!columns.some((column) => column.name === "error_code")) {
      this.db.exec("ALTER TABLE llm_usage ADD COLUMN error_code TEXT");
    }
    if (!columns.some((column) => column.name === "provider_cost_usd")) {
      this.db.exec("ALTER TABLE llm_usage ADD COLUMN provider_cost_usd REAL");
    }
    if (!columns.some((column) => column.name === "generation_id")) {
      this.db.exec("ALTER TABLE llm_usage ADD COLUMN generation_id TEXT");
    }
    if (!columns.some((column) => column.name === "feature")) {
      // EPIC-14 S10: what the call was spent on (filing, chat, personas, desk, calls). Older rows stay
      // NULL and are read by their operation (FEATURE_SQL).
      this.db.exec("ALTER TABLE llm_usage ADD COLUMN feature TEXT");
    }
    this.backfillCosts();
  }

  /**
   * Re-price every stored row from its token counts + model. Cost is computed
   * at write time, so rows logged before a model was added to PRICING (or while
   * its rate was wrong) are stuck at the old value — e.g. OpenRouter models that
   * recorded $0. Recomputing on boot keeps historical analytics in sync with the
   * current PRICING table. The usage log is small and this is idempotent.
   */
  private backfillCosts(): void {
    // Hot-path rule (docs/evidence/sqlite-hot-path-audit-2026-10-12.md): never scan the whole,
    // unbounded usage table on boot. The re-price only matters when the cost model changed, so
    // it is gated on a fingerprint of PRICING + the pricing code and runs in id-keyset batches.
    this.db.exec("CREATE TABLE IF NOT EXISTS llm_usage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const fingerprint = createHash("sha256")
      .update(PRICING.map((p) => `${p.match}|${p.input}|${p.output}`).join("\n"))
      .update(estimateCostUsd.toString())
      .digest("hex");
    const stored = this.db.prepare("SELECT value FROM llm_usage_meta WHERE key = 'cost_model_fingerprint'").get() as
      | { value: string }
      | undefined;
    if (stored?.value === fingerprint) return;
    const update = this.db.prepare(`UPDATE llm_usage SET cost_usd = ? WHERE id = ?`);
    const page = this.db.prepare(
      `SELECT id, operation, provider, model AS key, input_tokens, output_tokens,
              cached_input_tokens, cache_creation_input_tokens, cost_usd
       FROM llm_usage WHERE id > ? AND operation NOT IN ('transcribe', 'call') ORDER BY id LIMIT 2000`,
    );
    let lastId = 0;
    for (;;) {
      const rows = page.all(lastId) as unknown as Array<AggRow & { id: number; operation: string; provider: string }>;
      if (rows.length === 0) break;
      for (const row of rows) {
        const usd = estimateCostUsd({
          operation: row.operation,
          provider: row.provider,
          model: row.key,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          cachedInputTokens: row.cached_input_tokens,
          cacheCreationInputTokens: row.cache_creation_input_tokens,
        } as LlmUsageReport);
        if (Math.abs(usd - row.cost_usd) > 1e-9) update.run(usd, row.id);
        lastId = row.id;
      }
    }
    this.db
      .prepare("INSERT OR REPLACE INTO llm_usage_meta (key, value) VALUES ('cost_model_fingerprint', ?)")
      .run(fingerprint);
  }

  /**
   * Log one call. Its feature is `feature` when given, else the feature context it runs in
   * (limits.withFeature), else its operation's (featureForOperation).
   */
  record(report: LlmUsageReport, now: number = Date.now(), feature?: UsageFeature): void {
    this.db
      .prepare(
        `INSERT INTO llm_usage
           (ts, operation, provider, model, input_tokens, output_tokens, cached_input_tokens, cache_creation_input_tokens, cost_usd, status, error_code, provider_cost_usd, generation_id, feature)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        now,
        report.operation,
        report.provider,
        report.model,
        report.inputTokens,
        report.outputTokens,
        report.cachedInputTokens,
        report.cacheCreationInputTokens,
        estimateCostUsd(report),
        report.status ?? "succeeded",
        report.errorCode ?? null,
        report.providerCostUsd ?? null,
        report.generationId ?? null,
        feature ?? currentFeature() ?? featureForOperation(report.operation),
      );
  }

  /** Spend by feature since `since` (succeeded calls; the gateway's charge when reported, else the estimate). */
  spendByFeatureSince(since: number): Record<UsageFeature, number> {
    const rows = this.db
      .prepare(
        `SELECT ${FEATURE_SQL} AS feature, COALESCE(SUM(${SPEND_SQL}), 0) AS spend
         FROM llm_usage INDEXED BY llm_usage_ts WHERE ts >= ? AND status = 'succeeded' GROUP BY 1`,
      )
      .all(since) as unknown as Array<{ feature: string; spend: number }>;
    return featureTotals(rows);
  }

  private aggregate(column: "operation" | "model" | "provider", since: number, cost = "cost_usd"): UsageBucket[] {
    const rows = this.db
      .prepare(
        `SELECT ${column} AS key,
                COUNT(*) AS calls,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(cached_input_tokens) AS cached_input_tokens,
                SUM(cache_creation_input_tokens) AS cache_creation_input_tokens,
                SUM(${cost}) AS cost_usd
         FROM llm_usage INDEXED BY llm_usage_ts WHERE ts >= ?
         GROUP BY ${column}
         ORDER BY cost_usd DESC`,
      )
      .all(since) as unknown as AggRow[];
    return rows.map(rowToBucket);
  }

  /**
   * Raw per-call timeline (newest first), the forensics primitive that answers
   * "what LLM operations ran in this window and how long/expensive each was".
   * Optional case-insensitive substring filters on operation/model. This is the
   * durable structured log the session-forensics doc leans on — it survives
   * container recreate, unlike docker stdout.
   */
  timeline(query: UsageTimelineQuery = {}): UsageCall[] {
    const since = query.sinceMs ?? 0;
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 2000);
    const clauses = ["ts >= ?"];
    const params: Array<string | number> = [since];
    if (query.operation) {
      clauses.push("LOWER(operation) LIKE ?");
      params.push(`%${query.operation.toLowerCase()}%`);
    }
    if (query.model) {
      clauses.push("LOWER(model) LIKE ?");
      params.push(`%${query.model.toLowerCase()}%`);
    }
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT ts, operation, provider, model, input_tokens, output_tokens,
                cached_input_tokens, cache_creation_input_tokens, cost_usd, provider_cost_usd, status, error_code
         FROM llm_usage WHERE ${clauses.join(" AND ")}
         ORDER BY ts DESC, id DESC
         LIMIT ?`,
      )
      .all(...params) as unknown as Array<{
      ts: number;
      operation: string;
      provider: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cached_input_tokens: number;
      cache_creation_input_tokens: number;
      cost_usd: number;
      provider_cost_usd: number | null;
      status: "succeeded" | "failed";
      error_code: string | null;
    }>;
    return rows.map((row) => ({
      ts: row.ts,
      operation: row.operation,
      provider: row.provider,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cachedInputTokens: row.cached_input_tokens,
      cacheCreationInputTokens: row.cache_creation_input_tokens,
      costUsd: row.cost_usd ?? 0,
      providerCostUsd: row.provider_cost_usd ?? null,
      status: row.status === "failed" ? "failed" : "succeeded",
      errorCode: row.error_code,
    }));
  }

  /**
   * Total estimated spend since `since` (one index-range SUM, no GROUP BY). The watchdog polls
   * /api/usage/headroom with this, so it must stay a single bounded range scan on llm_usage_ts.
   */
  costSince(since: number): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS cost_usd FROM llm_usage INDEXED BY llm_usage_ts WHERE ts >= ?")
      .get(since) as unknown as { cost_usd: number };
    return row.cost_usd ?? 0;
  }

  /**
   * Spend since `since` (one index-range SUM): the gateway's real charge when reported, else the
   * token-price estimate. This is the per-tenant metering figure (month-to-date, allowance readout).
   */
  spendSince(since: number): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(COALESCE(provider_cost_usd, cost_usd)), 0) AS spend FROM llm_usage INDEXED BY llm_usage_ts WHERE ts >= ? AND status = 'succeeded'",
      )
      .get(since) as unknown as { spend: number };
    return row.spend ?? 0;
  }

  summary(since: number): UsageSummary {
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS calls,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
                COALESCE(SUM(cache_creation_input_tokens), 0) AS cache_creation_input_tokens,
                COALESCE(SUM(cost_usd), 0) AS cost_usd,
                COALESCE(SUM(provider_cost_usd), 0) AS provider_cost_usd
         FROM llm_usage WHERE ts >= ?`,
      )
      .get(since) as unknown as Omit<AggRow, "key">;
    return {
      since,
      calls: totals.calls,
      inputTokens: totals.input_tokens,
      outputTokens: totals.output_tokens,
      cachedInputTokens: totals.cached_input_tokens,
      cacheCreationInputTokens: totals.cache_creation_input_tokens,
      costUsd: totals.cost_usd ?? 0,
      providerCostUsd: (totals as unknown as { provider_cost_usd?: number }).provider_cost_usd ?? 0,
      byOperation: this.aggregate("operation", since),
      byModel: this.aggregate("model", since),
      // EPIC-14 S10 round 4: what each provider (openrouter, deepseek) cost, at its real charge when reported.
      byProvider: this.aggregate("provider", since, SPEND_SQL),
    };
  }

  close(): void {
    this.db.close();
  }
}
