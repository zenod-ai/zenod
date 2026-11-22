import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { expect, it } from "vitest";
import type { CustomerAccount } from "../src/customerAccounts.js";
import { funnelCounts, sourceCounts, mountPublicCounts, PublicCounts, readApplications, tenantSavesSince, tenantSpendBetween, tenantWhatsAppSaves, type CountSources } from "../src/publicCounts.js";
import type { TesterRecord } from "../src/testerFlow.js";

// EPIC-26 S7: the funnel as counts only, readable by anyone.

const NOW = Date.UTC(2026, 10, 10, 12);

function account(id: string, patch: Partial<CustomerAccount>): CustomerAccount {
  return {
    account_id: id, session_id: `s-${id}`, user_id: `u-${id}`, product: "zenod", tier: null,
    stripe_email: `${id}@example.com`, subscription_status: "active", checkout_completed_at: "2026-11-01T00:00:00Z",
    tenant_id: `t-${id}`, fully_discounted: false, free_until: null,
    ...patch,
  } as CustomerAccount;
}

function tester(email: string, status: TesterRecord["status"]): TesterRecord {
  return { id: email, email, appliedAt: "2026-11-09T00:00:00Z", status };
}

function sources(patch: Partial<CountSources> = {}): CountSources {
  return {
    applications: () => [{ contact: "A@Example.com" }, { contact: "a@example.com " }, { contact: "b@example.com" }, { contact: "c@example.com" }],
    testers: () => [tester("a@example.com", "accepted"), tester("b@example.com", "accepted"), tester("c@example.com", "waitlist")],
    accounts: () => [
      account("owner", { fully_discounted: false }),                                   // comped: counts nowhere
      account("friend", { fully_discounted: true, free_until: null }),                 // free forever: counts nowhere
      account("t1", { fully_discounted: true, free_until: "2026-12-01T00:00:00Z" }),   // tester, saved this week
      account("t2", { fully_discounted: true, free_until: "2026-12-01T00:00:00Z" }),   // tester, no saves
      account("b", { fully_discounted: true, free_until: null, stripe_email: "b@example.com" }), // accepted email, saved
      account("pending", { checkout_completed_at: null, subscription_status: "checkout_pending" }),
      account("payer", {}),
      account("gone", { subscription_status: "canceled" }),
    ],
    comped: new Set(["owner"]),
    savesSince: (tenantId) => (tenantId === "t-t1" || tenantId === "t-b" || tenantId === "t-payer" ? 3 : 0),
    ...patch,
  };
}

it("counts applications, accepted, signed up, active testers and paying customers, with no names", () => {
  expect(funnelCounts(sources(), NOW)).toEqual({
    applications: 3,
    accepted: 2,
    signed_up: 3,
    active_testers: 2,
    paying_customers: 1,
    whatsapp_replied: 0,
    feedback_recorded: 0,
    over_cap: 0,
    test_applications: 0,
    test_signups: 0,
  });
});

it("leaves our own test accounts on a tester code out of signed_up and active testers (E26-S21 iteration 2)", () => {
  const base = sources();
  const counts = funnelCounts(sources({
    accounts: () => [
      ...base.accounts(),
      account("t7", { stripe_email: "operations+t7r3@alpha9.io", fully_discounted: true, free_until: "2026-12-11T00:00:00Z", tenant_id: "t-t1" }),
    ],
    isTest: (contact) => contact.endsWith("@alpha9.io"),
  }), NOW);
  const before = funnelCounts(base, NOW);
  expect(counts).toMatchObject({ signed_up: before.signed_up, active_testers: before.active_testers, test_signups: 1 });
});

