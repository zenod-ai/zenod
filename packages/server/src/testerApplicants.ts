// EPIC-26 S21 (Jordi, 2026-11-14 voice note on agent_team E42-S74: "A WhatsApp to Jordi the moment a real
// tester applies, for every product (Zenod too) ... who, from where, where they dropped."): a private,
// read-only list of the real tester applications for the team console, which sends Jordi that WhatsApp.
// GET /api/private/testers/applicants with `Authorization: Bearer <ZENOD_APPLICANTS_READ_TOKEN>`.
// Per applicant: when, the first name or handle they gave, where they came from (the ?s= post id or the
// referring host, as stored), and the furthest step reached; our own test applications are left out by the
// same rule /api/public/counts uses (testerMarks.ts). Never what they wrote.
// Iteration 2 (zenod-applicants/v2, Jordi 2026-11-14 03:16Z, E26-A13: "It can show me the fucking email address
// ... so did we get one tester or two testers? ... Do we know from which link?"): each entry carries the email
// they gave, its number and how many times that person sent the form (a repeat is never a new person), and
// `other_accounts` names every tester-code account counted in /api/public/counts signed_up without an
// application here, or kept out of it as our own test, so the console can say "1 applicant, 1 other account".
// The email is only on this token-gated route; /api/public/counts stays counts only.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { CustomerAccount } from "./customerAccounts.js";
import { isTestAccount } from "./publicCounts.js";
import { bearerMatches, normalizeTesterEmail, type TesterRecord } from "./testerFlow.js";

export const APPLICANT_STEPS = ["applied", "accepted", "signed_up", "whatsapp_linked", "first_save"] as const;
export type ApplicantStep = (typeof APPLICANT_STEPS)[number];

export interface ApplicantView {
  /** Stable and opaque: the same person keeps the same id, so the console sends each one once. */
  id: string;
  /** Applicant no. N: 1 for the first real person who applied, in order of their first application. */
  number: number;
  /** When they first sent the form (ISO). */
  at: string;
  /** The email (or other contact) they gave on the form, as one person; only on this token-gated route. */
  email: string;
  /** How many times this person sent the form; a repeat is the same person, counted once. */
  times_applied: number;
  /** When they last sent the form (ISO); later than `at` only for a repeat. */
  last_applied: string;
  /** With `?since=<ISO>`: true when this person first applied after it (a new person), false when they were
   * already counted then (a repeat or a step change). Without `since`: null. */
  new_since: boolean | null;
  /** One plain line for a message: "Applicant 2 of 3, new" or "Applicant 1 of 3, already counted, sent the form 2 times (one person)". */
  counted: string;
  /** The first name or handle they gave, or the GitHub login they signed in with; null when neither. */
  name: string | null;
  /** The ?s= post id or the referring host, as the form stored it; null for older applications. */
  source: string | null;
  /** The furthest step reached. */
  step: ApplicantStep;
  /** "accepted" or "waitlist" from the tester flow; null when the flow has no record. */
  status: "accepted" | "waitlist" | null;
  /** When each step happened (ISO), or true/false for WhatsApp; null when not (yet) reached or unknown. */
  reached: {
    applied: string;
    accepted: string | null;
    signed_up: string | null;
    whatsapp_linked: boolean | null;
    first_save: string | null;
  };
}

/** A tester-code account with no application in the list: counted in signed_up, or our own test kept out. */
export interface OtherAccountView {
  id: string;
  /** When its free checkout finished (ISO). */
  at: string;
  email: string | null;
  name: string | null;
  /** True for our own test accounts: kept out of /api/public/counts signed_up (counted as test_signups). */
  test: boolean;
  /** True when /api/public/counts signed_up counts it. */
  in_signed_up: boolean;
  why: string;
}

