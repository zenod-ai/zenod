// EPIC-7 E7-S28 (Jordi's approval of his own words on ask E7-A36, voice note vn_d99286a7, 2026-11-22): "what if a tester
// has signed up and after 48 hours they haven't done anything, we should send that email". One email from Jordi, once per
// tester ever, 48 hours or more after sign-up when no notes place is connected and WhatsApp is not linked. Zenod only
// decides who gets it and keeps who got it; the mail goes from Jordi's mailbox through the team's Gmail connection, sent
// by the same vps3 timer and ledger as the next-day email (scripts/tester-thanks/send.py).
//
// Who gets it: a real tester (test accounts left out) with no notes place connected and WhatsApp not linked on any of
// their accounts, signed up 48 hours ago or longer (no upper limit: a tester who stays idle still gets it once, which is
// how the testers waiting on 22 Nov are reached), never on a step that is our own bug (the team helps by hand), and
// never twice: the sent record is kept per account and per address. The next-day email (24 to 48 hours) never overlaps
// it, so no tester is mailed both at once and none gets this one twice.
// One setting, the mode (on | off), switches it off at once; ZENOD_TESTER_SETUP_EMAIL sets the start, the ops route wins.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { CustomerAccount } from "./customerAccounts.js";
import { vaultState } from "./testerProgress.js";
import { maskAccount, readTesterSetups, type TesterSetupOptions } from "./testerWhatsAppSetup.js";
import type { PendingMail } from "./welcomeMail.js";
import { mailFacts, personFacts } from "./testerFacts.js";
import type { ZenodMail } from "./zenodMail.js";

export const TESTER_SETUP_EMAIL_FILE = "tester-setup-email.json";
export const SETUP_EMAIL_AFTER_MS = 48 * 60 * 60 * 1000;
export const SETUP_EMAIL_ID_PREFIX = "setup-";
const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export type SetupEmailMode = "on" | "off";

export function parseSetupEmailMode(value: unknown): SetupEmailMode | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "on" || text === "1" || text === "true") return "on";
  if (text === "off" || text === "0" || text === "false") return "off";
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * Jordi's own words (voice note vn_107694fc, 22 Nov), approved by him on E7-A36 with one change: every sentence starts
 * with a capital letter. The three steps sit on their own lines. Nothing else is changed.
 */
export const SETUP_EMAIL_SUBJECT = "Your Zenod setup";
export const SETUP_EMAIL_INTRO = "Hey, thank you so much for giving Zenod a try. I noticed that you signed up but haven't fully set it up yet. Here is what is left:";
export const SETUP_EMAIL_STEPS = ["Connect your GitHub or Google Drive.", "Connect WhatsApp.", "Try saving a memory."] as const;
export const SETUP_EMAIL_OUTRO = "Zenod exists to make your memory yours, in a way that makes it easy to add memories to it and read from it. If there is anything I can do to help you get set up, let me know.";
export const SETUP_EMAIL_SIGNATURE = "Jordi";

export function testerSetupEmail(to: string): ZenodMail {
  const text = [
    SETUP_EMAIL_INTRO,
    SETUP_EMAIL_STEPS.map((step, i) => `${i + 1}. ${step}`).join("\n"),
    SETUP_EMAIL_OUTRO,
    SETUP_EMAIL_SIGNATURE,
  ].join("\n\n");
  const paragraph = (p: string) => `<p>${escapeHtml(p)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f2e9;color:#18211c;font:17px/1.6 Georgia,serif">
<div style="max-width:32rem;margin:0 auto;padding:2rem 1.25rem">
${paragraph(SETUP_EMAIL_INTRO)}
<ol>
${SETUP_EMAIL_STEPS.map((step) => `<li>${escapeHtml(step)}</li>`).join("\n")}
</ol>
${paragraph(SETUP_EMAIL_OUTRO)}
${paragraph(SETUP_EMAIL_SIGNATURE)}
</div></body></html>`;
  return { to, subject: SETUP_EMAIL_SUBJECT, text, html };
}

interface SentRecord {
  email: string;
  sentAt: string;
  via: string;
  messageId?: string;
}

interface SetupEmailState {
  mode?: SetupEmailMode;
  setBy?: string;
  setAt?: string;
  sent: Record<string, SentRecord>;
}

export interface TesterSetupEmailOptions extends TesterSetupOptions {
  dataDir: string;
  envMode: SetupEmailMode;
  /** True when the account's notes place (GitHub or Google Drive) is connected and ready. */
  vaultSet?: (account: CustomerAccount) => boolean;
  now?: () => Date;
}

export interface SetupEmailMail extends PendingMail {
  /** masked, for the dry run and logs */
  account: string;
}

export class TesterSetupEmail {
  private readonly path: string;
  private readonly now: () => Date;

  constructor(private readonly options: TesterSetupEmailOptions) {
    this.path = join(options.dataDir, TESTER_SETUP_EMAIL_FILE);
    this.now = options.now ?? (() => new Date());
  }

  private read(): SetupEmailState {
    if (!existsSync(this.path)) return { sent: {} };
    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<SetupEmailState>;
    return { ...parsed, sent: parsed.sent && typeof parsed.sent === "object" ? parsed.sent : {} };
  }

