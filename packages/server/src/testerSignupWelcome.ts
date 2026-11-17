// EPIC-26 E26-S33 (zenod-social's improvement request EPIC-6-A4, approved by Jordi 15 Nov; his words 14 Nov: "send
// them a message with a link to the video ... five features to get started on Zenod"): one welcome email, once per
// tester, when they finish the free sign-up, with the approved text word for word (desk note 2026-11-17). Zenod only
// decides who gets it and keeps who got it; the mail goes from Jordi's mailbox through the team's Gmail connection,
// sent by the same vps3 timer as the thank-you and the next-day WhatsApp email (scripts/tester-thanks/send.py), which
// drains this queue first so the welcome is the first email a new tester gets from us.
//
// Who gets it: a real tester (test accounts left out) whose free sign-up is finished (an account with a workspace),
// signed up within the last 7 days (so the 13 Nov tester gets it once now, and nobody older gets it late), never
// twice: the sent record is kept per account and per address in a private file on the data volume.
// One setting, the mode (on | off), switches it off at once; ZENOD_TESTER_SIGNUP_WELCOME sets the start, the ops route wins.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { maskAccount, readTesterSetups, type TesterSetupOptions } from "./testerWhatsAppSetup.js";
import type { PendingMail } from "./welcomeMail.js";
import type { ZenodMail } from "./zenodMail.js";

export const TESTER_SIGNUP_WELCOME_FILE = "tester-signup-welcome.json";
export const WELCOME_UNTIL_MS = 7 * 24 * 60 * 60 * 1000;
const ID_PREFIX = "welcome-";
const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export type SignupWelcomeMode = "on" | "off";

export function parseSignupWelcomeMode(value: unknown): SignupWelcomeMode | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "on" || text === "1" || text === "true") return "on";
  if (text === "off" || text === "0" || text === "false") return "off";
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export const SIGNUP_WELCOME_SUBJECT = "Welcome to Zenod, here is how to start";
export const SIGNUP_WELCOME_VIDEO = "https://www.youtube.com/shorts/bEmBSBM-Phs";
export const SIGNUP_WELCOME_CONNECT = "https://zenod.dev/connect";

