import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HttpBindings } from "@hono/node-server";
import type { Context, Hono } from "hono";
import type { CustomerAccount } from "./customerAccounts.js";
import { accountEmail, type PersonFacts } from "./testerFacts.js";

/**
 * EPIC-7 E7-S9 (Jordi vn_27afac4e, 8 Nov: "I am so worried that all this feedback is going to get lost"): each tester
 * gets their own voice feedback link (the team's voice-feedback service, product Zenod, campaign testers), shown in the
 * app as one quiet "Tell us what you think" entry.
 *
 * The links are made by the team console, which runs on VPS3 only, so production never calls it. A vps3 timer
 * (scripts/tester-feedback/sync.py, the zenod-tester-stuck pattern) reads the testers here over the ops route on VPS1,
 * makes a link for each new tester on the console, hands it back here with each link's count of filed notes, and
 * `feedback_recorded` in the public counts reads those counts. One link per person (two accounts with one email share
 * it), kept for good. Nothing here messages a tester.
 */
export const TESTER_FEEDBACK_FILE = "tester-feedback.json";

export interface TesterFeedbackLink {
  /** The console's link id (fbl_…). */
  linkId: string;
  /** The public recording page, https://…/api/public/feedback/<token>. */
  url: string;
  /** Voice notes filed through this link (the console's count), as of `checkedAt`. */
  notes: number;
  at: string;
  checkedAt: string;
}

/** account_id -> its link. */
export type TesterFeedbackLinks = Record<string, TesterFeedbackLink>;

export function readTesterFeedback(dataDir: string): TesterFeedbackLinks {
  const path = join(dataDir, TESTER_FEEDBACK_FILE);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { links?: TesterFeedbackLinks };
    return parsed.links && typeof parsed.links === "object" ? parsed.links : {};
  } catch {
    return {};
  }
}

function writeTesterFeedback(dataDir: string, links: TesterFeedbackLinks): void {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, TESTER_FEEDBACK_FILE);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ links }, null, 1)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

const LINK_URL = /^https:\/\/[a-z0-9.-]+(:\d+)?\/api\/public\/feedback\/[A-Za-z0-9_-]{8,}$/;
const LINK_ID = /^fbl_[A-Za-z0-9_-]{4,}$/;

export interface TesterFeedbackOptions {
  dataDir: string;
  accounts: () => CustomerAccount[];
  isTester: (account: CustomerAccount) => boolean;
  isTest: (account: CustomerAccount) => boolean;
  isOps: (c: Context) => boolean;
  /** The signed-in user's account (the app's session), null when signed out. */
  sessionAccount: (c: Context) => CustomerAccount | null;
  /** E7-S40: the tester's name with where it came from (the application joined by code, or the Google sign-in). */
  facts?: (account: CustomerAccount) => PersonFacts;
  now?: () => number;
}

/** Accounts that get a link: testers who finished the free checkout (cancelled left out); our own test accounts flagged. */
export function feedbackTesters(options: Pick<TesterFeedbackOptions, "accounts" | "isTester" | "isTest">): Array<{ account: CustomerAccount; test: boolean }> {
  return options.accounts()
    .filter((account) => account.checkout_completed_at && account.subscription_status !== "checkout_pending"
      && account.subscription_status !== "canceled" && options.isTester(account))
    .map((account) => ({ account, test: options.isTest(account) }));
}

/** The link the app shows to this account, or null (not a tester, or no link made yet). */
export function feedbackLinkFor(dataDir: string, account: CustomerAccount | null, isTester: (account: CustomerAccount) => boolean): string | null {
  if (!account || !isTester(account) || account.subscription_status === "canceled") return null;
  return readTesterFeedback(dataDir)[account.account_id]?.url ?? null;
}

export function mountTesterFeedbackRoutes(app: Hono<{ Bindings: HttpBindings }>, options: TesterFeedbackOptions): void {
  const now = () => new Date(options.now?.() ?? Date.now()).toISOString();

  // The app: the signed-in tester's own link; non-testers get null and the app shows nothing.
  app.get("/api/console/feedback-link", (c) => {
    const account = options.sessionAccount(c);
    if (!account) return c.json({ error: "unauthorized" }, 401);
    c.header("cache-control", "no-store");
    return c.json({ url: feedbackLinkFor(options.dataDir, account, options.isTester) });
  });

  // The vps3 timer: who needs a link (the ops token never leaves VPS1). "who" names the person for the filed notes.
  app.get("/api/ops/testers/feedback-links", (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    const links = readTesterFeedback(options.dataDir);
    return c.json({
      generatedAt: now(),
      testers: feedbackTesters(options).map(({ account, test }) => {
        const email = (accountEmail(account) ?? "").toLowerCase();
        const first = options.facts?.(account).name ?? null;
        const link = links[account.account_id];
        return {
          accountId: account.account_id,
          email: email || null,
          // the recording page greets them with it: "Hi Dana (dana@…)"; our own tests start TEST, as on the console
          who: `${test ? "TEST " : ""}${first ? `${first} (${email})` : email || account.account_id}`,
          test,
          link: link ? { linkId: link.linkId, url: link.url, notes: link.notes } : null,
        };
      }),
    });
  });

  // The vps3 timer hands back each link (new or known) with its count of filed notes.
  app.post("/api/ops/testers/feedback-links", async (c) => {
    if (!options.isOps(c)) return c.json({ error: "not found" }, 404);
    const body = await c.req.json<{ links?: unknown }>().catch(() => null);
    if (!body || !Array.isArray(body.links)) return c.json({ error: "links must be a list" }, 400);
    const known = new Set(options.accounts().map((account) => account.account_id));
    const links = readTesterFeedback(options.dataDir);
    const at = now();
    let saved = 0;
    const refused: string[] = [];
    for (const raw of body.links as Array<Record<string, unknown>>) {
      const accountId = typeof raw?.accountId === "string" ? raw.accountId : "";
      const linkId = typeof raw?.linkId === "string" ? raw.linkId : "";
      const url = typeof raw?.url === "string" ? raw.url : "";
      const notes = Number.isInteger(raw?.notes) && (raw.notes as number) >= 0 ? (raw.notes as number) : 0;
      if (!known.has(accountId) || !LINK_ID.test(linkId) || !LINK_URL.test(url)) {
        refused.push(accountId || "(no account)");
        continue;
      }
      const was = links[accountId];
      links[accountId] = { linkId, url, notes, at: was && was.linkId === linkId ? was.at : at, checkedAt: at };
      saved += 1;
    }
    if (saved) writeTesterFeedback(options.dataDir, links);
    return c.json({ saved, refused });
  });
}
