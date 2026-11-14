import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { expect, it } from "vitest";
import type { CustomerAccount } from "../src/customerAccounts.js";
import { readApplications } from "../src/publicCounts.js";
import {
  cachedWhatsAppState,
  cleanApplicantName,
  cleanApplicantSource,
  listApplicants,
  mountTesterApplicants,
  tenantFirstSave,
  type ApplicantSources,
} from "../src/testerApplicants.js";
import { mountTesterApplications } from "../src/testerApplications.js";
import type { TesterRecord } from "../src/testerFlow.js";
import { looksLikeOurTest } from "../src/testerMarks.js";

// E26-S21: who applied, from where and how far they got, for the team console only.

const NOW = Date.UTC(2026, 10, 14, 12);
const TOKEN = "t".repeat(40);

function account(id: string, patch: Partial<CustomerAccount>): CustomerAccount {
  return {
    account_id: id, session_id: `s-${id}`, user_id: `u-${id}`, product: "zenod", tier: null,
    stripe_email: `${id}@mail.net`, subscription_status: "active", checkout_completed_at: "2026-11-13T20:36:00Z",
    tenant_id: `t-${id}`, fully_discounted: true, free_until: "2026-12-13T00:00:00Z", github_login: null,
    ...patch,
  } as CustomerAccount;
}

function tester(id: string, email: string, status: TesterRecord["status"], patch: Partial<TesterRecord> = {}): TesterRecord {
  return { id, email, appliedAt: "2026-11-13T20:33:00Z", status, ...patch };
}

function sources(patch: Partial<ApplicantSources> = {}): ApplicantSources {
  return {
    applications: () => [
      { at: "2026-11-13T20:33:00Z", contact: "ana@mail.net", use: "voice notes on walks", name: "Ana", source: "P-0219" },
      { at: "2026-11-13T21:00:00Z", contact: "Ana@mail.net ", use: "again" },
      { at: "2026-11-14T01:00:00Z", contact: "bo@mail.net", use: "claude code notes", source: "reddit.com" },
      { at: "2026-11-14T02:00:00Z", contact: "cy@mail.net", use: "everything", name: "@cy_dev" },
      { at: "2026-11-14T03:00:00Z", contact: "dee@mail.net", use: "projects", name: "Dee" },
      { at: "2026-11-14T04:00:00Z", contact: "jordi@zenod.dev", use: "a TEST application", name: "Jordi" },
      { at: "2026-11-14T05:00:00Z", contact: "late@mail.net", use: "everything" },
    ],
    testers: () => [
      tester("tid-ana", "ana@mail.net", "accepted", { redeemedBy: "acc-ana", shownAt: "2026-11-13T20:33:05Z" }),
      tester("tid-bo", "bo@mail.net", "accepted"),
      tester("tid-cy", "cy@mail.net", "accepted"),
      tester("tid-dee", "dee@mail.net", "accepted"),
      tester("tid-test", "jordi@zenod.dev", "accepted"),
      tester("tid-late", "late@mail.net", "waitlist"),
    ],
    accounts: () => [
      account("acc-ana", { stripe_email: "someone-else@mail.net", github_login: "ana-gh" }),
      account("acc-cy", { stripe_email: "cy@mail.net" }),
      account("acc-dee", { stripe_email: "dee@mail.net" }),
      account("acc-pending", { stripe_email: "bo@mail.net", checkout_completed_at: null }),
    ],
    firstSave: (tenantId) => (tenantId === "t-acc-dee" ? Date.UTC(2026, 10, 14, 3, 30) : null),
    whatsapp: async (accountId) => (accountId === "acc-cy" || accountId === "acc-dee" ? "verified" : "awaiting_code"),
    isTest: (contact, use) => looksLikeOurTest(contact, use),
    ...patch,
  };
}

function appWith(source: ApplicantSources, token: string | undefined = TOKEN) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  mountTesterApplicants(app, { token, sources: source, now: () => NOW });
  return app;
}

it("answers 401 without a token, with a wrong token and when no token is set", async () => {
  expect((await appWith(sources()).request("/api/private/testers/applicants")).status).toBe(401);
  const wrong = await appWith(sources()).request("/api/private/testers/applicants", { headers: { Authorization: `Bearer ${"x".repeat(40)}` } });
  expect(wrong.status).toBe(401);
  expect(JSON.stringify(await wrong.json())).not.toMatch(/@|Ana|P-0219/);
  const unset = await appWith(sources(), "").request("/api/private/testers/applicants", { headers: { Authorization: `Bearer ${TOKEN}` } });
  expect(unset.status).toBe(401);
  const short = await appWith(sources(), "short").request("/api/private/testers/applicants", { headers: { Authorization: "Bearer short" } });
  expect(short.status).toBe(401);
});

