import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { expect, it } from "vitest";
import type { CustomerAccount } from "../src/customerAccounts.js";
import { funnelCounts, mountPublicCounts, PublicCounts, readApplications, tenantSavesSince, type CountSources } from "../src/publicCounts.js";
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

it("leaves our own test applications out of every count and counts them apart", () => {
  const counts = funnelCounts(sources({
    applications: () => [{ contact: "a@example.com" }, { contact: "TEST person", use: "a TEST application" }, { contact: "b@example.com" }],
    isTest: (contact, use) => /TEST/.test(contact + use) || contact === "b@example.com",
  }), NOW);
  expect(counts).toMatchObject({ applications: 2, accepted: 1, test_applications: 2 });
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
  expect(body).toMatchObject({ schema: "zenod-counts/v1", date: "2026-11-11", applications: 3, accepted: 2, paying_customers: 1 });
  expect(body.history.map((day) => day.date)).toEqual(["2026-11-10", "2026-11-11"]);
  expect(JSON.stringify(body)).not.toMatch(/@|example|t-t1/);
  expect(readFileSync(join(dir, "public-counts.json"), "utf8")).not.toMatch(/@/);
});