  private write(state: SetupEmailState): void {
    mkdirSync(this.options.dataDir, { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.path);
  }

  mode(): SetupEmailMode {
    return this.read().mode ?? this.options.envMode;
  }

  setMode(mode: SetupEmailMode, by: string): void {
    const state = this.read();
    Object.assign(state, { mode, setBy: by.slice(0, 80), setAt: this.now().toISOString() });
    this.write(state);
  }

  /** The mails due now, composed. Empty while off. Nothing is stored until a send is reported. */
  async due(): Promise<SetupEmailMail[]> {
    if (this.mode() === "off") return [];
    const state = this.read();
    const vaultSet = this.options.vaultSet ?? ((account: CustomerAccount) => vaultState(account).set);
    const sentAddresses = new Set(Object.values(state.sent).map((r) => r.email.trim().toLowerCase()));
    const now = this.now().getTime();
    const rows = await readTesterSetups(this.options);
    // One person with two accounts is one tester: a notes place connected on either means connected.
    const connected = new Set(rows.filter((r) => r.email && vaultSet(r.account)).map((r) => r.email));
    const out: SetupEmailMail[] = [];
    for (const row of rows) {
      const signed = Date.parse(row.account.claimed_at);
      if (row.step === "linked" || row.ourBug || !row.email || !EMAIL.test(row.email)) continue;
      if (!Number.isFinite(signed) || now - signed < SETUP_EMAIL_AFTER_MS) continue;
      if (vaultSet(row.account) || connected.has(row.email)) continue;
      if (state.sent[row.account.account_id] || sentAddresses.has(row.email)) continue;
      sentAddresses.add(row.email);
      out.push({
        id: `${SETUP_EMAIL_ID_PREFIX}${row.account.account_id}`,
        account: maskAccount(row.account),
        ...testerSetupEmail(row.email),
        queuedAt: new Date(signed + SETUP_EMAIL_AFTER_MS).toISOString(),
        // E7-S40: its approved words open with "Hey,", so it carries only where the address came from.
        facts: mailFacts(personFacts(row.account, null), false),
      });
    }
    return out;
  }

  /** An outside sender reports one mail sent; idempotent. */
  markSent(id: string, to: string, via: string, messageId?: string): "sent" | "already sent" | "unknown" {
    if (!id.startsWith(SETUP_EMAIL_ID_PREFIX) || id.length === SETUP_EMAIL_ID_PREFIX.length) return "unknown";
    const accountId = id.slice(SETUP_EMAIL_ID_PREFIX.length);
    const state = this.read();
    if (state.sent[accountId]) return "already sent";
    state.sent[accountId] = { email: to.trim().toLowerCase(), sentAt: this.now().toISOString(), via: via.slice(0, 40), ...(messageId ? { messageId: messageId.slice(0, 200) } : {}) };
    this.write(state);
    console.log(`[tester-setup-email] email marked sent via ${via.slice(0, 40)}`);
    return "sent";
  }

  status(): { mode: SetupEmailMode; setBy: string | null; setAt: string | null; sent: number } {
    const state = this.read();
    return { mode: this.mode(), setBy: state.setBy ?? null, setAt: state.setAt ?? null, sent: Object.keys(state.sent).length };
  }
}

/**
 * Ops token only. GET/POST /api/ops/testers/setup-email: the mode (POST {mode: on|off, by}).
 * GET .../queue: the mails due now (id, account masked, to, subject, text, html). POST .../sent {id, to, via, messageId}.
 */
export function mountTesterSetupEmailRoutes(
  app: Hono<{ Bindings: HttpBindings }>,
  options: { isOps: (c: Context) => boolean; setupEmail: TesterSetupEmail },
): void {
  const { setupEmail } = options;
  app.get("/api/ops/testers/setup-email", (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    return c.json(setupEmail.status());
  });
  app.post("/api/ops/testers/setup-email", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    const body = await c.req.json<{ mode?: unknown; by?: unknown }>().catch(() => null);
    const mode = parseSetupEmailMode(body?.mode);
    if (!mode) return c.json({ error: "mode must be on or off" }, 400);
    setupEmail.setMode(mode, typeof body?.by === "string" && body.by.trim() ? `ops: ${body.by.trim()}` : "ops");
    return c.json(setupEmail.status());
  });
  app.get("/api/ops/testers/setup-email/queue", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    return c.json({ mode: setupEmail.mode(), mails: await setupEmail.due() });
  });
  app.post("/api/ops/testers/setup-email/sent", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    const body = await c.req.json<{ id?: unknown; to?: unknown; via?: unknown; messageId?: unknown }>().catch(() => null);
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const to = typeof body?.to === "string" ? body.to.trim() : "";
    const via = typeof body?.via === "string" ? body.via.trim() : "";
    if (!id || !to || !via) return c.json({ error: "id, to and via are required" }, 400);
    const messageId = typeof body?.messageId === "string" && body.messageId.trim() ? body.messageId.trim() : undefined;
    const result = setupEmail.markSent(id, to, via, messageId);
    if (result === "unknown") return c.json({ error: "not a setup email id" }, 404);
    return c.json({ result, ...setupEmail.status() });
  });
}