it("with the right token lists each real applicant, newest first, with the email they gave and never what they wrote", async () => {
  const response = await appWith(sources()).request("/api/private/testers/applicants", { headers: { Authorization: `Bearer ${TOKEN}` } });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json() as { schema: string; applicants: Array<Record<string, unknown>>; test_applications: number };
  expect(body.schema).toBe("zenod-applicants/v2");
  expect(body.test_applications).toBe(1);
  expect(body.applicants.map((a) => [a.email, a.name, a.source, a.step, a.status])).toEqual([
    ["late@mail.net", null, null, "applied", "waitlist"],
    ["dee@mail.net", "Dee", null, "first_save", "accepted"],
    ["cy@mail.net", "@cy_dev", null, "whatsapp_linked", "accepted"],
    ["bo@mail.net", null, "reddit.com", "accepted", "accepted"],
    ["ana@mail.net", "Ana", "P-0219", "signed_up", "accepted"],
  ]);
  const ana = body.applicants[4]!;
  expect(ana).toMatchObject({
    at: "2026-11-13T20:33:00.000Z",
    reached: { applied: "2026-11-13T20:33:00.000Z", accepted: "2026-11-13T20:33:05.000Z", signed_up: "2026-11-13T20:36:00.000Z", whatsapp_linked: false, first_save: null },
  });
  expect(body.applicants[1]!.reached).toMatchObject({ whatsapp_linked: true, first_save: "2026-11-14T03:30:00.000Z" });
  expect(new Set(body.applicants.map((a) => a.id)).size).toBe(5);
  const text = JSON.stringify(body);
  // Our own test application stays out, and so does what anyone wrote or any internal id.
  expect(text).not.toMatch(/jordi@zenod\.dev|voice notes|claude code|tid-|acc-|t-acc/);
});

it("says plainly whether each entry is a new person or one already counted", async () => {
  const all = await listApplicants(sources(), NOW);
  const ana = all.applicants.find((a) => a.email === "ana@mail.net")!;
  // Ana sent the form twice: one person, counted once, applicant 1 of 5.
  expect(ana).toMatchObject({ number: 1, times_applied: 2, last_applied: "2026-11-13T21:00:00.000Z", new_since: null });
  expect(ana.counted).toBe("Applicant 1 of 5, already counted, sent the form 2 times (one person)");
  expect(all.applicants.find((a) => a.email === "late@mail.net")!.counted).toBe("Applicant 5 of 5, first application");

  // The console passes its last read: who applied after it is new, everyone else was already counted.
  const app = appWith(sources());
  const since = await app.request("/api/private/testers/applicants?since=2026-11-14T02:30:00Z", { headers: { Authorization: `Bearer ${TOKEN}` } });
  const body = await since.json() as { applicants: Array<{ email: string; new_since: boolean; counted: string }> };
  expect(body.applicants.map((a) => [a.email, a.new_since])).toEqual([
    ["late@mail.net", true], ["dee@mail.net", true], ["cy@mail.net", false], ["bo@mail.net", false], ["ana@mail.net", false],
  ]);
  expect(body.applicants[0]!.counted).toBe("Applicant 5 of 5, new");
  expect(body.applicants[2]!.counted).toBe("Applicant 3 of 5, already counted");
  const bad = await app.request("/api/private/testers/applicants?since=yesterday", { headers: { Authorization: `Bearer ${TOKEN}` } });
  expect(bad.status).toBe(400);
});

it("names the other tester-code accounts so the list matches signed_up in the public counts", async () => {
  const withOthers = sources({
    accounts: () => [
      ...sources().accounts(),
      // Our T7 rehearsal: a tester code, an alpha9.io email, no real application.
      account("acc-t7", { stripe_email: "operations+t7r3@alpha9.io", checkout_completed_at: "2026-11-11T05:40:00Z" }),
      // Someone handed a code directly, no form.
      account("acc-direct", { stripe_email: "friend@mail.net", checkout_completed_at: "2026-11-12T10:00:00Z", github_login: "friend-gh" }),
      account("acc-comped", { stripe_email: "comp@mail.net" }),
      account("acc-paying", { stripe_email: "pay@mail.net", fully_discounted: false, free_until: null }),
    ],
    comped: new Set(["acc-comped"]),
  });
  const doc = await listApplicants(withOthers, NOW);
  expect(doc.other_accounts.map((o) => [o.email, o.name, o.test, o.in_signed_up])).toEqual([
    ["friend@mail.net", "friend-gh", false, true],
    ["operations+t7r3@alpha9.io", null, true, false],
  ]);
  expect(doc.summary).toEqual({
    applicants: 5, applicants_signed_up: 3, other_accounts: 2, other_accounts_test: 1, signed_up: 4,
    line: "5 applicants, 2 other accounts (1 signed up without applying, 1 our own test)",
  });
  // Today on production: one real applicant and our own test account.
  const today = await listApplicants(sources({
    applications: () => [{ at: "2026-11-13T20:33:00Z", contact: "ana@mail.net", use: "x", source: "P-0219" }],
    testers: () => [tester("tid-ana", "ana@mail.net", "accepted", { redeemedBy: "acc-ana" })],
    accounts: () => [account("acc-ana", {}), account("acc-t7", { stripe_email: "operations+t7r3@alpha9.io" })],
  }), NOW);
  expect(today.summary.line).toBe("1 applicant, 1 other account (our own test)");
  expect(today.summary.signed_up).toBe(1);
  expect(today.applicants[0]!.source).toBe("P-0219");
});