export interface ApplicantsDocument {
  schema: "zenod-applicants/v2";
  at: string;
  steps: readonly ApplicantStep[];
  /** One line that matches /api/public/counts: "1 applicant, 1 other account (our own test)". */
  summary: {
    applicants: number;
    /** Applicants who finished the free checkout. */
    applicants_signed_up: number;
    /** Tester-code accounts with no application; `test` ones are ours and not in signed_up. */
    other_accounts: number;
    other_accounts_test: number;
    /** What /api/public/counts signed_up counts: applicants_signed_up + other accounts that are not tests. */
    signed_up: number;
    line: string;
  };
  applicants: ApplicantView[];
  other_accounts: OtherAccountView[];
  /** Our own test applications, left out of the list. */
  test_applications: number;
}

export interface ApplicantSources {
  applications: () => Array<{ at?: unknown; contact?: unknown; use?: unknown; name?: unknown; source?: unknown }>;
  testers: () => TesterRecord[];
  accounts: () => CustomerAccount[];
  /** Comped accounts (ZENOD_COMPED_ACCOUNT_IDS), counted nowhere, as in /api/public/counts. */
  comped?: ReadonlySet<string>;
  /** When the tenant's first finished save happened (epoch ms), or null. */
  firstSave: (tenantId: string) => number | null;
  /** The WhatsApp state of an account ("verified" etc.), or null when unknown. */
  whatsapp?: (accountId: string) => Promise<string | null>;
  isTest?: (contact: string, use: string) => boolean;
}

const LINKED = new Set(["verified", "degraded", "paused"]);

/** A first name or handle as the applicant gave it; never anything that reads as an email or phone number. */
export function cleanApplicantName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!name) return null;
  if (/\S@\S+\.\S/.test(name) || /\d[\d\s().+-]{5,}\d/.test(name)) return null;
  return name;
}

/** The ?s= post id or a referring host: short, plain characters only. */
export function cleanApplicantSource(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const source = value.trim();
  return /^[A-Za-z0-9._:-]{1,64}$/.test(source) ? source : null;
}

