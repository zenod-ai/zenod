import { DatabaseSync } from "node:sqlite";
import type { LlmUsageReport } from "zenod";
import { openZenodSqlite } from "./sqlite.js";

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
  byOperation: UsageBucket[];
  byModel: UsageBucket[];
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
    const rows = this.db
      .prepare(
        `SELECT id, operation, provider, model AS key, input_tokens, output_tokens,
                cached_input_tokens, cache_creation_input_tokens, cost_usd
         FROM llm_usage`,
      )
      .all() as unknown as Array<AggRow & { id: number; operation: string; provider: string }>;
    const update = this.db.prepare(`UPDATE llm_usage SET cost_usd = ? WHERE id = ?`);
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
    }
  }

  record(report: LlmUsageReport, now: number = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO llm_usage
           (ts, operation, provider, model, input_tokens, output_tokens, cached_input_tokens, cache_creation_input_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
  }

  private aggregate(column: "operation" | "model", since: number): UsageBucket[] {
    const rows = this.db
      .prepare(
        `SELECT ${column} AS key,
                COUNT(*) AS calls,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(cached_input_tokens) AS cached_input_tokens,
                SUM(cache_creation_input_tokens) AS cache_creation_input_tokens,
                SUM(cost_usd) AS cost_usd
         FROM llm_usage WHERE ts >= ?
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
                cached_input_tokens, cache_creation_input_tokens, cost_usd
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
    }));
  }

  summary(since: number): UsageSummary {
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS calls,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
                COALESCE(SUM(cache_creation_input_tokens), 0) AS cache_creation_input_tokens,
                COALESCE(SUM(cost_usd), 0) AS cost_usd
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
      byOperation: this.aggregate("operation", since),
      byModel: this.aggregate("model", since),
    };
  }

  close(): void {
    this.db.close();
  }
}
