// EPIC-26 S21 (Jordi, 2026-11-14 voice note on agent_team E42-S74: "A WhatsApp to Jordi the moment a real
// tester applies, for every product (Zenod too) ... who, from where, where they dropped."): a private,
// read-only list of the real tester applications for the team console, which sends Jordi that WhatsApp.
// GET /api/private/testers/applicants with `Authorization: Bearer <ZENOD_APPLICANTS_READ_TOKEN>`.
// Per applicant: when, the first name or handle they gave, where they came from (the ?s= post id or the
// referring host, as stored), and the furthest step reached. Never an email, a phone number or what they
// wrote; our own test applications are left out by the same rule /api/public/counts uses (testerMarks.ts).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { CustomerAccount } from "./customerAccounts.js";
import { bearerMatches, normalizeTesterEmail, type TesterRecord } from "./testerFlow.js";

export const APPLICANT_STEPS = ["applied", "accepted", "signed_up", "whatsapp_linked", "first_save"] as const;
export type ApplicantStep = (typeof APPLICANT_STEPS)[number];

export interface ApplicantView {
  /** Stable and opaque: the same person keeps the same id, so the console sends each one once. */
  id: string;
  /** When they first sent the form (ISO). */
  at: string;
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

export interface ApplicantsDocument {
  schema: "zenod-applicants/v1";
  at: string;
  steps: readonly ApplicantStep[];
  applicants: ApplicantView[];
  /** Our own test applications, left out of the list. */
  test_applications: number;
}

export interface ApplicantSources {
  applications: () => Array<{ at?: unknown; contact?: unknown; use?: unknown; name?: unknown; source?: unknown }>;
  testers: () => TesterRecord[];
  accounts: () => CustomerAccount[];
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
  at: string;
  name: string | null;
  source: string | null;
}

/** The list, newest first. Pure apart from the sources. */
export async function listApplicants(sources: ApplicantSources, nowMs: number): Promise<ApplicantsDocument> {
  const isTest = sources.isTest ?? (() => false);
  const people = new Map<string, Applicant>();
  const tests = new Set<string>();
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
      people.set(key, { key, at, name: cleanApplicantName(line.name), source: cleanApplicantSource(line.source) });
    } else {
      if (at < known.at) known.at = at;
      known.name ??= cleanApplicantName(line.name);
      known.source ??= cleanApplicantSource(line.source);
    }
  }
  const testers = new Map<string, TesterRecord>();
  for (const tester of sources.testers()) {
    const key = tester.email.toLowerCase();
    if (tests.has(key) || isTest(tester.email, "")) {
      tests.add(key);
      people.delete(key);
      continue;
    }
    testers.set(key, tester);
    if (!people.has(key)) people.set(key, { key, at: iso(tester.appliedAt) ?? new Date(nowMs).toISOString(), name: null, source: null });
  }

  const finished = sources.accounts().filter((account) => account.checkout_completed_at);
  const accountFor = (key: string, tester: TesterRecord | undefined): CustomerAccount | undefined =>
    (tester?.redeemedBy ? finished.find((account) => account.account_id === tester.redeemedBy) : undefined) ??
    finished.find((account) => (account.stripe_email ?? "").toLowerCase() === key);

  const applicants: ApplicantView[] = [];
  for (const person of people.values()) {
    const tester = testers.get(person.key);
    const status = tester?.status === "accepted" || tester?.status === "waitlist" ? tester.status : null;
    const accepted = status === "accepted" ? iso(tester?.shownAt) ?? iso(tester?.codeAt) ?? iso(tester?.appliedAt) ?? person.at : null;
    const account = status === "accepted" ? accountFor(person.key, tester) : undefined;
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
    applicants.push({
      id: tester?.id ? opaqueId(`tester:${tester.id}`) : opaqueId(`contact:${person.key}`),
      at: person.at,
      name: person.name ?? cleanApplicantName(account?.github_login),
      source: person.source,
      step,
      status,
      reached: { applied: person.at, accepted, signed_up: signedUp, whatsapp_linked: whatsapp, first_save: firstSave },
    });
  }
  applicants.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return {
    schema: "zenod-applicants/v1",
    at: new Date(nowMs).toISOString(),
    steps: APPLICANT_STEPS,
    applicants,
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
    try {
      return c.json(await listApplicants(options.sources, now()), 200, headers);
    } catch (error) {
      console.error("[applicants] could not answer:", error instanceof Error ? error.message : String(error));
      return c.json({ error: "applicants unavailable" }, 503, headers);
    }
  });
}
