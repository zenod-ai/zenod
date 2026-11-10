// EPIC-26 S7: the tester and customer funnel as plain counts anyone can read, so zenod-social and the
// agent_team console fill their numbers without asking. GET /api/public/counts on cloud.zenod.dev answers
// today's counts and one line per day (the last 60 UTC days). Counts only: never an email, a name, an id or
// a code, so the answer is safe on a public page.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { CustomerAccount } from "./customerAccounts.js";
import { TESTER_APPLICATIONS_FILE } from "./testerApplications.js";
import { normalizeTesterEmail, type TesterRecord } from "./testerFlow.js";

export const PUBLIC_COUNTS_FILE = "public-counts.json";
const KEEP_DAYS = 60;
const ACTIVE_DAYS = 7;
const CACHE_MS = 10 * 60_000;

export interface FunnelCounts {
  /** Distinct people who sent the zenod.dev/testers form. */
  applications: number;
  /** Applicants given a tester place (automatically or by hand). */
  accepted: number;
  /** Testers who finished the free checkout and have an account. */
  signed_up: number;
  /** Testers still on their free month with at least one save in the last 7 days. */
  active_testers: number;
  /** Accounts on a live subscription that pays: not free, not comped. */
  paying_customers: number;
}

export interface PublicCountsDocument extends FunnelCounts {
  schema: "zenod-counts/v1";
  date: string;
  at: string;
  definitions: Record<keyof FunnelCounts, string>;
  history: Array<FunnelCounts & { date: string }>;
}

export const COUNT_DEFINITIONS: Record<keyof FunnelCounts, string> = {
  applications: "distinct people who sent the tester form on zenod.dev/testers",
  accepted: "applicants given a tester place",
  signed_up: "testers who finished the free checkout and have an account",
  active_testers: `testers on their free month with at least one save in the last ${ACTIVE_DAYS} days`,
  paying_customers: "accounts on a live subscription that pays (not free, not comped)",
};

export interface CountSources {
  /** The application lines kept by the testers form (testerApplications.ts). */
  applications: () => Array<{ contact?: unknown }>;
  /** The tester flow's records (testerFlow.ts); empty when the flow is off. */
  testers: () => TesterRecord[];
  accounts: () => CustomerAccount[];
  comped: ReadonlySet<string>;
  /** Saves (store, media_ingest) finished for this tenant since `sinceMs`. */
  savesSince: (tenantId: string, sinceMs: number) => number;
}

const live = (account: CustomerAccount) =>
  account.subscription_status === "active" || account.subscription_status === "past_due";

/** The five counts from the sources. Pure apart from the sources. */
export function funnelCounts(sources: CountSources, nowMs: number): FunnelCounts {
  const applicants = new Set<string>();
  for (const line of sources.applications()) {
    const contact = typeof line.contact === "string" ? line.contact : "";
    const key = (normalizeTesterEmail(contact) ?? contact.trim()).toLowerCase();
    if (key) applicants.add(key);
  }
  const testers = sources.testers();
  for (const tester of testers) applicants.add(tester.email.toLowerCase());
  const accepted = testers.filter((tester) => tester.status === "accepted");
  const acceptedEmails = new Set(accepted.map((tester) => tester.email.toLowerCase()));

  let signedUp = 0;
  let activeTesters = 0;
  let paying = 0;
  const since = nowMs - ACTIVE_DAYS * 86_400_000;
  for (const account of sources.accounts()) {
    if (sources.comped.has(account.account_id) || !account.checkout_completed_at) continue;
    // A tester's code is a 100%-off coupon for a limited time (a free month); team and friends codes are
    // free forever (free_until null) and count nowhere here.
    const email = account.stripe_email?.toLowerCase() ?? "";
    const tester = Boolean(account.fully_discounted && account.free_until) || (email !== "" && acceptedEmails.has(email));
    if (tester) signedUp += 1;
    if (!live(account)) continue;
    if (!account.fully_discounted) {
      paying += 1;
    } else if (tester && account.tenant_id && sources.savesSince(account.tenant_id, since) > 0) {
      activeTesters += 1;
    }
  }
  return {
    applications: applicants.size,
    accepted: accepted.length,
    signed_up: signedUp,
    active_testers: activeTesters,
    paying_customers: paying,
  };
}

