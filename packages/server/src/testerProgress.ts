import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HttpBindings } from "@hono/node-server";
import type { Context, Hono } from "hono";
import { customerVaultBinding, type CustomerAccount } from "./customerAccounts.js";
import { maskAccount, readTesterSetups, type TesterSetupOptions } from "./testerWhatsAppSetup.js";

/**
 * EPIC-7 E7-S17 (Jordi vn_b73d7c41, 20 Nov: "how many testers logged in? How many are fully set up ... vault, WhatsApp, one
 * message, one memory?"): the facts behind the daily tester picture, for the team's vps3 timer, read over ssh on VPS1 so
 * the ops token never leaves it. Facts only (the picture decides what is stuck). No email, number, code, note text or full
 * id leaves: the account is a masked email plus the last 4 of its id, the key is the last 8.
 */

const DAY_MS = 86_400_000;
/** How often one person's "seen" time is written, so the sign-in record costs one small write every few minutes. */
export const LAST_SEEN_EVERY_MS = 5 * 60_000;
/** The file's own marker: when recording began, so "not seen" before it is not read as "stayed away". */
const SINCE_KEY = "__since";

/** When each signed-in person last used the app (a user id to epoch ms), in a small file on the data volume. */
export class TesterLastSeen {
  private readonly path: string;
  private data: Record<string, number> | null = null;
  private readonly wrote = new Map<string, number>();

  constructor(dataDir: string, private readonly now: () => number = Date.now) {
    this.path = join(dataDir, "tester-last-seen.json");
  }

  private load(): Record<string, number> {
    if (this.data) return this.data;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Record<string, number>;
      this.data = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      this.data = {};
    }
    return this.data;
  }

  /** Note that this person just used the app; writes at most once per LAST_SEEN_EVERY_MS per person. Never throws. */
  touch(userId: string): void {
    const at = this.now();
    const last = this.wrote.get(userId);
    if (last !== undefined && at - last < LAST_SEEN_EVERY_MS) return;
    this.wrote.set(userId, at);
    try {
      const data = this.load();
      if (typeof data[SINCE_KEY] !== "number") data[SINCE_KEY] = at;
      data[userId] = at;
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      renameSync(tmp, this.path);
    } catch {
      // a failed record must never break a request
    }
  }

  /** When the record began (epoch ms), or null before the first person was seen. */
  since(): number | null {
    const at = this.load()[SINCE_KEY];
    return typeof at === "number" && Number.isFinite(at) ? at : null;
  }

  seenAt(userId: string): number | null {
    const at = this.load()[userId];
    return typeof at === "number" && Number.isFinite(at) ? at : null;
  }
}

export interface TenantJobCounts {
  /** notes the tester sent over WhatsApp that Zenod took in (any outcome), and those in the last 24 h */
  whatsappNotes: number;
  whatsappNotes24h: number;
  /** memories saved, on any channel (finished saves, our own self-tests left out), and those in the last 24 h */
  memoriesSaved: number;
  memoriesSaved24h: number;
  /** E7-S27: voice notes the tester sent on any channel (audio taken in, any outcome, our self-tests left out) */
  voiceNotes: number;
}

const NO_COUNTS: TenantJobCounts = { whatsappNotes: 0, whatsappNotes24h: 0, memoriesSaved: 0, memoriesSaved24h: 0, voiceNotes: 0 };