it("counts signed-up testers with a Saved reply on WhatsApp, our own test accounts left out (E7-S8)", () => {
  const base = sources();
  const counts = funnelCounts(sources({
    accounts: () => [
      ...base.accounts(),
      // our own T7 test account on a tester code, with WhatsApp saves: counted nowhere but test_signups
      account("t7", { stripe_email: "operations+t7r3@alpha9.io", fully_discounted: true, free_until: "2026-12-11T00:00:00Z" }),
    ],
    // t1 (tester), payer (not a tester), friend (free forever) and t7 (our test) all saved on WhatsApp
    whatsappSaves: (tenantId) => (["t-t1", "t-payer", "t-friend", "t-t7"].includes(tenantId) ? 2 : 0),
    isTest: (contact) => contact.endsWith("@alpha9.io"),
  }), NOW);
  expect(counts).toMatchObject({ signed_up: 3, whatsapp_replied: 1, test_signups: 1 });
});

it("counts testers with a filed voice feedback note, one per link, our own test accounts left out (E7-S9)", () => {
  const base = sources();
  const counts = funnelCounts(sources({
    accounts: () => [
      ...base.accounts(),
      account("t7", { stripe_email: "operations+t7r3@alpha9.io", fully_discounted: true, free_until: "2026-12-11T00:00:00Z" }),
    ],
    // t1 filed two notes; b holds a link with none; payer (not a tester) and t7 (our test) filed notes too
    feedbackNotes: (accountId) => ({ t1: { linkId: "fbl_t1", notes: 2 }, b: { linkId: "fbl_b", notes: 0 },
      payer: { linkId: "fbl_payer", notes: 1 }, t7: { linkId: "fbl_t7", notes: 3 } } as Record<string, { linkId: string; notes: number }>)[accountId] ?? null,
    isTest: (contact) => contact.endsWith("@alpha9.io"),
  }), NOW);
  expect(counts).toMatchObject({ signed_up: 3, feedback_recorded: 1, test_signups: 1 });
  expect(funnelCounts(base, NOW).feedback_recorded).toBe(0);
});

const DAY = 86_400_000;

it("counts testers whose spend this month is above their cap and who spent in the last 7 days, our own tests left out (E7-S24)", () => {
  const base = sources();
  // spend rows per tenant: [ts, usd, provider]
  const rows: Record<string, Array<[number, number, string]>> = {
    "t-t1": [[NOW - 3 * DAY, 4, "anthropic"], [NOW - 1 * DAY, 7, "anthropic"]],  // 11 on a cap of 10, spent this week: over
    "t-t2": [[NOW - 20 * DAY, 30, "anthropic"]],                          // over the cap, but no spend this week (and a month ago): not counted
    "t-b": [[NOW - 1 * DAY, 9.5, "anthropic"]],                                // under the cap
    "t-payer": [[NOW - 1 * DAY, 99, "anthropic"]],                             // not a tester: never counted
    "t-t7": [[NOW - 1 * DAY, 99, "anthropic"]],                                // our own test account: left out
  };
  const spendBetween: CountSources["spendBetween"] = (tenantId, from, to, only) =>
    (rows[tenantId] ?? [])
      .filter(([ts, , provider]) => ts >= from && ts < to && (!only || ("only" in only ? provider === only.only : provider !== only.except)))
      .reduce((sum, [, usd]) => sum + usd, 0);
  const counts = funnelCounts(sources({
    accounts: () => [
      ...base.accounts(),
      account("t7", { stripe_email: "operations+t7r3@alpha9.io", fully_discounted: true, free_until: "2026-12-11T00:00:00Z" }),
    ],
    caps: () => [{ usd: 10, only: { only: "anthropic" } }],
    spendBetween,
    isTest: (contact) => contact.endsWith("@alpha9.io"),
  }), NOW);
  expect(counts).toMatchObject({ over_cap: 1, signed_up: 3, test_signups: 1 });
  expect(funnelCounts(base, NOW).over_cap).toBe(0); // without caps or a ledger: 0
});