function iso(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function opaqueId(key: string): string {
  return `a_${createHash("sha256").update(`zenod-applicant:${key}`).digest("hex").slice(0, 16)}`;
}

interface Applicant {
  key: string;
  contact: string;
  at: string;
  last: string;
  times: number;
  name: string | null;
  source: string | null;
}

/** The email as they gave it (lower case), or the raw contact cut short; never markup. */
function contactOf(key: string, contact: string): string {
  if (key.includes("@")) return key.slice(0, 200);
  return contact.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The list, newest first. Pure apart from the sources. `sinceMs` marks who is new since the console's last read. */
export async function listApplicants(sources: ApplicantSources, nowMs: number, sinceMs?: number): Promise<ApplicantsDocument> {
  const isTest = sources.isTest ?? (() => false);
  const people = new Map<string, Applicant>();
  const tests = new Set<string>();
  const testAccounts = new Set<string>();
  for (const line of sources.applications()) {
    const contact = typeof line.contact === "string" ? line.contact : "";
    const use = typeof line.use === "string" ? line.use : "";
    const key = (normalizeTesterEmail(contact) ?? contact.trim()).toLowerCase();
    if (!key) continue;
    if (isTest(contact, use)) {
      tests.add(key);
      continue;
    }
    const at = iso(line.at) ?? new Date(nowMs).toISOString();
    const known = people.get(key);
    if (!known) {
      people.set(key, { key, contact: contactOf(key, contact), at, last: at, times: 1, name: cleanApplicantName(line.name), source: cleanApplicantSource(line.source) });
    } else {
      known.times += 1;
      if (at < known.at) known.at = at;
      if (at > known.last) known.last = at;
      known.name ??= cleanApplicantName(line.name);
      known.source ??= cleanApplicantSource(line.source);
    }
  }
  const testers = new Map<string, TesterRecord>();
  for (const tester of sources.testers()) {
    const key = tester.email.toLowerCase();
    if (tests.has(key) || isTest(tester.email, "")) {
      tests.add(key);
      if (tester.redeemedBy) testAccounts.add(tester.redeemedBy);
      people.delete(key);
      continue;
    }
    testers.set(key, tester);
    if (!people.has(key)) {
      const at = iso(tester.appliedAt) ?? new Date(nowMs).toISOString();
      people.set(key, { key, contact: contactOf(key, tester.email), at, last: at, times: 1, name: null, source: null });
    }
  }

  const finished = sources.accounts().filter((account) => account.checkout_completed_at);
  const accountFor = (key: string, tester: TesterRecord | undefined): CustomerAccount | undefined =>
    (tester?.redeemedBy ? finished.find((account) => account.account_id === tester.redeemedBy) : undefined) ??
    finished.find((account) => (account.stripe_email ?? "").toLowerCase() === key);

  const order = [...people.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const numberOf = new Map(order.map((person, index) => [person.key, index + 1]));
  const total = order.length;
  const matched = new Set<string>();
  const applicants: ApplicantView[] = [];
  for (const person of people.values()) {
    const tester = testers.get(person.key);
    const status = tester?.status === "accepted" || tester?.status === "waitlist" ? tester.status : null;
    const accepted = status === "accepted" ? iso(tester?.shownAt) ?? iso(tester?.codeAt) ?? iso(tester?.appliedAt) ?? person.at : null;
    const account = status === "accepted" ? accountFor(person.key, tester) : undefined;
    if (account) matched.add(account.account_id);
    const signedUp = account ? iso(account.checkout_completed_at) : null;
    let whatsapp: boolean | null = null;
    let firstSave: string | null = null;
    if (account) {
      try {
        const state = sources.whatsapp ? await sources.whatsapp(account.account_id) : null;
        whatsapp = state === null ? null : LINKED.has(state);
      } catch {
        whatsapp = null;
      }
      const saved = account.tenant_id ? sources.firstSave(account.tenant_id) : null;
      firstSave = saved === null ? null : new Date(saved).toISOString();
    }
    const step: ApplicantStep = firstSave
      ? "first_save"
      : whatsapp
        ? "whatsapp_linked"
        : signedUp
          ? "signed_up"
          : accepted
            ? "accepted"
            : "applied";
    const number = numberOf.get(person.key)!;
    const newSince = sinceMs === undefined ? null : Date.parse(person.at) > sinceMs;
    // Plain words for the message: a repeat of the form is the same person, never a second tester.
    const state = newSince === true ? "new" : newSince === false || person.times > 1 ? "already counted" : "first application";
    const repeats = person.times > 1 ? `, sent the form ${person.times} times (one person)` : "";
    const counted = `Applicant ${number} of ${total}, ${state}${repeats}`;
    applicants.push({
      id: tester?.id ? opaqueId(`tester:${tester.id}`) : opaqueId(`contact:${person.key}`),
      number,
      at: person.at,
      email: person.contact,
      times_applied: person.times,
      last_applied: person.last,
      new_since: newSince,
      counted,
      name: person.name ?? cleanApplicantName(account?.github_login),
      source: person.source,
      step,
      status,
      reached: { applied: person.at, accepted, signed_up: signedUp, whatsapp_linked: whatsapp, first_save: firstSave },
    });
  }
  applicants.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  // Tester-code accounts with no application above, by the same rule /api/public/counts uses for signed_up.
  const comped = sources.comped ?? new Set<string>();
  const acceptedEmails = new Set([...testers.values()].filter((t) => t.status === "accepted").map((t) => t.email.toLowerCase()));
  const other: OtherAccountView[] = [];
  for (const account of finished) {
    if (matched.has(account.account_id) || comped.has(account.account_id)) continue;
    const email = (account.stripe_email ?? "").trim().toLowerCase();
    const onTesterCode = Boolean(account.fully_discounted && account.free_until) || (email !== "" && acceptedEmails.has(email));
    if (!onTesterCode) continue;
    const test = isTestAccount(account, testAccounts, isTest);
    other.push({
      id: opaqueId(`account:${account.account_id}`),
      at: iso(account.checkout_completed_at) ?? new Date(nowMs).toISOString(),
      email: email || null,
      name: cleanApplicantName(account.github_login),
      test,
      in_signed_up: !test,
      why: test
        ? "our own test account on a tester code (its email or its application is marked a test): not in signed_up, counted as test_signups"
        : "signed up with a tester code without an application on zenod.dev/testers: counted in signed_up",
    });
  }
  other.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const signedUpApplicants = applicants.filter((a) => a.reached.signed_up).length;
  const otherTest = other.filter((o) => o.test).length;
  const otherReal = other.length - otherTest;
  const parts = [plural(applicants.length, "applicant", "applicants")];
  if (other.length) {
    const kinds: string[] = [];
    if (otherReal) kinds.push(`${otherReal} signed up without applying`);
    if (otherTest) kinds.push(otherTest === other.length ? (otherTest === 1 ? "our own test" : "our own tests") : `${otherTest} our own test`);
    parts.push(`${plural(other.length, "other account", "other accounts")} (${kinds.join(", ")})`);
  }
  return {
    schema: "zenod-applicants/v2",
    at: new Date(nowMs).toISOString(),
    steps: APPLICANT_STEPS,
    summary: {
      applicants: applicants.length,
      applicants_signed_up: signedUpApplicants,
      other_accounts: other.length,
      other_accounts_test: otherTest,
      signed_up: signedUpApplicants + otherReal,
      line: parts.join(", "),
    },
    applicants,
    other_accounts: other,
    test_applications: tests.size,
  };
}

/** The tenant's first finished save (store or media ingest, not a self-test), read only; null without one. */
export function tenantFirstSave(tasksPath: string): number | null {
  if (!existsSync(tasksPath)) return null;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(tasksPath, { readOnly: true });
    const columns = new Set((db.prepare("PRAGMA table_info(task_jobs)").all() as Array<{ name: string }>).map((c) => c.name));
    const notSelftest = columns.has("input_json") ? "AND COALESCE(json_extract(input_json, '$.source'), '') <> 'selftest'" : "";
    const row = db
      .prepare(`SELECT MIN(created_at) AS t FROM task_jobs WHERE kind IN ('store', 'media_ingest') AND status='done' ${notSelftest}`)
      .get() as { t: number | null } | undefined;
    return typeof row?.t === "number" ? row.t : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/** Keeps each account's WhatsApp state for a few minutes, so a console polling every 3 minutes asks Phylax rarely. */
export function cachedWhatsAppState(
  read: (accountId: string) => Promise<string | null>,
  ttlMs = 5 * 60_000,
  now: () => number = Date.now,
): (accountId: string) => Promise<string | null> {
  const cache = new Map<string, { at: number; state: string | null }>();
  return async (accountId) => {
    const hit = cache.get(accountId);
    if (hit && now() - hit.at < ttlMs) return hit.state;
    const state = await read(accountId).catch(() => null);
    cache.set(accountId, { at: now(), state });
    return state;
  };
}

export function mountTesterApplicants(
  app: Hono<{ Bindings: HttpBindings }>,
  options: { token: string | undefined; sources: ApplicantSources; now?: () => number },
): void {
  const now = options.now ?? Date.now;
  app.get("/api/private/testers/applicants", async (c) => {
    const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
    if (!bearerMatches(c.req.header("authorization"), options.token)) {
      return c.json({ error: "unauthorized" }, 401, { ...headers, "WWW-Authenticate": "Bearer" });
    }
    const since = c.req.query("since");
    const sinceMs = since ? Date.parse(since) : undefined;
    if (sinceMs !== undefined && !Number.isFinite(sinceMs)) return c.json({ error: "since must be an ISO time" }, 400, headers);
    try {
      return c.json(await listApplicants(options.sources, now(), sinceMs), 200, headers);
    } catch (error) {
      console.error("[applicants] could not answer:", error instanceof Error ? error.message : String(error));
      return c.json({ error: "applicants unavailable" }, 503, headers);
    }
  });
}
