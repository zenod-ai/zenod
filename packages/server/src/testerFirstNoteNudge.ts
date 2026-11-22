// EPIC-7 E7-S26 (Jordi's key result "Testers use voice notes", agent_team desk note 22 Nov): a tester whose WhatsApp has
// been linked for 24 hours and who has saved no note gets one short WhatsApp message from Zenod's own number inviting a
// first voice note. Once per tester ever; our own test accounts are left out; never on a tester who already sent a note.
//
// It goes through the same fixed-text channel as the tester welcome (Phylax account notice, kind first_note_nudge), so
// nothing here can send an arbitrary message. It ships switched OFF: while the mode is off the timer does nothing at all
// (no reads, no sends) until Jordi's yes to the ask that holds the exact text; then the ops route (or ZENOD_TESTER_FIRST_NOTE_NUDGE=on)
// switches it on, and the same route switches it off at once.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { CustomerAccount } from "./customerAccounts.js";
import { accountEmail } from "./testerOnboarding.js";
import { maskAccount, readTesterSetups, type TesterSetupOptions } from "./testerWhatsAppSetup.js";

export const FIRST_NOTE_NUDGE_FILE = "tester-first-note-nudge.json";
/** WhatsApp linked this long with no note before the message goes. */
export const FIRST_NOTE_NUDGE_AFTER_MS = 24 * 60 * 60 * 1000;
export const FIRST_NOTE_SWEEP_MS = 15 * 60 * 1000;
/** A send that failed is tried again on the next sweeps, up to this many times, then left for the team. */
export const FIRST_NOTE_MAX_ATTEMPTS = 3;

export type FirstNoteNudgeMode = "on" | "off";

export function parseFirstNoteNudgeMode(value: unknown): FirstNoteNudgeMode | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "on" || text === "1" || text === "true") return "on";
  if (text === "off" || text === "0" || text === "false") return "off";
  return null;
}

interface AccountRecord {
  /** when Zenod first saw the account linked, used only when it never watched the link itself */
  linkedSeenAt?: string;
  email?: string;
  attempts?: number;
  lastResult?: string;
  sentAt?: string;
}

interface NudgeState {
  mode?: FirstNoteNudgeMode;
  setBy?: string;
  setAt?: string;
  accounts: Record<string, AccountRecord>;
}

export interface FirstNoteNudgeOptions extends TesterSetupOptions {
  dataDir: string;
  /** The starting mode (ZENOD_TESTER_FIRST_NOTE_NUDGE); the runtime setting wins. Off when unset. */
  envMode: FirstNoteNudgeMode;
  /** When Zenod saw this account's WhatsApp link (ISO), null when it did not watch it. */
  linkedAt: (accountId: string) => string | null;
  /** Notes this tester has sent or saved, on any channel (our self-tests left out). */
  noteCount: (tenantId: string) => number;
  /** Sends the fixed message; "sent" only when Phylax delivered it. */
  send: (account: CustomerAccount, operationId: string) => Promise<"sent" | "skipped" | "failed">;
  now?: () => Date;
}

export interface FirstNoteDue {
  account: CustomerAccount;
  /** when the 24 hours ran out */
  dueAt: string;
}

export class TesterFirstNoteNudge {
  private readonly path: string;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private sweeping: Promise<{ sent: number; failed: number }> | null = null;

  constructor(private readonly options: FirstNoteNudgeOptions) {
    this.path = join(options.dataDir, FIRST_NOTE_NUDGE_FILE);
    this.now = options.now ?? (() => new Date());
  }

  private read(): NudgeState {
    if (!existsSync(this.path)) return { accounts: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<NudgeState>;
      return { ...parsed, accounts: parsed.accounts && typeof parsed.accounts === "object" ? parsed.accounts : {} };
    } catch {
      return { accounts: {} };
    }
  }

