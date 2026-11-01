import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EXTENSION_COUPON,
  TESTER_COUPON,
  confirmLive,
  extend,
  generateCode,
  isTesterSubscription,
  issue,
  keyMode,
  makeStripe,
  parseArgs,
  readLedger,
  retireCode,
  setup,
  status,
} from "./stripe-testers.mjs";

const DAY = 86400;
const NOW = 1_800_000_000;

function notFound(path) {
  const err = new Error(`GET ${path}: 404`);
  err.status = 404;
  return err;
}

// Minimal in-memory Stripe covering the endpoints the tool uses.
function fakeStripe({ coupons = {}, subs = [], promos = {}, upcoming = {}, paymentMethods = {}, invoices = {}, account = "acct_LIVE" } = {}) {
  const calls = [];
  const stripe = async (method, path, params = {}) => {
    calls.push({ method, path, params });
    if (method === "GET" && path === "account") return { id: account };
    let m = path.match(/^coupons\/(.+)$/);
    if (m && method === "GET") {
      if (!coupons[m[1]]) throw notFound(path);
      return coupons[m[1]];
    }
    if (path === "coupons" && method === "POST") {
      coupons[params.id] = { ...params, valid: true, duration_in_months: params.duration_in_months ?? null };
      return coupons[params.id];
    }
    if (path === "promotion_codes" && method === "POST") {
      const id = `promo_${Object.keys(promos).length + 1}`;
      promos[id] = { id, code: params.code, coupon: coupons[params.coupon], active: true, times_redeemed: 0, max_redemptions: params.max_redemptions, expires_at: params.expires_at, created: NOW };
      return promos[id];
    }
    if (path === "promotion_codes" && method === "GET") {
      return { data: Object.values(promos).filter((p) => p.code.toUpperCase() === params.code.toUpperCase()), has_more: false };
    }
    m = path.match(/^promotion_codes\/(.+)$/);
    if (m) {
      if (method === "POST") promos[m[1]].active = params.active === "true";
      return promos[m[1]];
    }
    if (path === "subscriptions" && method === "GET") return { data: subs, has_more: false };
    m = path.match(/^invoices\/(in_[^/]+)(\/void)?$/);
    if (m) {
      if (m[2]) {
        invoices[m[1]].status = "void";
        const owner = subs.find((x) => x.latest_invoice === m[1]);
        if (owner) owner.status = "active";
      }
      return invoices[m[1]];
    }
    m = path.match(/^subscriptions\/(.+)$/);
    if (m && method === "GET") return subs.find((x) => x.id === m[1]);
    if (m && method === "POST") {
      const sub = subs.find((s) => s.id === m[1]);
      for (const [k, v] of Object.entries(params)) {
        const meta = k.match(/^metadata\[(.+)\]$/);
        if (meta) sub.metadata = { ...sub.metadata, [meta[1]]: v };
      }
      if (params["discounts[0][coupon]"]) {
        sub.discounts = [{ id: "di_ext", coupon: coupons[params["discounts[0][coupon]"]] ?? { id: params["discounts[0][coupon]"] } }];
        upcoming[sub.id] = 0;
      }
      return sub;
    }
    if (path === "invoices/upcoming") return { total: upcoming[params.subscription] ?? 900, currency: "eur" };
    if (path === "payment_methods") return { data: paymentMethods[params.customer] ?? [] };
    if (path.startsWith("test_helpers/test_clocks/")) return { frozen_time: NOW };
    throw new Error(`fake stripe: unhandled ${method} ${path}`);
  };
  return { stripe, calls, coupons, promos, subs };
}

function sub(id, { coupon, promo, metadata = {}, renewsIn = 3 * DAY, status: st = "active", customer = "cus_1" } = {}) {
  return {
    id,
    status: st,
    cancel_at_period_end: false,
    current_period_end: NOW + renewsIn,
    metadata,
    customer: { id: customer, invoice_settings: {} },
    discounts: coupon ? [{ id: `di_${id}`, coupon: { id: coupon }, promotion_code: promo ?? null }] : [],
  };
}

test("keyMode picks the mode from the key prefix and rejects anything else", () => {
  assert.equal(keyMode("sk_test_abc"), "test");
  assert.equal(keyMode("rk_live_abc"), "live");
  assert.throws(() => keyMode("pk_live_abc"));
});

test("generateCode is ZT- plus 8 unambiguous characters", () => {
  const code = generateCode(Buffer.from([0, 1, 2, 3, 250, 251, 252, 255]));
  assert.match(code, /^ZT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  assert.match(generateCode(), /^ZT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
});

test("makeStripe sends form params, the pinned version, and surfaces errors", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return { ok: !url.includes("missing"), status: url.includes("missing") ? 404 : 200, json: async () => (url.includes("missing") ? { error: { message: "No such coupon" } } : { ok: 1 }) };
  };
  const call = makeStripe("sk_test_x", fetchImpl);
  await call("GET", "subscriptions", { "expand[]": ["a", "b"], limit: 2, skip: undefined });
  assert.equal(seen[0].url, "https://api.stripe.com/v1/subscriptions?expand%5B%5D=a&expand%5B%5D=b&limit=2");
  assert.equal(seen[0].init.headers["Stripe-Version"], "2025-02-24.acacia");
  await call("POST", "coupons", { id: "X" });
  assert.equal(seen[1].init.body.toString(), "id=X");
  await assert.rejects(call("GET", "coupons/missing"), (err) => err.status === 404 && /No such coupon/.test(err.message));
});

