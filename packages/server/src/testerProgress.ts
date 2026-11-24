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
  /** E7-S31: memories saved from WhatsApp (finished store or media jobs on the WhatsApp channel) */
  whatsappWrites: number;
  /** E7-S31: WhatsApp messages Zenod answered from the memory (a chat turn whose outcome was an answer, or keep and answer) */
  whatsappReads: number;
  /** E7-S31: memories saved by an agent over MCP (the app's "connector" channel: not WhatsApp, Telegram or the web app) */
  agentWrites: number;
  /** E7-S31: questions an agent put to Zenod over MCP (finished chat jobs not from WhatsApp, Telegram or the web app) */
  agentChats: number;
}

const NO_COUNTS: TenantJobCounts = {
  whatsappNotes: 0, whatsappNotes24h: 0, memoriesSaved: 0, memoriesSaved24h: 0, voiceNotes: 0,
  whatsappWrites: 0, whatsappReads: 0, agentWrites: 0, agentChats: 0,
};

export function tenantJobCounts(tasksPath: string, tenantId: string, sinceMs: number): TenantJobCounts {
  if (!existsSync(tasksPath)) return NO_COUNTS;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(tasksPath, { readOnly: true });
    const wa = `(idempotency_key LIKE '%:whatsapp:%' OR json_extract(input_json, '$.source') = 'whatsapp')`;
    // E7-S31: the same channel rule as the app's recent saves (recentSaves.ts channelOf): WhatsApp, Telegram and the web
    // app are channels of their own; everything else came in over MCP from an agent ("connector").
    const agent = `(COALESCE(idempotency_key, '') NOT LIKE '%:whatsapp:%' AND COALESCE(idempotency_key, '') NOT LIKE '%:telegram:%'
      AND COALESCE(json_extract(input_json, '$.source'), '') NOT IN ('whatsapp', 'telegram', 'web'))`;
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
    let use: { waw: number; war: number; agw: number; agc: number } | undefined;
    try {
      use = db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN kind IN ('store', 'media_ingest') AND ${wa} THEN 1 ELSE 0 END), 0) AS waw,
             COALESCE(SUM(CASE WHEN kind = 'chat' AND ${wa}
               AND json_extract(result_json, '$.outcome') IN ('answer', 'both') THEN 1 ELSE 0 END), 0) AS war,
             COALESCE(SUM(CASE WHEN kind IN ('store', 'media_ingest') AND ${agent} THEN 1 ELSE 0 END), 0) AS agw,
             COALESCE(SUM(CASE WHEN kind = 'chat' AND ${agent} THEN 1 ELSE 0 END), 0) AS agc
           FROM task_jobs
           WHERE tenant_id = ? AND status = 'done' AND kind IN ('store', 'media_ingest', 'chat')
             AND COALESCE(json_extract(input_json, '$.source'), '') <> 'selftest'`,
        )
        .get(tenantId) as { waw: number; war: number; agw: number; agc: number } | undefined;
    } catch {
      use = undefined; // an older store without these columns keeps the E7-S27 counts
    }
    return {
      whatsappNotes: Number(row?.wa ?? 0),
      whatsappNotes24h: Number(row?.wa24 ?? 0),
      memoriesSaved: Number(row?.saved ?? 0),
      memoriesSaved24h: Number(row?.saved24 ?? 0),
      voiceNotes: Number(row?.voice ?? 0),
      whatsappWrites: Number(use?.waw ?? 0),
      whatsappReads: Number(use?.war ?? 0),
      agentWrites: Number(use?.agw ?? 0),
      agentChats: Number(use?.agc ?? 0),
    };
  } catch {
    return NO_COUNTS;
  } finally {
    db?.close();
  }
}

/**
 * E7-S31: MCP tools that only read the memory. A call to one of these is an agent's read (WhatsApp never calls them:
 * it reaches Zenod through chat_with_zenod and store_memory, counted from the task jobs instead).
 */
export const MCP_READ_TOOLS: readonly string[] = ["search_memory", "get_memory", "memory_cloud", "ask_brain", "get_raw_artifact"];

export interface TenantMcpReads {
  /** read-tool calls an agent made over MCP, from the chassis usage ledger */
  reads: number;
  /** when the ledger first named the tools of a call (epoch ms), or null: calls before that cannot be split */
  since: number | null;
}

/** E7-S31: an agent's MCP read-tool calls for one tenant, from the chassis usage ledger (usage.sqlite). Read only. */
export function tenantMcpReads(usagePath: string, tenantId: string): TenantMcpReads {
  if (!existsSync(usagePath)) return { reads: 0, since: null };
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(usagePath, { readOnly: true });
    const marks = MCP_READ_TOOLS.map(() => "?").join(", ");
    const row = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM tenant_usage u, json_each(u.metadata_json, '$.tools') t
             WHERE u.tenant_id = ? AND u.kind = 'mcp.request' AND json_valid(u.metadata_json) AND t.value IN (${marks})) AS reads,
           (SELECT MIN(ts) FROM tenant_usage WHERE kind = 'mcp.request' AND json_valid(metadata_json)
             AND json_type(metadata_json, '$.tools') = 'array') AS since`,
      )
      .get(tenantId, ...MCP_READ_TOOLS) as { reads: number; since: number | null } | undefined;
    return { reads: Number(row?.reads ?? 0), since: row?.since == null ? null : Number(row.since) };
  } catch {
    return { reads: 0, since: null };
  } finally {
    db?.close();
  }
}

