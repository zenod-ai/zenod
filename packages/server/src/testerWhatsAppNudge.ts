// EPIC-26 E26-S32 (Jordi's "APPROVED" on ask E26-A17, 2026-11-16): one email from Jordi, once per tester ever, the
// day after sign-up when WhatsApp is still not linked, with the exact approved words (E7-A29 changed them on 2026-11-22). Zenod only decides who gets
// it and keeps who got it; the mail goes from Jordi's mailbox through the team's Gmail connection, sent by the
// same vps3 timer as the thank-you (scripts/tester-thanks/send.py), which reads the queue here and reports each send.
//
// Who gets it: a real tester (test accounts left out) whose WhatsApp is not linked on any of their accounts,
// signed up between 24 and 48 hours ago (the mail says "yesterday", and nobody who signed up before it went live
// gets it late), never on a step that is our own bug (the team is alarmed and helps by hand), and never twice:
// the sent record is kept per account and per address in a private file on the data volume.
// One setting, the mode (on | off), switches it off at once; ZENOD_TESTER_NUDGE sets the start, the ops route wins.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { mailFacts, type PersonFacts } from "./testerFacts.js";
import { vaultState } from "./testerProgress.js";
import type { CustomerAccount } from "./customerAccounts.js";
import { maskAccount, readTesterSetups, type TesterSetupOptions } from "./testerWhatsAppSetup.js";
import type { PendingMail } from "./welcomeMail.js";
import type { ZenodMail } from "./zenodMail.js";

export const TESTER_NUDGE_FILE = "tester-whatsapp-nudge.json";
export const NUDGE_AFTER_MS = 24 * 60 * 60 * 1000;
export const NUDGE_UNTIL_MS = 48 * 60 * 60 * 1000;
const ID_PREFIX = "nudge-";
const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export type NudgeMode = "on" | "off";

export function parseNudgeMode(value: unknown): NudgeMode | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "on" || text === "1" || text === "true") return "on";
  if (text === "off" || text === "0" || text === "false") return "off";
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * The approved next-day email (E7-A29, Jordi 2026-11-22, replacing the E26-A17 words): the Open WhatsApp button opens
 * cloud.zenod.dev, where the one-time code is made, so the text also names the address for a plain-text reader.
 */
export const NUDGE_SUBJECT = "Your first Zenod note is one tap away";
export const NUDGE_BUTTON_LABEL = "Open WhatsApp";
export const NUDGE_BUTTON_URL = "https://cloud.zenod.dev";

export function testerWhatsAppNudgeMail(to: string, firstName: string | null): ZenodMail {
  const hi = firstName ? `Hi ${firstName},` : "Hi,";
  const before = [
    hi,
    "You signed up for Zenod yesterday. One tap and it starts hearing your voice notes: open cloud.zenod.dev on your phone, tap Open WhatsApp, press send.",
  ];
  const after = [
    "If it asks where to keep your notes, pick Google Drive or GitHub. It is your own folder.",
    "Stuck? Reply and tell me what you see. I read every reply.",
    "Jordi",
  ];
  const paragraph = (p: string) => `<p>${escapeHtml(p)}</p>`;
  const button = `<p><a href="${NUDGE_BUTTON_URL}" style="display:inline-block;background:#1f4d36;color:#ffffff;text-decoration:none;padding:.7rem 1.4rem;border-radius:6px;font:600 16px Arial,sans-serif">${NUDGE_BUTTON_LABEL}</a></p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f2e9;color:#18211c;font:17px/1.6 Georgia,serif">
<div style="max-width:32rem;margin:0 auto;padding:2rem 1.25rem">
${before.map(paragraph).join("\n")}
${button}
${after.map(paragraph).join("\n")}
</div></body></html>`;
  return { to, subject: NUDGE_SUBJECT, text: [...before, ...after].join("\n\n"), html };
}

interface SentRecord {
  email: string;
  sentAt: string;
  via: string;
  messageId?: string;
}

interface NudgeState {
  mode?: NudgeMode;
  setBy?: string;
  setAt?: string;
  sent: Record<string, SentRecord>;
}

export interface TesterNudgeOptions extends TesterSetupOptions {
  dataDir: string;
  envMode: NudgeMode;
  /** E7-S40: the address and name a mail to this account uses, with where each came from. */
  facts: (account: CustomerAccount) => PersonFacts;
  /** E7-S40: the step before WhatsApp, storage connected (tests inject; default: the account's vault state). */
  vaultSet?: (account: CustomerAccount) => boolean;
  now?: () => Date;
}

export interface NudgeMail extends PendingMail {
  /** masked, for the dry run and logs */
  account: string;
}

export class TesterWhatsAppNudge {
  private readonly path: string;
  private readonly now: () => Date;

  constructor(private readonly options: TesterNudgeOptions) {
    this.path = join(options.dataDir, TESTER_NUDGE_FILE);
    this.now = options.now ?? (() => new Date());
  }

  private read(): NudgeState {
    if (!existsSync(this.path)) return { sent: {} };
    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<NudgeState>;
    return { ...parsed, sent: parsed.sent && typeof parsed.sent === "object" ? parsed.sent : {} };
  }

