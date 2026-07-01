import type { UsageCall, UsageTimelineQuery } from "./usageStore.js";

/**
 * Deterministic read of the LLM-usage ledger (`/data/usage.sqlite`) as an
 * operation-labelled timeline. This is the "check the logs" primitive that used
 * to require SSH + `docker logs` on the VPS: the app container mounts `/data`,
 * so exposing it through the Console MCP gateway lets any instance (a fan-out
 * worker in its throwaway sandbox, or the Console chat) read what actually ran
 * without host access. It reads the durable ledger, which survives container
 * recreate — unlike stdout, which every deploy wipes. See docs/SESSION-LOG-FORENSICS.md.
 */

export type SessionLogReader = (query: UsageTimelineQuery) => UsageCall[];

export interface SessionLogToolArgs {
  windowMinutes?: unknown;
  operation?: unknown;
  model?: unknown;
  limit?: unknown;
}

export function sessionLogQueryFromToolArgs(args: SessionLogToolArgs): UsageTimelineQuery & { windowMinutes: number } {
  const windowMinutes = typeof args.windowMinutes === "number" && Number.isFinite(args.windowMinutes) ? args.windowMinutes : 120;
  const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : undefined;
  return {
    sinceMs: Date.now() - windowMinutes * 60 * 1000,
    windowMinutes,
    ...(typeof args.operation === "string" && args.operation ? { operation: args.operation } : {}),
    ...(typeof args.model === "string" && args.model ? { model: args.model } : {}),
    ...(limit ? { limit } : {}),
  };
}

function usd(n: number): string {
  return `$${n.toFixed(n < 0.01 ? 5 : 4)}`;
}

export function formatSessionLog(calls: UsageCall[], windowMinutes: number): string {
  if (calls.length === 0) {
    return `No LLM-usage ledger rows matched the last ${windowMinutes}m. Either nothing ran in that window, or the filter excluded everything. (docker stdout is not read here — the durable ledger is.)`;
  }
  const totalCost = calls.reduce((sum, c) => sum + c.costUsd, 0);
  const totalIn = calls.reduce((sum, c) => sum + c.inputTokens + c.cachedInputTokens + c.cacheCreationInputTokens, 0);
  const totalOut = calls.reduce((sum, c) => sum + c.outputTokens, 0);
  const header = `${calls.length} LLM call(s) in the last ${windowMinutes}m — ${usd(totalCost)}, ${totalIn} in / ${totalOut} out tokens. Newest first:`;
  const lines = calls.map((c) => {
    const at = new Date(c.ts).toISOString();
    const cached = c.cachedInputTokens ? ` cached=${c.cachedInputTokens}` : "";
    const created = c.cacheCreationInputTokens ? ` cacheWrite=${c.cacheCreationInputTokens}` : "";
    return `[${at}] ${c.operation} — ${c.provider}/${c.model} — in=${c.inputTokens}${cached}${created} out=${c.outputTokens} — ${usd(c.costUsd)}`;
  });
  return [header, ...lines].join("\n");
}
