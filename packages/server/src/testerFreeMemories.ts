// E26-S29 (Jordi, 2026-11-15, vn_891cd2f9: "for Zenote, I don't think it's one free month. I think it's
// like some level of consumption, you know, the first few memories or whatever"): the tester offer is a
// consumption trial. A tester's first N memories (finished saves) are free, with no time limit and no card.
//
// N is one setting, ZENOD_TESTER_FREE_MEMORIES (default 30, Jordi 2026-11-16 vn_e622f472 "your first 30 memories"), so Jordi's number changes it without code.
// The count is the saves counter the public counts already use (finished `store` and `media_ingest` jobs
// in the tenant's tasks.sqlite). While a tester has fewer than N, the month-end job gives the next month
// at €0 by itself; once they reach N, the free time ends at the period end, the end-of-test offer goes
// out, and everything they saved stays theirs.
import { join } from "node:path";
import type { Hono } from "hono";
import { tenantSavesSince } from "./publicCounts.js";

export const DEFAULT_TESTER_FREE_MEMORIES = 30;
export const TESTER_OFFER_PATH = "/api/public/testers/offer";

/** N from ZENOD_TESTER_FREE_MEMORIES: a whole number from 1 to 100000, else the default. */
export function testerFreeMemories(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.ZENOD_TESTER_FREE_MEMORIES ?? "").trim();
  if (!/^\d{1,6}$/.test(raw)) return DEFAULT_TESTER_FREE_MEMORIES;
  const n = Number(raw);
  return n >= 1 && n <= 100_000 ? n : DEFAULT_TESTER_FREE_MEMORIES;
}

/** Every finished save a tenant made, read only; 0 when there is none or the file cannot be read. */
export function tenantSavedMemories(dataDir: string, tenantId: string | null): number {
  if (!tenantId) return 0;
  return tenantSavesSince(join(dataDir, tenantId, "tasks.sqlite"), tenantId, 0);
}

export interface FreeMemories {
  used: number;
  limit: number;
}

/** True once the free memories are used. */
export function freeMemoriesUsed(memories: FreeMemories): boolean {
  return memories.used >= memories.limit;
}

/** The offer in one line, the same everywhere: the testers page, checkout, the emails. */
export function freeMemoriesOffer(limit: number): string {
  return `Your first ${limit} memories free. No card.`;
}

/** Above the pay button when a tester's code is applied. */
export function testerCheckoutMessage(limit: number): string {
  return `Your tester code is applied. Your first ${limit} memories are free, with no time limit. ` +
    "Your total is €0: no card or payment details are needed and you will not be charged.";
}

/** The public number for the zenod.dev/testers page, so the page always shows the setting. */
export function mountTesterOffer(app: Hono<any>, limit: number): void {
  app.get(TESTER_OFFER_PATH, (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json({ free_memories: limit, line: freeMemoriesOffer(limit) });
  });
}