  private write(state: NudgeState): void {
    mkdirSync(this.options.dataDir, { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.path);
  }

  mode(): NudgeMode {
    return this.read().mode ?? this.options.envMode;
  }

  setMode(mode: NudgeMode, by: string): void {
    const state = this.read();
    Object.assign(state, { mode, setBy: by.slice(0, 80), setAt: this.now().toISOString() });
    this.write(state);
  }

  /** The mails due now, composed. Empty while off. Nothing is stored until a send is reported. */
  async due(): Promise<NudgeMail[]> {
    if (this.mode() === "off") return [];
    const state = this.read();
    const sentAddresses = new Set(Object.values(state.sent).map((r) => r.email.trim().toLowerCase()));
    const now = this.now().getTime();
    const out: NudgeMail[] = [];
    const vaultSet = this.options.vaultSet ?? ((account: CustomerAccount) => vaultState(account).set);
    const rows = await readTesterSetups(this.options);
    const stored = new Set(rows.filter((r) => r.email && vaultSet(r.account)).map((r) => r.email));
    for (const row of rows) {
      const signed = Date.parse(row.account.claimed_at);
      const age = now - signed;
      if (row.step === "linked" || row.ourBug || !row.email || !EMAIL.test(row.email)) continue;
      if (!Number.isFinite(signed) || age < NUDGE_AFTER_MS || age >= NUDGE_UNTIL_MS) continue;
      // E7-S40: the mail asks for WhatsApp, the step after storage; a tester whose storage is not connected (on any of
      // their accounts) is still on the step before and does not get it (Vitor got it on 20 Nov with storage not done).
      if (!vaultSet(row.account) && !stored.has(row.email)) continue;
      if (state.sent[row.account.account_id] || sentAddresses.has(row.email)) continue;
      sentAddresses.add(row.email);
      const facts = this.options.facts(row.account);
      const mail = testerWhatsAppNudgeMail(row.email, facts.name);
      out.push({ id: `${ID_PREFIX}${row.account.account_id}`, account: maskAccount(row.account), ...mail, queuedAt: new Date(signed + NUDGE_AFTER_MS).toISOString(), facts: mailFacts(facts) });
    }
    return out;
  }

  /** An outside sender reports one mail sent; idempotent. */
  markSent(id: string, to: string, via: string, messageId?: string): "sent" | "already sent" | "unknown" {
    if (!id.startsWith(ID_PREFIX) || id.length === ID_PREFIX.length) return "unknown";
    const accountId = id.slice(ID_PREFIX.length);
    const state = this.read();
    if (state.sent[accountId]) return "already sent";
    state.sent[accountId] = { email: to.trim().toLowerCase(), sentAt: this.now().toISOString(), via: via.slice(0, 40), ...(messageId ? { messageId: messageId.slice(0, 200) } : {}) };
    this.write(state);
    console.log(`[tester-whatsapp-nudge] email marked sent via ${via.slice(0, 40)}`);
    return "sent";
  }

  status(): { mode: NudgeMode; setBy: string | null; setAt: string | null; sent: number } {
    const state = this.read();
    return { mode: this.mode(), setBy: state.setBy ?? null, setAt: state.setAt ?? null, sent: Object.keys(state.sent).length };
  }
}

/**
 * Ops token only. GET/POST /api/ops/testers/whatsapp-nudge: the mode (POST {mode: on|off, by}).
 * GET .../queue: the mails due now (id, account masked, to, subject, text, html). POST .../sent {id, to, via, messageId}.
 */
export function mountTesterWhatsAppNudgeRoutes(
  app: Hono<{ Bindings: HttpBindings }>,
  options: { isOps: (c: Context) => boolean; nudge: TesterWhatsAppNudge },
): void {
  const { nudge } = options;
  app.get("/api/ops/testers/whatsapp-nudge", (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    return c.json(nudge.status());
  });
  app.post("/api/ops/testers/whatsapp-nudge", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    const body = await c.req.json<{ mode?: unknown; by?: unknown }>().catch(() => null);
    const mode = parseNudgeMode(body?.mode);
    if (!mode) return c.json({ error: "mode must be on or off" }, 400);
    nudge.setMode(mode, typeof body?.by === "string" && body.by.trim() ? `ops: ${body.by.trim()}` : "ops");
    return c.json(nudge.status());
  });
  app.get("/api/ops/testers/whatsapp-nudge/queue", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    return c.json({ mode: nudge.mode(), mails: await nudge.due() });
  });
  app.post("/api/ops/testers/whatsapp-nudge/sent", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    const body = await c.req.json<{ id?: unknown; to?: unknown; via?: unknown; messageId?: unknown }>().catch(() => null);
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const to = typeof body?.to === "string" ? body.to.trim() : "";
    const via = typeof body?.via === "string" ? body.via.trim() : "";
    if (!id || !to || !via) return c.json({ error: "id, to and via are required" }, 400);
    const messageId = typeof body?.messageId === "string" && body.messageId.trim() ? body.messageId.trim() : undefined;
    const result = nudge.markSent(id, to, via, messageId);
    if (result === "unknown") return c.json({ error: "not a WhatsApp nudge id" }, 404);
    return c.json({ result, ...nudge.status() });
  });
}
