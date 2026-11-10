// EPIC-26 S5 sandbox proof: the real TesterMonthEnd job against the Stripe sandbox, on test clocks.
// Two testers on the "Zenod tester" coupon with no card: A used Zenod 2 days ago, B never did.
// Run 3 days before renewal, then move the clocks past renewal and read what Stripe did.
//   <sandbox key on stdin> | node docs/evidence/e26-s5-sandbox/month-end-sandbox.mjs > out.json
// Refuses any key that is not a test key. The key is never printed.
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import Stripe from "stripe";
import { lastUsedFromTenantData, TesterMonthEnd } from "../../../packages/server/dist/testerMonthEnd.js";

const key = readFileSync(0, "utf8").trim();
if (!/^(sk|rk)_test_/.test(key)) throw new Error("sandbox only: a test key is required");
const stripe = new Stripe(key);
const DAY = 86400;
const log = [];
const step = (what, data = {}) => log.push({ at: new Date().toISOString(), what, ...data });

async function ensureCoupon(params) {
  try {
    return await stripe.coupons.retrieve(params.id);
  } catch (error) {
    if (error.statusCode !== 404) throw error;
    return stripe.coupons.create(params);
  }
}

async function waitReady(clockId) {
  for (let i = 0; i < 120; i += 1) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === "ready") return clock;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("test clock did not settle");
}

await ensureCoupon({ id: "ZENOD_TESTER_1M", name: "Zenod tester", percent_off: 100, duration: "repeating", duration_in_months: 1, metadata: { zenod_tester: "1" } });
await ensureCoupon({ id: "ZENOD_TESTER_NEXT_MONTH_FREE", name: "Zenod tester: next month free", percent_off: 100, duration: "once", metadata: { zenod_tester: "1" } });
const product = await stripe.products.create({ name: "Zenod Hosted (E26-S5 sandbox)" });
const price = await stripe.prices.create({ product: product.id, currency: "eur", unit_amount: 900, recurring: { interval: "month" } });
step("sandbox price", { price: price.id, amount: price.unit_amount, currency: price.currency });

const start = Math.floor(Date.now() / 1000);
const testers = {};
for (const name of ["A_active", "B_inactive"]) {
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: start, name: `e26-s5 ${name}` });
  const customer = await stripe.customers.create({ test_clock: clock.id, name: `e26-s5 ${name}` });
  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: price.id }],
    discounts: [{ coupon: "ZENOD_TESTER_1M" }],
    collection_method: "charge_automatically",
  });
  testers[name] = { clock: clock.id, customer: customer.id, subscription: sub.id, tenant: `tenant_${name}` };
  step("tester signed up with the tester coupon, no card", {
    tester: name, subscription: sub.id, status: sub.status, renews: new Date(sub.current_period_end * 1000).toISOString(),
    firstInvoiceTotal: (await stripe.invoices.retrieve(sub.latest_invoice)).total,
  });
}

// A's own data: one voice note saved 2 days before the decision. B has nothing.
const dataDir = mkdtempSync(join(tmpdir(), "e26-s5-sandbox-"));
const periodEnd = (await stripe.subscriptions.retrieve(testers.A_active.subscription)).current_period_end;
const decideAt = periodEnd - 3 * DAY;
mkdirSync(join(dataDir, testers.A_active.tenant));
const db = new DatabaseSync(join(dataDir, testers.A_active.tenant, "tasks.sqlite"));
db.exec("CREATE TABLE task_jobs (created_at INTEGER, input_json TEXT)");
db.prepare("INSERT INTO task_jobs VALUES (?, ?)").run((decideAt - 2 * DAY) * 1000, '{"source":"whatsapp"}');
db.close();

for (const t of Object.values(testers)) {
  await stripe.testHelpers.testClocks.advance(t.clock, { frozen_time: decideAt });
}
for (const t of Object.values(testers)) await waitReady(t.clock);
step("clocks moved to 3 days before renewal", { at: new Date(decideAt * 1000).toISOString() });

const alerts = [];
const job = new TesterMonthEnd({
  stripe,
  accounts: () => Object.values(testers).map((t) => ({ subscriptionId: t.subscription, tenantId: t.tenant, overCap: async () => false })),
  lastUsed: (tenantId) => lastUsedFromTenantData(dataDir, tenantId),
  now: () => decideAt * 1000,
  alert: (reason, fields) => alerts.push({ reason, ...fields }),
  log: (line) => step("job log", { line }),
});
const first = await job.runOnce();
step("month-end job ran", { results: first.map(({ subscriptionId, ...r }) => ({ subscription: subscriptionId, ...r })), alerts: [...alerts] });
const second = await job.runOnce();
step("job ran again (changes nothing)", { results: second.map((r) => r.reason), alerts: [...alerts] });

const after = periodEnd + 1 * DAY;
for (const t of Object.values(testers)) await stripe.testHelpers.testClocks.advance(t.clock, { frozen_time: after });
for (const t of Object.values(testers)) await waitReady(t.clock);
step("clocks moved to 1 day after renewal", { at: new Date(after * 1000).toISOString() });

const summary = {};
for (const [name, t] of Object.entries(testers)) {
  const sub = await stripe.subscriptions.retrieve(t.subscription);
  const invoices = (await stripe.invoices.list({ customer: t.customer, limit: 10 })).data;
  const charges = (await stripe.charges.list({ customer: t.customer, limit: 10 })).data;
  const pms = (await stripe.paymentMethods.list({ customer: t.customer, limit: 1 })).data;
  summary[name] = {
    subscription: t.subscription,
    status: sub.status,
    cancel_at_period_end: sub.cancel_at_period_end,
    ended_at: sub.ended_at ? new Date(sub.ended_at * 1000).toISOString() : null,
    renews: sub.status === "canceled" ? null : new Date(sub.current_period_end * 1000).toISOString(),
    month_end_tag: sub.metadata.zenod_tester_month_end ?? null,
    invoices: invoices.map((i) => ({ id: i.id, reason: i.billing_reason, total: i.total, amount_paid: i.amount_paid, status: i.status })),
    charges: charges.length,
    cards_on_file: pms.length,
    euros_charged: charges.reduce((s, c) => s + c.amount, 0) / 100,
  };
}
step("what Stripe did", { summary });

for (const t of Object.values(testers)) await stripe.testHelpers.testClocks.del(t.clock);
await stripe.prices.update(price.id, { active: false });
await stripe.products.update(product.id, { active: false });
step("sandbox cleaned up (test clocks deleted with their customers; price and product archived)");

const ok =
  summary.A_active.status === "active" && summary.A_active.invoices.every((i) => i.total === 0) &&
  summary.B_inactive.status === "canceled" && summary.B_inactive.invoices.every((i) => i.total === 0) &&
  summary.A_active.charges === 0 && summary.B_inactive.charges === 0 && alerts.length === 0;
console.log(JSON.stringify({ ok, mode: "Stripe sandbox (test mode)", log }, null, 2));
process.exit(ok ? 0 : 1);
