// EPIC-7 E7-S48 (Jordi's Yes on E7-S47, 28 Nov: "Yes: Nox gets the new welcome once"): a tester whose WhatsApp linked
// before the welcome was rewritten (E7-S47, voice note first with one example) gets the new welcome once, on the number
// linked on their account. The text is the fixed tester welcome (Phylax account notice, kind tester_welcome), so nothing
// here can send an arbitrary message. Once per account ever: the record below answers "already sent" to a second call,
// and its own Phylax operationId makes a retry after a lost answer a no-op. No email: the testers' mail hold (E7-A46)
// stays as it is. It only ever runs when an operator calls the ops route for one named account.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { CustomerAccount } from "./customerAccounts.js";
import { accountEmail } from "./testerOnboarding.js";
import { maskAccount } from "./testerWhatsAppSetup.js";

export const WELCOME_ONCE_FILE = "tester-welcome-once.json";

export interface WelcomeOnceReceipt {
  result: "sent" | "skipped" | "failed";
  messageId?: string | null;
  status?: string | null;
  at?: string | null;
}

interface WelcomeOnceRecord {
  result: string;
  by: string;
  at: string;
  messageId?: string | null;
  status?: string | null;
}

export interface WelcomeOnceOptions {
  dataDir: string;
  accounts: () => CustomerAccount[];
  isTester: (account: CustomerAccount) => boolean;
  whatsappState: (accountId: string) => Promise<string | null>;
  send: (account: CustomerAccount, operationId: string) => Promise<WelcomeOnceReceipt>;
  now?: () => Date;
}

export class TesterWelcomeOnce {
  private readonly path: string;

  constructor(private readonly options: WelcomeOnceOptions) {
    this.path = join(options.dataDir, WELCOME_ONCE_FILE);
  }

  private read(): Record<string, WelcomeOnceRecord> {
    if (!existsSync(this.path)) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as { accounts?: Record<string, WelcomeOnceRecord> };
      return parsed.accounts && typeof parsed.accounts === "object" ? parsed.accounts : {};
    } catch {
      return {};
    }
  }

  private write(accounts: Record<string, WelcomeOnceRecord>): void {
    mkdirSync(this.options.dataDir, { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ accounts })}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.path);
  }

  status(): { sent: Array<WelcomeOnceRecord & { account: string }> } {
    const accounts = this.options.accounts();
    return {
      sent: Object.entries(this.read()).map(([accountId, record]) => {
        const account = accounts.find((entry) => entry.account_id === accountId);
        return { account: account ? maskAccount(account) : "unknown", ...record };
      }),
    };
  }

  /** The account a call names: by id, or by its sign-in email; of two accounts with one email, the linked one. */
  async find(accountId: string, email: string): Promise<CustomerAccount | null> {
    const all = this.options.accounts();
    const matches = accountId
      ? all.filter((entry) => entry.account_id === accountId)
      : email
        ? all.filter((entry) => accountEmail(entry)?.toLowerCase() === email || entry.github_email?.trim().toLowerCase() === email)
        : [];
    if (matches.length <= 1) return matches[0] ?? null;
    for (const entry of matches) {
      if ((await this.options.whatsappState(entry.account_id).catch(() => null)) === "verified") return entry;
    }
    return matches[0] ?? null;
  }

  private sending = new Set<string>();

  async sendOnce(account: CustomerAccount, by: string): Promise<{ code: number; body: Record<string, unknown> }> {
    const id = account.account_id;
    const masked = maskAccount(account);
    if (!this.options.isTester(account)) return { code: 409, body: { account: masked, result: "not a tester" } };
    const existing = this.read()[id];
    if (existing && existing.result === "sent") return { code: 409, body: { account: masked, ...existing, result: "already sent", sentAt: existing.at } };
    if (this.sending.has(id)) return { code: 409, body: { account: masked, result: "sending" } };
    const state = await this.options.whatsappState(id).catch(() => null);
    if (state !== "verified") return { code: 409, body: { account: masked, result: "whatsapp not linked", whatsapp: state } };
    this.sending.add(id);
    try {
      const receipt: WelcomeOnceReceipt = await this.options.send(account, `tester-welcome-once-${id}`).catch(() => ({ result: "failed" as const }));
      const record: WelcomeOnceRecord = {
        result: receipt.result,
        by: by.slice(0, 120),
        at: (this.options.now?.() ?? new Date()).toISOString(),
        messageId: receipt.messageId ?? null,
        status: receipt.status ?? null,
      };
      const all = this.read();
      all[id] = record;
      this.write(all);
      console.log(`[tester-welcome-once] ${receipt.result} to ${masked} by ${record.by}`);
      return { code: receipt.result === "sent" ? 200 : 502, body: { account: masked, ...record } };
    } finally {
      this.sending.delete(id);
    }
  }
}

/** Ops token only. GET /api/ops/testers/welcome-once: who got it. POST {accountId | email, by}: send it once to that account. */
export function mountTesterWelcomeOnceRoutes(
  app: Hono<{ Bindings: HttpBindings }>,
  options: { isOps: (c: Context) => boolean; welcome: TesterWelcomeOnce },
): void {
  const { welcome } = options;
  app.get("/api/ops/testers/welcome-once", (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    return c.json(welcome.status());
  });
  app.post("/api/ops/testers/welcome-once", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    const body = await c.req.json<{ accountId?: unknown; email?: unknown; by?: unknown }>().catch(() => null);
    const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const by = typeof body?.by === "string" ? body.by.trim() : "";
    if (!by) return c.json({ error: "by is required (who sends it, and on which approval)" }, 400);
    const account = await welcome.find(accountId, email);
    if (!account) return c.json({ error: "no account with that id or email" }, 404);
    const result = await welcome.sendOnce(account, `ops: ${by}`);
    return c.json(result.body, result.code as 200);
  });
}