  private write(state: NudgeState): void {
    mkdirSync(this.options.dataDir, { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.path);
  }

  mode(): FirstNoteNudgeMode {
    return this.read().mode ?? this.options.envMode;
  }

  setMode(mode: FirstNoteNudgeMode, by: string): void {
    const state = this.read();
    Object.assign(state, { mode, setBy: by.slice(0, 80), setAt: this.now().toISOString() });
    this.write(state);
    console.log(`[tester-first-note-nudge] mode set to ${mode} by ${by.slice(0, 80)}`);
  }

  /**
   * Who is due now: real testers with WhatsApp linked 24 hours or more, no note, never sent (by account or by address).
   * Reads the setup of every tester account, so it runs only while the mode is on.
   */
  async due(): Promise<FirstNoteDue[]> {
    const state = this.read();
    const sentAddresses = new Set(
      Object.values(state.accounts).filter((r) => r.sentAt && r.email).map((r) => r.email!.trim().toLowerCase()),
    );
    const nowMs = this.now().getTime();
    const out: FirstNoteDue[] = [];
    let seen = false;
    for (const row of await readTesterSetups(this.options)) {
      const accountId = row.account.account_id;
      // Linked on this very account (not only on another one of the same person): the message goes to this number.
      if (row.read?.state !== "verified" || !row.account.tenant_id) continue;
      const record = state.accounts[accountId] ?? {};
      if (record.sentAt) continue;
      if ((record.attempts ?? 0) >= FIRST_NOTE_MAX_ATTEMPTS) continue;
      const email = (accountEmail(row.account) ?? "").toLowerCase();
      if (email && sentAddresses.has(email)) continue;
      let linkedAt = this.options.linkedAt(accountId) ?? record.linkedSeenAt ?? null;
      if (!linkedAt) {
        linkedAt = this.now().toISOString();
        state.accounts[accountId] = { ...record, linkedSeenAt: linkedAt, ...(email ? { email } : {}) };
        seen = true;
      }
      const dueMs = Date.parse(linkedAt) + FIRST_NOTE_NUDGE_AFTER_MS;
      if (!Number.isFinite(dueMs) || nowMs < dueMs) continue;
      if (this.options.noteCount(row.account.tenant_id) > 0) continue;
      if (email) sentAddresses.add(email);
      out.push({ account: row.account, dueAt: new Date(dueMs).toISOString() });
    }
    if (seen) this.write(state);
    return out;
  }

  /** One pass: send to everyone due. Does nothing while off. Concurrent calls share one pass. */
  sweep(): Promise<{ sent: number; failed: number }> {
    if (this.sweeping) return this.sweeping;
    this.sweeping = (async () => {
      let sent = 0;
      let failed = 0;
      if (this.mode() === "off") return { sent, failed };
      for (const item of await this.due()) {
        // Re-read the switch before each send, so an "off" lands before the next message, not after the pass.
        if (this.mode() === "off") break;
        const accountId = item.account.account_id;
        const result = await this.options.send(item.account, `first-note-nudge-${accountId}`).catch(() => "failed" as const);
        const state = this.read();
        const record = state.accounts[accountId] ?? {};
        const email = (accountEmail(item.account) ?? "").toLowerCase();
        if (result === "sent") {
          sent += 1;
          state.accounts[accountId] = { ...record, ...(email ? { email } : {}), sentAt: this.now().toISOString(), lastResult: "sent" };
          console.log(`[tester-first-note-nudge] sent to ${maskAccount(item.account)}`);
        } else {
          // "skipped" (no linked channel right now) is not an attempt; only a real failure counts toward the cap.
          if (result === "failed") failed += 1;
          state.accounts[accountId] = {
            ...record,
            ...(email ? { email } : {}),
            attempts: (record.attempts ?? 0) + (result === "failed" ? 1 : 0),
            lastResult: result,
          };
        }
        this.write(state);
      }
      return { sent, failed };
    })().finally(() => {
      this.sweeping = null;
    });
    return this.sweeping;
  }

  /** Counts only (no addresses), for the ops route. */
  status(): { mode: FirstNoteNudgeMode; setBy: string | null; setAt: string | null; sent: number; failedGivenUp: number } {
    const state = this.read();
    const records = Object.values(state.accounts);
    return {
      mode: this.mode(),
      setBy: state.setBy ?? null,
      setAt: state.setAt ?? null,
      sent: records.filter((r) => r.sentAt).length,
      failedGivenUp: records.filter((r) => !r.sentAt && (r.attempts ?? 0) >= FIRST_NOTE_MAX_ATTEMPTS).length,
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep().catch((error) => console.error("[tester-first-note-nudge] sweep failed:", error)), FIRST_NOTE_SWEEP_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/**
 * Ops token only. GET/POST /api/ops/testers/first-note-nudge: the mode (POST {mode: on|off, by}); switching on sweeps at once.
 * GET .../due: masked accounts that would get the message now (nothing is sent). POST .../run: one sweep now (off: nothing).
 */
export function mountTesterFirstNoteNudgeRoutes(
  app: Hono<{ Bindings: HttpBindings }>,
  options: { isOps: (c: Context) => boolean; nudge: TesterFirstNoteNudge },
): void {
  const { nudge } = options;
  app.get("/api/ops/testers/first-note-nudge", (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    return c.json(nudge.status());
  });
  app.post("/api/ops/testers/first-note-nudge", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    const body = await c.req.json<{ mode?: unknown; by?: unknown }>().catch(() => null);
    const mode = parseFirstNoteNudgeMode(body?.mode);
    if (!mode) return c.json({ error: "mode must be on or off" }, 400);
    nudge.setMode(mode, typeof body?.by === "string" && body.by.trim() ? `ops: ${body.by.trim()}` : "ops");
    if (mode === "on") void nudge.sweep().catch((error) => console.error("[tester-first-note-nudge] sweep failed:", error));
    return c.json(nudge.status());
  });
  app.get("/api/ops/testers/first-note-nudge/due", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    const due = await nudge.due();
    return c.json({ mode: nudge.mode(), due: due.map((item) => ({ account: maskAccount(item.account), dueAt: item.dueAt })) });
  });
  app.post("/api/ops/testers/first-note-nudge/run", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    return c.json({ ...(await nudge.sweep()), ...nudge.status() });
  });
}
