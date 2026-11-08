import { withMatchPercent, type BrainEngine, type Hit } from "zenod";

/**
 * Ranked retrieval (EPIC-12 E12-3, row S3a): the top memories for a question, each with a
 * match percentage (core vault/matchPercent.ts) and its links: the vault URL (GitHub or
 * Google Drive) and the path that opens it in the Zenod app. Shared by search_memory's
 * note hits and the console's /api/console/memory-search, so both rank the same way.
 */

export const RANKED_MEMORY_DEFAULT_LIMIT = 5;
export const RANKED_MEMORY_MAX_LIMIT = 20;

/** In-app path of a memory: the app's Memory tab with the memory's vault path. */
export function memoryAppPath(path: string): string {
  return `/#memory?path=${encodeURIComponent(path)}`;
}

export interface RankedMemory {
  rank: number;
  path: string;
  title: string;
  snippet: string;
  matchPercent: number;
  /** The memory in the vault: GitHub or Google Drive, "" when the vault has no web URL. */
  url: string;
  provider: Hit["provider"];
  appPath: string;
  treePath: string;
  kind: "page" | "log" | "root" | "note";
}

export interface RankedMemories {
  query: string;
  tier: "index" | "scan";
  ms: number | null;
  results: RankedMemory[];
}

/** Rank, link and number hits; percentages are added where the search did not supply one. */
export function rankHits<T extends Hit>(hits: readonly T[]): Array<T & { rank: number; matchPercent: number; appPath: string }> {
  return withMatchPercent(hits).map((hit, i) => ({ ...hit, rank: i + 1, appPath: memoryAppPath(hit.path) }));
}

const titleOf = (hit: Hit) => {
  if (hit.title) return hit.title;
  const base = hit.path.split("#^")[0]!;
  return base.split("/").pop()!.replace(/\.md$/i, "");
};

export async function rankMemories(engine: BrainEngine, query: string, limit = RANKED_MEMORY_DEFAULT_LIMIT): Promise<RankedMemories> {
  const capped = Math.max(1, Math.min(RANKED_MEMORY_MAX_LIMIT, Math.trunc(limit) || RANKED_MEMORY_DEFAULT_LIMIT));
  const started = performance.now();
  const timed = engine.searchTimed ? await engine.searchTimed(query) : { hits: await engine.search(query), tier: "scan" as const, ms: null };
  const results = rankHits(timed.hits.slice(0, capped)).map((hit): RankedMemory => ({
    rank: hit.rank,
    path: hit.path,
    title: titleOf(hit),
    snippet: hit.snippet,
    matchPercent: hit.matchPercent,
    url: hit.url,
    provider: hit.provider,
    appPath: hit.appPath,
    treePath: hit.treePath ?? "",
    kind: hit.indexKind ?? "note",
  }));
  return { query, tier: timed.tier, ms: Math.round((performance.now() - started) * 10) / 10, results };
}