/** E7-S31: how an assistant first reached this tester's memory over MCP: an OAuth sign-in, or a personal MCP token used. */
export interface McpSignIn {
  via: "oauth" | "token";
  at: number;
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
  /** E7-S31: the first MCP sign-in or personal-token use for this account and tenant, or null */
  mcpSignIn?: (accountId: string, tenantId: string) => McpSignIn | null;
  /** E7-S31: an agent's MCP read-tool calls for this tenant */
  mcpReads?: (tenantId: string) => TenantMcpReads;
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
  /**
   * E7-S31 (Jordi vn_aa7447c3: "they have MCP connected ... we have not been measuring"): an assistant reached this
   * memory over MCP: signed in with OAuth, used a personal MCP token, or read or saved through MCP at all.
   */
  mcp: {
    connected: boolean;
    via: "oauth" | "token" | "activity" | null;
    /** the first OAuth sign-in, or the personal token's last use (the token store keeps only that); null for activity */
    at: string | null;
  };
  /** E7-S31: reads and writes to the memory, from WhatsApp and from agents over MCP. Counts only, never content. */
  memoryUse: {
    whatsapp: { reads: number; writes: number };
    agents: { reads: number; writes: number };
    /** when MCP read-tool calls began to be told apart (ISO), or null; agent reads before it count chats only */
    agentReadsSince: string | null;
  };
}

export async function readTesterProgress(options: TesterProgressOptions): Promise<TesterProgressRow[]> {
  const nowMs = options.now?.() ?? Date.now();
  const since = nowMs - DAY_MS;
  const setups = await readTesterSetups(options);
  const rows = setups.map((s): TesterProgressRow & { email: string | null } => {
    const tenant = s.account.tenant_id!;
    const { whatsappWrites = 0, whatsappReads = 0, agentWrites = 0, agentChats = 0, ...counts } = options.counts(tenant, since);
    const seen = options.seenAt(s.account.user_id);
    const mcpReads = options.mcpReads?.(tenant) ?? { reads: 0, since: null };
    const agentReads = agentChats + mcpReads.reads;
    const signIn = options.mcpSignIn?.(s.account.account_id, tenant) ?? null;
    const mcp: TesterProgressRow["mcp"] = signIn
      ? { connected: true, via: signIn.via, at: new Date(signIn.at).toISOString() }
      : agentReads + agentWrites > 0
        ? { connected: true, via: "activity", at: null }
        : { connected: false, via: null, at: null };
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
      mcp,
      memoryUse: {
        whatsapp: { reads: whatsappReads, writes: whatsappWrites },
        agents: { reads: agentReads, writes: agentWrites },
        agentReadsSince: mcpReads.since ? new Date(mcpReads.since).toISOString() : null,
      },
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
    if (!first.mcp.connected || (row.mcp.at && first.mcp.at && row.mcp.at < first.mcp.at)) {
      if (row.mcp.connected) first.mcp = row.mcp;
    }
    first.memoryUse.whatsapp.reads += row.memoryUse.whatsapp.reads;
    first.memoryUse.whatsapp.writes += row.memoryUse.whatsapp.writes;
    first.memoryUse.agents.reads += row.memoryUse.agents.reads;
    first.memoryUse.agents.writes += row.memoryUse.agents.writes;
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