/** Finished saves for one tenant from its tasks.sqlite, read only; 0 when the file is missing or unreadable. */
export function tenantSavesSince(tasksPath: string, tenantId: string, sinceMs: number): number {
  if (!existsSync(tasksPath)) return 0;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(tasksPath, { readOnly: true });
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM task_jobs
         WHERE tenant_id=? AND kind IN ('store', 'media_ingest') AND status='done' AND updated_at>=?`,
      )
      .get(tenantId, sinceMs) as { n: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}

/** The kept applications, one JSON object per line; unreadable lines are skipped. */
export function readApplications(dataDir: string): Array<{ contact?: unknown }> {
  const path = join(dataDir, TESTER_APPLICATIONS_FILE);
  if (!existsSync(path)) return [];
  const out: Array<{ contact?: unknown }> = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as { contact?: unknown });
    } catch {
      // a torn line from a crash mid-write: skip it
    }
  }
  return out;
}

/**
 * Today's counts, kept one line per UTC day in public-counts.json (the newest reading of each day), so the
 * history fills even on days nobody asks: the server reads once an hour.
 */
export class PublicCounts {
  private readonly path: string;
  private cached: { at: number; doc: PublicCountsDocument } | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly sources: CountSources,
    private readonly now: () => number = Date.now,
  ) {
    this.path = join(dataDir, PUBLIC_COUNTS_FILE);
  }

  private readDays(): Record<string, FunnelCounts> {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as { days?: Record<string, FunnelCounts> };
      return parsed.days && typeof parsed.days === "object" ? parsed.days : {};
    } catch {
      return {};
    }
  }

  /** Count now, keep today's line and answer the document. */
  refresh(): PublicCountsDocument {
    const nowMs = this.now();
    const at = new Date(nowMs).toISOString();
    const date = at.slice(0, 10);
    const counts = funnelCounts(this.sources, nowMs);
    const days = this.readDays();
    days[date] = counts;
    const kept = Object.keys(days).sort().slice(-KEEP_DAYS);
    const keptDays = Object.fromEntries(kept.map((day) => [day, days[day]!]));
    try {
      mkdirSync(this.dataDir, { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, `${JSON.stringify({ days: keptDays }, null, 1)}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(tmp, this.path);
    } catch (error) {
      console.error("[counts] could not keep today's counts:", error instanceof Error ? error.message : String(error));
    }
    const doc: PublicCountsDocument = {
      schema: "zenod-counts/v1",
      date,
      at,
      ...counts,
      definitions: COUNT_DEFINITIONS,
      history: kept.map((day) => ({ date: day, ...keptDays[day]! })),
    };
    this.cached = { at: nowMs, doc };
    return doc;
  }

  current(): PublicCountsDocument {
    if (this.cached && this.now() - this.cached.at < CACHE_MS) return this.cached.doc;
    return this.refresh();
  }

  start(intervalMs = 60 * 60_000): void {
    if (this.timer) return;
    const tick = () => {
      try {
        this.refresh();
      } catch (error) {
        console.error("[counts] could not count:", error instanceof Error ? error.message : String(error));
      }
    };
    tick();
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function mountPublicCounts(app: Hono<{ Bindings: HttpBindings }>, counts: PublicCounts): void {
  app.get("/api/public/counts", (c) => {
    try {
      return c.json(counts.current(), 200, {
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      });
    } catch (error) {
      console.error("[counts] could not answer:", error instanceof Error ? error.message : String(error));
      return c.json({ error: "counts unavailable" }, 503);
    }
  });
}