it("over_cap counts a tester once, checks the paid allowance on the other providers and ignores a cap of 0 (E7-S24)", () => {
  const rows: Array<[number, number, string]> = [[NOW - 1 * DAY, 3, "openrouter"], [NOW - 2 * DAY, 1, "anthropic"]];
  const spendBetween: CountSources["spendBetween"] = (_t, from, to, only) =>
    rows.filter(([ts, , provider]) => ts >= from && ts < to && (!only || ("only" in only ? provider === only.only : provider !== only.except)))
      .reduce((sum, [, usd]) => sum + usd, 0);
  const two = (caps: CountSources["caps"]) => funnelCounts(sources({
    // two accounts on one tenant is one tester
    accounts: () => [
      account("t1", { fully_discounted: true, free_until: "2026-12-01T00:00:00Z", tenant_id: "t-same" }),
      account("t2", { fully_discounted: true, free_until: "2026-12-01T00:00:00Z", tenant_id: "t-same" }),
    ],
    caps, spendBetween,
  }), NOW).over_cap;
  expect(two(() => [{ usd: 2, only: { except: "anthropic" } }])).toBe(1); // 3 of paid spend over a paid 2
  expect(two(() => [{ usd: 2, only: { only: "anthropic" } }])).toBe(0);   // 1 of credit spend under 2
  expect(two(() => [{ usd: 0 }])).toBe(0);                                // a cap of 0 is no cap
  expect(two(() => [{ usd: 3.5 }])).toBe(1);                              // 4 in all over 3.5, counted once for the two accounts
});

it("over_cap looks at the month before when the week crosses a month end (E7-S24)", () => {
  const now = Date.UTC(2026, 11, 2, 12); // 2 Dec
  const rows: Array<[number, number]> = [[Date.UTC(2026, 10, 29), 8], [Date.UTC(2026, 10, 30), 5], [Date.UTC(2026, 11, 1), 2]];
  const spendBetween: CountSources["spendBetween"] = (_t, from, to) =>
    rows.filter(([ts]) => ts >= from && ts < to).reduce((sum, [, usd]) => sum + usd, 0);
  const counts = (cap: number) => funnelCounts(sources({
    accounts: () => [account("t1", { fully_discounted: true, free_until: "2026-12-31T00:00:00Z" })],
    caps: () => [{ usd: cap }], spendBetween,
  }), now).over_cap;
  expect(counts(10)).toBe(1); // November spent 13 (5 and 8 inside the week of 25 Nov to 2 Dec) over a cap of 10
  expect(counts(14)).toBe(0); // November 13 and December 2 are each under 14: a month never carries over
});

