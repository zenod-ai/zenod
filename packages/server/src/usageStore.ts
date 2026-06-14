import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LlmUsageReport } from "zenod";

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
 * Anthropic pricing as of 2026-06; update when it changes.
 */
const PRICING: Array<{ match: (model: string) => boolean; input: number; output: number }> = [
  { match: (m) => m.includes("opus"), input: 5, output: 25 },
  { match: (m) => m.includes("sonnet"), input: 3, output: 15 },
  { match: (m) => m.includes("haiku"), input: 1, output: 5 },
  { match: (m) => m.includes("gpt-4o-mini") || m.includes("gpt-4.1-mini"), input: 0.15, output: 0.6 },
  { match: (m) => m.includes("deepseek"), input: 0.14, output: 0.28 },
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
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
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