export function tenantJobCounts(tasksPath: string, tenantId: string, sinceMs: number): TenantJobCounts {
  if (!existsSync(tasksPath)) return NO_COUNTS;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(tasksPath, { readOnly: true });
    const wa = `(idempotency_key LIKE '%:whatsapp:%' OR json_extract(input_json, '$.source') = 'whatsapp')`;
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN ${wa} THEN 1 ELSE 0 END), 0) AS wa,
           COALESCE(SUM(CASE WHEN ${wa} AND updated_at >= ? THEN 1 ELSE 0 END), 0) AS wa24,
           COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS saved,
           COALESCE(SUM(CASE WHEN status = 'done' AND updated_at >= ? THEN 1 ELSE 0 END), 0) AS saved24,
           COALESCE(SUM(CASE WHEN kind = 'media_ingest' AND json_extract(input_json, '$.mediaType') = 'audio' THEN 1 ELSE 0 END), 0) AS voice
         FROM task_jobs
         WHERE tenant_id = ? AND kind IN ('store', 'media_ingest')
           AND COALESCE(json_extract(input_json, '$.source'), '') <> 'selftest'`,
      )
      .get(sinceMs, sinceMs, tenantId) as { wa: number; wa24: number; saved: number; saved24: number; voice: number } | undefined;
    return {
      whatsappNotes: Number(row?.wa ?? 0),
      whatsappNotes24h: Number(row?.wa24 ?? 0),
      memoriesSaved: Number(row?.saved ?? 0),
      memoriesSaved24h: Number(row?.saved24 ?? 0),
      voiceNotes: Number(row?.voice ?? 0),
    };
  } catch {
    return NO_COUNTS;
  } finally {
    db?.close();
  }
}

/** Vault step: the one authoritative vault is ready (GitHub or Google Drive), or the legacy GitHub repo is set. */
export function vaultState(account: CustomerAccount): { set: boolean; provider: string | null; status: string | null } {
  try {
    const binding = customerVaultBinding(account);
    if (binding) return { set: binding.status === "ready", provider: binding.provider, status: binding.status };
  } catch {
    return { set: false, provider: account.vault_provider ?? null, status: "error" };
  }
  return { set: Boolean(account.vault_repo), provider: account.vault_repo ? "github" : null, status: account.vault_repo ? "legacy" : null };
}

export interface TesterProgressOptions extends TesterSetupOptions {
  isOps: (c: Context) => boolean;
  counts: (tenantId: string, sinceMs: number) => TenantJobCounts;
  seenAt: (userId: string) => number | null;
  /** E7-S27: when a WhatsApp message from Zenod's number reached this account (the link welcome, or the first-note nudge), ISO, or null */
  welcomeSentAt?: (accountId: string) => string | null;
  /** when the last-seen record began (epoch ms), or null */
  seenSince?: () => number | null;
  now?: () => number;
}

export interface TesterProgressRow {
  account: string;
  key: string;
  signedUpAt: string;
  vault: { set: boolean; provider: string | null; status: string | null };
  whatsapp: { linked: boolean; step: string; text: string; ourBug: boolean };
  whatsappNotes: number;
  whatsappNotes24h: number;
  memoriesSaved: number;
  memoriesSaved24h: number;
  /** E7-S27: voice notes sent on any channel */
  voiceNotes: number;
  /** E7-S27: when Zenod's welcome WhatsApp reached this tester, or null (never sent, or not recorded) */
  welcomeSentAt: string | null;
  lastSeenAt: string | null;
}

export async function readTesterProgress(options: TesterProgressOptions): Promise<TesterProgressRow[]> {
  const nowMs = options.now?.() ?? Date.now();
  const since = nowMs - DAY_MS;
  const setups = await readTesterSetups(options);
  const rows = setups.map((s): TesterProgressRow & { email: string | null } => {
    const tenant = s.account.tenant_id!;
    const counts = options.counts(tenant, since);
    const seen = options.seenAt(s.account.user_id);
    return {
      email: s.email,
      account: maskAccount(s.account),
      key: s.account.account_id.slice(-8),
      signedUpAt: s.account.claimed_at,
      vault: vaultState(s.account),
      whatsapp: { linked: s.step === "linked", step: s.step, text: s.text, ourBug: s.ourBug },
      ...counts,
      welcomeSentAt: options.welcomeSentAt?.(s.account.account_id) ?? null,
      lastSeenAt: seen ? new Date(seen).toISOString() : null,
    };
  });
  // One person with two accounts is one tester: the first account (earliest sign-up) carries what either did.
  const byEmail = new Map<string, TesterProgressRow & { email: string | null }>();
  const out: Array<TesterProgressRow & { email: string | null }> = [];
  for (const row of rows.sort((a, b) => a.signedUpAt.localeCompare(b.signedUpAt))) {
    const first = row.email ? byEmail.get(row.email) : undefined;
    if (!first) {
      if (row.email) byEmail.set(row.email, row);
      out.push(row);
      continue;
    }
    first.vault = first.vault.set ? first.vault : row.vault;
    if (row.whatsapp.linked && !first.whatsapp.linked) first.whatsapp = row.whatsapp;
    first.whatsappNotes += row.whatsappNotes;
    first.whatsappNotes24h += row.whatsappNotes24h;
    first.memoriesSaved += row.memoriesSaved;
    first.memoriesSaved24h += row.memoriesSaved24h;
    first.voiceNotes += row.voiceNotes;
    if (row.welcomeSentAt && (!first.welcomeSentAt || row.welcomeSentAt < first.welcomeSentAt)) first.welcomeSentAt = row.welcomeSentAt;
    if (row.lastSeenAt && (!first.lastSeenAt || row.lastSeenAt > first.lastSeenAt)) first.lastSeenAt = row.lastSeenAt;
  }
  return out.map(({ email: _email, ...row }) => row);
}

export function mountTesterProgressRoute(app: Hono<{ Bindings: HttpBindings }>, options: TesterProgressOptions): void {
  app.get("/api/ops/testers/progress", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    const rows = await readTesterProgress(options);
    const since = options.seenSince?.() ?? null;
    return c.json({
      generatedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
      lastSeenSince: since ? new Date(since).toISOString() : null,
      testers: rows,
    });
  });
}