it("keeps the email off the public counts", async () => {
  const { funnelCounts } = await import("../src/publicCounts.js");
  const s = sources();
  const counts = funnelCounts({ ...s, comped: new Set(), savesSince: () => 0 }, NOW);
  expect(JSON.stringify(counts)).not.toMatch(/@|mail\.net/);
});

it("ids stay the same between reads and the name falls back to the GitHub login", async () => {
  const first = await listApplicants(sources(), NOW);
  const second = await listApplicants(sources(), NOW + 60_000);
  expect(second.applicants.map((a) => a.id)).toEqual(first.applicants.map((a) => a.id));
  const noName = await listApplicants(sources({
    applications: () => [{ at: "2026-11-13T20:33:00Z", contact: "ana@mail.net", use: "x" }],
  }), NOW);
  expect(noName.applicants.find((a) => a.step === "signed_up")?.name).toBe("ana-gh");
  const unknownWhatsapp = await listApplicants(sources({ whatsapp: async () => { throw new Error("down"); } }), NOW);
  expect(unknownWhatsapp.applicants.find((a) => a.name === "@cy_dev")?.reached.whatsapp_linked).toBeNull();
});

it("keeps names and sources plain, never an email or a phone number", () => {
  expect(cleanApplicantName("  Ana  ")).toBe("Ana");
  expect(cleanApplicantName("@ana_dev")).toBe("@ana_dev");
  expect(cleanApplicantName("ana@mail.net")).toBeNull();
  expect(cleanApplicantName("Ana +34 612 345 678")).toBeNull();
  expect(cleanApplicantName("")).toBeNull();
  expect(cleanApplicantName(12)).toBeNull();
  expect(cleanApplicantSource("P-0219")).toBe("P-0219");
  expect(cleanApplicantSource("www.reddit.com")).toBe("www.reddit.com");
  expect(cleanApplicantSource("https://x.com/a?b=c")).toBeNull();
  expect(cleanApplicantSource("x".repeat(65))).toBeNull();
});

it("the apply form keeps the name and source it is given, cleaned", async () => {
  const dir = mkdtempSync(join(tmpdir(), "applicants-"));
  const app = new Hono<{ Bindings: HttpBindings }>();
  mountTesterApplications(app, { dataDir: dir, clientAddress: () => "1.2.3.4" });
  const send = (body: Record<string, unknown>) =>
    app.request("/api/public/testers/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  expect((await send({ use: "voice notes on my walks", contact: "ana@mail.net", name: "Ana", source: "P-0219" })).status).toBe(200);
  expect((await send({ use: "voice notes on my walks", contact: "bo@mail.net", name: "bo@mail.net", source: "https://evil/?x" })).status).toBe(200);
  const lines = readApplications(dir) as Array<Record<string, unknown>>;
  expect(lines[0]).toMatchObject({ name: "Ana", source: "P-0219" });
  expect(lines[1]).not.toHaveProperty("name");
  expect(lines[1]).not.toHaveProperty("source");
});

it("reads a tenant's first finished save, leaving self-tests out", () => {
  const dir = mkdtempSync(join(tmpdir(), "applicants-"));
  const path = join(dir, "tasks.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE task_jobs (id TEXT, tenant_id TEXT, kind TEXT, status TEXT, input_json TEXT, created_at INTEGER, updated_at INTEGER)`);
  const insert = db.prepare(`INSERT INTO task_jobs VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insert.run("1", "t", "store", "done", JSON.stringify({ source: "selftest" }), 100, 100);
  insert.run("2", "t", "store", "error", "{}", 150, 150);
  insert.run("3", "t", "chat", "done", "{}", 160, 160);
  insert.run("4", "t", "media_ingest", "done", "{}", 300, 300);
  insert.run("5", "t", "store", "done", "{}", 400, 400);
  db.close();
  expect(tenantFirstSave(path)).toBe(300);
  expect(tenantFirstSave(join(dir, "missing.sqlite"))).toBeNull();
  writeFileSync(join(dir, "broken.sqlite"), "not a database");
  expect(tenantFirstSave(join(dir, "broken.sqlite"))).toBeNull();
});

it("asks Phylax for an account's WhatsApp state at most once in five minutes", async () => {
  let calls = 0;
  let now = NOW;
  const read = cachedWhatsAppState(async () => { calls += 1; return "verified"; }, 5 * 60_000, () => now);
  expect(await read("a")).toBe("verified");
  now += 60_000;
  expect(await read("a")).toBe("verified");
  expect(calls).toBe(1);
  now += 5 * 60_000;
  await read("a");
  expect(calls).toBe(2);
});