test("setup creates both coupons once and then reuses them", async () => {
  const fake = fakeStripe();
  const first = await setup(fake.stripe);
  assert.deepEqual(first.map((r) => [r.coupon, r.created]), [[TESTER_COUPON.id, true], [EXTENSION_COUPON.id, true]]);
  assert.equal(fake.coupons[TESTER_COUPON.id].duration, "repeating");
  assert.equal(fake.coupons[TESTER_COUPON.id].duration_in_months, 1);
  assert.equal(fake.coupons[EXTENSION_COUPON.id].duration, "once");
  const second = await setup(fake.stripe);
  assert.deepEqual(second.map((r) => r.created), [false, false]);
  assert.equal(fake.calls.filter((c) => c.method === "POST").length, 2);
});

test("setup refuses a same-id coupon with different terms", async () => {
  const fake = fakeStripe({ coupons: { [TESTER_COUPON.id]: { id: TESTER_COUPON.id, percent_off: 100, duration: "forever", valid: true } } });
  await assert.rejects(setup(fake.stripe), /differs: duration=forever/);
});

test("issue makes a single-use 14-day code and appends a private ledger row", async () => {
  const fake = fakeStripe();
  await setup(fake.stripe);
  const ledger = join(mkdtempSync(join(tmpdir(), "testers-")), "nested", "test-codes.tsv");
  const row = await issue(fake.stripe, { label: "tester one", ledger, now: NOW * 1000 });
  const post = fake.calls.find((c) => c.path === "promotion_codes" && c.method === "POST");
  assert.equal(post.params.coupon, TESTER_COUPON.id);
  assert.equal(post.params.max_redemptions, 1);
  assert.equal(post.params.expires_at, NOW + 14 * DAY);
  assert.equal(statSync(ledger).mode & 0o777, 0o600);
  assert.equal(statSync(join(ledger, "..")).mode & 0o777, 0o700);
  assert.deepEqual(readLedger(ledger), [row]);
  assert.match(readFileSync(ledger, "utf8"), /^label\tcode\tpromotion_code\tcreated\texpires\n/);
  await assert.rejects(issue(fake.stripe, { label: "tester one", ledger }), /already has a code/);
  await assert.rejects(issue(fake.stripe, { label: "bad\tlabel", ledger }), /without tabs/);
});

test("issue refuses before setup", async () => {
  const fake = fakeStripe();
  const ledger = join(mkdtempSync(join(tmpdir(), "testers-")), "test-codes.tsv");
  await assert.rejects(issue(fake.stripe, { label: "x", ledger }), /run setup first/);
});

test("only tester-coupon or tagged subscriptions count as testers", () => {
  assert.equal(isTesterSubscription(sub("a", { coupon: TESTER_COUPON.id })), true);
  assert.equal(isTesterSubscription(sub("b", { metadata: { zenod_tester: "1" } })), true);
  assert.equal(isTesterSubscription(sub("c", { coupon: "ZENOD_FREEFLOW_100_FOREVER" })), false);
  assert.equal(isTesterSubscription(sub("d")), false);
});

test("extend is a dry run by default and only touches due testers whose next invoice is not €0", async () => {
  const subs = [
    sub("sub_due", { coupon: TESTER_COUPON.id, promo: "promo_1" }),
    sub("sub_later", { coupon: TESTER_COUPON.id, renewsIn: 20 * DAY }),
    sub("sub_free", { metadata: { zenod_tester: "1" } }),
    sub("sub_paid_user"),
    sub("sub_canceled", { metadata: { zenod_tester: "1" }, status: "canceled" }),
  ];
  const fake = fakeStripe({ subs, upcoming: { sub_free: 0 } });
  await setup(fake.stripe);
  const dry = await extend(fake.stripe, { now: NOW });
  assert.deepEqual(dry.map((r) => [r.subscription, r.action]), [
    ["sub_due", "would extend (dry run)"],
    ["sub_later", "skip: not due"],
    ["sub_free", "skip: next invoice already €0"],
    ["sub_canceled", "skip: not renewing"],
  ]);
  assert.equal(fake.calls.filter((c) => c.path.startsWith("subscriptions/")).length, 0);

  const applied = await extend(fake.stripe, { now: NOW, apply: true });
  assert.equal(applied[0].action, "extended");
  assert.equal(applied[0].next_invoice_after, 0);
  assert.equal(applied[1].action, "skip: not due (tagged)");
  const write = fake.calls.find((c) => c.path === "subscriptions/sub_due");
  assert.equal(write.params["discounts[0][coupon]"], EXTENSION_COUPON.id);
  assert.equal(write.params.proration_behavior, "none");
  assert.equal(write.params["metadata[zenod_tester_promo]"], "promo_1");
  assert.equal(subs[0].metadata.zenod_tester, "1");

  const again = await extend(fake.stripe, { now: NOW, apply: true });
  assert.equal(again[0].action, "skip: next invoice already €0");
});