/** zenod-social's approved welcome (EPIC-6-A4), word for word. */
export function testerSignupWelcomeMail(to: string): ZenodMail {
  const intro = [
    "Hi,",
    "Thank you for being one of our first ten testers. Your first 30 memories are free, no card.",
    `Here is a 30 second look at what you are about to use: ${SIGNUP_WELCOME_VIDEO}`,
    "Five things to try first:",
  ];
  const steps = [
    "Say something. Send a voice note and Zenod keeps it word for word, then files it by topic.",
    `Connect a tool. Claude, ChatGPT, Cursor, VS Code or Gemini CLI reach your memory over MCP. The steps are at ${SIGNUP_WELCOME_CONNECT}`,
    "Ask it something. Any connected tool can search your memory and open the exact note behind its answer.",
    "Look at the graph. Every memory links to others, and the memories behind an answer light up.",
    "Check where it lives. Your notes sit in your own Google Drive or GitHub, and you can open them in Obsidian any time.",
  ];
  const outro = [
    "One thing we would love back: what made you try Zenod, and what got stuck? A one-minute voice note is enough. Just reply to this message.",
    "The Zenod team",
  ];
  const text = [...intro, steps.map((s, i) => `${i + 1}. ${s}`).join("\n"), ...outro].join("\n\n");
  const link = (s: string) => escapeHtml(s).replace(/https:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:#1f5c45">${url}</a>`);
  const html = `<!doctype html><html><body style="margin:0;background:#f6f2e9;color:#18211c;font:17px/1.6 Georgia,serif">
<div style="max-width:32rem;margin:0 auto;padding:2rem 1.25rem">
${intro.map((p) => `<p>${link(p)}</p>`).join("\n")}
<ol>${steps.map((s) => `<li>${link(s)}</li>`).join("")}</ol>
${outro.map((p) => `<p>${link(p)}</p>`).join("\n")}
</div></body></html>`;
  return { to, subject: SIGNUP_WELCOME_SUBJECT, text, html };
}

interface SentRecord {
  email: string;
  sentAt: string;
  via: string;
  messageId?: string;
}

interface WelcomeState {
  mode?: SignupWelcomeMode;
  setBy?: string;
  setAt?: string;
  sent: Record<string, SentRecord>;
}

export interface TesterSignupWelcomeOptions extends TesterSetupOptions {
  dataDir: string;
  envMode: SignupWelcomeMode;
  now?: () => Date;
}

export interface SignupWelcomeMail extends PendingMail {
  /** masked, for the dry run and logs */
  account: string;
}

export class TesterSignupWelcome {
  private readonly path: string;
  private readonly now: () => Date;

  constructor(private readonly options: TesterSignupWelcomeOptions) {
    this.path = join(options.dataDir, TESTER_SIGNUP_WELCOME_FILE);
    this.now = options.now ?? (() => new Date());
  }

  private read(): WelcomeState {
    if (!existsSync(this.path)) return { sent: {} };
    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<WelcomeState>;
    return { ...parsed, sent: parsed.sent && typeof parsed.sent === "object" ? parsed.sent : {} };
  }

  private write(state: WelcomeState): void {
    mkdirSync(this.options.dataDir, { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.path);
  }

  mode(): SignupWelcomeMode {
    return this.read().mode ?? this.options.envMode;
  }

  setMode(mode: SignupWelcomeMode, by: string): void {
    const state = this.read();
    Object.assign(state, { mode, setBy: by.slice(0, 80), setAt: this.now().toISOString() });
    this.write(state);
  }

  /** The welcomes due now, composed. Empty while off. Nothing is stored until a send is reported. */
  async due(): Promise<SignupWelcomeMail[]> {
    if (this.mode() === "off") return [];
    const state = this.read();
    const sentAddresses = new Set(Object.values(state.sent).map((r) => r.email.trim().toLowerCase()));
    const now = this.now().getTime();
    const out: SignupWelcomeMail[] = [];
    for (const row of await readTesterSetups(this.options)) {
      const signed = Date.parse(row.account.claimed_at);
      const age = now - signed;
      if (!row.email || !EMAIL.test(row.email)) continue;
      if (!Number.isFinite(signed) || age < 0 || age >= WELCOME_UNTIL_MS) continue;
      if (state.sent[row.account.account_id] || sentAddresses.has(row.email)) continue;
      sentAddresses.add(row.email);
      out.push({ id: `${ID_PREFIX}${row.account.account_id}`, account: maskAccount(row.account), ...testerSignupWelcomeMail(row.email), queuedAt: new Date(signed).toISOString() });
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
    console.log(`[tester-signup-welcome] email marked sent via ${via.slice(0, 40)}`);
    return "sent";
  }

  status(): { mode: SignupWelcomeMode; setBy: string | null; setAt: string | null; sent: number } {
    const state = this.read();
    return { mode: this.mode(), setBy: state.setBy ?? null, setAt: state.setAt ?? null, sent: Object.keys(state.sent).length };
  }
}

/**
 * Ops token only. GET/POST /api/ops/testers/signup-welcome: the mode (POST {mode: on|off, by}).
 * GET .../queue: the mails due now (id, account masked, to, subject, text, html). POST .../sent {id, to, via, messageId}.
 */
export function mountTesterSignupWelcomeRoutes(
  app: Hono<{ Bindings: HttpBindings }>,
  options: { isOps: (c: Context) => boolean; welcome: TesterSignupWelcome },
): void {
  const { welcome } = options;
  app.get("/api/ops/testers/signup-welcome", (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    return c.json(welcome.status());
  });
  app.post("/api/ops/testers/signup-welcome", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    const body = await c.req.json<{ mode?: unknown; by?: unknown }>().catch(() => null);
    const mode = parseSignupWelcomeMode(body?.mode);
    if (!mode) return c.json({ error: "mode must be on or off" }, 400);
    welcome.setMode(mode, typeof body?.by === "string" && body.by.trim() ? `ops: ${body.by.trim()}` : "ops");
    return c.json(welcome.status());
  });
  app.get("/api/ops/testers/signup-welcome/queue", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    return c.json({ mode: welcome.mode(), mails: await welcome.due() });
  });
  app.post("/api/ops/testers/signup-welcome/sent", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    const body = await c.req.json<{ id?: unknown; to?: unknown; via?: unknown; messageId?: unknown }>().catch(() => null);
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const to = typeof body?.to === "string" ? body.to.trim() : "";
    const via = typeof body?.via === "string" ? body.via.trim() : "";
    if (!id || !to || !via) return c.json({ error: "id, to and via are required" }, 400);
    const messageId = typeof body?.messageId === "string" && body.messageId.trim() ? body.messageId.trim() : undefined;
    const result = welcome.markSent(id, to, via, messageId);
    if (result === "unknown") return c.json({ error: "not a sign-up welcome id" }, 404);
    return c.json({ result, ...welcome.status() });
  });
}