it("reads a tenant's spend between two times from its usage.sqlite, failed calls and other providers handled, 0 without one (E7-S24)", () => {
  const dir = mkdtempSync(join(tmpdir(), "counts-"));
  const path = join(dir, "usage.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE llm_usage (id INTEGER PRIMARY KEY, ts INTEGER, provider TEXT, cost_usd REAL, provider_cost_usd REAL, status TEXT)`);
  const insert = db.prepare(`INSERT INTO llm_usage (ts, provider, cost_usd, provider_cost_usd, status) VALUES (?, ?, ?, ?, ?)`);
  insert.run(100, "anthropic", 1, null, "succeeded");
  insert.run(150, "anthropic", 1, 2, "succeeded");     // the provider's own charge wins
  insert.run(160, "anthropic", 5, null, "failed");     // a failed call is not spend
  insert.run(170, "openrouter", 4, null, "succeeded");
  insert.run(300, "anthropic", 9, null, "succeeded");  // outside the range
  db.close();
  expect(tenantSpendBetween(path, 100, 200)).toBe(7);
  expect(tenantSpendBetween(path, 100, 200, { only: "anthropic" })).toBe(3);
  expect(tenantSpendBetween(path, 100, 200, { except: "anthropic" })).toBe(4);
  expect(tenantSpendBetween(path, 200, 301)).toBe(9);
  expect(tenantSpendBetween(join(dir, "missing.sqlite"), 0, 1e12)).toBe(0);
});

it("reads finished WhatsApp saves from a tenant's tasks.sqlite, self-tests and other channels left out", () => {
  const dir = mkdtempSync(join(tmpdir(), "counts-"));
  const path = join(dir, "tasks.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE task_jobs (id TEXT, tenant_id TEXT, kind TEXT, status TEXT, idempotency_key TEXT, input_json TEXT)`);
  const insert = db.prepare(`INSERT INTO task_jobs VALUES (?, ?, ?, ?, ?, ?)`);
  insert.run("1", "t", "media_ingest", "done", "phylax:whatsapp:m1", "{}");
  insert.run("2", "t", "store", "done", "whatsapp-keep:x", JSON.stringify({ source: "whatsapp" }));
  insert.run("3", "t", "store", "error", "phylax:whatsapp:m2", "{}");
  insert.run("4", "t", "store", "done", "phylax:telegram:m3", "{}");
  insert.run("5", "t", "store", "done", "phylax:whatsapp:m4", JSON.stringify({ source: "selftest" }));
  insert.run("6", "other", "store", "done", "phylax:whatsapp:m5", "{}");
  db.close();
  expect(tenantWhatsAppSaves(path, "t")).toBe(2);
  expect(tenantWhatsAppSaves(join(dir, "missing.sqlite"), "t")).toBe(0);
});

it("leaves our own test applications out of every count and counts them apart", () => {
  const counts = funnelCounts(sources({
    applications: () => [{ contact: "a@example.com" }, { contact: "TEST person", use: "a TEST application" }, { contact: "b@example.com" }],
    isTest: (contact, use) => /TEST/.test(contact + use) || contact === "b@example.com",
  }), NOW);
  expect(counts).toMatchObject({ applications: 2, accepted: 1, test_applications: 2 });
});

it("counts applications and sign-ups per post source, our own tests left out, never a person (E7-S11)", () => {
  const src = sources({
    applications: () => [
      { contact: "a@example.com", source: "P-0146" },
      { contact: "a@example.com", source: "P-0255" },          // a repeat keeps the first source
      { contact: "b@example.com", source: "P-0146" },
      { contact: "c@example.com" },                           // no source
      { contact: "d@example.com", source: "google.com" },
      { contact: "e@example.com", source: "TEST" },           // ?s=TEST: our own test
      { contact: "ops@alpha9.io", source: "P-0146" },          // our own test address
      { contact: "f@example.com", source: "<script>" },       // not a source id
    ],
    testers: () => [
      { ...tester("a@example.com", "accepted"), redeemedBy: "t1" },
      tester("b@example.com", "accepted"),
      tester("d@example.com", "accepted"),
      { ...tester("ops@alpha9.io", "accepted"), redeemedBy: "t7" },
    ],
    accounts: () => [
      account("t1", { fully_discounted: true, free_until: "2026-12-01T00:00:00Z", stripe_email: "other@example.com" }), // a, by its code
      account("b", { fully_discounted: true, free_until: "2026-12-01T00:00:00Z", stripe_email: "b@example.com" }),        // b, by email
      account("t7", { fully_discounted: true, free_until: "2026-12-01T00:00:00Z", stripe_email: "ops@alpha9.io" }),       // our test
      account("x", { fully_discounted: true, free_until: "2026-12-01T00:00:00Z", stripe_email: "x@example.com" }),        // no application
    ],
    comped: new Set(),
    isTest: (contact) => contact.endsWith("@alpha9.io"),
  });
  const bySource = sourceCounts(src, NOW);
  expect(bySource).toEqual([
    { source: "P-0146", applications: 2, signed_up: 2 },
    { source: "google.com", applications: 1, signed_up: 0 },
    { source: "none", applications: 2, signed_up: 1 },
  ]);
  const counts = funnelCounts(src, NOW);
  // per source adds up to the totals
  expect(bySource.reduce((n, row) => n + row.applications, 0)).toBe(counts.applications);
  expect(bySource.reduce((n, row) => n + row.signed_up, 0)).toBe(counts.signed_up);
  expect(counts).toMatchObject({ test_applications: 2, test_signups: 1 });
  expect(JSON.stringify(bySource)).not.toMatch(/@|alpha9|TEST|script/);
});

it("a tester whose free month ended and who now pays counts as paying and still as signed up", () => {
  const counts = funnelCounts(sources({
    accounts: () => [account("x", { stripe_email: "a@example.com", fully_discounted: false })],
  }), NOW);
  expect(counts).toMatchObject({ signed_up: 1, active_testers: 0, paying_customers: 1 });
});

it("reads finished saves of the last days from a tenant's tasks.sqlite, read only, and 0 without one", () => {
  const dir = mkdtempSync(join(tmpdir(), "counts-"));
  const path = join(dir, "tasks.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE task_jobs (id TEXT, tenant_id TEXT, kind TEXT, status TEXT, created_at INTEGER, updated_at INTEGER)`);
  const insert = db.prepare(`INSERT INTO task_jobs VALUES (?, ?, ?, ?, ?, ?)`);
  insert.run("1", "t", "store", "done", NOW - 1000, NOW - 1000);
  insert.run("2", "t", "media_ingest", "done", NOW - 2000, NOW - 2000);
  insert.run("3", "t", "store", "error", NOW, NOW);
  insert.run("4", "t", "chat", "done", NOW, NOW);
  insert.run("5", "t", "store", "done", NOW - 9 * 86_400_000, NOW - 9 * 86_400_000);
  insert.run("6", "other", "store", "done", NOW, NOW);
  db.close();
  expect(tenantSavesSince(path, "t", NOW - 7 * 86_400_000)).toBe(2);
  expect(tenantSavesSince(join(dir, "missing.sqlite"), "t", 0)).toBe(0);
});

it("keeps one line per day, answers the endpoint publicly and leaks no email", async () => {
  const dir = mkdtempSync(join(tmpdir(), "counts-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "tester-applications.jsonl"), `${JSON.stringify({ at: "x", use: "notes", contact: "a@example.com" })}\n{torn\n`);
  expect(readApplications(dir)).toHaveLength(1);
  let now = NOW;
  const counts = new PublicCounts(dir, sources({ applications: () => readApplications(dir) }), () => now);
  counts.refresh();
  now += 86_400_000;
  counts.refresh();
  const app = new Hono<{ Bindings: HttpBindings }>();
  mountPublicCounts(app, counts);
  const response = await app.request("/api/public/counts");
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  const body = await response.json() as Record<string, unknown> & { history: Array<{ date: string }> };
  expect(body).toMatchObject({ schema: "zenod-counts/v1", date: "2026-11-11", applications: 3, accepted: 2, paying_customers: 1, whatsapp_replied: 0 });
  expect((body.definitions as Record<string, string>).whatsapp_replied).toMatch(/WhatsApp/);
  expect(body.history.every((day) => "whatsapp_replied" in day)).toBe(true);
  expect(body).toMatchObject({ over_cap: 0 });
  expect((body.definitions as Record<string, string>).over_cap).toMatch(/above their monthly cap.*last 7 days.*our own test accounts left out/);
  expect(body.history.every((day) => "over_cap" in day)).toBe(true);
  expect(body.by_source).toEqual([{ source: "none", applications: 3, signed_up: 3 }]);
  expect((body.definitions as Record<string, string>).by_source).toMatch(/\?s=<post id>.*our own tests left out/);
  expect(body.history.map((day) => day.date)).toEqual(["2026-11-10", "2026-11-11"]);
  expect(JSON.stringify(body)).not.toMatch(/@|example|t-t1/);
  expect(readFileSync(join(dir, "public-counts.json"), "utf8")).not.toMatch(/@/);
});