test("extend recovers a past_due tester outside the window: extend + void the open renewal invoice", async () => {
  const lapsed = { ...sub("sub_lapsed", { metadata: { zenod_tester: "1" }, renewsIn: 27 * DAY, status: "past_due" }), latest_invoice: "in_open" };
  const invoices = { in_open: { id: "in_open", status: "open", total: 900, billing_reason: "subscription_cycle" } };
  const fake = fakeStripe({ subs: [lapsed], invoices });
  await setup(fake.stripe);
  const dry = await extend(fake.stripe, { now: NOW });
  assert.equal(dry[0].action, "would extend + void in_open (900) (dry run)");
  assert.equal(invoices.in_open.status, "open");
  const done = await extend(fake.stripe, { now: NOW, apply: true });
  assert.equal(done[0].action, "extended + voided in_open (900)");
  assert.equal(done[0].status_after, "active");
  assert.equal(invoices.in_open.status, "void");
  assert.equal((await extend(fake.stripe, { now: NOW, apply: true }))[0].action, "skip: not due");
});

test("status joins ledger codes with subscriptions and lists untracked testers", async () => {
  const subs = [
    sub("sub_a", { coupon: TESTER_COUPON.id, promo: "promo_1", customer: "cus_a" }),
    sub("sub_x", { metadata: { zenod_tester: "1" }, customer: "cus_x" }),
  ];
  const fake = fakeStripe({ subs, paymentMethods: { cus_x: [{ id: "pm_1" }] }, upcoming: { sub_a: 0 } });
  await setup(fake.stripe);
  const ledger = join(mkdtempSync(join(tmpdir(), "testers-")), "test-codes.tsv");
  await issue(fake.stripe, { label: "alice", ledger, now: NOW * 1000, code: "ZT-AAAA" });
  await issue(fake.stripe, { label: "bob", ledger, now: NOW * 1000, code: "ZT-BBBB" });
  fake.promos.promo_1.times_redeemed = 1;
  const rows = await status(fake.stripe, { ledger, now: NOW });
  assert.deepEqual(
    rows.map((r) => [r.label, r.code_state, r.redeemed, r.subscription, r.next_invoice, r.card_on_file]),
    [
      ["alice", "used", "1/1", "sub_a", 0, "no"],
      ["bob", "open", "0/1", "-", undefined, undefined],
      ["(not in ledger)", undefined, undefined, "sub_x", 900, "yes"],
    ],
  );
  fake.promos.promo_2.active = false; // Stripe deactivates a code when it expires
  const later = await status(fake.stripe, { ledger, now: NOW + 15 * DAY });
  assert.equal(later[1].code_state, "expired");
  assert.equal((await status(fake.stripe, { ledger, now: NOW }))[1].code_state, "retired");
});

test("retire-code deactivates by code text or id and is idempotent", async () => {
  const fake = fakeStripe();
  await setup(fake.stripe);
  const ledger = join(mkdtempSync(join(tmpdir(), "testers-")), "test-codes.tsv");
  await issue(fake.stripe, { label: "a", ledger, code: "ZT-CCCC" });
  const out = await retireCode(fake.stripe, "zt-cccc");
  assert.deepEqual([out.was_active, out.active], [true, false]);
  const again = await retireCode(fake.stripe, "promo_1");
  assert.deepEqual([again.was_active, again.active], [false, false]);
  assert.equal(fake.calls.filter((c) => c.method === "POST" && c.path === "promotion_codes/promo_1").length, 1);
  await assert.rejects(retireCode(fake.stripe, "NOPE"), /found 0/);
});

test("live writes need --confirm-live with the key's account id; reads and test mode do not", async () => {
  const fake = fakeStripe({ account: "acct_LIVE" });
  const opts = (o) => ({ _: [], ...o });
  await assert.rejects(confirmLive({ stripe: fake.stripe, mode: "live", command: "issue", opts: opts({}) }), /--confirm-live acct_LIVE/);
  await assert.rejects(confirmLive({ stripe: fake.stripe, mode: "live", command: "extend", opts: opts({ apply: true, "confirm-live": "acct_OTHER" }) }), /refused/);
  await confirmLive({ stripe: fake.stripe, mode: "live", command: "retire-code", opts: opts({ "confirm-live": "acct_LIVE" }) });
  await confirmLive({ stripe: fake.stripe, mode: "live", command: "status", opts: opts({}) });
  await confirmLive({ stripe: fake.stripe, mode: "live", command: "extend", opts: opts({}) });
  await confirmLive({ stripe: fake.stripe, mode: "test", command: "setup", opts: opts({}) });
  assert.equal(fake.calls.filter((c) => c.path === "account").length, 3);
});

test("parseArgs handles flags, --k v and --k=v", () => {
  assert.deepEqual(parseArgs(["extend", "--days", "3", "--apply", "--key-file=/k"]), { _: ["extend"], days: "3", apply: true, "key-file": "/k" });
  assert.throws(() => parseArgs(["--days"]), /needs a value/);
});
